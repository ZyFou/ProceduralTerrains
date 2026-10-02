// Multiply the current Tile LOD distance scale by FACTOR (1/0.65 restores the
// original [8,15,24] chunk bands) and report GPU + visual diff vs baseline.
import fs from 'node:fs';
import path from 'node:path';
import { compareImages } from '../compare.mjs';

export default async function ({ page, h, scene, shot, ROOT }) {
  const factors = (process.env.FACTORS || '1,1.5385').split(',').map(Number);
  const base0 = await page.evaluate(() => window.__engine.board._distanceScale);
  for (const f of factors) {
    await page.evaluate((s) => { const e = window.__engine; e.board.setLodDistanceScale(s); e._lastLodUpdate = 0; }, base0 * f);
    const dir = path.join(ROOT, 'output', 'perf-harness', 'runs', `exp-lodrestore-${f}`, 'shots');
    fs.mkdirSync(dir, { recursive: true });
    for (const view of scene.views) {
      await h.setPose(view.pose);
      await h.settle({ timeoutMs: 90000 });
      await h.setPose(view.pose);
      const file = path.join(dir, `${scene.id}--${view.id}.png`);
      await shot(file);
      const ms = [];
      let tris = 0;
      for (let r = 0; r < 2; r++) { const m = await h.measure({ frames: 30, warmup: 6 }); ms.push(m.gpuMs?.median); tris = m.triangles.median; }
      const ref = path.join(ROOT, 'output', 'perf-harness', 'runs', 'baseline', 'shots', `${scene.id}--${view.id}.png`);
      const d = await compareImages(ref, file);
      console.log('factor', f, view.id.padEnd(9), 'gpu', Math.min(...ms), 'tris', tris, 'vsBaseline MAE', d.maePct, 'dSSIM', d.dssimPct, '>16', d.over16Pct);
    }
  }
}
