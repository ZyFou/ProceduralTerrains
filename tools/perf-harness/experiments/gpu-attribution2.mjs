// Current GPU attribution for a studio view: full, no water, trivial terrain
// fragment (vertex+raster only), bake forced everywhere (live share).
export default async function ({ page, h, scene }) {
  const view = scene.views.find((v) => v.id === (process.env.VIEW || 'close'));
  await h.setPose(view.pose);
  await h.settle({ timeoutMs: 90000 });
  const run = async (label) => {
    await h.setPose(view.pose);
    const m = await h.measure({ frames: 40, warmup: 8 });
    console.log(label.padEnd(34), 'gpu', m.gpuMs?.median, 'tris', m.triangles.median);
  };
  await run('full');
  await page.evaluate(() => { const w = window.__engine.water; if (w) w.visible = false; });
  await run('no water');
  await page.evaluate(() => { const e = window.__engine; e.uniforms.uBakeBlend.value.set(-2, -1); });
  await run('no water, bake everywhere');
  await page.evaluate(async () => {
    const e = window.__engine;
    window.__h.unfreeze();
    const m = e.terrainMaterial;
    window.__savedFrag = m.fragmentShader;
    m.fragmentShader = 'varying vec3 vWorldPos; void main(){ gl_FragColor = vec4(fract(vWorldPos*0.01), 1.0); }';
    m.needsUpdate = true;
    await e.renderer.compileAsync(e.scene, e.camera);
  });
  await run('no water, trivial fragment');
}
