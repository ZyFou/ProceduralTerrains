// Planet LOD-pop investigation: replicate popTest along the planet pop path,
// keep the frozen (A) and re-selected (B) images of the worst frame plus the
// LOD/fold state on both sides.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export default async function ({ page, scene, ROOT }) {
  const out = await page.evaluate(async (pop) => {
    const e = window.__engine;
    const h = window.__h;
    h.freeze();
    const gl = e.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const hh = gl.drawingBufferHeight;
    const buf = new Uint8Array(w * hh * 4);
    const yieldTask = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
    const tick = () => { e._needsRender = true; e._lastUserActivityAt = performance.now(); e._tick(); };
    const read = () => { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, hh, gl.RGBA, gl.UNSIGNED_BYTE, buf); return buf.slice(); };
    const lerp = (a, b, t) => a + (b - a) * t;
    const poseAt = (t) => {
      const p = pop.path; const seg = Math.min(p.length - 2, Math.floor(t * (p.length - 1)));
      const u = t * (p.length - 1) - seg; const A = p[seg]; const B = p[seg + 1];
      const r = {}; for (const k of Object.keys(A)) r[k] = Array.isArray(A[k]) ? A[k].map((v, i) => lerp(v, B[k][i], u)) : lerp(A[k], B[k], u);
      return r;
    };
    const state = () => {
      const pw = e.planetWorld;
      return {
        merged: pw._mergedPatches.length,
        visiblePatches: pw._mergedPatches.filter((p) => p.visible).length,
        batchCounts: pw.batches.map((b) => b.mesh.count).join(','),
        patchCounts: [...pw._patchBatches.values()].map((b) => b.mesh.count).join(','),
        lod: pw.lodCounts.join(','),
        morphing: pw.morphingChunkCount,
        useClimate: e.uniforms.uUsePlanetClimateTex?.value,
      };
    };
    let worst = { over: -1 };
    for (let i = 0; i < pop.frames; i++) {
      h.setPose(poseAt(i / (pop.frames - 1)));
      e._debug.freezeLod = true;
      tick();
      const sa = state();
      const a = read();
      await yieldTask();
      e._debug.freezeLod = false;
      e._lastLodUpdate = 0;
      e.planetWorld._lastUpdateAt = performance.now() - 1000 / 60;
      tick();
      const sb = state();
      const b = read();
      let over = 0;
      for (let k = 0; k < a.length; k += 4) {
        const la = 0.299 * a[k] + 0.587 * a[k + 1] + 0.114 * a[k + 2];
        const lb = 0.299 * b[k] + 0.587 * b[k + 1] + 0.114 * b[k + 2];
        if (Math.abs(la - lb) > 16) over++;
      }
      const overPct = over / (w * hh) * 100;
      if (overPct > worst.over) worst = { over: overPct, i, sa, sb, a: Array.from(a), b: Array.from(b) };
      await yieldTask();
    }
    return { w, h: hh, worst };
  }, scene.popPath);
  const dir = path.join(ROOT, 'output', 'perf-harness', 'planet-pop');
  fs.mkdirSync(dir, { recursive: true });
  for (const k of ['a', 'b']) {
    await sharp(Buffer.from(out.worst[k]), { raw: { width: out.w, height: out.h, channels: 4 } }).flip().png().toFile(path.join(dir, `worst-${k}.png`));
  }
  console.log(JSON.stringify({ frame: out.worst.i, overPct: out.worst.over, A: out.worst.sa, B: out.worst.sb }, null, 1));
}
