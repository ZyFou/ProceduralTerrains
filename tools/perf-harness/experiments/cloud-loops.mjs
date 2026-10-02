// Clouds: explicit-LOD occupancy lookup + guarded loops. GPU per pass + pixels.
import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, h, scene, shot, ROOT }) {
  const view = scene.views.find((v) => v.id === (process.env.VIEW || 'overview'));
  const dir = path.join(ROOT, 'output', 'perf-harness', 'runs', 'exp-cloud-loops');
  fs.mkdirSync(path.join(dir, 'a'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'b'), { recursive: true });
  await h.setPose(view.pose);
  await h.settle({ timeoutMs: 120000 });
  await h.setPose(view.pose);
  await shot(path.join(dir, 'a', 'clouds.png'));
  const bd0 = await h.breakdown({ frames: 30 });
  const res = await page.evaluate(async () => {
    const e = window.__engine;
    window.__h.unfreeze();
    const layer = e.studioCloud;
    const m = layer.material;
    let f = m.fragmentShader;
    const before = f;
    f = f.replace(/texture2D\(uCloudOccupancy, uv\)/g, 'textureLod(uCloudOccupancy, uv, 0.0)');
    f = f.replace(/for \(int i = 0; i < (CLOUD_STEPS|CLOUD_LIGHT_STEPS|CLOUD_OCTAVES|CLOUD_DETAIL_OCTAVES|3); i\+\+\)/g, 'for (int i = 0; i < $1 + uLoopGuard; i++)');
    f = f.replace(/for \(int (x|y|z) = -1; \1 <= 1; \1\+\+\)/g, 'for (int $1 = -1; $1 <= 1 + uLoopGuard; $1++)');
    f = 'uniform int uLoopGuard;\n' + f;
    m.fragmentShader = f;
    m.defines = { ...m.defines, CLOUD_LOOP_BUST: Math.floor(Math.random() * 1e9) };
    m.needsUpdate = true;
    const t0 = performance.now();
    await e.renderer.compileAsync(e.scene, e.camera);
    return { compileMs: Math.round(performance.now() - t0), changed: f !== before, guards: (f.match(/uLoopGuard/g) || []).length };
  });
  console.log('patched', JSON.stringify(res));
  await h.setPose(view.pose);
  await h.settle({ timeoutMs: 60000, idleFrames: 10, minFrames: 10 });
  await h.setPose(view.pose);
  await shot(path.join(dir, 'b', 'clouds.png'));
  const bd1 = await h.breakdown({ frames: 30 });
  const fmt = (bd) => bd.slice(0, 4).map((r) => `${r.label.slice(0, 40)}=${r.gpuMsPerFrame}`).join(' | ');
  console.log('before', fmt(bd0));
  console.log('after ', fmt(bd1));
}
