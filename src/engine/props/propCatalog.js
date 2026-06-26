// ============================================================================
// Prop catalog — declarative descriptors that drive placement.
//
// Each descriptor is pure data + small pure functions. Placement
// (PropPlacement.js) and the manager (ProceduralPropsManager.js) consume these
// instead of hard-coding grass/flower branches. This is the "prop layer" schema
// from the rework plan (biome compatibility, slope/height/water rules, scale &
// alignment, wind, color variation). Stage 1 ships only `grass` and `flower`
// using the full schema; later stages append rocks, reeds, biome props, etc.
//
// Conventions:
//   - slope: 0 (flat) .. 1 (vertical), defined as 1 - dot(normal, up).
//   - shoreDistance: world units of terrain height above the water level
//     (negative = submerged). Drives water/shoreline rules.
//   - biomeWeights: { desert, canyon, wetland, mountains } in 0..1; "forest" is
//     the implicit fallback when all four are low.
//   - alignMode: how the instance tilts to the surface normal.
//   - all scoring functions return 0..1; 0 means "do not place here".
// ============================================================================

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function smooth(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-4));
  return t * t * (3 - 2 * t);
}

export const ALIGN = {
  UPRIGHT: 'upright',   // ignore terrain normal, stay vertical
  NORMAL: 'normal',     // fully follow the terrain normal
  BLEND: 'blend',       // partial follow (alignAmount)
  RANDOM_TILT: 'randomTilt',
};

export const WATER_RULE = {
  EXCLUDE: 'exclude',     // only on dry land, with a clearance margin
  SHORELINE: 'shoreline', // only in a band just above the water line
  SHALLOW: 'shallow',     // allowed slightly below the water line
};

// ---------------------------------------------------------------- water rules
// Returns 0..1 suitability from the water rule + shoreDistance.
export function waterScore(desc, sample) {
  const sd = sample.shoreDistance;
  switch (desc.waterRule) {
    case WATER_RULE.SHORELINE: {
      const lo = desc.shoreMin ?? 0.2;
      const hi = desc.shoreMax ?? 6.0;
      // ramp up just above the waterline, fall off past the band
      return smooth(lo - 1.2, lo + 0.4, sd) * (1 - smooth(hi, hi + 2.0, sd));
    }
    case WATER_RULE.SHALLOW: {
      const depth = desc.shallowDepth ?? 1.5;
      return sd > -depth ? 1 : 0;
    }
    case WATER_RULE.EXCLUDE:
    default: {
      const clr = desc.waterClearance ?? 1.5;
      return sd > clr ? 1 : smooth(clr - 1.0, clr, sd);
    }
  }
}

// ---------------------------------------------------------------- slope rule
export function slopeScore(desc, sample) {
  const [lo, hi] = desc.slopeRange ?? [0, 1];
  // soft edges so the cutoff is not a hard line on the terrain
  return smooth(lo - 0.06, lo + 0.04, sample.slope) * (1 - smooth(hi - 0.05, hi + 0.08, sample.slope));
}

// ---------------------------------------------------------------- height rule
export function heightScore(desc, sample) {
  const range = desc.heightRange;
  if (!range) return 1;
  const [lo, hi] = range;
  let s = 1;
  if (lo != null) s *= smooth(lo - 8, lo + 8, sample.height);
  if (hi != null) s *= 1 - smooth(hi - 8, hi + 8, sample.height);
  return s;
}

// ---------------------------------------------------------------- full score
// Combined suitability for a descriptor at a sample, 0..1. Placement multiplies
// this by the descriptor density and a noise mask, then weighted-picks a type.
export function scoreProp(desc, sample) {
  const w = waterScore(desc, sample);
  if (w <= 0) return 0;
  const s = slopeScore(desc, sample);
  if (s <= 0) return 0;
  const h = heightScore(desc, sample);
  if (h <= 0) return 0;
  const b = desc.biomeScore ? clamp01(desc.biomeScore(sample)) : 1;
  if (b <= 0) return 0;
  return w * s * h * b * (desc.density ?? 1);
}

// ============================================================================
// Stage 1 descriptors: grass + flowers + rocks, expressed in the full schema.
// ============================================================================

export const PROP_TYPES = [
  {
    id: 'grass',
    render: 'grass',            // manager maps render → geometry/material/LOD
    waterRule: WATER_RULE.EXCLUDE,
    waterClearance: 1.6,
    slopeRange: [0.0, 0.30],    // soft ground; ~n.y >= 0.7
    heightRange: null,
    density: 1.0,
    // green ground: avoid dry biomes, thicken heavily in moist lowlands/forest.
    biomeScore: (s) => {
      const w = s.biomeWeights;
      const dry = Math.max(w.desert, w.canyon);
      const greenFallback = clamp01(1 - Math.max(w.desert, w.canyon, w.mountains * 0.55));
      return (1 - dry) * (0.15 + 1.1 * s.moisture + 0.45 * greenFallback + 0.25 * w.wetland);
    },
    scaleRange: [0.55, 1.45],
    alignMode: ALIGN.BLEND,
    alignAmount: 0.55,
    rootDepth: 0.15,           // tiny ground bite (props anchor to faceted mesh)
    windInfluence: 1.0,
    colorVar: 0.16,
  },
  {
    id: 'flower',
    render: 'flower',
    waterRule: WATER_RULE.EXCLUDE,
    waterClearance: 2.2,
    slopeRange: [0.0, 0.20],    // flatter than grass
    heightRange: null,
    density: 0.5,               // further scaled by params.propsFlowers
    biomeScore: (s) => (1 - s.biomeWeights.desert) * (1 - s.biomeWeights.canyon)
      * (1 - s.biomeWeights.mountains * 0.7) * smooth(0.30, 0.75, s.moisture),
    scaleRange: [0.85, 1.75],
    alignMode: ALIGN.UPRIGHT,
    alignAmount: 0.0,
    rootDepth: 0.1,
    windInfluence: 0.7,
    colorVar: 0.0,
  },
  {
    id: 'rock',
    render: 'rock',
    waterRule: WATER_RULE.EXCLUDE,
    waterClearance: 1.0,
    slopeRange: [0.02, 0.62],
    heightRange: null,
    density: 0.62,
    biomeScore: (s) => 0.08
      + s.biomeWeights.desert * 1.2
      + s.biomeWeights.canyon * 1.05
      + s.biomeWeights.mountains * 0.75
      + clamp01(s.slope * 1.6) * 0.35
      - s.biomeWeights.wetland * 0.25
      - s.moisture * 0.18,
    scaleRange: [0.55, 2.85],
    alignMode: ALIGN.NORMAL,
    alignAmount: 0.85,
    rootDepth: 0.55,
    windInfluence: 0.0,
    colorVar: 0.20,
  },
];

export function getPropType(id) {
  return PROP_TYPES.find((p) => p.id === id) || null;
}

// ============================================================================
// Biome-driven grass tint.
//
// Returned as an RGB multiplier applied per-instance (instanceColor) on top of
// the green vertex-color gradient, so the same grass mesh reads correctly in
// every biome: dry orange-tan in desert/canyon, pale/frosted where it's cold,
// olive in dry-warm, lush deep green in wet lowlands.  Output channels ~0.5..1.4.
// ============================================================================

function mixRGB(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function grassTint(sample) {
  const w = sample.biomeWeights;
  const temp = sample.temperature;          // 0 cold .. 1 hot
  const moist = sample.moisture;            // 0 dry .. 1 wet
  const dry = Math.max(w.desert, w.canyon);

  // base: lush green (wet) → olive (dry-warm)
  let c = mixRGB([0.95, 1.05, 0.80], [1.20, 1.05, 0.62], clamp01(1 - moist));
  // desert / canyon → dry orange-tan straw
  c = mixRGB(c, [1.45, 1.02, 0.52], clamp01(dry));
  // cold → pale, frosted, slightly blue-green
  const cold = clamp01(1 - smooth(0.18, 0.42, temp));
  c = mixRGB(c, [1.15, 1.22, 1.18], cold * 0.8);
  return c;   // [r,g,b] multiplier
}

// Approximate the terrain albedo around a prop sample so static props feel
// embedded in the biome palette without needing a GPU readback from the terrain
// material. The output is used as per-instance color for rocks.
export function terrainRockTint(sample) {
  const w = sample.biomeWeights;
  const temp = sample.temperature;
  const moist = sample.moisture;
  const slope = sample.slope;
  const dry = Math.max(w.desert, w.canyon);
  const cold = clamp01(1 - smooth(0.18, 0.42, temp));
  const high = clamp01((sample.height || 0) / Math.max(sample.heightScale || 560, 1));

  let c = mixRGB([0.31, 0.29, 0.26], [0.48, 0.45, 0.39], clamp01(high * 0.9 + slope * 0.6));
  c = mixRGB(c, [0.67, 0.47, 0.28], clamp01(w.canyon * 0.95));
  c = mixRGB(c, [0.62, 0.52, 0.34], clamp01(w.desert * 0.75));
  c = mixRGB(c, [0.23, 0.26, 0.20], clamp01(w.wetland * moist * 0.65));
  c = mixRGB(c, [0.76, 0.78, 0.77], cold * (0.55 + 0.35 * high));
  c = mixRGB(c, [0.40, 0.38, 0.36], clamp01(1 - dry) * 0.25);
  return c;
}
