// ============================================================================
// Planet-mode GLSL: 3D value noise + FBM stacks and a spherical height field.
// This is the 3D twin of terrainGLSL.js / biomeGLSL.js — height, climate and
// biomes are pure functions of a UNIT SPHERE DIRECTION, so the planet is
// seamless (no edge, no pole pinch).
//
// Include order in a material:
//   COMMON_UNIFORMS -> NOISE (2D) -> BIOME -> PLANET -> PALETTE -> COLOR
// (NOISE_GLSL is still needed for the 2D `vnoise` used by the color micro
// detail; BIOME_GLSL provides the Climate / BiomeWeights structs and
// biomeWeightsAt(), which are dimension-agnostic and reused unchanged.)
//
// IMPORTANT: every FBM loop bound is the compile-time `OCTAVES` #define or a
// hard constant — dynamic trip counts hang ANGLE's D3D11 shader compiler.
// ============================================================================

import { NOISE_STACK_PRIMS3D_GLSL } from './noise/noisePrimsGLSL.js';
import { NOISE_STACK_MASKS3D_GLSL } from './noise/masks.js';

export const PLANET_UNIFORMS_GLSL = /* glsl */ `
uniform float uPlanetRadius;   // sphere base radius in world units
uniform float uPlanetEps;      // angular epsilon for analytic normals
`;

export const PLANET_NOISE_GLSL = /* glsl */ `
// --- 3D hash (Dave Hoskins) --------------------------------------------------
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

// --- quintic trilinear value noise ------------------------------------------
float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z
  );
}

// Triplanar 2D-value-noise sampling for sphere surfaces. A single flat xz
// projection of the globe stretches badly toward the poles / vertical faces
// (the streaking the planet water used to show); blending the three axis-
// aligned planes by the surface-normal weights keeps the grain uniform
// everywhere. blend must be normalized (its components sum to 1).
float vnoiseTri(vec3 p, vec3 blend) {
  return vnoise(p.yz) * blend.x + vnoise(p.zx) * blend.y + vnoise(p.xy) * blend.z;
}

// orthonormal rotation to decorrelate FBM octaves in 3D
const mat3 ROT3 = mat3(
   0.00,  0.80,  0.60,
  -0.80,  0.36, -0.48,
  -0.60, -0.48,  0.64
);

float fbm3D(vec3 p) {
  float amp = 0.5, sum = 0.0, norm = 0.0;
  for (int i = 0; i < OCTAVES; i++) {
    sum += amp * vnoise3(p);
    norm += amp;
    amp *= uPersistence;
    p = ROT3 * p * uLacunarity;
  }
  return sum / max(norm, 1e-4);
}

float fbm3D4(vec3 p) {
  float amp = 0.5, sum = 0.0, norm = 0.0;
  for (int i = 0; i < 4; i++) {
    sum += amp * vnoise3(p);
    norm += amp;
    amp *= uPersistence;
    p = ROT3 * p * uLacunarity;
  }
  return sum / max(norm, 1e-4);
}

// 3-octave climate FBM (hardcoded gain/lacunarity — stable while terrain
// params change), the 3D twin of biomeGLSL's fbm3.
float fbm3Dc(vec3 p) {
  float v = vnoise3(p) * 0.55;
  p = ROT3 * p * 2.13;
  v += vnoise3(p) * 0.30;
  p = ROT3 * p * 2.13;
  v += vnoise3(p) * 0.15;
  return v;
}

float ridgedFBM3D(vec3 p) {
  float amp = 0.5, sum = 0.0, norm = 0.0, carry = 1.0;
  for (int i = 0; i < OCTAVES; i++) {
    float v = 1.0 - abs(vnoise3(p) * 2.0 - 1.0);
    v = v * v;
    sum += amp * v * carry;
    carry = clamp(v * 1.4, 0.0, 1.0);
    norm += amp;
    amp *= uPersistence;
    p = ROT3 * p * uLacunarity;
  }
  return sum / max(norm, 1e-4);
}
`;

// Build the planet height GLSL block for a generated 3D stack body. Twin of
// terrainGLSL.buildHeightGLSL — the codegen injects stackHeight3D and the
// default stack is a single `legacy` layer (legacyShape3D) so planets render
// bit-identically to before by default.
export function buildPlanetHeightGLSL(stackBody3D) {
  return /* glsl */ `
${NOISE_STACK_PRIMS3D_GLSL}
${NOISE_STACK_MASKS3D_GLSL}

// Noise-domain point for a unit direction. Scaling by (radius * frequency)
// makes surface features the same world-size as in the flat board modes:
// moving along the surface by world distance d shifts the domain by ~d*freq.
vec3 planetDomain(vec3 dir) {
  vec3 seed = vec3(uSeedOffset.x, uSeedOffset.y, uSeedOffset.y - uSeedOffset.x);
  return dir * (uPlanetRadius * uFrequency) + seed;
}

// C1-smooth terrace steps (twin of HEIGHT_GLSL's terrace).
float planetTerrace(float h, float steps) {
  float t = h * steps;
  float s = smoothstep(0.20, 0.80, fract(t));
  return (floor(t) + s) / steps;
}

// Climate on the sphere. Temperature blends 3D noise with LATITUDE
// (|dir.y|): equator warm, poles cold. Other fields are decorrelated 3D FBM.
Climate planetClimateAt(vec3 dir) {
  vec3 p = planetDomain(dir);
  Climate c;
  vec3 b = p * uBiomeScale;
  c.cont    = fbm3Dc(b * 0.085 + vec3(211.3,  57.9, 113.4));
  float lat = 1.0 - abs(dir.y);                 // 1 at equator, 0 at poles
  float tNoise = fbm3Dc(b * 0.150 + vec3(71.7, 313.1, 47.2)) * 1.5 - 0.25;
  c.temp    = clamp(mix(tNoise, lat * 1.15 - 0.15, 0.6) + uTempBias, 0.0, 1.0);
  c.moist   = clamp(fbm3Dc(b * 0.130 * uMoistScale + vec3(91.7, 53.9, 7.3)) * 1.5 - 0.25 + uMoistBias, 0.0, 1.0);
  c.erosion = fbm3Dc(b * 0.190 + vec3(157.1, 423.7, 91.6));
  c.region  = fbm3Dc(p * 0.700 + vec3(631.4, 199.2, 77.1));
  return c;
}

// The original biome-coupled recipe (layers 1-6) for a unit direction, h in
// ~0..1.35 BEFORE the uHeightScale multiply. This is the legacy noise type.
float legacyShape3D(vec3 dir) {
  vec3 p = planetDomain(dir);
  Climate c = planetClimateAt(dir);
  BiomeWeights bw = biomeWeightsAt(c);

  // layer 1: domain warp
  vec3 w = vec3(
    fbm3D4(p + vec3(13.7, 41.3, 7.2)),
    fbm3D4(p + vec3(87.2,  9.1, 55.1)),
    fbm3D4(p + vec3(31.7,  5.3, 91.4))
  );
  vec3 q = p + (w - 0.5) * uWarp * (1.0 - bw.canyon * 0.5);

  // layer 2: rolling base
  float base = fbm3D(q);
  float baseAmp = 0.30 * (1.0 - bw.desert * 0.45) * (1.0 - bw.wetland * 0.75);
  float h = base * baseAmp + 0.06;

  // layer 3: desert dunes
  float dune = 1.0 - abs(vnoise3(vec3(q.x * 2.2 + q.y * 0.4, q.y * 0.8, q.z * 1.3) + vec3(311.7, 89.1, 17.3)) * 2.0 - 1.0);
  h += dune * dune * 0.05 * bw.desert;

  // layer 4: ridged mountain chains
  float ridge = ridgedFBM3D(q * 1.7 + vec3(31.4, 27.2, 11.9));
  float smoothAmt = clamp(uTerrainSmoothing, 0.0, 1.0);
  float ridgeNeedle = pow(ridge, 1.35);
  float ridgeRounded = pow(ridge, 0.62) * 0.58;
  float ridgeShape = mix(ridgeNeedle, ridgeRounded, smoothAmt);
  float chain = smoothstep(0.34, 0.66, fbm3D4(q * 0.35 + vec3(5.1, 17.7, 9.4)));
  float mountains = chain * mix(0.35, 1.0, bw.mountains)
                  * (1.0 - bw.desert * 0.85)
                  * (1.0 - bw.wetland);
  h += ridgeShape * mountains * uRidge * mix(1.15, 0.82, smoothAmt);

  // layer 5: wetlands settle just above sea level
  float sea01 = uSeaLevel / max(uHeightScale, 1.0);
  h = mix(h, sea01 + 0.012 + base * 0.03, bw.wetland * 0.85);

  // layer 6: canyon strata terracing
  h = mix(h, planetTerrace(h, 14.0), bw.canyon * 0.75);

  return h;
}

// Codegen-injected noise stack on the sphere; pw is the (domain-warped) 3D
// noise coordinate shared by all layers.
// uAmplitude acts as a master strength multiplier for the entire stack.
float stackHeight3D(vec3 dir) {
  vec3 pw = planetDomain(dir);
  float h = 0.0;
${stackBody3D}
  return h * uAmplitude;
}

float smoothedStackHeight3D(vec3 dir) {
  float h = stackHeight3D(dir);
  float amt = clamp(uTerrainSmoothing, 0.0, 1.0);
  if (amt <= 0.0001) return h;

  float t = clamp(h / 1.35, 0.0, 1.0);
  float peakStart = 0.42;
  float peak = max(t - peakStart, 0.0);
  float peakMask = smoothstep(peakStart, 0.72, t);
  float compressed = peakStart + peak / (1.0 + amt * 3.2 * peak / (1.0 - peakStart));
  return mix(h, compressed * 1.35, peakMask * amt);
}

// Radial terrain height (world units) for a unit direction — no board falloff
// (a sphere has no edge).
float heightAt3D(vec3 dir) {
  float h = smoothedStackHeight3D(dir);
  return finalizeStackHeight(h) * uHeightScale;
}
`;
}
