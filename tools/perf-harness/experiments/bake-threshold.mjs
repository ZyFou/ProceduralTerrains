// Sweep the live/baked crossover (uBakeBlend, in bake texels per pixel
// footprint) and report GPU time + visual diff against the current setting.
import fs from 'node:fs';
import path from 'node:path';
import { compareImages } from '../compare.mjs';

export default async function ({ page, h, scene, shot, ROOT }) {
  const dir = path.join(ROOT, 'output', 'perf-harness', 'bake-threshold');
  fs.mkdirSync(dir, { recursive: true });
  const settings = (process.env.BLENDS || '0.75:1.25,0.5:0.85,0.35:0.6,0.25:0.4,-2:-1')
    .split(',').map((s) => s.split(':').map(Number));
  for (const viewId of (process.env.VIEW || 'close,grazing').split(',')) {
    const view = scene.views.find((v) => v.id === viewId);
    await h.setPose(view.pose);
    await h.settle({ timeoutMs: 90000 });
    const rows = [];
    for (const [a, b] of settings) {
      await page.evaluate(([x, y]) => { window.__engine.uniforms.uBakeBlend.value.set(x, y); }, [a, b]);
      await h.setPose(view.pose);
      const ms = [];
      for (let r = 0; r < 2; r++) ms.push((await h.measure({ frames: 30, warmup: 6 })).gpuMs?.median);
      const file = path.join(dir, `${scene.id}-${viewId}-${a}_${b}.png`);
      await h.setPose(view.pose);
      await shot(file);
      const diff = rows.length ? await compareImages(rows[0].file, file) : null;
      rows.push({ blend: `${a}:${b}`, gpu: Math.min(...ms), file, diff });
      console.log(viewId, `${a}:${b}`.padEnd(10), 'gpu', Math.min(...ms), diff ? JSON.stringify(diff) : '');
    }
    await page.evaluate(() => { window.__engine.uniforms.uBakeBlend.value.set(0.75, 1.25); });
  }
}
