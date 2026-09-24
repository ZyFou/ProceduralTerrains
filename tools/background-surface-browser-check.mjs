import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  const baseUrl = process.env.TERRAIN_CHECK_URL || 'http://127.0.0.1:6061';
  await page.goto(`${baseUrl}/tools/surface-qa.html`);
  const result = await page.evaluate(async (runPreparation) => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { createTerrainUniforms, createTerrainMaterial } = await import('/src/engine/terrain/TerrainMaterial.js');
    const { createPlanetMaterial } = await import('/src/engine/terrain/PlanetMaterial.js');
    const { DetailPageCache } = await import('/src/engine/terrain/detail/DetailPageCache.js');
    const { prepareSurfaceInBackground } = await import('/src/engine/terrain/surface/SurfacePreparationClient.js');
    const { uploadSurfaceTextures } = await import('/src/engine/terrain/surface/SurfaceUploadQueue.js');
    const { createSurfaceDocument } = await import('/src/engine/terrain/surface/SurfaceDocument.js');
    const { syncSurfaceMaterialBackend } = await import('/src/engine/terrain/surface/SurfaceArrayGLSL.js');
    const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas') });
    renderer.setSize(640, 480);
    const gl = renderer.getContext();
    const shaderErrors = [];
    renderer.debug.onShaderError = (context, program, vertex, fragment) => {
      shaderErrors.push(context.getProgramInfoLog(program), context.getShaderInfoLog(vertex), context.getShaderInfoLog(fragment));
    };
    const uniforms = createTerrainUniforms();
    const camera = new THREE.PerspectiveCamera(50, 640 / 480, 0.1, 10000);
    camera.position.set(0, 100, 0);
    uniforms.uDetailPageArray.value = new THREE.DataArrayTexture(new Uint8Array([128, 128, 128, 128]), 1, 1, 1);
    uniforms.uDetailPageCoords.value[0].set(0, 0, 1);
    const geometry = new THREE.PlaneGeometry(10, 10, 2, 2);
    const mesh = new THREE.Mesh(geometry);
    const scene = new THREE.Scene();
    scene.add(mesh);
    camera.position.set(0, 10, 20);
    camera.lookAt(0, 0, 0);
    const compile = async (material) => {
      mesh.material = material;
      syncSurfaceMaterialBackend(material);
      await renderer.compileAsync(scene, camera);
      renderer.render(scene, camera);
      const program = renderer.properties.get(material).currentProgram?.program;
      return {
        linked: !!program && gl.getProgramParameter(program, gl.LINK_STATUS),
        activeUniforms: program ? gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) : 0,
        samplers: program ? Array.from({ length: gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) }, (_, i) => gl.getActiveUniform(program, i))
          .filter((entry) => entry && [gl.SAMPLER_2D, gl.SAMPLER_2D_ARRAY, gl.SAMPLER_CUBE].includes(entry.type))
          .map((entry) => entry.name) : [],
      };
    };
    const detail = await compile(createTerrainMaterial(uniforms, 3, undefined, { variant: 'detail' }));
    const atlas = {
      diffuse: new THREE.DataArrayTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, 1),
      props: new THREE.DataArrayTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, 1),
      mapping: Array.from({ length: 13 }, () => new THREE.Vector4(0, -1, 0, 1)),
      tints: Array.from({ length: 13 }, () => new THREE.Vector3(1, 1, 1)),
      sizes: [2],
    };
    uniforms.uSurfMode.value = 1;
    uniforms.uSurfReveal.value = 1;
    uniforms.uSurfaceArrayMode.value = 1;
    uniforms.uSurfDiffuse.value = atlas.diffuse;
    uniforms.uSurfProps.value = atlas.props;
    uniforms.uSurfaceRoleMap.value = atlas.mapping;
    uniforms.uSurfaceRoleTint.value = atlas.tints;
    uniforms.uSurfaceAssetSize.value = [...atlas.sizes, ...new Array(64 - atlas.sizes.length).fill(2)];
    const full = await compile(createTerrainMaterial(uniforms, 3, undefined, { variant: 'full' }));
    const infinite = await compile(createTerrainMaterial(uniforms, 3, undefined, { variant: 'full', worldMode: 'infinite' }));
    const manual = await compile(createTerrainMaterial(uniforms, 3, undefined, { variant: 'manual' }));
    const hybrid = await compile(createTerrainMaterial(uniforms, 3, undefined, { variant: 'hybrid' }));
    const planet = await compile(createPlanetMaterial(uniforms, 3));
    let preparation = null;
    if (runPreparation) {
      const document = createSurfaceDocument({ settings: { profile: 'eco' } });
      for (const role of Object.keys(document.roles)) document.roles[role] = 'polyhaven:brown_mud';
      const started = performance.now();
      const prepared = await prepareSurfaceInBackground({ source: 'pbrLibrary', document });
      const prepareMs = performance.now() - started;
      const transferSizes = [];
      const uploadStarted = performance.now();
      await uploadSurfaceTextures(renderer, prepared, { onProgress: (value) => transferSizes.push(value) });
      preparation = {
        prepareMs,
        uploadMs: performance.now() - uploadStarted,
        uploadTasks: transferSizes.length,
        layers: prepared.diffuse.image.depth,
        mipLevels: prepared.diffuse.mipmaps.length,
      };
      prepared.diffuse.dispose();
      prepared.props.dispose();
      const warmStarted = performance.now();
      const warm = await prepareSurfaceInBackground({ source: 'pbrLibrary', document });
      preparation.warmPrepareMs = performance.now() - warmStarted;
      warm.diffuse.dispose();
      warm.props.dispose();
    }
    uniforms.uDetailPageArray.value.dispose();
    atlas.diffuse.dispose();
    atlas.props.dispose();
    return { detail, full, infinite, manual, hybrid, planet, preparation, shaderErrors: shaderErrors.filter(Boolean),
      glError: gl.getError(), samplerLimit: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) };
  }, process.env.RUN_PREP === '1');
  console.log(JSON.stringify({ ...result, errors }, null, 2));
  if (errors.length || result.shaderErrors.length || !result.detail.linked
      || !result.full.linked || !result.infinite.linked || !result.manual.linked
      || !result.hybrid.linked || !result.planet.linked || result.glError) process.exitCode = 1;
} finally {
  await browser.close();
}
