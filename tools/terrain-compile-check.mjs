import { chromium } from 'playwright';

// Compare the compact sampling loop against the previous analytic source
// with distinct source keys, and verify their rendered pixels on the same GPU.
const browser = await chromium.launch({ channel: 'msedge', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage();
  await page.goto(`${process.env.TERRAIN_CHECK_URL || 'http://127.0.0.1:6061'}/tools/surface-qa.html`);
  const result = await page.evaluate(async ({ variant, size, close }) => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { createTerrainUniforms, createTerrainMaterial } = await import('/src/engine/terrain/TerrainMaterial.js');
    const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas') });
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const errors = [];
    renderer.debug.onShaderError = (context, program) => errors.push(context.getProgramInfoLog(program));
    const uniforms = createTerrainUniforms();
    const surfaceTextures = [];
    if (variant === 'full' || variant === 'surface') {
      uniforms.uSurfaceArrayMode.value = 1;
      uniforms.uSurfMode.value = 1;
      uniforms.uSurfReveal.value = 1;
      for (const key of ['uSurfDiffuse', 'uSurfProps']) {
        const texture = new THREE.DataArrayTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, 1);
        texture.needsUpdate = true;
        uniforms[key].value = texture;
        surfaceTextures.push(texture);
      }
      uniforms.uSurfaceRoleMap.value.forEach((entry) => entry.set(0, -1, 0, 1));
    }
    const geometry = new THREE.PlaneGeometry(1800, 1800, 32, 32);
    geometry.rotateX(-Math.PI / 2);
    for (const name of ['aSkirt', 'aLod', 'aWall']) {
      geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count), 1));
    }
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(geometry);
    scene.add(mesh);
    const camera = new THREE.PerspectiveCamera(50, 1, 1, 10000);
    camera.position.set(1200, 1700, 1600);
    camera.lookAt(0, 0, 0);
    if (close) { camera.position.set(0, 450, 0); camera.lookAt(0, 0, 0); }
    const target = new THREE.WebGLRenderTarget(size, size);
    renderer.setRenderTarget(target);
    const cases = [];
    const pixels = [];
    for (const baseline of [true, false]) {
      const material = createTerrainMaterial(uniforms, 7, undefined, { variant });
      if (baseline) {
        const start = material.fragmentShader.indexOf('    // Keep one copy');
        const end = material.fragmentShader.indexOf('\n  }\n', start);
        if (start < 0 || end < 0) throw new Error('Studio sampling block not found');
        material.fragmentShader = material.fragmentShader.slice(0, start) + `
    hC = terrainCachedHeightAt(xz);
    float normalDistance = length(cameraPosition - vWorldPos);
    bool farInfiniteNormal = uInfiniteMode > 0.5
      && (vLod > 1.5 || normalDistance > max(uChunkSize * 7.0, 900.0));
    if (farInfiniteNormal) {
      hX = hC;
      hZ = hC;
      nGeo = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
      if (nGeo.y < 0.0) nGeo = -nGeo;
    } else {
      hX = terrainCachedHeightAt(xz + vec2(eps, 0.0));
      hZ = terrainCachedHeightAt(xz + vec2(0.0, eps));
      nGeo = normalize(vec3(-(hX - hC) / eps, 1.0, -(hZ - hC) / eps));
    }
` + material.fragmentShader.slice(end);
      }
      material.defines.TERRAIN_COMPILE_CHECK = Math.floor(Math.random() * 1e9);
      mesh.material = material;
      const start = performance.now();
      await renderer.compileAsync(scene, camera);
      const compileMs = performance.now() - start;
      const frames = [];
      const renderMs = [];
      for (const seed of [0, 127, 941]) {
        uniforms.uSeedOffset.value.set(seed, -seed);
        const renderStart = performance.now();
        renderer.render(scene, camera);
        const data = new Uint8Array(size * size * 4);
        renderer.readRenderTargetPixels(target, 0, 0, size, size, data);
        renderMs.push(performance.now() - renderStart);
        frames.push(data);
      }
      const combined = new Uint8Array(size * size * 4 * frames.length);
      frames.forEach((frame, i) => combined.set(frame, i * size * size * 4));
      pixels.push(combined);
      const program = renderer.properties.get(material).currentProgram.program;
      cases.push({ baseline, compileMs, renderMs, linked: gl.getProgramParameter(program, gl.LINK_STATUS) });
      material.dispose();
    }
    let maxPixelDifference = 0;
    for (let i = 0; i < pixels[0].length; i++) {
      maxPixelDifference = Math.max(maxPixelDifference, Math.abs(pixels[0][i] - pixels[1][i]));
    }
    const nonBlackPixels = pixels[1].filter((value, i) => i % 4 !== 3 && value > 0).length;
    const glError = gl.getError();
    target.dispose(); geometry.dispose();
    surfaceTextures.forEach((texture) => texture.dispose());
    renderer.dispose();
    return { gpu, variant, cases, maxPixelDifference, nonBlackPixels, errors, glError };
  }, { variant: process.env.TERRAIN_CHECK_VARIANT || 'base',
    size: Number(process.env.TERRAIN_CHECK_SIZE || 96), close: process.env.TERRAIN_CHECK_CLOSE === '1' });
  console.log(JSON.stringify(result, null, 2));
  if (result.cases.some((entry) => !entry.linked) || result.errors.length
      || result.glError || !result.nonBlackPixels || result.maxPixelDifference > 1) process.exitCode = 1;
} finally {
  await browser.close();
}
