// The probe page has already booted (warm). Re-run a COLD compile of the live
// terrain program on the main thread (unique define) while profiling, to see
// which call blocks the main thread during compilation.
export default async function ({ page }) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await cdp.send('Profiler.start');
  const res = await page.evaluate(async () => {
    const e = window.__engine;
    const m = e.terrainMaterial;
    const longest = { ms: 0 };
    // event-loop stall monitor
    let last = performance.now();
    const gaps = [];
    const iv = setInterval(() => { const n = performance.now(); if (n - last > 100) gaps.push(Math.round(n - last)); last = n; }, 20);
    m.defines = { ...m.defines, COLD_PROBE: Math.floor(Math.random() * 1e9) };
    m.needsUpdate = true;
    const t0 = performance.now();
    const r = await e._compileMaterialVariants([m], { canvasOnly: true, timeoutMs: 120000, logCompile: true });
    const ms = performance.now() - t0;
    clearInterval(iv);
    return { ms: Math.round(ms), ready: r?.ready, sync: r?.syncCompileMs, async: r?.asyncWaitMs, validation: r?.validationMs, gaps };
  });
  const { profile } = await cdp.send('Profiler.stop');
  console.log(JSON.stringify(res));
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const self = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    let id = profile.samples[i];
    const dt = (profile.timeDeltas[i] || 0) / 1000;
    // attribute to the stack (self + up to 6 parents) to find the blocking caller
    const n = byId.get(id);
    const stack = [];
    let cur = id; let depth = 0;
    while (cur != null && depth < 8) { const nn = byId.get(cur); stack.push(`${nn.callFrame.functionName || '(anon)'}@${nn.callFrame.url.split('/').pop()}:${nn.callFrame.lineNumber + 1}`); cur = parent.get(cur); depth++; }
    const key = stack.join(' <- ');
    self.set(key, (self.get(key) || 0) + dt);
  }
  for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(v.toFixed(0).padStart(7), 'ms', k);
}
