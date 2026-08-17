bl_info = {
    "name": "Procedural Terrains",
    "author": "ZyFou",
    "version": (0, 2, 0),
    "blender": (5, 2, 0),
    "location": "File > Import; 3D View > Sidebar > Terrain",
    "description": "Import validated Procedural Terrains ZIP and .ptrterrain packages",
    "category": "Import-Export",
}

# Keeping the data readers importable without Blender lets their validation,
# archive-safety, and heightfield behavior run in ordinary Python tests.
try:
    import bpy  # type: ignore  # noqa: F401
except ModuleNotFoundError:
    bpy = None

if bpy is not None:
    from .operators import register as register_operators
    from .operators import unregister as unregister_operators
    from .ui import register as register_ui
    from .ui import unregister as unregister_ui


def register():
    if bpy is None:
        return
    register_operators()
    register_ui()


def unregister():
    if bpy is None:
        return
    unregister_ui()
    unregister_operators()
