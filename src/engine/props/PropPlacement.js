import {
  PROP_TYPES, heightScore, scoreProp, slopeScore, waterScore,
} from './propCatalog.js';

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

export function hashInt(x, y, seed = 0) {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  n = (n ^ (n >>> 13)) | 0;
  return ((Math.imul(n, 1274126177) ^ n) >>> 0) / 4294967295;
}

export function fillChance(params, paintDensity = 0) {
  return clamp01(clamp(params.propsDensity, 0, 2) * 0.62 + paintDensity * 1.15);
}

// Stable low-frequency patches without evaluating an additional noise stack.
export function macroDensity(x, z, seed, salt = 0) {
  const cell = 96;
  const gx = Math.floor(x / cell);
  const gz = Math.floor(z / cell);
  const tx = x / cell - gx;
  const tz = z / cell - gz;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = hashInt(gx + salt, gz - salt, seed);
  const b = hashInt(gx + 1 + salt, gz - salt, seed);
  const c = hashInt(gx + salt, gz + 1 - salt, seed);
  const d = hashInt(gx + 1 + salt, gz + 1 - salt, seed);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return top + (bottom - top) * sz;
}

export function densityForType(desc, params, sample) {
  const master = clamp(params.propsDensity ?? 0.65, 0, 2);
  let typeDensity = clamp(params[desc.densityParam] ?? 1, 0, 2);
  const paint = sample.mask;
  let paintedDensity = 0;
  if (desc.id === 'grass' && paint) paintedDensity = (paint.grass || 0) + (paint.mixed || 0) * 0.55;
  if (desc.id === 'flower' && paint) paintedDensity = (paint.flowers || 0) + (paint.mixed || 0) * 0.45;
  if (desc.id === 'rock' && paint) paintedDensity = paint.rocks || 0;
  if ((desc.id === 'broadleaf' || desc.id === 'conifer') && paint) paintedDensity = paint.trees || 0;
  typeDensity += paintedDensity;
  const ecological = master * typeDensity * scoreProp(desc, sample);
  // Explicit painting may cross biome boundaries, but it still respects the
  // physical safety masks that prevent underwater, floating, or extreme-slope
  // instances. This makes a painted grove reliable on Manual Terrain without
  // bypassing terrain integration.
  const physical = (sample.excludeProps ?? 0) > 0.45 || sample.water
    ? 0
    : waterScore(desc, sample) * slopeScore(desc, sample) * heightScore(desc, sample);
  return clamp01(ecological + master * paintedDensity * physical * 1.15);
}

export function shouldPlaceType(desc, sample, params, { roll, macro = 0.5 } = {}) {
  const density = densityForType(desc, params, sample);
  if (density <= 0) return false;
  const patch = desc.id === 'rock'
    ? 0.35 + macro * 0.9
    : desc.id === 'broadleaf' || desc.id === 'conifer'
      ? clamp01((macro - 0.2) * 1.35)
      : 0.42 + macro * 0.72;
  return (roll ?? 0) < clamp01(density * patch);
}

// Backward-compatible weighted selector used by older callers/tests. New
// rendering evaluates each descriptor independently through shouldPlaceType().
export function chooseCandidate(sample, params, rand) {
  let total = 0;
  const scored = [];
  for (const desc of PROP_TYPES) {
    const score = densityForType(desc, params, sample);
    if (score <= 0) continue;
    scored.push([desc, score]);
    total += score;
  }
  if (total <= 0) return null;
  let pick = (rand.pick ?? 0) * total;
  for (const [desc, score] of scored) {
    if (pick < score) return desc;
    pick -= score;
  }
  return scored[scored.length - 1][0];
}
