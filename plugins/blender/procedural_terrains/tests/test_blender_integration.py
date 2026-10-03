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
        self.assertEqual(len(collection.objects), 5)
        self.assertEqual(collection["ptr_vertex_count"], 16900)
        tile = next(obj for obj in collection.objects if obj.get("ptr_generated_tile"))
        self.assertIsNotNone(tile.data.attributes.get("ptr_normalized_height"))
        self.assertTrue(tile.data.materials[0].get("ptr_generated_preview"))
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

    def test_water_live_changes_and_recipe_persistence(self):
        import json
        from plugins.blender.procedural_terrains.water import update_water
        from plugins.blender.procedural_terrains.generation import GenerationSettings
        from plugins.blender.procedural_terrains.generation_builder import build_generated_terrain
        settings = GenerationSettings(resolution=65)
        result = build_generated_terrain(bpy.context, settings)
        obj = update_water(result.collection, False, 23, (.1, .2, .3))
        self.assertTrue(obj.hide_render and obj.hide_viewport)
        self.assertEqual(obj.location.z, 23)
        recipe = GenerationSettings.from_json(result.collection["ptr_generation_json"])
        self.assertFalse(recipe.water_enabled)
        self.assertEqual(recipe.water_level, 23)
        build_generated_terrain(bpy.context, recipe, result.collection)
        self.assertEqual(len([o for o in result.collection.objects if o.get("ptr_generated_water")]), 1)
        self.assertEqual(json.loads(result.collection["ptr_generation_json"])["water_level"], 23)

    def test_custom_import_water_uses_effective_dimensions_and_source_transform(self):
        from array import array
        from plugins.blender.procedural_terrains.builder import BuildOptions, build_project
        from plugins.blender.procedural_terrains.tests.test_runtime_document import valid_document
        document = valid_document()
        document["bounds"]["minHeight"] = 10
        document["bounds"]["seaLevel"] = 30
        document["features"]["water"] = True
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "heightmap.raw").write_bytes((array("H", [0]) * (513 * 513)).tobytes())
            bpy.context.scene.cursor.location = (10, 20, 30)
            result = build_project(bpy.context, document, root, str(root / "project.ptrterrain"),
                                   BuildOptions("129", False, dimension_mode="CUSTOM", target_width=2000,
                                                target_depth=500, vertical_scale=2, placement="CURSOR"))
            water = next(o for o in result.collection.objects if o.get("ptr_generated_water"))
            self.assertEqual(tuple(water.location), (10, 20, 70))
            self.assertEqual(tuple(water.scale), (2000, 500, 1))
            self.assertFalse(water.hide_render)

    def test_shared_normals_and_material_attributes_at_mesh_seams(self):
        from plugins.blender.procedural_terrains.generation import GenerationSettings
        from plugins.blender.procedural_terrains.generation_builder import build_generated_terrain
        settings = GenerationSettings(resolution=65, tiles_x=2, width=300, depth=120)
        result = build_generated_terrain(bpy.context, settings)
        left, right = result.objects
        for row in range(65):
            a, b = row * 65 + 64, row * 65
            for role in ("sand", "grass", "rock", "snow"):
                name = "ptr_surface_" + role
                self.assertAlmostEqual(left.data.attributes[name].data[a].value, right.data.attributes[name].data[b].value)
            for axis in range(3):
                self.assertAlmostEqual(left.data.vertices[a].normal[axis], right.data.vertices[b].normal[axis], delta=.0001)

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

    def test_failed_regeneration_retains_meshes_recipe_and_objects(self):
        from unittest.mock import patch
        from plugins.blender.procedural_terrains.generation import GenerationSettings
        from plugins.blender.procedural_terrains.generation_builder import build_generated_terrain
        result = build_generated_terrain(bpy.context, GenerationSettings(resolution=65))
        original = result.collection["ptr_generation_json"]
        meshes = tuple(obj.data for obj in result.objects)
        mesh_count = len(bpy.data.meshes)
        with patch("plugins.blender.procedural_terrains.generation_builder.update_water", side_effect=RuntimeError("Injected water failure")):
            with self.assertRaises(RuntimeError):
                build_generated_terrain(bpy.context, GenerationSettings(resolution=129), result.collection)
        self.assertEqual(result.collection["ptr_generation_json"], original)
        self.assertEqual(tuple(obj.data for obj in result.objects), meshes)
        self.assertEqual(len(bpy.data.meshes), mesh_count)

    def test_live_water_sidebar_controls_update_recipe_and_generation_settings(self):
        import json
        from plugins.blender.procedural_terrains.generation import GenerationSettings
        from plugins.blender.procedural_terrains.generation_builder import build_generated_terrain
        result = build_generated_terrain(bpy.context, GenerationSettings(resolution=65))
        self.assertEqual(bpy.ops.ptrterrain.load_water(), {"FINISHED"})
        settings = bpy.context.scene.ptrterrain_settings
        settings.live_water_level = 41
        settings.live_water_enabled = False
        settings.live_water_color = (.1, .3, .6)
        recipe = json.loads(result.collection["ptr_generation_json"])
        self.assertEqual(recipe["water_level"], 41)
        self.assertFalse(recipe["water_enabled"])
        self.assertEqual(settings.gen_water_level, 41)
        self.assertFalse(settings.gen_water_enabled)
        water = next(o for o in result.collection.objects if o.get("ptr_generated_water"))
        self.assertEqual(water.location.z, 41)
        self.assertTrue(water.hide_render)

    def test_recipe_and_water_survive_blend_save_and_reload(self):
        from plugins.blender.procedural_terrains.generation import GenerationSettings
        from plugins.blender.procedural_terrains.generation_builder import build_generated_terrain
        recipe = GenerationSettings(resolution=65, water_enabled=False, water_level=45, detail_amplitude=3)
        result = build_generated_terrain(bpy.context, recipe)
        name = result.collection.name
        with tempfile.TemporaryDirectory() as temporary:
            path = str(Path(temporary) / "terrain.blend")
            bpy.ops.wm.save_as_mainfile(filepath=path)
            bpy.ops.wm.open_mainfile(filepath=path)
        collection = bpy.data.collections[name]
        loaded = GenerationSettings.from_json(collection["ptr_generation_json"])
        self.assertEqual(loaded.to_json(), recipe.to_json())
        water = next(o for o in collection.objects if o.get("ptr_generated_water"))
        self.assertTrue(water.hide_render and water.hide_viewport)
        self.assertEqual(water.location.z, 45)


if __name__ == "__main__":
    unittest.main()
