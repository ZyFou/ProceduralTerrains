// Prototype: deferred terrain shading vs forward, terrain-only GPU time.
export default async function ({ page, h, scene }) {
  const viewId = process.env.VIEW || 'close';
  const view = scene.views.find((v) => v.id === viewId);
  await h.setPose(view.pose);
  await h.settle({ timeoutMs: 90000 });
  await h.setPose(view.pose);
  const out = await page.evaluate(async () => {
    const e = window.__engine;
    const r = e.renderer;
    const gl = r.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const T = await import('/node_modules/.vite/deps/three.js');
    const w = 1280, hgt = 720;
    const gbuf = new T.WebGLRenderTarget(w, hgt, { type: T.FloatType, format: T.RGBAFormat, minFilter: T.NearestFilter, magFilter: T.NearestFilter, depthBuffer: true });
    gbuf.depthTexture = new T.DepthTexture(w, hgt);
    const color = new T.WebGLRenderTarget(w, hgt, { depthBuffer: true });
    const terrain = e.terrainMaterial;
    const gmat = terrain.clone();
    gmat.fragmentShader = 'varying vec3 vWorldPos; varying float vLod; varying float vSkirt; varying float vWall; varying float vWallMesh;\nvoid main(){ gl_FragColor = vec4(vWorldPos, 1.0 + vLod * 8.0); }';
    let f = terrain.fragmentShader;
    f = f.replace(/varying vec3\s+vWorldPos;/, 'vec3 vWorldPos;').replace(/varying float vLod;/, 'float vLod;')
      .replace(/varying float vSkirt;/, 'float vSkirt;').replace(/varying float vWall;/, 'float vWall;').replace(/varying float vWallMesh;/, 'float vWallMesh;');
    f = 'uniform highp sampler2D uGBuf; uniform highp sampler2D uGDepth;\n' + f;
    f = f.replace(/void main\(\) \{\n  vec2 xz = vWorldPos\.xz;/, 'void main() {\n  vec4 gb = texelFetch(uGBuf, ivec2(gl_FragCoord.xy), 0);\n  if (gb.w < 0.5) discard;\n  vWorldPos = gb.xyz; vLod = floor((gb.w - 1.0) / 8.0 + 0.5); vSkirt = 0.0; vWall = 0.0; vWallMesh = 0.0;\n  gl_FragDepth = texelFetch(uGDepth, ivec2(gl_FragCoord.xy), 0).r;\n  vec2 xz = vWorldPos.xz;');
    const rmat = new T.ShaderMaterial({
      uniforms: { ...terrain.uniforms, uGBuf: { value: gbuf.texture }, uGDepth: { value: gbuf.depthTexture } },
      defines: { ...terrain.defines },
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: f,
      depthTest: false, depthWrite: true,
    });
    const tri = new T.BufferGeometry();
    tri.setAttribute('position', new T.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const quad = new T.Mesh(tri, rmat); quad.frustumCulled = false;
    const rscene = new T.Scene(); rscene.add(quad);
    const board = e.board.group;
    const meshes = []; board.traverse((o) => { if (o.isMesh && o.material === terrain) meshes.push(o); });
    const sceneT = new T.Scene();
    // forward terrain-only: render board group alone
    const visible = e.scene.children.map((c) => [c, c.visible]);
    for (const [c] of visible) c.visible = (c === board);
    await r.compileAsync(e.scene, e.camera);
    const swap = (m) => meshes.forEach((o) => { o.material = m; });
    swap(gmat); await r.compileAsync(e.scene, e.camera); swap(terrain);
    await r.compileAsync(rscene, e.camera);
    const timeIt = async (fn, n = 20) => {
      const qs = [];
      for (let i = 0; i < n; i++) {
        const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); fn(); gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        await new Promise((res) => setTimeout(res, 0));
      }
      await new Promise((res) => setTimeout(res, 50));
      const ms = qs.map((q) => gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); qs.forEach((q) => gl.deleteQuery(q));
      ms.sort((a, b) => a - b); return +ms[Math.floor(ms.length / 2)].toFixed(2);
    };
    const forward = await timeIt(() => { r.setRenderTarget(color); r.clear(); r.render(e.scene, e.camera); r.setRenderTarget(null); });
    const gpass = await timeIt(() => { swap(gmat); r.setRenderTarget(gbuf); r.setClearColor(0x000000, 0); r.clear(); r.render(e.scene, e.camera); swap(terrain); r.setRenderTarget(null); });
    const resolve = await timeIt(() => { r.setRenderTarget(color); r.clear(); r.render(rscene, e.camera); r.setRenderTarget(null); });
    for (const [c, v] of visible) c.visible = v;
    r.setClearColor(0x0b0e14, 1);
    // pixel coverage
    const px = new Float32Array(w * hgt * 4);
    r.readRenderTargetPixels(gbuf, 0, 0, w, hgt, px);
    let covered = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 0.5) covered++;
    return { forward, gpass, resolve, deferredTotal: +(gpass + resolve).toFixed(2), coveredPx: covered, tris: e._lastTris };
  });
  console.log(viewId, JSON.stringify(out));
}
