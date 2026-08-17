from array import array
import math
from pathlib import Path
import tempfile
import unittest

from plugins.blender.procedural_terrains.heightfield import (
    loop_uvs,
    quad_faces,
    read_raw_heightfield,
    vertices,
)


class HeightfieldTests(unittest.TestCase):
    def test_decodes_little_endian_edges_and_resamples_exactly(self):
        resolution = 513
        samples = array("H", [0]) * (resolution * resolution)
        samples[0] = 0x1234
        samples[-1] = 0xABCD
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "heightmap.raw"
            path.write_bytes(samples.tobytes())
            grid = read_raw_heightfield(path, resolution, "129")
        self.assertEqual(grid.resolution, 129)
        self.assertEqual(grid.stride, 4)
        self.assertAlmostEqual(grid.normalized(0, 0), 0x1234 / 65535)
        self.assertAlmostEqual(grid.normalized(128, 128), 0xABCD / 65535)

    def test_coordinate_mapping_and_face_winding_are_z_up(self):
        resolution = 513
        samples = array("H", [0]) * (resolution * resolution)
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "heightmap.raw"
            path.write_bytes(samples.tobytes())
            grid = read_raw_heightfield(path, resolution, "129")
        points = list(vertices(grid, 1000, 0, 560))
        self.assertEqual(points[0], (-500.0, 500.0, 0.0))
        self.assertEqual(points[-1], (500.0, -500.0, 0.0))
        face = next(quad_faces(grid.resolution))
        a, d, c = (points[index] for index in face[:3])
        edge1 = tuple(d[i] - a[i] for i in range(3))
        edge2 = tuple(c[i] - a[i] for i in range(3))
        normal_z = edge1[0] * edge2[1] - edge1[1] * edge2[0]
        self.assertGreater(normal_z, 0)

    def test_uvs_follow_negative_to_positive_source_z(self):
        uvs = list(loop_uvs(3))
        self.assertEqual(uvs[:4], [(0.0, 0.0), (0.0, 0.5), (0.5, 0.5), (0.5, 0.0)])
        self.assertTrue(all(math.isfinite(component) for uv in uvs for component in uv))


if __name__ == "__main__":
    unittest.main()
