// Idle cost: with the real animation loop + default energy policy and a still
// camera, how many scene renders happen per second? (On-demand rendering
// should only produce the ~1 Hz heartbeat.)
export default async function ({ page, h }) {
  await h.settle({ timeoutMs: 60000 });
  const res = await page.evaluate(async () => {
    const e = window.__engine;
    window.__h.unfreeze();
    e.setPerfSetting('energyMode', 'balanced');
    e._lastUserActivityAt = performance.now() - 10000;
    e._energyActivityAt = performance.now() - 10000;
    await new Promise((r) => setTimeout(r, 3000));
    const c0 = window.__sceneRenders || 0;
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, 5000));
    const n = (window.__sceneRenders || 0) - c0;
    return { rendersPerSec: +(n / ((performance.now() - t0) / 1000)).toFixed(2), minimapDirty: e.minimap._dirty, needsBase: e.minimap.needsBaseRender, onDemand: e.perf.onDemandStudio };
  });
  console.log(JSON.stringify(res));
}
