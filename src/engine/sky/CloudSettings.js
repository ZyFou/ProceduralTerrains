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
export const CLOUD_DEFAULT_PARAMS = {
  cloudsEnabled: false,

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

  // lighting
  cloudLightAbsorption: 1.1,  // sun light extinction through the cloud
  cloudShadowStrength: 0.60,  // how dark self-shadowed regions get
  cloudScatteringStrength: 1.0,
  cloudColor: [1.0, 1.0, 1.0],
  cloudShadowColor: [0.42, 0.47, 0.60],

  // performance
  cloudQuality: 'high',       // low | medium | high | ultra
  cloudSelfShadow: true,      // sun-direction secondary march (soft shading)
  cloudMaxDistance: 6.0,      // hide clouds past this × planetRadius
  cloudFallback: 'none',      // none | lite | off (safe modes for weak GPUs)
};

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
  low:    { steps: 24, lightSteps: 2, octaves: 3, detailOctaves: 0, useErosion: false },
  medium: { steps: 40, lightSteps: 4, octaves: 4, detailOctaves: 2, useErosion: true },
  high:   { steps: 64, lightSteps: 6, octaves: 5, detailOctaves: 4, useErosion: true },
  ultra:  { steps: 96, lightSteps: 8, octaves: 5, detailOctaves: 5, useErosion: true },
};

// Fallback modes for weaker devices. They clamp the resolved quality and can
// force-disable self-shadowing or the whole layer without touching the user's
// chosen quality preset.
export const CLOUD_FALLBACK_MODES = {
  none: { label: 'Full', maxSteps: Infinity, allowSelfShadow: true, disabled: false },
  lite: { label: 'Lite', maxSteps: 28, allowSelfShadow: false, disabled: false },
  off:  { label: 'Off',  maxSteps: 0, allowSelfShadow: false, disabled: true },
};

/**
 * Resolve the effective step counts + self-shadow flag from the chosen quality
 * preset and fallback mode. Pure function — no THREE dependency.
 * @param {object} params engine params (or any object with the cloud* keys)
 * @returns {{steps:number, lightSteps:number, octaves:number, detailOctaves:number, useErosion:boolean, selfShadow:boolean, disabled:boolean}}
 */
export function resolveCloudQuality(params) {
  const fallback = params.cloudFallback || 'none';
  const fb = CLOUD_FALLBACK_MODES[fallback] || CLOUD_FALLBACK_MODES.none;
  if (fb.disabled) {
    return {
      steps: 0,
      lightSteps: 0,
      octaves: 0,
      detailOctaves: 0,
      useErosion: false,
      selfShadow: false,
      disabled: true
    };
  }

  let steps = 64;
  let lightSteps = 6;
  let octaves = 5;
  let detailOctaves = 4;
  let useErosion = true;

  if ('cloudSteps' in params) {
    steps = params.cloudSteps;
    lightSteps = params.cloudLightSteps;
    octaves = params.cloudOctaves;
    detailOctaves = params.cloudDetailOctaves;
    useErosion = !!params.cloudUseErosion;
  } else {
    // legacy/params fallback
    const preset = CLOUD_QUALITY_PRESETS[params.cloudQuality] || CLOUD_QUALITY_PRESETS.high;
    steps = preset.steps;
    lightSteps = preset.lightSteps;
    octaves = preset.octaves ?? 5;
    detailOctaves = preset.detailOctaves ?? 4;
    useErosion = params.cloudUseErosion ?? preset.useErosion;
  }

  steps = Math.max(8, Math.min(steps, fb.maxSteps));
  lightSteps = Math.max(1, Math.min(lightSteps, fb.allowSelfShadow ? lightSteps : 1));
  const selfShadow = !!params.cloudSelfShadow && fb.allowSelfShadow;

  return {
    steps,
    lightSteps,
    octaves,
    detailOctaves,
    useErosion,
    selfShadow,
    disabled: false
  };
}
