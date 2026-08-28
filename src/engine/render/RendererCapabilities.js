import {
  WEBGPU_RENDERER_STATUS,
  describeWebGpuApplicationStatus,
} from './RendererBackendStatus.js';

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
  const browserSupported = typeof navigator !== 'undefined' && !!navigator.gpu;
  const applicationReady = WEBGPU_RENDERER_STATUS.applicationReady;
  return {
    // `supported` retains its browser-capability meaning for diagnostics.
    supported: browserSupported,
    browserSupported,
    applicationReady,
    selectable: browserSupported && applicationReady,
    phase: WEBGPU_RENDERER_STATUS.phase,
    reason: !browserSupported
      ? 'WebGPU unavailable in this browser'
      : (applicationReady ? '' : describeWebGpuApplicationStatus()),
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
    extensions: {
      parallelShaderCompile: false,
      timerQuery: false,
      debugRendererInfo: false,
    },
    contextAttributes: null,
    precision: {
      fragmentHighp: null,
    },
    limits: {},
    detectedRenderer: 'Unavailable',
    detectedGpu: 'GPU info hidden by browser',
    gpuInfoAvailable: false,
    gpuInfoReason: 'Browser did not expose GPU info',
    vendor: '',
    renderer: '',
  };

  if (renderer?.isWebGPURenderer && renderer.backend?.isWebGPUBackend) {
    const backend = renderer.backend;
    const adapter = backend.adapter || null;
    const device = backend.device || null;
    const limits = device?.limits || adapter?.limits || {};
    const info = adapter?.info || {};
    const detectedGpu = info.description || info.device || info.architecture
      || info.vendor || 'WebGPU adapter';
    caps.webgpu = {
      ...caps.webgpu,
      supported: true,
      browserSupported: true,
      nativeActive: true,
    };
    caps.detectedRenderer = 'WebGPU';
    caps.detectedGpu = detectedGpu;
    caps.gpuInfoAvailable = detectedGpu !== 'WebGPU adapter';
    caps.gpuInfoReason = caps.gpuInfoAvailable ? '' : 'Browser hid WebGPU adapter details';
    caps.vendor = info.vendor || '';
    caps.renderer = detectedGpu;
    caps.contextAttributes = renderer.userData?.terrainRendererOptions || {
      antialias: false,
      alpha: false,
    };
    caps.gpuTiming = {
      supported: adapter?.features?.has?.('timestamp-query') === true
        || device?.features?.has?.('timestamp-query') === true,
    };
    caps.extensions.timerQuery = caps.gpuTiming.supported;
    caps.limits = {
      maxTextureSize: limits.maxTextureDimension2D ?? null,
      maxCubeMapTextureSize: limits.maxTextureDimension2D ?? null,
      max3dTextureSize: limits.maxTextureDimension3D ?? null,
      maxArrayTextureLayers: limits.maxTextureArrayLayers ?? null,
      maxRenderbufferSize: limits.maxTextureDimension2D ?? null,
      maxViewportDimensions: limits.maxTextureDimension2D != null
        ? [limits.maxTextureDimension2D, limits.maxTextureDimension2D]
        : null,
      maxSamples: null,
      maxVertexTextureUnits: limits.maxSampledTexturesPerShaderStage ?? null,
      maxFragmentTextureUnits: limits.maxSampledTexturesPerShaderStage ?? null,
      maxCombinedTextureUnits: limits.maxSampledTexturesPerShaderStage ?? null,
      maxVertexUniformVectors: null,
      maxFragmentUniformVectors: null,
      maxVertexUniformComponents: null,
      maxFragmentUniformComponents: null,
      maxVaryingVectors: null,
      maxVaryingComponents: limits.maxInterStageShaderVariables ?? null,
      maxDrawBuffers: limits.maxColorAttachments ?? null,
      maxColorAttachments: limits.maxColorAttachments ?? null,
      maxBindGroups: limits.maxBindGroups ?? null,
      maxBindingsPerBindGroup: limits.maxBindingsPerBindGroup ?? null,
      maxUniformBuffersPerShaderStage: limits.maxUniformBuffersPerShaderStage ?? null,
    };
    return caps;
  }

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

  const readParameter = (name) => {
    const token = gl[name];
    if (token == null || typeof gl.getParameter !== 'function') return null;
    try {
      const value = gl.getParameter(token);
      return ArrayBuffer.isView(value) ? Array.from(value) : value;
    } catch {
      return null;
    }
  };
  caps.limits = {
    maxTextureSize: readParameter('MAX_TEXTURE_SIZE'),
    maxCubeMapTextureSize: readParameter('MAX_CUBE_MAP_TEXTURE_SIZE'),
    max3dTextureSize: readParameter('MAX_3D_TEXTURE_SIZE'),
    maxArrayTextureLayers: readParameter('MAX_ARRAY_TEXTURE_LAYERS'),
    maxRenderbufferSize: readParameter('MAX_RENDERBUFFER_SIZE'),
    maxViewportDimensions: readParameter('MAX_VIEWPORT_DIMS'),
    maxSamples: readParameter('MAX_SAMPLES'),
    maxVertexTextureUnits: readParameter('MAX_VERTEX_TEXTURE_IMAGE_UNITS'),
    maxFragmentTextureUnits: readParameter('MAX_TEXTURE_IMAGE_UNITS'),
    maxCombinedTextureUnits: readParameter('MAX_COMBINED_TEXTURE_IMAGE_UNITS'),
    maxVertexUniformVectors: readParameter('MAX_VERTEX_UNIFORM_VECTORS'),
    maxFragmentUniformVectors: readParameter('MAX_FRAGMENT_UNIFORM_VECTORS'),
    maxVertexUniformComponents: readParameter('MAX_VERTEX_UNIFORM_COMPONENTS'),
    maxFragmentUniformComponents: readParameter('MAX_FRAGMENT_UNIFORM_COMPONENTS'),
    maxVaryingVectors: readParameter('MAX_VARYING_VECTORS'),
    maxVaryingComponents: readParameter('MAX_VARYING_COMPONENTS'),
    maxDrawBuffers: readParameter('MAX_DRAW_BUFFERS'),
    maxColorAttachments: readParameter('MAX_COLOR_ATTACHMENTS'),
  };

  try {
    caps.contextAttributes = gl.getContextAttributes?.() || null;
  } catch {
    caps.contextAttributes = null;
  }

  try {
    const highp = gl.getShaderPrecisionFormat?.(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    caps.precision.fragmentHighp = highp
      ? { precision: highp.precision, rangeMin: highp.rangeMin, rangeMax: highp.rangeMax }
      : null;
  } catch {
    caps.precision.fragmentHighp = null;
  }

  try {
    const timerExt = caps.webgl2
      ? gl.getExtension('EXT_disjoint_timer_query_webgl2')
      : gl.getExtension('EXT_disjoint_timer_query');
    caps.gpuTiming = { supported: !!timerExt };
    caps.extensions.timerQuery = !!timerExt;
  } catch {
    caps.gpuTiming = { supported: false };
    caps.extensions.timerQuery = false;
  }

  try {
    caps.extensions.parallelShaderCompile = !!gl.getExtension('KHR_parallel_shader_compile');
  } catch {
    caps.extensions.parallelShaderCompile = false;
  }

  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    caps.extensions.debugRendererInfo = !!dbg;
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
