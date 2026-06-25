// ============================================================================
// WaterSettings: parameter model for the scalable water pipeline.
// Keys live in the engine `params` object (merged into DEFAULT_PARAMS) so they
// serialize with every save. Old saves without waterMode default to legacy.
// ============================================================================

export const WATER_MODES = [
  { value: 'off', label: 'Off' },
  { value: 'legacy', label: 'Legacy / Low' },
  { value: 'realistic', label: 'Realistic / Medium' },
  { value: 'volumetric', label: 'Volumetric / High' },
  { value: 'cinematic', label: 'Cinematic / Ultra' },
];

export const WATER_QUALITY_PRESETS = [
  { value: 'legacy', label: 'Legacy Low' },
  { value: 'balanced', label: 'Balanced Realistic' },
  { value: 'tropical', label: 'Clear Tropical' },
  { value: 'ocean', label: 'Deep Ocean' },
  { value: 'lake', label: 'Mountain Lake' },
  { value: 'swamp', label: 'Swamp Water' },
  { value: 'alien', label: 'Alien Water' },
  { value: 'volumetric', label: 'High Volumetric' },
  { value: 'cinematic', label: 'Cinematic Screenshot' },
];

/** Map water mode string → shader quality tier (0 = legacy handled separately). */
export function waterModeTier(mode) {
  switch (mode) {
    case 'realistic': return 1;
    case 'volumetric': return 2;
    case 'cinematic': return 3;
    default: return 0;
  }
}

export function isRealisticWaterMode(mode) {
  return mode === 'realistic' || mode === 'volumetric' || mode === 'cinematic';
}

export function isWaterActive(mode, seaLevel) {
  return mode !== 'off' && seaLevel > 0.5;
}

// ----------------------------------------------------------------------------
// Underwater effect quality.
//
//  - 'off'   : no underwater post-process, no terrain caustics.
//  - 'lite'  : cheap screen-space tint/fog/distortion + simple caustics.
//              Compatible with the legacy (and any) water renderer.
//  - 'high'  : depth-aware absorption, layered caustics, light shafts and
//              optional particles. Requires the realistic water renderer; if
//              selected without it, it transparently falls back to 'lite'.
//  - 'auto'  : High with the realistic renderer, Lite with legacy water.
// ----------------------------------------------------------------------------

export const UNDERWATER_MODES = [
  { value: 'off', label: 'Off' },
  { value: 'lite', label: 'Lite' },
  { value: 'high', label: 'High' },
  { value: 'auto', label: 'Auto' },
];

/** Resolve the effective underwater quality ('off' | 'lite' | 'high'). */
export function resolveUnderwaterMode(params, effectiveWaterMode, perfEnabled = true) {
  if (perfEnabled === false) return 'off';
  if (params.waterUnderwaterEnabled === false) return 'off';
  if (!isWaterActive(effectiveWaterMode, params.seaLevel ?? 100)) return 'off';

  const requested = params.waterUnderwaterMode ?? 'auto';
  if (requested === 'off') return 'off';

  const realistic = isRealisticWaterMode(effectiveWaterMode);
  if (requested === 'lite') return 'lite';
  if (requested === 'high') return realistic ? 'high' : 'lite';
  // auto
  return realistic ? 'high' : 'lite';
}

/** True when High was requested but the renderer forced a Lite fallback. */
export function underwaterModeFellBack(params, effectiveWaterMode) {
  const requested = params.waterUnderwaterMode ?? 'auto';
  return requested === 'high' && !isRealisticWaterMode(effectiveWaterMode);
}

export const WATER_DEFAULT_PARAMS = {
  waterEnabled: true,
  waterMode: 'legacy',
  waterQualityPreset: 'legacy',
  waterAutoDowngradeInfinite: true,
  waterLegacyOnLowFps: true,

  // material
  waterOpacity: 0.72,
  waterRoughness: 0.35,
  waterFresnelStrength: 1.0,
  waterRefractionStrength: 0.45,
  waterSpecularStrength: 1.0,

  // depth
  waterDepthColorStrength: 1.0,
  waterDepthOpacityStrength: 1.0,
  waterMaxVisibleDepth: 120,
  waterDepthFalloff: 1.0,
  waterShallowDistance: 8,
  waterDeepDistance: 55,
  waterAbsorptionStrength: 1.0,

  // waves
  waterWaveSpeed: 1.0,
  waterWaveScale: 1.0,
  waterWaveStrength: 1.0,
  waterSmallWaveStrength: 0.65,
  waterLargeWaveStrength: 1.0,
  waterNormalIntensity: 1.0,
  waterWaveDirection: 0,
  waterAnimSpeed: 1.0,

  // foam
  waterFoamEnabled: true,
  waterFoamStrength: 0.75,
  waterFoamWidth: 3.2,
  waterFoamSoftness: 0.6,
  waterFoamAnimSpeed: 1.0,
  waterSlopeFoam: 0.25,
  waterCliffFoam: 0.3,

  // underwater (post-effect tuning — actual master toggle lives in perf.underwaterEffect)
  waterUnderwaterEnabled: true,
  // Off / Lite (legacy water, cheap) / High (realistic water, cinematic) / Auto.
  // Auto picks High with the realistic renderer, Lite with legacy water.
  waterUnderwaterMode: 'auto',
  waterUnderwaterFogDensity: 1.0,
  waterUnderwaterVisibility: 1.0,
  waterUnderwaterDistortion: 0.5,
  waterUnderwaterCaustics: 0.4,
  waterUnderwaterCausticsEnabled: true,
  waterUnderwaterCausticScale: 1.0,
  waterUnderwaterCausticSpeed: 1.0,
  waterUnderwaterParticles: false,
  waterUnderwaterLightShafts: false,
  waterSurfaceTransition: 0.8,

  // performance (quality knobs — heavy ones also in perf)
  waterReflectionQuality: 1.0,
  waterRefractionQuality: 0.6,
  waterFoamQuality: 1.0,
  waterCausticsQuality: 0.5,
  waterNormalResolution: 1.0,
  waterRenderScale: 1.0,
  waterUpdateFrequency: 1.0,
  waterDisableExpensiveBelowFps: 42,

  // debug
  waterDebugView: 'off',
  waterShowMeshBounds: false,
  waterShowPerfCost: false,

  // export defaults (UI state — not serialized in params by default)
};

/**
 * Silent migration for old saves: no waterMode → legacy if water was effectively on.
 */
export function migrateWaterParams(params) {
  if (!params || typeof params !== 'object') return params;
  if ('waterMode' in params) return params;
  const next = { ...params };
  if (next.waterEnabled === false || (next.seaLevel ?? 100) <= 0.5) {
    next.waterMode = 'off';
    next.waterEnabled = false;
  } else {
    next.waterMode = 'legacy';
    next.waterEnabled = true;
  }
  return next;
}

/** Resolve effective mode after infinite-world / planet safeguards. */
export function resolveEffectiveWaterMode(params, worldMode) {
  let mode = params.waterMode ?? 'legacy';
  if (!params.waterEnabled) mode = 'off';
  if (params.seaLevel <= 0.5) mode = 'off';

  if (worldMode === 'infinite' && params.waterAutoDowngradeInfinite) {
    if (mode === 'cinematic') mode = 'realistic';
    else if (mode === 'volumetric') mode = 'realistic';
  }

  if (worldMode === 'planet' && isRealisticWaterMode(mode)) {
    // Flat realistic water is not supported on the sphere shell yet.
    mode = 'legacy';
  }

  return mode;
}

export function valWater(params, key) {
  return params[key] ?? WATER_DEFAULT_PARAMS[key];
}

export const WORLD_MODE_WATER_LABELS = {
  studio: 'Tile',
  infinite: 'Infinite World',
  planet: 'Planet',
};

export const WORLD_MODE_WATER_HINTS = {
  studio: 'All water quality modes are available. Best mode for high-quality water and screenshots.',
  infinite: 'Water plane follows the camera across streamed chunks. Colors, sea level, and mode changes apply live.',
  planet: 'Spherical ocean shell wraps the planet. Colors and animation apply live; Realistic modes render as Legacy until spherical volumetric water is ready.',
};

export function isWaterModeDowngraded(params, worldMode) {
  const selected = params.waterMode ?? 'legacy';
  const effective = resolveEffectiveWaterMode(params, worldMode);
  return selected !== effective;
}
