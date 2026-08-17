"""Build the installable Blender extension ZIP from its manifest path list."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
import tomllib
import zipfile


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "plugins" / "blender" / "procedural_terrains"
MANIFEST = SOURCE / "blender_manifest.toml"
OUTPUT = ROOT / "public" / "downloads" / "plugins"


def main() -> Path:
    manifest = tomllib.loads(MANIFEST.read_text(encoding="utf-8"))
    version = manifest["version"]
    paths = ["blender_manifest.toml", *manifest["build"]["paths"]]
    destination = OUTPUT / f"procedural-terrains-blender-{version}.zip"
    OUTPUT.mkdir(parents=True, exist_ok=True)
    timestamp = datetime(2026, 1, 1).timetuple()[:6]
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for relative in paths:
            source = SOURCE / relative
            if not source.is_file():
                raise FileNotFoundError(f"Manifest build path does not exist: {relative}")
            info = zipfile.ZipInfo(relative, timestamp)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, source.read_bytes())
    print(destination)
    return destination


if __name__ == "__main__":
    main()
