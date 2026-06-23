export const VISUAL_QUALITY_PRESETS = ['off', 'low', 'balanced', 'high', 'cinematic'];

export const VISUAL_DEFAULT_PARAMS = {
  visualPreset: 'balanced',
  visualsEnabled: true,
  atmosphereEnabled: true,
  atmosphereAutoTime: true,
  atmosphereAutoBiome: false,
  fogEnabled: true,
  fogColor: '#9fb4c8',
  fogDensity: 0.18,
  fogStart: 160,
  fogEnd: 2400,
  heightFogStrength: 0.28,
  heightFogStart: 28,
  heightFogFalloff: 220,
  distanceFogStrength: 0.42,
  horizonHaze: true,
  hazeColor: '#c8d5df',
  hazeDensity: 0.22,
  hazeHeight: 180,
  hazeFalloff: 0.65,
  sunHazeStrength: 0.18,
  groundMist: false,
  valleyFog: false,
  localFogVolumesEnabled: false,
  volumeDensity: 0.22,
  volumeColor: '#d8e1e6',
  volumeSoftness: 0.75,
  volumeAutoValleys: false,
  volumeAutoWater: false,
  volumeAutoBiome: false,
  cloudShadowsEnabled: true,
  cloudShadowStrength: 0.16,
  cloudShadowSoftness: 0.65,
  cloudShadowScale: 1.4,
  cloudShadowSpeed: 0.025,
  cloudShadowDirection: 35,
  cloudShadowSync: true,
  cloudShadowNoise: 0.55,
  lightShaftsEnabled: false,
  lightShaftIntensity: 0.22,
  lightShaftLength: 0.72,
  lightShaftSoftness: 0.65,
  lightShaftDecay: 0.92,
  lightShaftResolution: 0.5,
  lightShaftQuality: 'medium',
  lightShaftSunOnly: true,
  volumetricFogEnabled: false,
  volumetricFogQuality: 'low',
  postFxEnabled: true,
  toneMappingMode: 'filmic',
  exposure: 1.0,
  gamma: 2.2,
  whitePoint: 1.0,
  contrast: 1.04,
  saturation: 1.06,
  temperature: 0,
  tint: 0,
  colorPreset: 'natural',
  bloomEnabled: true,
  bloomStrength: 0.08,
  bloomRadius: 0.45,
  bloomThreshold: 0.78,
  bloomQuality: 'low',
  aoEnabled: true,
  aoStrengthPost: 0.12,
  aoRadius: 0.35,
  aoQuality: 'low',
  aoDistanceFade: 0.8,
  dofEnabled: false,
  dofFocusDistance: 900,
  dofFocusRange: 450,
  dofBlurStrength: 0.18,
  dofAutoFocus: true,
  dofScreenshotOnly: true,
  aaMode: 'fxaa',
  aaQuality: 'medium',
  vignette: false,
  vignetteStrength: 0.18,
  filmGrain: false,
  filmGrainStrength: 0.035,
  chromaticAberration: false,
  chromaticAberrationStrength: 0.0015,
  sharpen: false,
  sharpenStrength: 0.18,
  lensDirt: false,
  visualRenderScale: 1.0,
  screenshotVisualOverride: true,
  screenshotRenderScale: 1.5,
  screenshotFormatPreset: 'viewport',
  hideUiForScreenshot: false,
  transparentScreenshot: false,
  visualDebugView: 'off',
  visualCostWarning: true,
  visualAutoDisable: false,
};

export function visualPatchForPreset(preset, worldMode = 'studio') {
  const infinite = worldMode === 'infinite';
  const planet = worldMode === 'planet';
  const base = { visualPreset: preset };
  if (preset === 'off') return { ...base, visualsEnabled: false, atmosphereEnabled: false, postFxEnabled: false, fogEnabled: false, bloomEnabled: false, aoEnabled: false, cloudShadowsEnabled: false, lightShaftsEnabled: false, volumetricFogEnabled: false };
  if (preset === 'low') return { ...base, visualsEnabled: true, atmosphereEnabled: true, postFxEnabled: true, fogEnabled: true, fogDensity: 0.11, distanceFogStrength: 0.25, heightFogStrength: 0.08, horizonHaze: true, bloomEnabled: false, aoEnabled: false, cloudShadowsEnabled: false, lightShaftsEnabled: false, volumetricFogEnabled: false, visualRenderScale: 0.9, contrast: 1.0, saturation: 1.0 };
  if (preset === 'high') return { ...base, visualsEnabled: true, atmosphereEnabled: true, postFxEnabled: true, fogEnabled: true, fogDensity: 0.22, distanceFogStrength: 0.52, heightFogStrength: planet ? 0.12 : 0.36, horizonHaze: true, hazeDensity: 0.28, bloomEnabled: true, bloomStrength: 0.13, aoEnabled: true, aoStrengthPost: 0.18, cloudShadowsEnabled: true, lightShaftsEnabled: !infinite, volumetricFogEnabled: !infinite && !planet, visualRenderScale: 1.0, contrast: 1.08, saturation: 1.08 };
  if (preset === 'cinematic') return { ...base, visualsEnabled: true, atmosphereEnabled: true, postFxEnabled: true, fogEnabled: true, fogDensity: infinite ? 0.22 : 0.3, distanceFogStrength: 0.62, heightFogStrength: planet ? 0.16 : 0.52, horizonHaze: true, hazeDensity: 0.36, bloomEnabled: true, bloomStrength: 0.18, aoEnabled: true, aoStrengthPost: 0.22, cloudShadowsEnabled: true, lightShaftsEnabled: !infinite, volumetricFogEnabled: !infinite && !planet, dofEnabled: false, vignette: true, filmGrain: true, visualRenderScale: infinite ? 1.0 : 1.1, contrast: 1.12, saturation: 1.1 };
  return { ...base, visualsEnabled: true, atmosphereEnabled: true, postFxEnabled: true, fogEnabled: true, fogDensity: 0.18, distanceFogStrength: 0.42, heightFogStrength: planet ? 0.08 : 0.28, horizonHaze: true, bloomEnabled: true, bloomStrength: 0.08, aoEnabled: true, aoStrengthPost: infinite ? 0.08 : 0.12, cloudShadowsEnabled: !planet, lightShaftsEnabled: false, volumetricFogEnabled: false, visualRenderScale: 1.0, contrast: 1.04, saturation: 1.06 };
}

export function sanitizeVisualParams(params, worldMode = 'studio') {
  const next = { ...VISUAL_DEFAULT_PARAMS, ...params };
  if (!VISUAL_QUALITY_PRESETS.includes(next.visualPreset)) next.visualPreset = 'balanced';
  if (worldMode === 'infinite' && next.visualPreset === 'cinematic') Object.assign(next, visualPatchForPreset('balanced', worldMode));
  if (worldMode === 'planet') {
    next.localFogVolumesEnabled = false;
    next.volumetricFogEnabled = false;
  }
  return next;
}
