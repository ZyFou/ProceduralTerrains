// LOD distance / density sweep: perf + captures per setting.
import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, h, scene, shot, ROOT }) {
  const scales = (process.env.SCALES || '1,0.75,0.5').split(',').map(Number);
  for (const sc of scales) {
    await page.evaluate((s) => { const e = window.__engine; e.board.setLodDistanceScale(s); e._lastLodUpdate = 0; }, sc);
    const dir = path.join(ROOT, 'output', 'perf-harness', 'runs', `exp-lod-${sc}`, 'shots');
    fs.mkdirSync(dir, { recursive: true });
    for (const view of scene.views) {
      await h.setPose(view.pose);
      await h.settle({ timeoutMs: 60000, idleFrames: 15, minFrames: 20 });
      await h.setPose(view.pose);
      await shot(path.join(dir, `${scene.id}--${view.id}.png`));
      const m = await h.measure({ frames: 40, warmup: 8 });
      const lod = await page.evaluate(() => window.__engine.board.lodCounts);
      console.log('scale', sc, view.id.padEnd(9), 'frame', m.frameMs.mean, 'gpu', m.gpuMs?.mean, 'tris', m.triangles.mean, 'lod', JSON.stringify(lod));
    }
  }
}
