import {
  NOISE_GLSL,
  buildHeightGLSL,
  INFINITE_FIELD_CACHE_GLSL,
} from '../terrain/terrainGLSL.js';
import { BIOME_GLSL } from '../terrain/biomeGLSL.js';

// Studio water owns a separate cache binding. Height and climate become cached
// together only after a generation- and layout-matched final bake commits
// atomically; until then the shader evaluates the live terrain field.
export const WATER_TERRAIN_CACHE_GLSL = /* glsl */ `
uniform sampler2D uWaterTerrainHeightTex;
uniform sampler2D uWaterTerrainBiomeTex;
uniform float uUseWaterTerrainBiomeTex;

vec2 waterBakedUvAt(vec2 xz) {
  return (xz - uBakeOrigin) / max(uBakeSpan, vec2(1.0));
}

float waterBakedHeightAt(vec2 xz) {
  return texture2D(uWaterTerrainHeightTex, waterBakedUvAt(xz)).a * uHeightScale;
}
`;

export function buildWaterHeightShaderParts(stackGLSL, infinite) {
  if (infinite) {
    return {
      dependencies: `${NOISE_GLSL}\n${BIOME_GLSL}\n${buildHeightGLSL(stackGLSL.body2d)}\n${INFINITE_FIELD_CACHE_GLSL}`,
      terrainHeightFunction: /* glsl */ `
float waterTerrainHeightAt(vec2 xz) {
  return terrainCachedHeightAt(xz);
}
`,
    };
  }

  return {
    dependencies: `${NOISE_GLSL}\n${BIOME_GLSL}\n${buildHeightGLSL(stackGLSL.body2d)}`,
    terrainHeightFunction: /* glsl */ `
float waterTerrainHeightAt(vec2 xz) {
  if (uUseWaterTerrainBiomeTex > 0.5) {
    return waterBakedHeightAt(xz);
  }
  return heightAt(xz);
}
`,
  };
}
