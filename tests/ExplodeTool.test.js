import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPLODE_SETTINGS, normalizeExplodeSettings } from '../src/engine/destruction/ExplodeTool.js';

describe('Explode tool settings', () => {
  it('provides a complete authoring preset', () => {
    expect(DEFAULT_EXPLODE_SETTINGS).toMatchObject({
      shape: 'bowl',
      radius: expect.any(Number),
      strength: expect.any(Number),
      rim: expect.any(Number),
      falloff: expect.any(Number),
      scorch: expect.any(Number),
      debris: true,
      sound: true,
      cameraShake: true,
    });
    expect(normalizeExplodeSettings()).toEqual(DEFAULT_EXPLODE_SETTINGS);
  });

  it('normalizes malformed and out-of-range settings', () => {
    expect(normalizeExplodeSettings({
      shape: 'unknown', radius: 999, strength: 12, rim: -1, falloff: 0, scorch: 4,
      debris: false, sound: false, cameraShake: false,
    })).toEqual({
      shape: 'bowl', radius: 18, strength: 2, rim: 0, falloff: 0.1, scorch: 1,
      debris: false, sound: false, cameraShake: false,
    });
  });

  it('accepts every crater shape', () => {
    for (const shape of ['bowl', 'punch', 'ragged']) {
      expect(normalizeExplodeSettings({ shape }).shape).toBe(shape);
    }
  });
});
