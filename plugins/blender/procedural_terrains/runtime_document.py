"""Parser and validator for Procedural Terrains runtime document v1."""

from __future__ import annotations

from dataclasses import dataclass
import json
import math
from pathlib import Path
from typing import Any, Iterable


FORMAT = "procedural-terrains"
SCHEMA_VERSION = 1
HEIGHTFIELD_RESOLUTIONS = frozenset((513, 1025, 2049, 4097))
PROJECT_MODES = frozenset(("procedural", "nodes", "manual"))
SPLAT_CHANNELS = ("desert", "canyon", "wetland", "mountains")


@dataclass(frozen=True)
class Diagnostic:
    severity: str
    code: str
    message: str
    path: str = ""

    def __str__(self) -> str:
        suffix = f" ({self.path})" if self.path else ""
        return f"[{self.code}] {self.message}{suffix}"


class TerrainDocumentError(ValueError):
    def __init__(self, diagnostics: Iterable[Diagnostic]):
        self.diagnostics = tuple(diagnostics)
        super().__init__("\n".join(str(item) for item in self.diagnostics))


def _is_number(value: Any) -> bool:
    return type(value) in (int, float) and math.isfinite(value)


def _is_int32(value: Any) -> bool:
    return type(value) is int and -(2**31) <= value <= (2**31 - 1)


def is_safe_artifact_path(value: Any) -> bool:
    if not isinstance(value, str) or not value or "\\" in value or value.startswith("/"):
        return False
    if ":" in value:
        return False
    return all(segment not in ("", ".", "..") for segment in value.split("/"))


def validate_document(document: Any) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []

    def error(code: str, message: str, path: str = "") -> None:
        diagnostics.append(Diagnostic("ERROR", code, message, path))

    if not isinstance(document, dict):
        error("document.invalid", "Runtime terrain document must be a JSON object.")
        return diagnostics

    if document.get("format") != FORMAT:
        error("format.unsupported", f"Expected format '{FORMAT}'.", "format")
    if document.get("schemaVersion") != SCHEMA_VERSION:
        error(
            "schema.unsupported",
            f"Runtime terrain schema {document.get('schemaVersion', 'missing')} is unsupported; this add-on supports schema {SCHEMA_VERSION}.",
            "schemaVersion",
        )

    producer = document.get("producer")
    if not (
        isinstance(producer, dict)
        and isinstance(producer.get("name"), str)
        and producer.get("name")
        and isinstance(producer.get("appVersion"), str)
        and producer.get("appVersion")
        and type(producer.get("generatorVersion")) is int
        and producer["generatorVersion"] >= 1
    ):
        error("producer.invalid", "Producer name, app version, and generator version are required.", "producer")

    project = document.get("project")
    if not isinstance(project, dict):
        error("project.missing", "Project metadata is required.", "project")
    else:
        if project.get("mode") not in PROJECT_MODES:
            error("project.mode", "Project mode must be procedural, nodes, or manual.", "project.mode")
        if project.get("world") != "studio":
            error("project.world", "Runtime document v1 supports studio worlds only.", "project.world")
        if project.get("tileShape", "square") != "square":
            error("project.tileShape", "Runtime document v1 supports square tile assemblies only.", "project.tileShape")
        if not _is_int32(project.get("seed")):
            error("project.seed", "Project seed must be a 32-bit integer.", "project.seed")

    coordinates = document.get("coordinates")
    if not (
        isinstance(coordinates, dict)
        and coordinates.get("units") == "meters"
        and coordinates.get("upAxis") == "+Y"
        and coordinates.get("xAxis") == "+X"
        and coordinates.get("zAxis") == "+Z"
        and coordinates.get("unityMapping") == "x,y,z"
        and coordinates.get("tilePivot") == "center"
    ):
        error(
            "coordinates.unsupported",
            "Coordinates must use meters, +Y up, identity XYZ mapping, and center tile pivots.",
            "coordinates",
        )

    bounds = document.get("bounds")
    if not (
        isinstance(bounds, dict)
        and _is_number(bounds.get("minX"))
        and _is_number(bounds.get("minZ"))
        and _is_number(bounds.get("sizeX"))
        and bounds["sizeX"] > 0
        and _is_number(bounds.get("sizeZ"))
        and bounds["sizeZ"] > 0
        and _is_number(bounds.get("minHeight"))
        and _is_number(bounds.get("maxHeight"))
        and bounds["maxHeight"] > bounds["minHeight"]
        and _is_number(bounds.get("seaLevel"))
    ):
        error("bounds.invalid", "Bounds require finite positive horizontal sizes and an increasing height range.", "bounds")

    tiles = document.get("tiles")
    if not isinstance(tiles, list) or not tiles:
        error("tiles.missing", "At least one terrain tile is required.", "tiles")
    else:
        seen: set[tuple[int, int]] = set()
        previous: tuple[int, int] | None = None
        for index, tile in enumerate(tiles):
            base = f"tiles[{index}]"
            if not isinstance(tile, dict):
                error("tile.invalid", "Tile entry must be an object.", base)
                continue
            cx, cz = tile.get("cx"), tile.get("cz")
            if not (_is_int32(cx) and _is_int32(cz)):
                error("tile.coordinate", "Tile coordinates must be 32-bit integers.", base)
            else:
                key = (cx, cz)
                if key in seen:
                    error("tile.duplicate", f"Duplicate tile coordinate {cx},{cz}.", base)
                seen.add(key)
                order_key = (cz, cx)
                if previous is not None and order_key < previous:
                    error("tile.order", "Tiles must be sorted by cz, then cx.", base)
                previous = order_key
            if not (
                _is_number(tile.get("centerX"))
                and _is_number(tile.get("centerZ"))
                and _is_number(tile.get("size"))
                and tile["size"] > 0
            ):
                error("tile.bounds", "Tile center and positive size are required.", base)
            _validate_heightfield(tile.get("heightfield"), base, error)
            if tile.get("splat") is not None:
                _validate_splat(tile.get("splat"), base, error)

    generation = document.get("generation")
    if generation is not None and not (
        isinstance(generation, dict)
        and generation.get("sourceVersion") == 1
        and generation.get("authoritative") == "baked"
        and generation.get("kind") in PROJECT_MODES
    ):
        error("generation.invalid", "Generation source must be a version 1 baked-authoritative descriptor.", "generation")
    if not isinstance(document.get("features"), dict):
        error("features.missing", "Feature summary is required.", "features")
    unsupported = document.get("unsupportedFeatures")
    if not isinstance(unsupported, list) or any(not isinstance(item, str) for item in unsupported):
        error("features.unsupported", "unsupportedFeatures must be an array of strings.", "unsupportedFeatures")
    return diagnostics


def _validate_heightfield(value: Any, tile_path: str, error) -> None:
    path = f"{tile_path}.heightfield"
    if not isinstance(value, dict):
        error("heightfield.missing", "Every tile requires a heightfield.", path)
        return
    if not is_safe_artifact_path(value.get("path")):
        error("artifact.path", "Heightfield path must be a safe forward-slash relative path.", f"{path}.path")
    if value.get("resolution") not in HEIGHTFIELD_RESOLUTIONS:
        error("heightfield.resolution", "Heightfield resolution must be 513, 1025, 2049, or 4097.", f"{path}.resolution")
    expected = {
        "encoding": "uint16-normalized",
        "byteOrder": "little-endian",
        "sampleLayout": "vertex-grid-inclusive",
        "rowOrder": "negative-z-to-positive-z",
        "columnOrder": "negative-x-to-positive-x",
    }
    if any(value.get(key) != expected_value for key, expected_value in expected.items()):
        error("heightfield.encoding", "Heightfield encoding or sample orientation is unsupported.", path)
    if not (
        _is_number(value.get("minHeight"))
        and _is_number(value.get("maxHeight"))
        and value["maxHeight"] > value["minHeight"]
    ):
        error("heightfield.range", "Heightfield requires an increasing finite height range.", path)


def _validate_splat(value: Any, tile_path: str, error) -> None:
    path = f"{tile_path}.splat"
    if not isinstance(value, dict):
        error("splat.invalid", "Splat descriptor must be an object.", path)
        return
    if not is_safe_artifact_path(value.get("path")):
        error("artifact.path", "Splat path must be a safe forward-slash relative path.", f"{path}.path")
    if not (type(value.get("width")) is int and value["width"] > 0 and type(value.get("height")) is int and value["height"] > 0):
        error("splat.resolution", "Splat dimensions must be positive integers.", path)
    if tuple(value.get("channels", ())) != SPLAT_CHANNELS:
        error("splat.channels", "Splat channels must be desert, canyon, wetland, and mountains in RGBA order.", f"{path}.channels")


def read_document(path: str | Path) -> tuple[dict[str, Any], list[Diagnostic]]:
    document_path = Path(path)
    try:
        text = document_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise TerrainDocumentError((Diagnostic("ERROR", "document.read", f"Unable to read runtime terrain document: {exc}"),)) from exc
    try:
        document = json.loads(text)
    except json.JSONDecodeError as exc:
        raise TerrainDocumentError((Diagnostic("ERROR", "document.json", f"Runtime terrain document contains malformed JSON: {exc.msg}."),)) from exc
    diagnostics = validate_document(document)
    errors = [item for item in diagnostics if item.severity == "ERROR"]
    if errors:
        raise TerrainDocumentError(errors)
    return document, diagnostics
