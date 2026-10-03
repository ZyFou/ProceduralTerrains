"""Build a deterministic Unity Package Manager source ZIP, including .meta files."""
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "plugins/unity/Packages/com.zyfou.procedural-terrains"


def main():
    version = json.loads((SOURCE / "package.json").read_text())["version"]
    output = ROOT / f"public/downloads/plugins/procedural-terrains-unity-{version}.zip"
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for file in sorted(SOURCE.rglob("*")):
            if not file.is_file(): continue
            relative = file.relative_to(SOURCE)
            if any(part in {"Library", "Temp", "__pycache__", ".git"} for part in relative.parts): continue
            info = zipfile.ZipInfo("com.zyfou.procedural-terrains/" + relative.as_posix(), (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, file.read_bytes())
    print(output)
    return output


if __name__ == "__main__":
    main()
