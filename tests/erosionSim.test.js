// ============================================================================
// Characterization tests for the CPU erosion simulation. These pin the
// contract the WebGPU backend must honor (same output shape, same semantics)
// and guard the CPU path against regressions while backends evolve.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { erode, DEFAULT_SIM_PARAMS } from '../src/engine/terrain/erosion/erosionSim.js';

const SIZE = 33;

/**
 * Deterministic bumpy test terrain — a couple of smooth hills.
 * Kept non-negative: the sim's don't-punch-holes clamp treats height 0 as
 * bedrock, so negative base heights make erosionMask go negative (known quirk).
 */
function testHeightmap(size = SIZE) {
  const map = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1), v = y / (size - 1);
      map[y * size + x] = 3 +
        8 * Math.exp(-(((u - 0.3) ** 2 + (v - 0.4) ** 2) / 0.03)) +
        5 * Math.exp(-(((u - 0.7) ** 2 + (v - 0.7) ** 2) / 0.05)) +
        2 * Math.sin(u * 7) * Math.cos(v * 5);
    }
  }
  return map;
}

const FAST_PARAMS = {
  ...DEFAULT_SIM_PARAMS,
  droplets: 600,
  erosionRadius: 2,
  thermalIterations: 5,
  seed: 42,
};

function run(params = {}) {
  return erode({
    width: SIZE, height: SIZE,
    heightmap: testHeightmap(),
    params: { ...FAST_PARAMS, ...params },
  });
}

describe('erode (CPU reference)', () => {
  it('is deterministic for the same seed', () => {
    const a = run();
    const b = run();
    expect(a.eroded).toEqual(b.eroded);
    expect(a.flow).toEqual(b.flow);
    expect(a.erosionMask).toEqual(b.erosionMask);
  });

  it('different seeds produce different results', () => {
    const a = run({ seed: 1 });
    const b = run({ seed: 2 });
    expect(a.eroded).not.toEqual(b.eroded);
  });

  it('never mutates the base heightmap', () => {
    const base = testHeightmap();
    const snapshot = Float32Array.from(base);
    erode({ width: SIZE, height: SIZE, heightmap: base, params: FAST_PARAMS });
    expect(base).toEqual(snapshot);
  });

  it('returns all six grids at N = width*height', () => {
    const out = run();
    const N = SIZE * SIZE;
    for (const key of ['eroded', 'flow', 'erosionMask', 'depositionMask', 'sedimentMap', 'slopeMap']) {
      expect(out[key]).toBeInstanceOf(Float32Array);
      expect(out[key]).toHaveLength(N);
    }
  });

  it('actually erodes: the surface changes and masks light up', () => {
    const out = run();
    const base = testHeightmap();
    let maxDelta = 0;
    for (let i = 0; i < base.length; i++) {
      maxDelta = Math.max(maxDelta, Math.abs(out.eroded[i] - base[i]));
    }
    expect(maxDelta).toBeGreaterThan(0.01);
    expect(Math.max(...out.erosionMask)).toBeCloseTo(1, 5);
    expect(Math.max(...out.flow)).toBeCloseTo(1, 5);
  });

  it('normalizes every mask into [0, 1]', () => {
    const out = run();
    for (const key of ['flow', 'erosionMask', 'depositionMask', 'sedimentMap', 'slopeMap']) {
      for (const v of out[key]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1 + 1e-6);
      }
    }
  });

  it('strength=0 returns the base surface unchanged', () => {
    const out = run({ strength: 0 });
    expect(out.eroded).toEqual(testHeightmap());
  });

  it('strength scales the delta linearly (master blend)', () => {
    const full = run({ strength: 1 });
    const half = run({ strength: 0.5 });
    const base = testHeightmap();
    for (let i = 0; i < base.length; i += 37) {
      expect(half.eroded[i] - base[i]).toBeCloseTo((full.eroded[i] - base[i]) * 0.5, 4);
    }
  });

  it('droplets=0 with thermal disabled is (near-)identity', () => {
    const out = run({ droplets: 0, thermalIterations: 0, smoothing: 0 });
    expect(out.eroded).toEqual(testHeightmap());
  });
});
