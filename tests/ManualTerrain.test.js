import { describe, expect, it } from 'vitest';
import {
  createManualShape,
  evaluateManualShape,
  evaluateManualTerrain,
  normalizeManualTerrainDocument,
} from '../src/manual/ManualShapeCatalog.js';

describe('Manual Terrain shapes', () => {
  it('creates a normalized editable shape from a catalog entry', () => {
    const shape = createManualShape('ridge', { x: 12, z: -8 }, { id: 'ridge-1', seed: 42 });
    expect(shape).toMatchObject({
      id: 'ridge-1',
      type: 'ridge',
      position: { x: 12, z: -8 },
      seed: 42,
    });
    expect(shape.scale.x).toBeGreaterThan(shape.scale.z);
    expect(shape.height).toBeGreaterThan(0);
  });

  it('evaluates positive and negative landforms with finite support', () => {
    const mountain = createManualShape('mountain', { x: 0, z: 0 }, { id: 'mountain', seed: 7 });
    const valley = createManualShape('valley', { x: 0, z: 0 }, { id: 'valley', seed: 7 });
    expect(evaluateManualShape(mountain, 0, 0)).toBeGreaterThan(0);
    expect(evaluateManualShape(valley, 0, 0)).toBeLessThan(0);
    expect(evaluateManualShape(mountain, mountain.scale.x * 2, 0)).toBe(0);
  });

  it('composes shapes additively without baking away their source objects', () => {
    const mountain = createManualShape('mountain', { x: 0, z: 0 }, { id: 'mountain', seed: 1, detail: 0 });
    const valley = createManualShape('valley', { x: 0, z: 0 }, { id: 'valley', seed: 2, detail: 0 });
    const expected = evaluateManualShape(mountain, 0, 0) + evaluateManualShape(valley, 0, 0);
    expect(evaluateManualTerrain([mountain, valley], 0, 0)).toBeCloseTo(expected, 6);
  });

  it('normalizes saved documents and clamps unsafe values', () => {
    const document = normalizeManualTerrainDocument({
      version: 99,
      shapes: [{
        id: 'shape',
        type: 'plateau',
        position: { x: Infinity, z: -Infinity },
        scale: { x: -2, z: 999999 },
        height: 999999,
        detail: 5,
        seed: -5,
      }],
    });
    expect(document.version).toBe(1);
    expect(document.shapes).toHaveLength(1);
    expect(document.shapes[0]).toMatchObject({
      type: 'plateau',
      position: { x: 0, z: 0 },
      scale: { x: 8, z: 10000 },
      height: 3000,
      detail: 1,
      seed: 0,
    });
  });
});
