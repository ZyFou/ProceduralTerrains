"""Run with Blender --background --factory-startup --python tools/test_blender_extension.py."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
suite = unittest.defaultTestLoader.discover(str(ROOT / "plugins/blender/procedural_terrains/tests"))
result = unittest.TextTestRunner(verbosity=2).run(suite)
if not result.wasSuccessful():
    # --python-exit-code makes this visible to the invoking process.
    raise RuntimeError("Blender extension tests failed")
