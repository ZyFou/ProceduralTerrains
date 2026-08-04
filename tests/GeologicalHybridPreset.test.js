import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/engine/presets.js';
import {
  buildNoiseStackPreset,
  buildNoiseStackPresetRecipe,
  NOISE_STACK_PRESETS,
} from '../src/engine/terrain/noise/noisePresets.js';
import { generateStackGLSL, evalStack2D } from '../src/engine/terrain/noise/noiseStackCodegen.js';

const TEST_UNIFORMS = {
  uFrequency: { value: 1 / 42 },
  uSeedOffset: { value: { x: 17.25, y: -8.5 } },
  uAmplitude: { value: 1 },
  uHeightScale: { value: 620 },
  uPersistence: { value: 0.51 },
  uLacunarity: { value: 2.03 },
};

describe('Geological Hybrid noise stack preset', () => {
  it('is exposed as a complete editable six-layer recipe', () => {
    expect(NOISE_STACK_PRESETS.geologicalHybrid.label).toBe('Geological Hybrid');
    const stack = buildNoiseStackPreset('geologicalHybrid');
    expect(stack.layers.map((layer) => layer.type)).toEqual([
      'domainWarp', 'fbm', 'terrace', 'fbm', 'ridged', 'fbm',
    ]);
    expect(stack.layers.map((layer) => layer.name)).toEqual([
      'Geological Warp',
      'Terraced Massif',
      'Weathered Terraces',
      'Derivative Weathering',
      'Rock Ridges',
      'Fine Geological Detail',
    ]);
    expect(stack.normalizeOutput).toBe(true);
    expect(stack.outputMin).toBeLessThan(stack.outputMax);
  });

  it('ships only valid global terrain keys in its companion patch', () => {
    const recipe = buildNoiseStackPresetRecipe('geologicalHybrid');
    expect(recipe.terrainParams).toMatchObject({
      heightScale: 620,
      noiseScale: 42,
      terrainSmoothing: 0,
      aoRidge: 0.28,
    });
    for (const key of Object.keys(recipe.terrainParams)) {
      expect(DEFAULT_PARAMS).toHaveProperty(key);
    }
  });

  it('generates finite 2D/3D GLSL and finite CPU terrain samples', () => {
    const stack = buildNoiseStackPreset('geologicalHybrid');
    const generated = generateStackGLSL(stack);
    expect(generated.body2d).toContain('for (int i = 0; i < 6; i++)');
    expect(generated.body2d).toContain('float terr =');
    expect(generated.body3d).toContain('float terr =');

    const samples = [];
    for (let z = -256; z <= 256; z += 64) {
      for (let x = -256; x <= 256; x += 64) {
        samples.push(evalStack2D(stack, x, z, { uniforms: TEST_UNIFORMS }));
      }
    }
    expect(samples.every(Number.isFinite)).toBe(true);
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.08);
  });

  it('returns null for an unknown recipe without mutating preset state', () => {
    expect(buildNoiseStackPresetRecipe('does-not-exist')).toBeNull();
  });
});
