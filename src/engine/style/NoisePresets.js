// ============================================================================
// Noise / terrain-shape style presets — patches on top of terrain defaults.
// Separate from color palette; controls height character only.
// ============================================================================

export const NOISE_PRESETS = {
  default: {
    label: 'Default',
    params: {},
  },
  smooth: {
    label: 'Smooth Rolling',
    params: {
      ridge: 0.18, warp: 0.6, persistence: 0.42, lacunarity: 2.0,
      noiseStrength: 0.85, falloff: 0.4,
    },
  },
  rugged: {
    label: 'Rugged Mountains',
    params: {
      ridge: 0.92, warp: 0.5, persistence: 0.55, lacunarity: 2.2,
      noiseStrength: 1.15, heightScale: 680,
    },
  },
  eroded: {
    label: 'Eroded Badlands',
    params: {
      ridge: 0.35, warp: 2.2, persistence: 0.48, lacunarity: 2.5,
      moistBias: -0.4, tempBias: 0.3,
    },
  },
  dunes: {
    label: 'Dune Fields',
    params: {
      ridge: 0.08, warp: 1.9, persistence: 0.38, noiseScale: 58,
      moistBias: -0.8, tempBias: 0.55, heightScale: 160,
    },
  },
  crystalline: {
    label: 'Crystalline Spires',
    params: {
      ridge: 0.78, warp: 1.4, persistence: 0.62, lacunarity: 2.8,
      noiseStrength: 1.2, octaves: 8,
    },
  },
  fractured: {
    label: 'Fractured Plates',
    params: {
      ridge: 0.65, warp: 2.8, persistence: 0.52, lacunarity: 2.6,
      noiseScale: 35, falloff: 0.25,
    },
  },
  alien: {
    label: 'Alien Terrain',
    params: {
      ridge: 0.55, warp: 2.0, persistence: 0.58, lacunarity: 2.7,
      noiseScale: 48, biomeScale: 1.4, moistBias: 0.1,
    },
  },

  cartoon: {
    label: 'Simple Cartoon',
    params: {
      ridge: 0.16, warp: 0.28, persistence: 0.36, lacunarity: 1.85,
      noiseStrength: 0.72, noiseScale: 72, octaves: 4, heightScale: 260,
      falloff: 0.35, biomeScale: 0.7, moistScale: 0.8, snowLine: 0.82,
      normalStrength: 0.8, aoStrength: 0.35,
    },
  },
  flat: {
    label: 'Low Relief',
    params: {
      ridge: 0.05, warp: 0.3, persistence: 0.35, noiseStrength: 0.6,
      heightScale: 120, falloff: 0.2,
    },
  },
};

export function getNoisePreset(key) {
  return NOISE_PRESETS[key] ?? NOISE_PRESETS.default;
}

export const NOISE_PRESET_KEYS = Object.keys(NOISE_PRESETS);
