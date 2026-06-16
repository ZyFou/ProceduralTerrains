// ============================================================================
// Cloud-mode GLSL: self-contained 3D procedural noise + a spherical volumetric
// density field. Deliberately INDEPENDENT of the terrain noise stack — clouds
// must never be wired into terrain generation, and keeping the noise local
// means the cloud material does not depend on any terrain uniform/#define.
//
// Density is a pure function of a WORLD/PLANET-LOCAL 3D position (the planet is
// centered at the world origin), never of sphere UVs — so there is no pole
// stretching and no seam around the globe.
//
// All loop bounds are compile-time constants (fixed octave counts, the 3×3×3
// worley cell loop, and the CLOUD_STEPS / CLOUD_LIGHT_STEPS #defines). Dynamic
// trip counts hang ANGLE's D3D11 shader compiler, so we never use them here.
// ============================================================================

export const CLOUD_NOISE_GLSL = /* glsl */ `
// --- 3D hash (Dave Hoskins) --------------------------------------------------
float cl_hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 cl_hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

// --- quintic trilinear value noise -------------------------------------------
float cl_vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = cl_hash13(i + vec3(0.0, 0.0, 0.0));
  float n100 = cl_hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = cl_hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = cl_hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = cl_hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = cl_hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = cl_hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = cl_hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z
  );
}

// orthonormal rotation to decorrelate FBM octaves
const mat3 CL_ROT = mat3(
   0.00,  0.80,  0.60,
  -0.80,  0.36, -0.48,
  -0.60, -0.48,  0.64
);

// Base FBM value noise
float cl_fbm_base(vec3 p) {
  float amp = 0.5, sum = 0.0, norm = 0.0;
  #ifndef CLOUD_OCTAVES
  #define CLOUD_OCTAVES 5
  #endif
  for (int i = 0; i < CLOUD_OCTAVES; i++) {
    sum += amp * cl_vnoise(p);
    norm += amp;
    amp *= 0.5;
    p = CL_ROT * p * 2.02;
  }
  return sum / max(norm, 1e-4);
}

// Detail FBM value noise (compiled out if detail octaves is 0)
#if defined(CLOUD_DETAIL_OCTAVES) && CLOUD_DETAIL_OCTAVES > 0
float cl_fbm_detail(vec3 p) {
  float amp = 0.5, sum = 0.0, norm = 0.0;
  for (int i = 0; i < CLOUD_DETAIL_OCTAVES; i++) {
    sum += amp * cl_vnoise(p);
    norm += amp;
    amp *= 0.5;
    p = CL_ROT * p * 2.02;
  }
  return sum / max(norm, 1e-4);
}
#endif

// Worley / cellular noise (F1) over a fixed 3×3×3 neighbourhood — returns the
// distance to the nearest feature point. Used to erode wispy cloud edges.
float cl_worley(vec3 p) {
  vec3 id = floor(p);
  vec3 f = fract(p);
  float md = 1.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = cl_hash33(id + g);
    vec3 r = g + o - f;
    md = min(md, dot(r, r));
  }
  return sqrt(md);
}
`;

// Shared cloud field: the uniforms + domain rotation + shape function reused by
// BOTH the spherical shell (planet) and the planar slab (studio) shaders. Only
// the altitude falloff and the marched geometry differ between them.
export const CLOUD_FIELD_GLSL = /* glsl */ `
uniform float uCloudCoverage;     // 0..1, higher = more cloud
uniform float uCloudSoftness;
uniform float uCloudScale;        // pre-scaled large-shape frequency
uniform float uCloudDetailScale;
uniform float uCloudDetailStrength;
uniform float uCloudErosionScale;
uniform float uCloudErosionStrength;
uniform float uCloudExtinction;   // optical-depth gain (folds in cloudDensity)
uniform float uCloudLightAbsorption;
uniform float uCloudShadowStrength;
uniform float uCloudScattering;
uniform vec3  uCloudColor;
uniform vec3  uCloudShadowColor;
uniform vec3  uCloudWind;          // domain drift vector (already × speed)
uniform float uCloudRotation;      // domain rotation angle (radians)
uniform float uCloudTime;
uniform float uCloudSelfShadow;    // 0/1 toggle
uniform vec3  uCloudSunDir;        // normalized, surface -> sun
uniform float uCloudNoiseVariant;  // 0 soft, 1 billowy, 2 wispy, 3 cellular

// rotate the sample domain slowly around the up (Y) axis (seamless — no UVs)
vec3 cl_domain(vec3 P) {
  float c = cos(uCloudRotation), s = sin(uCloudRotation);
  return vec3(c * P.x + s * P.z, P.y, -s * P.x + c * P.z);
}

// cloud coverage fraction in [0,1] from the 3D noise stack at a domain point
// (BEFORE altitude falloff — each shader applies its own).
float cloudShape(vec3 q) {
  vec3 drift = uCloudWind * uCloudTime;
  vec3 baseP = q * uCloudScale + drift;
  float base = cl_fbm_base(baseP);
  float variant = floor(uCloudNoiseVariant + 0.5);

  if (variant > 0.5 && variant < 1.5) {
    float billow = 1.0 - abs(base * 2.0 - 1.0);
    base = mix(base, pow(clamp(billow, 0.0, 1.0), 0.65), 0.85);
  } else if (variant > 1.5 && variant < 2.5) {
    vec3 streakP = vec3(q.x * 0.42 + q.z * 0.18, q.y * 0.72, q.z * 2.65) * uCloudScale + drift;
    float streak = cl_fbm_base(streakP);
    float shear = cl_fbm_base((q + vec3(streak * 36.0, 0.0, -streak * 18.0)) * uCloudScale * 0.72 + drift * 1.35);
    base = mix(streak, shear, 0.45);
  } else if (variant > 2.5) {
    float cell = 1.0 - cl_worley(baseP * 1.55);
    float filler = cl_fbm_base(baseP * 0.72 + vec3(19.7, 4.1, 31.3));
    base = mix(filler, clamp(cell, 0.0, 1.0), 0.72);
  }

  float n = base;
  #if defined(CLOUD_DETAIL_OCTAVES) && CLOUD_DETAIL_OCTAVES > 0
  float detail = cl_fbm_detail(q * uCloudDetailScale + drift * 1.7);
  n += detail * uCloudDetailStrength;
  #endif
  #if defined(CLOUD_USE_EROSION) && CLOUD_USE_EROSION > 0
  float ero = cl_worley(q * uCloudErosionScale);
  n -= ero * uCloudErosionStrength;
  #endif
  n = clamp(n, 0.0, 1.0);
  // coverage: higher slider -> lower threshold -> more cloud
  float threshold = 1.0 - uCloudCoverage;
  return smoothstep(threshold, threshold + uCloudSoftness, n);
}
`;

// Spherical shell specifics (planet mode).
export const CLOUD_VOLUME_GLSL = /* glsl */ `
uniform float uCloudInner;        // inner shell radius (world units)
uniform float uCloudOuter;        // outer shell radius (world units)

// cloud fraction in [0,1] at a planet-local world position
float cloudDensity(vec3 P) {
  float r = length(P);
  float hf = (r - uCloudInner) / max(uCloudOuter - uCloudInner, 1e-3);
  if (hf <= 0.0 || hf >= 1.0) return 0.0;
  float fall = smoothstep(0.0, 0.18, hf) * smoothstep(1.0, 0.78, hf);
  return cloudShape(cl_domain(P)) * fall;
}

// ray vs sphere centered at the origin; returns (tNear, tFar), tNear > tFar
// means no intersection. ro/rd in planet-local world space, rd normalized.
vec2 cl_raySphere(vec3 ro, vec3 rd, float R) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - R * R;
  float disc = b * b - c;
  if (disc < 0.0) return vec2(1.0, -1.0);
  float s = sqrt(disc);
  return vec2(-b - s, -b + s);
}

// soft secondary march toward the sun for self-shadowing (fixed step count)
float cl_lightTransmittance(vec3 P) {
  float stepLen = (uCloudOuter - uCloudInner) / float(CLOUD_LIGHT_STEPS) * 0.65;
  float dsum = 0.0;
  vec3 sp = P;
  for (int i = 0; i < CLOUD_LIGHT_STEPS; i++) {
    sp += uCloudSunDir * stepLen;
    dsum += cloudDensity(sp);
  }
  return exp(-dsum * stepLen * uCloudExtinction * uCloudLightAbsorption);
}
`;

// Planar slab specifics (studio / flat board mode). Clouds live between two
// horizontal planes (uCloudBottom..uCloudTop) and fade out past a horizontal
// radius so they sit over the board like a diorama layer.
export const CLOUD_SLAB_GLSL = /* glsl */ `
uniform float uCloudBottom;       // slab bottom world Y
uniform float uCloudTop;          // slab top world Y
uniform float uCloudRadius;       // horizontal fade radius
uniform float uCloudFar;          // clamp marched distance (horizon bound)
uniform vec3  uCloudCenter;       // board center (xz used)

float cloudDensity(vec3 P) {
  float hf = (P.y - uCloudBottom) / max(uCloudTop - uCloudBottom, 1e-3);
  if (hf <= 0.0 || hf >= 1.0) return 0.0;
  float fall = smoothstep(0.0, 0.18, hf) * smoothstep(1.0, 0.78, hf);
  float rad = length(P.xz - uCloudCenter.xz);
  float edge = 1.0 - smoothstep(uCloudRadius * 0.65, uCloudRadius, rad);
  if (edge <= 0.0) return 0.0;
  return cloudShape(cl_domain(P)) * fall * edge;
}

float cl_lightTransmittance(vec3 P) {
  float stepLen = (uCloudTop - uCloudBottom) / float(CLOUD_LIGHT_STEPS) * 0.65;
  float dsum = 0.0;
  vec3 sp = P;
  for (int i = 0; i < CLOUD_LIGHT_STEPS; i++) {
    sp += uCloudSunDir * stepLen;
    dsum += cloudDensity(sp);
  }
  return exp(-dsum * stepLen * uCloudExtinction * uCloudLightAbsorption);
}
`;
