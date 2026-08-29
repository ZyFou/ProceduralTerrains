import { readRenderTargetPixelsAsync } from './RendererReadback.js';
import { createTslRenderVariant } from './tsl/SharedTerrainNodes.js';

/**
 * Validate an actual WebGPU device, a TSL material, an offscreen draw and an
 * asynchronous readback. This is deliberately separate from application
 * readiness: passing the canary does not imply that every production material
 * has been ported.
 */
export async function validateWebGpuRuntime({ canvas = null, powerPreference = 'high-performance' } = {}) {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    return { ok: false, backend: null, reason: 'WebGPU API unavailable' };
  }

  let renderer = null;
  let geometry = null;
  let material = null;
  let target = null;
  try {
    const [THREE, TSL] = await Promise.all([import('three/webgpu'), import('three/tsl')]);
    const ownedCanvas = canvas || document.createElement('canvas');
    ownedCanvas.width = 4;
    ownedCanvas.height = 4;
    renderer = new THREE.WebGPURenderer({
      canvas: ownedCanvas,
      antialias: false,
      alpha: false,
      powerPreference,
      forceWebGL: false,
    });
    await renderer.init();
    if (!renderer.backend?.isWebGPUBackend) {
      throw new Error('Three.js selected its WebGL2 fallback instead of WebGPU');
    }

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 2;
    geometry = new THREE.PlaneGeometry(2, 2);
    material = new THREE.MeshBasicNodeMaterial();
    const variant = createTslRenderVariant({
      mode: 'compatibility',
      heightOctaves: 3,
      detailOctaves: 1,
      water: false,
      clouds: false,
    });
    const height = variant.nodes.height(TSL.positionLocal.xy, TSL.float(0.25), TSL.float(1));
    material.colorNode = variant.nodes.post(
      TSL.vec3(height, height.mul(0.5).add(0.25), 0.75),
      TSL.float(1),
      TSL.float(1),
    );
    scene.add(new THREE.Mesh(geometry, material));
    target = new THREE.RenderTarget(4, 4, { depthBuffer: false });
    renderer.setRenderTarget(target);
    await renderer.compileAsync(scene, camera);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    const pixels = await readRenderTargetPixelsAsync(renderer, target, 0, 0, 4, 4);
    const nonEmpty = pixels.some((value, index) => index % 4 !== 3 && value > 0);
    if (!nonEmpty) throw new Error('WebGPU canary readback was empty');
    return {
      ok: true,
      backend: 'webgpu',
      pixels: pixels.length,
      reason: '',
    };
  } catch (error) {
    return { ok: false, backend: null, reason: error?.message || String(error) };
  } finally {
    try { target?.dispose?.(); } catch { /* ignore */ }
    try { material?.dispose?.(); } catch { /* ignore */ }
    try { geometry?.dispose?.(); } catch { /* ignore */ }
    try { renderer?.dispose?.(); } catch { /* ignore */ }
  }
}

/**
 * Compile and execute the concrete production NodeMaterials that have already
 * been ported. This is intentionally opt-in: it creates a short-lived second
 * GPU device and must never add work to the editor boot path.
 */
export async function validateWebGpuProductionMaterials({
  canvas = null,
  powerPreference = 'high-performance',
} = {}) {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    return { ok: false, backend: null, reason: 'WebGPU API unavailable', materials: [] };
  }

  let renderer = null;
  let target = null;
  let geometry = null;
  let manualGeometry = null;
  let sourceTexture = null;
  let manualHeightTexture = null;
  let manualSurfaceTextureA = null;
  let manualSurfaceTextureB = null;
  let surfaceDiffuseTexture = null;
  let surfacePropsTexture = null;
  const disposables = [];
  const validated = [];
  try {
    const [THREE, backendModule, skyModule, postModule, underwaterModule, lowResModule,
      occupancyModule, cloudModule, terrainModule, waterModule] = await Promise.all([
      import('three/webgpu'),
      import('./webgpu/WebGpuMaterialBackend.js'),
      import('../sky/proceduralSkyGLSL.js'),
      import('./VisualPostProcess.js'),
      import('./UnderwaterEffect.js'),
      import('../sky/CloudLowResPass.js'),
      import('../sky/CloudOccupancyPass.js'),
      import('../sky/CloudSlabShader.js'),
      import('../terrain/TerrainMaterial.js'),
      import('../terrain/WaterMaterial.js'),
    ]);
    const ownedCanvas = canvas || document.createElement('canvas');
    ownedCanvas.width = 4;
    ownedCanvas.height = 4;
    renderer = new THREE.WebGPURenderer({
      canvas: ownedCanvas,
      antialias: false,
      alpha: false,
      powerPreference,
      forceWebGL: false,
    });
    await renderer.init();
    if (!renderer.backend?.isWebGPUBackend) {
      throw new Error('Three.js selected its WebGL2 fallback instead of WebGPU');
    }

    const backend = backendModule.createWebGpuMaterialBackend();
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 2;
    geometry = new THREE.PlaneGeometry(2, 2);
    const vertexCount = geometry.getAttribute('position').count;
    geometry.setAttribute('aSkirt', new THREE.Float32BufferAttribute(vertexCount, 1));
    geometry.setAttribute('aLod', new THREE.Float32BufferAttribute(vertexCount, 1));
    geometry.setAttribute('aWall', new THREE.Float32BufferAttribute(vertexCount, 1));
    manualGeometry = new THREE.PlaneGeometry(2, 2);
    manualGeometry.rotateX(-Math.PI / 2);
    const manualVertexCount = manualGeometry.getAttribute('position').count;
    manualGeometry.setAttribute(
      'aSkirt',
      new THREE.Float32BufferAttribute(manualVertexCount, 1),
    );
    manualGeometry.setAttribute(
      'aLod',
      new THREE.Float32BufferAttribute(manualVertexCount, 1),
    );
    manualGeometry.setAttribute(
      'aWall',
      new THREE.Float32BufferAttribute(manualVertexCount, 1),
    );
    const mesh = new THREE.Mesh(geometry);
    mesh.frustumCulled = false;
    scene.add(mesh);
    target = new THREE.RenderTarget(4, 4, { depthBuffer: false });
    sourceTexture = new THREE.DataTexture(
      new Uint8Array([
        48, 96, 160, 255, 80, 130, 190, 255,
        110, 150, 205, 255, 150, 180, 220, 255,
      ]),
      2,
      2,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    sourceTexture.needsUpdate = true;
    manualHeightTexture = new THREE.DataTexture(
      new Uint8Array([
        64, 0, 0, 255, 64, 0, 0, 255,
        64, 0, 0, 255, 64, 0, 0, 255,
      ]),
      2,
      2,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    manualHeightTexture.needsUpdate = true;
    manualSurfaceTextureA = new THREE.DataTexture(
      new Uint8Array([255, 0, 0, 0]),
      1,
      1,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    manualSurfaceTextureA.needsUpdate = true;
    manualSurfaceTextureB = new THREE.DataTexture(
      new Uint8Array([0, 0, 0, 0]),
      1,
      1,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    manualSurfaceTextureB.needsUpdate = true;
    const surfaceDiffuseBytes = new Uint8Array(52 * 4);
    for (let row = 0; row < 52; row += 1) {
      const offset = row * 4;
      const grassRow = (row >= 12 && row <= 15) || (row >= 36 && row <= 39);
      surfaceDiffuseBytes[offset] = grassRow ? 8 : 220;
      surfaceDiffuseBytes[offset + 1] = grassRow ? 240 : 12;
      surfaceDiffuseBytes[offset + 2] = grassRow ? 24 : 8;
      surfaceDiffuseBytes[offset + 3] = 255;
    }
    surfaceDiffuseTexture = new THREE.DataTexture(
      surfaceDiffuseBytes,
      1,
      52,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    surfaceDiffuseTexture.magFilter = THREE.NearestFilter;
    surfaceDiffuseTexture.minFilter = THREE.NearestFilter;
    surfaceDiffuseTexture.colorSpace = THREE.SRGBColorSpace;
    surfaceDiffuseTexture.needsUpdate = true;
    surfacePropsTexture = new THREE.DataTexture(
      new Uint8Array([128, 128, 204, 255]),
      1,
      1,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    surfacePropsTexture.colorSpace = THREE.NoColorSpace;
    surfacePropsTexture.needsUpdate = true;

    const sky = backend.createProceduralSkyMaterial(skyModule.createProceduralSkyUniforms());
    const post = new postModule.VisualPostProcess(backend);
    const underwater = new underwaterModule.UnderwaterEffect(backend);
    const lowRes = new lowResModule.CloudLowResPass(backend);
    const cloudSource = cloudModule.createCloudSlabMaterial(8, 1, 3, 0, false, 1);
    const occupancy = new occupancyModule.CloudOccupancyPass(renderer, cloudSource.uniforms, {
      size: 8,
      planet: false,
      materialBackend: backend,
    });
    const manualEmpty = terrainModule.createTerrainMaterial(
      terrainModule.createTerrainUniforms(),
      1,
      undefined,
      { variant: 'manual-empty', materialBackend: backend },
    );
    const manualSurface = terrainModule.createTerrainMaterial(
      terrainModule.createTerrainUniforms(),
      1,
      undefined,
      { variant: 'manual', materialBackend: backend },
    );
    const studioWater = waterModule.createWaterMaterial(
      terrainModule.createTerrainUniforms(),
      5,
      undefined,
      { materialBackend: backend },
    );
    disposables.push(
      sky.material,
      post,
      underwater,
      lowRes,
      occupancy,
      cloudSource,
      manualEmpty,
      manualSurface,
      studioWater,
    );

    const candidates = [
      ['sky-procedural', sky.material],
      ['post-look', post._lookMaterial],
      ['post-camera', post._cameraMaterial],
      ['underwater', underwater._material],
      ['cloud-composite', lowRes._composite],
      ['water-studio-legacy', studioWater],
    ];
    renderer.setRenderTarget(target);
    for (const [name, material] of candidates) {
      for (const node of Object.values(material.uniforms || {})) {
        if (node?.isTextureNode) node.value = sourceTexture;
      }
      mesh.material = material;
      await renderer.compileAsync(scene, camera);
      renderer.render(scene, camera);
      validated.push(name);
    }
    mesh.geometry = manualGeometry;
    camera.position.set(0, 2, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    for (const material of [manualEmpty, manualSurface]) {
      for (const node of Object.values(material.uniforms || {})) {
        if (node?.isTextureNode) node.value = sourceTexture;
      }
      material.uniforms.uManualHeightTexture.value = manualHeightTexture;
      material.uniforms.uManualEnabled.value = 1;
      material.uniforms.uManualOrigin.value.set(-1, -1);
      material.uniforms.uManualSpan.value.set(2, 2);
      material.uniforms.uHeightScale.value = 1;
      mesh.material = material;
      await renderer.compileAsync(scene, camera);
      renderer.render(scene, camera);
    }
    // Data-output modes feed collision, prop placement and heightmap export.
    // They must remain linear; display gamma would turn a 64 byte into ~136.
    manualEmpty.uniforms.uColorMode.value = 1;
    mesh.material = manualEmpty;
    renderer.render(scene, camera);
    const manualPixels = await readRenderTargetPixelsAsync(renderer, target, 0, 0, 4, 4);
    let manualHeightByte = 0;
    let manualCoveredPixels = 0;
    let manualChannelSkew = false;
    for (let index = 0; index < manualPixels.length; index += 4) {
      const red = manualPixels[index];
      const green = manualPixels[index + 1];
      const blue = manualPixels[index + 2];
      if (Math.max(red, green, blue) === 0) continue;
      manualCoveredPixels++;
      manualHeightByte = Math.max(manualHeightByte, red);
      if (Math.abs(green - red) > 2 || Math.abs(blue - red) > 2) {
        manualChannelSkew = true;
      }
    }
    if (manualCoveredPixels === 0 || manualHeightByte < 56 || manualHeightByte > 72) {
      throw new Error(
        `Manual terrain linear height output was ${manualHeightByte}`
        + ` across ${manualCoveredPixels} covered pixels; expected approximately 64`,
      );
    }
    if (manualChannelSkew) {
      throw new Error('Manual terrain grayscale height output was channel-skewed');
    }
    manualEmpty.uniforms.uColorMode.value = 0;

    manualSurface.uniforms.uManualSurfaceMode.value = 1;
    manualSurface.uniforms.uManualSurfaceTextureA.value = manualSurfaceTextureA;
    manualSurface.uniforms.uManualSurfaceTextureB.value = manualSurfaceTextureB;
    manualSurface.uniforms.uManualSurfaceOrigin.value.set(-1, -1);
    manualSurface.uniforms.uManualSurfaceSpan.value.set(2, 2);
    manualSurface.uniforms.uSurfDiffuse.value = surfaceDiffuseTexture;
    manualSurface.uniforms.uSurfProps.value = surfacePropsTexture;
    manualSurface.uniforms.uSurfPaletteInfluence.value = 0;
    manualSurface.uniforms.uSurfNormalAmt.value = 0;
    manualSurface.uniforms.uSurfAOAmt.value = 0;
    manualSurface.uniforms.uFogDensity.value = 0;
    manualSurface.uniforms.uSurfTile.value = new Array(13).fill(1);
    manualSurface.uniforms.uSurfRolePresent.value = new Array(13).fill(0);
    manualSurface.uniforms.uSurfRolePresent.value[3] = 1;
    manualSurface.userData.refreshSurfaceTextures();
    // Debug value 8 is reserved by the native canary and is not exposed in
    // the editor's 1..7 terrain-detail debug selector.
    manualSurface.uniforms.uTerrainDetailDebug.value = 8;
    mesh.material = manualSurface;
    await renderer.compileAsync(scene, camera);
    renderer.render(scene, camera);
    const surfaceMaskPixels = await readRenderTargetPixelsAsync(renderer, target, 0, 0, 4, 4);
    const surfaceMaskMaxRgb = [0, 0, 0];
    for (let index = 0; index < surfaceMaskPixels.length; index += 4) {
      surfaceMaskMaxRgb[0] = Math.max(surfaceMaskMaxRgb[0], surfaceMaskPixels[index]);
      surfaceMaskMaxRgb[1] = Math.max(surfaceMaskMaxRgb[1], surfaceMaskPixels[index + 1]);
      surfaceMaskMaxRgb[2] = Math.max(surfaceMaskMaxRgb[2], surfaceMaskPixels[index + 2]);
    }
    if (surfaceMaskMaxRgb[0] < 220 || surfaceMaskMaxRgb[1] < 220 || surfaceMaskMaxRgb[2] < 220) {
      throw new Error(`Manual terrain surface mask debug was ${surfaceMaskMaxRgb.join('/')}`);
    }
    manualSurface.uniforms.uTerrainDetailDebug.value = 0;
    manualSurface.uniforms.uTileDebugView.value = 3;
    renderer.render(scene, camera);
    const surfacePixels = await readRenderTargetPixelsAsync(renderer, target, 0, 0, 4, 4);
    let surfaceGreenDominance = 0;
    let surfaceCoveredPixels = 0;
    const surfaceMaxRgb = [0, 0, 0];
    for (let index = 0; index < surfacePixels.length; index += 4) {
      const red = surfacePixels[index];
      const green = surfacePixels[index + 1];
      const blue = surfacePixels[index + 2];
      if (Math.max(red, green, blue) === 0) continue;
      surfaceCoveredPixels++;
      surfaceMaxRgb[0] = Math.max(surfaceMaxRgb[0], red);
      surfaceMaxRgb[1] = Math.max(surfaceMaxRgb[1], green);
      surfaceMaxRgb[2] = Math.max(surfaceMaxRgb[2], blue);
      surfaceGreenDominance = Math.max(surfaceGreenDominance, green - Math.max(red, blue));
    }
    if (surfaceCoveredPixels === 0 || surfaceGreenDominance < 16) {
      throw new Error(
        `Manual terrain surface atlas was not green-dominant (${surfaceGreenDominance};`
        + ` max RGB ${surfaceMaxRgb.join('/')})`
        + ` across ${surfaceCoveredPixels} covered pixels`,
      );
    }
    manualSurface.uniforms.uTileDebugView.value = 0;

    manualSurface.uniforms.uTileOccupancy.value = manualSurfaceTextureB;
    manualSurface.uniforms.uTileGridOrigin.value.set(-1, -1);
    manualSurface.uniforms.uTileGridDim.value.set(1, 1);
    manualSurface.uniforms.uTileCellSize.value = 2;
    manualSurface.uniforms.uTileDiskRadius.value = 2;
    manualSurface.uniforms.uUseTiles.value = 1;
    manualSurface.uniforms.uTileShape.value = 1;
    manualSurface.userData.refreshSurfaceTextures();
    mesh.material = manualSurface;
    await renderer.compileAsync(scene, camera);
    renderer.clear();
    renderer.render(scene, camera);
    const tileMaskPixels = await readRenderTargetPixelsAsync(renderer, target, 0, 0, 4, 4);
    const tileMaskedColorBytes = tileMaskPixels.filter((_, index) => index % 4 !== 3)
      .reduce((sum, value) => sum + value, 0);
    if (tileMaskedColorBytes !== 0) {
      throw new Error(`Manual terrain empty tile mask leaked ${tileMaskedColorBytes} color bytes`);
    }
    validated.push('terrain-manual');
    mesh.geometry = geometry;
    camera.position.set(0, 0, 2);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    renderer.setRenderTarget(null);

    occupancy.mesh.material = occupancy.generateMaterial;
    await renderer.compileAsync(occupancy.scene, occupancy.camera);
    occupancy.mesh.material = occupancy.dilateMaterial;
    occupancy.dilateMaterial.uniforms.tInput.value = occupancy.targets[0].texture;
    await renderer.compileAsync(occupancy.scene, occupancy.camera);
    occupancy.render();
    validated.push('cloud-occupancy');

    renderer.setRenderTarget(target);
    mesh.material = post._lookMaterial;
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    const pixels = await readRenderTargetPixelsAsync(renderer, target, 0, 0, 4, 4);
    const nonEmpty = pixels.some((value, index) => index % 4 !== 3 && value > 0);
    if (!nonEmpty) throw new Error('Production material canary readback was empty');
    return {
      ok: true,
      backend: 'webgpu',
      reason: '',
      materials: validated,
      pixels: pixels.length,
      checks: {
        manualHeightByte,
        manualCoveredPixels,
        surfaceGreenDominance,
        surfaceCoveredPixels,
        surfaceMaxRgb,
        surfaceMaskMaxRgb,
        tileMaskedColorBytes,
      },
    };
  } catch (error) {
    return {
      ok: false,
      backend: null,
      reason: error?.message || String(error),
      materials: validated,
    };
  } finally {
    try { renderer?.setRenderTarget?.(null); } catch { /* ignore */ }
    for (const disposable of disposables.reverse()) {
      try { disposable?.dispose?.(); } catch { /* ignore */ }
    }
    try { sourceTexture?.dispose?.(); } catch { /* ignore */ }
    try { manualHeightTexture?.dispose?.(); } catch { /* ignore */ }
    try { manualSurfaceTextureA?.dispose?.(); } catch { /* ignore */ }
    try { manualSurfaceTextureB?.dispose?.(); } catch { /* ignore */ }
    try { surfaceDiffuseTexture?.dispose?.(); } catch { /* ignore */ }
    try { surfacePropsTexture?.dispose?.(); } catch { /* ignore */ }
    try { target?.dispose?.(); } catch { /* ignore */ }
    try { manualGeometry?.dispose?.(); } catch { /* ignore */ }
    try { geometry?.dispose?.(); } catch { /* ignore */ }
    try { renderer?.dispose?.(); } catch { /* ignore */ }
  }
}

let sharedValidation = null;

/** Reuse the device canary result across settings drawer mounts. */
export function validateWebGpuRuntimeOnce(options) {
  if (!sharedValidation) sharedValidation = validateWebGpuRuntime(options);
  return sharedValidation;
}
