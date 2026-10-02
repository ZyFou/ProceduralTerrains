// Cold-compile attribution of the current terrain fragment by stubbing
// sections (vertex replaced by a trivial pass-through with the same varyings).
export default async function ({ page }) {
  const result = await page.evaluate(async () => {
    const e = window.__engine;
    const r = e.renderer;
    const gl = r.getContext();
    const Mesh = e.board.chunks[0].mesh.constructor;
    const Scene = e.scene.constructor;
    const geo = e.board.chunks[0].mesh.geometry;
    const terrain = e.terrainMaterial;
    const vert = `
varying vec3 vWorldPos; varying float vLod; varying float vSkirt; varying float vWall; varying float vWallMesh;
void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vWorldPos = wp.xyz; vLod = 0.0; vSkirt = 0.0; vWall = 0.0; vWallMesh = 0.0; gl_Position = projectionMatrix * viewMatrix * wp; }`;
    async function timeCompile(label, frag, vertex = vert) {
      const material = terrain.clone();
      material.vertexShader = vertex;
      material.fragmentShader = frag;
      material.defines = { ...(material.defines || {}), ATTR_BUST: Math.floor(Math.random() * 1e9) };
      const scene = new Scene();
      const mesh = new Mesh(geo, material);
      mesh.frustumCulled = false;
      scene.add(mesh);
      const t0 = performance.now();
      await r.compileAsync(scene, e.camera);
      const ms = performance.now() - t0;
      const prog = r.properties.get(material).currentProgram;
      const ok = prog ? gl.getProgramParameter(prog.program, gl.LINK_STATUS) : null;
      material.dispose();
      return { label, ms: Math.round(ms), ok, changed: frag !== terrain.fragmentShader };
    }
    const base = terrain.fragmentShader;
    const stub = (s, re, rep) => s.replace(re, rep);
    const noHeight = stub(base, /samples\[sampleIndex\] = terrainCachedHeightAt\(xz \+ offset\);/, 'samples[sampleIndex] = 0.0;');
    const noClimate = stub(base, /Climate cl = climateAt\(xz \* uFrequency \+ uSeedOffset\);/, 'Climate cl = Climate(0.5, 0.5, 0.5, 0.5, 0.5);');
    const noDetail = stub(base, /TerrainDetailResult td = applyTerrainDetailLayer\([^;]*\);/, 'TerrainDetailResult td; td.albedo = tc.albedo; td.fade = 0.0; td.rockMask = 0.0; td.shoreMask = 0.0; td.detail = 0.0;');
    const noCaustics = stub(base, /col = applyTerrainCaustics\([^;]*\);/, '');
    const noAlbedo = stub(base, /TerrainColorResult tc = computeTerrainAlbedo\([^;]*\);/, 'TerrainColorResult tc; tc.albedo = vec3(0.5); tc.snow = 0.0; tc.sandBand = 0.0; tc.rockBlend = 0.0; tc.flatness = 0.0;');
    const noSurface = stub(base, /SurfaceTexResult surf = applySurfaceMaterials\([^;]*\);/, 'SurfaceTexResult surf; surf.albedo = td.albedo; surf.normal = n; surf.ao = 1.0; surf.rough = 0.8; surf.amount = 0.0;');
    const out = [];
    out.push(await timeCompile('full fragment', base));
    out.push(await timeCompile('- live height loop', noHeight));
    out.push(await timeCompile('- climate', noClimate));
    out.push(await timeCompile('- detail layer', noDetail));
    out.push(await timeCompile('- caustics', noCaustics));
    out.push(await timeCompile('- albedo/palette', noAlbedo));
    out.push(await timeCompile('- surface textures', noSurface));
    out.push(await timeCompile('vertex only (real vertex, trivial frag)', 'varying vec3 vWorldPos; void main(){ gl_FragColor = vec4(fract(vWorldPos), 1.0); }', terrain.vertexShader));
    return out;
  });
  for (const r of result) console.log(String(r.ms).padStart(6), 'ms', r.ok ? 'ok ' : 'ERR', r.changed ? '' : '(unchanged)', r.label);
}
