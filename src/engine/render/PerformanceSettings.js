// ============================================================================
// PerformanceSettings: centralized performance tuning state for the whole
// renderer. One settings object drives pixel ratio, terrain LOD segment
// counts, LOD distance thresholds, chunk streaming, culling, water shader
// quality, fog distance and triangle budget.
//
// Presets (performance / balanced / high / ultra) are full snapshots of the
// tunable values; editing any individual value switches the preset to
// 'custom'. Settings are sanitized against PERF_LIMITS so no combination can
// create enough geometry to crash the browser, and persisted to localStorage.
//
// Resolution scaling: `lodSegments` holds the 4 base per-LOD segment counts;
// `resolutionScale` is the master slider that scales all 4 proportionally
// (e.g. [128,64,32,16] × 0.5 → [64,32,16,8]). Same idea for `lodDistances`
// (in chunk-size units) and `lodDistanceScale`.
// ============================================================================

export const BASE_LOD_SEGMENTS = [64, 32, 16, 8];   // quads per chunk side
export const BASE_LOD_DISTANCES = [4, 8, 14];       // thresholds × chunkSize

// Hard ceiling on the worst-case triangle estimate; sanitize() scales
// settings down until any combination fits under it.
export const MAX_SAFE_TRIANGLES = 6_000_000;

const STORAGE_KEY = 'terrain-studio-perf-v1';

export const PERF_LIMITS = {
  renderScale:           { min: 0.4,     max: 2.0 },
  resolutionScale:       { min: 0.25,    max: 2.0 },
  lodDistanceScale:      { min: 0.3,     max: 2.5 },
  lodSegment:            { min: 4,       max: 256 },
  lodDistance:           { min: 0.5,     max: 30 },
  viewRadius:            { min: 3,       max: 20 },
  maxCreatesPerFrame:    { min: 1,       max: 16 },
  triangleBudget:        { min: 100_000, max: 3_000_000 },
  cullingAggressiveness: { min: 0,       max: 2 },
  waterQuality:          { min: 0,       max: 2 },
  waterReflection:       { min: 0,       max: 1.5 },
  waterDetail:           { min: 0,       max: 1.5 },
  waterWaves:            { min: 0,       max: 1.5 },
  waterDistance:         { min: 0.25,    max: 1.0 },
  fogDistance:           { min: 0.4,     max: 2.0 },
};

// Each preset is a complete snapshot of every tunable value. 'high' matches
// the renderer's historical defaults so default visuals are unchanged.
export const PERF_PRESETS = {
  performance: {
    label: 'Performance',
    renderScale: 0.65, resolutionScale: 0.5, lodDistanceScale: 0.5,
    viewRadius: 6, maxCreatesPerFrame: 4, triangleBudget: 500_000,
    cullingAggressiveness: 1.5,
    waterQuality: 0, waterReflection: 0.6, waterDetail: 0.4, waterWaves: 0.7,
    waterDistance: 0.6, fogDistance: 0.8,
  },
  balanced: {
    label: 'Balanced',
    renderScale: 0.8, resolutionScale: 0.75, lodDistanceScale: 0.75,
    viewRadius: 10, maxCreatesPerFrame: 6, triangleBudget: 900_000,
    cullingAggressiveness: 1.2,
    waterQuality: 1, waterReflection: 0.85, waterDetail: 0.7, waterWaves: 0.85,
    waterDistance: 0.8, fogDistance: 0.9,
  },
  high: {
    label: 'High',
    renderScale: 1.0, resolutionScale: 1.0, lodDistanceScale: 1.0,
    viewRadius: 12, maxCreatesPerFrame: 8, triangleBudget: 1_600_000,
    cullingAggressiveness: 1.0,
    waterQuality: 2, waterReflection: 1.0, waterDetail: 1.0, waterWaves: 1.0,
    waterDistance: 1.0, fogDistance: 1.0,
  },
  ultra: {
    label: 'Ultra',
    renderScale: 1.0, resolutionScale: 1.25, lodDistanceScale: 1.4,
    viewRadius: 16, maxCreatesPerFrame: 12, triangleBudget: 2_600_000,
    cullingAggressiveness: 0.8,
    waterQuality: 2, waterReflection: 1.2, waterDetail: 1.2, waterWaves: 1.0,
    waterDistance: 1.0, fogDistance: 1.2,
  },
};

export function getPerfPresetKeys() {
  return ['performance', 'balanced', 'high', 'ultra'];
}

const clamp = (v, lim) => Math.min(lim.max, Math.max(lim.min, v));

/**
 * Build a complete settings object from a preset key.
 * Base LOD arrays start at the defaults; presets only vary the multipliers.
 */
export function createPerfSettings(presetKey = 'high') {
  const { label, ...values } = PERF_PRESETS[presetKey] || PERF_PRESETS.high;
  return sanitizePerfSettings({
    preset: PERF_PRESETS[presetKey] ? presetKey : 'high',
    autoPerf: false,
    lodSegments: [...BASE_LOD_SEGMENTS],
    lodDistances: [...BASE_LOD_DISTANCES],
    ...values,
  });
}

/**
 * Apply a preset on top of existing settings (keeps the user's custom base
 * LOD arrays only when staying on 'custom'; presets reset them).
 */
export function applyPerfPreset(settings, presetKey) {
  if (presetKey === 'custom') return { ...settings, preset: 'custom' };
  const { label, ...values } = PERF_PRESETS[presetKey] || PERF_PRESETS.high;
  return sanitizePerfSettings({
    ...settings,
    ...values,
    lodSegments: [...BASE_LOD_SEGMENTS],
    lodDistances: [...BASE_LOD_DISTANCES],
    preset: presetKey,
  });
}

/**
 * Effective per-LOD segment counts = base segments × master resolution scale,
 * clamped to safe limits.
 */
export function resolveLodSegments(settings) {
  return settings.lodSegments.map((s) =>
    Math.round(clamp(s * settings.resolutionScale, PERF_LIMITS.lodSegment))
  );
}

/**
 * Effective LOD distance thresholds (in chunk-size units) = base × master
 * distance scale, kept strictly ascending.
 */
export function resolveLodDistances(settings) {
  const out = settings.lodDistances.map((d) =>
    clamp(d * settings.lodDistanceScale, PERF_LIMITS.lodDistance)
  );
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] + 0.25);
  return out;
}

/**
 * Worst-case visible triangle estimate (no culling) for the current
 * settings: chunks per LOD ring × triangles per chunk at that LOD.
 */
export function estimateTriangles(settings) {
  const segs = resolveLodSegments(settings);
  const dists = resolveLodDistances(settings);
  const r = settings.viewRadius;

  const areas = [];
  let prev = 0;
  for (let i = 0; i < 3; i++) {
    const d = Math.min(dists[i], r);
    const a = Math.PI * d * d;
    areas.push(Math.max(0, a - prev));
    prev = Math.max(prev, a);
  }
  areas.push(Math.max(0, Math.PI * r * r - prev));

  let tris = 0;
  for (let i = 0; i < 4; i++) {
    const s = segs[i];
    tris += areas[i] * (2 * s * s + 8 * s);   // grid + skirt wall
  }
  return Math.round(tris);
}

/**
 * Clamp every value into PERF_LIMITS and scale resolution down until the
 * worst-case triangle estimate fits under MAX_SAFE_TRIANGLES. Mutation-free.
 */
export function sanitizePerfSettings(settings) {
  const s = { ...settings };

  s.renderScale = clamp(+s.renderScale || 1, PERF_LIMITS.renderScale);
  s.resolutionScale = clamp(+s.resolutionScale || 1, PERF_LIMITS.resolutionScale);
  s.lodDistanceScale = clamp(+s.lodDistanceScale || 1, PERF_LIMITS.lodDistanceScale);
  s.viewRadius = Math.round(clamp(+s.viewRadius || 12, PERF_LIMITS.viewRadius));
  s.maxCreatesPerFrame = Math.round(clamp(+s.maxCreatesPerFrame || 6, PERF_LIMITS.maxCreatesPerFrame));
  s.triangleBudget = Math.round(clamp(+s.triangleBudget || 1_500_000, PERF_LIMITS.triangleBudget));
  s.cullingAggressiveness = clamp(+s.cullingAggressiveness || 1, PERF_LIMITS.cullingAggressiveness);
  s.waterQuality = Math.round(clamp(+s.waterQuality || 0, PERF_LIMITS.waterQuality));
  s.waterReflection = clamp(+s.waterReflection || 0, PERF_LIMITS.waterReflection);
  s.waterDetail = clamp(+s.waterDetail || 0, PERF_LIMITS.waterDetail);
  s.waterWaves = clamp(+s.waterWaves || 0, PERF_LIMITS.waterWaves);
  s.waterDistance = clamp(+s.waterDistance || 1, PERF_LIMITS.waterDistance);
  s.fogDistance = clamp(+s.fogDistance || 1, PERF_LIMITS.fogDistance);
  s.autoPerf = !!s.autoPerf;

  const segSrc = Array.isArray(s.lodSegments) ? s.lodSegments : BASE_LOD_SEGMENTS;
  s.lodSegments = BASE_LOD_SEGMENTS.map((def, i) =>
    Math.round(clamp(+segSrc[i] || def, PERF_LIMITS.lodSegment))
  );
  const distSrc = Array.isArray(s.lodDistances) ? s.lodDistances : BASE_LOD_DISTANCES;
  s.lodDistances = BASE_LOD_DISTANCES.map((def, i) =>
    clamp(+distSrc[i] || def, PERF_LIMITS.lodDistance)
  );

  // Browser-safety valve: shrink resolution (then view radius) until the
  // worst-case estimate is survivable.
  let guard = 0;
  while (estimateTriangles(s) > MAX_SAFE_TRIANGLES && guard++ < 64) {
    if (s.resolutionScale > PERF_LIMITS.resolutionScale.min) {
      s.resolutionScale = Math.max(PERF_LIMITS.resolutionScale.min, s.resolutionScale * 0.9);
    } else if (s.viewRadius > PERF_LIMITS.viewRadius.min) {
      s.viewRadius -= 1;
    } else {
      break;
    }
  }

  return s;
}

// ------------------------------------------------------------- persistence

export function loadPerfSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const base = createPerfSettings(parsed.preset === 'custom' ? 'high' : parsed.preset);
      return sanitizePerfSettings({ ...base, ...parsed });
    }
  } catch { /* corrupted or unavailable storage — fall through to defaults */ }
  return createPerfSettings('high');
}

export function savePerfSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* private mode / quota — non-fatal */ }
}
