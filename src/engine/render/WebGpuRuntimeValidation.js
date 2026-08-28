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

let sharedValidation = null;

/** Reuse the device canary result across settings drawer mounts. */
export function validateWebGpuRuntimeOnce(options) {
  if (!sharedValidation) sharedValidation = validateWebGpuRuntime(options);
  return sharedValidation;
}
