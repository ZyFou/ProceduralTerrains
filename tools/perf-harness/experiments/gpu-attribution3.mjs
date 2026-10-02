// Close-view split: live terrain height vs water, with water visible.
export default async function ({ page, h, scene }) {
  const view = scene.views.find((v) => v.id === (process.env.VIEW || 'close'));
  await h.setPose(view.pose);
  await h.settle({ timeoutMs: 90000 });
  const run = async (label) => {
    await h.setPose(view.pose);
    const ms = [];
    for (let r = 0; r < 2; r++) ms.push((await h.measure({ frames: 40, warmup: 8 })).gpuMs?.median);
    console.log(label.padEnd(40), 'gpu', Math.min(...ms));
  };
  const info = await page.evaluate(() => {
    const e = window.__engine;
    const w = e.water;
    return {
      waterMode: e.params.waterMode, waterMat: w?.material?.type, waterName: w?.material?.name,
      bakeBlend: e.uniforms.uBakeBlend.value.toArray(), bakeTexel: e.uniforms.uBakeTexelWorld.value,
      pixelWorld: e.uniforms.uPixelWorldPerDist.value,
      waterUsesBake: Object.keys(w?.material?.uniforms || {}).filter((k) => /Bake|Height/.test(k)),
    };
  });
  console.log(JSON.stringify(info));
  await run('full');
  await page.evaluate(() => { window.__engine.uniforms.uBakeBlend.value.set(-2, -1); });
  await run('bake everywhere (shared uniform)');
  await page.evaluate(() => { const w = window.__engine.water; if (w) w.visible = false; });
  await run('bake everywhere, no water');
  await page.evaluate(() => { const e = window.__engine; e.uniforms.uBakeBlend.value.set(0.75, 1.25); });
  await run('live hybrid, no water');
}
