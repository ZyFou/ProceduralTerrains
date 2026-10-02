// Realistic water: 12 straight-line spectrum bands -> one guarded loop over
// the same literal constants. Cold compile time + GPU + pixel identity.
import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, h, scene, shot, ROOT }) {
  const view = scene.views.find((v) => v.id === (process.env.VIEW || 'grazing'));
  const dir = path.join(ROOT, 'output', 'perf-harness', 'runs', 'exp-water-loop');
  fs.mkdirSync(path.join(dir, 'a'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'b'), { recursive: true });
  await h.setPose(view.pose);
  await h.settle({ timeoutMs: 120000 });
  await h.setPose(view.pose);
  await shot(path.join(dir, 'a', 'water.png'));
  const before = await h.measure({ frames: 30, warmup: 6 });
  const res = await page.evaluate(async () => {
    const e = window.__engine;
    window.__h.unfreeze();
    const m = e.water.material;
    const src = m.fragmentShader;
    const start = src.indexOf('  // Straight-line band calls, no loop');
    const end = src.indexOf('  waterNormalLostVariance = lost;');
    if (start < 0 || end < 0) return { error: 'block not found' };
    const block = `  const float WATER_BAND_K[12] = float[12](1.00000, 1.30000, 1.69000, 2.19700, 2.85610, 3.71293, 4.82681, 6.27485, 8.15731, 10.60450, 13.78585, 17.92160);
  const float WATER_BAND_T[12] = float[12](0.0000, 0.0909, 0.1818, 0.2727, 0.3636, 0.4545, 0.5455, 0.6364, 0.7273, 0.8182, 0.9091, 1.0000);
  for (int bandIndex = 0; bandIndex < 12 + uLoopGuard; bandIndex++) {
    waterSpectrumBand(p, slope, lost, primary, kBase * WATER_BAND_K[bandIndex], kBase, WATER_BAND_T[bandIndex], float(bandIndex), t, speed, footprint, detail * microFade, mediumWeight, largePatchA, largePatchB, mediumPatchA, mediumPatchB, smallPatch, regionalA - regionalB);
  }
`;
    m.fragmentShader = src.slice(0, start) + block + src.slice(end);
    m.defines = { ...m.defines, WATER_LOOP_BUST: Math.floor(Math.random() * 1e9) };
    m.needsUpdate = true;
    const t0 = performance.now();
    await e.renderer.compileAsync(e.scene, e.camera);
    return { compileMs: Math.round(performance.now() - t0) };
  });
  console.log('loop variant', JSON.stringify(res));
  await h.setPose(view.pose);
  await h.settle({ timeoutMs: 60000, idleFrames: 10, minFrames: 10 });
  await h.setPose(view.pose);
  await shot(path.join(dir, 'b', 'water.png'));
  const after = await h.measure({ frames: 30, warmup: 6 });
  // reference: cold compile time of the ORIGINAL straight-line source
  const ref = await page.evaluate(async () => {
    const e = window.__engine;
    window.__h.unfreeze();
    const m = e.water.material.clone();
    m.fragmentShader = window.__origWater || m.fragmentShader;
    return null;
  });
  console.log('gpu before', before.gpuMs?.mean, 'after', after.gpuMs?.mean);
}
