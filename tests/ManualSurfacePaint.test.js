import { describe, expect, it } from 'vitest';
import { MANUAL_SURFACE_MATERIALS } from '../src/manual/ManualSurfaceCatalog.js';
import { ManualSurfacePaintField } from '../src/manual/ManualSurfacePaintField.js';

const bounds = () => ({ origin: { x: -128, z: -128 }, span: { x: 256, z: 256 } });

describe('Manual Terrain surface painting', () => {
  it('maps every built-in material to a unique paint channel and atlas role', () => {
    expect(MANUAL_SURFACE_MATERIALS.map((material) => material.id)).toEqual([
      'grass', 'rock', 'sand', 'snow', 'mud', 'volcanic', 'alien',
    ]);
    expect(new Set(MANUAL_SURFACE_MATERIALS.map((material) => material.channel)).size).toBe(7);
    expect(new Set(MANUAL_SURFACE_MATERIALS.map((material) => material.roleIndex)).size).toBe(7);
  });

  it('crossfades materials while keeping at most two normalized weights', () => {
    const field = new ManualSurfacePaintField({ getBounds: bounds, resolution: 32 });
    field.stamp({ x: 0, z: 0, radius: 42, strength: 1, falloff: 0.7, materialChannel: 0 });
    expect(field.sampleWeights(0, 0)[0]).toBeCloseTo(1, 2);

    field.stamp({ x: 0, z: 0, radius: 42, strength: 0.5, falloff: 0.7, materialChannel: 1 });
    const weights = field.sampleWeights(0, 0);
    expect(weights[0]).toBeGreaterThan(0.35);
    expect(weights[1]).toBeGreaterThan(0.35);
    expect(weights.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 2);
    expect(weights.filter((value) => value > 0).length).toBeLessThanOrEqual(2);
    field.dispose();
  });

  it('smooths a material boundary and erases back to the unpainted surface', () => {
    const field = new ManualSurfacePaintField({ getBounds: bounds, resolution: 48 });
    field.stamp({ x: -20, z: 0, radius: 34, strength: 1, falloff: 0.25, materialChannel: 0 });
    field.stamp({ x: 20, z: 0, radius: 34, strength: 1, falloff: 0.25, materialChannel: 1 });
    const before = field.sampleWeights(0, 0);
    field.stamp({ x: 0, z: 0, radius: 36, strength: 1, falloff: 0.8, tool: 'blend' });
    const after = field.sampleWeights(0, 0);
    expect(Math.abs(after[0] - after[1])).toBeLessThanOrEqual(Math.abs(before[0] - before[1]) + 0.01);

    field.stamp({ x: 0, z: 0, radius: 42, strength: 1, falloff: 0.7, tool: 'erase' });
    expect(field.sampleWeights(0, 0).reduce((sum, value) => sum + value, 0)).toBeCloseTo(0, 2);
    field.dispose();
  });

  it('round-trips and resamples the two packed weight maps', () => {
    const source = new ManualSurfacePaintField({ getBounds: bounds, resolution: 24 });
    source.stamp({ x: 12, z: -8, radius: 45, strength: 0.8, falloff: 0.7, materialChannel: 5 });
    const payload = source.serialize();
    expect(payload).toMatchObject({ version: 1, resolution: 24 });

    const restored = new ManualSurfacePaintField({ getBounds: bounds, resolution: 40 });
    expect(restored.load(payload)).toBe(true);
    expect(restored.sampleWeights(12, -8)[5]).toBeGreaterThan(0.65);
    restored.clear();
    expect(restored.serialize()).toBeNull();

    source.dispose();
    restored.dispose();
  });
});
