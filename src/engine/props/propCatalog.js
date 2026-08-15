// Declarative, meter-scaled prop layers. Each layer owns an independent scatter
// grid; props no longer compete for one weighted grid cell.

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function smooth(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-4));
  return t * t * (3 - 2 * t);
}

export const ALIGN = {
  UPRIGHT: 'upright',
  NORMAL: 'normal',
  BLEND: 'blend',
};

export const WATER_RULE = {
  EXCLUDE: 'exclude',
  SHORELINE: 'shoreline',
  SHALLOW: 'shallow',
};

export function waterScore(desc, sample) {
  const sd = sample.shoreDistance;
  if (desc.waterRule === WATER_RULE.SHORELINE) {
    const lo = desc.shoreMin ?? 0.2;
    const hi = desc.shoreMax ?? 6;
    return smooth(lo - 1.2, lo + 0.4, sd) * (1 - smooth(hi, hi + 2, sd));
  }
  if (desc.waterRule === WATER_RULE.SHALLOW) {
    return sd > -(desc.shallowDepth ?? 1.5) ? 1 : 0;
  }
  const clearance = desc.waterClearance ?? 1.5;
  return sd > clearance ? 1 : smooth(clearance - 1, clearance, sd);
}

export function slopeScore(desc, sample) {
  const [lo, hi] = desc.slopeRange ?? [0, 1];
  return smooth(lo - 0.06, lo + 0.04, sample.slope)
    * (1 - smooth(hi - 0.05, hi + 0.08, sample.slope));
}

export function heightScore(desc, sample) {
  if (!desc.heightRange) return 1;
  const [lo, hi] = desc.heightRange;
  let score = 1;
  if (lo != null) score *= smooth(lo - 8, lo + 8, sample.height);
  if (hi != null) score *= 1 - smooth(hi - 8, hi + 8, sample.height);
  return score;
}

export function scoreProp(desc, sample) {
  if ((sample.excludeProps ?? 0) > 0.45 || sample.water) return 0;
  const water = waterScore(desc, sample);
  const slope = slopeScore(desc, sample);
  const height = heightScore(desc, sample);
  if (water <= 0 || slope <= 0 || height <= 0) return 0;
  const biome = desc.biomeScore ? clamp01(desc.biomeScore(sample)) : 1;
  return clamp01(water * slope * height * biome * (desc.density ?? 1));
}

export const PROP_TYPES = [
  {
    id: 'grass', render: 'grass', cellSize: 8, density: 0.92,
    densityParam: 'propsGrassDensity', scaleParam: 'propsGrass',
    waterRule: WATER_RULE.EXCLUDE, waterClearance: 1.2,
    slopeRange: [0, 0.34], scaleRange: [0.25, 0.75],
    alignMode: ALIGN.BLEND, alignAmount: 0.45, rootDepth: 0.05,
    biomeScore: (s) => {
      const w = s.biomeWeights;
      const dry = Math.max(w.desert, w.canyon);
      const green = clamp01(1 - Math.max(dry, w.mountains * 0.55));
      return (1 - dry * 0.9) * (0.18 + s.moisture * 0.72 + green * 0.34 + w.wetland * 0.2);
    },
  },
  {
    id: 'flower', render: 'flower', cellSize: 13, density: 0.34,
    densityParam: 'propsFlowers',
    waterRule: WATER_RULE.EXCLUDE, waterClearance: 1.8,
    slopeRange: [0, 0.22], scaleRange: [0.25, 0.9],
    alignMode: ALIGN.UPRIGHT, alignAmount: 0, rootDepth: 0.04,
    biomeScore: (s) => (1 - s.biomeWeights.desert) * (1 - s.biomeWeights.canyon)
      * (1 - s.biomeWeights.mountains * 0.75) * smooth(0.3, 0.78, s.moisture),
  },
  {
    id: 'rock', render: 'rock', cellSize: 25, density: 0.34,
    densityParam: 'propsRocks', scaleParam: 'propsRockScale',
    waterRule: WATER_RULE.EXCLUDE, waterClearance: 0.8,
    // Icosahedra are roughly two units across. With the per-axis variation
    // below this produces default-world boulders spanning about 0.6–6 m.
    slopeRange: [0.015, 0.68], scaleRange: [0.4, 2.05],
    alignMode: ALIGN.BLEND, alignAmount: 0.78, rootDepthRatio: 0.24,
    biomeScore: (s) => 0.06 + s.biomeWeights.desert * 0.78
      + s.biomeWeights.canyon * 0.92 + s.biomeWeights.mountains * 0.72
      + clamp01(s.slope * 1.8) * 0.42 - s.biomeWeights.wetland * 0.28
      - s.moisture * 0.12,
  },
  {
    id: 'broadleaf', render: 'broadleaf', cellSize: 20, density: 0.29,
    densityParam: 'propsTreeDensity', scaleParam: 'propsTreeScale',
    waterRule: WATER_RULE.EXCLUDE, waterClearance: 3.5,
    slopeRange: [0, 0.27], scaleRange: [8, 18],
    alignMode: ALIGN.UPRIGHT, alignAmount: 0, rootDepthRatio: 0.025,
    biomeScore: (s) => {
      const w = s.biomeWeights;
      const temperate = smooth(0.26, 0.54, s.temperature) * (1 - smooth(0.82, 0.98, s.temperature));
      const forest = clamp01(1 - Math.max(w.desert, w.canyon, w.mountains * 0.72));
      return forest * temperate * smooth(0.34, 0.78, s.moisture) * (1 - w.wetland * 0.35);
    },
  },
  {
    id: 'conifer', render: 'conifer', cellSize: 22, density: 0.3,
    densityParam: 'propsTreeDensity', scaleParam: 'propsTreeScale',
    waterRule: WATER_RULE.EXCLUDE, waterClearance: 3,
    slopeRange: [0, 0.34], scaleRange: [10, 24],
    alignMode: ALIGN.UPRIGHT, alignAmount: 0, rootDepthRatio: 0.02,
    biomeScore: (s) => {
      const w = s.biomeWeights;
      const cool = 1 - smooth(0.55, 0.82, s.temperature);
      const notArid = 1 - Math.max(w.desert, w.canyon) * 0.92;
      return notArid * cool * (0.2 + s.moisture * 0.62 + w.mountains * 0.48) * (1 - w.wetland * 0.55);
    },
  },
];

export function getPropType(id) {
  return PROP_TYPES.find((prop) => prop.id === id) || null;
}

function mixRGB(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function grassTint(sample) {
  const w = sample.biomeWeights;
  const dry = Math.max(w.desert, w.canyon);
  let color = mixRGB([0.82, 1.02, 0.72], [1.2, 1.03, 0.62], clamp01(1 - sample.moisture));
  color = mixRGB(color, [1.42, 1.02, 0.55], dry);
  const cold = clamp01(1 - smooth(0.18, 0.42, sample.temperature));
  return mixRGB(color, [1.05, 1.15, 1.1], cold * 0.7);
}

export function terrainRockTint(sample) {
  const w = sample.biomeWeights;
  const cold = clamp01(1 - smooth(0.18, 0.42, sample.temperature));
  const high = clamp01((sample.height || 0) / Math.max(sample.heightScale || 560, 1));
  let color = mixRGB([0.62, 0.59, 0.53], [0.82, 0.79, 0.71], clamp01(high + sample.slope * 0.45));
  color = mixRGB(color, [0.82, 0.52, 0.3], clamp01(w.canyon * 0.9));
  color = mixRGB(color, [0.72, 0.62, 0.4], clamp01(w.desert * 0.72));
  color = mixRGB(color, [0.42, 0.5, 0.37], clamp01(w.wetland * sample.moisture * 0.6));
  return mixRGB(color, [0.86, 0.88, 0.86], cold * (0.45 + high * 0.35));
}

export function treeTint(sample, conifer = false) {
  const cold = clamp01(1 - smooth(0.18, 0.46, sample.temperature));
  const dry = clamp01(1 - sample.moisture);
  let color = conifer ? [0.62, 0.83, 0.68] : [0.78, 1.0, 0.72];
  color = mixRGB(color, conifer ? [0.74, 0.78, 0.58] : [1.02, 0.88, 0.55], dry * 0.55);
  return mixRGB(color, [0.82, 0.9, 0.86], cold * 0.35);
}

export function flowerTint(seed) {
  const palette = [
    [1.0, 0.92, 0.68], [1.0, 0.58, 0.62], [0.68, 0.72, 1.0], [0.94, 0.7, 0.96],
  ];
  return palette[Math.min(palette.length - 1, Math.floor(clamp01(seed) * palette.length))];
}
