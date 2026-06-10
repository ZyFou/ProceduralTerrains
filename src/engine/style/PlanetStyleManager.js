import { clonePalette, PALETTE_KEYS } from './ColorPalette.js';
import { getPalettePreset } from './ColorPalettePresets.js';
import { generatePaletteFromTerrainSeed } from './ColorPaletteGenerator.js';
import { getNoisePreset } from './NoisePresets.js';
import { getPlanetPreset, PLANET_PRESET_KEYS } from './PlanetPresets.js';
import { clonePlanetStyle, DEFAULT_PLANET_STYLE } from './PlanetStyleConfig.js';
import { applyPlanetStyleToUniforms } from './PaletteUniforms.js';

// ============================================================================
// Central manager for planet style — palette, presets, import/export.
// ============================================================================

const NOISE_KEYS = [
  'heightScale', 'seaLevel', 'noiseScale', 'noiseStrength', 'octaves',
  'persistence', 'lacunarity', 'ridge', 'warp', 'falloff',
  'moistScale', 'moistBias', 'biomeScale', 'tempBias', 'snowLine',
];

export class PlanetStyleManager {
  constructor() {
    this.style = clonePlanetStyle();
  }

  getStyle() {
    return clonePlanetStyle(this.style);
  }

  setStyle(partial) {
    if (partial.palette) {
      this.style.palette = clonePalette(partial.palette);
      this.style.customEdits = true;
    }
    for (const key of [
      'planetPreset', 'palettePreset', 'noisePreset',
      'paletteSaturation', 'paletteContrast', 'paletteTint',
      'sunColor', 'skyAmbient', 'groundBounce', 'fogTint', 'skyTint', 'customEdits',
    ]) {
      if (key in partial) {
        const v = partial[key];
        if (Array.isArray(v)) this.style[key] = [...v];
        else this.style[key] = v;
      }
    }
    return this.getStyle();
  }

  setPaletteColor(key, rgb) {
    if (!PALETTE_KEYS.includes(key)) return this.getStyle();
    this.style.palette[key] = [...rgb];
    this.style.customEdits = true;
    this.style.palettePreset = 'custom';
    return this.getStyle();
  }

  applyPalettePreset(key) {
    const preset = getPalettePreset(key);
    this.style.palettePreset = key;
    this.style.palette = clonePalette(preset.palette);
    this.style.customEdits = false;
    return this.getStyle();
  }

  applyNoisePreset(key) {
    this.style.noisePreset = key;
    return { noisePreset: key, params: { ...getNoisePreset(key).params } };
  }

  /**
   * Apply a full planet preset — palette, noise patch, terrain params, lighting.
   * Returns { style, params } for the engine to merge.
   */
  applyPlanetPreset(key) {
    const preset = getPlanetPreset(key);
    const pal = getPalettePreset(preset.palettePreset);

    this.style.planetPreset = key;
    this.style.palettePreset = preset.palettePreset;
    this.style.noisePreset = preset.noisePreset;
    this.style.palette = clonePalette(pal.palette);
    this.style.customEdits = false;

    const baseStyle = { ...DEFAULT_PLANET_STYLE, ...preset.style };
    for (const k of ['paletteSaturation', 'paletteContrast', 'paletteTint', 'sunColor', 'skyAmbient', 'groundBounce', 'fogTint', 'skyTint']) {
      if (baseStyle[k] !== undefined) {
        this.style[k] = Array.isArray(baseStyle[k]) ? [...baseStyle[k]] : baseStyle[k];
      }
    }

    const noisePatch = getNoisePreset(preset.noisePreset).params;
    const params = {};
    for (const k of NOISE_KEYS) {
      if (k in preset.params) params[k] = preset.params[k];
      else if (k in noisePatch) params[k] = noisePatch[k];
    }
    // Also copy any extra terrain keys from planet preset
    for (const [k, v] of Object.entries(preset.params)) {
      if (!(k in params)) params[k] = v;
    }

    return { style: this.getStyle(), params };
  }

  generatePalette(terrainSeed) {
    const { palette } = generatePaletteFromTerrainSeed(terrainSeed ?? Date.now());
    this.style.palette = clonePalette(palette);
    this.style.palettePreset = 'custom';
    this.style.planetPreset = 'custom';
    this.style.customEdits = true;
    return this.getStyle();
  }

  randomizePlanetPreset() {
    const idx = Math.floor(Math.random() * PLANET_PRESET_KEYS.length);
    return this.applyPlanetPreset(PLANET_PRESET_KEYS[idx]);
  }

  applyToUniforms(uniforms) {
    applyPlanetStyleToUniforms(uniforms, this.style);
  }

  /** Suggested fog color RGB 0-1 for studio mode. */
  getFogTint() {
    return this.style.fogTint;
  }

  exportJSON() {
    return {
      version: 1,
      planetStyle: this.getStyle(),
    };
  }

  importJSON(data) {
    const src = data?.planetStyle ?? data;
    if (!src || !src.palette) return false;
    this.style = clonePlanetStyle({ ...DEFAULT_PLANET_STYLE, ...src });
    this.style.palette = clonePalette(src.palette);
    return true;
  }

  reset() {
    this.style = clonePlanetStyle();
    return this.getStyle();
  }
}
