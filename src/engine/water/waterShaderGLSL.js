import {
  NOISE_GLSL,
  buildHeightGLSL,
  INFINITE_FIELD_CACHE_GLSL,
} from '../terrain/terrainGLSL.js';
import { BIOME_GLSL } from '../terrain/biomeGLSL.js';

// The water surface only needs value noise for ripples and foam. Studio depth
// comes from the baked height texture, so importing the terrain's complete
// noise/biome/height program there wastes several seconds in ANGLE translation.
const WATER_RIPPLE_NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`;

// Studio water owns a separate preview cache so a fast, low-resolution shore
// mask can be published immediately without changing terrain normals/colors.
// The terrain keeps its live procedural shading until the final bake commits.
export const WATER_TERRAIN_CACHE_GLSL = /* glsl */ `
uniform sampler2D uWaterTerrainHeightTex;
uniform sampler2D uWaterTerrainBiomeTex;
uniform float uUseWaterTerrainBiomeTex;

vec2 waterBakedUvAt(vec2 xz) {
  return (xz - uBakeOrigin) / max(uBakeSpan, vec2(1.0));
}

float waterBakedHeightAt(vec2 xz) {
  return texture2D(uWaterTerrainHeightTex, waterBakedUvAt(xz)).r * uHeightScale;
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
    dependencies: WATER_RIPPLE_NOISE_GLSL,
    terrainHeightFunction: /* glsl */ `
float waterTerrainHeightAt(vec2 xz) {
  return waterBakedHeightAt(xz);
}
`,
  };
}
