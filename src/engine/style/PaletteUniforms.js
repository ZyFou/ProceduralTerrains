import * as THREE from 'three';
import { PALETTE_KEYS } from './ColorPalette.js';

// ============================================================================
// Maps palette + style tuning into shared terrain/water shader uniforms.
// Color changes are live — no geometry rebuild required.
// ============================================================================

const UNIFORM_MAP = {
  deep: 'uColDeep',
  shallow: 'uColShallow',
  sand: 'uColSand',
  dune: 'uColDune',
  dryGrass: 'uColDryGrass',
  grass: 'uColGrass',
  forest: 'uColForest',
  jungle: 'uColJungle',
  swamp: 'uColSwamp',
  tundra: 'uColTundra',
  redRock: 'uColRedRock',
  redRock2: 'uColRedRock2',
  rock: 'uColRock',
  rockHi: 'uColRockHi',
  snow: 'uColSnow',
  foam: 'uColFoam',
};

export function createPaletteUniforms() {
  const u = {
    uPaletteSaturation: { value: 1.0 },
    uPaletteContrast:   { value: 1.0 },
    uPaletteTint:       { value: new THREE.Vector3(1, 1, 1) },
    uTerrainSunCol:     { value: new THREE.Vector3(1.0, 0.94, 0.82) },
    uTerrainSkyAmb:     { value: new THREE.Vector3(0.36, 0.46, 0.62) },
    uTerrainBounce:     { value: new THREE.Vector3(0.20, 0.16, 0.11) },
  };
  for (const key of PALETTE_KEYS) {
    u[UNIFORM_MAP[key]] = { value: new THREE.Vector3(0, 0, 0) };
  }
  return u;
}

export function applyPlanetStyleToUniforms(uniforms, planetStyle) {
  if (!uniforms || !planetStyle) return;

  const pal = planetStyle.palette;
  for (const key of PALETTE_KEYS) {
    const uni = UNIFORM_MAP[key];
    if (uniforms[uni] && pal[key]) {
      uniforms[uni].value.set(pal[key][0], pal[key][1], pal[key][2]);
    }
  }

  if (uniforms.uPaletteSaturation) uniforms.uPaletteSaturation.value = planetStyle.paletteSaturation ?? 1;
  if (uniforms.uPaletteContrast) uniforms.uPaletteContrast.value = planetStyle.paletteContrast ?? 1;
  if (uniforms.uPaletteTint && planetStyle.paletteTint) {
    uniforms.uPaletteTint.value.set(
      planetStyle.paletteTint[0],
      planetStyle.paletteTint[1],
      planetStyle.paletteTint[2]
    );
  }
  if (uniforms.uTerrainSunCol && planetStyle.sunColor) {
    uniforms.uTerrainSunCol.value.set(planetStyle.sunColor[0], planetStyle.sunColor[1], planetStyle.sunColor[2]);
  }
  if (uniforms.uTerrainSkyAmb && planetStyle.skyAmbient) {
    uniforms.uTerrainSkyAmb.value.set(planetStyle.skyAmbient[0], planetStyle.skyAmbient[1], planetStyle.skyAmbient[2]);
  }
  if (uniforms.uTerrainBounce && planetStyle.groundBounce) {
    uniforms.uTerrainBounce.value.set(
      planetStyle.groundBounce[0],
      planetStyle.groundBounce[1],
      planetStyle.groundBounce[2]
    );
  }
}
