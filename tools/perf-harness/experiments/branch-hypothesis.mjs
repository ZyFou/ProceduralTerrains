// Hypothesis: gradient ops (texture2D) inside heightAt force FXC to flatten the
// bake/live branch, so the bake saves nothing. Patch all lookups to explicit
// LOD and compare bake-on cost.
export default async function ({ page, h, scene }) {
  const view = scene.views.find((v) => v.id === 'close');
  await page.evaluate(async () => {
    const e = window.__engine;
    window.__h.unfreeze();
    e._bakeBaseSize = () => 2048;
    e._studioLiveHeightField = false;
    e._terrainHeightBakeDeferred = true;
    e._bakedStudioGen = -1;
    await e._prepareStudioHeightCacheAsync();
  });
  await h.setPose(view.pose);
  await h.settle({ timeoutMs: 60000 });
  const run = async (label) => {
    await h.setPose(view.pose);
    const m = await h.measure({ frames: 40, warmup: 8 });
    const used = await page.evaluate(() => window.__engine.uniforms.uUseTerrainHeightTex.value);
    console.log(label.padEnd(40), 'bake', used, 'frame', m.frameMs.mean, 'gpu', m.gpuMs?.mean);
  };
  await run('bake on, original shader');
  const t0 = Date.now();
  await page.evaluate(async () => {
    const e = window.__engine;
    const m = e.terrainMaterial;
    m.fragmentShader = '#undef texture2D\n#define texture2D(s, uv) textureLod(s, uv, 0.0)\n' + m.fragmentShader;
    m.needsUpdate = true;
    await e.renderer.compileAsync(e.scene, e.camera);
  });
  console.log('recompile ms', Date.now() - t0);
  await run('bake on, explicit-LOD lookups');
  await page.evaluate(() => { window.__engine.uniforms.uUseTerrainHeightTex.value = 0; });
  await run('bake off, explicit-LOD lookups');
}
