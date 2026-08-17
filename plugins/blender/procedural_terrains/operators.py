"""Blender operators and persistent scene settings."""

import traceback

import bpy
from bpy.props import BoolProperty, EnumProperty, PointerProperty, StringProperty
from bpy.types import Operator, PropertyGroup
from bpy_extras.io_utils import ImportHelper

from .archive import TerrainPackageError, open_project_source
from .builder import BuildOptions, build_project
from .heightfield import HeightfieldError
from .runtime_document import TerrainDocumentError, read_document


MESH_RESOLUTION_ITEMS = (
    ("AUTO", "Automatic (up to 513)", "Keep source detail up to 513 x 513 vertices per tile"),
    ("129", "129 x 129", "Fast preview mesh"),
    ("257", "257 x 257", "Medium detail mesh"),
    ("513", "513 x 513", "Recommended editable mesh"),
    ("1025", "1025 x 1025", "High detail mesh; may be slow"),
    ("FULL", "Full source resolution", "Use every source sample; 2049/4097 grids can be extremely heavy"),
)


class PTRTERRAIN_PG_settings(PropertyGroup):
    source_path: StringProperty(
        name="Terrain package",
        description="Procedural Terrains ZIP or project.ptrterrain file",
        subtype="FILE_PATH",
    )
    mesh_resolution: EnumProperty(name="Mesh detail", items=MESH_RESOLUTION_ITEMS, default="AUTO")
    create_materials: BoolProperty(name="Create baked materials", default=True)
    smooth_shading: BoolProperty(name="Smooth shading", default=True)
    pack_images: BoolProperty(name="Pack texture images", default=True)
    select_imported: BoolProperty(name="Select imported tiles", default=True)
    last_status: StringProperty(name="Last import")
    last_collection: StringProperty(name="Collection")
    last_warning_count: StringProperty(name="Warnings", default="0")


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

    def invoke(self, context, event):
        settings = context.scene.ptrterrain_settings
        if self.use_scene_settings and settings.source_path:
            return self.execute(context)
        return ImportHelper.invoke(self, context, event)

    def draw(self, context):
        layout = self.layout
        layout.prop(self, "mesh_resolution")
        layout.prop(self, "create_materials")
        layout.prop(self, "smooth_shading")
        layout.prop(self, "pack_images")
        layout.prop(self, "select_imported")
        if self.mesh_resolution == "FULL":
            box = layout.box()
            box.label(text="Full 2049/4097 grids can consume substantial memory.", icon="ERROR")

    def execute(self, context):
        settings = context.scene.ptrterrain_settings
        if self.use_scene_settings:
            source_path = bpy.path.abspath(settings.source_path)
            options = BuildOptions(
                settings.mesh_resolution,
                settings.create_materials,
                settings.smooth_shading,
                settings.pack_images,
                settings.select_imported,
            )
        else:
            source_path = self.filepath
            options = BuildOptions(
                self.mesh_resolution,
                self.create_materials,
                self.smooth_shading,
                self.pack_images,
                self.select_imported,
            )
        if not source_path:
            self.report({"ERROR"}, "Select a Procedural Terrains ZIP or .ptrterrain file.")
            return {"CANCELLED"}
        try:
            with open_project_source(source_path) as source:
                document, _ = read_document(source.document_path)
                # ZIP contents live in a temporary folder, so images must be
                # packed into the .blend before that folder is removed.
                if source.from_archive and options.create_materials and not options.pack_images:
                    options = BuildOptions(
                        options.mesh_resolution,
                        options.create_materials,
                        options.smooth_shading,
                        True,
                        options.select_imported,
                    )
                result = build_project(
                    context,
                    document,
                    source.document_path.parent,
                    str(source.source_path),
                    options,
                )
            settings.source_path = source_path
            settings.last_collection = result.collection.name
            settings.last_warning_count = str(len(result.warnings))
            settings.last_status = f"Imported {len(result.objects)} tile(s)"
            if result.warnings:
                self.report({"WARNING"}, f"Imported {len(result.objects)} tile(s) with {len(result.warnings)} warning(s). See the System Console.")
                for warning in result.warnings:
                    print(f"[Procedural Terrains] Warning: {warning}")
            else:
                self.report({"INFO"}, f"Imported {len(result.objects)} terrain tile(s).")
            return {"FINISHED"}
        except (TerrainPackageError, TerrainDocumentError, HeightfieldError, OSError, ValueError, RuntimeError) as exc:
            settings.last_status = "Import failed"
            message = str(exc).splitlines()[0] if str(exc) else exc.__class__.__name__
            self.report({"ERROR"}, message[:1000])
            print("[Procedural Terrains] Import failed")
            traceback.print_exc()
            return {"CANCELLED"}


CLASSES = (PTRTERRAIN_PG_settings, PTRTERRAIN_OT_import)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.Scene.ptrterrain_settings = PointerProperty(type=PTRTERRAIN_PG_settings)


def unregister():
    del bpy.types.Scene.ptrterrain_settings
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
