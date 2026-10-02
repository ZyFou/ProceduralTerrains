// studio-full split: water / clouds / props / refraction capture, per view.
//   VIEW=close node tools/perf-harness/probe.mjs tools/perf-harness/experiments/gpu-attribution4.mjs --scene studio-full
export default async function ({ page, h, scene }) {
  for (const viewId of (process.env.VIEW || 'overview,close').split(',')) {
    const view = scene.views.find((v) => v.id === viewId);
    await h.setPose(view.pose);
    await h.settle({ timeoutMs: 90000 });
    const run = async (label) => {
      await h.setPose(view.pose);
      const ms = [];
      for (let r = 0; r < 2; r++) ms.push((await h.measure({ frames: 30, warmup: 6 })).gpuMs?.median);
      console.log(viewId, label.padEnd(36), 'gpu', Math.min(...ms));
    };
    await run('full');
    const toggles = [
      ['no clouds', (e) => { e.studioCloud?.setInScene?.(false); }, (e) => { e.studioCloud?.setInScene?.(true); }],
      ['no props', (e) => { if (e.propsManager?.group) e.propsManager.group.visible = false; }, (e) => { if (e.propsManager?.group) e.propsManager.group.visible = true; }],
      ['water taps 1', (e) => { const u = e.water?.material?.uniforms; if (u?.uWaterHeightTaps) u.uWaterHeightTaps.value = 1; }, (e) => { const u = e.water?.material?.uniforms; if (u?.uWaterHeightTaps) u.uWaterHeightTaps.value = 4; }],
      ['no refraction', (e) => { const u = e.water?.material?.uniforms; if (u?.uSceneRefractionEnabled) u.uSceneRefractionEnabled.value = 0; }, (e) => { const u = e.water?.material?.uniforms; if (u?.uSceneRefractionEnabled) u.uSceneRefractionEnabled.value = 1; }],
      ['no water', (e) => { if (e.water) e.water.visible = false; }, (e) => { if (e.water) e.water.visible = true; }],
    ];
    for (const [label, off, on] of toggles) {
      const ok = await page.evaluate((src) => { const e = window.__engine; (0, eval)(src)(e); return true; }, off.toString());
      if (ok) await run(label);
      await page.evaluate((src) => { const e = window.__engine; (0, eval)(src)(e); }, on.toString());
    }
    console.log(viewId, 'info', JSON.stringify(await page.evaluate(() => {
      const e = window.__engine;
      return {
        props: Object.keys(e).filter((k) => /prop/i.test(k)).slice(0, 8),
        cloud: !!e.studioCloud, waterType: e.water?.material?.type,
        taps: e.water?.material?.uniforms?.uWaterHeightTaps?.value,
      };
    })));
  }
}
