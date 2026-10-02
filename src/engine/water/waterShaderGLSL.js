import {
  NOISE_GLSL,
  buildHeightGLSL,
  INFINITE_FIELD_CACHE_GLSL,
  NEAR_BAKE_BLOCK,
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
  return textureLod(uWaterTerrainHeightTex, waterBakedUvAt(xz), 0.0).a * uHeightScale;
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

float waterTerrainKernelHeightAt(vec2 xz) {
  return terrainCachedHeightAt(xz);
}
`,
    };
  }

  return {
    dependencies: `${NOISE_GLSL}\n${BIOME_GLSL}\n${buildHeightGLSL(stackGLSL.body2d)}\n${NEAR_BAKE_BLOCK}`,
    terrainHeightFunction: /* glsl */ `
float waterTerrainHeightAt(vec2 xz) {
  // Shoreline authority: the exact procedural field near the camera, the
  // generation-matched bake once a pixel spans about one bake texel (same
  // live/baked hybrid as the terrain fragment). Real branches only, and a
  // single procedural call site keeps one inlined copy of the height graph.
  float bakeWeight = 0.0;
  float nearWeight = 0.0;
  if (uUseWaterTerrainBiomeTex > 0.5) {
    float viewDistance = length(cameraPosition - vec3(xz.x, uSeaLevel, xz.y));
    bakeWeight = terrainBakeBlendWeight(viewDistance);
#ifdef TERRAIN_NEAR_BAKE
    if (bakeWeight < 1.0) nearWeight = terrainNearBakeBlendWeight(xz, viewDistance) * (1.0 - bakeWeight);
#endif
  }
  float bakedWeight = bakeWeight + nearWeight;
  float h = 0.0;
  if (bakedWeight < 1.0) h = heightAt(xz);
  if (bakedWeight > 0.0) {
    float hBaked;
#ifdef TERRAIN_NEAR_BAKE
    if (nearWeight > 0.0) {
      float hNear = textureLod(uNearBakeTex, nearBakedUvAt(xz), 0.0).a * uHeightScale;
      if (bakeWeight > 0.0) {
        hBaked = (waterBakedHeightAt(xz) * bakeWeight + hNear * nearWeight) / bakedWeight;
      } else {
        hBaked = hNear;
      }
    } else {
      hBaked = waterBakedHeightAt(xz);
    }
#else
    hBaked = waterBakedHeightAt(xz);
#endif
    h = mix(h, hBaked, bakedWeight);
  }
  return h;
}

// Low-pass taps (depth-tint smoothing, shore slope) average over 4-16 world
// units, far wider than a bake texel, so they use the bake whenever it is
// published and fall back to the live field otherwise.
float waterTerrainKernelHeightAt(vec2 xz) {
  if (uUseWaterTerrainBiomeTex > 0.5) return waterBakedHeightAt(xz);
  return heightAt(xz);
}
`,
  };
}
