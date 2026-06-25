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
  cloudSteps:            { min: 8,       max: 96 },
  cloudLightSteps:       { min: 1,       max: 12 },
  cloudOctaves:          { min: 1,       max: 6 },
  cloudDetailOctaves:    { min: 0,       max: 5 },
  cloudMaxDistance:      { min: 1.5,     max: 12.0 },
};

// Each preset is a complete snapshot of every tunable value. 'high' matches
// the renderer's historical defaults so default visuals are unchanged.
export const PERF_PRESETS = {
  performance: {
    label: 'Performance',
    onDemandStudio: true,
    renderScale: 0.65, resolutionScale: 0.5, lodDistanceScale: 0.5,
    viewRadius: 6, maxCreatesPerFrame: 4, triangleBudget: 500_000,
    cullingAggressiveness: 1.5,
    waterQuality: 0, waterReflection: 0.6, waterDetail: 0.4, waterWaves: 0.7,
    waterDistance: 0.6, fogDistance: 0.8,
    cloudSteps: 12, cloudLightSteps: 2, cloudSelfShadow: false,
    cloudOctaves: 3, cloudDetailOctaves: 0, cloudUseErosion: false,
    cloudMaxDistance: 3.0, cloudFallback: 'lite',
    cloudLightMode: 1, cloudStepLOD: true,
  },
  balanced: {
    label: 'Balanced',
    onDemandStudio: true,
    renderScale: 0.8, resolutionScale: 0.75, lodDistanceScale: 0.75,
    viewRadius: 10, maxCreatesPerFrame: 6, triangleBudget: 900_000,
    cullingAggressiveness: 1.2,
    waterQuality: 1, waterReflection: 0.85, waterDetail: 0.7, waterWaves: 0.85,
    waterDistance: 0.8, fogDistance: 0.9,
    cloudSteps: 24, cloudLightSteps: 4, cloudSelfShadow: false,
    cloudOctaves: 4, cloudDetailOctaves: 2, cloudUseErosion: true,
    cloudMaxDistance: 4.5, cloudFallback: 'none',
    cloudLightMode: 1, cloudStepLOD: true,
  },
  high: {
    label: 'High',
    onDemandStudio: false,
    renderScale: 1.0, resolutionScale: 1.0, lodDistanceScale: 1.0,
    viewRadius: 12, maxCreatesPerFrame: 8, triangleBudget: 1_600_000,
    cullingAggressiveness: 1.0,
    waterQuality: 2, waterReflection: 1.0, waterDetail: 1.0, waterWaves: 1.0,
    waterDistance: 1.0, fogDistance: 1.0,
    cloudSteps: 40, cloudLightSteps: 6, cloudSelfShadow: true,
    cloudOctaves: 5, cloudDetailOctaves: 4, cloudUseErosion: true,
    cloudMaxDistance: 6.0, cloudFallback: 'none',
    cloudLightMode: 0, cloudStepLOD: false,
  },
  ultra: {
    label: 'Ultra',
    onDemandStudio: false,
    renderScale: 1.0, resolutionScale: 1.25, lodDistanceScale: 1.4,
    viewRadius: 16, maxCreatesPerFrame: 12, triangleBudget: 2_600_000,
    cullingAggressiveness: 0.8,
    waterQuality: 2, waterReflection: 1.2, waterDetail: 1.2, waterWaves: 1.0,
    waterDistance: 1.0, fogDistance: 1.2,
    cloudSteps: 72, cloudLightSteps: 8, cloudSelfShadow: true,
    cloudOctaves: 5, cloudDetailOctaves: 5, cloudUseErosion: true,
    cloudMaxDistance: 8.0, cloudFallback: 'none',
    cloudLightMode: 0, cloudStepLOD: false,
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
    underwaterEffect: true,
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
  // underwater camera effect — only costs anything while submerged
  s.underwaterEffect = s.underwaterEffect !== false;
  // on-demand studio rendering — skip redraws when the studio scene is static
  s.onDemandStudio = !!s.onDemandStudio;

  s.cloudSteps = Math.round(clamp(+s.cloudSteps || 12, PERF_LIMITS.cloudSteps));
  s.cloudLightSteps = Math.round(clamp(+s.cloudLightSteps || 6, PERF_LIMITS.cloudLightSteps));
  s.cloudOctaves = Math.round(clamp(+s.cloudOctaves || 5, PERF_LIMITS.cloudOctaves));
  s.cloudDetailOctaves = Math.round(clamp(+s.cloudDetailOctaves || 4, PERF_LIMITS.cloudDetailOctaves));
  s.cloudUseErosion = s.cloudUseErosion !== false;
  s.cloudSelfShadow = s.cloudSelfShadow !== false;
  // cheap analytic self-shadow + distance step-LOD (default off → unchanged visuals)
  s.cloudLightMode = s.cloudLightMode ? 1 : 0;
  s.cloudStepLOD = !!s.cloudStepLOD;
  s.cloudMaxDistance = clamp(+s.cloudMaxDistance || 6.0, PERF_LIMITS.cloudMaxDistance);
  s.cloudFallback = s.cloudFallback || 'none';
  if (s.preset === 'performance') {
    s.cloudSteps = Math.min(s.cloudSteps, 12);
  }

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

/** True if the user already has persisted perf settings (i.e. not a first run).
 *  Used to gate one-time GPU-tier auto-selection so we never override a
 *  returning user's choices. */
export function hasStoredPerfSettings() {
  try { return localStorage.getItem(STORAGE_KEY) != null; } catch { return false; }
}

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
