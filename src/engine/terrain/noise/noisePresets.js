// ============================================================================
// Built-in Noise Stack presets. Each is just a NoiseStack the user can apply
// and then freely edit — NOT a locked terrain style. The default (Classic
// Terrain) lives in NoiseStack.defaultLegacyStack().
// ============================================================================

import { makeStack, makeLayer } from './NoiseStack.js';

const L = (type, over) => makeLayer(type, over);

export const NOISE_STACK_PRESETS = {
  classic: {
    label: 'Classic Terrain',
    build: () => makeStack([L('legacy', { name: 'Classic Terrain', blendMode: 'replace' })]),
  },
  rollingHills: {
    label: 'Rolling Hills',
    build: () => makeStack([
      L('fbm', { name: 'Base', blendMode: 'add', strength: 0.5, params: { scale: 1.0, octaves: 4, persistence: 0.5 } }),
      L('billow', { name: 'Soft Hills', blendMode: 'add', strength: 0.25, params: { scale: 2.2, octaves: 3 } }),
      L('fbm', { name: 'Detail', blendMode: 'add', strength: 0.06, params: { scale: 6.0, octaves: 3 } }),
    ]),
  },
  sharpMountains: {
    label: 'Sharp Mountains',
    build: () => makeStack([
      L('fbm', { name: 'Continents', blendMode: 'add', strength: 0.45, params: { scale: 0.6, octaves: 4 } }),
      L('domainWarp', { name: 'Breakup Warp', blendMode: 'add', strength: 0.6, params: { scale: 1.2 } }),
      L('ridged', { name: 'Mountain Ridges', blendMode: 'add', strength: 0.9, params: { scale: 2.4, octaves: 5, sharpness: 2.5 } }),
      L('fbm', { name: 'Small Details', blendMode: 'add', strength: 0.05, params: { scale: 8.0, octaves: 3 } }),
    ]),
  },
  canyonTerraces: {
    label: 'Canyon Terraces',
    build: () => makeStack([
      L('fbm', { name: 'Base', blendMode: 'add', strength: 0.5, params: { scale: 0.8, octaves: 4 } }),
      L('ridged', { name: 'Mesa Edges', blendMode: 'add', strength: 0.35, params: { scale: 2.0, octaves: 4, sharpness: 3.0 } }),
      L('terrace', { name: 'Strata', blendMode: 'replace', strength: 0.9, params: { count: 14, smoothness: 0.35 } }),
    ]),
  },
  desertDunes: {
    label: 'Desert Dunes',
    build: () => makeStack([
      L('fbm', { name: 'Base', blendMode: 'add', strength: 0.3, params: { scale: 0.6, octaves: 3 } }),
      L('dune', { name: 'Dunes', blendMode: 'add', strength: 0.35, params: { scale: 1.4 } }),
      L('white', { name: 'Grain', blendMode: 'add', strength: 0.02, params: { scale: 10.0 } }),
    ]),
  },
  moonCraters: {
    label: 'Moon Craters',
    build: () => makeStack([
      L('fbm', { name: 'Regolith', blendMode: 'add', strength: 0.25, params: { scale: 1.2, octaves: 4 } }),
      L('crater', { name: 'Large Craters', blendMode: 'add', strength: 0.7, params: { scale: 1.0, density: 0.5, depth: 0.7, rim: 0.35 } }),
      L('crater', { name: 'Small Craters', blendMode: 'add', strength: 0.35, params: { scale: 3.5, density: 0.4, depth: 0.4, rim: 0.2 } }),
    ]),
  },
  alienCellular: {
    label: 'Alien Cellular',
    build: () => makeStack([
      L('fbm', { name: 'Base', blendMode: 'add', strength: 0.3, params: { scale: 0.8, octaves: 3 } }),
      L('voronoi', { name: 'Plates', blendMode: 'add', strength: 0.5, params: { scale: 1.8, jitter: 1.0, outputMode: 3 } }),
      L('domainWarp', { name: 'Twist', blendMode: 'add', strength: 0.8, params: { scale: 1.5 } }),
    ]),
  },
  islandContinents: {
    label: 'Island Continents',
    build: () => makeStack([
      L('fbm', { name: 'Continents', blendMode: 'add', strength: 0.7, params: { scale: 0.4, octaves: 5 } }),
      L('billow', { name: 'Coastal Hills', blendMode: 'add', strength: 0.15, params: { scale: 2.0, octaves: 3 } }),
      L('fbm', { name: 'Detail', blendMode: 'add', strength: 0.05, params: { scale: 7.0, octaves: 3 } }),
    ]),
  },
  erodedValleys: {
    label: 'Eroded Valleys',
    build: () => makeStack([
      L('ridged', { name: 'Highlands', blendMode: 'add', strength: 0.7, params: { scale: 1.4, octaves: 5, sharpness: 1.8 } }),
      L('flow', { name: 'River Carving', blendMode: 'subtract', strength: 0.4, params: { scale: 0.8 } }),
      L('fbm', { name: 'Detail', blendMode: 'add', strength: 0.06, params: { scale: 8.0, octaves: 3 } }),
    ]),
  },

  // --- Realistic presets: eroded fractals + self warp + normalized output ---
  // (slope/noise masks confine detail layers where they belong; all values are
  // ordinary layer params, so users can keep editing the stack freely).
  geologicalHybrid: {
    label: 'Geological Hybrid',
    // These global controls complete the recipe. They are intentionally kept
    // beside the stack so applying the preset from the UI produces the tuned
    // landform rather than only replacing its layer list. Existing presets do
    // not declare terrainParams and therefore retain their old stack-only
    // behavior.
    terrainParams: {
      heightScale: 620,
      noiseScale: 42,
      noiseStrength: 1.0,
      terrainSmoothing: 0.0,
      normalStrength: 1.4,
      aoStrength: 0.88,
      aoRidge: 0.28,
      rockSlopeLo: 0.34,
      rockSlopeHi: 0.64,
      snowSlopeMin: 0.24,
      snowSlopeMax: 0.56,
      snowLine: 0.76,
    },
    build: () => makeStack([
      // The Lab warps the shared domain before evaluating every height band.
      L('domainWarp', { name: 'Geological Warp', blendMode: 'add', strength: 0.62,
        params: { scale: 0.58, octaves: 4 } }),
      // Low-frequency body. A small amount of derivative erosion and self-warp
      // keeps the mass organic without destroying the broad silhouette.
      L('fbm', { name: 'Terraced Massif', blendMode: 'add', strength: 0.68,
        params: { scale: 0.55, octaves: 6, persistence: 0.51, lacunarity: 2.03, erosion: 0.12, warp: 0.18 } }),
      // Partial seven-step terracing mirrors the Lab showcase: readable strata
      // with ramps instead of uniformly vertical staircase walls.
      L('terrace', { name: 'Weathered Terraces', blendMode: 'replace', strength: 0.68,
        params: { count: 7, smoothness: 0.34 } }),
      // Main weathering band. The shader multiplies erosion by four, so 0.62 is
      // close to the Lab's derivative-weathering coefficient of 2.45.
      L('fbm', { name: 'Derivative Weathering', blendMode: 'add', strength: 0.20,
        params: { scale: 0.72, octaves: 6, persistence: 0.51, lacunarity: 2.03, erosion: 0.62, warp: 0.25 } }),
      L('ridged', { name: 'Rock Ridges', blendMode: 'add', strength: 0.12,
        params: { scale: 1.70, octaves: 6, persistence: 0.51, lacunarity: 2.03, sharpness: 2.25, erosion: 0.28, warp: 0.20 } }),
      L('fbm', { name: 'Fine Geological Detail', blendMode: 'add', strength: 0.05,
        params: { scale: 2.90, octaves: 4, persistence: 0.48, lacunarity: 2.08, erosion: 0.16, warp: 0.0 } }),
    ], { normalizeOutput: true, outputMin: 0.05, outputMax: 0.92 }),
  },
  alpineRanges: {
    label: 'Alpine Ranges',
    build: () => makeStack([
      L('fbm', { name: 'Massif Base', blendMode: 'add', strength: 0.42,
        params: { scale: 0.55, octaves: 4, persistence: 0.5, erosion: 0.25, warp: 0.45 } }),
      L('domainWarp', { name: 'Range Bend', blendMode: 'add', strength: 0.7, params: { scale: 0.9, octaves: 3 } }),
      L('ridged', { name: 'Eroded Ridges', blendMode: 'add', strength: 0.85,
        params: { scale: 2.0, octaves: 6, sharpness: 2.2, erosion: 0.55, warp: 0.40 } }),
      L('fbm', { name: 'Scree Detail', blendMode: 'add', strength: 0.07,
        params: { scale: 7.0, octaves: 3, erosion: 0.2, warp: 0.0 },
        masks: [{ type: 'slope', enabled: true, invert: false, params: { min: 0.18, max: 1.0, falloff: 0.12 } }] }),
    ], { normalizeOutput: true, outputMin: 0.0, outputMax: 1.15 }),
  },
  graniteSpires: {
    label: 'Granite Spires',
    build: () => makeStack([
      L('fbm', { name: 'Valley Floor', blendMode: 'add', strength: 0.28,
        params: { scale: 0.7, octaves: 4, persistence: 0.48, erosion: 0.3, warp: 0.3 } }),
      L('ridged', { name: 'Spire Clusters', blendMode: 'add', strength: 1.05,
        params: { scale: 2.6, octaves: 6, sharpness: 3.4, erosion: 0.3, warp: 0.65 },
        masks: [{ type: 'noise', enabled: true, invert: false, params: { scale: 0.5, threshold: 0.58, softness: 0.14 } }] }),
      L('fbm', { name: 'Talus & Scree', blendMode: 'add', strength: 0.09,
        params: { scale: 6.0, octaves: 3, erosion: 0.15, warp: 0.0 },
        masks: [{ type: 'slope', enabled: true, invert: false, params: { min: 0.22, max: 1.0, falloff: 0.10 } }] }),
    ], { normalizeOutput: true, outputMin: 0.0, outputMax: 1.25 }),
  },
  foothillRanges: {
    label: 'Foothill Ranges',
    build: () => makeStack([
      L('fbm', { name: 'Rolling Base', blendMode: 'add', strength: 0.45,
        params: { scale: 1.1, octaves: 5, persistence: 0.47, erosion: 0.35, warp: 0.35 } }),
      L('domainWarp', { name: 'Flow Warp', blendMode: 'add', strength: 0.5, params: { scale: 1.1, octaves: 3 } }),
      L('ridged', { name: 'Mountain Belts', blendMode: 'add', strength: 0.55,
        params: { scale: 1.6, octaves: 5, sharpness: 1.9, erosion: 0.5, warp: 0.30 },
        masks: [{ type: 'noise', enabled: true, invert: false, params: { scale: 0.35, threshold: 0.55, softness: 0.20 } }] }),
      L('fbm', { name: 'Soft Detail', blendMode: 'add', strength: 0.05,
        params: { scale: 8.0, octaves: 3, erosion: 0.1, warp: 0.0 } }),
    ], { normalizeOutput: true, outputMin: 0.0, outputMax: 1.05 }),
  },
};

export const NOISE_STACK_PRESET_KEYS = Object.keys(NOISE_STACK_PRESETS);

export function buildNoiseStackPreset(key) {
  const p = NOISE_STACK_PRESETS[key];
  return p ? p.build() : null;
}

/**
 * Build the complete user-facing recipe for a stack preset. Most historical
 * presets are stack-only; realism presets may additionally provide a small
 * global terrain patch needed to reproduce their authored proportions.
 */
export function buildNoiseStackPresetRecipe(key) {
  const preset = NOISE_STACK_PRESETS[key];
  if (!preset) return null;
  return {
    stack: preset.build(),
    terrainParams: { ...(preset.terrainParams || {}) },
  };
}
