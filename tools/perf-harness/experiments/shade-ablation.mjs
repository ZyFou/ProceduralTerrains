// One ablation per fresh page (ABLATE=none|climate|climate4): patch the live
// terrain material, wait for the link, then time the scene's views.
export default async function ({ page, h, scene }) {
  const mode = process.env.ABLATE || 'none';
  await h.setPose(scene.views[1].pose);
  await h.settle({ timeoutMs: 90000 });
  await page.evaluate(async (m) => {
    const e = window.__engine;
    const mat = e.terrainMaterial;
    let src = mat.fragmentShader;
    if (m === 'climate') {
      src = src.replace('Climate cl = climateAt(xz * uFrequency + uSeedOffset);', 'Climate cl = Climate(0.5, 0.5, 0.5, 0.5, 0.5);');
    } else if (m === 'climate4') {
      // keep only the high-frequency region channel live
      src = src.replace('Climate cl = climateAt(xz * uFrequency + uSeedOffset);',
        'Climate cl = Climate(0.5, 0.5, 0.5, 0.5, fbm3((xz * uFrequency + uSeedOffset) * 0.700 + vec2(631.4, 199.2)));');
    }
    if (src === mat.fragmentShader && m !== 'none') throw new Error('patch did not apply');
    mat.fragmentShader = src;
    mat.needsUpdate = true;
    window.__h.unfreeze();
    await e.renderer.compileAsync(e.scene, e.camera);
    for (let i = 0; i < 5; i++) { e._needsRender = true; e._tick(); await new Promise((r) => setTimeout(r, 50)); }
  }, mode);
  for (const view of scene.views) {
    await h.setPose(view.pose);
    await h.settle({ timeoutMs: 60000 });
    await h.setPose(view.pose);
    const ms = [];
    for (let r = 0; r < 2; r++) ms.push((await h.measure({ frames: 30, warmup: 6 })).gpuMs?.median);
    console.log('ablate', mode.padEnd(9), view.id.padEnd(9), 'gpu', Math.min(...ms));
  }
}
