import { describe, expect, it } from 'vitest';
import { ManualPropPaintField } from '../src/manual/ManualPropPaintField.js';
import { densityForType } from '../src/engine/props/PropPlacement.js';
import { getPropType } from '../src/engine/props/propCatalog.js';

const bounds = () => ({ origin: { x: -128, z: -128 }, span: { x: 256, z: 256 } });
const params = {
  propsDensity: 0.65,
  propsGrassDensity: 0,
  propsFlowers: 0,
  propsRocks: 0,
  propsTreeDensity: 0,
};
const sample = (mask) => ({
  height: 80,
  slope: 0.08,
  moisture: 0,
  temperature: 0.98,
  water: false,
  shoreDistance: 80,
  excludeProps: 0,
  biomeWeights: { desert: 1, canyon: 0, wetland: 0, mountains: 0 },
  mask,
});

describe('Manual Terrain prop painting', () => {
  it('stores grass, flower, rock, and tree density as independent overlapping channels', () => {
    const field = new ManualPropPaintField({ getBounds: bounds, resolution: 32 });
    for (const propType of ['grass', 'flowers', 'rocks', 'trees']) {
      field.stamp({ x: 0, z: 0, radius: 48, strength: 1, falloff: 0.7, propType });
    }

    const mask = field.sampleMask(0, 0);
    expect(mask.grass).toBeCloseTo(1, 2);
    expect(mask.flowers).toBeCloseTo(1, 2);
    expect(mask.rocks).toBeCloseTo(1, 2);
    expect(mask.trees).toBeCloseTo(1, 2);
    expect(field.densityForTypeAt('broadleaf', 0, 0)).toBeCloseTo(1, 2);
    expect(field.densityForTypeAt('conifer', 0, 0)).toBeCloseTo(1, 2);
  });

  it('erases all prop layers under the brush and reports local dirty bounds', () => {
    const field = new ManualPropPaintField({ getBounds: bounds, resolution: 32 });
    field.consumePropDirtyBounds();
    field.stamp({ x: 12, z: -8, radius: 30, strength: 1, falloff: 0.7, propType: 'trees' });
    expect(field.consumePropDirtyBounds()).toEqual({ minX: -18, maxX: 42, minZ: -38, maxZ: 22 });
    field.stamp({ x: 12, z: -8, radius: 30, strength: 1, falloff: 0.7, tool: 'erase' });
    expect(field.sampleMask(12, -8).trees).toBe(0);
  });

  it('round-trips serialized masks and preserves world placement across bounds changes', () => {
    let activeBounds = bounds();
    const field = new ManualPropPaintField({ getBounds: () => activeBounds, resolution: 32 });
    field.stamp({ x: 32, z: -24, radius: 28, strength: 1, falloff: 0.7, propType: 'rocks' });
    const saved = field.serialize();

    const restored = new ManualPropPaintField({ getBounds: () => activeBounds, resolution: 48 });
    expect(restored.load(saved)).toBe(true);
    expect(restored.sampleMask(32, -24).rocks).toBeGreaterThan(0.8);

    activeBounds = { origin: { x: -256, z: -256 }, span: { x: 512, z: 512 } };
    expect(restored.syncBounds()).toBe(true);
    expect(restored.sampleMask(32, -24).rocks).toBeGreaterThan(0.65);
  });

  it('lets explicit manual rock and tree paint cross biome rules while retaining physical masks', () => {
    const mask = { grass: 0, flowers: 0, mixed: 0, rocks: 1, trees: 1 };
    expect(densityForType(getPropType('rock'), params, sample(mask))).toBeGreaterThan(0.2);
    expect(densityForType(getPropType('broadleaf'), params, sample(mask))).toBeGreaterThan(0.2);
    expect(densityForType(getPropType('conifer'), params, sample(mask))).toBeGreaterThan(0.2);
    expect(densityForType(getPropType('rock'), params, sample(mask))).toBeGreaterThan(
      densityForType(getPropType('rock'), params, sample({ ...mask, rocks: 0 })),
    );
    expect(densityForType(getPropType('broadleaf'), params, { ...sample(mask), water: true })).toBe(0);
  });
});
