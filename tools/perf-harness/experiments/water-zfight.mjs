// Water/terrain flicker investigation. Captures a short camera move over a
// shoreline and the per-frame state of the height caches the water reads.
//   node tools/perf-harness/probe.mjs tools/perf-harness/experiments/water-zfight.mjs --scene studio
// env VIEW=<json pose list>, FRAMES=n, TAG=name
import fs from 'node:fs';
import path from 'node:path';

export default async function ({ page, h, scene, ROOT }) {
  const dir = path.join(ROOT, 'output', 'perf-harness', 'water-zfight', process.env.TAG || scene.id);
  fs.mkdirSync(dir, { recursive: true });
  const poses = process.env.VIEW ? JSON.parse(process.env.VIEW) : null;
  const frames = Number(process.env.FRAMES || 8);
  const variant = process.env.VARIANT || '';
  if (process.env.PARAMS) await h.setParams(JSON.parse(process.env.PARAMS));
  await h.settle();
  const result = await page.evaluate(async ({ poses, frames, variant }) => {
    const e = window.__engine;
    const hh = window.__h;
    hh.freeze();
    const yieldTask = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
    const lerp = (a, b, t) => a + (b - a) * t;
    const poseAt = (t) => {
      const p = poses; const seg = Math.min(p.length - 2, Math.floor(t * (p.length - 1)));
      const u = t * (p.length - 1) - seg; const A = p[seg]; const B = p[seg + 1];
      const r = {}; for (const k of Object.keys(A)) r[k] = Array.isArray(A[k]) ? A[k].map((v, i) => lerp(v, B[k][i], u)) : lerp(A[k], B[k], u);
      return r;
    };
    if (variant === 'live') { e._debug.disableHeightBake = true; }
    // nopull: the previous behaviour (water depth-tested exactly against the mesh)
    if (variant === 'nopull') e._syncWaterDepthPull = () => { e.uniforms.uWaterDepthPull.value = 0; };
    const states = [];
    const shots = [];
    for (let i = 0; i < frames; i++) {
      hh.setPose(poseAt(frames > 1 ? i / (frames - 1) : 0));
      for (let k = 0; k < 2; k++) { e._needsRender = true; e._lastUserActivityAt = performance.now(); e._tick(); await yieldTask(); }
      const u = e.uniforms;
      const b = e.planetHeightBaker;
      states.push({
        i,
        gen: e._terrainGen,
        useH: u.uUseTerrainHeightTex?.value, useNear: u.uUseNearBake?.value,
        usePH: u.uUsePlanetHeightTex?.value, usePC: u.uUsePlanetClimateTex?.value,
        pPhase: b?._phase, pFace: b?._face, pBaked: e._bakedTerrainGen,
        cam: e.camera.position.toArray().map((v) => Math.round(v)),
        near: e.camera.near, far: e.camera.far,
      });
      shots.push(await hh.capture());
    }
    return { states, shots };
  }, { poses: poses || [scene.views[0].pose, scene.views[0].pose], frames, variant });
  const sharp = (await import('sharp')).default;
  const raws = [];
  for (const [i, url] of result.shots.entries()) {
    const buf = Buffer.from(url.split(',')[1], 'base64');
    fs.writeFileSync(path.join(dir, `f${String(i).padStart(2, '0')}.png`), buf);
    raws.push(await sharp(buf).removeAlpha().raw().toBuffer());
  }
  // consecutive-frame flips: pixels whose luma jumps > 24 between two nearly
  // identical poses (z-fighting / dry-patch flicker shows up here)
  const flips = [];
  for (let i = 1; i < raws.length; i++) {
    const a = raws[i - 1]; const b = raws[i]; let n = 0;
    for (let k = 0; k < a.length; k += 3) {
      const la = 0.299 * a[k] + 0.587 * a[k + 1] + 0.114 * a[k + 2];
      const lb = 0.299 * b[k] + 0.587 * b[k + 1] + 0.114 * b[k + 2];
      if (Math.abs(la - lb) > 24) n++;
    }
    flips.push(+(n / (a.length / 3) * 100).toFixed(3));
  }
  console.log('flips%', JSON.stringify(flips), 'mean', (flips.reduce((x, y) => x + y, 0) / Math.max(1, flips.length)).toFixed(3));
  console.log(JSON.stringify(result.states.map((st) => ({ i: st.i, cam: st.cam }))));
}
