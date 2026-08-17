bl_info = {
    "name": "Procedural Terrains",
    "author": "ZyFou",
    "version": (0, 3, 3),
    "blender": (5, 2, 0),
    "location": "File > Import; 3D View > Sidebar > Terrain",
    "description": "Generate native terrain or import validated ZIP and .ptrterrain packages",
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
    try:
        register_operators()
        register_ui()
    except Exception:
        # Do not leave a half-registered extension that fails every subsequent
        # reinstall with "already registered as a subclass".
        try:
            unregister_ui()
        except Exception:
            pass
        try:
            unregister_operators()
        except Exception:
            pass
        raise


def unregister():
    if bpy is None:
        return
    unregister_ui()
    unregister_operators()
