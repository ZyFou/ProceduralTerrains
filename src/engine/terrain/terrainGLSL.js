// ============================================================================
// Shared GLSL: uniforms, hash/noise primitives, FBM stacks and the height
// field. Included by both the terrain material and the water material so
// every consumer evaluates the exact same deterministic height function.
// ============================================================================

import { NOISE_STACK_PRIMS2D_GLSL } from './noise/noisePrimsGLSL.js';
import { NOISE_STACK_MASKS2D_GLSL } from './noise/masks.js';

export const COMMON_UNIFORMS_GLSL = /* glsl */ `
uniform vec2  uSeedOffset;     // deterministic domain offset derived from seed
uniform float uFrequency;      // base noise frequency (1/world units)
uniform float uHeightScale;    // world-space height of h01 == 1.0
uniform float uSeaLevel;       // world-space water height
uniform float uAmplitude;      // overall noise strength multiplier
uniform float uPersistence;    // FBM gain
uniform float uLacunarity;     // FBM frequency multiplier
uniform float uRidge;          // ridged-mountain intensity
uniform float uWarp;           // domain warp strength
uniform float uFalloff;        // island edge falloff width (0..1)
uniform float uBoardHalf;      // half board size in world units
uniform float uChunkSize;      // internal chunk size in world units
uniform vec3  uSunDir;         // normalized, pointing FROM surface TO sun
uniform vec3  uFogColor;
uniform float uFogDensity;
uniform float uTime;
uniform float uPaintEnabled;
uniform float uPaintOpacity;
uniform float uPaintBoardSize;
uniform float uPaintResolution;
uniform float uPaintHeightRange;
uniform sampler2D uPaintHeightTexture;
uniform sampler2D uPaintBiomeTexture;

// --- Noise Stack: per-layer continuous params (declared once, used by the
// codegen-injected stackHeight2D / stackHeight3D). MUST match MAX_LAYERS in
// src/engine/terrain/noise/NoiseStack.js.
#define MAX_NOISE_LAYERS 12
uniform float uLayerStrength[MAX_NOISE_LAYERS]; // strength * opacity (and solo gate)
uniform float uLayerScale[MAX_NOISE_LAYERS];    // primary frequency lane
uniform float uLayerSeed[MAX_NOISE_LAYERS];     // per-layer domain decorrelation
uniform vec4  uLayerParamsA[MAX_NOISE_LAYERS];  // type-specific continuous lanes
uniform vec4  uLayerParamsB[MAX_NOISE_LAYERS];
uniform vec4  uLayerMaskA[MAX_NOISE_LAYERS];    // height mask (min,max,falloff,flags)
uniform vec4  uLayerMaskB[MAX_NOISE_LAYERS];    // noise mask (scale,threshold,soft,invert)
uniform float uNoiseDebug;                      // debug view selector (0 = off)
`;

// Baked studio height/normal texture sampling. Studio terrain + water fragment
// shaders include this so they can replace the per-pixel ~46-octave height
// field with a single texture2D fetch when the engine's bake is active. Gated
// to non-infinite materials (the infinite world is unbounded — no fixed bake).
// The board spans world XZ in [-uBoardHalf, uBoardHalf]; map XZ → UV to match.
export const TERRAIN_HEIGHT_TEX_GLSL = /* glsl */ `
#ifndef INFINITE_MODE
uniform sampler2D uTerrainHeightTex;
uniform float uUseTerrainHeightTex;   // 1 = sample the baked texture, 0 = live field
vec2 bakedUvAt(vec2 xz) { return xz / (2.0 * uBoardHalf) + 0.5; }
float bakedHeightAt(vec2 xz) {
  return texture2D(uTerrainHeightTex, bakedUvAt(xz)).a * uHeightScale;
}
#endif
`;

export const NOISE_GLSL = /* glsl */ `
// --- hash without sine precision issues (Dave Hoskins) -----------------------
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// --- quintic value noise -----------------------------------------------------
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

const mat2 ROT2 = mat2(0.80, -0.60, 0.60, 0.80);

// NOTE: all loop bounds are compile-time constants (OCTAVES is a #define
// injected by the material). Dynamic trip counts / breaks make ANGLE's
// D3D11 shader compiler hang while trying to unroll, so avoid them here.

// --- standard FBM at full octave count (rolling hills / plains) --------------
float fbm(vec2 p) {
  float amp = 0.5;
  float sum = 0.0;
  float norm = 0.0;
  for (int i = 0; i < OCTAVES; i++) {
    sum += amp * vnoise(p);
    norm += amp;
    amp *= uPersistence;
    p = ROT2 * p * uLacunarity;
  }
  return sum / max(norm, 1e-4);
}

// --- low-cost 4-octave FBM (domain warp, masks, moisture) --------------------
float fbm4(vec2 p) {
  float amp = 0.5;
  float sum = 0.0;
  float norm = 0.0;
  for (int i = 0; i < 4; i++) {
    sum += amp * vnoise(p);
    norm += amp;
    amp *= uPersistence;
    p = ROT2 * p * uLacunarity;
  }
  return sum / max(norm, 1e-4);
}

// --- ridged multifractal (mountain chains) -----------------------------------
float ridgedFBM(vec2 p) {
  float amp = 0.5;
  float sum = 0.0;
  float norm = 0.0;
  float carry = 1.0;
  for (int i = 0; i < OCTAVES; i++) {
    float v = 1.0 - abs(vnoise(p) * 2.0 - 1.0);
    v = v * v;
    sum += amp * v * carry;     // spectral weighting: detail follows ridges
    carry = clamp(v * 1.4, 0.0, 1.0);
    norm += amp;
    amp *= uPersistence;
    p = ROT2 * p * uLacunarity;
  }
  return sum / max(norm, 1e-4);
}
`;

// ============================================================================
// The terrain height field. Pure function of world XZ + uniforms — fully
// deterministic for a given seed, never influenced by the camera.
//
// The actual stack of noise layers (stackHeight2D) is GENERATED from the live
// NoiseStack by noiseStackCodegen.generateStackGLSL() and injected here via
// buildHeightGLSL(stackBody2D). The default stack is a single `legacy` layer
// whose noise is legacyShape2D() — the original biome-coupled recipe — so
// default projects render bit-identically to before.
//
// Requires BIOME_GLSL (Climate / BiomeWeights / biomeWeightsAt) to be included
// first, and NOISE_GLSL (vnoise / fbm / fbm4 / ridgedFBM / ROT2).
// ============================================================================

// Build the full height GLSL block for a generated 2D stack body. The body is a
// sequence of per-layer blocks that read pw/h and the uLayer* uniform arrays.
export function buildHeightGLSL(stackBody2D) {
  return /* glsl */ `
${NOISE_STACK_PRIMS2D_GLSL}
${NOISE_STACK_MASKS2D_GLSL}

// Canyon/badlands strata: smooth terrace steps. C1-smooth so normals stay
// clean. Used by the legacy recipe and the Terrace modifier layer.
float terrace(float h, float steps) {
  float t = h * steps;
  float s = smoothstep(0.20, 0.80, fract(t));
  return (floor(t) + s) / steps;
}

// The original biome-coupled recipe (layers 1-6), returning h in ~0..1.35
// BEFORE island falloff and the uHeightScale multiply (the wrapper applies
// those to the whole stack). This is the legacy noise type.
float legacyShape2D(vec2 xz, Climate c) {
  vec2 p = xz * uFrequency + uSeedOffset;
  BiomeWeights bw = biomeWeightsAt(c);

  // layer 1: domain warp (canyons reduce warp so strata stay crisp)
  vec2 w = vec2(
    fbm4(p + vec2(13.7, 41.3)),
    fbm4(p + vec2(87.2,  9.1))
  );
  vec2 q = p + (w - 0.5) * uWarp * (1.0 - bw.canyon * 0.5);

  // layer 2: rolling base terrain, amplitude shaped per biome
  float base = fbm(q);
  float baseAmp = 0.30 * (1.0 - bw.desert * 0.45) * (1.0 - bw.wetland * 0.75);
  float h = base * baseAmp + 0.06;

  // layer 3: desert dunes — anisotropic ridge pattern, gentle amplitude
  float dune = 1.0 - abs(vnoise(vec2(q.x * 2.2 + q.y * 0.4, q.y * 0.8) + vec2(311.7, 89.1)) * 2.0 - 1.0);
  h += dune * dune * 0.05 * bw.desert;

  // layer 4: ridged mountain chains — chain noise picks WHERE within a
  // mountain-friendly climate; deserts and wetlands suppress them
  float ridge = ridgedFBM(q * 1.7 + vec2(31.4, 27.2));
  float chain = smoothstep(0.34, 0.66, fbm4(q * 0.35 + vec2(5.1, 17.7)));
  float mountains = chain * mix(0.35, 1.0, bw.mountains)
                  * (1.0 - bw.desert * 0.85)
                  * (1.0 - bw.wetland);
  h += pow(ridge, 1.35) * mountains * uRidge * 1.15;

  // layer 5: wetlands settle just above sea level (after amplitude so they
  // land at the true water line)
  float sea01 = uSeaLevel / max(uHeightScale, 1.0);
  h = mix(h, sea01 + 0.012 + base * 0.03, bw.wetland * 0.85);

  // layer 6: canyon/badlands strata terracing
  h = mix(h, terrace(h, 14.0), bw.canyon * 0.75);

  return h;
}

// Codegen-injected noise stack. Accumulates h from the ordered layers; pw is
// the (possibly domain-warped) noise-domain coordinate shared by all layers.
// uAmplitude acts as a master strength multiplier for the entire stack.
float stackHeight2D(vec2 xz, Climate c) {
  vec2 pw = xz * uFrequency + uSeedOffset;
  float h = 0.0;
${stackBody2D}
  return h * uAmplitude;
}

// Finalize: island falloff (studio board only) + clamp + world height scale.
float shapeHeight(vec2 xz, Climate c) {
  float h = stackHeight2D(xz, c);
#ifndef INFINITE_MODE
  // island/continent falloff toward board edges (square+radial blend)
  vec2 e = abs(xz) / uBoardHalf;
  float edge = mix(max(e.x, e.y), length(e) * 0.7071, 0.5);
  float t = clamp((1.0 - edge) / max(uFalloff, 1e-3), 0.0, 1.0);
  h *= t * t * (3.0 - 2.0 * t);
#endif
  return clamp(h, 0.0, 1.35) * uHeightScale;
}

vec2 paintUvAt(vec2 xz) {
  return xz / max(uPaintBoardSize, 1.0) + vec2(0.5);
}

float paintHeightOffsetAt(vec2 xz) {
  if (uPaintEnabled < 0.5) return 0.0;
  vec2 uv = paintUvAt(xz);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  float encoded = texture2D(uPaintHeightTexture, uv).r;
  return (encoded - 0.5) * 2.0 * uPaintHeightRange * uPaintOpacity;
}

vec4 paintBiomeAt(vec2 xz) {
  if (uPaintEnabled < 0.5) return vec4(0.0);
  vec2 uv = paintUvAt(xz);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  return texture2D(uPaintBiomeTexture, uv) * uPaintOpacity;
}

float heightAt(vec2 xz) {
  return shapeHeight(xz, climateAt(xz * uFrequency + uSeedOffset)) + paintHeightOffsetAt(xz);
}

// Moisture field for biome blending — now sourced from the climate system.
float moistureAt(vec2 xz) {
  return climateAt(xz * uFrequency + uSeedOffset).moist;
}
`;
}
