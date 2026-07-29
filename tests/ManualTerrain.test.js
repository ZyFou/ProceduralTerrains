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
    expect(document.version).toBe(3);
    expect(document.surfacePaint).toBeNull();
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

  it('keeps shapes and sculpt strokes anchored when tile bounds expand', () => {
    const uniforms = {
      uManualHeightTexture: { value: null },
      uManualOrigin: { value: new THREE.Vector2() },
      uManualSpan: { value: new THREE.Vector2() },
    };
    let currentBounds = { origin: { x: -128, z: -128 }, span: { x: 256, z: 256 } };
    const field = new ManualTerrainField({
      uniforms,
      getBounds: () => currentBounds,
      resolution: 96,
    });
    const shape = createManualShape('mountain', { x: -24, z: 18 }, {
      detail: 0,
      height: 180,
      scale: { x: 70, z: 70 },
    });
    field.rebuild([shape]);
    field.stamp({
      x: -24, z: 18, radius: 34, strength: 0.8, falloff: 0.7, tool: 'raise',
    });
    const before = field.sampleHeightOffset(-24, 18);

    currentBounds = { origin: { x: -128, z: -128 }, span: { x: 512, z: 256 } };
    expect(field.syncBounds([shape])).toBe(true);
    expect(uniforms.uManualOrigin.value.toArray()).toEqual([-128, -128]);
    expect(uniforms.uManualSpan.value.toArray()).toEqual([512, 256]);
    expect(field.sampleHeightOffset(-24, 18)).toBeCloseTo(before, -0.5);
    expect(field.sampleHeightOffset(300, 18)).toBeCloseTo(0, 5);
    field.dispose();
  });

  it('keeps a round sculpt footprint on rectangular multi-tile bounds', () => {
    const uniforms = {
      uManualHeightTexture: { value: null },
      uManualOrigin: { value: new THREE.Vector2() },
      uManualSpan: { value: new THREE.Vector2() },
    };
    const field = new ManualTerrainField({
      uniforms,
      getBounds: () => ({ origin: { x: -256, z: -128 }, span: { x: 512, z: 256 } }),
      resolution: 128,
    });
    field.rebuild([]);
    field.stamp({ x: 0, z: 0, radius: 40, strength: 1, falloff: 0.7, tool: 'raise' });
    expect(field.sampleHeightOffset(0, 28)).toBeGreaterThan(0);
    expect(field.sampleHeightOffset(0, 48)).toBeCloseTo(0, 5);
    field.dispose();
  });

  it('paints narrow crease and ridge relief profiles', () => {
    const makeUniforms = () => ({
      uManualHeightTexture: { value: null },
      uManualOrigin: { value: new THREE.Vector2() },
      uManualSpan: { value: new THREE.Vector2() },
    });
    const bounds = () => ({ origin: { x: -128, z: -128 }, span: { x: 256, z: 256 } });
    const crease = new ManualTerrainField({ uniforms: makeUniforms(), getBounds: bounds, resolution: 64 });
    crease.rebuild([]);
    crease.stamp({
      x: 0,
      z: 0,
      radius: 48,
      strength: 1,
      falloff: 0.7,
      tool: 'crease',
      creaseWidth: 0.2,
    });
    expect(crease.sampleHeightOffset(0, 0)).toBeLessThan(-15);

    const ridge = new ManualTerrainField({ uniforms: makeUniforms(), getBounds: bounds, resolution: 64 });
    ridge.rebuild([]);
    ridge.stamp({
      x: 0,
      z: 0,
      radius: 48,
      strength: 1,
      falloff: 0.7,
      tool: 'ridge',
      creaseWidth: 0.2,
    });
    expect(ridge.sampleHeightOffset(0, 0)).toBeGreaterThan(15);
    expect(ridge.sampleHeightOffset(0, 0)).toBeCloseTo(-crease.sampleHeightOffset(0, 0), 5);

    crease.dispose();
    ridge.dispose();
  });

  it('paints deterministic multi-scale relief detail', () => {
    const makeUniforms = () => ({
      uManualHeightTexture: { value: null },
      uManualOrigin: { value: new THREE.Vector2() },
      uManualSpan: { value: new THREE.Vector2() },
    });
    const bounds = () => ({ origin: { x: -128, z: -128 }, span: { x: 256, z: 256 } });
    const makeDetailedField = (seed) => {
      const field = new ManualTerrainField({ uniforms: makeUniforms(), getBounds: bounds, resolution: 64 });
      field.rebuild([]);
      field.stamp({
        x: 17,
        z: -11,
        radius: 52,
        strength: 0.8,
        falloff: 0.72,
        tool: 'detail',
        detailScale: 24,
        detailRoughness: 0.65,
        detailSeed: seed,
      });
      return field;
    };
    const first = makeDetailedField(44);
    const matching = makeDetailedField(44);
    const different = makeDetailedField(45);
    const firstSample = first.sampleHeightOffset(17, -11);
    expect(firstSample).toBeCloseTo(matching.sampleHeightOffset(17, -11), 6);
    expect(firstSample).not.toBeCloseTo(different.sampleHeightOffset(17, -11), 2);

    first.dispose();
    matching.dispose();
    different.dispose();
  });

  it('transports material downhill with the erosion brush and paints terraces', () => {
    const makeUniforms = () => ({
      uManualHeightTexture: { value: null },
      uManualOrigin: { value: new THREE.Vector2() },
      uManualSpan: { value: new THREE.Vector2() },
    });
    const bounds = () => ({ origin: { x: -128, z: -128 }, span: { x: 256, z: 256 } });
    const mountain = createManualShape('sharp-peak', { x: 0, z: 0 }, {
      detail: 0,
      height: 220,
      scale: { x: 74, z: 74 },
    });
    const field = new ManualTerrainField({ uniforms: makeUniforms(), getBounds: bounds, resolution: 64 });
    field.rebuild([mountain]);
    const summitBefore = field.sampleHeightOffset(0, 0);
    field.stamp({
      x: 0,
      z: 0,
      radius: 62,
      strength: 0.9,
      falloff: 0.75,
      tool: 'erode',
      erosionIterations: 5,
      erosionDeposition: 0.75,
      erosionTalus: 0,
    });
    expect(field.sampleHeightOffset(0, 0)).toBeLessThan(summitBefore);

    const terracePoint = { x: 31, z: 0 };
    field.stamp({
      ...terracePoint,
      radius: 28,
      strength: 1,
      falloff: 0.7,
      tool: 'terrace',
      terraceStep: 25,
    });
    const terracedHeight = field.sampleHeightOffset(terracePoint.x, terracePoint.z);
    expect(Math.abs(terracedHeight / 25 - Math.round(terracedHeight / 25))).toBeLessThan(0.08);

    field.dispose();
  });
});
