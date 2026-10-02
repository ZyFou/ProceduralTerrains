// Reproduce "huge lag when zooming close to the terrain": right after boot,
// zoom from the overview to a close view in real frames (no settle), then
// hold the close view while background work (detail pages, surface atlas,
// shader variants) completes. Reports every frame over 100 ms together with
// the slow WebGL calls inside it (name, ms, JS stack) and the terrain variant.
//
//   node tools/perf-harness/probe.mjs tools/perf-harness/experiments/zoom-lag.mjs --scene studio --cold
export default async function ({ page, scene }) {
  await page.evaluate(() => {
    const slow = [];
    window.__slowGl = slow;
    Error.stackTraceLimit = 60;
    const proto = WebGL2RenderingContext.prototype;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const desc = Object.getOwnPropertyDescriptor(proto, name);
      if (typeof desc?.value !== 'function' || name === 'constructor') continue;
      const fn = desc.value;
      proto[name] = function (...a) {
        const t0 = performance.now();
        const r = fn.apply(this, a);
        const ms = performance.now() - t0;
        if (ms > 40) {
          let program = null;
          if (a[0] instanceof WebGLProgram) {
            const info = window.__engine?.renderer?.info?.programs?.find((p) => p.program === a[0]);
            program = info ? { name: info.name, type: info.type, key: String(info.cacheKey), usedTimes: info.usedTimes } : 'unknown';
          }
          slow.push({
            name, ms: Math.round(ms), at: Math.round(t0), program,
            stack: new Error('gl').stack.split(String.fromCharCode(10)).slice(10, 40).filter((l) => !/chunk-|harness-entry/.test(l))
              .map((l) => l.trim().replace(/\(http:\/\/[^)]*\/src\//, '(').replace(/\?[^:)]*/, '')).join(' < '),
          });
        }
        return r;
      };
    }
  });
  const genericPath = scene.id.startsWith('studio') ? null : scene.paths?.[0]?.path;
  if (genericPath) {
    // Infinite / planet: fly the scene's own path in timed frames, then hold.
    await page.evaluate(async (path) => {
      await window.__h.measure({ frames: 240, warmup: 0, path });
      await window.__h.measure({ frames: 600, warmup: 0 });
    }, genericPath);
    const out = await page.evaluate(() => ({
      programs: window.__engine.renderer.info.programs?.length,
      slowGl: window.__slowGl.slice(0, 40),
      stallLogs: (window.__h.consoleLines || []).filter((l) => /stall/i.test(l.text)).map((l) => l.t + ' ' + l.text),
    }));
    console.log(JSON.stringify(out, null, 1));
    return;
  }
  const out = await page.evaluate(async () => {
    const h = window.__h;
    const e = window.__engine;
    const frames = [];
    const run = async (count, poseAt) => {
      h.unfreeze?.();
      for (let i = 0; i < count; i++) {
        if (poseAt) h.setPose(poseAt(i / Math.max(1, count - 1)));
        const t0 = performance.now();
        e._tick();
        const ms = performance.now() - t0;
        if (ms > 100) {
          frames.push({
            i, ms: Math.round(ms), at: Math.round(t0),
            variant: e.terrainMaterial?.userData?.terrainVariant,
            compiling: !!e._compiling,
          });
        }
        await new Promise((r) => requestAnimationFrame(() => r()));
      }
    };
    const lerp = (a, b, t) => a + (b - a) * t;
    const from = { radiusFactor: 1.4, phi: 55, theta: 45, target: [0, 0, 0] };
    const to = { radiusFactor: 0.12, phi: 74, theta: 130, target: [0.08, 150, -0.06] };
    const pose = (t) => ({
      radiusFactor: Math.exp(lerp(Math.log(from.radiusFactor), Math.log(to.radiusFactor), t)),
      phi: lerp(from.phi, to.phi, t),
      theta: lerp(from.theta, to.theta, t),
      target: from.target.map((v, k) => lerp(v, to.target[k], t)),
    });
    const t0 = performance.now();
    await run(240, pose);
    const zoomMs = performance.now() - t0;
    await run(900, null);
    return {
      zoomMs: Math.round(zoomMs),
      totalMs: Math.round(performance.now() - t0),
      variant: e.terrainMaterial?.userData?.terrainVariant,
      programs: e.renderer.info.programs?.length,
      programKeys: (e.renderer.info.programs || []).filter((p) => /OCTAVES/.test(p.cacheKey)).map((p) => ({ type: p.type, used: p.usedTimes, key: p.cacheKey })),
      frames,
      slowGl: window.__slowGl.slice(0, 40),
      stallLogs: (h.consoleLines || []).filter((l) => /stall|shader|variant/i.test(l.text)).map((l) => l.t + ' ' + l.text.slice(0, 260)).slice(-25),
    };
  });
  console.log(JSON.stringify(out, null, 1));
}
