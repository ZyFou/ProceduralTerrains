// ============================================================================
// Water quality presets — apply groups of water settings at once.
// ============================================================================

import { WATER_DEFAULT_PARAMS } from './WaterSettings.js';

export const WATER_PRESETS = {
  legacy: {
    label: 'Legacy Low',
    patch: {
      waterMode: 'legacy',
      waterQualityPreset: 'legacy',
      waterFoamEnabled: true,
      waterFoamStrength: 0.75,
    },
  },
  balanced: {
    label: 'Balanced Realistic',
    patch: {
      waterMode: 'realistic',
      waterQualityPreset: 'balanced',
      waterDepthColorStrength: 1.0,
      waterFoamEnabled: true,
      waterFoamStrength: 0.7,
      waterFresnelStrength: 1.0,
      waterUnderwaterEnabled: true,
      waterRefractionQuality: 0.5,
      waterCausticsQuality: 0.3,
    },
  },
  tropical: {
    label: 'Clear Tropical',
    patch: {
      waterMode: 'realistic',
      waterQualityPreset: 'tropical',
      waterDepthColorStrength: 0.85,
      waterDepthOpacityStrength: 0.7,
      waterMaxVisibleDepth: 90,
      waterShallowDistance: 12,
      waterDeepDistance: 45,
      waterAbsorptionStrength: 0.6,
      waterFoamStrength: 0.55,
      waterFresnelStrength: 1.1,
      waterRefractionStrength: 0.55,
    },
  },

  cartoon: {
    label: 'Cartoon Water',
    patch: {
      waterMode: 'legacy',
      waterQualityPreset: 'cartoon',
      waterOpacity: 0.78,
      waterRoughness: 0.18,
      waterFresnelStrength: 1.35,
      waterRefractionStrength: 0.25,
      waterSpecularStrength: 0.85,
      waterDepthColorStrength: 0.65,
      waterDepthOpacityStrength: 0.55,
      waterMaxVisibleDepth: 80,
      waterShallowDistance: 14,
      waterDeepDistance: 38,
      waterAbsorptionStrength: 0.55,
      waterWaveSpeed: 0.55,
      waterWaveScale: 1.65,
      waterWaveStrength: 0.34,
      waterSmallWaveStrength: 0.18,
      waterLargeWaveStrength: 0.28,
      waterNormalIntensity: 0.45,
      waterFoamEnabled: true,
      waterFoamStrength: 1.15,
      waterFoamWidth: 5.6,
      waterFoamSoftness: 0.35,
      waterFoamAnimSpeed: 0.55,
      waterSlopeFoam: 0.15,
      waterCliffFoam: 0.18,
      waterUnderwaterMode: 'lite',
      waterUnderwaterFogDensity: 0.75,
      waterUnderwaterVisibility: 1.25,
      waterUnderwaterDistortion: 0.25,
      waterUnderwaterCaustics: 0.25,
      waterReflectionQuality: 0.35,
      waterRefractionQuality: 0.25,
      waterFoamQuality: 0.8,
      waterCausticsQuality: 0.2,
      waterNormalResolution: 0.5,
      waterRenderScale: 0.75,
    },
  },
  ocean: {
    label: 'Deep Ocean',
    patch: {
      waterMode: 'realistic',
      waterQualityPreset: 'ocean',
      waterDepthColorStrength: 1.25,
      waterDepthOpacityStrength: 1.15,
      waterMaxVisibleDepth: 160,
      waterShallowDistance: 6,
      waterDeepDistance: 80,
      waterAbsorptionStrength: 1.35,
      waterFoamStrength: 0.65,
      waterFresnelStrength: 0.9,
    },
  },
  lake: {
    label: 'Mountain Lake',
    patch: {
      waterMode: 'realistic',
      waterQualityPreset: 'lake',
      waterDepthColorStrength: 0.95,
      waterMaxVisibleDepth: 70,
      waterShallowDistance: 10,
      waterDeepDistance: 40,
      waterWaveStrength: 0.45,
      waterSmallWaveStrength: 0.35,
      waterFoamStrength: 0.4,
      waterFoamWidth: 2.4,
    },
  },
  swamp: {
    label: 'Swamp Water',
    patch: {
      waterMode: 'realistic',
      waterQualityPreset: 'swamp',
      waterDepthColorStrength: 1.1,
      waterDepthOpacityStrength: 1.25,
      waterMaxVisibleDepth: 35,
      waterAbsorptionStrength: 1.5,
      waterOpacity: 0.88,
      waterFoamStrength: 0.35,
      waterUnderwaterFogDensity: 1.4,
      waterUnderwaterVisibility: 0.55,
    },
  },
  alien: {
    label: 'Alien Water',
    patch: {
      waterMode: 'volumetric',
      waterQualityPreset: 'alien',
      waterDepthColorStrength: 1.3,
      waterFresnelStrength: 1.4,
      waterRefractionStrength: 0.7,
      waterFoamStrength: 0.5,
      waterUnderwaterCaustics: 0.8,
      waterCausticsQuality: 0.85,
    },
  },
  volumetric: {
    label: 'High Volumetric',
    patch: {
      waterMode: 'volumetric',
      waterQualityPreset: 'volumetric',
      waterDepthColorStrength: 1.15,
      waterDepthOpacityStrength: 1.1,
      waterAbsorptionStrength: 1.2,
      waterFoamStrength: 0.85,
      waterFoamQuality: 1.2,
      waterRefractionQuality: 0.75,
      waterCausticsQuality: 0.65,
      waterUnderwaterCaustics: 0.55,
      waterNormalIntensity: 1.15,
    },
  },
  cinematic: {
    label: 'Cinematic Screenshot',
    patch: {
      waterMode: 'cinematic',
      waterQualityPreset: 'cinematic',
      waterDepthColorStrength: 1.2,
      waterFoamStrength: 1.0,
      waterFoamQuality: 1.5,
      waterReflectionQuality: 1.3,
      waterRefractionQuality: 1.0,
      waterCausticsQuality: 1.0,
      waterNormalIntensity: 1.25,
      waterLargeWaveStrength: 1.15,
      waterUnderwaterCaustics: 0.7,
    },
  },
};

export function applyWaterPreset(params, presetKey) {
  const preset = WATER_PRESETS[presetKey];
  if (!preset) return params;
  return {
    ...params,
    waterEnabled: preset.patch.waterMode !== 'off',
    ...preset.patch,
    waterQualityPreset: presetKey,
  };
}

export function resetWaterSettings(params) {
  const next = { ...params };
  for (const key of Object.keys(WATER_DEFAULT_PARAMS)) {
    next[key] = WATER_DEFAULT_PARAMS[key];
  }
  return next;
}
