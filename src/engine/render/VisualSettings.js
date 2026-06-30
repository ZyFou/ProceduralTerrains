// ============================================================================
// Tile-mode visual enhancement settings.
// These are artistic controls, not performance budgets. They live in params so
// saved projects keep their look and older saves inherit these defaults.
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
