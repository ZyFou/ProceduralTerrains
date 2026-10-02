// Planet: cost of the per-pixel climate (ABLATE=none|climate|region).
export default async function ({ page, h, scene }) {
  const mode = process.env.ABLATE || 'none';
  await h.setPose(scene.views[0].pose);
  await h.settle({ timeoutMs: 120000 });
  await page.evaluate(async (m) => {
    const e = window.__engine;
    const mats = e.planetWorld.materials;
    for (const mat of mats) {
      let src = mat.fragmentShader;
      if (m === 'climate') src = src.replace('Climate cl = planetClimateAt(dir);', 'Climate cl = Climate(0.5, 0.5, 0.5, 0.5, 0.5);');
      if (m === 'region') src = src.replace('Climate cl = planetClimateAt(dir);', 'Climate cl = Climate(0.5, 0.5, 0.5, 0.5, fbm3Dc(planetDomain(dir) * 0.700 + vec3(631.4, 199.2, 77.1)));');
      if (m !== 'none' && src === mat.fragmentShader) throw new Error('patch failed');
      mat.fragmentShader = src;
      mat.needsUpdate = true;
    }
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
    console.log('ablate', mode.padEnd(8), view.id.padEnd(7), 'gpu', Math.min(...ms));
  }
}
