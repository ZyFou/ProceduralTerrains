// ============================================================================
// Wind material factory for animated props.
//
// Built on MeshLambertMaterial via onBeforeCompile so the props keep the scene's
// standard lighting, fog and shadows, and we only inject the vertex-shader wind
// from windGLSL.js. The base stays rooted (aBend = 0) and the tip bends
// (aBend = 1), so animated props never lift off the terrain.
// ============================================================================

import * as THREE from 'three';
import { WIND_VERT_DECL, WIND_VERT_BODY } from './windGLSL.js';

/**
 * @param {object} windUniforms  shared block from createWindUniforms()
 * @param {object} [opts]
 * @param {number} [opts.strengthMul=1]  per-material wind multiplier (windInfluence)
 * @param {string} [opts.name]
 */
export function makeWindMaterial(windUniforms, { strengthMul = 1, name = 'wind' } = {}) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.name = name;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWindDir = windUniforms.uWindDir;
    shader.uniforms.uWindStrength = windUniforms.uWindStrength;
    shader.uniforms.uWindSpeed = windUniforms.uWindSpeed;
    shader.uniforms.uGustScale = windUniforms.uGustScale;
    shader.uniforms.uGustIntensity = windUniforms.uGustIntensity;
    shader.uniforms.uWindStrengthMul = { value: strengthMul };
    shader.vertexShader = WIND_VERT_DECL + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n' + WIND_VERT_BODY,
    );
  };
  // distinct cache key per strength so the two variants don't collide
  mat.customProgramCacheKey = () => `windprop:${strengthMul}`;
  return mat;
}
