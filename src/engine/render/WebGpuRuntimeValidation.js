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
  let sourceTexture = null;
  const disposables = [];
  const validated = [];
  try {
    const [THREE, backendModule, skyModule, postModule, underwaterModule, lowResModule,
      occupancyModule, cloudModule, terrainModule] = await Promise.all([
      import('three/webgpu'),
      import('./webgpu/WebGpuMaterialBackend.js'),
      import('../sky/proceduralSkyGLSL.js'),
      import('./VisualPostProcess.js'),
      import('./UnderwaterEffect.js'),
      import('../sky/CloudLowResPass.js'),
      import('../sky/CloudOccupancyPass.js'),
      import('../sky/CloudSlabShader.js'),
      import('../terrain/TerrainMaterial.js'),
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
    disposables.push(
      sky.material,
      post,
      underwater,
      lowRes,
      occupancy,
      cloudSource,
      manualEmpty,
      manualSurface,
    );

    const candidates = [
      ['sky-procedural', sky.material],
      ['post-look', post._lookMaterial],
      ['post-camera', post._cameraMaterial],
      ['underwater', underwater._material],
      ['cloud-composite', lowRes._composite],
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
    for (const material of [manualEmpty, manualSurface]) {
      for (const node of Object.values(material.uniforms || {})) {
        if (node?.isTextureNode) node.value = sourceTexture;
      }
      mesh.material = material;
      await renderer.compileAsync(scene, camera);
      renderer.render(scene, camera);
    }
    validated.push('terrain-manual');
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
    try { target?.dispose?.(); } catch { /* ignore */ }
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
