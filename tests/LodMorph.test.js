import { describe, expect, it } from 'vitest';
import { MORPH_DISABLED, planMorphBands, stepTemporalLod } from '../src/engine/terrain/LodMorph.js';

// Shader twin: morph factor of a vertex at distance d for LOD level L.
const morphAt = (bands, level, d) => {
  const s = bands.start[level];
  const e = bands.end[level];
  if (!(e > s)) return 0;
  return Math.min(1, Math.max(0, (d - s) / (e - s)));
};

describe('geomorph band planning', () => {
  const chunk = 128;
  const half = chunk * Math.SQRT1_2;
  const thresholds = [1024, 1920, 3072];
  const bands = planMorphBands(thresholds, half);

  it('keeps every band strictly inside its LOD range', () => {
    for (let level = 0; level < 3; level++) {
      expect(bands.end[level]).toBeLessThanOrEqual(thresholds[level] - half);
      if (level > 0) expect(bands.start[level]).toBeGreaterThanOrEqual(thresholds[level - 1] + half);
      expect(bands.end[level]).toBeGreaterThan(bands.start[level]);
    }
  });

  it('makes L->L+1 swaps invisible: every vertex of a switching chunk is fully morphed', () => {
    for (let level = 0; level < 3; level++) {
      const centre = thresholds[level];
      for (let offset = -half; offset <= half; offset += half / 8) {
        expect(morphAt(bands, level, centre + offset)).toBe(1);
      }
    }
  });

  it('makes L-1->L swaps invisible: a chunk that just refined has not started morphing', () => {
    for (let level = 1; level < 3; level++) {
      const centre = thresholds[level - 1];
      for (let offset = -half; offset <= half; offset += half / 8) {
        expect(morphAt(bands, level, centre + offset)).toBe(0);
      }
    }
  });

  it('disables levels whose spacing cannot hold a band', () => {
    const tight = planMorphBands([100, 150, 200], 64);
    expect(tight.start[1]).toBe(MORPH_DISABLED);
    expect(tight.end[1]).toBe(MORPH_DISABLED);
  });
});

describe('temporal geomorph stepping', () => {
  const segments = [64, 32, 16, 8];
  // Rendered shape of a chunk: the grid level it is equivalent to.
  const shape = (c) => c.lod + c.morph;

  it('snaps freshly created chunks straight to their target', () => {
    const chunk = { lod: 3, morph: 0, fresh: true };
    stepTemporalLod(chunk, 0, 0.1, segments);
    expect(chunk).toMatchObject({ lod: 0, morph: 0, fresh: false });
  });

  it('coarsens by morphing first, so the geometry swap never changes the shape', () => {
    const chunk = { lod: 0, morph: 0 };
    let previous = shape(chunk);
    for (let i = 0; i < 40 && chunk.lod < 2; i++) {
      stepTemporalLod(chunk, 2, 0.25, segments);
      expect(shape(chunk) - previous).toBeLessThanOrEqual(0.25 + 1e-9);
      previous = shape(chunk);
    }
    expect(chunk).toMatchObject({ lod: 2, morph: 0 });
  });

  it('refines by swapping at full morph, then relaxing', () => {
    const chunk = { lod: 2, morph: 0 };
    stepTemporalLod(chunk, 1, 0.25, segments);
    expect(chunk).toMatchObject({ lod: 1, morph: 1 });   // identical shape to LOD 2
    let previous = shape(chunk);
    for (let i = 0; i < 10; i++) {
      stepTemporalLod(chunk, 1, 0.25, segments);
      expect(previous - shape(chunk)).toBeLessThanOrEqual(0.25 + 1e-9);
      previous = shape(chunk);
    }
    expect(chunk).toMatchObject({ lod: 1, morph: 0 });
  });

  it('swaps instantly where the grid ladder is not 2:1', () => {
    const chunk = { lod: 0, morph: 0 };
    stepTemporalLod(chunk, 1, 0.25, [60, 32, 16, 8]);
    expect(chunk).toMatchObject({ lod: 1, morph: 0 });
  });
});
