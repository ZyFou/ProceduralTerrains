"""Blender operators and persistent scene settings."""

from __future__ import annotations

import traceback

import bpy
from bpy.props import (
    BoolProperty, CollectionProperty, EnumProperty, FloatProperty, IntProperty,
    PointerProperty, StringProperty,
)
from bpy.types import Operator, PropertyGroup
from bpy_extras.io_utils import ImportHelper

from .archive import TerrainPackageError, open_project_source
from .builder import BuildOptions, build_project
from .generation import (
    BLEND_MODES, LAYER_TYPES, GenerationSettings, LayerMask, NoiseLayer,
    STACK_PRESETS, TERRAIN_PRESETS, apply_stack_preset, apply_terrain_preset,
)
from .generation_builder import build_generated_terrain, generated_collection_from_context
from .heightfield import HeightfieldError
from .runtime_document import TerrainDocumentError, read_document


MESH_RESOLUTION_ITEMS = (
    ("AUTO", "Automatic (up to 513)", "Keep source detail up to 513 x 513 vertices per tile"),
    ("129", "129 x 129", "Fast preview mesh"),
    ("257", "257 x 257", "Medium detail mesh"),
    ("513", "513 x 513", "Recommended editable mesh"),
    ("1025", "1025 x 1025", "High detail mesh; may be slow"),
    ("FULL", "Full source resolution", "Use every source sample; large grids can be extremely heavy"),
)
GEN_RESOLUTION_ITEMS = tuple((str(value), f"{value} x {value}", f"{value * value:,} vertices per tile") for value in (65, 129, 257, 513, 1025))
PLACEMENT_ITEMS = (("ORIGIN", "World Origin", "Center the terrain at the world origin"), ("CURSOR", "3D Cursor", "Center the terrain at the 3D cursor"))
LAYER_TYPE_ITEMS = tuple((item, item.replace("domainWarp", "Domain Warp").replace("fbm", "FBM").title(), "") for item in LAYER_TYPES)
BLEND_ITEMS = tuple((item, item.title(), "") for item in BLEND_MODES)
TERRAIN_PRESET_ITEMS = tuple((key, key.replace("archipelago", "Archipelago").replace("highlands", "Highlands").replace("rolling", "Rolling Hills").replace("volcanic", "Volcanic Island").replace("canyon", "Canyonlands").replace("cartoon", "Cartoon").replace("alpine", "Alpine Peaks").replace("dunes", "Desert Dunes"), "") for key in TERRAIN_PRESETS)
STACK_PRESET_ITEMS = tuple((key, "".join((" " + ch if ch.isupper() else ch) for ch in key).strip().title(), "") for key in STACK_PRESETS)


class PTRTERRAIN_PG_layer(PropertyGroup):
    name: StringProperty(name="Name", default="FBM Layer")
    enabled: BoolProperty(name="Enabled", default=True)
    layer_type: EnumProperty(name="Type", items=LAYER_TYPE_ITEMS, default="fbm")
    blend_mode: EnumProperty(name="Blend", items=BLEND_ITEMS, default="add")
    strength: FloatProperty(name="Strength", default=.4, min=-4, max=4)
    opacity: FloatProperty(name="Opacity", default=1, min=0, max=1)
    seed_offset: IntProperty(name="Seed Offset", default=0)
    scale: FloatProperty(name="Scale", default=1, min=.01, max=100)
    octaves: IntProperty(name="Octaves", default=5, min=1, max=8)
    persistence: FloatProperty(name="Persistence", default=.5, min=.05, max=.95)
    lacunarity: FloatProperty(name="Lacunarity", default=2, min=1.01, max=4)
    erosion: FloatProperty(name="Erosion", default=0, min=0, max=1)
    warp: FloatProperty(name="Self Warp", default=0, min=0, max=1.5)
    sharpness: FloatProperty(name="Sharpness", default=2, min=.1, max=8)
    interp: IntProperty(name="Interpolation", default=2, min=0, max=2)
    smoothing: FloatProperty(name="Smoothing", default=0, min=0, max=1)
    constant_value: FloatProperty(name="Value", default=.1, min=-2, max=2)
    jitter: FloatProperty(name="Jitter", default=1, min=0, max=1)
    distance_mode: IntProperty(name="Distance Mode", default=0, min=0, max=2)
    output_mode: IntProperty(name="Output Mode", default=2, min=0, max=3)
    density: FloatProperty(name="Density", default=.55, min=0, max=1)
    depth: FloatProperty(name="Depth", default=.6, min=0, max=1.5)
    rim: FloatProperty(name="Rim Height", default=.3, min=0, max=1)
    rim_width: FloatProperty(name="Rim Width", default=.35, min=.02, max=1)
    direction: FloatProperty(name="Direction", default=.7, min=0, max=6.283)
    ripple_scale: FloatProperty(name="Ripple Scale", default=4, min=.5, max=12)
    ripple_strength: FloatProperty(name="Ripple Strength", default=.12, min=0, max=.6)
    width: FloatProperty(name="Channel Width", default=.3, min=.02, max=1.5)
    meander: FloatProperty(name="Meander", default=1.2, min=0, max=4)
    meander_scale: FloatProperty(name="Meander Scale", default=.6, min=.05, max=3)
    terrace_count: IntProperty(name="Terrace Count", default=12, min=2, max=40)
    terrace_smoothness: FloatProperty(name="Terrace Smoothness", default=.5, min=.02, max=1)
    use_height_mask: BoolProperty(name="Height Mask", default=False)
    height_mask_invert: BoolProperty(name="Invert", default=False)
    height_mask_min: FloatProperty(name="Minimum", default=0)
    height_mask_max: FloatProperty(name="Maximum", default=1.35)
    height_mask_falloff: FloatProperty(name="Falloff", default=.06, min=0, max=1)
    use_noise_mask: BoolProperty(name="Noise Mask", default=False)
    noise_mask_invert: BoolProperty(name="Invert", default=False)
    noise_mask_scale: FloatProperty(name="Scale", default=1, min=.01, max=100)
    noise_mask_threshold: FloatProperty(name="Threshold", default=.5, min=0, max=1)
    noise_mask_softness: FloatProperty(name="Softness", default=.12, min=0, max=1)
    use_slope_mask: BoolProperty(name="Slope Mask", default=False)
    slope_mask_invert: BoolProperty(name="Invert", default=False)
    slope_mask_min: FloatProperty(name="Minimum", default=0, min=0)
    slope_mask_max: FloatProperty(name="Maximum", default=1, min=0)
    slope_mask_falloff: FloatProperty(name="Falloff", default=.1, min=0, max=10)
    use_biome_mask: BoolProperty(name="Biome Mask", default=False)
    biome_mask_invert: BoolProperty(name="Invert", default=False)
    biome_mask_biome: EnumProperty(name="Biome", items=(("0", "Desert", ""), ("1", "Canyon", ""), ("2", "Wetland", ""), ("3", "Mountains", "")), default="0")


class PTRTERRAIN_PG_settings(PropertyGroup):
    workflow: EnumProperty(name="Workflow", items=(("CREATE", "Create", "Generate native terrain"), ("IMPORT", "Import", "Import a terrain package")), default="CREATE")
    source_path: StringProperty(name="Terrain package", description="Procedural Terrains ZIP or project.ptrterrain file", subtype="FILE_PATH")
    mesh_resolution: EnumProperty(name="Mesh detail", items=MESH_RESOLUTION_ITEMS, default="AUTO")
    create_materials: BoolProperty(name="Create baked materials", default=True)
    smooth_shading: BoolProperty(name="Smooth shading", default=True)
    pack_images: BoolProperty(name="Pack texture images", default=True)
    select_imported: BoolProperty(name="Select imported tiles", default=True)
    dimension_mode: EnumProperty(name="Dimensions", items=(("SOURCE", "Source Dimensions", "Keep exported dimensions"), ("CUSTOM", "Custom Dimensions", "Scale to a custom total width and depth")), default="SOURCE")
    target_width: FloatProperty(name="Total Width", default=1000, min=.001, subtype="DISTANCE", unit="LENGTH")
    target_depth: FloatProperty(name="Total Depth", default=1000, min=.001, subtype="DISTANCE", unit="LENGTH")
    vertical_scale: FloatProperty(name="Vertical Scale", default=1, min=.001, max=1000)
    import_placement: EnumProperty(name="Placement", items=PLACEMENT_ITEMS, default="ORIGIN")
    last_status: StringProperty(name="Last operation")
    last_collection: StringProperty(name="Collection")
    last_warning_count: StringProperty(name="Warnings", default="0")
    gen_preset: EnumProperty(name="Terrain Preset", items=TERRAIN_PRESET_ITEMS, default="highlands")
    gen_stack_preset: EnumProperty(name="Stack Preset", items=STACK_PRESET_ITEMS, default="classic")
    gen_seed: IntProperty(name="Seed", default=1337)
    gen_width: FloatProperty(name="Width", default=1000, min=.001, subtype="DISTANCE", unit="LENGTH")
    gen_depth: FloatProperty(name="Depth", default=1000, min=.001, subtype="DISTANCE", unit="LENGTH")
    gen_height: FloatProperty(name="Maximum Height", default=560, min=.001, subtype="DISTANCE", unit="LENGTH")
    gen_tiles_x: IntProperty(name="Tiles X", default=1, min=1, max=16)
    gen_tiles_y: IntProperty(name="Tiles Y", default=1, min=1, max=16)
    gen_resolution: EnumProperty(name="Resolution", items=GEN_RESOLUTION_ITEMS, default="257")
    gen_placement: EnumProperty(name="Placement", items=PLACEMENT_ITEMS, default="ORIGIN")
    gen_smooth_shading: BoolProperty(name="Smooth Shading", default=True)
    gen_create_material: BoolProperty(name="Height/Slope Preview Material", default=True)
    gen_noise_scale: FloatProperty(name="Noise Scale", default=45, min=.01, max=1000)
    gen_noise_strength: FloatProperty(name="Noise Strength", default=1, min=0, max=4)
    gen_terrain_smoothing: FloatProperty(name="Terrain Smoothing", default=0, min=0, max=1)
    gen_octaves: IntProperty(name="Classic Octaves", default=7, min=1, max=8)
    gen_persistence: FloatProperty(name="Persistence", default=.5, min=.05, max=.95)
    gen_lacunarity: FloatProperty(name="Lacunarity", default=2.05, min=1.01, max=4)
    gen_ridge: FloatProperty(name="Classic Ridge", default=.65, min=0, max=2)
    gen_warp: FloatProperty(name="Classic Warp", default=.9, min=0, max=4)
    gen_falloff: FloatProperty(name="Edge Falloff", default=.2, min=0, max=1)
    gen_edge_mode: EnumProperty(name="Edge Profile", items=(("island", "Island", "Fade to zero"), ("mountains", "Mountain Rim", "Mountainous perimeter")), default="island")
    gen_formation_sea_level: FloatProperty(name="Formation Sea Level", default=100)
    gen_moist_scale: FloatProperty(name="Moisture Scale", default=1, min=.01, max=4)
    gen_moist_bias: FloatProperty(name="Moisture Bias", default=0, min=-1, max=1)
    gen_biome_scale: FloatProperty(name="Biome Scale", default=1, min=.01, max=4)
    gen_temp_bias: FloatProperty(name="Temperature Bias", default=0, min=-1, max=1)
    gen_normalize: BoolProperty(name="Normalize Stack Output", default=False)
    gen_output_min: FloatProperty(name="Output Minimum", default=0)
    gen_output_max: FloatProperty(name="Output Maximum", default=1.35)
    show_advanced: BoolProperty(name="Advanced Noise Stack", default=False)
    layers: CollectionProperty(type=PTRTERRAIN_PG_layer)
    active_layer_index: IntProperty(default=0, min=0)


def _layer_params(item) -> dict:
    kind = item.layer_type
    if kind in {"fbm", "ridged", "billow"}:
        result = {"scale": item.scale, "octaves": item.octaves, "persistence": item.persistence, "lacunarity": item.lacunarity, "erosion": item.erosion, "warp": item.warp}
        if kind == "ridged": result["sharpness"] = item.sharpness
        return result
    if kind == "value": return {"scale": item.scale, "interp": item.interp}
    if kind == "white": return {"scale": item.scale, "smoothing": item.smoothing}
    if kind == "constant": return {"value": item.constant_value}
    if kind == "voronoi": return {"scale": item.scale, "jitter": item.jitter, "distanceMode": item.distance_mode, "outputMode": item.output_mode}
    if kind == "crater": return {"scale": item.scale, "density": item.density, "depth": item.depth, "rim": item.rim, "rimWidth": item.rim_width}
    if kind == "dune": return {"scale": item.scale, "windDir": item.direction, "sharpness": item.sharpness, "rippleScale": item.ripple_scale, "rippleStrength": item.ripple_strength}
    if kind == "flow": return {"scale": item.scale, "flowDir": item.direction, "width": item.width, "meander": item.meander, "meanderScale": item.meander_scale}
    if kind == "domainWarp": return {"scale": item.scale, "octaves": item.octaves}
    if kind == "terrace": return {"count": item.terrace_count, "smoothness": item.terrace_smoothness}
    return {}


def _layer_masks(item) -> list[LayerMask]:
    masks = []
    if item.use_height_mask: masks.append(LayerMask("height", True, item.height_mask_invert, {"min": item.height_mask_min, "max": item.height_mask_max, "falloff": item.height_mask_falloff}))
    if item.use_noise_mask: masks.append(LayerMask("noise", True, item.noise_mask_invert, {"scale": item.noise_mask_scale, "threshold": item.noise_mask_threshold, "softness": item.noise_mask_softness}))
    if item.use_slope_mask: masks.append(LayerMask("slope", True, item.slope_mask_invert, {"min": item.slope_mask_min, "max": item.slope_mask_max, "falloff": item.slope_mask_falloff}))
    if item.use_biome_mask: masks.append(LayerMask("biome", True, item.biome_mask_invert, {"biome": int(item.biome_mask_biome)}))
    return masks


def generation_from_scene(settings) -> GenerationSettings:
    layers = [NoiseLayer(item.layer_type, item.name, item.enabled, item.blend_mode, item.strength, item.opacity, item.seed_offset, _layer_params(item), _layer_masks(item)) for item in settings.layers]
    if not layers: layers = [NoiseLayer.make("legacy", name="Classic Terrain")]
    return GenerationSettings(
        preset=settings.gen_preset, stack_preset=settings.gen_stack_preset,
        seed=settings.gen_seed, width=settings.gen_width, depth=settings.gen_depth,
        height=settings.gen_height, tiles_x=settings.gen_tiles_x, tiles_y=settings.gen_tiles_y,
        resolution=int(settings.gen_resolution), placement=settings.gen_placement,
        smooth_shading=settings.gen_smooth_shading, create_material=settings.gen_create_material,
        noise_scale=settings.gen_noise_scale, noise_strength=settings.gen_noise_strength,
        terrain_smoothing=settings.gen_terrain_smoothing, octaves=settings.gen_octaves,
        persistence=settings.gen_persistence, lacunarity=settings.gen_lacunarity,
        ridge=settings.gen_ridge, warp=settings.gen_warp, falloff=settings.gen_falloff,
        edge_falloff_mode=settings.gen_edge_mode,
        formation_sea_level=settings.gen_formation_sea_level,
        moist_scale=settings.gen_moist_scale, moist_bias=settings.gen_moist_bias,
        biome_scale=settings.gen_biome_scale, temp_bias=settings.gen_temp_bias,
        normalize_output=settings.gen_normalize, output_min=settings.gen_output_min,
        output_max=settings.gen_output_max, layers=layers,
    )


def _set_layer_item(item, layer: NoiseLayer) -> None:
    item.name, item.enabled, item.layer_type = layer.name, layer.enabled, layer.type
    item.blend_mode, item.strength, item.opacity, item.seed_offset = layer.blend_mode, layer.strength, layer.opacity, layer.seed_offset
    mapping = {"scale": "scale", "octaves": "octaves", "persistence": "persistence", "lacunarity": "lacunarity", "erosion": "erosion", "warp": "warp", "sharpness": "sharpness", "interp": "interp", "smoothing": "smoothing", "value": "constant_value", "jitter": "jitter", "distanceMode": "distance_mode", "outputMode": "output_mode", "density": "density", "depth": "depth", "rim": "rim", "rimWidth": "rim_width", "windDir": "direction", "flowDir": "direction", "rippleScale": "ripple_scale", "rippleStrength": "ripple_strength", "width": "width", "meander": "meander", "meanderScale": "meander_scale", "count": "terrace_count", "smoothness": "terrace_smoothness"}
    for key, value in layer.params.items():
        if key in mapping: setattr(item, mapping[key], value)
    for mask in layer.masks:
        if mask.type == "height": item.use_height_mask, item.height_mask_invert = True, mask.invert; item.height_mask_min = mask.params.get("min", 0); item.height_mask_max = mask.params.get("max", 1.35); item.height_mask_falloff = mask.params.get("falloff", .06)
        elif mask.type == "noise": item.use_noise_mask, item.noise_mask_invert = True, mask.invert; item.noise_mask_scale = mask.params.get("scale", 1); item.noise_mask_threshold = mask.params.get("threshold", .5); item.noise_mask_softness = mask.params.get("softness", .12)
        elif mask.type == "slope": item.use_slope_mask, item.slope_mask_invert = True, mask.invert; item.slope_mask_min = mask.params.get("min", 0); item.slope_mask_max = mask.params.get("max", 1); item.slope_mask_falloff = mask.params.get("falloff", .1)
        elif mask.type == "biome": item.use_biome_mask, item.biome_mask_invert = True, mask.invert; item.biome_mask_biome = str(mask.params.get("biome", 0))


def load_generation_to_scene(target, source: GenerationSettings) -> None:
    mapping = {
        "preset": "gen_preset", "stack_preset": "gen_stack_preset", "seed": "gen_seed",
        "width": "gen_width", "depth": "gen_depth", "height": "gen_height",
        "tiles_x": "gen_tiles_x", "tiles_y": "gen_tiles_y", "placement": "gen_placement",
        "smooth_shading": "gen_smooth_shading", "create_material": "gen_create_material",
        "noise_scale": "gen_noise_scale", "noise_strength": "gen_noise_strength",
        "terrain_smoothing": "gen_terrain_smoothing", "octaves": "gen_octaves",
        "persistence": "gen_persistence", "lacunarity": "gen_lacunarity", "ridge": "gen_ridge",
        "warp": "gen_warp", "falloff": "gen_falloff", "edge_falloff_mode": "gen_edge_mode",
        "formation_sea_level": "gen_formation_sea_level", "moist_scale": "gen_moist_scale",
        "moist_bias": "gen_moist_bias", "biome_scale": "gen_biome_scale", "temp_bias": "gen_temp_bias",
        "normalize_output": "gen_normalize", "output_min": "gen_output_min", "output_max": "gen_output_max",
    }
    for source_name, target_name in mapping.items(): setattr(target, target_name, getattr(source, source_name))
    target.gen_resolution = str(source.resolution)
    target.layers.clear()
    for layer in source.layers: _set_layer_item(target.layers.add(), layer)
    target.active_layer_index = min(target.active_layer_index, max(0, len(target.layers) - 1))


class PTRTERRAIN_OT_generate(Operator):
    bl_idname = "ptrterrain.generate"
    bl_label = "Generate Terrain"
    bl_options = {"REGISTER", "UNDO"}
    regenerate: BoolProperty(default=False, options={"HIDDEN"})

    def execute(self, context):
        scene_settings = context.scene.ptrterrain_settings
        try:
            generation = generation_from_scene(scene_settings)
            collection = generated_collection_from_context(context) if self.regenerate else None
            if self.regenerate and collection is None:
                self.report({"ERROR"}, "Select an object in a generated terrain collection.")
                return {"CANCELLED"}
            result = build_generated_terrain(context, generation, collection)
            scene_settings.last_collection = result.collection.name
            scene_settings.last_warning_count = "0"
            scene_settings.last_status = f"Generated {len(result.objects)} tile(s)"
            self.report({"INFO"}, scene_settings.last_status)
            return {"FINISHED"}
        except (ValueError, RuntimeError, MemoryError) as exc:
            scene_settings.last_status = "Generation failed"
            self.report({"ERROR"}, str(exc)[:1000])
            traceback.print_exc()
            return {"CANCELLED"}


class PTRTERRAIN_OT_load_generated(Operator):
    bl_idname = "ptrterrain.load_generated_settings"
    bl_label = "Load Selected Settings"
    bl_options = {"REGISTER", "UNDO"}
    def execute(self, context):
        collection = generated_collection_from_context(context)
        if collection is None or not collection.get("ptr_generation_json"):
            self.report({"ERROR"}, "Select an object in a generated terrain collection.")
            return {"CANCELLED"}
        load_generation_to_scene(context.scene.ptrterrain_settings, GenerationSettings.from_json(collection["ptr_generation_json"]))
        self.report({"INFO"}, f"Loaded settings from {collection.name}")
        return {"FINISHED"}


class PTRTERRAIN_OT_apply_preset(Operator):
    bl_idname = "ptrterrain.apply_preset"
    bl_label = "Apply Preset"
    stack: BoolProperty(default=False, options={"HIDDEN"})
    def execute(self, context):
        target = context.scene.ptrterrain_settings
        source = generation_from_scene(target)
        source = apply_stack_preset(source, target.gen_stack_preset) if self.stack else apply_terrain_preset(source, target.gen_preset)
        load_generation_to_scene(target, source)
        return {"FINISHED"}


class PTRTERRAIN_OT_layer(Operator):
    bl_idname = "ptrterrain.layer_action"
    bl_label = "Edit Terrain Layer"
    action: EnumProperty(items=(("ADD", "Add", ""), ("DUPLICATE", "Duplicate", ""), ("REMOVE", "Remove", ""), ("UP", "Move Up", ""), ("DOWN", "Move Down", "")))
    def execute(self, context):
        settings, layers = context.scene.ptrterrain_settings, context.scene.ptrterrain_settings.layers
        index = min(settings.active_layer_index, max(0, len(layers) - 1))
        if self.action == "ADD" and len(layers) < 12:
            item = layers.add(); _set_layer_item(item, NoiseLayer.make("fbm", name="FBM Layer")); settings.active_layer_index = len(layers) - 1
        elif self.action == "DUPLICATE" and layers and len(layers) < 12:
            source = generation_from_scene(settings).layers[index]; item = layers.add(); _set_layer_item(item, source); item.name = f"{source.name} Copy"; settings.active_layer_index = len(layers) - 1
        elif self.action == "REMOVE" and layers: layers.remove(index); settings.active_layer_index = min(index, max(0, len(layers) - 1))
        elif self.action == "UP" and index > 0: layers.move(index, index - 1); settings.active_layer_index = index - 1
        elif self.action == "DOWN" and index < len(layers) - 1: layers.move(index, index + 1); settings.active_layer_index = index + 1
        return {"FINISHED"}


class PTRTERRAIN_OT_import(Operator, ImportHelper):
    bl_idname = "ptrterrain.import_package"
    bl_label = "Import Procedural Terrain"
    bl_description = "Validate a Procedural Terrains package and build editable Blender terrain meshes"
    bl_options = {"REGISTER", "UNDO"}
    filename_ext = ""
    filter_glob: StringProperty(default="*.zip;*.ptrterrain", options={"HIDDEN"})
    check_extension = False
    use_scene_settings: BoolProperty(default=False, options={"HIDDEN", "SKIP_SAVE"})
    mesh_resolution: EnumProperty(name="Mesh detail", items=MESH_RESOLUTION_ITEMS, default="AUTO")
    create_materials: BoolProperty(name="Create baked materials", default=True)
    smooth_shading: BoolProperty(name="Smooth shading", default=True)
    pack_images: BoolProperty(name="Pack texture images", default=True)
    select_imported: BoolProperty(name="Select imported tiles", default=True)
    dimension_mode: EnumProperty(name="Dimensions", items=(("SOURCE", "Source Dimensions", ""), ("CUSTOM", "Custom Dimensions", "")), default="SOURCE")
    target_width: FloatProperty(name="Total Width", default=1000, min=.001, unit="LENGTH")
    target_depth: FloatProperty(name="Total Depth", default=1000, min=.001, unit="LENGTH")
    vertical_scale: FloatProperty(name="Vertical Scale", default=1, min=.001)
    placement: EnumProperty(name="Placement", items=PLACEMENT_ITEMS, default="ORIGIN")

    def invoke(self, context, event):
        settings = context.scene.ptrterrain_settings
        if self.use_scene_settings and settings.source_path: return self.execute(context)
        return ImportHelper.invoke(self, context, event)

    def draw(self, context):
        layout = self.layout
        layout.prop(self, "mesh_resolution"); layout.prop(self, "dimension_mode")
        if self.dimension_mode == "CUSTOM": layout.prop(self, "target_width"); layout.prop(self, "target_depth")
        layout.prop(self, "vertical_scale"); layout.prop(self, "placement")
        for name in ("create_materials", "smooth_shading", "pack_images", "select_imported"): layout.prop(self, name)
        if self.mesh_resolution == "FULL": layout.label(text="Full grids can consume substantial memory", icon="ERROR")

    def execute(self, context):
        settings = context.scene.ptrterrain_settings
        if self.use_scene_settings:
            source_path = bpy.path.abspath(settings.source_path)
            options = BuildOptions(settings.mesh_resolution, settings.create_materials, settings.smooth_shading, settings.pack_images, settings.select_imported, settings.dimension_mode, settings.target_width, settings.target_depth, settings.vertical_scale, settings.import_placement)
        else:
            source_path = self.filepath
            options = BuildOptions(self.mesh_resolution, self.create_materials, self.smooth_shading, self.pack_images, self.select_imported, self.dimension_mode, self.target_width, self.target_depth, self.vertical_scale, self.placement)
        if not source_path:
            self.report({"ERROR"}, "Select a Procedural Terrains ZIP or .ptrterrain file."); return {"CANCELLED"}
        try:
            with open_project_source(source_path) as source:
                document, _ = read_document(source.document_path)
                if source.from_archive and options.create_materials and not options.pack_images:
                    options = BuildOptions(**{**options.__dict__, "pack_images": True})
                result = build_project(context, document, source.document_path.parent, str(source.source_path), options)
            settings.source_path, settings.last_collection = source_path, result.collection.name
            settings.last_warning_count, settings.last_status = str(len(result.warnings)), f"Imported {len(result.objects)} tile(s)"
            if result.warnings:
                self.report({"WARNING"}, f"Imported with {len(result.warnings)} warning(s). See the System Console.")
                for warning in result.warnings: print(f"[Procedural Terrains] Warning: {warning}")
            else: self.report({"INFO"}, settings.last_status)
            return {"FINISHED"}
        except (TerrainPackageError, TerrainDocumentError, HeightfieldError, OSError, ValueError, RuntimeError) as exc:
            settings.last_status = "Import failed"; self.report({"ERROR"}, (str(exc).splitlines()[0] if str(exc) else exc.__class__.__name__)[:1000]); traceback.print_exc(); return {"CANCELLED"}


CLASSES = (PTRTERRAIN_PG_layer, PTRTERRAIN_PG_settings, PTRTERRAIN_OT_generate, PTRTERRAIN_OT_load_generated, PTRTERRAIN_OT_apply_preset, PTRTERRAIN_OT_layer, PTRTERRAIN_OT_import)


def _registered_class(cls):
    """Return the registered RNA class, including classes orphaned by reloads."""
    identifier = cls.__name__
    existing = getattr(bpy.types, identifier, None)
    if existing is not None:
        return existing
    # A failed extension reinstall can retain an RNA subclass without exposing
    # it as an attribute on bpy.types. Querying the RNA bases still finds it.
    for base in (bpy.types.PropertyGroup, bpy.types.Operator):
        existing = base.bl_rna_get_subclass_py(identifier, None)
        if existing is not None:
            return existing
    return None


def register():
    # Extension installation/reload runs under Blender's _RestrictContext, so
    # registration must never read bpy.context.scene.  Also recover classes
    # left behind by an older register() that failed after partial setup.
    if hasattr(bpy.types.Scene, "ptrterrain_settings"):
        del bpy.types.Scene.ptrterrain_settings
    for cls in reversed(CLASSES):
        existing = _registered_class(cls)
        if existing is not None and existing is not cls:
            bpy.utils.unregister_class(existing)
    registered_now = []
    try:
        for cls in CLASSES:
            existing = _registered_class(cls)
            if existing is cls:
                continue
            if existing is not None:
                bpy.utils.unregister_class(existing)
            bpy.utils.register_class(cls)
            registered_now.append(cls)
        bpy.types.Scene.ptrterrain_settings = PointerProperty(type=PTRTERRAIN_PG_settings)
    except Exception:
        if hasattr(bpy.types.Scene, "ptrterrain_settings"):
            del bpy.types.Scene.ptrterrain_settings
        for cls in reversed(registered_now):
            if _registered_class(cls) is cls:
                try:
                    bpy.utils.unregister_class(cls)
                except RuntimeError:
                    pass
        raise


def unregister():
    if hasattr(bpy.types.Scene, "ptrterrain_settings"):
        del bpy.types.Scene.ptrterrain_settings
    for cls in reversed(CLASSES):
        if _registered_class(cls) is cls:
            bpy.utils.unregister_class(cls)
