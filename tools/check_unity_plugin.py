"""Compile the runtime/editor assemblies against an installed Unity without launching it.

This validates C# API usage only; it does not replace Unity Editor integration tests.
Usage: python tools/check_unity_plugin.py --unity-data ".../Editor/Data"
"""
import argparse
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--unity-data", type=Path, required=True)
parser.add_argument("--numerics", action="store_true", help="Also run managed terrain calculations and compare to Blender/NumPy")
args = parser.parse_args()
data = args.unity_data
output = ROOT / ".cache/plugin-qa/compile"
output.mkdir(parents=True, exist_ok=True)
source = ROOT / "plugins/unity/Packages/com.zyfou.procedural-terrains"
references = {p.name: p for p in (data / "NetStandard/ref/2.1.0").glob("*.dll")}
references.update({p.name: p for p in (data / "Managed/UnityEngine").glob("*.dll")})
references.update({p.name: p for p in (data / "Managed").glob("Unity*.dll")})
references.pop("UnityEngine.dll", None)
references.pop("UnityEditor.dll", None)
compiler = data / "DotNetSdkRoslyn/csc.dll"
for directory, assembly in (("Runtime", "Zyfou.ProceduralTerrains"), ("Editor", "Zyfou.ProceduralTerrains.Editor")):
    lines = ["/nologo", "/target:library", "/langversion:latest", "/define:UNITY_EDITOR", "/nostdlib+",
             '/out:"' + str(output / (assembly + ".dll")) + '"']
    lines.extend('/reference:"' + str(p) + '"' for p in references.values())
    lines.extend('"' + str(p) + '"' for p in (source / directory).glob("*.cs"))
    response = output / (assembly + ".rsp")
    response.write_text("\n".join(lines), encoding="utf-8")
    subprocess.run(["dotnet", str(compiler), "@" + str(response)], check=True)
    references[assembly + ".dll"] = output / (assembly + ".dll")
print("Runtime and Editor assemblies compiled successfully (not an Editor test run).")
if args.numerics:
    harness = output / "Numerics.cs"
    harness.write_text('''using System; using System.Linq; using Zyfou.ProceduralTerrains; using Zyfou.ProceduralTerrains.Editor;
class Numerics {
 static void Main() {
  var s = new TerrainGenerationSettings { Resolution=65, Width=300, Depth=120, TilesX=3, TilesZ=2 };
  var a=TerrainGenerator.Generate(s); var b=TerrainGenerator.Generate(s);
  if (!a.Heights.SequenceEqual(b.Heights)) throw new Exception("Generation must be deterministic.");
  var mass=new float[187]; mass[93]=100;
  TerrainThermalErosion.Apply(mass,17,11,2,5,30,.4f,30);
  if (Math.Abs(mass.Sum()-100)>.001 || mass.Min()<0 || mass[93]>=100) throw new Exception("Invalid thermal erosion.");
  for(int z=0;z<11;z++) for(int x=0;x<17;x++) if ((x==0||x==16||z==0||z==10) && mass[z*17+x]!=0) throw new Exception("Borders moved.");
  Console.WriteLine(string.Join(",", a.Heights.Select(f=>f.ToString("R",System.Globalization.CultureInfo.InvariantCulture))));
 }
}''')
    executable = output / "Zyfou.ProceduralTerrains.EditorTests.dll"
    lines = ["/nologo", "/target:exe", "/langversion:latest", "/nostdlib+", '/out:"' + str(executable) + '"']
    lines.extend('/reference:"' + str(p) + '"' for p in references.values())
    lines.append('"' + str(harness) + '"')
    response = output / "Numerics.rsp"
    response.write_text("\n".join(lines))
    subprocess.run(["dotnet", str(compiler), "@" + str(response)], check=True)
    for library in (data / "Managed/UnityEngine").glob("UnityEngine*.dll"):
        shutil.copyfile(library, output / library.name)
    (output / "Zyfou.ProceduralTerrains.EditorTests.runtimeconfig.json").write_text(json.dumps({
        "runtimeOptions": {"tfm": "net8.0", "framework": {"name": "Microsoft.NETCore.App", "version": "8.0.0"}}
    }))
    result = subprocess.run(["dotnet", str(executable)], check=True, capture_output=True, text=True)
    import sys
    sys.path.insert(0, str(ROOT))
    import numpy as np
    from plugins.blender.procedural_terrains.generation import GenerationSettings, TerrainEvaluator
    evaluator = TerrainEvaluator(GenerationSettings(resolution=65, width=300, depth=120, tiles_x=3, tiles_y=2))
    evaluator.tile_grid(0, 0)
    unity = np.fromstring(result.stdout, sep=",")
    blender = evaluator._assembly_cache[2].ravel()
    np.testing.assert_allclose(unity, blender, atol=.001, rtol=1e-5)
    print(f"Managed numeric checks passed; {len(unity)} samples, maximum cross-engine difference {np.abs(unity - blender).max():.8f} m.")
