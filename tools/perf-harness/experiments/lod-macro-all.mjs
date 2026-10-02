// Apply the explicit-LOD macro to every ShaderMaterial in the scene and
// compare GPU cost per view (perf-only probe; mipmapped textures lose mips).
export default async function ({ page, h, scene }) {
  const views = scene.views;
  const run = async (label) => {
    for (const view of views) {
      await h.setPose(view.pose);
      await h.settle({ timeoutMs: 60000, idleFrames: 10, minFrames: 15 });
      await h.setPose(view.pose);
      const m = await h.measure({ frames: 40, warmup: 8 });
      console.log(label.padEnd(10), view.id.padEnd(9), 'frame', m.frameMs.mean, 'gpu', m.gpuMs?.mean);
    }
  };
  await run('original');
  const n = await page.evaluate(async () => {
    const e = window.__engine;
    window.__h.unfreeze();
    const mats = new Set();
    e.scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m)); });
    for (const m of e.planetWorld?.materials || []) mats.add(m);
    let count = 0;
    for (const m of mats) {
      if (!m.isShaderMaterial || !m.fragmentShader || m.fragmentShader.length < 3000) continue;
      m.fragmentShader = '#undef texture2D\n#define texture2D(s, uv) textureLod(s, uv, 0.0)\n' + m.fragmentShader;
      m.needsUpdate = true;
      count++;
    }
    await e.renderer.compileAsync(e.scene, e.camera);
    return count;
  });
  console.log('patched', n);
  await run('patched');
}
