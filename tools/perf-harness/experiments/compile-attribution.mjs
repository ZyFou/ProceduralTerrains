// Cold-compile attribution: compiles cache-busted clones of the live programs
// (and stage-stripped variants) and times each until KHR completion.
export default async function ({ page }) {
  const result = await page.evaluate(async () => {
    const e = window.__engine;
    const r = e.renderer;
    const Mesh = e.board.chunks[0].mesh.constructor;
    const Scene = e.scene.constructor;
    const geo = e.board.chunks[0].mesh.geometry;
    const terrain = e.terrainMaterial;
    const water = e.water?.material;
    const trivialFrag = 'void main(){ gl_FragColor = vec4(1.0); }';
    const trivialVert = 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }';
    async function timeCompile(label, material) {
      material.defines = { ...(material.defines || {}), HARNESS_BUST: Math.floor(Math.random() * 1e9) };
      material.needsUpdate = true;
      const scene = new Scene();
      const mesh = new Mesh(geo, material);
      mesh.frustumCulled = false;
      scene.add(mesh);
      const t0 = performance.now();
      await r.compileAsync(scene, e.camera);
      const ms = performance.now() - t0;
      material.dispose();
      return { label, ms: Math.round(ms), vChars: material.vertexShader.length, fChars: material.fragmentShader.length };
    }
    const out = [];
    out.push(await timeCompile('terrain full', terrain.clone()));
    { const m = terrain.clone(); m.fragmentShader = trivialFrag; out.push(await timeCompile('terrain vertex only', m)); }
    { const m = terrain.clone(); m.vertexShader = trivialVert; out.push(await timeCompile('terrain fragment only', m)); }
    if (water) {
      { const m = water.clone(); out.push(await timeCompile('water full', m)); }
    }
    return out;
  });
  console.log(JSON.stringify(result, null, 1));
}
