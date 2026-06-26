// ============================================================================
// PropPlacement — deterministic candidate evaluation + weighted type selection.
//
// Pure logic, no THREE: given a terrain sample (from TerrainPropSampler), the
// params, and a bag of deterministic 0..1 randoms, decide whether a candidate
// cell spawns a prop and which type. The manager owns grid iteration and the
// THREE transform; this owns the masking rules so they are easy to reason about
// and reuse across Tile / Infinite / Planet.
// ============================================================================

import { PROP_TYPES, scoreProp } from './propCatalog.js';

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

// Deterministic integer hash → 0..1 (Dave-Hoskins-ish; matches the old manager
// so existing seeds keep producing comparable layouts). Used for every random
// decision so the same seed + chunk coordinate reproduces identical props.
export function hashInt(x, y, seed = 0) {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  n = (n ^ (n >>> 13)) | 0;
  return ((Math.imul(n, 1274126177) ^ n) >>> 0) / 4294967295;
}

/**
 * Cheap per-cell fill probability (0..1) for the density pre-gate. Uses only the
 * global density + paint density, so the manager can reject most cells BEFORE
 * the expensive terrain sample.
 */
export function fillChance(params, paintDensity = 0) {
  const density = clamp(params.propsDensity, 0, 2);
  return clamp01(density * 0.62 + paintDensity * 1.15);
}

/**
 * Decide the prop type (if any) for a candidate already past the fill gate.
 * @param {object} sample  TerrainPropSampler record
 * @param {object} params  engine params (propsDensity, propsFlowers, …)
 * @param {object} rand    { pick } deterministic 0..1 value
 * @returns {object|null}  chosen descriptor from PROP_TYPES, or null
 */
export function chooseCandidate(sample, params, rand) {
  const paint = sample.mask;                 // {grass,flowers,mixed} | null

  // Per-type suitability (mask product), with param/paint modulation.
  let total = 0;
  const scored = [];
  for (const desc of PROP_TYPES) {
    let s = scoreProp(desc, sample);
    if (s <= 0) continue;
    if (desc.id === 'flower') {
      const flowerBias = clamp01(params.propsFlowers + (paint ? paint.flowers + paint.mixed * 0.5 : 0));
      s *= flowerBias;
    } else if (desc.id === 'grass') {
      const grassBias = clamp01(1 + (paint ? paint.grass + paint.mixed * 0.5 : 0));
      s *= grassBias;
    }
    if (s <= 0) continue;
    scored.push([desc, s]);
    total += s;
  }
  if (total <= 0) return null;

  // Weighted pick across the suitable types.
  let r = rand.pick * total;
  for (const [desc, s] of scored) {
    if (r < s) return desc;
    r -= s;
  }
  return scored[scored.length - 1][0];
}
