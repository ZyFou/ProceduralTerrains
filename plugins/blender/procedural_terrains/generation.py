"""Blender-independent procedural terrain generation.

The formulas mirror the web editor's CPU Noise Stack evaluator.  Arrays are
kept in float32 so generated grids use the same precision class as the live
terrain shader and adjacent tiles can sample shared world coordinates exactly.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
import json
import math
from typing import Any, Iterable

import numpy as np


MAX_LAYERS = 12
MAX_VERTICES = 16_000_000
LAYER_TYPES = (
    "legacy", "fbm", "ridged", "billow", "value", "white", "constant",
    "voronoi", "crater", "dune", "flow", "domainWarp", "terrace",
)
BLEND_MODES = (
    "add", "subtract", "multiply", "divide", "max", "min", "replace",
    "difference", "overlay", "carve", "flatten",
)


DEFAULT_LAYER_PARAMS: dict[str, dict[str, float | int]] = {
    "legacy": {},
    "fbm": {"scale": 1.0, "octaves": 5, "persistence": 0.5, "lacunarity": 2.0, "erosion": 0.0, "warp": 0.0},
    "ridged": {"scale": 1.0, "octaves": 5, "persistence": 0.5, "lacunarity": 2.0, "sharpness": 2.0, "erosion": 0.0, "warp": 0.0},
    "billow": {"scale": 1.0, "octaves": 5, "persistence": 0.5, "lacunarity": 2.0, "erosion": 0.0, "warp": 0.0},
    "value": {"scale": 1.0, "interp": 2},
    "white": {"scale": 8.0, "smoothing": 0.0},
    "constant": {"value": 0.1},
    "voronoi": {"scale": 2.0, "jitter": 1.0, "distanceMode": 0, "outputMode": 2},
    "crater": {"scale": 1.5, "density": 0.55, "depth": 0.6, "rim": 0.3, "rimWidth": 0.35},
    "dune": {"scale": 1.2, "windDir": 0.7, "sharpness": 1.4, "rippleScale": 4.0, "rippleStrength": 0.12},
    "flow": {"scale": 1.0, "flowDir": 1.2, "width": 0.3, "meander": 1.2, "meanderScale": 0.6},
    "domainWarp": {"scale": 1.0, "octaves": 4},
    "terrace": {"count": 12, "smoothness": 0.5},
}

DEFAULT_BLEND = {
    "legacy": "replace", "fbm": "add", "ridged": "add", "billow": "add",
    "value": "add", "white": "add", "constant": "add", "voronoi": "add",
    "crater": "add", "dune": "add", "flow": "subtract",
    "domainWarp": "add", "terrace": "replace",
}
DEFAULT_STRENGTH = {
    "legacy": 1.0, "fbm": 0.4, "ridged": 0.5, "billow": 0.4,
    "value": 0.3, "white": 0.06, "constant": 1.0, "voronoi": 0.4,
    "crater": 0.5, "dune": 0.35, "flow": 0.5, "domainWarp": 1.0,
    "terrace": 1.0,
}


@dataclass
class LayerMask:
    type: str = "height"
    enabled: bool = True
    invert: bool = False
    params: dict[str, float | int] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "LayerMask":
        return cls(str(value.get("type", "height")), bool(value.get("enabled", True)),
                   bool(value.get("invert", False)), dict(value.get("params") or {}))


@dataclass
class NoiseLayer:
    type: str = "fbm"
    name: str = "Layer"
    enabled: bool = True
    blend_mode: str = "add"
    strength: float = 0.4
    opacity: float = 1.0
    seed_offset: int = 0
    params: dict[str, float | int] = field(default_factory=dict)
    masks: list[LayerMask] = field(default_factory=list)

    @classmethod
    def make(cls, layer_type: str, **overrides: Any) -> "NoiseLayer":
        if layer_type not in LAYER_TYPES:
            raise ValueError(f"Unknown terrain layer type: {layer_type}")
        params = dict(DEFAULT_LAYER_PARAMS[layer_type])
        params.update(overrides.pop("params", {}) or {})
        masks = [m if isinstance(m, LayerMask) else LayerMask.from_dict(m)
                 for m in overrides.pop("masks", [])]
        return cls(
            type=layer_type,
            name=str(overrides.pop("name", layer_type)),
            blend_mode=str(overrides.pop("blend_mode", overrides.pop("blendMode", DEFAULT_BLEND[layer_type]))),
            strength=float(overrides.pop("strength", DEFAULT_STRENGTH[layer_type])),
            opacity=float(overrides.pop("opacity", 1.0)),
            seed_offset=int(overrides.pop("seed_offset", overrides.pop("seedOffset", 0))),
            enabled=bool(overrides.pop("enabled", True)),
            params=params,
            masks=masks,
        )

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "NoiseLayer":
        return cls.make(str(value.get("type", "fbm")), **value)

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type, "name": self.name, "enabled": self.enabled,
            "blendMode": self.blend_mode, "strength": self.strength,
            "opacity": self.opacity, "seedOffset": self.seed_offset,
            "params": dict(self.params), "masks": [asdict(mask) for mask in self.masks],
        }


@dataclass
class GenerationSettings:
    preset: str = "highlands"
    stack_preset: str = "classic"
    seed: int = 1337
    width: float = 1000.0
    depth: float = 1000.0
    height: float = 560.0
    tiles_x: int = 1
    tiles_y: int = 1
    resolution: int = 257
    placement: str = "ORIGIN"
    smooth_shading: bool = True
    create_material: bool = True
    noise_scale: float = 45.0
    noise_strength: float = 1.0
    terrain_smoothing: float = 0.0
    octaves: int = 7
    persistence: float = 0.5
    lacunarity: float = 2.05
    ridge: float = 0.65
    warp: float = 0.9
    falloff: float = 0.2
    edge_falloff_mode: str = "island"
    formation_sea_level: float = 100.0
    moist_scale: float = 1.0
    moist_bias: float = 0.0
    biome_scale: float = 1.0
    temp_bias: float = 0.0
    normalize_output: bool = False
    output_min: float = 0.0
    output_max: float = 1.35
    layers: list[NoiseLayer] = field(default_factory=lambda: [NoiseLayer.make("legacy", name="Classic Terrain")])

    @property
    def vertex_count(self) -> int:
        return int(self.tiles_x) * int(self.tiles_y) * int(self.resolution) ** 2

    def validate(self) -> None:
        if not (self.width > 0 and self.depth > 0 and self.height > 0):
            raise ValueError("Terrain width, depth, and height must be positive.")
        if not (1 <= self.tiles_x <= 16 and 1 <= self.tiles_y <= 16):
            raise ValueError("Tile counts must be between 1 and 16.")
        if self.resolution not in (65, 129, 257, 513, 1025):
            raise ValueError("Terrain resolution must be 65, 129, 257, 513, or 1025.")
        if self.vertex_count > MAX_VERTICES:
            raise ValueError(f"Terrain would contain {self.vertex_count:,} vertices; the limit is {MAX_VERTICES:,}.")
        active = [layer for layer in self.layers if layer.enabled]
        if not active:
            raise ValueError("At least one terrain layer must be enabled.")
        if len(self.layers) > MAX_LAYERS:
            raise ValueError(f"Noise Stacks support at most {MAX_LAYERS} layers.")
        for layer in self.layers:
            if layer.type not in LAYER_TYPES or layer.blend_mode not in BLEND_MODES:
                raise ValueError(f"Invalid layer configuration: {layer.type}/{layer.blend_mode}")

    def to_dict(self) -> dict[str, Any]:
        result = asdict(self)
        result["layers"] = [layer.to_dict() for layer in self.layers]
        return result

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), separators=(",", ":"), sort_keys=True)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "GenerationSettings":
        aliases = {
            "noiseScale": "noise_scale", "noiseStrength": "noise_strength",
            "terrainSmoothing": "terrain_smoothing", "edgeFalloffMode": "edge_falloff_mode",
            "terrainFormationSeaLevel": "formation_sea_level", "moistScale": "moist_scale",
            "moistBias": "moist_bias", "biomeScale": "biome_scale", "tempBias": "temp_bias",
            "normalizeOutput": "normalize_output", "outputMin": "output_min", "outputMax": "output_max",
            "tilesX": "tiles_x", "tilesY": "tiles_y", "createMaterial": "create_material",
            "smoothShading": "smooth_shading", "stackPreset": "stack_preset",
        }
        normalized = {aliases.get(key, key): item for key, item in value.items()}
        normalized["layers"] = [NoiseLayer.from_dict(item) for item in normalized.get("layers", [])]
        valid = set(cls.__dataclass_fields__)
        return cls(**{key: item for key, item in normalized.items() if key in valid})

    @classmethod
    def from_json(cls, value: str) -> "GenerationSettings":
        return cls.from_dict(json.loads(value))


TERRAIN_PRESETS: dict[str, dict[str, float | int | str]] = {
    "highlands": {},
    "archipelago": {"height": 420, "formation_sea_level": 78, "falloff": 0.75, "ridge": 0.45, "warp": 1.4, "noise_scale": 60, "moist_bias": 0.25, "temp_bias": 0.25},
    "alpine": {"height": 640, "formation_sea_level": 24, "ridge": 0.92, "warp": 0.6, "noise_scale": 38, "persistence": 0.52, "moist_bias": -0.1, "temp_bias": -0.3},
    "dunes": {"height": 180, "formation_sea_level": 4, "ridge": 0.12, "warp": 1.8, "noise_scale": 55, "persistence": 0.42, "moist_bias": -0.75, "falloff": 0.35, "temp_bias": 0.6},
    "rolling": {"height": 220, "formation_sea_level": 30, "ridge": 0.22, "warp": 1.1, "noise_scale": 50, "persistence": 0.46, "moist_bias": 0.3},
    "volcanic": {"height": 560, "formation_sea_level": 58, "ridge": 0.85, "warp": 0.8, "noise_scale": 30, "falloff": 0.85, "moist_bias": -0.2},
    "canyon": {"height": 380, "formation_sea_level": 12, "ridge": 0.55, "warp": 2.4, "noise_scale": 42, "persistence": 0.58, "lacunarity": 2.4, "moist_bias": -0.5, "falloff": 0.3, "temp_bias": 0.35},
    "cartoon": {"height": 420, "formation_sea_level": 72, "noise_scale": 72, "noise_strength": 0.72, "terrain_smoothing": 0.28, "octaves": 4, "persistence": 0.36, "lacunarity": 1.85, "ridge": 0.16, "warp": 0.28, "falloff": 0.35, "biome_scale": 0.7, "moist_scale": 0.8},
}


def _layer(kind: str, name: str, blend: str | None = None, strength: float | None = None,
           params: dict[str, float | int] | None = None, masks: Iterable[LayerMask] = ()) -> NoiseLayer:
    return NoiseLayer.make(kind, name=name, blend_mode=blend or DEFAULT_BLEND[kind],
                           strength=DEFAULT_STRENGTH[kind] if strength is None else strength,
                           params=params or {}, masks=list(masks))


STACK_PRESETS: dict[str, list[NoiseLayer]] = {
    "classic": [_layer("legacy", "Classic Terrain")],
    "rollingHills": [_layer("fbm", "Base", strength=.5, params={"scale": 1, "octaves": 4}), _layer("billow", "Soft Hills", strength=.25, params={"scale": 2.2, "octaves": 3}), _layer("fbm", "Detail", strength=.06, params={"scale": 6, "octaves": 3})],
    "sharpMountains": [_layer("fbm", "Continents", strength=.45, params={"scale": .6, "octaves": 4}), _layer("domainWarp", "Breakup Warp", strength=.6, params={"scale": 1.2}), _layer("ridged", "Mountain Ridges", strength=.9, params={"scale": 2.4, "octaves": 5, "sharpness": 2.5}), _layer("fbm", "Small Details", strength=.05, params={"scale": 8, "octaves": 3})],
    "canyonTerraces": [_layer("fbm", "Base", strength=.5, params={"scale": .8, "octaves": 4}), _layer("ridged", "Mesa Edges", strength=.35, params={"scale": 2, "octaves": 4, "sharpness": 3}), _layer("terrace", "Strata", blend="replace", strength=.9, params={"count": 14, "smoothness": .35})],
    "desertDunes": [_layer("fbm", "Base", strength=.3, params={"scale": .6, "octaves": 3}), _layer("dune", "Dunes", strength=.35, params={"scale": 1.4}), _layer("white", "Grain", strength=.02, params={"scale": 10})],
    "moonCraters": [_layer("fbm", "Regolith", strength=.25, params={"scale": 1.2, "octaves": 4}), _layer("crater", "Large Craters", strength=.7, params={"scale": 1, "density": .5, "depth": .7, "rim": .35}), _layer("crater", "Small Craters", strength=.35, params={"scale": 3.5, "density": .4, "depth": .4, "rim": .2})],
    "alienCellular": [_layer("fbm", "Base", strength=.3, params={"scale": .8, "octaves": 3}), _layer("voronoi", "Plates", strength=.5, params={"scale": 1.8, "outputMode": 3}), _layer("domainWarp", "Twist", strength=.8, params={"scale": 1.5})],
    "islandContinents": [_layer("fbm", "Continents", strength=.7, params={"scale": .4, "octaves": 5}), _layer("billow", "Coastal Hills", strength=.15, params={"scale": 2, "octaves": 3}), _layer("fbm", "Detail", strength=.05, params={"scale": 7, "octaves": 3})],
    "erodedValleys": [_layer("ridged", "Highlands", strength=.7, params={"scale": 1.4, "octaves": 5, "sharpness": 1.8}), _layer("flow", "River Carving", blend="subtract", strength=.4, params={"scale": .8}), _layer("fbm", "Detail", strength=.06, params={"scale": 8, "octaves": 3})],
}

# Realism presets are expressed separately for readability, then merged.
STACK_PRESETS.update({
    "geologicalHybrid": [_layer("domainWarp", "Geological Warp", strength=.62, params={"scale": .58, "octaves": 4}), _layer("fbm", "Terraced Massif", strength=.68, params={"scale": .55, "octaves": 6, "persistence": .51, "lacunarity": 2.03, "erosion": .12, "warp": .18}), _layer("terrace", "Weathered Terraces", blend="replace", strength=.68, params={"count": 7, "smoothness": .34}), _layer("fbm", "Derivative Weathering", strength=.2, params={"scale": .72, "octaves": 6, "persistence": .51, "lacunarity": 2.03, "erosion": .62, "warp": .25}), _layer("ridged", "Rock Ridges", strength=.12, params={"scale": 1.7, "octaves": 6, "persistence": .51, "lacunarity": 2.03, "sharpness": 2.25, "erosion": .28, "warp": .2}), _layer("fbm", "Fine Geological Detail", strength=.05, params={"scale": 2.9, "octaves": 4, "persistence": .48, "lacunarity": 2.08, "erosion": .16})],
    "alpineRanges": [_layer("fbm", "Massif Base", strength=.42, params={"scale": .55, "octaves": 4, "erosion": .25, "warp": .45}), _layer("domainWarp", "Range Bend", strength=.7, params={"scale": .9, "octaves": 3}), _layer("ridged", "Eroded Ridges", strength=.85, params={"scale": 2, "octaves": 6, "sharpness": 2.2, "erosion": .55, "warp": .4}), _layer("fbm", "Scree Detail", strength=.07, params={"scale": 7, "octaves": 3, "erosion": .2}, masks=[LayerMask("slope", params={"min": .18, "max": 1, "falloff": .12})])],
    "graniteSpires": [_layer("fbm", "Valley Floor", strength=.28, params={"scale": .7, "octaves": 4, "persistence": .48, "erosion": .3, "warp": .3}), _layer("ridged", "Spire Clusters", strength=1.05, params={"scale": 2.6, "octaves": 6, "sharpness": 3.4, "erosion": .3, "warp": .65}, masks=[LayerMask("noise", params={"scale": .5, "threshold": .58, "softness": .14})]), _layer("fbm", "Talus & Scree", strength=.09, params={"scale": 6, "octaves": 3, "erosion": .15}, masks=[LayerMask("slope", params={"min": .22, "max": 1, "falloff": .1})])],
    "foothillRanges": [_layer("fbm", "Rolling Base", strength=.45, params={"scale": 1.1, "octaves": 5, "persistence": .47, "erosion": .35, "warp": .35}), _layer("domainWarp", "Flow Warp", strength=.5, params={"scale": 1.1, "octaves": 3}), _layer("ridged", "Mountain Belts", strength=.55, params={"scale": 1.6, "octaves": 5, "sharpness": 1.9, "erosion": .5, "warp": .3}, masks=[LayerMask("noise", params={"scale": .35, "threshold": .55, "softness": .2})]), _layer("fbm", "Soft Detail", strength=.05, params={"scale": 8, "octaves": 3, "erosion": .1})],
})


def apply_terrain_preset(settings: GenerationSettings, key: str) -> GenerationSettings:
    base = GenerationSettings.from_dict(settings.to_dict())
    defaults = GenerationSettings()
    for name in ("height", "formation_sea_level", "noise_scale", "noise_strength", "terrain_smoothing", "octaves", "persistence", "lacunarity", "ridge", "warp", "falloff", "moist_scale", "moist_bias", "biome_scale", "temp_bias"):
        setattr(base, name, getattr(defaults, name))
    for name, value in TERRAIN_PRESETS.get(key, {}).items():
        setattr(base, name, value)
    base.preset = key if key in TERRAIN_PRESETS else "highlands"
    return base


def apply_stack_preset(settings: GenerationSettings, key: str) -> GenerationSettings:
    if key not in STACK_PRESETS:
        return settings
    result = GenerationSettings.from_dict(settings.to_dict())
    result.layers = [NoiseLayer.from_dict(layer.to_dict()) for layer in STACK_PRESETS[key]]
    result.stack_preset = key
    if key == "geologicalHybrid":
        result.height, result.noise_scale, result.normalize_output = 620, 42, True
        result.output_min, result.output_max = .05, .92
    elif key == "alpineRanges":
        result.normalize_output, result.output_min, result.output_max = True, 0, 1.15
    elif key == "graniteSpires":
        result.normalize_output, result.output_min, result.output_max = True, 0, 1.25
    elif key == "foothillRanges":
        result.normalize_output, result.output_min, result.output_max = True, 0, 1.05
    return result


def _fract(value):
    return value - np.floor(value)


def _clamp01(value):
    return np.clip(value, 0.0, 1.0)


def _smoothstep(edge0, edge1, value):
    denominator = edge1 - edge0
    if abs(float(denominator)) < 1e-12:
        return np.where(value < edge0, 0.0, 1.0)
    t = np.clip((value - edge0) / denominator, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _imul32(a: int, b: int) -> int:
    return ((a & 0xFFFFFFFF) * (b & 0xFFFFFFFF)) & 0xFFFFFFFF


def seed_domain_offset(value: int | float) -> np.float32:
    seed = int(value)
    if not seed:
        return np.float32(0)
    hashed = seed & 0xFFFFFFFF
    hashed = _imul32(hashed ^ (hashed >> 16), 0x7FEB352D)
    hashed = _imul32(hashed ^ (hashed >> 15), 0x846CA68B)
    hashed = (hashed ^ (hashed >> 16)) & 0xFFFFFFFF
    return np.float32((hashed / 4294967296.0) * 2048.0 - 1024.0)


def _mulberry_offsets(seed: int) -> tuple[np.float32, np.float32]:
    state = seed & 0xFFFFFFFF
    values = []
    for _ in range(2):
        state = (state + 0x6D2B79F5) & 0xFFFFFFFF
        t = _imul32(state ^ (state >> 15), 1 | state)
        t = (t + _imul32(t ^ (t >> 7), 61 | t)) & 0xFFFFFFFF
        t = (t ^ (t >> 14)) & 0xFFFFFFFF
        values.append(np.float32((t / 4294967296.0) * 2048.0 - 1024.0))
    return values[0], values[1]


def hash12(x, y):
    x = np.asarray(x, dtype=np.float32)
    y = np.asarray(y, dtype=np.float32)
    p3x = _fract(x * np.float32(.1031)).astype(np.float32)
    p3y = _fract(y * np.float32(.1031)).astype(np.float32)
    p3z = p3x.copy()
    d = (p3x * (p3y + np.float32(33.33)) + p3y * (p3z + np.float32(33.33)) + p3z * (p3x + np.float32(33.33))).astype(np.float32)
    p3x, p3y, p3z = (p3x + d).astype(np.float32), (p3y + d).astype(np.float32), (p3z + d).astype(np.float32)
    return _fract((p3x + p3y) * p3z).astype(np.float32)


def vnoise2(x, y):
    x, y = np.asarray(x, dtype=np.float32), np.asarray(y, dtype=np.float32)
    ix, iy = np.floor(x), np.floor(y)
    fx, fy = (x - ix).astype(np.float32), (y - iy).astype(np.float32)
    ux = (fx * fx * fx * (fx * (fx * 6 - 15) + 10)).astype(np.float32)
    uy = (fy * fy * fy * (fy * (fy * 6 - 15) + 10)).astype(np.float32)
    a, b, c, d = hash12(ix, iy), hash12(ix + 1, iy), hash12(ix, iy + 1), hash12(ix + 1, iy + 1)
    top = a + (b - a) * ux
    bottom = c + (d - c) * ux
    return (top + (bottom - top) * uy).astype(np.float32)


def vnoised2(x, y):
    x, y = np.asarray(x, dtype=np.float32), np.asarray(y, dtype=np.float32)
    ix, iy = np.floor(x), np.floor(y)
    fx, fy = (x - ix).astype(np.float32), (y - iy).astype(np.float32)
    ux = (fx * fx * fx * (fx * (fx * 6 - 15) + 10)).astype(np.float32)
    uy = (fy * fy * fy * (fy * (fy * 6 - 15) + 10)).astype(np.float32)
    dux = (30 * fx * fx * (fx - 1) * (fx - 1)).astype(np.float32)
    duy = (30 * fy * fy * (fy - 1) * (fy - 1)).astype(np.float32)
    a, b, c, d = hash12(ix, iy), hash12(ix + 1, iy), hash12(ix, iy + 1), hash12(ix + 1, iy + 1)
    top, bottom = a + (b - a) * ux, c + (d - c) * ux
    value = top + (bottom - top) * uy
    derivative_x = ((b - a) + ((d - c) - (b - a)) * uy) * dux
    derivative_y = (bottom - top) * duy
    return value.astype(np.float32), derivative_x.astype(np.float32), derivative_y.astype(np.float32)


def _rot(x, y, lacunarity):
    return ((.8 * x + .6 * y) * lacunarity).astype(np.float32), ((-.6 * x + .8 * y) * lacunarity).astype(np.float32)


def fbm2(x, y, octaves=5, persistence=.5, lacunarity=2.0, erosion=0.0, warp=0.0):
    x, y = np.asarray(x, dtype=np.float32), np.asarray(y, dtype=np.float32)
    total = np.zeros(np.broadcast_shapes(x.shape, y.shape), dtype=np.float32)
    norm, amplitude = np.zeros_like(total), np.float32(.5)
    derivative_x = np.zeros_like(total)
    derivative_y = np.zeros_like(total)
    for _ in range(max(1, min(8, int(octaves)))):
        if erosion > 0 or warp > 0:
            value, dx, dy = vnoised2(x + derivative_x * warp, y + derivative_y * warp)
            damp = 1 / (1 + max(0, erosion) * 4 * (derivative_x * derivative_x + derivative_y * derivative_y))
            total += amplitude * value * damp
            norm += amplitude * damp
            derivative_x += dx * amplitude
            derivative_y += dy * amplitude
        else:
            total += amplitude * vnoise2(x, y)
            norm += amplitude
        amplitude *= np.float32(persistence)
        x, y = _rot(x, y, np.float32(lacunarity))
    return (total / np.maximum(norm, 1e-4)).astype(np.float32)


def ridged2(x, y, octaves=5, persistence=.5, lacunarity=2.0, sharpness=2.0, erosion=0.0, warp=0.0):
    x, y = np.asarray(x, dtype=np.float32), np.asarray(y, dtype=np.float32)
    total = np.zeros(np.broadcast_shapes(x.shape, y.shape), dtype=np.float32)
    carry = np.ones_like(total)
    norm, amplitude = np.zeros_like(total), np.float32(.5)
    derivative_x = np.zeros_like(total)
    derivative_y = np.zeros_like(total)
    for _ in range(max(1, min(8, int(octaves)))):
        raw_noise, dx, dy = vnoised2(x + derivative_x * warp, y + derivative_y * warp)
        raw = raw_noise * 2 - 1
        ridge = np.maximum(1 - np.abs(raw), 0)
        value = np.power(ridge, sharpness).astype(np.float32)
        damp = 1 / (1 + max(0, erosion) * 4 * (derivative_x * derivative_x + derivative_y * derivative_y))
        previous_carry = carry
        total += amplitude * value * previous_carry * damp
        norm += amplitude * damp
        sign = np.where(raw < 0, 1, -1)
        dscale = sign * 2 * sharpness * np.power(np.maximum(ridge, 1e-4), sharpness - 1) * amplitude * previous_carry
        derivative_x += dx * dscale
        derivative_y += dy * dscale
        carry = np.clip(value * 1.4, 0, 1)
        amplitude *= np.float32(persistence)
        x, y = _rot(x, y, np.float32(lacunarity))
    return (total / np.maximum(norm, 1e-4)).astype(np.float32)


def billow2(x, y, octaves=5, persistence=.5, lacunarity=2.0, erosion=0.0, warp=0.0):
    x, y = np.asarray(x, dtype=np.float32), np.asarray(y, dtype=np.float32)
    total = np.zeros(np.broadcast_shapes(x.shape, y.shape), dtype=np.float32)
    norm, amplitude = np.zeros_like(total), np.float32(.5)
    derivative_x = np.zeros_like(total)
    derivative_y = np.zeros_like(total)
    for _ in range(max(1, min(8, int(octaves)))):
        raw_noise, dx, dy = vnoised2(x + derivative_x * warp, y + derivative_y * warp)
        raw = raw_noise * 2 - 1
        damp = 1 / (1 + max(0, erosion) * 4 * (derivative_x * derivative_x + derivative_y * derivative_y))
        total += amplitude * np.abs(raw) * damp
        norm += amplitude * damp
        sign = np.where(raw < 0, -1, 1)
        derivative_x += sign * 2 * dx * amplitude
        derivative_y += sign * 2 * dy * amplitude
        amplitude *= np.float32(persistence)
        x, y = _rot(x, y, np.float32(lacunarity))
    return (total / np.maximum(norm, 1e-4)).astype(np.float32)


def climate_fbm3(x, y):
    """The legacy climate field's fixed 0.55/0.30/0.15 three-octave FBM."""
    x, y = np.asarray(x, dtype=np.float32), np.asarray(y, dtype=np.float32)
    value = vnoise2(x, y) * np.float32(.55)
    x, y = _rot(x, y, np.float32(2.13))
    value += vnoise2(x, y) * np.float32(.30)
    x, y = _rot(x, y, np.float32(2.13))
    value += vnoise2(x, y) * np.float32(.15)
    return value.astype(np.float32)


def _voronoi(x, y, jitter, distance_mode, output_mode):
    ix, iy = np.floor(x), np.floor(y)
    fx, fy = x - ix, y - iy
    f1, f2, cell = np.full_like(x, 8), np.full_like(x, 8), np.zeros_like(x)
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            rx = ox + hash12(ix + ox, iy + oy) * jitter - fx
            ry = oy + hash12(ix + ox + 41.3, iy + oy + 13.7) * jitter - fy
            if distance_mode == 0:
                distance = rx * rx + ry * ry
            elif distance_mode == 1:
                distance = np.abs(rx) + np.abs(ry)
            else:
                distance = np.maximum(np.abs(rx), np.abs(ry))
            closer = distance < f1
            f2 = np.where(closer, f1, np.where(distance < f2, distance, f2))
            f1 = np.where(closer, distance, f1)
            cell = np.where(closer, hash12(ix + ox + 7.1, iy + oy + 91.7), cell)
    d1, d2 = (np.sqrt(f1), np.sqrt(f2)) if distance_mode == 0 else (f1, f2)
    if output_mode == 0:
        return _clamp01(cell)
    if output_mode == 1:
        return _clamp01(d1)
    if output_mode == 2:
        return _clamp01(d2 - d1)
    return _clamp01(1 - (d2 - d1) * 3)


def _crater(x, y, density, depth, rim, rim_width):
    ix, iy = np.floor(x), np.floor(y)
    fx, fy = x - ix, y - iy
    best, random = np.full_like(x, 8), np.zeros_like(x)
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            dx = ox + hash12(ix + ox, iy + oy) - fx
            dy = oy + hash12(ix + ox + 23.7, iy + oy + 5.9) - fy
            distance = np.hypot(dx, dy)
            closer = distance < best
            best = np.where(closer, distance, best)
            random = np.where(closer, hash12(ix + ox + 61.1, iy + oy + 7.3), random)
    radius = .18 + .28 * hash12(ix + random * 17, iy + random * 17)
    t = best / np.maximum(radius, .02)
    bowl = -depth * (1 - _smoothstep(0, 1, t))
    rim_value = rim * np.exp(-np.power((t - 1) / max(rim_width, .02), 2))
    return np.where(random > density, 0, bowl + rim_value).astype(np.float32)


def _dune(x, y, params):
    dx, dy = math.cos(float(params["windDir"])), math.sin(float(params["windDir"]))
    across, along = x * -dy + y * dx, x * dx + y * dy
    warp = (vnoise2(x * .5, y * .5) - .5) * 2
    dunes = np.power(_clamp01(1 - np.abs(np.sin(across + warp))), max(float(params["sharpness"]), .1))
    ripples = (vnoise2(across * float(params["rippleScale"]), along * .3) - .5) * float(params["rippleStrength"])
    return _clamp01(dunes + ripples).astype(np.float32)


def _flow(x, y, params):
    dx, dy = math.cos(float(params["flowDir"])), math.sin(float(params["flowDir"]))
    along, across = x * dx + y * dy, x * -dy + y * dx
    across += (vnoise2(along * float(params["meanderScale"]), np.float32(13.1)) - .5) * float(params["meander"])
    return _clamp01(np.exp(-np.power(across / max(float(params["width"]), .02), 2))).astype(np.float32)


def _blend(mode: str, accumulated, value):
    if mode == "subtract": return accumulated - value
    if mode == "multiply": return accumulated * (1 + value)
    if mode == "divide": return accumulated / np.where(np.abs(value) < .001, np.sign(value + 1e-6) * .001, value)
    if mode == "max": return np.maximum(accumulated, value)
    if mode == "min": return np.minimum(accumulated, value)
    if mode == "replace": return value
    if mode == "difference": return np.abs(accumulated - value)
    if mode == "overlay": return np.where(accumulated < .5, 2 * accumulated * value, 1 - 2 * (1 - accumulated) * (1 - value))
    if mode == "carve": return accumulated - np.maximum(value, 0)
    if mode == "flatten": return accumulated + (value - accumulated) * np.minimum(np.abs(value), 1)
    return accumulated + value


class TerrainEvaluator:
    def __init__(self, settings: GenerationSettings):
        settings.validate()
        self.settings = settings
        self.seed_x, self.seed_y = _mulberry_offsets(settings.seed)
        cell_width = settings.width / settings.tiles_x
        cell_depth = settings.depth / settings.tiles_y
        self.frequency = np.float32((settings.noise_scale * .1) / max(cell_width, cell_depth))
        self._assembly_cache = None

    def _climate(self, px, py):
        s = self.settings
        bx, by = px * s.biome_scale, py * s.biome_scale
        cont = climate_fbm3(bx * .085 + 211.3, by * .085 + 57.9)
        temp = _clamp01(climate_fbm3(bx * .15 + 71.7, by * .15 + 313.1) * 1.5 - .25 + s.temp_bias)
        moist = _clamp01(climate_fbm3(bx * .13 * s.moist_scale + 91.7, by * .13 * s.moist_scale + 53.9) * 1.5 - .25 + s.moist_bias)
        erosion = climate_fbm3(bx * .19 + 157.1, by * .19 + 423.7)
        region = climate_fbm3(px * .7 + 631.4, py * .7 + 199.2)
        jitter = (region - .5) * .16
        hot = _smoothstep(.52, .74, temp + jitter)
        dry = _smoothstep(.55, .30, moist - jitter)
        wet = _smoothstep(.55, .78, moist + jitter)
        low = _smoothstep(.55, .32, cont)
        eroded = _smoothstep(.40, .70, erosion + jitter * .5)
        weights = np.stack((hot * dry * (1 - eroded * .55), dry * eroded * _smoothstep(.3, .55, cont), wet * low * (1 - hot * .4), _smoothstep(.38, .62, cont) * (1 - eroded * .7)))
        return cont, temp, moist, erosion, region, weights.astype(np.float32)

    def _legacy(self, world_x, world_y):
        s = self.settings
        px, py = world_x * self.frequency + self.seed_x, world_y * self.frequency + self.seed_y
        _, _, _, _, _, weights = self._climate(px, py)
        desert, canyon, wetland, mountains_weight = weights
        wx = fbm2(px + 13.7, py + 41.3, 4, s.persistence, s.lacunarity)
        wy = fbm2(px + 87.2, py + 9.1, 4, s.persistence, s.lacunarity)
        warp = s.warp * (1 - canyon * .5)
        qx, qy = px + (wx - .5) * warp, py + (wy - .5) * warp
        base = fbm2(qx, qy, s.octaves, s.persistence, s.lacunarity)
        height = base * (.30 * (1 - desert * .45) * (1 - wetland * .75)) + .06
        dune = 1 - np.abs(vnoise2(qx * 2.2 + qy * .4 + 311.7, qy * .8 + 89.1) * 2 - 1)
        height += dune * dune * .05 * desert
        ridge = ridged2(qx * 1.7 + 31.4, qy * 1.7 + 27.2, s.octaves, s.persistence, s.lacunarity, 2)
        ridge_shape = np.power(ridge, 1.35) * (1 - s.terrain_smoothing) + np.power(ridge, .62) * .58 * s.terrain_smoothing
        chain = _smoothstep(.34, .66, fbm2(qx * .35 + 5.1, qy * .35 + 17.7, 4, s.persistence, s.lacunarity))
        mountains = chain * (.35 + .65 * mountains_weight) * (1 - desert * .85) * (1 - wetland)
        height += ridge_shape * mountains * s.ridge * (1.15 * (1 - s.terrain_smoothing) + .82 * s.terrain_smoothing)
        sea = s.formation_sea_level / max(s.height, 1)
        height = height * (1 - wetland * .85) + (sea + .012 + base * .03) * wetland * .85
        t = height * 14
        terrace = (np.floor(t) + _smoothstep(.2, .8, _fract(t))) / 14
        return (height * (1 - canyon * .75) + terrace * canyon * .75).astype(np.float32)

    def _mask(self, layer: NoiseLayer, accumulated, px, py, slope=None):
        result = np.ones_like(accumulated, dtype=np.float32)
        for mask in (item for item in layer.masks if item.enabled):
            p = mask.params
            if mask.type == "height":
                value = _smoothstep(float(p.get("min", 0)) - float(p.get("falloff", .06)), float(p.get("min", 0)) + float(p.get("falloff", .06)), accumulated)
                value *= _smoothstep(float(p.get("max", 1.35)) + float(p.get("falloff", .06)), float(p.get("max", 1.35)) - float(p.get("falloff", .06)), accumulated)
            elif mask.type == "noise":
                scale, threshold, softness = float(p.get("scale", 1)), float(p.get("threshold", .5)), float(p.get("softness", .12))
                value = _smoothstep(threshold - softness, threshold + softness, vnoise2(px * scale + 53.2, py * scale + 11.7))
            elif mask.type == "slope" and slope is not None:
                falloff = float(p.get("falloff", .1))
                value = _smoothstep(float(p.get("min", 0)) - falloff, float(p.get("min", 0)) + falloff, slope)
                value *= _smoothstep(float(p.get("max", 1)) + falloff, float(p.get("max", 1)) - falloff, slope)
            elif mask.type == "biome":
                weights = self._climate(px, py)[5]
                value = weights[max(0, min(3, int(p.get("biome", 0))))]
            else:
                value = 1
            result *= (1 - value) if mask.invert else value
        return _clamp01(result)

    def _evaluate_stack(self, world_x, world_y, include_slope=True):
        px, py = world_x * self.frequency + self.seed_x, world_y * self.frequency + self.seed_y
        accumulated = np.zeros(np.broadcast_shapes(np.shape(px), np.shape(py)), dtype=np.float32)
        for layer in [item for item in self.settings.layers if item.enabled][:MAX_LAYERS]:
            effective = np.float32(layer.strength * layer.opacity)
            params = {**DEFAULT_LAYER_PARAMS[layer.type], **layer.params}
            if layer.type == "domainWarp":
                scale, octaves = float(params["scale"]), int(params["octaves"])
                wx = fbm2(px * scale + 13.7, py * scale + 41.3, octaves, .5, 2)
                wy = fbm2(px * scale + 87.2, py * scale + 9.1, octaves, .5, 2)
                px, py = px + (wx - .5) * effective, py + (wy - .5) * effective
                continue
            slope = None
            if include_slope and accumulated.ndim >= 2 and any(mask.enabled and mask.type == "slope" for mask in layer.masks):
                gradient_y, gradient_x = np.gradient(accumulated, self.settings.depth / max(accumulated.shape[0] - 1, 1), self.settings.width / max(accumulated.shape[-1] - 1, 1))
                slope = np.hypot(gradient_x, gradient_y) * self.settings.height
            mask = self._mask(layer, accumulated, px, py, slope)
            if layer.type == "terrace":
                steps = max(1, float(params["count"]))
                t = accumulated * steps
                smooth = float(params["smoothness"])
                terraced = (np.floor(t) + _smoothstep(.5 - smooth * .5, .5 + smooth * .5, _fract(t))) / steps
                accumulated += (terraced - accumulated) * effective * mask
                continue
            seed = seed_domain_offset(layer.seed_offset)
            scale = float(params.get("scale", 1))
            lx, ly = px * scale + seed, py * scale + seed * 1.7 + 3.1
            if layer.type == "legacy": value = self._legacy(world_x, world_y)
            elif layer.type == "fbm": value = fbm2(lx, ly, params["octaves"], params["persistence"], params["lacunarity"], params["erosion"], params["warp"])
            elif layer.type == "ridged": value = ridged2(lx, ly, params["octaves"], params["persistence"], params["lacunarity"], params["sharpness"], params["erosion"], params["warp"])
            elif layer.type == "billow": value = billow2(lx, ly, params["octaves"], params["persistence"], params["lacunarity"], params["erosion"], params["warp"])
            elif layer.type == "value": value = vnoise2(lx, ly)
            elif layer.type == "white":
                block = hash12(np.floor(lx) + .5, np.floor(ly) + .5)
                value = block + (vnoise2(lx, ly) - block) * float(params["smoothing"])
            elif layer.type == "constant": value = np.full_like(accumulated, float(params["value"]))
            elif layer.type == "voronoi": value = _voronoi(lx, ly, float(params["jitter"]), int(params["distanceMode"]), int(params["outputMode"]))
            elif layer.type == "crater": value = _crater(lx, ly, float(params["density"]), float(params["depth"]), float(params["rim"]), float(params["rimWidth"]))
            elif layer.type == "dune": value = _dune(lx, ly, params)
            elif layer.type == "flow": value = _flow(lx, ly, params)
            else: value = 0
            accumulated = _blend(layer.blend_mode, accumulated, value * effective * mask).astype(np.float32)
        return accumulated * np.float32(self.settings.noise_strength)

    def sample(self, world_x, world_y):
        height = self._evaluate_stack(np.asarray(world_x, dtype=np.float32), np.asarray(world_y, dtype=np.float32))
        smoothing = np.clip(self.settings.terrain_smoothing, 0, 1)
        if smoothing > .0001:
            normalized = np.clip(height / 1.35, 0, 1)
            peak = np.maximum(normalized - .42, 0)
            peak_mask = _smoothstep(.42, .72, normalized)
            compressed = .42 + peak / (1 + smoothing * 3.2 * peak / .58)
            height = height * (1 - peak_mask * smoothing) + compressed * 1.35 * peak_mask * smoothing
        if self.settings.falloff > 0:
            ex, ey = np.abs(np.asarray(world_x)) / (self.settings.width * .5), np.abs(np.asarray(world_y)) / (self.settings.depth * .5)
            if self.settings.tiles_x > 1 or self.settings.tiles_y > 1:
                distance_x = self.settings.width * .5 - np.abs(np.asarray(world_x))
                distance_y = self.settings.depth * .5 - np.abs(np.asarray(world_y))
                band_x = self.settings.falloff * (self.settings.width / self.settings.tiles_x)
                band_y = self.settings.falloff * (self.settings.depth / self.settings.tiles_y)
                rim = _smoothstep(0, band_x, distance_x) * _smoothstep(0, band_y, distance_y)
            else:
                edge = np.maximum(ex, ey) * .5 + np.hypot(ex, ey) * .7071 * .5
                rim = _smoothstep(0, 1, np.clip((1 - edge) / self.settings.falloff, 0, 1))
            if self.settings.edge_falloff_mode == "mountains":
                px = np.asarray(world_x, dtype=np.float32) * self.frequency + self.seed_x + 173.7
                py = np.asarray(world_y, dtype=np.float32) * self.frequency + self.seed_y + 419.2
                mountains = np.power(ridged2(px * 2.35, py * 2.35, self.settings.octaves, self.settings.persistence, self.settings.lacunarity, 2), 1.25)
                breakup = vnoise2(px * 5.1 + 61.4, py * 5.1 + 27.8)
                height += (mountains * .55 + breakup * .12) * (1 - rim) * self.settings.noise_strength * self.settings.falloff
            else:
                height *= rim
        if self.settings.normalize_output:
            value = (height - self.settings.output_min) / max(self.settings.output_max - self.settings.output_min, .0001)
            height = np.where(value <= 0, 0, np.where(value <= 1, value, np.minimum(1.35, 1 + .35 * (1 - np.exp(-(value - 1) / .35)))))
        else:
            height = np.clip(height, 0, 1.35)
        return (height * self.settings.height).astype(np.float32)

    def tile_grid(self, tile_x: int, tile_y: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        resolution = self.settings.resolution
        tile_width, tile_depth = self.settings.width / self.settings.tiles_x, self.settings.depth / self.settings.tiles_y
        if self._assembly_cache is None:
            columns = self.settings.tiles_x * (resolution - 1) + 1
            rows = self.settings.tiles_y * (resolution - 1) + 1
            xs = np.linspace(-self.settings.width * .5, self.settings.width * .5, columns, dtype=np.float32)
            ys = np.linspace(-self.settings.depth * .5, self.settings.depth * .5, rows, dtype=np.float32)
            full_x, full_y = np.meshgrid(xs, ys)
            self._assembly_cache = (xs, ys, self.sample(full_x, full_y))
        xs, ys, full_height = self._assembly_cache
        x0, y0 = tile_x * (resolution - 1), tile_y * (resolution - 1)
        tile_xs = xs[x0:x0 + resolution]
        tile_ys = ys[y0:y0 + resolution]
        grid_x, grid_y = np.meshgrid(tile_xs, tile_ys)
        return grid_x, grid_y, full_height[y0:y0 + resolution, x0:x0 + resolution]
