import { clonePalette } from './ColorPalette.js';

// ============================================================================
// Planet style configuration — color layer separate from terrain shape.
// ============================================================================

export const DEFAULT_PLANET_STYLE = {
  planetPreset: 'earth',
  palettePreset: 'earth',
  noisePreset: 'default',
  palette: clonePalette(),
  paletteSaturation: 1.0,
  paletteContrast: 1.0,
  paletteTint: [1.0, 1.0, 1.0],
  sunColor: [1.0, 0.94, 0.82],
  sunIntensity: 1.25,
  skyAmbient: [0.36, 0.46, 0.62],
  groundBounce: [0.20, 0.16, 0.11],
  fogTint: null,       // null = use engine default
  skyTint: null,
  customEdits: false,
};

export function clonePlanetStyle(src = DEFAULT_PLANET_STYLE) {
  return {
    ...src,
    palette: clonePalette(src.palette),
    paletteTint: [...src.paletteTint],
    sunColor: [...src.sunColor],
    skyAmbient: [...src.skyAmbient],
    groundBounce: [...src.groundBounce],
    fogTint: src.fogTint ? [...src.fogTint] : null,
    skyTint: src.skyTint ? [...src.skyTint] : null,
  };
}

/** Keys owned by planet style (never trigger geometry rebuild). */
export const STYLE_ONLY_KEYS = new Set([
  'planetPreset', 'palettePreset', 'noisePreset', 'palette',
  'paletteSaturation', 'paletteContrast', 'paletteTint',
  'sunColor', 'sunIntensity', 'skyAmbient', 'groundBounce', 'fogTint', 'skyTint', 'customEdits',
]);
