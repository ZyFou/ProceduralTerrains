// ============================================================================
// Mini Terrain — document model, normalization and derived configuration.
//
// Mini Terrain is a PRESENTATION of the finite (Tile/studio) world: one
// footprint, one main seed, one high-resolution surface, a cut-away base and
// water that stops at the footprint. It is not a terrain source: the relief is
// still the procedural noise stack (plus Paint layers), on top of which a
// deterministic composition recipe lays down the dominant silhouette.
//
// Everything here is pure (no THREE, no engine state) so it can be unit tested
// and shared by the engine, the worker snapshot and the React panel.
//
// Units: every artistic proportion is expressed against the reference width W
// (world units of the square footprint) and converted explicitly to the units
// the existing systems use (heights, cloud altitudes, prop distances...). The
// miniature look comes from framing and proportions, never from scaling the
// scene down.
// ============================================================================

import { MINI_VISUAL_PARAMS } from './MiniLook.js';
import { DEFAULT_PARAMS, PRESETS } from '../presets.js';

// v2: relief/height split, props through the shared prop system. Older
// documents get their derived params re-applied on load.
// v3: diorama noise shaping (band-limited octaves, rounded relief) and the
// props size control; v2 documents get the 'shape' scope re-applied.
export const MINI_TERRAIN_VERSION = 3;

// Reference footprint width in engine units. Large enough that the existing
// absolute thresholds (water foam/shallow distances, caustic depth fade, wave
// spectrum) stay in their tuned range; small enough that one chunk at 256
// segments gives ~4 units per quad.
export const MINI_REFERENCE_WIDTH = 1024;
export const MINI_WIDTH_LIMITS = Object.freeze({ min: 512, max: 2048 });

// Recipes are authored in RELIEF units: 1 = W * MINI_RELIEF_RATIO world
// units. The engine height scale is deliberately larger (MINI_HEIGHT_RATIO)
// because the terrain palette reads h01 = height / heightScale as altitude
// (snow, bare high rock): the cliffs of a diorama are a temperate coast, not
// an alpine summit. Composition heights are converted relief -> h01 with
// k = RELIEF / HEIGHT.
export const MINI_RELIEF_RATIO = 0.32;
export const MINI_HEIGHT_RATIO = 0.6;
// Frozen formation sea level (relief units). The composition is authored
// around it, so the live water-level control moves only the water.
export const MINI_FORMATION_SEA01 = 0.22;
// Water level slider (0..1) -> sea level offset around the formation level,
// in relief units: 0 = almost dry basins, 1 = mostly submerged lowlands.
export const MINI_WATER_SWING01 = 0.16;

// Requested terrain resolution profiles (segments per side of the single
// surface mesh). Effective render quality may degrade passes, never this.
export const MINI_QUALITY_PROFILES = Object.freeze({
  balanced: Object.freeze({ id: 'balanced', label: 'Balanced', segments: 128, waterMode: 'volumetric' }),
  high: Object.freeze({ id: 'high', label: 'High', segments: 256, waterMode: 'volumetric' }),
  capture: Object.freeze({ id: 'capture', label: 'Capture', segments: 512, waterMode: 'volumetric' }),
});
export const MINI_QUALITY_IDS = Object.freeze(Object.keys(MINI_QUALITY_PROFILES));

// Cut-away (section) palettes for the opaque terrain walls. Colours are sRGB
// 0..1 triplets: topsoil just under the surface, then alternating strata,
// then the deep base.
export const MINI_CUT_STYLES = Object.freeze({
  strata: Object.freeze({
    id: 'strata', label: 'Layered rock',
    topsoil: [0.30, 0.22, 0.15], bandA: [0.60, 0.52, 0.42], bandB: [0.48, 0.40, 0.32],
    deep: [0.30, 0.27, 0.24], sediment: [0.74, 0.66, 0.50], bands: 9,
  }),
  soil: Object.freeze({
    id: 'soil', label: 'Soil & sand',
    topsoil: [0.26, 0.19, 0.12], bandA: [0.66, 0.55, 0.40], bandB: [0.56, 0.45, 0.32],
    deep: [0.42, 0.34, 0.26], sediment: [0.80, 0.72, 0.55], bands: 6,
  }),
  dark: Object.freeze({
    id: 'dark', label: 'Dark earth',
    topsoil: [0.16, 0.12, 0.09], bandA: [0.30, 0.25, 0.21], bandB: [0.24, 0.20, 0.17],
    deep: [0.13, 0.11, 0.10], sediment: [0.42, 0.37, 0.30], bands: 7,
  }),
});
export const MINI_CUT_STYLE_IDS = Object.freeze(Object.keys(MINI_CUT_STYLES));

// Footprint outline. A circle is a rounded bevel whose radius is the
// half-width, so terrain, walls, water, props, light map and export all share
// the existing bevel path; only the socle and its ground shadow change shape.
// Hexagons use six regular sides, with half-width as the circumradius.
export const MINI_SHAPES = Object.freeze(['square', 'circle', 'hexagon']);
/** Footprint of the cloud generation zone (independent of the diorama shape). */
export const MINI_CLOUD_SHAPES = Object.freeze(['circle', 'square']);

// Composition recipes. `shape` is the shader discriminant (uMiniShape).
// Geometry is in normalized footprint coordinates (half-width = 1); heights in
// h01 units relative to the formation sea level. `jitter` bounds the seeded
// variation so every seed keeps the recipe's readable silhouette.
export const MINI_RECIPES = Object.freeze({
  // Fully procedural diorama: no imposed composition, the relief comes from
  // a regular procedural preset (+ noise stack), only scaled to the footprint.
  procedural: Object.freeze({
    id: 'procedural',
    label: 'Procédural',
    labelEn: 'Procedural',
    shape: 0,
    geometry: [0, 0, 0, 0],
    heights: [0, 0, 0, 0],
    detail: [0, 0, 0, 0],
    wobble: 0,
    jitter: { center: 0, angle: 0, radius: 0 },
    palette: 'coast',
    cutStyle: 'strata',
    water: 'tropical',
    vegetation: 0.7,
    clouds: 0.75,
    climate: null,
  }),
  cove: Object.freeze({
    id: 'cove',
    label: 'Crique aux falaises',
    labelEn: 'Cliff cove',
    shape: 1,
    // radius of the sheltered bowl, ring width, opening half-angle, cliff width
    geometry: [0.44, 0.42, 0.80, 0.035],
    // land height, sea-floor depth, beach height, secondary peak (relief units)
    heights: [0.50, 0.26, 0.035, 0.12],
    // detail on land / under water, terrace steps, terrace strength
    detail: [0.30, 0.08, 11, 0.5],
    wobble: 0.2,
    jitter: { center: 0.08, angle: 0.30, radius: 0.08 },
    palette: 'tropical',
    cutStyle: 'strata',
    water: 'tropical',
    vegetation: 0.75,
    clouds: 0.75,
    climate: { tempBias: 0.42, moistBias: 0.3 },
  }),
  islet: Object.freeze({
    id: 'islet',
    label: 'Îlot boisé',
    labelEn: 'Wooded islet',
    shape: 2,
    // island radius, shelf width, peak offset distance, shoreline width
    geometry: [0.64, 0.85, 0.34, 0.06],
    heights: [0.40, 0.24, 0.03, 0.16],
    detail: [0.30, 0.07, 0, 0],
    wobble: 0.22,
    jitter: { center: 0.12, angle: 3.14159, radius: 0.10 },
    palette: 'tropical',
    cutStyle: 'soil',
    water: 'tropical',
    vegetation: 0.9,
    clouds: 0.75,
    climate: { tempBias: 0.45, moistBias: 0.38 },
  }),
  lake: Object.freeze({
    id: 'lake',
    label: 'Lac de montagne',
    labelEn: 'Mountain lake',
    shape: 3,
    // lake radius, shore width, back-range spread, shoreline width
    geometry: [0.54, 0.30, 0.85, 0.07],
    heights: [0.30, 0.14, 0.03, 0.46],
    detail: [0.42, 0.06, 0, 0],
    wobble: 0.3,
    jitter: { center: 0.10, angle: 0.45, radius: 0.08 },
    palette: 'earth',
    cutStyle: 'dark',
    water: 'lake',
    vegetation: 0.6,
    clouds: 0.75,
    climate: { tempBias: 0.32, moistBias: 0.25 },
  }),
});
export const MINI_RECIPE_IDS = Object.freeze(Object.keys(MINI_RECIPES));
export const MINI_COMPOSITION_IDS = Object.freeze(MINI_RECIPE_IDS.filter((id) => id !== 'procedural'));
export const DEFAULT_MINI_RECIPE = 'procedural';
export const DEFAULT_MINI_PRESET = 'archipelago';
// Procedural base presets offered for a fully procedural diorama.
export const MINI_PROCEDURAL_PRESETS = Object.freeze(
  Object.entries(PRESETS).map(([id, preset]) => Object.freeze({ id, label: preset.label })),
);
// Height of a procedural diorama relative to the same preset on a 2048-unit
// open board (proportionally, before the Relief slider). Below 1: a diorama
// reads as a landscape model, not as a cluster of needles.
export const MINI_PROCEDURAL_RELIEF = 0.9;
// Props size slider range (multiplier of the diorama's base prop scales).
export const MINI_PROP_SCALE_LIMITS = Object.freeze({ min: 0.25, max: 3 });
// Base prop scales of a diorama at Props size 1.
const MINI_TREE_SCALE = 2.2;
const MINI_ROCK_SCALE = 2.5;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const finite = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

// 32-bit avalanche hash (lowbias32). Pure integer maths → identical everywhere.
function hash32(x) {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Independent sub-seeds derived from the single main seed. Changing the
 * vegetation density re-draws nothing in the relief, and vice versa.
 */
export function deriveMiniSeeds(seed) {
  const s = (Number(seed) >>> 0);
  return {
    relief: hash32(s ^ 0x52454c46),   // 'RELF'
    props: hash32(s ^ 0x50524f50),    // 'PROP'
    clouds: hash32(s ^ 0x434c4f55),   // 'CLOU'
    noise: hash32(s ^ 0x4e4f4953),    // 'NOIS'
  };
}

// Deterministic uniform stream in [0,1) from a 32-bit seed.
function makeRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export function createMiniTerrainState({ recipe = DEFAULT_MINI_RECIPE, seed = 1337, preset = null } = {}) {
  const r = MINI_RECIPES[recipe] ?? MINI_RECIPES[DEFAULT_MINI_RECIPE];
  return normalizeMiniTerrainState({
    version: MINI_TERRAIN_VERSION,
    recipe: r.id,
    preset,
    seed,
    width: MINI_REFERENCE_WIDTH,
    quality: 'high',
    relief: 1,
    waterLevel: 0.5,
    vegetation: r.vegetation,
    propScale: 1,
    clouds: r.clouds,
    cloudSpread: 100,
    cloudShape: 'circle',
    cutStyle: r.cutStyle,
    shape: 'square',
    socle: true,
    backdrop: [0.91, 0.89, 0.86],
    camera: null,
  });
}

/**
 * Normalize/migrate a stored Mini section. Returns null for anything that is
 * not a Mini document so old projects (no section) keep their exact behaviour.
 */
export function normalizeMiniTerrainState(input) {
  if (!input || typeof input !== 'object') return null;
  const version = finite(input.version, 1);
  if (version > MINI_TERRAIN_VERSION) {
    // A newer document: keep the fields we understand, never discard it.
  }
  const recipe = MINI_RECIPES[input.recipe] ? input.recipe : DEFAULT_MINI_RECIPE;
  const r = MINI_RECIPES[recipe];
  const quality = MINI_QUALITY_PROFILES[input.quality] ? input.quality : 'high';
  const cutStyle = MINI_CUT_STYLES[input.cutStyle] ? input.cutStyle : r.cutStyle;
  const backdrop = Array.isArray(input.backdrop) && input.backdrop.length === 3
    ? input.backdrop.map((c) => clamp(finite(c, 0.9), 0, 1))
    : [0.91, 0.89, 0.86];
  const camera = normalizeMiniCamera(input.camera);
  return {
    version: MINI_TERRAIN_VERSION,
    recipe,
    // procedural base preset (null for composed recipes)
    preset: recipe === 'procedural'
      ? (PRESETS[input.preset] ? input.preset : DEFAULT_MINI_PRESET)
      : null,
    seed: finite(input.seed, 1337) >>> 0,
    width: clamp(Math.round(finite(input.width, MINI_REFERENCE_WIDTH)), MINI_WIDTH_LIMITS.min, MINI_WIDTH_LIMITS.max),
    quality,
    relief: clamp(finite(input.relief, 1), 0.4, 1.6),
    waterLevel: clamp(finite(input.waterLevel, 0.5), 0, 1),
    vegetation: clamp(finite(input.vegetation, r.vegetation), 0, 1),
    propScale: clamp(finite(input.propScale, 1), MINI_PROP_SCALE_LIMITS.min, MINI_PROP_SCALE_LIMITS.max),
    clouds: clamp(finite(input.clouds, r.clouds), 0, 1),
    // Older projects used a radius of width * 1.15 * 0.62.
    cloudSpread: clamp(finite(input.cloudSpread, 142.6), 10, 200),
    cloudShape: MINI_CLOUD_SHAPES.includes(input.cloudShape) ? input.cloudShape : 'circle',
    cutStyle,
    waterEdges: clamp(finite(input.waterEdges, 1), 0, 2),
    waterBevel: clamp(finite(input.waterBevel, 0), 0, 10),
    terrainBevel: clamp(finite(input.bevelSync === true ? input.waterBevel : input.terrainBevel, 0), 0, 10),
    bevelSync: input.bevelSync === true,
    bevelStyle: input.bevelStyle === 'rounded' ? 'rounded' : 'chamfer',
    shape: MINI_SHAPES.includes(input.shape) ? input.shape : 'square',
    socle: input.socle !== false,
    backdrop,
    camera,
  };
}

function normalizeMiniCamera(camera) {
  if (!camera || typeof camera !== 'object') return null;
  const views = Array.isArray(camera.views)
    ? camera.views.slice(0, 8).map(normalizeMiniView).filter(Boolean)
    : [];
  return { views };
}

export function normalizeMiniView(view) {
  if (!view || typeof view !== 'object') return null;
  const theta = finite(view.theta, NaN);
  const phi = finite(view.phi, NaN);
  const radius = finite(view.radius, NaN);
  if (![theta, phi, radius].every(Number.isFinite)) return null;
  const target = Array.isArray(view.target) && view.target.length === 3
    ? view.target.map((v) => finite(v, 0))
    : [0, 0, 0];
  return {
    name: String(view.name ?? 'View').slice(0, 40),
    theta, phi, radius, target,
  };
}

export function isMiniTerrainState(state) {
  return !!state && typeof state === 'object' && !!MINI_RECIPES[state.recipe];
}

// ---------------------------------------------------------------------------
// Derived layout
// ---------------------------------------------------------------------------

/**
 * Engine-unit layout derived from the footprint width. Every absolute size
 * the Mini presentation needs comes from here.
 */
export function resolveMiniLayout(state) {
  const s = normalizeMiniTerrainState(state) ?? createMiniTerrainState();
  const W = s.width;
  let heightScale;
  let reliefHeight;
  let formationSea;
  if (s.recipe === 'procedural') {
    // a regular preset, scaled to the footprint (and slightly exaggerated)
    const pp = PRESETS[s.preset]?.params ?? {};
    const factor = (W / 2048) * MINI_PROCEDURAL_RELIEF * s.relief;
    heightScale = Math.round((pp.heightScale ?? DEFAULT_PARAMS.heightScale) * factor);
    reliefHeight = heightScale * 0.5;
    formationSea = Math.round((pp.seaLevel ?? DEFAULT_PARAMS.seaLevel) * factor * 100) / 100;
  } else {
    heightScale = Math.round(W * MINI_HEIGHT_RATIO);
    reliefHeight = W * MINI_RELIEF_RATIO;
    formationSea = Math.round(MINI_FORMATION_SEA01 * reliefHeight * 100) / 100;
  }
  const seaLevel = Math.max(
    1,
    Math.round((formationSea + (s.waterLevel - 0.5) * 2 * MINI_WATER_SWING01 * reliefHeight) * 100) / 100,
  );
  const segments = MINI_QUALITY_PROFILES[s.quality].segments;
  // The section wall drops to this depth below y = 0; the socle sits under it.
  const baseDepth = Math.round(W * 0.07);
  const circle = s.shape === 'circle';
  return {
    width: W,
    half: W / 2,
    heightScale,
    reliefHeight,
    // relief units -> h01 of the engine height scale
    reliefToH01: reliefHeight / heightScale,
    formationSea,
    seaLevel,
    segments,
    baseDepth,
    shape: s.shape,
    hexagon: s.shape === 'hexagon',
    waterBevel: circle ? W / 2 : s.shape === 'hexagon' ? 0 : W * s.waterBevel / 100,
    terrainBevel: circle ? W / 2 : s.shape === 'hexagon' ? 0 : W * s.terrainBevel / 100,
    rounded: circle || (s.shape === 'square' && s.bevelStyle === 'rounded'),
    socleHeight: Math.round(W * 0.045),
    socleMargin: Math.round(W * 0.018),
    quadSize: W / segments,
  };
}

// ---------------------------------------------------------------------------
// Composition (shader uniforms)
// ---------------------------------------------------------------------------

/**
 * Seeded composition parameters for the analytic macro silhouette. The same
 * values feed the GLSL (uMini* uniforms) and its CPU twin, so rendering,
 * picking, shoreline and prop placement share one terrain.
 */
export function resolveMiniComposition(state) {
  const s = normalizeMiniTerrainState(state) ?? createMiniTerrainState();
  const r = MINI_RECIPES[s.recipe];
  const rand = makeRandom(deriveMiniSeeds(s.seed).relief);
  // Front direction: the opening faces the initial three-quarter camera
  // (azimuth ≈ 20° around +Z), with a bounded seeded swing.
  const baseAngle = 0.35;
  const angle = baseAngle + (rand() * 2 - 1) * r.jitter.angle;
  const dirX = Math.sin(angle);
  const dirZ = Math.cos(angle);
  const cx = (rand() * 2 - 1) * r.jitter.center;
  const cz = (rand() * 2 - 1) * r.jitter.center;
  const radiusScale = 1 + (rand() * 2 - 1) * r.jitter.radius;
  const phases = [rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2];
  const relief = s.relief;
  const k = resolveMiniLayout(s).reliefToH01;

  const [g0, g1, g2, g3] = r.geometry;
  const [hLand, hDepth, hBeach, hPeak] = r.heights;
  const [dLand, dSea, steps, terraceStrength] = r.detail;

  return {
    shape: r.shape,
    // (front dir x, front dir z, center x, center z) — centre in [-1,1] units,
    // pushed slightly AWAY from the front so the focal area stays framed.
    frame: [dirX, dirZ, cx - dirX * 0.12, cz - dirZ * 0.12],
    geometry: [g0 * radiusScale, g1, g2, g3],
    heights: [hLand * relief * k, hDepth * Math.sqrt(relief) * k, hBeach * k, hPeak * relief * k],
    wobble: [phases[0], phases[1], phases[2], r.wobble],
    detail: [dLand * relief * k, dSea * k, steps > 0 ? steps / k : 0, terraceStrength],
    cameraAzimuth: angle + 0.42,
  };
}

/** Uniform values for the composition (shape 0 = disabled). */
export function miniCompositionUniformValues(state) {
  if (!isMiniTerrainState(state)) {
    return { shape: 0, frame: [0, 1, 0, 0], geometry: [0, 0, 0, 0], heights: [0, 0, 0, 0], wobble: [0, 0, 0, 0], detail: [0, 0, 0, 0] };
  }
  const c = resolveMiniComposition(state);
  return { shape: c.shape, frame: c.frame, geometry: c.geometry, heights: c.heights, wobble: c.wobble, detail: c.detail };
}

// ---------------------------------------------------------------------------
// Params patch
// ---------------------------------------------------------------------------

// Water look shared by all recipes: clear, coloured, readable depth ramp,
// short moderate waves and thin foam. Backend (realistic/volumetric/cinematic)
// is chosen by the quality profile, never by the palette.
const MINI_WATER_LOOKS = Object.freeze({
  tropical: {
    waterOpacity: 0.5,
    waterRoughness: 0.22,
    waterSpecularStrength: 0.8,
    waterDepthColorStrength: 0.9,
    waterDepthOpacityStrength: 0.75,
    waterMaxVisibleDepth: 70,
    waterShallowDistance: 6,
    waterDeepDistance: 38,
    waterAbsorptionStrength: 0.7,
    waterNaturalColor: 0.85,
    waterBiomeColorStrength: 0.2,
    waterWaveScale: 1.6,
    waterWaveStrength: 0.55,
    waterSmallWaveStrength: 0.45,
    waterLargeWaveStrength: 0.4,
    waterNormalIntensity: 0.7,
    waterFoamStrength: 0.5,
    waterFoamWidth: 2.2,
    waterFresnelStrength: 1.0,
    waterRefractionStrength: 0.5,
    waterUnderwaterCaustics: 0.32,
  },
  lake: {
    waterOpacity: 0.62,
    waterRoughness: 0.32,
    waterSpecularStrength: 0.7,
    waterDepthColorStrength: 0.95,
    waterDepthOpacityStrength: 0.85,
    waterMaxVisibleDepth: 60,
    waterShallowDistance: 6,
    waterDeepDistance: 34,
    waterAbsorptionStrength: 0.85,
    waterNaturalColor: 0.75,
    waterBiomeColorStrength: 0.3,
    waterWaveScale: 1.8,
    waterWaveStrength: 0.4,
    waterSmallWaveStrength: 0.35,
    waterLargeWaveStrength: 0.3,
    waterNormalIntensity: 0.6,
    waterFoamStrength: 0.35,
    waterFoamWidth: 1.8,
    waterFresnelStrength: 1.0,
    waterRefractionStrength: 0.45,
    waterUnderwaterCaustics: 0.25,
  },
});

/**
 * Octave count that keeps the noise band-limited to the Mini surface mesh.
 * The legacy recipe's finest detail is its ridged layer (1.7× the base
 * frequency, × lacunarity per octave); octaves whose lattice cells are
 * narrower than ~3 surface quads cannot be represented by the vertices and
 * alias into needle spikes and wrinkled shading. Lower noise scales leave
 * room for more octaves.
 */
export function miniOctaveCap({ noiseScale, lacunarity }, segments) {
  const baseCells = Math.max(0.5, Number(noiseScale) || DEFAULT_PARAMS.noiseScale) * 0.1 * 1.7;
  const lac = Math.max(1.2, Number(lacunarity) || DEFAULT_PARAMS.lacunarity);
  const maxCells = Math.max(1, segments) / 3;
  return clamp(Math.floor(Math.log(maxCells / baseCells) / Math.log(lac)) + 1, 3, 8);
}

/**
 * Terrain shape of a diorama. A composed recipe tunes the detail noise; a
 * procedural diorama takes the complete preset (reset to defaults first, like
 * applyPreset), softened into a landscape model: rounded peaks, gentler
 * ridges, smoother falloff of detail and octaves band-limited to the mesh.
 */
function miniShapeParams(s, segments) {
  const r = MINI_RECIPES[s.recipe];
  let shape;
  if (s.recipe === 'procedural') {
    shape = {};
    for (const key of [
      'noiseScale', 'noiseStrength', 'terrainSmoothing', 'octaves', 'persistence', 'lacunarity',
      'ridge', 'warp', 'falloff', 'moistScale', 'moistBias', 'biomeScale', 'tempBias', 'snowLine',
      'normalStrength', 'aoStrength', 'aoRidge', 'rockSlopeLo', 'rockSlopeHi', 'snowSlopeMin', 'snowSlopeMax',
    ]) shape[key] = DEFAULT_PARAMS[key];
    const pp = { ...(PRESETS[s.preset]?.params ?? {}) };
    delete pp.heightScale;
    delete pp.seaLevel;
    Object.assign(shape, pp, { preset: s.preset, edgeFalloffMode: 'island' });
    shape.ridge = Math.round(shape.ridge * 0.62 * 1000) / 1000;
    shape.terrainSmoothing = Math.max(shape.terrainSmoothing, 0.6);
    shape.persistence = Math.min(shape.persistence, 0.46);
  } else {
    shape = {
      // detail noise: few large features across the footprint, moderate ridges
      noiseScale: 26,
      noiseStrength: 1.0,
      persistence: 0.46,
      lacunarity: 2.05,
      ridge: 0.4,
      warp: 0.7,
      terrainSmoothing: 0.3,
      falloff: 0,
      edgeFalloffMode: 'island',
      tempBias: r.climate.tempBias,
      moistBias: r.climate.moistBias,
      biomeScale: 0.6,
      snowLine: s.recipe === 'lake' ? 0.82 : 0.95,
    };
  }
  shape.octaves = Math.min(shape.octaves ?? 8, miniOctaveCap(shape, segments));
  return shape;
}

/**
 * Engine params that realise a Mini document. Applied when a Mini scene is
 * created, regenerated or its recipe changes. `scope` limits the patch:
 *   'all'       — new scene / recipe change (relief, water, clouds, props, look)
 *   'water'     — water level only (never touches the relief)
 *   'clouds'    — cloud amount only
 *   'props'     — vegetation only
 *   'propScale' — props size only
 *   'quality'   — terrain resolution profile + water backend
 *   'structure' — layout defaults (load enforces the footprint, fills missing params)
 *   'shape'     — terrain noise shaping (v2 → v3 migration)
 */
export function miniParamsPatch(state, scope = 'all') {
  const s = normalizeMiniTerrainState(state) ?? createMiniTerrainState();
  const r = MINI_RECIPES[s.recipe];
  const L = resolveMiniLayout(s);
  const seeds = deriveMiniSeeds(s.seed);
  const profile = MINI_QUALITY_PROFILES[s.quality];
  const W = L.width;

  const water = {
    seaLevel: L.seaLevel,
    waterEnabled: true,
  };
  const quality = {
    waterMode: profile.waterMode,
    waterQualityPreset: 'custom',
  };
  const landTop = s.recipe === 'procedural'
    ? L.heightScale * 0.75
    : L.formationSea + (r.heights[0] + r.heights[3]) * s.relief * L.reliefHeight;
  const clouds = {
    cloudsEnabled: s.clouds > 0.04,
    cloudCoverage: Math.round((0.18 + s.clouds * 0.42) * 1000) / 1000,
  };
  // Vegetation and rocks are regular props (Props panel, asset library),
  // densified for a diorama read: a wooded slope needs far more and larger
  // trees than an open-world meadow seen at walking height.
  const props = {
    propsEnabled: s.vegetation > 0.02,
    propsDensity: Math.round((0.6 + s.vegetation * 0.4) * 1000) / 1000,
    propsTreeDensity: Math.round((0.4 + s.vegetation * 1.6) * 1000) / 1000,
    propsGrassDensity: Math.round((0.3 + s.vegetation * 0.7) * 1000) / 1000,
    propsForest: Math.round(Math.min(1, s.vegetation * 1.1) * 1000) / 1000,
  };
  const propScale = {
    propsTreeScale: Math.round(MINI_TREE_SCALE * s.propScale * 1000) / 1000,
    propsRockScale: Math.round(MINI_ROCK_SCALE * s.propScale * 1000) / 1000,
    propsGrass: Math.round(s.propScale * 1000) / 1000,
  };
  // Defaults derived from the document. Load enforces the footprint but
  // preserves saved height and water edits from the shared settings panels.
  const structure = {
    chunkCount: 1,
    chunkSize: W,
    heightScale: L.heightScale,
    terrainFormationSeaLevel: L.formationSea,
    ...quality,
  };
  if (scope === 'water') return water;
  if (scope === 'clouds') return clouds;
  if (scope === 'props') return props;
  if (scope === 'propScale') return propScale;
  if (scope === 'quality') return quality;
  if (scope === 'structure') return structure;
  const shape = miniShapeParams(s, L.segments);
  if (scope === 'shape') return shape;

  return {
    seed: seeds.noise,
    propsSeed: seeds.props,
    ...structure,
    ...water,
    ...(MINI_WATER_LOOKS[r.water] ?? MINI_WATER_LOOKS.tropical),
    waterAnim: true,
    ...shape,
    // Studio presentation; sky and time of day remain editable after creation.
    ...MINI_VISUAL_PARAMS,
    skyboxEnabled: true,
    skyboxDayNightCycle: true,
    sunAzimuth: 128,
    sunElevation: 46,
    fogDensity: 0.02,
    aoStrength: 0.8,
    normalStrength: 1.15,
    // clouds sized from W: a few small formations above the composition
    ...clouds,
    cloudAltitude: Math.round(landTop + W * 0.12),
    cloudThickness: Math.round(W * 0.11),
    cloudScale: 3.4,
    cloudDetailScale: 9,
    cloudSoftness: 0.22,
    cloudMaxDistance: 2.5,
    cloudWindSpeed: 0.35,
    cloudEvolveSpeed: 0.6,
    cloudShadowsEnabled: true,
    cloudShadowOpacity: 0.3,
    // vegetation: distances from W so the whole diorama stays populated
    ...props,
    ...propScale,
    propsCullDistance: Math.round(W * 3.2),
    propsLodDistance: Math.round(W * 1.4),
  };
}

/**
 * Cloud slab placement centred on the diorama. Spread is the cloud diameter
 * (circle) or side (square) as a percentage of terrain width; 100% fits the
 * terrain footprint. Coverage extent stays fixed so narrowing clouds does not
 * change cull distance.
 */
export function resolveMiniCloudLayout(state) {
  const s = normalizeMiniTerrainState(state) ?? createMiniTerrainState();
  const L = resolveMiniLayout(s);
  return {
    extent: L.width * 1.15,
    radius: L.width * s.cloudSpread / 200,
    shape: s.cloudShape,
    center: { x: 0, z: 0 },
  };
}

// The footprint stays one board cell (chunkCount 1, chunkSize = width), but
// the board splits it into this many chunks per side so each picks its own
// geometry LOD from camera distance, like every other terrain.
export const MINI_CHUNKS_PER_SIDE = 4;

/**
 * Per-chunk LOD ladder (quads per chunk side, LOD 0..3). LOD0 keeps the
 * quality profile's full surface resolution; each level halves it (an exact
 * 2:1 ladder, so geomorphing hides the swaps).
 */
export function miniLodSegments(state) {
  const { segments } = resolveMiniLayout(state);
  const lod0 = Math.max(8, Math.round(segments / MINI_CHUNKS_PER_SIDE));
  return [lod0, lod0 / 2, lod0 / 4, lod0 / 8];
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

/**
 * Initial three-quarter framing: the whole diorama in view, low-distortion
 * perspective, pivot at the composition centre around sea level.
 */
export function resolveMiniFraming(state, { fov = 45, aspect = 16 / 9 } = {}) {
  const s = normalizeMiniTerrainState(state) ?? createMiniTerrainState();
  const L = resolveMiniLayout(s);
  const c = resolveMiniComposition(s);
  const phi = 58 * Math.PI / 180;            // from +Y → ~32° above horizon
  // Fit the footprint diagonal (+ socle) in the narrower FOV axis.
  const vFov = fov * Math.PI / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(0.5, aspect));
  const fitFov = Math.min(vFov, hFov);
  const extent = L.width * (s.shape === 'square' ? 0.76 : 0.6);
  const radius = Math.round((extent / Math.tan(fitFov / 2)) * 100) / 100;
  return {
    theta: c.cameraAzimuth,
    phi,
    radius,
    target: [0, L.seaLevel * 0.5, 0],
    minRadius: Math.round(L.width * 0.22),
    maxRadius: Math.round(L.width * 3.2),
    minPhi: 6 * Math.PI / 180,
    maxPhi: 86 * Math.PI / 180,
    panLimit: L.width * 0.45,
  };
}

// ---------------------------------------------------------------------------
// Presentation summary (diagnostics / UI)
// ---------------------------------------------------------------------------

export function describeMiniTerrain(state) {
  const s = normalizeMiniTerrainState(state);
  if (!s) return null;
  const L = resolveMiniLayout(s);
  const r = MINI_RECIPES[s.recipe];
  return {
    recipe: s.recipe,
    label: r.label,
    width: L.width,
    segments: L.segments,
    triangles: 2 * L.segments * L.segments,
    quality: s.quality,
  };
}
