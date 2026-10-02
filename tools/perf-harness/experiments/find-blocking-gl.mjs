// Wrap every WebGL2 method; run the engine's own cold compile path and report
// any GL call that blocks > 50 ms, with its JS stack.
export default async function ({ page }) {
  const res = await page.evaluate(async () => {
    const e = window.__engine;
    const gl = e.renderer.getContext();
    const proto = Object.getPrototypeOf(gl);
    const slow = [];
    const originals = {};
    for (const name of Object.getOwnPropertyNames(proto)) {
      const d = Object.getOwnPropertyDescriptor(proto, name);
      if (typeof d?.value !== 'function' || name === 'constructor') continue;
      originals[name] = gl[name];
      gl[name] = function (...args) {
        const t0 = performance.now();
        const v = originals[name].apply(gl, args);
        const ms = performance.now() - t0;
        if (ms > 50) slow.push({ name, ms: Math.round(ms), arg: typeof args[1] === 'number' ? args[1] : null, stack: new Error().stack.split('\n').slice(2, 9).map((s) => s.trim().replace(/https?:\/\/[^/]+/, '')).join(' | ') });
        return v;
      };
    }
    const m = e.terrainMaterial;
    m.defines = { ...m.defines, FIND_PROBE: Math.floor(Math.random() * 1e9) };
    m.needsUpdate = true;
    const t0 = performance.now();
    const r = await e._compileMaterialVariants([m], { canvasOnly: true, timeoutMs: 120000 });
    const total = performance.now() - t0;
    for (const [name, fn] of Object.entries(originals)) gl[name] = fn;
    return { total: Math.round(total), ready: r?.ready, slow };
  });
  console.log(JSON.stringify(res, null, 1));
}
