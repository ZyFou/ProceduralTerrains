// ============================================================================
// Visual enhancement settings. The original look controls remain Tile-only;
// camera shaders are global and serialize with projects in every world mode.
// ============================================================================

export const VISUAL_DEFAULT_PARAMS = {
  visualsPostEnabled: true,
  visualsExposure: 1.0,
  visualsContrast: 1.08,
  visualsSaturation: 1.04,
  visualsVignette: 0.18,
  visualsBloomStrength: 0.18,
  visualsBloomThreshold: 0.72,
  visualsSunRaysStrength: 0.22,

  visualsPixelatedEnabled: false,
  visualsPixelResolution: 240,
  visualsDitheringEnabled: false,
  visualsDitheringStrength: 0.65,
  visualsDitheringLevels: 8,
  visualsDitheringScale: 2,
  visualsCrtEnabled: false,
  visualsCrtStrength: 0.5,
  visualsCrtLensBend: 0.35,
  visualsCrtLineWidth: 2,
  visualsChromaticAberrationEnabled: false,
  visualsChromaticAberrationStrength: 1.5,

  visualsSkyIntensity: 1.08,
  visualsSunGlow: 1.0,
  visualsHorizonGlow: 0.35,
  visualsAtmosphereTint: [1.0, 0.98, 0.92],

  visualsTerrainColorVariation: 0.36,
  visualsTerrainHeightDetail: 0.42,
  visualsWetShoreStrength: 0.55,
  visualsRockDetail: 0.45,
  visualsSoilDetail: 0.35,
  visualsSandDetail: 0.38,

  visualsFoamBreakup: 0.45,
  visualsWetSandRange: 18,
  visualsShallowWaterSoftness: 0.38,
};

export const VISUAL_RESET_KEYS = Object.keys(VISUAL_DEFAULT_PARAMS);

export function isVisualKey(key) {
  return key.startsWith('visuals');
}
