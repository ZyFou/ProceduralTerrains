// Re-capture a scene's views and diff them against a previous harness run.
//   REF=it8 node tools/perf-harness/probe.mjs tools/perf-harness/experiments/verify-vs-run.mjs --scene studio-full
import fs from 'node:fs';
import path from 'node:path';
import { compareImages } from '../compare.mjs';
export default async function ({ h, scene, shot, ROOT }) {
  const ref = process.env.REF || 'it8';
  const dir = path.join(ROOT, 'output', 'perf-harness', 'verify');
  fs.mkdirSync(dir, { recursive: true });
  for (const view of scene.views) {
    await h.setPose(view.pose);
    await h.settle({ timeoutMs: 90000 });
    await h.setPose(view.pose);
    const file = path.join(dir, `${scene.id}--${view.id}.png`);
    await shot(file);
    const ms = [];
    const fr = [];
    const cpu = [];
    let tris = 0; let draws = 0;
    for (let r = 0; r < 2; r++) {
      const m = await h.measure({ frames: 30, warmup: 6 });
      ms.push(m.gpuMs?.median); fr.push(m.frameMs?.median); cpu.push(m.cpuMs?.median); tris = m.triangles.median; draws = m.drawCalls.median;
    }
    const d = await compareImages(path.join(ROOT, 'output', 'perf-harness', 'runs', ref, 'shots', `${scene.id}--${view.id}.png`), file);
    console.log('verify', view.id.padEnd(9), 'frame', Math.min(...fr), 'cpu', Math.min(...cpu), 'tris', tris, 'draws', draws, 'gpu', Math.min(...ms), `vs ${ref}: MAE ${d.maePct} dSSIM ${d.dssimPct} >16 ${d.over16Pct}`);
  }
}
