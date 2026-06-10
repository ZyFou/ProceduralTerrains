import { PALETTE_KEYS, clonePalette, EARTH_PALETTE } from './ColorPalette.js';

// ============================================================================
// Procedural palette generator — CPU-side only, deterministic from seed.
// ============================================================================

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0; let g = 0; let b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [r + m, g + m, b + m];
}

function vary(rgb, rng, amount = 0.08) {
  return rgb.map((v) => Math.max(0, Math.min(1, v + (rng() - 0.5) * amount)));
}

/**
 * Generate a coherent alien/realistic palette from a seed.
 * @param {number} seed
 * @param {'alien'|'earth'|'random'} styleHint
 */
export function generatePalette(seed = Date.now(), styleHint = 'random') {
  const rng = mulberry32(seed >>> 0);
  const styleRoll = styleHint === 'random' ? rng() : (styleHint === 'alien' ? 0.8 : 0.2);

  const baseHue = rng() * 360;
  const isAlien = styleRoll > 0.45;
  const sat = isAlien ? 0.45 + rng() * 0.45 : 0.25 + rng() * 0.35;
  const lit = 0.35 + rng() * 0.25;

  const hueOf = (offset, sMul = 1, lMul = 1) =>
    hslToRgb((baseHue + offset) % 360, Math.min(1, sat * sMul), Math.max(0.05, Math.min(0.92, lit * lMul)));

  const palette = clonePalette(EARTH_PALETTE);

  palette.deep = vary(hueOf(-30, 1.2, 0.35), rng, 0.04);
  palette.shallow = vary(hueOf(-15, 1.0, 0.55), rng, 0.05);
  palette.sand = vary(hueOf(25, 0.7, 1.15), rng, 0.06);
  palette.dune = vary(hueOf(30, 0.65, 1.2), rng, 0.05);
  palette.dryGrass = vary(hueOf(50, 0.8, 0.85), rng, 0.06);
  palette.grass = vary(hueOf(90, 1.0, 0.55), rng, 0.05);
  palette.forest = vary(hueOf(110, 1.1, 0.38), rng, 0.04);
  palette.jungle = vary(hueOf(115, 1.15, 0.32), rng, 0.04);
  palette.swamp = vary(hueOf(140, 0.9, 0.35), rng, 0.05);
  palette.tundra = vary(hueOf(200, 0.25, 0.78), rng, 0.04);
  palette.redRock = vary(hueOf(-50, 0.85, 0.48), rng, 0.05);
  palette.redRock2 = vary(hueOf(-40, 0.9, 0.58), rng, 0.05);
  palette.rock = vary(hueOf(0, 0.15, 0.38), rng, 0.04);
  palette.rockHi = vary(hueOf(5, 0.12, 0.52), rng, 0.04);
  palette.snow = vary(hueOf(210, 0.08, 0.92), rng, 0.03);
  palette.foam = vary(hueOf(200, 0.12, 0.90), rng, 0.03);

  // Ensure all keys present
  for (const k of PALETTE_KEYS) {
    if (!palette[k]) palette[k] = [...EARTH_PALETTE[k]];
  }

  return { palette, seed: seed >>> 0, alien: isAlien };
}

/** Randomize palette using terrain seed for reproducibility. */
export function generatePaletteFromTerrainSeed(terrainSeed) {
  const sub = ((terrainSeed >>> 0) * 2654435761) >>> 0;
  return generatePalette(sub, sub % 3 === 0 ? 'earth' : 'alien');
}
