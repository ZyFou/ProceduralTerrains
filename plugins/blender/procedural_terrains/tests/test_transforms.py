import unittest

from plugins.blender.procedural_terrains.transforms import import_transform
from plugins.blender.procedural_terrains.tests.test_runtime_document import valid_document


class ImportTransformTests(unittest.TestCase):
    def test_source_dimensions_recenter_and_rebase_height(self):
        document = valid_document()
        transform = import_transform(document, placement=(10, 20, 30))
        self.assertEqual(transform.point(-500, -500, 0), (-490, 520, 30))
        self.assertEqual(transform.point(500, 500, 560), (510, -480, 590))

    def test_custom_dimensions_and_vertical_scale(self):
        transform = import_transform(
            valid_document(), "CUSTOM", 2000, 500, 2, (100, -50, 12)
        )
        self.assertEqual((transform.scale_x, transform.scale_y, transform.scale_z), (2, .5, 2))
        self.assertEqual(transform.point(500, 500, 560), (1100, -300, 1132))
        self.assertEqual((transform.effective_width, transform.effective_depth, transform.effective_height), (2000, 500, 1120))

    def test_rejects_invalid_custom_dimensions(self):
        with self.assertRaises(ValueError):
            import_transform(valid_document(), "CUSTOM", 0, 100, 1)
        with self.assertRaises(ValueError):
            import_transform(valid_document(), vertical_scale=0)


if __name__ == "__main__":
    unittest.main()
