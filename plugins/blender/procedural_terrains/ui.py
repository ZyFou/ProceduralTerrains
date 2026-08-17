"""3D View sidebar and File > Import integration."""

import bpy
from bpy.types import Panel


class PTRTERRAIN_PT_import(Panel):
    bl_label = "Procedural Terrains"
    bl_idname = "PTRTERRAIN_PT_import"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Terrain"

    def draw(self, context):
        layout = self.layout
        settings = context.scene.ptrterrain_settings
        layout.label(text="Import baked terrain", icon="MESH_GRID")
        layout.prop(settings, "source_path", text="Package")
        layout.prop(settings, "mesh_resolution")
        options = layout.box()
        options.prop(settings, "create_materials")
        options.prop(settings, "smooth_shading")
        options.prop(settings, "pack_images")
        options.prop(settings, "select_imported")
        if settings.mesh_resolution == "FULL":
            layout.label(text="Full 2K/4K grids may be very heavy", icon="ERROR")
        row = layout.row()
        row.enabled = bool(settings.source_path)
        operator = row.operator("ptrterrain.import_package", text="Import and Build", icon="IMPORT")
        operator.use_scene_settings = True
        if settings.last_status:
            status = layout.box()
            status.label(text=settings.last_status, icon="CHECKMARK" if settings.last_status.startswith("Imported") else "ERROR")
            if settings.last_collection:
                status.label(text=settings.last_collection, icon="OUTLINER_COLLECTION")
            if settings.last_warning_count != "0":
                status.label(text=f"{settings.last_warning_count} warning(s) in System Console", icon="INFO")


def _draw_file_import(self, context):
    self.layout.operator(
        "ptrterrain.import_package",
        text="Procedural Terrains (.zip/.ptrterrain)",
        icon="MESH_GRID",
    )


def register():
    bpy.utils.register_class(PTRTERRAIN_PT_import)
    bpy.types.TOPBAR_MT_file_import.append(_draw_file_import)


def unregister():
    bpy.types.TOPBAR_MT_file_import.remove(_draw_file_import)
    bpy.utils.unregister_class(PTRTERRAIN_PT_import)
