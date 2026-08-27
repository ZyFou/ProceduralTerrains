import { describe, expect, it } from 'vitest';
import { DestructionField } from '../src/engine/destruction/DestructionField.js';

function field() {
  const value = new DestructionField({ resolution: 64 });
  value.setRegion({ x: -50, z: -50 }, { x: 100, z: 100 }, { reproject: false });
  return value;
}

describe('DestructionField', () => {
  it('creates a deep bowl, a raised rim, scorch, and cumulative overlap', () => {
    const value = field();
    value.stampCrater({ x: 0, z: 0, radius: 20, depth: 12, rimHeight: 3, scorch: 0.8, seed: 7 });
    const firstCenter = value.offsetAt(0, 0);
    expect(firstCenter).toBeLessThan(-10);
    expect(value.offsetAt(17, 0)).toBeGreaterThan(0);
    expect(value.scorch.some((sample) => sample > 0)).toBe(true);

    value.stampCrater({ x: 0, z: 0, radius: 20, depth: 12, rimHeight: 3, scorch: 0.8, seed: 8 });
    expect(value.offsetAt(0, 0)).toBeLessThan(firstCenter * 1.8);
    value.dispose();
  });

  it('supports distinct authored crater profiles', () => {
    const sample = (shape) => {
      const value = field();
      value.stampCrater({ x: 0, z: 0, radius: 24, depth: 12, rimHeight: 3, shape, falloff: 0.7, seed: 18 });
      const result = { center: value.offsetAt(0, 0), shoulder: value.offsetAt(12, 0) };
      value.dispose();
      return result;
    };
    const bowl = sample('bowl');
    const punch = sample('punch');
    const ragged = sample('ragged');

    expect(bowl.center).toBeLessThan(0);
    expect(punch.center).toBeLessThan(0);
    expect(ragged.center).toBeLessThan(0);
    expect(Math.abs(punch.shoulder - bowl.shoulder)).toBeGreaterThan(0.05);
  });

  it('restores a captured dirty patch for undo and redo', () => {
    const value = field();
    const before = value.stampCrater({ x: 8, z: -4, radius: 16, depth: 10, rimHeight: 2, seed: 3 });
    const after = value.capturePatch(before.minX, before.minX + before.width - 1, before.minY, before.minY + before.height - 1);
    const damaged = value.offsetAt(8, -4);
    value.restorePatch(before);
    expect(value.offsetAt(8, -4)).toBeCloseTo(0, 5);
    value.restorePatch(after);
    expect(value.offsetAt(8, -4)).toBeCloseTo(damaged, 4);
    value.dispose();
  });

  it('round-trips compressed project data and rejects malformed payloads', () => {
    const source = field();
    source.stampCrater({ x: -10, z: 12, radius: 18, depth: 9, rimHeight: 2, seed: 99 });
    const document = source.serialize({ jsonSafe: true });
    const restored = field();
    expect(restored.restore(document)).toBe(true);
    expect(restored.offsetAt(-10, 12)).toBeCloseTo(source.offsetAt(-10, 12), 4);
    expect(restored.serialize({ jsonSafe: true })).toMatchObject({ version: 1, encoding: 'deflate-base64', resolution: 64 });

    expect(restored.restore({ ...document, resolution: 9999 })).toBe(false);
    expect(restored.hasDamage()).toBe(false);
    source.dispose();
    restored.dispose();
  });

  it('reprojects existing damage in world coordinates when bounds change', () => {
    const value = field();
    value.stampCrater({ x: 20, z: 10, radius: 12, depth: 8, rimHeight: 1, seed: 2 });
    const before = value.offsetAt(20, 10);
    value.setRegion({ x: -100, z: -100 }, { x: 200, z: 200 });
    expect(value.offsetAt(20, 10)).toBeLessThan(before * 0.65);
    expect(value.offsetAt(20, 10)).toBeGreaterThan(before * 1.05);
    expect(value.offsetAt(-70, -70)).toBeCloseTo(0, 4);
    value.dispose();
  });
});
