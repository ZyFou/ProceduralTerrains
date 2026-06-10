// ============================================================================
// Default parameter set + terrain presets. A preset is just a parameter
// patch on top of the defaults — nothing is hardcoded into the shader.
// ============================================================================

export const DEFAULT_PARAMS = {
  seed: 1337,
  preset: 'highlands',

  // height
  heightScale: 560,        // world units (displayed as m)
  seaLevel: 42,

  // noise stack
  noiseScale: 45,          // feature scale (bigger = more features across board)
  noiseStrength: 1.0,
  octaves: 7,
  persistence: 0.5,
  lacunarity: 2.05,
  ridge: 0.65,             // ridged mountain intensity
  warp: 0.9,               // domain warp strength
  falloff: 0.5,            // island edge falloff

  // biome
  moistScale: 1.0,
  moistBias: 0.0,
  biomeScale: 1.0,         // climate region frequency (higher = smaller regions)
  tempBias: 0.0,           // global temperature shift (-1 polar .. +1 hot)
  biomeDebug: false,       // visualize biome regions as flat colors
  snowLine: 0.7,

  // render
  normalStrength: 1.25,
  aoStrength: 0.75,
  chunkGrid: false,

  // world (rebuild required)
  chunkCount: 16,
  chunkSize: 128,

  wireframe: false,
  lodDebug: false,
  autoUpdate: true,

  // project settings
  sunAzimuth: 135,
  sunElevation: 42,
  fogDensity: 0.45,
  waterAnim: true,
  pixelRatio: 0,           // 0 = auto (device)

  // planet style (color layer — live shader updates, no rebuild)
  planetPreset: 'earth',
  palettePreset: 'earth',
  noisePreset: 'default',
};

export const PRESETS = {
  highlands: {
    label: 'Highlands',
    params: {},            // = defaults
  },
  archipelago: {
    label: 'Archipelago',
    params: {
      heightScale: 260, seaLevel: 78, falloff: 0.75, ridge: 0.45,
      warp: 1.4, noiseScale: 60, moistBias: 0.25, snowLine: 0.9,
      tempBias: 0.25,
    },
  },
  alpine: {
    label: 'Alpine Peaks',
    params: {
      heightScale: 640, seaLevel: 24, ridge: 0.92, warp: 0.6,
      noiseScale: 38, persistence: 0.52, snowLine: 0.48, moistBias: -0.1,
      tempBias: -0.3,
    },
  },
  dunes: {
    label: 'Desert Dunes',
    params: {
      heightScale: 180, seaLevel: 4, ridge: 0.12, warp: 1.8,
      noiseScale: 55, persistence: 0.42, moistBias: -0.75, snowLine: 1.0,
      falloff: 0.35, tempBias: 0.6,
    },
  },
  rolling: {
    label: 'Rolling Hills',
    params: {
      heightScale: 220, seaLevel: 30, ridge: 0.22, warp: 1.1,
      noiseScale: 50, persistence: 0.46, moistBias: 0.3, snowLine: 1.0,
    },
  },
  volcanic: {
    label: 'Volcanic Island',
    params: {
      heightScale: 560, seaLevel: 58, ridge: 0.85, warp: 0.8,
      noiseScale: 30, falloff: 0.85, moistBias: -0.2, snowLine: 0.62,
    },
  },
  canyon: {
    label: 'Canyonlands',
    params: {
      heightScale: 380, seaLevel: 12, ridge: 0.55, warp: 2.4,
      noiseScale: 42, persistence: 0.58, lacunarity: 2.4,
      moistBias: -0.5, snowLine: 1.0, falloff: 0.3, tempBias: 0.35,
    },
  },
};

export function applyPreset(params, presetKey) {
  const preset = PRESETS[presetKey];
  if (!preset) return params;
  const next = { ...params };
  // reset preset-controlled keys to defaults first so presets are absolute
  for (const key of [
    'heightScale', 'seaLevel', 'noiseScale', 'noiseStrength', 'octaves',
    'persistence', 'lacunarity', 'ridge', 'warp', 'falloff',
    'moistScale', 'moistBias', 'biomeScale', 'tempBias', 'snowLine',
  ]) next[key] = DEFAULT_PARAMS[key];
  Object.assign(next, preset.params);
  next.preset = presetKey;
  return next;
}
