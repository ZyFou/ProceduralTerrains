// Real-time camera motion capture: moves the camera along a pose path at
// ~60 fps wall time (temporal geomorphs, folds and bakes run as in the app)
// and saves every Nth rendered frame, plus per-frame water/LOD state.
//   node tools/perf-harness/probe.mjs tools/perf-harness/experiments/motion-frames.mjs --scene planet
// env VIEW=<json pose path>, FRAMES=n, EVERY=k, PARAMS=<json>, VARIANT=nopull, TAG=name
import fs from 'node:fs';
import path from 'node:path';

export default async function ({ page, h, scene, ROOT }) {
  const tag = process.env.TAG || `${scene.id}-motion`;
  const dir = path.join(ROOT, 'output', 'perf-harness', 'motion', tag);
  fs.mkdirSync(dir, { recursive: true });
  if (process.env.PARAMS) await h.setParams(JSON.parse(process.env.PARAMS));
  await h.settle();
  const poses = process.env.VIEW ? JSON.parse(process.env.VIEW) : scene.popPath.path;
  const frames = Number(process.env.FRAMES || 120);
  const every = Number(process.env.EVERY || 10);
  const out = await page.evaluate(async ({ poses, frames, every, variant }) => {
    const e = window.__engine;
    const hh = window.__h;
    if (variant === 'nopull') e._syncWaterDepthPull = () => { e.uniforms.uWaterDepthPull.value = 0; };
    hh.unfreeze();
    e.renderer.setAnimationLoop(null);
    const canvas = e.renderer.domElement;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const lerp = (a, b, t) => a + (b - a) * t;
    const poseAt = (t) => {
      const p = poses; const seg = Math.min(p.length - 2, Math.floor(t * (p.length - 1)));
      const u = t * (p.length - 1) - seg; const A = p[seg]; const B = p[seg + 1];
      const r = {}; for (const k of Object.keys(A)) r[k] = Array.isArray(A[k]) ? A[k].map((v, i) => lerp(v, B[k][i], u)) : lerp(A[k], B[k], u);
      return r;
    };
    const shots = [];
    const states = [];
    for (let i = 0; i < frames; i++) {
      hh.setPose(poseAt(i / Math.max(1, frames - 1)));
      let rendered = false;
      for (let attempt = 0; attempt < 6 && !rendered; attempt++) {
        const before = window.__sceneRenders || 0;
        e._needsRender = true;
        e._lastUserActivityAt = performance.now();
        e._tick();
        rendered = (window.__sceneRenders || 0) > before;
        if (rendered && i % every === 0) shots.push(canvas.toDataURL('image/png'));
        if (!rendered) await sleep(4);
      }
      const pw = e.planetWorld;
      if (i % every === 0) {
        states.push({
          i, rendered,
          morphing: pw?.morphingChunkCount, lod: pw?.lodCounts?.join(','),
          pull: +(e.uniforms.uWaterDepthPull?.value ?? 0).toFixed(4),
          bake: e.planetHeightBaker?._phase ?? null, gen: e._terrainGen,
        });
      }
      await sleep(16);
    }
    return { shots, states };
  }, { poses, frames, every, variant: process.env.VARIANT || '' });
  out.shots.forEach((url, i) => fs.writeFileSync(path.join(dir, `m${String(i).padStart(2, '0')}.png`), Buffer.from(url.split(',')[1], 'base64')));
  console.log(JSON.stringify(out.states));
}
