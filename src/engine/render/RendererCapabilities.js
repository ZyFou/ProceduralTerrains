export const RENDERER_BACKENDS = ['auto', 'webgl', 'webgpu'];
export const GPU_PREFERENCES = ['default', 'high-performance', 'low-power'];

export function sanitizeRendererBackend(value) {
  return RENDERER_BACKENDS.includes(value) ? value : 'auto';
}

export function sanitizeGpuPreference(value) {
  return GPU_PREFERENCES.includes(value) ? value : 'default';
}

export function labelRendererBackend(value) {
  return ({
    auto: 'Auto',
    webgl: 'WebGL',
    webgpu: 'WebGPU',
  })[value] || 'Auto';
}

export function labelGpuPreference(value) {
  return ({
    default: 'Default',
    'high-performance': 'High Performance',
    'low-power': 'Low Power',
  })[value] || 'Default';
}

export function getWebGpuSupport() {
  return {
    supported: typeof navigator !== 'undefined' && !!navigator.gpu,
    reason: typeof navigator !== 'undefined' && navigator.gpu
      ? ''
      : 'WebGPU unavailable in this browser',
  };
}

export function detectRendererCapabilities(renderer = null) {
  const caps = {
    webgl: false,
    webgl2: false,
    webgpu: getWebGpuSupport(),
    memory: {
      supported: typeof performance !== 'undefined' && !!performance.memory,
    },
    gpuTiming: { supported: false },
    detectedRenderer: 'Unavailable',
    detectedGpu: 'GPU info hidden by browser',
    gpuInfoAvailable: false,
    gpuInfoReason: 'Browser did not expose GPU info',
    vendor: '',
    renderer: '',
  };

  let gl = null;
  let ownsContext = false;
  try {
    if (renderer && typeof renderer.getContext === 'function') {
      gl = renderer.getContext();
    } else if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false })
        || canvas.getContext('webgl', { failIfMajorPerformanceCaveat: false })
        || canvas.getContext('experimental-webgl');
      ownsContext = true;
    }
  } catch {
    gl = null;
  }

  if (!gl) return caps;

  caps.webgl = true;
  caps.webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  caps.detectedRenderer = caps.webgl2 ? 'WebGL 2' : 'WebGL 1';

  try {
    const timerExt = caps.webgl2
      ? gl.getExtension('EXT_disjoint_timer_query_webgl2')
      : gl.getExtension('EXT_disjoint_timer_query');
    caps.gpuTiming = { supported: !!timerExt };
  } catch {
    caps.gpuTiming = { supported: false };
  }

  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) {
      caps.vendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || '';
      caps.renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '';
      caps.detectedGpu = caps.renderer || caps.vendor || 'GPU info unavailable';
      caps.gpuInfoAvailable = !!(caps.vendor || caps.renderer);
      caps.gpuInfoReason = caps.gpuInfoAvailable ? '' : 'Browser exposed debug info without a GPU string';
    }
  } catch {
    caps.detectedGpu = 'GPU info hidden by browser';
    caps.gpuInfoReason = 'Browser blocked debug renderer info';
  }

  if (ownsContext) {
    try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ }
  }

  return caps;
}
