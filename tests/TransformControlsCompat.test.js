import { describe, expect, it, vi } from 'vitest';
import { resolveTransformControlsHelper } from '../src/manual/TransformControlsCompat.js';

describe('TransformControls compatibility', () => {
  it('uses the separate helper exposed by current Three.js releases', () => {
    const helper = { name: 'transform-helper' };
    const transform = { getHelper: vi.fn(() => helper) };

    expect(resolveTransformControlsHelper(transform)).toBe(helper);
    expect(transform.getHelper).toHaveBeenCalledTimes(1);
  });

  it('adds legacy TransformControls directly to the scene', () => {
    const legacyTransform = { isObject3D: true };

    expect(resolveTransformControlsHelper(legacyTransform)).toBe(legacyTransform);
  });

  it('falls back to the controls object when a mismatched helper accessor fails', () => {
    const transform = { getHelper: vi.fn(() => { throw new Error('version mismatch'); }) };

    expect(resolveTransformControlsHelper(transform)).toBe(transform);
  });
});
