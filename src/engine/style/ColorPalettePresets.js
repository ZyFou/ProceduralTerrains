import { clonePalette, parseColor } from './ColorPalette.js';
import { TERRAIN_GRADIENT_PRESETS } from '../terrain/graph/TerrainGradientPresets.js';

// ============================================================================
// Named color palettes — visual interpretation layer only; terrain shape unchanged.
// ============================================================================

function paletteFromHex(colors) {
  return Object.fromEntries(Object.entries(colors).map(([key, value]) => [key, parseColor(value)]));
}

function terrainPalette(nodePreset, colors) {
  const source = TERRAIN_GRADIENT_PRESETS[nodePreset];
  return Object.freeze({
    label: source.label,
    description: source.description,
    nodePreset,
    palette: paletteFromHex(colors),
  });
}

/**
 * Full biome adaptations of the four-stop palettes used by Node Terrain.
 * The node colors remain the visual anchors while water, beach, vegetation,
 * rock and snow receive material-specific shades for the procedural shader.
 */
export const TERRAIN_COLOR_PALETTE_PRESETS = Object.freeze({
  'terrain-alpine': terrainPalette('alpine', {
    deep: '#0b1b24', shallow: '#244c58', sand: '#776f5e', dune: '#887e69',
    dryGrass: '#6b725b', grass: '#59634e', forest: '#25362f', jungle: '#1c2c27',
    swamp: '#314842', tundra: '#766f62', redRock: '#695a4c', redRock2: '#877363',
    rock: '#766f62', rockHi: '#979186', snow: '#b7b0a2', foam: '#dce5e2',
  }),
  'terrain-temperate': terrainPalette('temperate', {
    deep: '#0c2027', shallow: '#315763', sand: '#80745a', dune: '#918466',
    dryGrass: '#596348', grass: '#40563b', forest: '#1e3128', jungle: '#172820',
    swamp: '#29433a', tundra: '#746b52', redRock: '#66523f', redRock2: '#806c52',
    rock: '#746b52', rockHi: '#918c7d', snow: '#aaa596', foam: '#d8e1dc',
  }),
  'terrain-arid': terrainPalette('arid', {
    deep: '#18303a', shallow: '#42616a', sand: '#a88b68', dune: '#c0aa8b',
    dryGrass: '#a18361', grass: '#927055', forest: '#6b5844', jungle: '#514a35',
    swamp: '#536054', tundra: '#9d826a', redRock: '#8a5841', redRock2: '#a46c4d',
    rock: '#8a5841', rockHi: '#a77d65', snow: '#c0aa8b', foam: '#e4ddd0',
  }),
  'terrain-volcanic': terrainPalette('volcanic', {
    deep: '#080b0d', shallow: '#202a2c', sand: '#44372f', dune: '#55443a',
    dryGrass: '#35352e', grass: '#2d302c', forest: '#171a18', jungle: '#101311',
    swamp: '#202521', tundra: '#55443a', redRock: '#744131', redRock2: '#98523a',
    rock: '#55443a', rockHi: '#6f685f', snow: '#928b7f', foam: '#c0b6a6',
  }),
  'terrain-coastal': terrainPalette('coastal', {
    deep: '#092735', shallow: '#276273', sand: '#afa37c', dune: '#c0b58e',
    dryGrass: '#647059', grass: '#4d6049', forest: '#34483e', jungle: '#263b32',
    swamp: '#34534c', tundra: '#74766c', redRock: '#6b6256', redRock2: '#83796c',
    rock: '#74766c', rockHi: '#92938a', snow: '#aaa99f', foam: '#e1e7e3',
  }),
  'terrain-river': terrainPalette('river', {
    deep: '#09292f', shallow: '#28636b', sand: '#81745a', dune: '#9a8966',
    dryGrass: '#687052', grass: '#536448', forest: '#183a38', jungle: '#12312f',
    swamp: '#183a38', tundra: '#81745a', redRock: '#6e5947', redRock2: '#88705a',
    rock: '#81745a', rockHi: '#8e8876', snow: '#9b9b91', foam: '#d5e2df',
  }),
  'terrain-canyon': terrainPalette('canyon', {
    deep: '#162c35', shallow: '#3d6670', sand: '#b98c5f', dune: '#c4a57f',
    dryGrass: '#8d704e', grass: '#76503c', forest: '#3a302b', jungle: '#2d2723',
    swamp: '#3d5147', tundra: '#a06d48', redRock: '#76503c', redRock2: '#a06d48',
    rock: '#a06d48', rockHi: '#ae8864', snow: '#c4a57f', foam: '#e5ded2',
  }),
  'terrain-dunes': terrainPalette('dunes', {
    deep: '#17323d', shallow: '#446a72', sand: '#c79a62', dune: '#e0c18e',
    dryGrass: '#b18859', grass: '#a47b50', forest: '#6a5541', jungle: '#514334',
    swamp: '#4b5a4d', tundra: '#b99163', redRock: '#8f5f3f', redRock2: '#b77849',
    rock: '#c79a62', rockHi: '#d2ad78', snow: '#e0c18e', foam: '#eee3ce',
  }),
});

export const TERRAIN_COLOR_PALETTE_OPTIONS = Object.freeze(Object.entries(TERRAIN_COLOR_PALETTE_PRESETS)
  .map(([value, preset]) => Object.freeze({ value, label: preset.label, nodePreset: preset.nodePreset })));

export const COLOR_PALETTE_PRESETS = {
  ...TERRAIN_COLOR_PALETTE_PRESETS,
  earth: {
    label: 'Earth',
    palette: clonePalette(),
  },
  desert: {
    label: 'Desert Planet',
    palette: {
      deep: [0.08, 0.05, 0.03], shallow: [0.35, 0.22, 0.12],
      sand: [0.82, 0.68, 0.38], dune: [0.90, 0.72, 0.40],
      dryGrass: [0.65, 0.48, 0.22], grass: [0.55, 0.42, 0.18],
      forest: [0.42, 0.32, 0.14], jungle: [0.38, 0.30, 0.12],
      swamp: [0.35, 0.28, 0.14], tundra: [0.72, 0.62, 0.42],
      redRock: [0.72, 0.38, 0.18], redRock2: [0.85, 0.50, 0.22],
      rock: [0.55, 0.42, 0.28], rockHi: [0.68, 0.55, 0.38],
      snow: [0.95, 0.90, 0.82], foam: [0.92, 0.85, 0.72],
    },
  },
  ice: {
    label: 'Ice Planet',
    palette: {
      deep: [0.02, 0.06, 0.14], shallow: [0.12, 0.35, 0.55],
      sand: [0.55, 0.62, 0.72], dune: [0.62, 0.70, 0.80],
      dryGrass: [0.45, 0.55, 0.65], grass: [0.35, 0.50, 0.62],
      forest: [0.22, 0.38, 0.48], jungle: [0.18, 0.32, 0.42],
      swamp: [0.15, 0.28, 0.38], tundra: [0.72, 0.78, 0.85],
      redRock: [0.45, 0.52, 0.62], redRock2: [0.58, 0.65, 0.75],
      rock: [0.38, 0.45, 0.55], rockHi: [0.55, 0.62, 0.72],
      snow: [0.92, 0.95, 0.98], foam: [0.88, 0.94, 0.98],
    },
  },
  toxic: {
    label: 'Toxic Alien',
    palette: {
      deep: [0.02, 0.10, 0.05], shallow: [0.08, 0.45, 0.22],
      sand: [0.35, 0.55, 0.18], dune: [0.42, 0.62, 0.22],
      dryGrass: [0.28, 0.48, 0.12], grass: [0.18, 0.55, 0.15],
      forest: [0.08, 0.42, 0.10], jungle: [0.05, 0.38, 0.08],
      swamp: [0.12, 0.35, 0.18], tundra: [0.25, 0.45, 0.28],
      redRock: [0.45, 0.55, 0.12], redRock2: [0.55, 0.65, 0.18],
      rock: [0.18, 0.28, 0.15], rockHi: [0.28, 0.38, 0.22],
      snow: [0.75, 0.92, 0.55], foam: [0.65, 0.95, 0.45],
    },
  },
  fungal: {
    label: 'Purple Fungal',
    palette: {
      deep: [0.06, 0.02, 0.12], shallow: [0.28, 0.12, 0.42],
      sand: [0.55, 0.35, 0.62], dune: [0.62, 0.42, 0.68],
      dryGrass: [0.42, 0.25, 0.48], grass: [0.32, 0.18, 0.42],
      forest: [0.22, 0.10, 0.32], jungle: [0.18, 0.08, 0.28],
      swamp: [0.25, 0.12, 0.35], tundra: [0.48, 0.38, 0.55],
      redRock: [0.58, 0.28, 0.52], redRock2: [0.68, 0.38, 0.58],
      rock: [0.32, 0.22, 0.38], rockHi: [0.45, 0.32, 0.48],
      snow: [0.85, 0.78, 0.92], foam: [0.82, 0.72, 0.95],
    },
  },
  canyon: {
    label: 'Red Canyon',
    palette: {
      deep: [0.08, 0.03, 0.02], shallow: [0.32, 0.12, 0.08],
      sand: [0.78, 0.45, 0.22], dune: [0.85, 0.52, 0.25],
      dryGrass: [0.62, 0.35, 0.18], grass: [0.48, 0.28, 0.14],
      forest: [0.35, 0.20, 0.10], jungle: [0.30, 0.18, 0.08],
      swamp: [0.28, 0.18, 0.12], tundra: [0.65, 0.42, 0.28],
      redRock: [0.82, 0.32, 0.15], redRock2: [0.92, 0.45, 0.18],
      rock: [0.55, 0.28, 0.15], rockHi: [0.72, 0.38, 0.20],
      snow: [0.92, 0.85, 0.78], foam: [0.90, 0.80, 0.72],
    },
  },
  volcanic: {
    label: 'Volcanic',
    palette: {
      deep: [0.02, 0.02, 0.03], shallow: [0.12, 0.08, 0.06],
      sand: [0.35, 0.22, 0.15], dune: [0.42, 0.28, 0.18],
      dryGrass: [0.28, 0.18, 0.12], grass: [0.22, 0.15, 0.10],
      forest: [0.15, 0.10, 0.08], jungle: [0.12, 0.08, 0.06],
      swamp: [0.10, 0.08, 0.06], tundra: [0.32, 0.25, 0.22],
      redRock: [0.55, 0.18, 0.08], redRock2: [0.72, 0.28, 0.10],
      rock: [0.18, 0.14, 0.12], rockHi: [0.28, 0.22, 0.20],
      snow: [0.55, 0.52, 0.50], foam: [0.85, 0.55, 0.25],
    },
  },
  tropical: {
    label: 'Tropical Ocean',
    palette: {
      deep: [0.01, 0.08, 0.18], shallow: [0.05, 0.42, 0.48],
      sand: [0.88, 0.82, 0.62], dune: [0.92, 0.85, 0.65],
      dryGrass: [0.45, 0.52, 0.22], grass: [0.15, 0.42, 0.18],
      forest: [0.05, 0.32, 0.12], jungle: [0.03, 0.28, 0.10],
      swamp: [0.08, 0.25, 0.12], tundra: [0.35, 0.48, 0.38],
      redRock: [0.52, 0.32, 0.22], redRock2: [0.62, 0.42, 0.28],
      rock: [0.32, 0.35, 0.28], rockHi: [0.45, 0.48, 0.38],
      snow: [0.95, 0.98, 0.95], foam: [0.90, 0.98, 0.95],
    },
  },

  cartoon: {
    label: 'Cartoon Terrain',
    palette: {
      deep: [0.02, 0.18, 0.55], shallow: [0.02, 0.55, 0.85],
      sand: [1.00, 0.86, 0.32], dune: [1.00, 0.68, 0.24],
      dryGrass: [0.78, 0.86, 0.20], grass: [0.18, 0.78, 0.18],
      forest: [0.02, 0.50, 0.16], jungle: [0.00, 0.40, 0.18],
      swamp: [0.10, 0.44, 0.26], tundra: [0.62, 0.86, 0.82],
      redRock: [0.90, 0.30, 0.18], redRock2: [1.00, 0.48, 0.22],
      rock: [0.44, 0.42, 0.48], rockHi: [0.64, 0.62, 0.70],
      snow: [0.98, 0.98, 0.92], foam: [1.00, 1.00, 0.92],
    },
  },
  neon: {
    label: 'Neon Sci-Fi',
    palette: {
      deep: [0.02, 0.00, 0.08], shallow: [0.10, 0.05, 0.45],
      sand: [0.55, 0.15, 0.65], dune: [0.62, 0.22, 0.72],
      dryGrass: [0.35, 0.12, 0.55], grass: [0.12, 0.55, 0.45],
      forest: [0.05, 0.35, 0.55], jungle: [0.05, 0.28, 0.48],
      swamp: [0.08, 0.22, 0.42], tundra: [0.35, 0.25, 0.55],
      redRock: [0.75, 0.12, 0.55], redRock2: [0.85, 0.22, 0.62],
      rock: [0.15, 0.12, 0.25], rockHi: [0.28, 0.22, 0.38],
      snow: [0.75, 0.85, 0.98], foam: [0.55, 0.95, 0.85],
    },
  },
  moon: {
    label: 'Barren Moon',
    palette: {
      deep: [0.04, 0.04, 0.05], shallow: [0.12, 0.12, 0.14],
      sand: [0.52, 0.50, 0.48], dune: [0.58, 0.56, 0.54],
      dryGrass: [0.45, 0.43, 0.41], grass: [0.40, 0.38, 0.36],
      forest: [0.35, 0.33, 0.31], jungle: [0.32, 0.30, 0.28],
      swamp: [0.28, 0.26, 0.24], tundra: [0.62, 0.60, 0.58],
      redRock: [0.48, 0.44, 0.40], redRock2: [0.55, 0.50, 0.45],
      rock: [0.32, 0.30, 0.28], rockHi: [0.45, 0.43, 0.41],
      snow: [0.88, 0.88, 0.90], foam: [0.85, 0.85, 0.88],
    },
  },
  methane: {
    label: 'Frozen Methane',
    palette: {
      deep: [0.02, 0.05, 0.12], shallow: [0.08, 0.22, 0.42],
      sand: [0.35, 0.55, 0.72], dune: [0.42, 0.62, 0.78],
      dryGrass: [0.28, 0.48, 0.65], grass: [0.22, 0.42, 0.58],
      forest: [0.15, 0.32, 0.48], jungle: [0.12, 0.28, 0.42],
      swamp: [0.10, 0.22, 0.35], tundra: [0.55, 0.68, 0.82],
      redRock: [0.32, 0.48, 0.62], redRock2: [0.42, 0.58, 0.72],
      rock: [0.22, 0.35, 0.48], rockHi: [0.35, 0.48, 0.62],
      snow: [0.82, 0.90, 0.95], foam: [0.78, 0.88, 0.95],
    },
  },
  rust: {
    label: 'Rust Planet',
    palette: {
      deep: [0.06, 0.02, 0.01], shallow: [0.28, 0.10, 0.05],
      sand: [0.72, 0.35, 0.15], dune: [0.78, 0.42, 0.18],
      dryGrass: [0.58, 0.28, 0.12], grass: [0.48, 0.22, 0.10],
      forest: [0.38, 0.18, 0.08], jungle: [0.32, 0.15, 0.06],
      swamp: [0.25, 0.12, 0.06], tundra: [0.62, 0.38, 0.22],
      redRock: [0.85, 0.28, 0.10], redRock2: [0.92, 0.38, 0.12],
      rock: [0.48, 0.22, 0.10], rockHi: [0.62, 0.32, 0.15],
      snow: [0.88, 0.72, 0.58], foam: [0.85, 0.65, 0.45],
    },
  },
  pastel: {
    label: 'Pastel Alien',
    palette: {
      deep: [0.55, 0.62, 0.78], shallow: [0.68, 0.75, 0.88],
      sand: [0.92, 0.82, 0.75], dune: [0.95, 0.85, 0.78],
      dryGrass: [0.85, 0.78, 0.72], grass: [0.72, 0.88, 0.75],
      forest: [0.62, 0.82, 0.72], jungle: [0.58, 0.78, 0.68],
      swamp: [0.65, 0.75, 0.82], tundra: [0.88, 0.85, 0.92],
      redRock: [0.92, 0.72, 0.78], redRock2: [0.95, 0.78, 0.82],
      rock: [0.78, 0.72, 0.75], rockHi: [0.85, 0.80, 0.82],
      snow: [0.98, 0.95, 0.98], foam: [0.95, 0.92, 0.98],
    },
  },
  monolith: {
    label: 'Monolith',
    palette: {
      deep: [0.10, 0.10, 0.11], shallow: [0.32, 0.32, 0.34],
      sand: [0.80, 0.79, 0.77], dune: [0.84, 0.83, 0.81],
      dryGrass: [0.72, 0.71, 0.69], grass: [0.68, 0.67, 0.65],
      forest: [0.62, 0.61, 0.59], jungle: [0.58, 0.57, 0.55],
      swamp: [0.55, 0.54, 0.52], tundra: [0.76, 0.75, 0.73],
      redRock: [0.64, 0.50, 0.35], redRock2: [0.74, 0.58, 0.41],
      rock: [0.58, 0.46, 0.33], rockHi: [0.78, 0.64, 0.46],
      snow: [0.87, 0.74, 0.56], foam: [0.88, 0.88, 0.87],
    },
  },
  obsidian: {
    label: 'Dark Obsidian',
    palette: {
      deep: [0.01, 0.01, 0.02], shallow: [0.05, 0.05, 0.08],
      sand: [0.12, 0.10, 0.12], dune: [0.15, 0.12, 0.15],
      dryGrass: [0.10, 0.08, 0.10], grass: [0.08, 0.06, 0.08],
      forest: [0.05, 0.04, 0.06], jungle: [0.04, 0.03, 0.05],
      swamp: [0.06, 0.05, 0.07], tundra: [0.18, 0.16, 0.18],
      redRock: [0.22, 0.08, 0.10], redRock2: [0.32, 0.12, 0.14],
      rock: [0.08, 0.07, 0.09], rockHi: [0.15, 0.14, 0.16],
      snow: [0.35, 0.32, 0.38], foam: [0.55, 0.45, 0.50],
    },
  },
  biolum: {
    label: 'Bioluminescent',
    palette: {
      deep: [0.01, 0.03, 0.08], shallow: [0.05, 0.15, 0.35],
      sand: [0.15, 0.35, 0.42], dune: [0.18, 0.42, 0.48],
      dryGrass: [0.10, 0.38, 0.35], grass: [0.05, 0.55, 0.42],
      forest: [0.02, 0.42, 0.35], jungle: [0.02, 0.38, 0.30],
      swamp: [0.05, 0.32, 0.38], tundra: [0.12, 0.35, 0.45],
      redRock: [0.35, 0.12, 0.55], redRock2: [0.45, 0.18, 0.62],
      rock: [0.08, 0.12, 0.18], rockHi: [0.12, 0.22, 0.28],
      snow: [0.55, 0.85, 0.78], foam: [0.45, 0.92, 0.75],
    },
  },
};

export function getPalettePreset(key) {
  return COLOR_PALETTE_PRESETS[key] ?? COLOR_PALETTE_PRESETS.earth;
}
