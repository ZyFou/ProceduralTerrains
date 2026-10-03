import unittest

try:
    import numpy as np
    from plugins.blender.procedural_terrains.generation import (
        GenerationSettings, LAYER_TYPES, NoiseLayer, TerrainEvaluator,
        apply_stack_preset,
        thermal_erosion, surface_fields,
    )
except ModuleNotFoundError:
    np = None


@unittest.skipUnless(np is not None, "Generation parity tests run with Blender's bundled NumPy")
class GenerationTests(unittest.TestCase):
    def evaluator(self, layer_type):
        settings = GenerationSettings(
            width=1000, depth=1000, height=1, resolution=65, falloff=0,
            noise_scale=100, layers=[NoiseLayer.make(layer_type)],
        )
        evaluator = TerrainEvaluator(settings)
        evaluator.seed_x = np.float32(0)
        evaluator.seed_y = np.float32(0)
        return evaluator

    def test_layer_golden_samples_match_web_cpu_reference(self):
        expected = {
            "fbm": .22749673691247663,
            "ridged": .08544321161039288,
            "billow": .22047253624842128,
            "value": .2191480612824969,
            "white": .002287244711017138,
            "constant": .1,
            "voronoi": .11024905025654275,
            "crater": 0,
            "dune": .3019396689946807,
            "flow": -.00000906682526463671,
        }
        for layer_type, golden in expected.items():
            with self.subTest(layer_type=layer_type):
                value = float(self.evaluator(layer_type)._evaluate_stack(np.float32(12.5), np.float32(-7.25)))
                self.assertAlmostEqual(value, golden, delta=.001)

    def test_all_layer_types_are_finite(self):
        x, y = np.meshgrid(np.linspace(-50, 50, 9, dtype=np.float32), np.linspace(-40, 40, 9, dtype=np.float32))
        for layer_type in LAYER_TYPES:
            if layer_type in {"domainWarp", "terrace"}:
                layers = [NoiseLayer.make("fbm"), NoiseLayer.make(layer_type)]
            else:
                layers = [NoiseLayer.make(layer_type)]
            settings = GenerationSettings(width=100, depth=80, height=50, resolution=65, falloff=0, layers=layers)
            with self.subTest(layer_type=layer_type):
                self.assertTrue(np.isfinite(TerrainEvaluator(settings).sample(x, y)).all())

    def test_seed_is_deterministic_and_shared_tile_seams_match(self):
        settings = apply_stack_preset(
            GenerationSettings(width=200, depth=100, tiles_x=2, tiles_y=1, resolution=65),
            "alpineRanges",
        )
        evaluator = TerrainEvaluator(settings)
        left = evaluator.tile_grid(0, 0)[2]
        right = evaluator.tile_grid(1, 0)[2]
        self.assertTrue(np.array_equal(left[:, -1], right[:, 0]))
        self.assertTrue(np.array_equal(left, TerrainEvaluator(settings).tile_grid(0, 0)[2]))
        changed = GenerationSettings.from_dict(settings.to_dict())
        changed.seed += 1
        self.assertFalse(np.array_equal(left, TerrainEvaluator(changed).tile_grid(0, 0)[2]))

    def test_masks_blends_normalization_smoothing_and_edge_profiles(self):
        layers = [
            NoiseLayer.make("fbm", blend_mode="replace", masks=[{"type": "height", "params": {"min": 0, "max": 1}}]),
            NoiseLayer.make("ridged", blend_mode="overlay", masks=[{"type": "noise", "params": {"scale": .5, "threshold": .4, "softness": .1}}]),
            NoiseLayer.make("billow", blend_mode="add", masks=[{"type": "slope", "params": {"min": 0, "max": 1, "falloff": .1}}]),
            NoiseLayer.make("constant", blend_mode="max", masks=[{"type": "biome", "params": {"biome": 3}}]),
        ]
        settings = GenerationSettings(resolution=65, layers=layers, normalize_output=True, output_max=1, terrain_smoothing=.4, edge_falloff_mode="mountains")
        height = TerrainEvaluator(settings).tile_grid(0, 0)[2]
        self.assertTrue(np.isfinite(height).all())
        self.assertGreater(float(height.max()), float(height.min()))

    def test_thermal_erosion_conserves_mass_and_fixed_edges(self):
        base = np.zeros((11, 17), dtype=np.float32)
        base[5, 8] = 100
        eroded = thermal_erosion(base, 2, 5, 30, .4, 30)
        self.assertAlmostEqual(float(eroded.sum()), 100, delta=.0001)
        self.assertLess(eroded[5, 8], 100)
        self.assertGreaterEqual(float(eroded.min()), 0)
        self.assertTrue(np.array_equal(eroded[[0, -1]], base[[0, -1]]))
        self.assertTrue(np.array_equal(eroded[:, [0, -1]], base[:, [0, -1]]))
        self.assertTrue(np.array_equal(base, thermal_erosion(base, 2, 5, 0, .4, 30)))
        self.assertTrue(np.array_equal(base, thermal_erosion(base, 2, 5, 30, 0, 30)))

    def test_old_recipe_disables_new_features_and_roundtrips(self):
        old = GenerationSettings.from_dict({"resolution": 257, "layers": [NoiseLayer.make("legacy").to_dict()]})
        self.assertFalse(old.detail_enabled)
        self.assertFalse(old.erosion_enabled)
        self.assertFalse(old.water_enabled)
        self.assertEqual(old.surface_mode, "LEGACY")
        self.assertEqual(old.to_json(), GenerationSettings.from_json(old.to_json()).to_json())
        self.assertEqual(GenerationSettings().resolution, 513)

    def test_final_surface_fields_are_normalized_and_shared_at_seams(self):
        settings = GenerationSettings(width=300, depth=120, tiles_x=3, tiles_y=2, resolution=65)
        evaluator = TerrainEvaluator(settings)
        left = evaluator.tile_grid(0, 0)[2]
        right = evaluator.tile_grid(1, 0)[2]
        bottom = evaluator.tile_grid(0, 1)[2]
        self.assertTrue(np.array_equal(left[:, -1], right[:, 0]))
        self.assertTrue(np.array_equal(left[-1], bottom[0]))
        normals, weights = surface_fields(evaluator._assembly_cache[2], settings)
        np.testing.assert_allclose(np.linalg.norm(normals, axis=-1), 1, atol=1e-6)
        np.testing.assert_allclose(weights.sum(axis=-1), 1, atol=1e-6)
        self.assertTrue(np.isfinite(weights).all())
        self.assertGreaterEqual(float(weights.min()), 0)
        copy = TerrainEvaluator(GenerationSettings.from_json(settings.to_json()))
        np.testing.assert_array_equal(evaluator._assembly_cache[2], self._full(copy))

    def _full(self, evaluator):
        evaluator.tile_grid(0, 0)
        return evaluator._assembly_cache[2]

    def test_fine_detail_is_effective_and_frequency_is_density_limited(self):
        settings = GenerationSettings(resolution=65, erosion_enabled=False, falloff=0, detail_slope_influence=0)
        fine = TerrainEvaluator(settings).tile_grid(0, 0)[2]
        settings.detail_enabled = False
        base = TerrainEvaluator(settings).tile_grid(0, 0)[2]
        self.assertGreater(float(np.abs(fine - base).max()), .01)
        self.assertLessEqual(float(np.abs(fine - base).max()), settings.detail_amplitude + .0001)
        settings.detail_enabled = True
        settings.detail_wavelength = .001
        first = TerrainEvaluator(settings).tile_grid(0, 0)[2]
        settings.detail_wavelength = 8 * settings.width / (settings.resolution - 1)
        np.testing.assert_array_equal(first, TerrainEvaluator(settings).tile_grid(0, 0)[2])


if __name__ == "__main__":
    unittest.main()
