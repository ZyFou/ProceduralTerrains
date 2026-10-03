"""Verify plugin ZIP contents, versions, source parity and website download links."""
import json
import re
import tomllib
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
config = (ROOT / "src/config/plugins.js").read_text(encoding="utf-8")
for engine in ("blender", "unity"):
    source = ROOT / ("plugins/blender/procedural_terrains" if engine == "blender" else "plugins/unity/Packages/com.zyfou.procedural-terrains")
    if engine == "blender":
        manifest = tomllib.loads((source / "blender_manifest.toml").read_text(encoding="utf-8"))
        version = manifest["version"]
        expected = {"blender_manifest.toml", *manifest["build"]["paths"]}
        prefix = ""
    else:
        version = json.loads((source / "package.json").read_text())["version"]
        expected = {p.relative_to(source).as_posix() for p in source.rglob("*") if p.is_file()}
        prefix = "com.zyfou.procedural-terrains/"
        guids = [re.search(r"^guid: (\w+)", p.read_text(), re.M).group(1) for p in source.rglob("*.meta")]
        assert len(guids) == len(set(guids)), "Duplicate Unity GUIDs"
        assert all((source / (p + ".meta")).is_file() for p in expected if p.endswith(".cs"))
    filename = f"procedural-terrains-{engine}-{version}.zip"
    assert f"/downloads/plugins/{filename}" in config
    archive_path = ROOT / "public/downloads/plugins" / filename
    with zipfile.ZipFile(archive_path) as archive:
        assert archive.testzip() is None
        assert set(archive.namelist()) == {prefix + p for p in expected}
        for p in expected:
            assert archive.read(prefix + p) == (source / p).read_bytes(), f"Stale archive entry: {p}"
    print(f"{engine} {version}: {len(expected)} entries, source bytes and download URL verified")
