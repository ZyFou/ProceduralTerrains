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

import {
  sanitizeGpuPreference,
  sanitizeRendererBackend,
} from './RendererCapabilities.js';

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
  maxCreatesPerFrame:    { min: 0,       max: 16 },
  terrainMergeQuads:     { min: 4,       max: 16 },
  terrainMergeDistance:  { min: 1,       max: 16 },
  triangleBudget:        { min: 100_000, max: 3_000_000 },
  cullingAggressiveness: { min: 0,       max: 2 },
  waterQuality:          { min: 0,       max: 2 },
  waterReflection:       { min: 0,       max: 1.5 },
  waterDetail:           { min: 0,       max: 1.5 },
  waterWaves:            { min: 0,       max: 1.5 },
  waterDistance:         { min: 0.25,    max: 1.0 },
  fogDistance:           { min: 0.4,     max: 2.0 },
  terrainDetailQuality:  { min: 0,       max: 3 },
  terrainDetailOpacity:  { min: 0,       max: 1.0 },
  terrainDetailScale:    { min: 0.04,    max: 0.60 },
  terrainDetailStrength: { min: 0,       max: 1.6 },
  terrainDetailNormal:   { min: 0,       max: 1.0 },
  terrainMicroDetail:    { min: 0,       max: 1.0 },
  terrainMacroVariation: { min: 0,       max: 1.0 },
  terrainDetailNear:     { min: 10,      max: 180 },
  terrainDetailFar:      { min: 40,      max: 420 },
  terrainRockSlope:      { min: 0.08,    max: 0.72 },
  terrainRockSharpness:  { min: 0.04,    max: 0.35 },
  terrainShoreRange:     { min: 2,       max: 60 },
  terrainShoreWetness:   { min: 0,       max: 1 },
  cloudSteps:            { min: 8,       max: 96 },
  cloudLightSteps:       { min: 1,       max: 12 },
  cloudOctaves:          { min: 1,       max: 6 },
  cloudDetailOctaves:    { min: 0,       max: 5 },
  cloudRenderScale:      { min: 0.25,    max: 1.0 },
  cloudMaxDistance:      { min: 1.5,     max: 12.0 },
};

// Each preset is a complete snapshot of every tunable value. 'high' matches
// the renderer's historical defaults so default visuals are unchanged.
export const PERF_PRESETS = {
  performance: {
    label: 'Performance',
    onDemandStudio: true,
    renderScale: 0.65, resolutionScale: 0.5, lodDistanceScale: 0.5,
    viewRadius: 6, maxCreatesPerFrame: 0, triangleBudget: 500_000,
    cullingAggressiveness: 1.5,
    waterQuality: 0, waterReflection: 0.6, waterDetail: 0.4, waterWaves: 0.7,
    waterDistance: 0.6, fogDistance: 0.8,
    terrainDetailQuality: 1, terrainDetailScale: 0.12, terrainDetailStrength: 0.42,
    terrainDetailNormal: 0.18, terrainDetailNear: 52, terrainDetailFar: 128,
    terrainRockSlope: 0.34, terrainRockSharpness: 0.16, terrainTriplanar: true,
    terrainShoreRange: 12, terrainShoreWetness: 0.22,
    terrainDetailOpacity: 1.0, terrainMicroDetail: 0.0, terrainMacroVariation: 0.35,
    cloudSteps: 12, cloudLightSteps: 2, cloudSelfShadow: false,
    cloudOctaves: 3, cloudDetailOctaves: 0, cloudUseErosion: false,
    cloudMaxDistance: 3.0, cloudFallback: 'lite',
    cloudLightMode: 1, cloudStepLOD: true, cloudRenderScale: 0.5,
  },
  balanced: {
    label: 'Balanced',
    onDemandStudio: true,
    renderScale: 0.8, resolutionScale: 0.75, lodDistanceScale: 0.75,
    viewRadius: 10, maxCreatesPerFrame: 0, triangleBudget: 900_000,
    cullingAggressiveness: 1.2,
    waterQuality: 1, waterReflection: 0.85, waterDetail: 0.7, waterWaves: 0.85,
    waterDistance: 0.8, fogDistance: 0.9,
    terrainDetailQuality: 2, terrainDetailScale: 0.16, terrainDetailStrength: 0.66,
    terrainDetailNormal: 0.32, terrainDetailNear: 70, terrainDetailFar: 168,
    terrainRockSlope: 0.30, terrainRockSharpness: 0.15, terrainTriplanar: true,
    terrainShoreRange: 16, terrainShoreWetness: 0.30,
    terrainDetailOpacity: 1.0, terrainMicroDetail: 0.45, terrainMacroVariation: 0.5,
    cloudSteps: 24, cloudLightSteps: 4, cloudSelfShadow: false,
    cloudOctaves: 4, cloudDetailOctaves: 2, cloudUseErosion: true,
    cloudMaxDistance: 4.5, cloudFallback: 'none',
    cloudLightMode: 1, cloudStepLOD: true, cloudRenderScale: 0.5,
  },
  high: {
    label: 'High',
    onDemandStudio: false,
    renderScale: 1.0, resolutionScale: 1.0, lodDistanceScale: 1.0,
    viewRadius: 12, maxCreatesPerFrame: 0, triangleBudget: 1_600_000,
    cullingAggressiveness: 1.0,
    waterQuality: 2, waterReflection: 1.0, waterDetail: 1.0, waterWaves: 1.0,
    waterDistance: 1.0, fogDistance: 1.0,
    terrainDetailQuality: 3, terrainDetailScale: 0.20, terrainDetailStrength: 0.88,
    terrainDetailNormal: 0.50, terrainDetailNear: 80, terrainDetailFar: 190,
    terrainRockSlope: 0.28, terrainRockSharpness: 0.14, terrainTriplanar: true,
    terrainShoreRange: 18, terrainShoreWetness: 0.35,
    terrainDetailOpacity: 1.0, terrainMicroDetail: 0.6, terrainMacroVariation: 0.55,
    cloudSteps: 40, cloudLightSteps: 6, cloudSelfShadow: true,
    cloudOctaves: 5, cloudDetailOctaves: 4, cloudUseErosion: true,
    cloudMaxDistance: 6.0, cloudFallback: 'none',
    cloudLightMode: 0, cloudStepLOD: false, cloudRenderScale: 1.0,
  },
  ultra: {
    label: 'Ultra',
    onDemandStudio: false,
    renderScale: 1.0, resolutionScale: 1.25, lodDistanceScale: 1.4,
    viewRadius: 16, maxCreatesPerFrame: 0, triangleBudget: 2_600_000,
    cullingAggressiveness: 0.8,
    waterQuality: 2, waterReflection: 1.2, waterDetail: 1.2, waterWaves: 1.0,
    waterDistance: 1.0, fogDistance: 1.2,
    terrainDetailQuality: 3, terrainDetailScale: 0.24, terrainDetailStrength: 1.02,
    terrainDetailNormal: 0.62, terrainDetailNear: 96, terrainDetailFar: 240,
    terrainRockSlope: 0.25, terrainRockSharpness: 0.12, terrainTriplanar: true,
    terrainShoreRange: 22, terrainShoreWetness: 0.42,
    terrainDetailOpacity: 1.0, terrainMicroDetail: 0.8, terrainMacroVariation: 0.6,
    cloudSteps: 72, cloudLightSteps: 8, cloudSelfShadow: true,
    cloudOctaves: 5, cloudDetailOctaves: 5, cloudUseErosion: true,
    cloudMaxDistance: 8.0, cloudFallback: 'none',
    cloudLightMode: 0, cloudStepLOD: false, cloudRenderScale: 1.0,
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
    rendererBackend: 'auto',
    gpuPreference: 'default',
    useWorker: false,
    autoPerf: true,
    underwaterEffect: true,
    // Terrain merge layer (Tile mode): quadtree that folds far chunk blocks
    // into fewer flat-grid meshes. Preset-independent — fold distance scales
    // with lodDistanceScale — so presets don't reset these.
    terrainMerge: true,
    terrainMergeQuads: 8,
    terrainMergeDistance: 4,
    terrainMacroProxy: true,
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

  s.rendererBackend = sanitizeRendererBackend(s.rendererBackend);
  s.gpuPreference = sanitizeGpuPreference(s.gpuPreference);
  s.useWorker = !!s.useWorker;

  s.renderScale = clamp(+s.renderScale || 1, PERF_LIMITS.renderScale);
  s.resolutionScale = clamp(+s.resolutionScale || 1, PERF_LIMITS.resolutionScale);
  s.lodDistanceScale = clamp(+s.lodDistanceScale || 1, PERF_LIMITS.lodDistanceScale);
  s.viewRadius = Math.round(clamp(+s.viewRadius || 12, PERF_LIMITS.viewRadius));
  {
    const creates = Number(s.maxCreatesPerFrame);
    s.maxCreatesPerFrame = Math.round(clamp(Number.isFinite(creates) ? creates : 0, PERF_LIMITS.maxCreatesPerFrame));
  }
  s.triangleBudget = Math.round(clamp(+s.triangleBudget || 1_500_000, PERF_LIMITS.triangleBudget));
  s.cullingAggressiveness = clamp(+s.cullingAggressiveness || 1, PERF_LIMITS.cullingAggressiveness);
  s.waterQuality = Math.round(clamp(+s.waterQuality || 0, PERF_LIMITS.waterQuality));
  s.waterReflection = clamp(+s.waterReflection || 0, PERF_LIMITS.waterReflection);
  s.waterDetail = clamp(+s.waterDetail || 0, PERF_LIMITS.waterDetail);
  s.waterWaves = clamp(+s.waterWaves || 0, PERF_LIMITS.waterWaves);
  s.waterDistance = clamp(+s.waterDistance || 1, PERF_LIMITS.waterDistance);
  s.fogDistance = clamp(+s.fogDistance || 1, PERF_LIMITS.fogDistance);
  s.terrainDetailQuality = Math.round(clamp(+s.terrainDetailQuality || 0, PERF_LIMITS.terrainDetailQuality));
  s.terrainDetailScale = clamp(+s.terrainDetailScale || 0.16, PERF_LIMITS.terrainDetailScale);
  s.terrainDetailStrength = clamp(+s.terrainDetailStrength || 0, PERF_LIMITS.terrainDetailStrength);
  s.terrainDetailNormal = clamp(+s.terrainDetailNormal || 0, PERF_LIMITS.terrainDetailNormal);
  s.terrainDetailNear = clamp(+s.terrainDetailNear || 80, PERF_LIMITS.terrainDetailNear);
  s.terrainDetailFar = clamp(+s.terrainDetailFar || 190, PERF_LIMITS.terrainDetailFar);
  if (s.terrainDetailFar <= s.terrainDetailNear + 1) {
    s.terrainDetailFar = Math.min(PERF_LIMITS.terrainDetailFar.max, s.terrainDetailNear + 1);
  }
  s.terrainRockSlope = clamp(+s.terrainRockSlope || 0.28, PERF_LIMITS.terrainRockSlope);
  s.terrainRockSharpness = clamp(+s.terrainRockSharpness || 0.14, PERF_LIMITS.terrainRockSharpness);
  s.terrainTriplanar = s.terrainTriplanar !== false;
  s.terrainShoreRange = clamp(+s.terrainShoreRange || 18, PERF_LIMITS.terrainShoreRange);
  s.terrainShoreWetness = clamp(+s.terrainShoreWetness || 0, PERF_LIMITS.terrainShoreWetness);
  s.terrainDetailOpacity = clamp(Number.isFinite(+s.terrainDetailOpacity) ? +s.terrainDetailOpacity : 1.0, PERF_LIMITS.terrainDetailOpacity);
  s.terrainMicroDetail = clamp(Number.isFinite(+s.terrainMicroDetail) ? +s.terrainMicroDetail : 0.6, PERF_LIMITS.terrainMicroDetail);
  s.terrainMacroVariation = clamp(Number.isFinite(+s.terrainMacroVariation) ? +s.terrainMacroVariation : 0.5, PERF_LIMITS.terrainMacroVariation);
  s.autoPerf = !!s.autoPerf;
  // terrain merge layer (Tile mode quadtree)
  s.terrainMerge = s.terrainMerge !== false;
  s.terrainMergeQuads = Math.round(clamp(+s.terrainMergeQuads || 8, PERF_LIMITS.terrainMergeQuads));
  s.terrainMergeDistance = clamp(+s.terrainMergeDistance || 4, PERF_LIMITS.terrainMergeDistance);
  s.terrainMacroProxy = s.terrainMacroProxy !== false;
  // underwater camera effect — only costs anything while submerged
  s.underwaterEffect = s.underwaterEffect !== false;
  // on-demand studio rendering — skip redraws when the studio scene is static
  s.onDemandStudio = !!s.onDemandStudio;

  s.cloudSteps = Math.round(clamp(+s.cloudSteps || 12, PERF_LIMITS.cloudSteps));
  s.cloudLightSteps = Math.round(clamp(+s.cloudLightSteps || 6, PERF_LIMITS.cloudLightSteps));
  s.cloudOctaves = Math.round(clamp(+s.cloudOctaves || 5, PERF_LIMITS.cloudOctaves));
  s.cloudDetailOctaves = Math.round(clamp(+s.cloudDetailOctaves || 4, PERF_LIMITS.cloudDetailOctaves));
  s.cloudUseErosion = s.cloudUseErosion !== false;
  s.cloudRenderScale = clamp(+s.cloudRenderScale || 1.0, PERF_LIMITS.cloudRenderScale);
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
