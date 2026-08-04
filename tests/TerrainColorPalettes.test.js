import { describe, expect, it } from 'vitest';
import { PALETTE_KEYS, colorToHex } from '../src/engine/style/ColorPalette.js';
import {
  COLOR_PALETTE_PRESETS,
  TERRAIN_COLOR_PALETTE_OPTIONS,
  TERRAIN_COLOR_PALETTE_PRESETS,
} from '../src/engine/style/ColorPalettePresets.js';
import { PlanetStyleManager } from '../src/engine/style/PlanetStyleManager.js';
import { TERRAIN_GRADIENT_PRESETS } from '../src/engine/terrain/graph/TerrainGradientPresets.js';

describe('procedural terrain color palettes', () => {
  it('exposes every Node Terrain palette in the same order', () => {
    expect(TERRAIN_COLOR_PALETTE_OPTIONS.map(({ nodePreset }) => nodePreset))
      .toEqual(Object.keys(TERRAIN_GRADIENT_PRESETS));
  });

  it('adapts every four-stop Node palette into a complete biome palette', () => {
    for (const [key, preset] of Object.entries(TERRAIN_COLOR_PALETTE_PRESETS)) {
      expect(COLOR_PALETTE_PRESETS[key]).toBe(preset);
      expect(Object.keys(preset.palette).sort()).toEqual([...PALETTE_KEYS].sort());

      for (const colorKey of PALETTE_KEYS) {
        expect(preset.palette[colorKey]).toHaveLength(3);
        expect(preset.palette[colorKey].every((channel) => channel >= 0 && channel <= 1)).toBe(true);
      }

      const nodeColors = TERRAIN_GRADIENT_PRESETS[preset.nodePreset].colors;
      expect([
        colorToHex(preset.palette.forest),
        colorToHex(preset.palette.grass),
        colorToHex(preset.palette.rock),
        colorToHex(preset.palette.snow),
      ]).toEqual(nodeColors);
    }
  });

  it('can be applied by the existing procedural palette manager', () => {
    const manager = new PlanetStyleManager();
    const style = manager.applyPalettePreset('terrain-river');

    expect(style.palettePreset).toBe('terrain-river');
    expect(style.customEdits).toBe(false);
    expect(style.palette).toEqual(TERRAIN_COLOR_PALETTE_PRESETS['terrain-river'].palette);
  });
});
