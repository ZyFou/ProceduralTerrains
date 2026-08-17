from pathlib import Path
import tempfile
import unittest
import zipfile

from plugins.blender.procedural_terrains.archive import TerrainPackageError, open_project_source


class ArchiveTests(unittest.TestCase):
    def test_extracts_one_project_from_valid_archive(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive_path = Path(temporary) / "terrain.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("Blender/project.ptrterrain", "{}")
                archive.writestr("Blender/heightmap.raw", b"\0\0")
            with open_project_source(archive_path) as source:
                self.assertTrue(source.from_archive)
                self.assertEqual(source.document_path.name, "project.ptrterrain")
                self.assertTrue(source.document_path.is_file())
            self.assertFalse(source.root.exists())

    def test_rejects_traversal_and_executable_entries(self):
        for unsafe in ("../escape.txt", "Blender/run.py"):
            with self.subTest(unsafe=unsafe), tempfile.TemporaryDirectory() as temporary:
                archive_path = Path(temporary) / "terrain.zip"
                with zipfile.ZipFile(archive_path, "w") as archive:
                    archive.writestr("Blender/project.ptrterrain", "{}")
                    archive.writestr(unsafe, "unsafe")
                with self.assertRaises(TerrainPackageError):
                    with open_project_source(archive_path):
                        pass

    def test_rejects_duplicate_case_folded_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive_path = Path(temporary) / "terrain.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("Blender/project.ptrterrain", "{}")
                archive.writestr("blender/PROJECT.ptrterrain", "{}")
            with self.assertRaises(TerrainPackageError):
                with open_project_source(archive_path):
                    pass


if __name__ == "__main__":
    unittest.main()
