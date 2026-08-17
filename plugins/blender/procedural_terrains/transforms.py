"""Pure import transform calculations shared by Blender code and tests."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ImportTransform:
    scale_x: float
    scale_y: float
    scale_z: float
    source_center_x: float
    source_center_y: float
    source_min_height: float
    target_x: float
    target_y: float
    target_z: float
    effective_width: float
    effective_depth: float
    effective_height: float

    def point(self, source_x: float, source_y: float, source_height: float) -> tuple[float, float, float]:
        return (
            self.target_x + (source_x - self.source_center_x) * self.scale_x,
            self.target_y - (source_y - self.source_center_y) * self.scale_y,
            self.target_z + (source_height - self.source_min_height) * self.scale_z,
        )


def import_transform(document: dict[str, Any], dimension_mode: str = "SOURCE",
                     target_width: float = 1000.0, target_depth: float = 1000.0,
                     vertical_scale: float = 1.0,
                     placement: tuple[float, float, float] = (0, 0, 0)) -> ImportTransform:
    bounds = document["bounds"]
    source_width, source_depth = float(bounds["sizeX"]), float(bounds["sizeZ"])
    if dimension_mode == "CUSTOM":
        if target_width <= 0 or target_depth <= 0:
            raise ValueError("Custom import width and depth must be positive.")
        scale_x, scale_y = target_width / source_width, target_depth / source_depth
        effective_width, effective_depth = float(target_width), float(target_depth)
    else:
        scale_x = scale_y = 1.0
        effective_width, effective_depth = source_width, source_depth
    if vertical_scale <= 0:
        raise ValueError("Import vertical scale must be positive.")
    min_height, max_height = float(bounds["minHeight"]), float(bounds["maxHeight"])
    return ImportTransform(
        scale_x, scale_y, float(vertical_scale),
        float(bounds["minX"]) + source_width * .5,
        float(bounds["minZ"]) + source_depth * .5,
        min_height, *map(float, placement), effective_width, effective_depth,
        (max_height - min_height) * float(vertical_scale),
    )
