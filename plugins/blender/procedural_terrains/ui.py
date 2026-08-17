"""3D View sidebar and File > Import integration."""

import bpy
from bpy.types import Panel, UIList


class PTRTERRAIN_UL_layers(UIList):
    def draw_item(self, context, layout, data, item, icon, active_data, active_propname, index):
        row = layout.row(align=True)
        row.prop(item, "enabled", text="")
        row.prop(item, "name", text="", emboss=False, icon="MOD_DISPLACE")
        row.label(text=item.layer_type)


def _draw_status(layout, settings):
    if not settings.last_status:
        return
    status = layout.box()
    status.label(text=settings.last_status, icon="CHECKMARK" if settings.last_status.startswith(("Imported", "Generated")) else "ERROR")
    if settings.last_collection:
        status.label(text=settings.last_collection, icon="OUTLINER_COLLECTION")
    if settings.last_warning_count != "0":
        status.label(text=f"{settings.last_warning_count} warning(s) in System Console", icon="INFO")


def _draw_masks(layout, layer):
    box = layout.box()
    box.label(text="Layer Masks", icon="MOD_MASK")
    for enabled, invert, names in (
        ("use_height_mask", "height_mask_invert", ("height_mask_min", "height_mask_max", "height_mask_falloff")),
        ("use_noise_mask", "noise_mask_invert", ("noise_mask_scale", "noise_mask_threshold", "noise_mask_softness")),
        ("use_slope_mask", "slope_mask_invert", ("slope_mask_min", "slope_mask_max", "slope_mask_falloff")),
        ("use_biome_mask", "biome_mask_invert", ("biome_mask_biome",)),
    ):
        row = box.row(align=True)
        row.prop(layer, enabled)
        if getattr(layer, enabled):
            row.prop(layer, invert, text="Invert")
            column = box.column(align=True)
            for name in names:
                column.prop(layer, name)


def _draw_layer(layout, layer):
    box = layout.box()
    box.prop(layer, "name")
    row = box.row(align=True)
    row.prop(layer, "layer_type")
    row.prop(layer, "blend_mode")
    box.prop(layer, "strength")
    box.prop(layer, "opacity")
    box.prop(layer, "seed_offset")
    kind = layer.layer_type
    if kind in {"fbm", "ridged", "billow"}:
        for name in ("scale", "octaves", "persistence", "lacunarity", "erosion", "warp"):
            box.prop(layer, name)
        if kind == "ridged": box.prop(layer, "sharpness")
    elif kind == "value": box.prop(layer, "scale"); box.prop(layer, "interp")
    elif kind == "white": box.prop(layer, "scale"); box.prop(layer, "smoothing")
    elif kind == "constant": box.prop(layer, "constant_value")
    elif kind == "voronoi":
        for name in ("scale", "jitter", "distance_mode", "output_mode"): box.prop(layer, name)
    elif kind == "crater":
        for name in ("scale", "density", "depth", "rim", "rim_width"): box.prop(layer, name)
    elif kind == "dune":
        for name in ("scale", "direction", "sharpness", "ripple_scale", "ripple_strength"): box.prop(layer, name)
    elif kind == "flow":
        for name in ("scale", "direction", "width", "meander", "meander_scale"): box.prop(layer, name)
    elif kind == "domainWarp": box.prop(layer, "scale"); box.prop(layer, "octaves")
    elif kind == "terrace": box.prop(layer, "terrace_count"); box.prop(layer, "terrace_smoothness")
    _draw_masks(layout, layer)


def _draw_create(layout, settings):
    preset = layout.box()
    preset.label(text="Quick Setup", icon="WORLD")
    row = preset.row(align=True)
    row.prop(settings, "gen_preset", text="Style")
    operator = row.operator("ptrterrain.apply_preset", text="Apply")
    operator.stack = False
    preset.prop(settings, "gen_seed")
    dimensions = preset.column(align=True)
    dimensions.prop(settings, "gen_width")
    dimensions.prop(settings, "gen_depth")
    dimensions.prop(settings, "gen_height")
    grid = preset.row(align=True)
    grid.prop(settings, "gen_tiles_x")
    grid.prop(settings, "gen_tiles_y")
    preset.prop(settings, "gen_resolution")
    preset.prop(settings, "gen_placement")
    preset.prop(settings, "gen_smooth_shading")
    preset.prop(settings, "gen_create_material")
    resolution = int(settings.gen_resolution)
    vertex_count = settings.gen_tiles_x * settings.gen_tiles_y * resolution * resolution
    preset.label(text=f"Estimated vertices: {vertex_count:,}", icon="MESH_GRID")
    if vertex_count > 16_000_000:
        preset.label(text="Exceeds the 16 million vertex limit", icon="ERROR")
    elif vertex_count > 1_000_000:
        preset.label(text="High-density terrain may take time", icon="INFO")

    row = layout.row(align=True)
    row.enabled = vertex_count <= 16_000_000
    row.operator("ptrterrain.generate", text="Generate Terrain", icon="ADD")
    row.operator("ptrterrain.load_generated_settings", text="Load Selected", icon="IMPORT")
    operator = layout.operator("ptrterrain.generate", text="Regenerate Selected", icon="FILE_REFRESH")
    operator.regenerate = True

    layout.prop(settings, "show_advanced", toggle=True, icon="DISCLOSURE_TRI_DOWN" if settings.show_advanced else "DISCLOSURE_TRI_RIGHT")
    if not settings.show_advanced:
        return
    globals_box = layout.box()
    globals_box.label(text="Global Shape", icon="SETTINGS")
    for name in ("gen_noise_scale", "gen_noise_strength", "gen_terrain_smoothing", "gen_octaves", "gen_persistence", "gen_lacunarity", "gen_ridge", "gen_warp", "gen_falloff", "gen_edge_mode", "gen_formation_sea_level", "gen_moist_scale", "gen_moist_bias", "gen_biome_scale", "gen_temp_bias", "gen_normalize"):
        globals_box.prop(settings, name)
    if settings.gen_normalize:
        globals_box.prop(settings, "gen_output_min")
        globals_box.prop(settings, "gen_output_max")
    stack = layout.box()
    stack.label(text="Noise Stack", icon="MOD_DISPLACE")
    row = stack.row(align=True)
    row.prop(settings, "gen_stack_preset", text="Preset")
    operator = row.operator("ptrterrain.apply_preset", text="Apply")
    operator.stack = True
    stack.template_list("PTRTERRAIN_UL_layers", "", settings, "layers", settings, "active_layer_index", rows=4)
    if not settings.layers:
        stack.label(text="Classic Terrain is active until a stack is added", icon="INFO")
    controls = stack.row(align=True)
    for action, icon in (("ADD", "ADD"), ("DUPLICATE", "DUPLICATE"), ("REMOVE", "REMOVE"), ("UP", "TRIA_UP"), ("DOWN", "TRIA_DOWN")):
        operator = controls.operator("ptrterrain.layer_action", text="", icon=icon)
        operator.action = action
    if settings.layers:
        index = min(settings.active_layer_index, len(settings.layers) - 1)
        _draw_layer(layout, settings.layers[index])


def _draw_import(layout, settings):
    layout.label(text="Import baked terrain", icon="IMPORT")
    layout.prop(settings, "source_path", text="Package")
    geometry = layout.box()
    geometry.label(text="Geometry", icon="MESH_GRID")
    geometry.prop(settings, "mesh_resolution")
    geometry.prop(settings, "dimension_mode")
    if settings.dimension_mode == "CUSTOM":
        geometry.prop(settings, "target_width")
        geometry.prop(settings, "target_depth")
    geometry.prop(settings, "vertical_scale")
    geometry.prop(settings, "import_placement")
    geometry.prop(settings, "smooth_shading")
    options = layout.box()
    options.label(text="Materials and Selection", icon="MATERIAL")
    options.prop(settings, "create_materials")
    options.prop(settings, "pack_images")
    options.prop(settings, "select_imported")
    if settings.mesh_resolution == "FULL":
        layout.label(text="Full 2K/4K grids may be very heavy", icon="ERROR")
    row = layout.row()
    row.enabled = bool(settings.source_path)
    operator = row.operator("ptrterrain.import_package", text="Import and Build", icon="IMPORT")
    operator.use_scene_settings = True


class PTRTERRAIN_PT_main(Panel):
    bl_label = "Procedural Terrains"
    bl_idname = "PTRTERRAIN_PT_main"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Terrain"

    def draw(self, context):
        layout = self.layout
        settings = context.scene.ptrterrain_settings
        layout.prop(settings, "workflow", expand=True)
        if settings.workflow == "CREATE":
            _draw_create(layout, settings)
        else:
            _draw_import(layout, settings)
        _draw_status(layout, settings)


def _draw_file_import(self, context):
    self.layout.operator("ptrterrain.import_package", text="Procedural Terrains (.zip/.ptrterrain)", icon="MESH_GRID")


CLASSES = (PTRTERRAIN_UL_layers, PTRTERRAIN_PT_main)
_IMPORT_MENU_KEY = "ptrterrain_file_import_callback"


def _registered_class(cls):
    identifier = cls.__name__
    existing = getattr(bpy.types, identifier, None)
    if existing is not None:
        return existing
    for base in (bpy.types.UIList, bpy.types.Panel):
        existing = base.bl_rna_get_subclass_py(identifier, None)
        if existing is not None:
            return existing
    return None


def register():
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
    except Exception:
        for cls in reversed(registered_now):
            if _registered_class(cls) is cls:
                try:
                    bpy.utils.unregister_class(cls)
                except RuntimeError:
                    pass
        raise
    previous_callback = bpy.app.driver_namespace.get(_IMPORT_MENU_KEY)
    if previous_callback is not None:
        try:
            bpy.types.TOPBAR_MT_file_import.remove(previous_callback)
        except (RuntimeError, ValueError):
            pass
    bpy.types.TOPBAR_MT_file_import.append(_draw_file_import)
    bpy.app.driver_namespace[_IMPORT_MENU_KEY] = _draw_file_import


def unregister():
    try:
        bpy.types.TOPBAR_MT_file_import.remove(_draw_file_import)
    except (RuntimeError, ValueError):
        pass
    if bpy.app.driver_namespace.get(_IMPORT_MENU_KEY) is _draw_file_import:
        bpy.app.driver_namespace.pop(_IMPORT_MENU_KEY, None)
    for cls in reversed(CLASSES):
        if _registered_class(cls) is cls:
            bpy.utils.unregister_class(cls)
