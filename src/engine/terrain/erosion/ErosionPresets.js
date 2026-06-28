// ============================================================================
// Erosion presets + default params. These live in the engine `params` object
// (prefixed `erosion*`) so they serialize with saves, flow through onParam and
// reset like every other setting. The actual simulation knobs (erosionSim.js)
// are derived from these by Engine.bakeErosion.
// ============================================================================

// Quality → grid resolution. Higher = finer channels but slower bake.
export const EROSION_QUALITY = {
  preview:  { res: 192,  label: 'Preview' },
  balanced: { res: 256,  label: 'Balanced' },
  high:     { res: 384,  label: 'High' },
  ultra:    { res: 512,  label: 'Ultra' },
};

// Flat `params` keys (the UI binds to these). Tuned for the default board.
export const EROSION_DEFAULT_PARAMS = {
  erosionEnabled: false,        // apply the baked offset to the terrain
  erosionPreset: 'natural',
  erosionQuality: 'balanced',
  erosionSeed: 1,

  erosionStrength: 1.0,         // master blend of the eroded result (0..1)
  erosionDroplets: 60000,       // hydraulic droplet count
  erosionLifetime: 30,          // max steps per droplet
  erosionRadius: 3,             // erosion brush radius (cells)
  erosionDeposition: 0.3,       // deposition rate
  erosionErosionRate: 0.3,      // erosion rate
  erosionEvaporation: 0.02,     // water lost per step
  erosionGravity: 4.0,
  erosionInertia: 0.05,
  erosionSedimentCapacity: 4.0,

  erosionThermalStrength: 0.4,  // loose-material slide strength
  erosionThermalIterations: 30,
  erosionTalus: 0.6,            // talus angle factor (relative to cell size)
  erosionSmoothing: 0.1,        // final low-pass blend
};

// Each preset is a partial override of the simulation knobs (not enable/quality).
export const EROSION_PRESETS = {
  lite: {
    label: 'Lite',
    params: {
      erosionStrength: 0.5, erosionDroplets: 30000, erosionRadius: 2,
      erosionDeposition: 0.35, erosionErosionRate: 0.2, erosionEvaporation: 0.03,
      erosionThermalStrength: 0.25, erosionThermalIterations: 15, erosionTalus: 0.8,
      erosionSmoothing: 0.15,
    },
  },
  natural: {
    label: 'Natural',
    params: {
      erosionStrength: 1.0, erosionDroplets: 60000, erosionRadius: 3,
      erosionDeposition: 0.3, erosionErosionRate: 0.3, erosionEvaporation: 0.02,
      erosionThermalStrength: 0.4, erosionThermalIterations: 30, erosionTalus: 0.6,
      erosionSmoothing: 0.1,
    },
  },
  mountain: {
    label: 'Mountain',
    params: {
      erosionStrength: 1.0, erosionDroplets: 80000, erosionRadius: 3,
      erosionDeposition: 0.25, erosionErosionRate: 0.35, erosionEvaporation: 0.02,
      erosionThermalStrength: 0.7, erosionThermalIterations: 50, erosionTalus: 0.45,
      erosionSmoothing: 0.08,
    },
  },
  canyon: {
    label: 'Canyon',
    params: {
      erosionStrength: 1.0, erosionDroplets: 110000, erosionRadius: 2,
      erosionDeposition: 0.12, erosionErosionRate: 0.5, erosionEvaporation: 0.012,
      erosionSedimentCapacity: 6.0, erosionThermalStrength: 0.3,
      erosionThermalIterations: 25, erosionTalus: 0.9, erosionSmoothing: 0.05,
    },
  },
  heavyRain: {
    label: 'Heavy Rain',
    params: {
      erosionStrength: 1.0, erosionDroplets: 150000, erosionRadius: 3,
      erosionDeposition: 0.3, erosionErosionRate: 0.45, erosionEvaporation: 0.008,
      erosionSedimentCapacity: 5.0, erosionThermalStrength: 0.35,
      erosionThermalIterations: 30, erosionTalus: 0.6, erosionSmoothing: 0.12,
    },
  },
  dryThermal: {
    label: 'Dry Thermal',
    params: {
      erosionStrength: 1.0, erosionDroplets: 15000, erosionRadius: 2,
      erosionDeposition: 0.4, erosionErosionRate: 0.15, erosionEvaporation: 0.04,
      erosionThermalStrength: 0.9, erosionThermalIterations: 70, erosionTalus: 0.4,
      erosionSmoothing: 0.2,
    },
  },
  custom: { label: 'Custom', params: {} },
};

export function getErosionPreset(key) {
  return EROSION_PRESETS[key] || EROSION_PRESETS.natural;
}
