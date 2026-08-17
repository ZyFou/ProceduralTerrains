"""RAW uint16 heightfield decoding and Blender-space grid generation."""

from __future__ import annotations

from array import array
from dataclasses import dataclass
from pathlib import Path
import sys
from typing import Iterator


class HeightfieldError(ValueError):
    pass


@dataclass(frozen=True)
class HeightfieldGrid:
    source_resolution: int
    resolution: int
    samples: array
    stride: int

    def normalized(self, x: int, z: int) -> float:
        source_x = x * self.stride
        source_z = z * self.stride
        return self.samples[source_z * self.source_resolution + source_x] / 65535.0


def target_resolution(source_resolution: int, requested: str) -> int:
    if requested == "FULL":
        return source_resolution
    if requested == "AUTO":
        return min(source_resolution, 513)
    try:
        target = int(requested)
    except (TypeError, ValueError) as exc:
        raise HeightfieldError(f"Unknown mesh resolution: {requested}") from exc
    target = min(target, source_resolution)
    if target < 2 or (source_resolution - 1) % (target - 1) != 0:
        raise HeightfieldError(
            f"Mesh resolution {target} does not divide the {source_resolution} source vertex grid."
        )
    return target


def read_raw_heightfield(path: str | Path, source_resolution: int, requested: str = "AUTO") -> HeightfieldGrid:
    raw_path = Path(path)
    expected = source_resolution * source_resolution * 2
    try:
        actual = raw_path.stat().st_size
    except OSError as exc:
        raise HeightfieldError(f"Required heightfield does not exist: {raw_path}") from exc
    if actual != expected:
        raise HeightfieldError(
            f"RAW heightfield {raw_path.name} is {actual} bytes; expected {expected} bytes for a {source_resolution} x {source_resolution} uint16 grid."
        )
    samples = array("H")
    try:
        with raw_path.open("rb") as stream:
            samples.fromfile(stream, source_resolution * source_resolution)
    except OSError as exc:
        raise HeightfieldError(f"Unable to read RAW heightfield {raw_path}: {exc}") from exc
    if sys.byteorder != "little":
        samples.byteswap()
    resolution = target_resolution(source_resolution, requested)
    return HeightfieldGrid(source_resolution, resolution, samples, (source_resolution - 1) // (resolution - 1))


def vertices(
    grid: HeightfieldGrid,
    size: float,
    min_height: float,
    max_height: float,
) -> Iterator[tuple[float, float, float]]:
    """Yield local Blender XYZ; source +Z maps to Blender -Y."""
    steps = grid.resolution - 1
    height_range = max_height - min_height
    half = size * 0.5
    for z in range(grid.resolution):
        source_z = -half + size * (z / steps)
        blender_y = -source_z
        for x in range(grid.resolution):
            local_x = -half + size * (x / steps)
            local_z = grid.normalized(x, z) * height_range
            yield (local_x, blender_y, local_z)


def quad_faces(resolution: int) -> Iterator[tuple[int, int, int, int]]:
    """Yield counter-clockwise quads with +Z normals after the Z-to--Y map."""
    for z in range(resolution - 1):
        row = z * resolution
        next_row = row + resolution
        for x in range(resolution - 1):
            a = row + x
            b = a + 1
            d = next_row + x
            c = d + 1
            yield (a, d, c, b)


def loop_uvs(resolution: int) -> Iterator[tuple[float, float]]:
    steps = resolution - 1
    for z in range(resolution - 1):
        v0, v1 = z / steps, (z + 1) / steps
        for x in range(resolution - 1):
            u0, u1 = x / steps, (x + 1) / steps
            yield (u0, v0)
            yield (u0, v1)
            yield (u1, v1)
            yield (u1, v0)
