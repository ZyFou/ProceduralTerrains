// Fragment-stage compile attribution by surgically replacing sub-graphs.
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
    async function timeCompile(label, frag) {
      const material = terrain.clone();
      material.vertexShader = vert;
      material.fragmentShader = frag;
      material.defines = { ...(material.defines || {}), HARNESS_BUST: Math.floor(Math.random() * 1e9) };
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
      return { label, ms: Math.round(ms), ok, fChars: frag.length };
    }
    const base = terrain.fragmentShader;
    const out = [];
    const noHeight = base.replace(/samples\[sampleIndex\] = terrainCachedHeightAt\(xz \+ offset\);/, 'samples[sampleIndex] = texture2D(uPaintHeightTexture, (xz + offset) * 0.001).r;');
    const noClimate = (s) => s.replace(/Climate cl = climateAt\(xz \* uFrequency \+ uSeedOffset\);/, 'Climate cl = Climate(0.5, 0.5, 0.5, 0.5, 0.5);');
    out.push({ replacedHeight: noHeight !== base, replacedClimate: noClimate(base) !== base });
    out.push(await timeCompile('fragment full', base));
    out.push(await timeCompile('fragment - heightAt', noHeight));
    out.push(await timeCompile('fragment - heightAt - climate', noClimate(noHeight)));
    out.push(await timeCompile('fragment - climate', noClimate(base)));
    return out;
  });
  console.log(JSON.stringify(result, null, 1));
}
