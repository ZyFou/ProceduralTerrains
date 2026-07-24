import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createManualShape,
  evaluateManualShape,
  evaluateManualTerrain,
  normalizeManualTerrainDocument,
} from '../src/manual/ManualShapeCatalog.js';
import { ManualTerrainField } from '../src/manual/ManualTerrainField.js';

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

  it('composes ordered layers with blend modes, opacity, visibility, and masks', () => {
    const base = createManualShape('mountain', { x: 0, z: 0 }, {
      id: 'base', height: 100, detail: 0, opacity: 1,
    });
    const replacement = createManualShape('sharp-peak', { x: 0, z: 0 }, {
      id: 'replacement', height: 40, detail: 0, blendMode: 'replace',
    });
    expect(evaluateManualTerrain([base, replacement], 0, 0)).toBeCloseTo(40, 5);

    const hidden = { ...replacement, enabled: false, height: 900 };
    expect(evaluateManualTerrain([base, hidden], 0, 0)).toBeCloseTo(100, 5);

    const invertedCenter = {
      ...replacement,
      blendMode: 'add',
      mask: { type: 'radial', invert: true, feather: 0.4, strength: 1 },
    };
    expect(evaluateManualTerrain([base, invertedCenter], 0, 0)).toBeCloseTo(100, 5);
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
    expect(document.version).toBe(2);
    expect(document.shapes).toHaveLength(1);
    expect(document.shapes[0]).toMatchObject({
      type: 'plateau',
      position: { x: 0, z: 0 },
      scale: { x: 8, z: 10000 },
      height: 3000,
      detail: 1,
      enabled: true,
      opacity: 1,
      blendMode: 'add',
      sharpness: 1,
      terraces: 0,
      mask: { type: 'none', invert: false, feather: 0.32, strength: 1 },
      seed: 0,
    });
  });

  it('keeps sculpt strokes separate from procedural shapes and round-trips them', () => {
    const makeUniforms = () => ({
      uManualHeightTexture: { value: null },
      uManualOrigin: { value: new THREE.Vector2() },
      uManualSpan: { value: new THREE.Vector2() },
    });
    const bounds = () => ({ origin: { x: -128, z: -128 }, span: { x: 256, z: 256 } });
    const shape = createManualShape('mountain', { x: 0, z: 0 }, { detail: 0 });
    const field = new ManualTerrainField({ uniforms: makeUniforms(), getBounds: bounds, resolution: 32 });
    field.rebuild([shape]);
    const proceduralHeight = field.sampleHeightOffset(0, 0);

    field.stamp({
      x: 0, z: 0, radius: 36, strength: 0.8, falloff: 0.7, tool: 'raise',
    });
    expect(field.sampleHeightOffset(0, 0)).toBeGreaterThan(proceduralHeight);
    const sculpt = field.serializeSculpt();
    expect(sculpt).toMatchObject({ version: 1, resolution: 32 });

    const restored = new ManualTerrainField({ uniforms: makeUniforms(), getBounds: bounds, resolution: 32 });
    restored.loadSculpt(sculpt);
    restored.rebuild([shape]);
    expect(restored.sampleHeightOffset(0, 0)).toBeCloseTo(field.sampleHeightOffset(0, 0), 4);
    restored.clearSculpt();
    expect(restored.sampleHeightOffset(0, 0)).toBeCloseTo(proceduralHeight, 4);

    field.dispose();
    restored.dispose();
  });
});
