// ============================================================================
// Planet presets — combine palette, noise style, biome bias, and environment.
// User can customize everything after applying a preset.
// ============================================================================

export const PLANET_PRESETS = {
  earth: {
    label: 'Earth-like',
    palettePreset: 'earth',
    noisePreset: 'default',
    params: {},
    style: {
      paletteSaturation: 1.0,
      paletteContrast: 1.0,
      paletteTint: [1, 1, 1],
      sunColor: [1.0, 0.94, 0.82],
      skyAmbient: [0.36, 0.46, 0.62],
      groundBounce: [0.20, 0.16, 0.11],
      fogTint: null,
      skyTint: null,
    },
  },
  desert: {
    label: 'Desert Planet',
    palettePreset: 'desert',
    noisePreset: 'dunes',
    params: { moistBias: -0.75, tempBias: 0.65, snowLine: 1.0, seaLevel: 8 },
    style: {
      paletteSaturation: 1.1,
      sunColor: [1.0, 0.88, 0.65],
      skyAmbient: [0.45, 0.38, 0.28],
      fogTint: [0.55, 0.42, 0.28],
    },
  },
  ice: {
    label: 'Ice Planet',
    palettePreset: 'ice',
    noisePreset: 'smooth',
    params: { tempBias: -0.75, snowLine: 0.35, moistBias: 0.2, seaLevel: 55 },
    style: {
      paletteSaturation: 0.9,
      sunColor: [0.85, 0.92, 1.0],
      skyAmbient: [0.45, 0.55, 0.72],
      fogTint: [0.65, 0.75, 0.88],
    },
  },
  toxic: {
    label: 'Toxic Alien Planet',
    palettePreset: 'toxic',
    noisePreset: 'alien',
    params: { moistBias: 0.35, tempBias: 0.4, biomeScale: 1.5, seaLevel: 30 },
    style: {
      paletteSaturation: 1.35,
      paletteContrast: 1.1,
      sunColor: [0.75, 1.0, 0.55],
      skyAmbient: [0.25, 0.45, 0.22],
      fogTint: [0.15, 0.35, 0.12],
    },
  },
  fungal: {
    label: 'Purple Fungal Planet',
    palettePreset: 'fungal',
    noisePreset: 'eroded',
    params: { moistBias: 0.55, tempBias: 0.15, biomeScale: 1.2 },
    style: {
      paletteSaturation: 1.2,
      sunColor: [0.92, 0.75, 1.0],
      skyAmbient: [0.38, 0.28, 0.52],
      fogTint: [0.32, 0.18, 0.42],
    },
  },
  canyon: {
    label: 'Red Canyon Planet',
    palettePreset: 'canyon',
    noisePreset: 'eroded',
    params: { moistBias: -0.55, tempBias: 0.45, ridge: 0.55, warp: 2.4, seaLevel: 10 },
    style: {
      sunColor: [1.0, 0.82, 0.62],
      skyAmbient: [0.52, 0.32, 0.22],
      fogTint: [0.62, 0.28, 0.15],
    },
  },
  volcanic: {
    label: 'Volcanic Planet',
    palettePreset: 'volcanic',
    noisePreset: 'rugged',
    params: { ridge: 0.88, moistBias: -0.35, tempBias: 0.5, heightScale: 620 },
    style: {
      paletteContrast: 1.15,
      sunColor: [1.0, 0.65, 0.35],
      skyAmbient: [0.35, 0.22, 0.18],
      fogTint: [0.22, 0.12, 0.08],
    },
  },
  tropical: {
    label: 'Tropical Ocean Planet',
    palettePreset: 'tropical',
    noisePreset: 'smooth',
    params: { moistBias: 0.55, tempBias: 0.45, seaLevel: 65, falloff: 0.6 },
    style: {
      paletteSaturation: 1.15,
      sunColor: [1.0, 0.95, 0.78],
      skyAmbient: [0.32, 0.52, 0.62],
      fogTint: [0.25, 0.48, 0.55],
    },
  },

  cartoon: {
    label: 'Cartoon World',
    palettePreset: 'cartoon',
    noisePreset: 'cartoon',
    params: {
      heightScale: 260, seaLevel: 72, noiseScale: 72, noiseStrength: 0.72,
      octaves: 4, persistence: 0.36, lacunarity: 1.85, ridge: 0.16, warp: 0.28,
      falloff: 0.35, biomeScale: 0.7, moistScale: 0.8, snowLine: 0.82,
      normalStrength: 0.8, aoStrength: 0.35,
      chunkSize: 64, planetFaceGrid: 6,
      waterMode: 'legacy', waterQualityPreset: 'cartoon',
      waterOpacity: 0.78, waterFresnelStrength: 1.35, waterSpecularStrength: 0.85,
      waterWaveScale: 1.65, waterWaveStrength: 0.34, waterSmallWaveStrength: 0.18,
      waterLargeWaveStrength: 0.28, waterNormalIntensity: 0.45,
      waterFoamEnabled: true, waterFoamStrength: 1.15, waterFoamWidth: 5.6,
      waterFoamSoftness: 0.35, waterFoamAnimSpeed: 0.55,
    },
    perf: {
      terrainDetailScale: 0.08,
      terrainDetailStrength: 0.3,
      terrainDetailNormal: 0.35,
      terrainMicroDetail: 0.15,
      terrainMacroVariation: 0.25,
      waterQuality: 0,
      waterReflection: 0.55,
      waterDetail: 0.35,
      waterWaves: 0.35,
    },
    style: {
      paletteSaturation: 1.35,
      paletteContrast: 1.22,
      sunColor: [1.0, 0.96, 0.74],
      skyAmbient: [0.42, 0.58, 0.78],
      groundBounce: [0.24, 0.20, 0.12],
      fogTint: [0.48, 0.66, 0.88],
      skyTint: [0.40, 0.66, 1.0],
    },
  },
  neon: {
    label: 'Neon Sci-Fi Planet',
    palettePreset: 'neon',
    noisePreset: 'crystalline',
    params: { ridge: 0.72, warp: 1.6, biomeScale: 1.3 },
    style: {
      paletteSaturation: 1.5,
      paletteContrast: 1.2,
      sunColor: [0.55, 0.85, 1.0],
      skyAmbient: [0.22, 0.35, 0.65],
      fogTint: [0.12, 0.18, 0.42],
    },
  },
  moon: {
    label: 'Barren Moon',
    palettePreset: 'moon',
    noisePreset: 'flat',
    params: { moistBias: -0.9, tempBias: -0.5, snowLine: 0.55, seaLevel: 0, heightScale: 180 },
    style: {
      paletteSaturation: 0.35,
      paletteContrast: 0.95,
      sunColor: [0.95, 0.95, 0.98],
      skyAmbient: [0.28, 0.30, 0.35],
      fogTint: [0.25, 0.26, 0.30],
    },
  },
  methane: {
    label: 'Frozen Methane World',
    palettePreset: 'methane',
    noisePreset: 'smooth',
    params: { tempBias: -0.85, snowLine: 0.25, moistBias: 0.1, seaLevel: 40 },
    style: {
      paletteSaturation: 1.05,
      sunColor: [0.72, 0.88, 1.0],
      skyAmbient: [0.35, 0.48, 0.68],
      fogTint: [0.42, 0.58, 0.78],
    },
  },
  rust: {
    label: 'Rust Planet',
    palettePreset: 'rust',
    noisePreset: 'fractured',
    params: { moistBias: -0.6, tempBias: 0.35, ridge: 0.6, warp: 2.0 },
    style: {
      paletteSaturation: 1.1,
      sunColor: [1.0, 0.72, 0.45],
      skyAmbient: [0.48, 0.28, 0.18],
      fogTint: [0.55, 0.28, 0.12],
    },
  },
  pastel: {
    label: 'Pastel Alien World',
    palettePreset: 'pastel',
    noisePreset: 'smooth',
    params: { moistBias: 0.2, biomeScale: 0.8, heightScale: 280 },
    style: {
      paletteSaturation: 0.75,
      paletteContrast: 0.85,
      sunColor: [1.0, 0.92, 0.95],
      skyAmbient: [0.72, 0.68, 0.82],
      fogTint: [0.82, 0.78, 0.90],
    },
  },
  obsidian: {
    label: 'Dark Obsidian Planet',
    palettePreset: 'obsidian',
    noisePreset: 'crystalline',
    params: { ridge: 0.82, moistBias: -0.5, tempBias: 0.2, heightScale: 500 },
    style: {
      paletteSaturation: 0.6,
      paletteContrast: 1.25,
      sunColor: [0.85, 0.55, 0.65],
      skyAmbient: [0.15, 0.12, 0.18],
      fogTint: [0.08, 0.06, 0.10],
    },
  },
  biolum: {
    label: 'Bioluminescent World',
    palettePreset: 'biolum',
    noisePreset: 'alien',
    params: { moistBias: 0.45, tempBias: 0.1, biomeScale: 1.35, seaLevel: 35 },
    style: {
      paletteSaturation: 1.4,
      paletteContrast: 1.1,
      sunColor: [0.45, 0.92, 0.75],
      skyAmbient: [0.12, 0.35, 0.42],
      groundBounce: [0.08, 0.25, 0.22],
      fogTint: [0.05, 0.22, 0.28],
    },
  },
};

export function getPlanetPreset(key) {
  return PLANET_PRESETS[key] ?? PLANET_PRESETS.earth;
}

export const PLANET_PRESET_KEYS = Object.keys(PLANET_PRESETS);
