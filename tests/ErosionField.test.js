import { describe, expect, it } from 'vitest';
import { ErosionField } from '../src/engine/terrain/erosion/ErosionField.js';

describe('erosion field persistence', () => {
  it('round-trips JSON-safe base64 grids without changing resolution', () => {
    const source = new ErosionField();
    source.setRegion(-10, -20, 40, 60);
    source.setDelta(new Float32Array([0.5, -1.25, 2, 0]), 2);
    source.setMasks({
      flow: new Float32Array([0, 0.25, 0.5, 1]),
      erosionMask: new Float32Array([1, 0.5, 0.25, 0]),
    }, 2);
    source.setEnabled(true);

    const encoded = source.serialize({ jsonSafe: true });
    const parsed = JSON.parse(JSON.stringify(encoded));
    const restored = new ErosionField();
    restored.restore(parsed);

    expect(parsed).toMatchObject({ version: 1, encoding: 'base64-f32', res: 2 });
    expect(typeof parsed.delta).toBe('string');
    expect([...restored.delta]).toEqual([0.5, -1.25, 2, 0]);
    expect([...restored.masks.flow]).toEqual([0, 0.25, 0.5, 1]);
    expect(restored.enabled).toBe(true);
    expect(restored.originX).toBe(-10);
    expect(restored.sizeZ).toBe(60);

    source.dispose();
    restored.dispose();
  });
});
