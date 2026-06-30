// ============================================================================
// Per-panel reset helpers — restore each settings tab to engine defaults.
// ============================================================================

import { DEFAULT_PARAMS } from './presets.js';
import { EROSION_DEFAULT_PARAMS } from './terrain/erosion/ErosionPresets.js';
import { WATER_DEFAULT_PARAMS } from './water/WaterSettings.js';
import { CLOUD_DEFAULT_PARAMS } from './sky/CloudSettings.js';
import { SKYBOX_DEFAULT_PARAMS } from './sky/SkyboxSettings.js';
import { DEFAULT_PLANET_STYLE } from './style/PlanetStyleConfig.js';
import { EARTH_PALETTE } from './style/ColorPalette.js';

export const TERRAIN_RESET_KEYS = [
  'preset', 'heightScale', 'seaLevel', 'falloff', 'edgeFalloffMode',
  'noiseScale', 'noiseStrength', 'terrainSmoothing', 'octaves', 'persistence', 'lacunarity', 'ridge', 'warp',
  'noisePreset', 'normalStrength', 'aoStrength',
];

// Erosion now lives in the Terrain panel, so resetting Terrain settings also
// restores the erosion knobs (the baked delta itself is dropped separately).
export const EROSION_RESET_KEYS = Object.keys(EROSION_DEFAULT_PARAMS);

export const BIOME_RESET_KEYS = [
  'moistScale', 'moistBias', 'biomeScale', 'tempBias', 'snowLine', 'biomeDebug',
];

export const PROPS_RESET_KEYS = [
  'propsEnabled', 'propsDensity', 'propsFlowers', 'propsGrass', 'propsRocks', 'propsRockScale',
  'propsWind', 'propsWindSpeed', 'propsGust', 'propsCullDistance', 'propsLodDistance',
];

export const WORLD_RESET_KEYS = [
  'chunkCount', 'chunkSize', 'chunkGrid', 'planetRadius', 'planetFaceGrid',
];

export const LIGHTING_PARAM_KEYS = ['sunAzimuth', 'sunElevation', 'fogDensity'];

export const LIGHTING_STYLE_KEYS = ['sunColor', 'sunIntensity', 'skyAmbient', 'groundBounce'];

export const DEBUG_PARAM_KEYS = [
  'autoUpdate', 'wireframe', 'lodDebug', 'chunkGrid', 'biomeDebug',
  ...Object.keys(WATER_DEFAULT_PARAMS).filter((k) => k.startsWith('waterDebug') || k.startsWith('waterShow')),
];

export const WATER_COLOR_KEYS = ['deep', 'shallow', 'foam'];

export function patchParamsFromDefaults(params, keys, source = DEFAULT_PARAMS) {
  const next = { ...params };
  for (const key of keys) {
    if (key in source) next[key] = source[key];
  }
  return next;
}

export function resetWaterParams(params) {
  const next = patchParamsFromDefaults(params, Object.keys(WATER_DEFAULT_PARAMS), WATER_DEFAULT_PARAMS);
  next.waterAnim = DEFAULT_PARAMS.waterAnim;
  return next;
}

export function resetCloudParams(params) {
  return patchParamsFromDefaults(params, Object.keys(CLOUD_DEFAULT_PARAMS), CLOUD_DEFAULT_PARAMS);
}

export function resetSkyboxParams(params) {
  return patchParamsFromDefaults(params, Object.keys(SKYBOX_DEFAULT_PARAMS), SKYBOX_DEFAULT_PARAMS);
}

export function lightingStyleDefaults() {
  const out = {};
  for (const key of LIGHTING_STYLE_KEYS) {
    out[key] = Array.isArray(DEFAULT_PLANET_STYLE[key])
      ? [...DEFAULT_PLANET_STYLE[key]]
      : DEFAULT_PLANET_STYLE[key];
  }
  return out;
}

export function waterColorDefaults() {
  const out = {};
  for (const key of WATER_COLOR_KEYS) out[key] = [...EARTH_PALETTE[key]];
  return out;
}

export const DEFAULT_TIME_OF_DAY = 0.38;

export const DEFAULT_DEBUG_FLAGS = {
  freezeCulling: false,
  freezeLod: false,
  forceRender: false,
  disableHeightBake: false,
  terrainDetailDebug: 'off',
  mergeDebug: false,
};

export const DEFAULT_TILE_DEBUG = {
  view: 'off',
  showLegend: true,
  opacity: 1,
  showPreview: true,
};
