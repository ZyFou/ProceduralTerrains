// ============================================================================
// CloudSettings: the reusable parameter model for the spherical volumetric
// cloud shell. These keys live in the engine `params` object (merged into
// DEFAULT_PARAMS) so they serialize with every planet save and old saves
// without clouds simply fall back to these defaults on load.
//
// Nothing here is baked into the shader — quality presets and fallback modes
// resolve to a small struct that PlanetCloudLayer turns into shader #defines
// (step counts) and uniforms (everything else).
// ============================================================================

// Default cloud parameters (flat keys, `cloud*` namespace to avoid collisions
// with the terrain params). Colors are arrays so they round-trip through the
// JSON save/load type check (typeof [] === 'object').
//
// IMPORTANT: only *appearance / shape* knobs live here (they serialize with a
// planet save). All cloud *quality / performance* knobs — raymarch steps,
// self-shadowing, fallback mode, max distance — live in the centralized
// PerformanceSettings (`perf.cloud*`) so there is a single source of truth and
// the Performance tab and the Clouds panel can never disagree. See
// CLOUD_LEGACY_PERF_KEYS below for migration of old saves.
export const CLOUD_DEFAULT_PARAMS = {
  cloudsEnabled: false,
  // Chunked cloud shell is experimental (off by default): splitting a volumetric
  // raymarch across cube-face sector meshes leaves visible seam lines at the
  // sector/face boundaries. The default is the seamless single-shell mesh with
  // in-shader empty-space skipping (same perf intent, no seams).
  cloudChunksEnabled: false,

  // shape / coverage
  cloudCoverage: 0.50,        // 0..1 — fraction of sky covered (higher = more)
  cloudDensity: 1.0,          // overall opacity / optical thickness multiplier
  cloudSoftness: 0.16,        // edge softness of the coverage threshold
  cloudNoiseVariant: 'soft',  // soft | billowy | wispy | cellular

  // shell geometry (world units, relative to the planet radius)
  cloudAltitude: 240,         // height of the inner shell above the surface
  cloudThickness: 620,        // radial thickness of the cloud shell

  // procedural noise layers (relative frequencies — scaled by radius in JS)
  cloudScale: 2.2,            // large-scale cloud shapes
  cloudDetailScale: 7.0,      // mid-scale billows
  cloudDetailStrength: 0.35,
  cloudErosionScale: 15.0,    // worley erosion that carves wispy edges
  cloudErosionStrength: 0.30,

  // animation
  cloudWindDir: 45,           // wind heading in degrees (XZ plane)
  cloudWindSpeed: 1.0,        // domain drift speed
  cloudRotationSpeed: 0.35,   // slow planet-axis rotation of the cloud field
  cloudEvolveSpeed: 1.0,      // how fast clouds form / morph / dissipate in place

  // lighting
  cloudLightAbsorption: 1.1,  // sun light extinction through the cloud
  cloudShadowStrength: 0.60,  // how dark self-shadowed regions get
  cloudScatteringStrength: 1.0,
  cloudColor: [1.0, 1.0, 1.0],
  cloudShadowColor: [0.42, 0.47, 0.60],
};

// Legacy quality/perf keys that used to live in params. Old saves may still
// carry them; loadSeedJSON ports them into `perf` once (see Engine).
export const CLOUD_LEGACY_PERF_KEYS = [
  'cloudSelfShadow', 'cloudMaxDistance', 'cloudFallback', 'cloudQuality',
];

export const CLOUD_NOISE_VARIANTS = [
  { value: 'soft', label: 'Soft', index: 0 },
  { value: 'billowy', label: 'Billowy', index: 1 },
  { value: 'wispy', label: 'Wispy', index: 2 },
  { value: 'cellular', label: 'Cellular', index: 3 },
];

export function resolveCloudNoiseVariant(value) {
  return CLOUD_NOISE_VARIANTS.find((v) => v.value === value)?.index ?? 0;
}

// Raymarch step counts per quality preset. Step counts are compile-time
// #defines in the shader (dynamic loop bounds hang the ANGLE/D3D11 compiler),
// so changing quality swaps the define and recompiles in the background.
export const CLOUD_QUALITY_PRESETS = {
  low:    { steps: 12, lightSteps: 2, octaves: 3, detailOctaves: 0, useErosion: false },
  medium: { steps: 24, lightSteps: 4, octaves: 4, detailOctaves: 2, useErosion: true },
  high:   { steps: 40, lightSteps: 6, octaves: 5, detailOctaves: 4, useErosion: true },
  ultra:  { steps: 72, lightSteps: 8, octaves: 5, detailOctaves: 5, useErosion: true },
};

// Fallback modes for weaker devices. They clamp the resolved quality and can
// force-disable self-shadowing or the whole layer without touching the user's
// chosen quality preset.
export const CLOUD_FALLBACK_MODES = {
  none: { label: 'Full', maxSteps: Infinity, allowSelfShadow: true, disabled: false },
  lite: { label: 'Lite', maxSteps: 16, allowSelfShadow: false, disabled: false },
  off:  { label: 'Off',  maxSteps: 0, allowSelfShadow: false, disabled: true },
};

/**
 * Resolve the effective step counts + self-shadow flag from the centralized
 * performance settings. Pure function — no THREE dependency.
 *
 * `config` is the merged `{ ...params, ...perf }` object; the quality keys
 * (cloudSteps/cloudLightSteps/cloudOctaves/cloudDetailOctaves/cloudUseErosion/
 * cloudSelfShadow/cloudFallback) come from `perf`, the single source of truth.
 * Defaults guard any caller that hasn't merged perf yet (e.g. early warmup).
 * @returns {{steps:number, lightSteps:number, octaves:number, detailOctaves:number, useErosion:boolean, selfShadow:boolean, disabled:boolean}}
 */
export function resolveCloudQuality(config) {
  const fallback = config.cloudFallback || 'none';
  const fb = CLOUD_FALLBACK_MODES[fallback] || CLOUD_FALLBACK_MODES.none;
  if (fb.disabled) {
    return {
      steps: 0,
      lightSteps: 0,
      octaves: 0,
      detailOctaves: 0,
      useErosion: false,
      selfShadow: false,
      lightMode: 0,
      stepLOD: false,
      disabled: true
    };
  }

  let steps = config.cloudSteps ?? 12;
  let lightSteps = config.cloudLightSteps ?? 6;
  const octaves = config.cloudOctaves ?? 5;
  const detailOctaves = config.cloudDetailOctaves ?? 4;
  const useErosion = config.cloudUseErosion !== false;

  steps = Math.max(8, Math.min(steps, fb.maxSteps));
  lightSteps = Math.max(1, Math.min(lightSteps, fb.allowSelfShadow ? lightSteps : 1));
  const selfShadow = config.cloudSelfShadow !== false && fb.allowSelfShadow;
  // cheap analytic self-shadow (2-tap) instead of the secondary march
  const lightMode = config.cloudLightMode ? 1 : 0;
  // distance-based primary-step LOD (drives uCloudStepScale per frame)
  const stepLOD = !!config.cloudStepLOD;

  return {
    steps,
    lightSteps,
    octaves,
    detailOctaves,
    useErosion,
    selfShadow,
    lightMode,
    stepLOD,
    disabled: false
  };
}

/**
 * Reverse-map the current perf step values to a named quality tier (low/medium/
 * high/ultra) for display, or 'custom' if they don't match a preset exactly.
 * @param {object} perf centralized performance settings
 * @returns {string}
 */
export function matchCloudQualityName(perf) {
  for (const [name, p] of Object.entries(CLOUD_QUALITY_PRESETS)) {
    if (perf.cloudSteps === p.steps &&
        perf.cloudLightSteps === p.lightSteps &&
        perf.cloudOctaves === p.octaves &&
        perf.cloudDetailOctaves === p.detailOctaves &&
        (perf.cloudUseErosion !== false) === p.useErosion) {
      return name;
    }
  }
  return 'custom';
}
