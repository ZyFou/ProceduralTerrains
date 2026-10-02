// Runtime GPU attribution for the studio terrain pass at the close view.
export default async function ({ page, h, scene }) {
  const view = scene.views.find((v) => v.id === (process.env.VIEW || 'close'));
  await h.setPose(view.pose);
  await h.settle({ timeoutMs: 60000 });
  const run = async (label) => {
    await h.setPose(view.pose);
    const m = await h.measure({ frames: 40, warmup: 8 });
    console.log(label.padEnd(36), 'frame', m.frameMs.mean, 'gpu', m.gpuMs?.mean, 'tris', m.triangles.mean);
  };
  await run('baseline');
  await page.evaluate(() => { window.__engine.uniforms.uTerrainNormalSampleCount.value = 1; });
  await run('normal samples = 1');
  await page.evaluate(() => { window.__engine.uniforms.uTerrainNormalSampleCount.value = 0; });
  await run('normal samples = 0');
  await page.evaluate(() => { window.__engine.uniforms.uTerrainNormalSampleCount.value = 3; });
  // swap fragment for a trivial one (vertex unchanged)
  await page.evaluate(async () => {
    const e = window.__engine;
    const m = e.terrainMaterial;
    window.__savedFrag = m.fragmentShader;
    m.fragmentShader = 'varying vec3 vWorldPos; void main(){ gl_FragColor = vec4(fract(vWorldPos*0.01), 1.0); }';
    m.needsUpdate = true;
    await e.renderer.compileAsync(e.scene, e.camera);
  });
  await run('trivial fragment');
  await page.evaluate(() => { const w = window.__engine.water; if (w) w.visible = false; });
  await run('trivial fragment, no water');
  await page.evaluate(async () => {
    const e = window.__engine;
    const m = e.terrainMaterial;
    m.fragmentShader = window.__savedFrag;
    m.needsUpdate = true;
    await e.renderer.compileAsync(e.scene, e.camera);
  });
  await run('full fragment, no water');
  await page.evaluate(() => { const w = window.__engine.water; if (w) w.visible = true; });
  await run('restored');
}
