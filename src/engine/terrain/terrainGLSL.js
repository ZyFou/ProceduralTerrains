// ============================================================================
// Shared GLSL: uniforms, hash/noise primitives, FBM stacks and the height
// field. Included by both the terrain material and the water material so
// every consumer evaluates the exact same deterministic height function.
// ============================================================================

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

export const HEIGHT_GLSL = /* glsl */ `
// ============================================================================
// The terrain height field. Pure function of world XZ + uniforms — fully
// deterministic for a given seed, never influenced by the camera.
// Layers: domain warp -> base FBM -> ridged mountains gated by a mountain
// mask -> island edge falloff.
// ============================================================================
float heightAt(vec2 xz) {
  vec2 p = xz * uFrequency + uSeedOffset;

  // layer 1: domain warp (two low-octave FBM fields bend the domain)
  vec2 w = vec2(
    fbm4(p + vec2(13.7, 41.3)),
    fbm4(p + vec2(87.2,  9.1))
  );
  vec2 q = p + (w - 0.5) * uWarp;

  // layer 2: rolling base terrain
  float base = fbm(q);

  // layer 3: ridged mountain chains, placed by a low-frequency mask
  float ridge = ridgedFBM(q * 1.7 + vec2(31.4, 27.2));
  float mountainMask = smoothstep(0.34, 0.66, fbm4(q * 0.35 + vec2(5.1, 17.7)));

  float h = base * 0.30 + 0.06;
  h += pow(ridge, 1.35) * mountainMask * uRidge * 1.15;
  h *= uAmplitude;

  // layer 4: island/continent falloff toward board edges (square+radial blend)
  vec2 e = abs(xz) / uBoardHalf;
  float edge = mix(max(e.x, e.y), length(e) * 0.7071, 0.5);
  float t = clamp((1.0 - edge) / max(uFalloff, 1e-3), 0.0, 1.0);
  float fall = t * t * (3.0 - 2.0 * t);
  h *= fall;

  return clamp(h, 0.0, 1.35) * uHeightScale;
}

// Moisture field for biome blending (independent low-frequency layer).
uniform float uMoistScale;
uniform float uMoistBias;
float moistureAt(vec2 xz) {
  vec2 p = xz * uFrequency * 0.35 * uMoistScale + uSeedOffset + vec2(91.7, 53.9);
  return clamp(fbm4(p) + uMoistBias, 0.0, 1.0);
}
`;
