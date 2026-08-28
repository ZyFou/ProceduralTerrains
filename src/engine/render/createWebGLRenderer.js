import * as THREE from 'three';
import { sanitizeGpuPreference } from './RendererCapabilities.js';
import { WEBGPU_RENDERER_STATUS } from './RendererBackendStatus.js';

/**
 * Probe whether WebGL is available in this browser / GPU stack.
 */
export function probeWebGL() {
  let gl = null;
  try {
    const canvas = document.createElement('canvas');
    gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
    if (!gl) return { ok: false, reason: 'WebGL 2 is required by the terrain renderer.' };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : '';
    const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '';
    if (/disabled/i.test(vendor) || /disabled/i.test(renderer)) {
      return {
        ok: false,
        reason: 'GPU rendering appears disabled. Enable hardware acceleration in your browser settings, then reload.',
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e?.message || 'WebGL probe failed.' };
  } finally {
    // The probe is a separate WebGL context created immediately before the
    // real renderer. Release it explicitly instead of waiting for GC so
    // low-memory GPUs do not start the editor with one context already alive.
    try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ }
  }
}

/** Force-release any WebGL context bound to a canvas (best-effort). */
export function releaseCanvasWebGLContext(canvas) {
  if (!canvas) return;
  try {
    const gl = canvas.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  } catch {
    // ignore — canvas may not have a context yet
  }
}

const BASE_RENDERER_ATTEMPTS = [
  { antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false },
  { antialias: false, alpha: false, powerPreference: 'default', stencil: false },
  { antialias: false, alpha: false, powerPreference: 'low-power', stencil: false, depth: true },
];

function buildRendererAttempts(gpuPreference = 'default') {
  const pref = sanitizeGpuPreference(gpuPreference);
  const preferred = pref === 'default' ? 'default' : pref;
  const first = { antialias: true, alpha: false, powerPreference: preferred, stencil: false };
  const seen = new Set();
  return [first, ...BASE_RENDERER_ATTEMPTS].filter((attempt) => {
    const key = JSON.stringify(attempt);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Create a WebGL2 renderer for the given canvas, trying progressively safer options.
 * @returns {THREE.WebGLRenderer}
 */
export function createRendererForCanvas(canvas, settings = {}) {
  if (!canvas) throw new Error('No canvas element was provided for WebGL initialization.');

  const probe = probeWebGL();
  if (!probe.ok) throw new Error(probe.reason);

  let lastError = null;
  for (const options of buildRendererAttempts(settings.gpuPreference)) {
    try {
      const renderer = new THREE.WebGLRenderer({ canvas, ...options });
      renderer.userData = {
        ...(renderer.userData || {}),
        terrainRendererOptions: { ...options },
      };
      return renderer;
    } catch (err) {
      lastError = err;
      releaseCanvasWebGLContext(canvas);
    }
  }

  throw lastError || new Error(
    'Could not create a WebGL context. Try closing other 3D tabs, reloading the page, or enabling hardware acceleration.',
  );
}

function normalizedBackend(value) {
  return value === 'webgpu' || value === 'webgl' ? value : 'auto';
}

/**
 * Create and initialize the selected renderer before Engine constructs any GPU
 * resources. WebGPU initialization is asynchronous; failures fall back on a
 * fresh WebGL2 renderer bound to the same canvas before the scene exists.
 */
export async function createRendererForCanvasAsync(canvas, settings = {}, {
  webgpuStatus = WEBGPU_RENDERER_STATUS,
  loadWebGpuModule = () => import('three/webgpu'),
  createWebGlRenderer = createRendererForCanvas,
} = {}) {
  const requestedBackend = normalizedBackend(settings.rendererBackend);
  const webgpuRequested = requestedBackend === 'webgpu'
    || (requestedBackend === 'auto' && webgpuStatus.applicationReady === true);

  if (!webgpuRequested) {
    return {
      renderer: createWebGlRenderer(canvas, settings),
      requestedBackend,
      activeBackend: 'webgl2',
      fallbackReason: '',
    };
  }

  if (typeof navigator === 'undefined' || !navigator.gpu) {
    return {
      renderer: createWebGlRenderer(canvas, settings),
      requestedBackend,
      activeBackend: 'webgl2',
      fallbackReason: 'WebGPU API unavailable',
    };
  }

  if (webgpuStatus.applicationReady !== true) {
    return {
      renderer: createWebGlRenderer(canvas, settings),
      requestedBackend,
      activeBackend: 'webgl2',
      fallbackReason: 'Production WebGPU material parity is incomplete',
    };
  }

  let renderer = null;
  try {
    const webgpu = await loadWebGpuModule();
    const gpuPreference = sanitizeGpuPreference(settings.gpuPreference);
    const rendererOptions = {
      canvas,
      antialias: false,
      alpha: false,
      forceWebGL: false,
      ...(gpuPreference === 'default' ? {} : { powerPreference: gpuPreference }),
    };
    renderer = new webgpu.WebGPURenderer(rendererOptions);
    await renderer.init();
    if (!renderer.backend?.isWebGPUBackend) {
      throw new Error('Three.js selected its WebGL2 fallback backend');
    }
    renderer.userData = {
      ...(renderer.userData || {}),
      terrainRendererOptions: {
        antialias: false,
        alpha: false,
        powerPreference: gpuPreference,
      },
    };
    return {
      renderer,
      requestedBackend,
      activeBackend: 'webgpu',
      fallbackReason: '',
    };
  } catch (error) {
    try { renderer?.dispose?.(); } catch { /* best-effort failed backend cleanup */ }
    return {
      renderer: createWebGlRenderer(canvas, settings),
      requestedBackend,
      activeBackend: 'webgl2',
      fallbackReason: error?.message || 'WebGPU initialization failed',
    };
  }
}

export function loseRendererContext(renderer) {
  if (!renderer) return;
  try {
    const gl = renderer.getContext();
    const ext = gl?.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  } catch {
    // ignore
  }
}
