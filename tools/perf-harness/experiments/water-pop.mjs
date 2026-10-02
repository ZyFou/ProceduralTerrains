// LOD-induced image change with water near terrain, with and without the
// water depth pull (VARIANT=nopull disables it). Uses the scene's pop path.
//   node tools/perf-harness/probe.mjs tools/perf-harness/experiments/water-pop.mjs --scene planet
// env PARAMS=<json>, VARIANT=nopull, POP=<json path override>, FRAMES=n
export default async function ({ page, h, scene }) {
  if (process.env.PARAMS) await h.setParams(JSON.parse(process.env.PARAMS));
  await page.evaluate((variant) => {
    const e = window.__engine;
    if (variant === 'nopull') e._syncWaterDepthPull = () => { e.uniforms.uWaterDepthPull.value = 0; };
    // scaleN: tolerance N x the default (same caps scaled)
    const m = /^scale([\d.]+)$/.exec(variant);
    if (m) {
      const k = Number(m[1]);
      const original = e._syncWaterDepthPull.bind(e);
      e._syncWaterDepthPull = (camera) => {
        original(camera);
        e.uniforms.uWaterDepthPull.value = Math.min(0.2 * k, e.uniforms.uWaterDepthPull.value * k);
      };
    }
  }, process.env.VARIANT || '');
  await h.settle();
  const path = process.env.POP ? JSON.parse(process.env.POP) : scene.popPath.path;
  const frames = Number(process.env.FRAMES || scene.popPath?.frames || 300);
  const result = await h.popTest({ path, frames });
  const { worst, ...summary } = result;
  console.log(process.env.VARIANT || 'pull', JSON.stringify(summary), 'worst', JSON.stringify({ frame: worst.frame, overPct: worst.overPct }));
}
