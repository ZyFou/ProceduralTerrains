// Does the surface-texture 'full' terrain variant link within 16 samplers?
export default async function ({ page }) {
  console.log(JSON.stringify(await page.evaluate(async () => {
    const e = window.__engine;
    const T = await import('/node_modules/.vite/deps/three.js');
    const { createTerrainMaterial } = await import('/src/engine/terrain/TerrainMaterial.js');
    const gl = e.renderer.getContext();
    const out = {};
    for (const variant of ['detail', 'full', 'surface', 'hybrid']) {
      const m = createTerrainMaterial(e.uniforms, Math.round(e.params.octaves), e._activeHeightProgram('studio'), { worldMode: 'studio', variant });
      const geo = new T.PlaneGeometry(1, 1); geo.deleteAttribute('normal');
      const mesh = new T.Mesh(geo, m);
      mesh.frustumCulled = false;
      const scene = new T.Scene(); scene.add(mesh);
      try {
        e.renderer.compile(scene, e.camera);
        const prog = e.renderer.properties.get(m).currentProgram;
        await new Promise((r) => setTimeout(r, 50));
        let link = gl.getProgramParameter(prog.program, gl.LINK_STATUS);
        let n = gl.getProgramParameter(prog.program, gl.ACTIVE_UNIFORMS); let s = 0;
        for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(prog.program, i); if ([gl.SAMPLER_2D, gl.SAMPLER_2D_ARRAY, gl.SAMPLER_CUBE, gl.SAMPLER_3D].includes(u.type)) s++; }
        out[variant] = { link, samplers: s, log: (gl.getProgramInfoLog(prog.program) || '').slice(0, 200) };
      } catch (err) { out[variant] = { error: String(err.message || err).slice(0, 200) }; }
      m.dispose(); geo.dispose();
    }
    return out;
  }), null, 1));
}
