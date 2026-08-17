import unittest

try:
    import numpy as np
    from plugins.blender.procedural_terrains.generation import (
        GenerationSettings, LAYER_TYPES, NoiseLayer, TerrainEvaluator,
        apply_stack_preset,
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


if __name__ == "__main__":
    unittest.main()
