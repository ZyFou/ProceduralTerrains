// Capture + measure every view of the chosen scene into runs/<label>/shots.
import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, h, scene, shot, ROOT }) {
  const label = process.env.LABEL || 'exp-capture';
  const dir = path.join(ROOT, 'output', 'perf-harness', 'runs', label, 'shots');
  fs.mkdirSync(dir, { recursive: true });
  for (const view of scene.views) {
    await h.setPose(view.pose);
    const st = await h.settle({ timeoutMs: 120000 });
    await h.setPose(view.pose);
    await shot(path.join(dir, `${scene.id}--${view.id}.png`));
    const m = await h.measure({ frames: 40, warmup: 8 });
    const lod = await page.evaluate(() => { const e = window.__engine; const w = e.board && e.worldMode === 'studio' ? e.board : e.infiniteWorld || e.planetWorld; return { lod: w?.lodCounts, merged: w?.mergedGroupCount, bands: w?.morphBands }; });
    console.log(view.id.padEnd(9), 'frame', m.frameMs.mean, 'gpu', m.gpuMs?.mean, 'tris', m.triangles.mean, 'draws', m.drawCalls.mean, JSON.stringify(lod), 'idle', st.idle);
  }
}
