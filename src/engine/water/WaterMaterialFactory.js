import { createWaterMaterial, createInfiniteWaterMaterial } from '../terrain/WaterMaterial.js';
import { createPlanetWaterMaterial } from '../terrain/PlanetMaterial.js';
import {
  createRealisticWaterMaterial,
  createInfiniteRealisticWaterMaterial,
  applyRealisticWaterUniforms,
  setWaterDebugMode,
} from './RealisticWaterMaterial.js';
import { isRealisticWaterMode } from './WaterSettings.js';
import { applyWaterLightingUniforms } from './waterLightingGLSL.js';

// ============================================================================
// WaterMaterialFactory — creates the correct water material for a mode.
// ============================================================================

export function createWaterMaterialForMode({
  mode,
  sharedUniforms,
  environmentUniforms,
  octaves,
  stackGLSL,
  infinite = false,
  planet = false,
}) {
  if (planet) {
    return createPlanetWaterMaterial(sharedUniforms, octaves, stackGLSL);
  }
  if (isRealisticWaterMode(mode)) {
    return infinite
      ? createInfiniteRealisticWaterMaterial(
        sharedUniforms,
        octaves,
        stackGLSL,
        environmentUniforms,
      )
      : createRealisticWaterMaterial(
        sharedUniforms,
        octaves,
        stackGLSL,
        environmentUniforms,
      );
  }
  return infinite
    ? createInfiniteWaterMaterial(sharedUniforms, octaves, stackGLSL)
    : createWaterMaterial(sharedUniforms, octaves, stackGLSL);
}

export function applyWaterMaterialSettings(mat, params, mode, debugView = 'off') {
  if (!mat?.uniforms) return;
  if (mat.uniforms.uWaterAnim) {
    mat.uniforms.uWaterAnim.value = params.waterAnim ? 1 : 0;
  }
  applyWaterLightingUniforms(mat.uniforms, params);
  if (isRealisticWaterMode(mode)) {
    applyRealisticWaterUniforms(mat, params, mode);
    setWaterDebugMode(mat, debugView);
  }
}
