// Infinite World GPU split for a view: full, water hidden, terrain fragment
// replaced by a trivial one (vertex + raster only), per mesh group.
export default async function ({ page, h, scene }) {
  const view = scene.views.find((v) => v.id === (process.env.VIEW || 'low'));
  await h.setPose(view.pose);
  await h.settle({ timeoutMs: 90000 });
  const run = async (label) => {
    await h.setPose(view.pose);
    const ms = [];
    for (let r = 0; r < 2; r++) ms.push((await h.measure({ frames: 30, warmup: 6 })).gpuMs?.median);
    console.log(label.padEnd(30), 'gpu', Math.min(...ms));
  };
  console.log(JSON.stringify(await page.evaluate(() => {
    const e = window.__engine;
    const groups = [];
    e.scene.traverseVisible((o) => { if (o.isMesh) groups.push(`${o.name || o.type}:${o.material?.type}:${o.geometry?.index?.count ?? o.geometry?.attributes?.position?.count}${o.isInstancedMesh ? 'x' + o.count : ''}`); });
    return groups.slice(0, 20);
  })));
  await run('full');
  await page.evaluate(() => { const e = window.__engine; e.scene.traverse((o) => { if (o.isMesh && /water/i.test(o.name + (o.material?.name || '')) ) o.visible = false; }); if (e.water) e.water.visible = false; });
  await run('no water');
  await page.evaluate(async () => {
    const e = window.__engine;
    const m = e._infiniteTerrainMat;
    m.fragmentShader = 'varying vec3 vWorldPos; void main(){ gl_FragColor = vec4(fract(vWorldPos*0.01), 1.0); }';
    m.needsUpdate = true;
    window.__h.unfreeze();
    await e.renderer.compileAsync(e.scene, e.camera);
  });
  await run('no water, trivial terrain frag');
}
