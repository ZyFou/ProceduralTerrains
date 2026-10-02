// Visual cost of geomorphing vs the baseline captures: morph off, band
// fraction sweep, and LOD distance factor. CASES="factor:fraction|off,..."
import fs from 'node:fs';
import path from 'node:path';
import { compareImages } from '../compare.mjs';

export default async function ({ page, h, scene, shot, ROOT }) {
  const cases = (process.env.CASES || '1:off,1:0.3,1:0.1,1.25:0.1').split(',');
  const base0 = await page.evaluate(() => window.__engine.board._distanceScale);
  const views = scene.views.filter((v) => (process.env.VIEW || 'close,grazing,overview').split(',').includes(v.id));
  for (const c of cases) {
    const [factor, frac, gate] = c.split(':');
    await page.evaluate(async ({ s, frac: fr, gate: g }) => {
      const e = window.__engine;
      const b = e.board;
      if (g === 'nogate') Object.defineProperty(b, '_losslessFoldDistance', { configurable: true, get: () => 0 });
      else delete b._losslessFoldDistance;
      b.setLodDistanceScale(s);
      const { planMorphBands } = await import('/src/engine/terrain/LodMorph.js');
      if (fr === 'off') { b.setMorphEnabled(false); } else {
        b.setMorphEnabled(true);
        b.morphBands = planMorphBands(b.lodThresholds, b.chunkSize * Math.SQRT1_2, Number(fr));
        b._publishMorph();
      }
      e._lastLodUpdate = 0;
    }, { s: base0 * Number(factor), frac, gate });
    const dir = path.join(ROOT, 'output', 'perf-harness', 'runs', `exp-morph-${factor}-${frac}-${gate || 'gate'}`, 'shots');
    fs.mkdirSync(dir, { recursive: true });
    for (const view of views) {
      await h.setPose(view.pose);
      await h.settle({ timeoutMs: 90000 });
      // re-plan after settle (thresholds may be recomputed by updateLOD)
      await page.evaluate(async (fr) => {
        if (fr === 'off') return;
        const b = window.__engine.board;
        const { planMorphBands } = await import('/src/engine/terrain/LodMorph.js');
        b.morphBands = planMorphBands(b.lodThresholds, b.chunkSize * Math.SQRT1_2, Number(fr));
        b._publishMorph();
      }, frac);
      await h.setPose(view.pose);
      const file = path.join(dir, `${scene.id}--${view.id}.png`);
      await shot(file);
      const m = await h.measure({ frames: 30, warmup: 6 });
      const ref = path.join(ROOT, 'output', 'perf-harness', 'runs', 'baseline', 'shots', `${scene.id}--${view.id}.png`);
      const d = await compareImages(ref, file);
      console.log('case', c.padEnd(9), view.id.padEnd(9), 'gpu', m.gpuMs?.median, 'tris', m.triangles.median, 'MAE', d.maePct, 'dSSIM', d.dssimPct, '>16', d.over16Pct);
    }
  }
}
