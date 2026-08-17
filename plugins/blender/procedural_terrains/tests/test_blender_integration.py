import tempfile
from pathlib import Path
import re
import unittest

try:
    import bpy
except ModuleNotFoundError:
    bpy = None


@unittest.skipUnless(bpy is not None, "Blender integration tests require bpy")
class BlenderIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import plugins.blender.procedural_terrains as addon
        cls.addon = addon
        addon.register()

    @classmethod
    def tearDownClass(cls):
        cls.addon.unregister()

    def tearDown(self):
        for collection in tuple(bpy.data.collections):
            if collection.get("ptr_generated") or collection.get("ptr_format") == "procedural-terrains":
                bpy.data.collections.remove(collection)

    def test_generate_material_metadata_and_regenerate(self):
        settings = bpy.context.scene.ptrterrain_settings
        settings.gen_resolution = "65"
        settings.gen_tiles_x = 2
        settings.gen_tiles_y = 2
        self.assertEqual(bpy.ops.ptrterrain.generate(), {"FINISHED"})
        collection = bpy.data.collections[settings.last_collection]
        self.assertEqual(len(collection.objects), 4)
        self.assertEqual(collection["ptr_vertex_count"], 16900)
        self.assertIsNotNone(collection.objects[0].data.attributes.get("ptr_normalized_height"))
        self.assertTrue(collection.objects[0].data.materials[0].get("ptr_generated_preview"))
        preserved = next(obj for obj in collection.objects if obj["ptr_tile_x"] == 0 and obj["ptr_tile_y"] == 0)
        preserved_identity = preserved.as_pointer()
        helper = bpy.data.objects.new("User Helper", None)
        collection.objects.link(helper)
        bpy.context.view_layer.objects.active = preserved
        settings.gen_tiles_x = 1
        operator = bpy.ops.ptrterrain.generate
        self.assertEqual(operator(regenerate=True), {"FINISHED"})
        generated = [obj for obj in collection.objects if obj.get("ptr_generated_tile")]
        self.assertEqual(len(generated), 2)
        self.assertEqual(next(obj for obj in generated if obj["ptr_tile_x"] == 0 and obj["ptr_tile_y"] == 0).as_pointer(), preserved_identity)
        self.assertIs(collection.objects.get(helper.name), helper)

    def test_import_custom_dimensions_and_cursor_placement(self):
        from array import array
        from plugins.blender.procedural_terrains.builder import BuildOptions, build_project
        from plugins.blender.procedural_terrains.tests.test_runtime_document import valid_document
        document = valid_document()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            samples = array("H", [0]) * (513 * 513)
            samples[-1] = 65535
            (root / "heightmap.raw").write_bytes(samples.tobytes())
            bpy.context.scene.cursor.location = (10, 20, 30)
            result = build_project(
                bpy.context, document, root, str(root / "project.ptrterrain"),
                BuildOptions("129", False, False, False, True, "CUSTOM", 2000, 500, 2, "CURSOR"),
            )
        collection = result.collection
        self.assertEqual(collection["ptr_effective_width_m"], 2000)
        self.assertEqual(collection["ptr_effective_depth_m"], 500)
        self.assertEqual(collection["ptr_effective_height_m"], 1120)
        obj = result.objects[0]
        xs = [vertex.co.x for vertex in obj.data.vertices]
        ys = [vertex.co.y for vertex in obj.data.vertices]
        self.assertAlmostEqual(max(xs) - min(xs), 2000)
        self.assertAlmostEqual(max(ys) - min(ys), 500)
        self.assertEqual(tuple(obj.location), (10, 20, 30))

    def test_ui_uses_valid_blender_icons(self):
        import plugins.blender.procedural_terrains.ui as ui

        source = Path(ui.__file__).read_text(encoding="utf-8")
        requested = set(re.findall(r'icon\s*=\s*"([A-Z0-9_]+)"', source))
        available = {
            item.identifier
            for item in bpy.types.UILayout.bl_rna.functions["label"].parameters["icon"].enum_items
        }
        self.assertEqual(requested - available, set())

    def test_z_register_recovers_classes_from_hot_module_reload(self):
        """Installing an update must replace classes from the loaded version."""
        import importlib
        import plugins.blender.procedural_terrains.operators as operators
        import plugins.blender.procedural_terrains.ui as ui

        importlib.reload(operators)
        importlib.reload(ui)
        reloaded_addon = importlib.reload(self.addon)
        reloaded_addon.register()

        self.assertIs(
            bpy.types.PropertyGroup.bl_rna_get_subclass_py("PTRTERRAIN_PG_layer", None),
            operators.PTRTERRAIN_PG_layer,
        )
        type(self).addon = reloaded_addon


if __name__ == "__main__":
    unittest.main()
