// ============================================================================
// Biome system GLSL: world-space climate fields (temperature / moisture /
// continentalness / erosion / region jitter) -> smooth biome weights that
// drive both terrain shaping (HEIGHT_GLSL) and surface coloring (terrain
// fragment shader). Everything is a pure function of the noise domain
// (worldXZ * uFrequency + uSeedOffset): deterministic for a given seed,
// never influenced by the camera, and identical across chunk borders in
// both studio and infinite mode.
//
// Include order in a material: COMMON_UNIFORMS -> NOISE -> BIOME -> HEIGHT.
// ============================================================================

export const BIOME_GLSL = /* glsl */ `
uniform float uBiomeScale;   // climate frequency multiplier (higher = smaller regions)
uniform float uTempBias;     // global temperature shift (-1 polar .. +1 hot)
uniform float uMoistScale;   // moisture field frequency multiplier
uniform float uMoistBias;    // global moisture shift
uniform float uBiomeDebug;   // 1 = visualize biome regions as flat colors

// 3-octave FBM for low-frequency climate fields. Manually unrolled with
// hardcoded gain/lacunarity so climate maps stay stable while the user
// tweaks the terrain FBM parameters (and loop bounds stay compile-time
// constant for the ANGLE D3D11 compiler).
float fbm3(vec2 p) {
  float v = vnoise(p) * 0.55;
  p = ROT2 * p * 2.13;
  v += vnoise(p) * 0.30;
  p = ROT2 * p * 2.13;
  v += vnoise(p) * 0.15;
  return v;
}

struct Climate {
  float temp;     // 0 polar .. 1 hot (sea-level temperature, no altitude lapse)
  float moist;    // 0 arid .. 1 wet
  float cont;     // continentalness: 0 coastal lowland .. 1 deep inland
  float erosion;  // 0 young & jagged .. 1 old & eroded flat
  float region;   // medium-scale jitter that keeps biome borders organic
};

// p is the noise-domain coordinate: worldXZ * uFrequency + uSeedOffset.
// Each field gets a decorrelated domain offset so they are independent.
Climate climateAt(vec2 p) {
  Climate c = Climate(0.0, 0.0, 0.0, 0.0, 0.0);
  vec2 b = p * uBiomeScale;
  c.cont    = fbm3(b * 0.085 + vec2(211.3,  57.9));
  c.temp    = clamp(fbm3(b * 0.150 + vec2( 71.7, 313.1)) * 1.5 - 0.25 + uTempBias, 0.0, 1.0);
  c.moist   = clamp(fbm3(b * 0.130 * uMoistScale + vec2( 91.7,  53.9)) * 1.5 - 0.25 + uMoistBias, 0.0, 1.0);
  c.erosion = fbm3(b * 0.190 + vec2(157.1, 423.7));
  c.region  = fbm3(p * 0.700 + vec2(631.4, 199.2));
  return c;
}

// Smooth 0..1 weights for the biome families that change terrain SHAPE.
// Weights overlap smoothly — nothing is mutually exclusive, so every border
// is a gradual blend instead of a contour line.
struct BiomeWeights {
  float desert;    // hot + dry: dune fields, low relief
  float canyon;    // dry + eroded inland: terraced mesas / badlands strata
  float wetland;   // wet coastal lowland: flat marsh pinned near sea level
  float mountains; // continental + un-eroded: ridged alpine chains allowed
};

BiomeWeights biomeWeightsAt(Climate c) {
  float j = (c.region - 0.5) * 0.16;   // organic border jitter
  float hot    = smoothstep(0.52, 0.74, c.temp + j);
  float dry    = smoothstep(0.55, 0.30, c.moist - j);
  float wet    = smoothstep(0.55, 0.78, c.moist + j);
  float lowC   = smoothstep(0.55, 0.32, c.cont);
  float eroded = smoothstep(0.40, 0.70, c.erosion + j * 0.5);

  BiomeWeights w;
  w.desert    = hot * dry * (1.0 - eroded * 0.55);
  w.canyon    = dry * eroded * smoothstep(0.30, 0.55, c.cont);
  w.wetland   = wet * lowC * (1.0 - hot * 0.4);
  w.mountains = smoothstep(0.38, 0.62, c.cont) * (1.0 - eroded * 0.7);
  return w;
}

// Vegetation density 0..1 — drives forest color now, tree/rock placement
// later. h01 = height / heightScale, slope = 1 - geometricNormal.y.
float vegetationDensity(Climate c, float h01, float slope) {
  float tempEff = c.temp - h01 * 0.55;   // altitude temperature lapse
  float warmEnough = smoothstep(0.18, 0.34, tempEff) * smoothstep(0.92, 0.70, tempEff);
  float wetEnough  = smoothstep(0.34, 0.62, c.moist);
  float flatGround = smoothstep(0.55, 0.25, slope);
  return warmEnough * wetEnough * flatGround;
}
`;
