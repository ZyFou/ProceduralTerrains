import { describe, expect, it } from 'vitest';
import { nearestSegment, resampleSpline } from '../src/creator/splines/SplinePath.js';
import { migrateSplines } from '../src/creator/splines/SplineSerializer.js';

describe('creator spline paths', () => {
  const points = [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, { x: 200, y: 0, z: 0 }];
  it('resamples a path at approximately even world distances', () => {
    const samples = resampleSpline(points, { spacing: 20 });
    expect(samples.length).toBeGreaterThan(8);
    for (let i = 2; i < samples.length - 1; i++) {
      expect(samples[i].distance - samples[i - 1].distance).toBeCloseTo(20, 0);
    }
  });
  it('finds the nearest route segment', () => {
    const hit = nearestSegment(points, 80, 12);
    expect(hit.index).toBe(0); expect(hit.distance).toBeCloseTo(12);
  });
  it('migrates legacy or partial spline payloads safely', () => {
    const [river] = migrateSplines([{ type: 'river', controlPoints: [{ x: 1, z: 2 }, { x: 3, z: 4 }] }]);
    expect(river.id).toBeTruthy(); expect(river.depth).toBeGreaterThan(0); expect(river.interpolation).toBe('catmull-rom');
  });
});
