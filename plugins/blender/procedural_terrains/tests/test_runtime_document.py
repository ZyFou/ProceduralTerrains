import copy
import unittest

from plugins.blender.procedural_terrains.runtime_document import (
    is_safe_artifact_path,
    validate_document,
)


def valid_document():
    return {
        "format": "procedural-terrains",
        "schemaVersion": 1,
        "producer": {
            "name": "Procedural Terrains",
            "appVersion": "1.5.1",
            "generatorVersion": 1,
        },
        "project": {
            "mode": "procedural",
            "world": "studio",
            "tileShape": "square",
            "seed": 1337,
        },
        "coordinates": {
            "units": "meters",
            "upAxis": "+Y",
            "xAxis": "+X",
            "zAxis": "+Z",
            "unityMapping": "x,y,z",
            "tilePivot": "center",
        },
        "bounds": {
            "minX": -500,
            "minZ": -500,
            "sizeX": 1000,
            "sizeZ": 1000,
            "minHeight": 0,
            "maxHeight": 560,
            "seaLevel": 100,
        },
        "tiles": [{
            "cx": 0,
            "cz": 0,
            "centerX": 0,
            "centerZ": 0,
            "size": 1000,
            "heightfield": {
                "path": "heightmap.raw",
                "resolution": 513,
                "encoding": "uint16-normalized",
                "byteOrder": "little-endian",
                "sampleLayout": "vertex-grid-inclusive",
                "rowOrder": "negative-z-to-positive-z",
                "columnOrder": "negative-x-to-positive-x",
                "minHeight": 0,
                "maxHeight": 560,
            },
        }],
        "generation": {
            "sourceVersion": 1,
            "authoritative": "baked",
            "kind": "procedural",
        },
        "features": {
            "heightfield": True,
            "splat": False,
            "paint": False,
            "erosion": False,
            "splines": False,
            "importedMaps": False,
            "surfaces": False,
            "water": False,
            "props": False,
        },
        "unsupportedFeatures": [],
    }


class RuntimeDocumentTests(unittest.TestCase):
    def test_valid_document_has_no_diagnostics(self):
        self.assertEqual(validate_document(valid_document()), [])

    def test_rejects_unsupported_layout_duplicates_and_grid(self):
        document = valid_document()
        document["project"]["world"] = "planet"
        document["project"]["tileShape"] = "circle"
        document["tiles"].append(copy.deepcopy(document["tiles"][0]))
        document["tiles"][0]["heightfield"]["resolution"] = 512
        codes = {item.code for item in validate_document(document)}
        self.assertTrue({"project.world", "project.tileShape", "tile.duplicate", "heightfield.resolution"} <= codes)

    def test_rejects_unsorted_tiles(self):
        document = valid_document()
        first = document["tiles"][0]
        first["cx"] = 1
        second = copy.deepcopy(first)
        second["cx"] = 0
        document["tiles"] = [first, second]
        self.assertIn("tile.order", {item.code for item in validate_document(document)})

    def test_safe_artifact_paths(self):
        self.assertTrue(is_safe_artifact_path("tiles/tile_-1_2/heightmap.raw"))
        for unsafe in ("../heightmap.raw", "C:/heightmap.raw", "/heightmap.raw", "https://x/a.raw", "a\\b.raw"):
            self.assertFalse(is_safe_artifact_path(unsafe), unsafe)


if __name__ == "__main__":
    unittest.main()
