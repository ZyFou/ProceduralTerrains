// A/B the cloud shape optimizations by patching the live slab shader source.
export default async function ({ page, h, scene }) {
  const variants = {
    'bounded+skip': (s) => s,
    'orig-fbm+skip': (s) => s.replace('cl_fbm_bounded(baseP, CLOUD_OCTAVES, threshold, threshold + soft)', 'cl_fbm_base(baseP)')
      .replace('cl_fbm_bounded(baseP, 3, threshold, threshold + soft)', 'cl_fbm_light(baseP)'),
    'bounded-only': (s) => s.replace('if (edge > 0.0) {', '{'),
    'original': (s) => s.replace('cl_fbm_bounded(baseP, CLOUD_OCTAVES, threshold, threshold + soft)', 'cl_fbm_base(baseP)')
      .replace('cl_fbm_bounded(baseP, 3, threshold, threshold + soft)', 'cl_fbm_light(baseP)').replace('if (edge > 0.0) {', '{'),
    'light-orig': (s) => s.replace('cl_fbm_bounded(baseP, 3, threshold, threshold + soft)', 'cl_fbm_light(baseP)'),
  };
  for (const viewId of (process.env.VIEW || 'overview,close').split(',')) {
    const view = scene.views.find((v) => v.id === viewId);
    await h.setPose(view.pose);
    await h.settle({ timeoutMs: 90000 });
    for (const [label, fn] of Object.entries(variants)) {
      await page.evaluate(async (src) => {
        const e = window.__engine;
        const mat = e.studioCloud.material;
        window.__cloudSrc ||= mat.fragmentShader;
        mat.fragmentShader = (0, eval)(src)(window.__cloudSrc);
        mat.needsUpdate = true;
        window.__h.unfreeze();
        await e.renderer.compileAsync(e.scene, e.camera);
        for (let i = 0; i < 3; i++) { e._needsRender = true; e._tick(); await new Promise((r) => setTimeout(r, 30)); }
      }, fn.toString());
      await h.setPose(view.pose);
      const ms = [];
      for (let r = 0; r < 3; r++) ms.push((await h.measure({ frames: 30, warmup: 6 })).gpuMs?.median);
      console.log(viewId, label.padEnd(14), 'gpu', Math.min(...ms));
    }
  }
}
