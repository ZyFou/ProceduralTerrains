// ============================================================================
// Geomorph (CDLOD-style) band planning shared by the Tile board, Infinite
// World and Planet chunk systems.
//
// Chunks pick LOD L while their centre distance d_c lies in [T_{L-1}, T_L).
// Every vertex of such a chunk is within `halfExtent` of the centre, so its own
// distance lies in [d_c - halfExtent, d_c + halfExtent]. The vertex shader
// morphs an LOD L vertex onto the LOD L+1 grid over [start_L, end_L]:
//
//   end_L   = T_L     - halfExtent  → at the L→L+1 swap every vertex is fully
//                                     on the coarser grid (identical shape)
//   start_L ≥ T_{L-1} + halfExtent  → right after the L-1→L swap no vertex has
//                                     started morphing (identical shape)
//
// so geometry swaps in either direction are invisible. Levels whose spacing is
// too tight for a band get no morph (start = end = DISABLED).
// ============================================================================

export const MORPH_DISABLED = 1e9;

/**
 * @param {number[]} thresholds  chunk switch distances [T0, T1, T2]
 * @param {number} halfExtent    max distance from a chunk centre to its vertices
 * @param {number} [bandFraction] morph band length as a share of the LOD range
 * @returns {{ start: number[], end: number[] }}
 */
export function planMorphBands(thresholds, halfExtent, bandFraction = 0.3) {
  const start = [];
  const end = [];
  const margin = Math.max(0, halfExtent) * 1.02;
  for (let level = 0; level < 3; level++) {
    const lower = level === 0 ? 0 : thresholds[level - 1];
    const upper = thresholds[level];
    const bandEnd = upper - margin;
    const earliest = level === 0 ? 0 : lower + margin;
    const bandStart = Math.max(earliest, bandEnd - bandFraction * (upper - lower));
    if (Number.isFinite(bandEnd) && bandEnd > bandStart + 1e-3) {
      start.push(bandStart);
      end.push(bandEnd);
    } else {
      start.push(MORPH_DISABLED);
      end.push(MORPH_DISABLED);
    }
  }
  return { start, end };
}

/** Write planned bands + the live per-LOD segment ladder into shared uniforms. */
export function publishMorphUniforms(uniforms, bands, segments, enabled = true) {
  if (!uniforms?.uLodMorphStart || !uniforms?.uLodMorphEnd) return;
  if (!enabled || !bands) {
    uniforms.uLodMorphStart.value.set(MORPH_DISABLED, MORPH_DISABLED, MORPH_DISABLED);
    uniforms.uLodMorphEnd.value.set(MORPH_DISABLED, MORPH_DISABLED, MORPH_DISABLED);
    return;
  }
  uniforms.uLodMorphStart.value.set(bands.start[0], bands.start[1], bands.start[2]);
  uniforms.uLodMorphEnd.value.set(bands.end[0], bands.end[1], bands.end[2]);
  if (uniforms.uLodGridSegments && segments?.length >= 4) {
    uniforms.uLodGridSegments.value.set(segments[0], segments[1], segments[2], segments[3]);
  }
}

// ---------------------------------------------------------------------------
// Temporal geomorph (Planet, Infinite World). LOD *decisions* stay exactly as
// before; each change is animated over a short duration instead of popping.
// chunk.lod is the rendered grid level and chunk.morph (0..1) how far its odd
// vertices have slid onto the next-coarser grid:
//   coarsen: morph 0 -> 1 on the finer grid, then swap (identical shape)
//   refine:  swap to the finer grid at morph 1 (identical shape), then 1 -> 0
// At rest morph is 0, so settled geometry is unchanged.

/** True when level L -> L+1 is an exact 2:1 grid ladder (morphable). */
export function morphLadder(segments, level) {
  return level >= 0 && level < 3 && segments[level] === segments[level + 1] * 2;
}

/**
 * Advance one chunk toward `target`. Returns true when its rendered state
 * (lod or morph) changed this step.
 */
export function stepTemporalLod(chunk, target, step, segments, enabled = true) {
  const lod = chunk.lod;
  const morph = chunk.morph || 0;
  if (chunk.fresh) {
    // A chunk that just appeared has no previous shape to preserve.
    chunk.fresh = false;
    chunk.lod = target;
    chunk.morph = 0;
  } else if (!enabled) {
    chunk.lod = target;
    chunk.morph = 0;
  } else if (target > lod) {
    if (!morphLadder(segments, lod)) {
      chunk.lod = target;
      chunk.morph = 0;
    } else {
      chunk.morph = Math.min(1, morph + step);
      if (chunk.morph >= 1) {
        chunk.lod = lod + 1;
        chunk.morph = 0;
      }
    }
  } else if (morph > 0) {
    // settle back onto the current grid (also undoes an aborted coarsen)
    chunk.morph = Math.max(0, morph - step);
  } else if (target < lod) {
    if (!morphLadder(segments, lod - 1)) {
      chunk.lod = target;
    } else {
      chunk.lod = lod - 1;
      chunk.morph = 1;
    }
  }
  return chunk.lod !== lod || (chunk.morph || 0) !== morph;
}
