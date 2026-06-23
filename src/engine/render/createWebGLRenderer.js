import * as THREE from 'three';

/**
 * Probe whether WebGL is available in this browser / GPU stack.
 */
export function probeWebGL() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false })
      || canvas.getContext('webgl', { failIfMajorPerformanceCaveat: false })
      || canvas.getContext('experimental-webgl');
    if (!gl) return { ok: false, reason: 'WebGL is not supported in this browser.' };
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
  }
}

/** Force-release any WebGL context bound to a canvas (best-effort). */
export function releaseCanvasWebGLContext(canvas) {
  if (!canvas) return;
  try {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const ext = gl?.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  } catch {
    // ignore — canvas may not have a context yet
  }
}

const RENDERER_ATTEMPTS = [
  { antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false },
  { antialias: false, alpha: false, powerPreference: 'default', stencil: false },
  { antialias: false, alpha: false, powerPreference: 'low-power', stencil: false, depth: true },
];

/**
 * Create a WebGLRenderer for the given canvas, trying progressively safer options.
 * @returns {THREE.WebGLRenderer}
 */
export function createRendererForCanvas(canvas) {
  if (!canvas) throw new Error('No canvas element was provided for WebGL initialization.');

  const probe = probeWebGL();
  if (!probe.ok) throw new Error(probe.reason);

  let lastError = null;
  for (const options of RENDERER_ATTEMPTS) {
    try {
      const renderer = new THREE.WebGLRenderer({ canvas, ...options });
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
