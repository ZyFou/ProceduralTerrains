import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPLODE_SETTINGS,
  explosionProcessingForResolution,
  normalizeExplodeSettings,
  resolveExplosionResolution,
} from '../src/engine/destruction/ExplodeTool.js';

describe('Explode tool settings', () => {
  it('provides a complete authoring preset', () => {
    expect(DEFAULT_EXPLODE_SETTINGS).toMatchObject({
      shape: 'bowl',
      resolution: 'auto',
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
      shape: 'unknown', resolution: '9999', radius: 999, strength: 12, rim: -1, falloff: 0, scorch: 4,
      debris: false, sound: false, cameraShake: false,
    })).toEqual({
      shape: 'bowl', resolution: 'auto', radius: 18, strength: 2, rim: 0, falloff: 0.1, scorch: 1,
      debris: false, sound: false, cameraShake: false,
    });
  });

  it('accepts every crater shape', () => {
    for (const shape of ['bowl', 'punch', 'ragged']) {
      expect(normalizeExplodeSettings({ shape }).shape).toBe(shape);
    }
  });

  it('resolves automatic and explicit field resolutions', () => {
    expect(resolveExplosionResolution('auto', 'low')).toBe(384);
    expect(resolveExplosionResolution('auto', 'high')).toBe(640);
    expect(resolveExplosionResolution('768', 'low')).toBe(768);
    expect(resolveExplosionResolution('1024', 'medium')).toBe(1024);
  });

  it('increases final crater sampling and processing with resolution', () => {
    const medium = explosionProcessingForResolution(512);
    const ultra = explosionProcessingForResolution(1024);
    expect(ultra.sampleGrid).toBeGreaterThan(medium.sampleGrid);
    expect(ultra.angularSteps).toBeGreaterThan(medium.angularSteps);
    expect(ultra.iterations).toBeGreaterThan(medium.iterations);
    expect(ultra.blend).toBeLessThan(medium.blend);
  });
});
