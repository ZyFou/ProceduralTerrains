// ============================================================================
// Biome color palette — linear RGB slots mapped to terrain shader uniforms.
// Same terrain shape can be recolored by swapping this palette live.
// ============================================================================

export const PALETTE_KEYS = [
  'deep', 'shallow', 'sand', 'dune', 'dryGrass', 'grass', 'forest', 'jungle',
  'swamp', 'tundra', 'redRock', 'redRock2', 'rock', 'rockHi', 'snow', 'foam',
];

/** Default Earth-like palette (matches original hardcoded shader constants). */
export const EARTH_PALETTE = {
  deep:      [0.012, 0.075, 0.140],
  shallow:   [0.060, 0.290, 0.330],
  sand:      [0.560, 0.470, 0.300],
  dune:      [0.620, 0.490, 0.290],
  dryGrass:  [0.380, 0.330, 0.150],
  grass:     [0.130, 0.260, 0.085],
  forest:    [0.052, 0.140, 0.055],
  jungle:    [0.035, 0.125, 0.045],
  swamp:     [0.090, 0.130, 0.070],
  tundra:    [0.300, 0.290, 0.240],
  redRock:   [0.420, 0.235, 0.140],
  redRock2:  [0.560, 0.370, 0.210],
  rock:      [0.260, 0.235, 0.215],
  rockHi:    [0.380, 0.365, 0.355],
  snow:      [0.870, 0.890, 0.930],
  foam:      [0.820, 0.900, 0.940],
};

export function clonePalette(src = EARTH_PALETTE) {
  const out = {};
  for (const k of PALETTE_KEYS) out[k] = [...src[k]];
  return out;
}

export function palettesEqual(a, b) {
  if (!a || !b) return false;
  return PALETTE_KEYS.every((k) =>
    Math.abs(a[k][0] - b[k][0]) < 1e-4
    && Math.abs(a[k][1] - b[k][1]) < 1e-4
    && Math.abs(a[k][2] - b[k][2]) < 1e-4
  );
}

/** Convert #rrggbb or [r,g,b] 0-255 to linear 0-1 RGB triple. */
export function parseColor(input) {
  if (Array.isArray(input)) {
    const scale = input.some((v) => v > 1) ? 1 / 255 : 1;
    return input.map((v) => Math.max(0, Math.min(1, v * scale)));
  }
  const hex = String(input).replace('#', '');
  if (hex.length !== 6) return [1, 1, 1];
  return [
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  ];
}

export function colorToHex(rgb) {
  const c = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${c(rgb[0])}${c(rgb[1])}${c(rgb[2])}`;
}
