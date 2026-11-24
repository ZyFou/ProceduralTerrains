import { CLOUD_FOOTPRINT_GLSL } from '../cloudFootprintGLSL.js';
// ============================================================================
// Realistic cloud mode — GLSL. A port of the Procedural Planets cloud pass
// (PlanetPipeline CLOUD_FRAGMENT + surfaceGLSL CLOUD_FIELD_GLSL): a baked
// weather field (cover + cloud type) shapes columns whose vertical profile
// depends on the cloud type, tileable Perlin-Worley / Worley volumes carve the
// billows and the erosion, and the lighting is single scattering with
// multiple-scattering octaves (Wrenninge), powder darkening, silver lining,
// sky light and ground bounce.
//
// Two geometries share the march:
//   CLOUD_PLANET  spherical shell around the origin, weather cubemap
//   (default)     flat slab between two world-Y planes, weather 2D map over a
//                 world-XZ window that follows the wind drift
//
// The loops are bounded by constants + the zero-valued uLoopGuard (real loops
// on ANGLE/D3D, see cloudGLSL.js); every texture fetch in a loop is explicit
// LOD.
// ============================================================================

export const REALISTIC_MAX_STEPS = 128;

const COMMON_GLSL = /* glsl */ `
#ifndef PI
#define PI 3.141592653589793
#endif

float sat(float x) { return clamp(x, 0.0, 1.0); }
vec3 srgbToLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }

float remap(float v, float a, float b, float c, float d) {
  return c + (v - a) / max(b - a, 1e-5) * (d - c);
}

float phaseHG(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// ray / sphere at the origin: (tNear, tFar); tNear > tFar means miss.
// Factored radial difference keeps metre-scale clearance on large planets.
vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float eyeRadius = length(ro);
  float c = (eyeRadius - r) * (eyeRadius + r);
  float h = b * b - c;
  if (h < 0.0) return vec2(1e20, -1e20);
  h = sqrt(h);
  float q = -b - (b < 0.0 ? -h : h);
  float other = abs(q) > 1e-20 ? c / q : -b;
  return vec2(min(q, other), max(q, other));
}
`;

// ---------------------------------------------------------------------------
// Bake: tileable 3D noise volumes (one layer per draw), as in Procedural
// Planets. r = Worley fbm (4 / 8 / 16 cells), g = Perlin-Worley.
// ---------------------------------------------------------------------------
export const NOISE_VOLUME_FRAGMENT = /* glsl */ `
precision highp float;
uniform float uLayer;
uniform float uSize;

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

float worleyTile(vec3 p, float F) {
  vec3 q = p * F;
  vec3 i = floor(q);
  vec3 f = fract(q);
  float d = 1.0;
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = hash33(mod(i + g, F) + 13.7);
    vec3 r = g + o - f;
    d = min(d, dot(r, r));
  }
  return 1.0 - clamp(sqrt(d), 0.0, 1.0);
}

float gradTile(vec3 p, float F) {
  vec3 q = p * F;
  vec3 i = floor(q);
  vec3 f = fract(q);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  #define G(c) dot(hash33(mod(i + c, F)) * 2.0 - 1.0, f - c)
  float v000 = G(vec3(0.0, 0.0, 0.0)), v100 = G(vec3(1.0, 0.0, 0.0));
  float v010 = G(vec3(0.0, 1.0, 0.0)), v110 = G(vec3(1.0, 1.0, 0.0));
  float v001 = G(vec3(0.0, 0.0, 1.0)), v101 = G(vec3(1.0, 0.0, 1.0));
  float v011 = G(vec3(0.0, 1.0, 1.0)), v111 = G(vec3(1.0, 1.0, 1.0));
  #undef G
  return mix(mix(mix(v000, v100, u.x), mix(v010, v110, u.x), u.y),
             mix(mix(v001, v101, u.x), mix(v011, v111, u.x), u.y), u.z);
}

float worleyFbm(vec3 p, float F) {
  return worleyTile(p, F) * 0.625 + worleyTile(p, F * 2.0) * 0.25 + worleyTile(p, F * 4.0) * 0.125;
}

void main() {
  vec3 p = vec3(gl_FragCoord.xy, uLayer + 0.5) / uSize;
  float perlin = gradTile(p, 4.0) + 0.5 * gradTile(p, 8.0) + 0.25 * gradTile(p, 16.0);
  perlin = clamp(0.5 + perlin * 0.75, 0.0, 1.0);
  float w1 = worleyFbm(p, 4.0);
  // Perlin dilated by Worley: billowy cells with connected bodies
  float pw = clamp((perlin - (w1 - 1.0)) / (2.0 - w1), 0.0, 1.0);
  float low = w1 * 0.625 + worleyFbm(p, 8.0) * 0.25 + worleyFbm(p, 16.0) * 0.125;
  gl_FragColor = vec4(low, pw, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Bake: weather field (r = cloud field, g = cloud type). Same warped fbm,
// frontal bands and cloud-type noise as Procedural Planets; the planet version
// keeps the Hadley / Ferrel latitude cells, the flat one evolves through Y.
// ---------------------------------------------------------------------------
const WEATHER_NOISE_GLSL = /* glsl */ `
precision highp float;
uniform vec3 uSeedOffset;
uniform float uWeatherTime;
uniform float uFaceSize;
uniform int uLoopGuard;

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx) * 2.0 - 1.0;
}

float gnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float va = dot(hash33(i), f);
  float vb = dot(hash33(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0));
  float vc = dot(hash33(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0));
  float vd = dot(hash33(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0));
  float ve = dot(hash33(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0));
  float vf = dot(hash33(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0));
  float vg = dot(hash33(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0));
  float vh = dot(hash33(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y),
             mix(mix(ve, vf, u.x), mix(vg, vh, u.x), u.y), u.z);
}

const mat3 OCT_ROT = mat3( 0.00,  0.80,  0.60,
                          -0.80,  0.36, -0.48,
                          -0.60, -0.48,  0.64);

float fbmN(vec3 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 6 + uLoopGuard; i++) {
    if (i >= oct) break;
    s += a * gnoise(p);
    n += a;
    a *= 0.52;
    p = OCT_ROT * p * 2.03;
  }
  return s / n;
}

// warped field + frontal bands; t = weather time, e = evolution axis
float weatherField(vec3 p, float t, vec3 e) {
  vec3 q = vec3(fbmN(p * 0.55 + e * t, 3),
                fbmN(p * 0.55 + vec3(5.2, 1.3, 0.0) - e * t, 3),
                fbmN(p * 0.55 + vec3(2.8, 7.7, 0.0) + e * (t * 0.7), 3));
  vec3 pw = p + q * 3.2;
  float f = fbmN(pw + e * (t * 0.3), 6);
  float fb = 1.0 - abs(fbmN(pw * 0.7 + vec3(19.1, 7.3, 3.9) - e * (t * 0.2), 5)) * 5.5;
  return 0.47 + f * 1.6 + max(fb, 0.0) * 0.2;
}
`;

export const WEATHER_CUBE_FRAGMENT = /* glsl */ `
${WEATHER_NOISE_GLSL}
uniform float uFace;
uniform float uCloudScale;

vec3 faceDir(float face, vec2 st) {
  if (face < 0.5) return vec3(1.0, -st.y, -st.x);
  if (face < 1.5) return vec3(-1.0, -st.y, st.x);
  if (face < 2.5) return vec3(st.x, 1.0, st.y);
  if (face < 3.5) return vec3(st.x, -1.0, -st.y);
  if (face < 4.5) return vec3(st.x, -st.y, 1.0);
  return vec3(-st.x, -st.y, -1.0);
}

void main() {
  vec2 st = gl_FragCoord.xy / uFaceSize * 2.0 - 1.0;
  vec3 d = normalize(faceDir(uFace, st));
  // systems are stretched east-west (zonal flow)
  vec3 p = d * uCloudScale * vec3(1.0, 1.7, 1.0) + uSeedOffset * 0.37;
  float v = weatherField(p, uWeatherTime, vec3(0.0, 0.0, 1.0));
  // Hadley / Ferrel circulation: cloudy ITCZ and storm tracks, clear highs
  float lat = asin(clamp(d.y, -1.0, 1.0));
  v += cos(lat * 6.0) * 0.05;
  // cloud type: tall convective cells (tropics) vs flat stratiform decks
  float type = clamp(0.45 + gnoise(p * 1.6 + 31.0) * 1.3 + (1.0 - abs(d.y)) * 0.25 - 0.12, 0.0, 1.0);
  gl_FragColor = vec4(clamp(v, 0.0, 1.0), type, 0.0, 1.0);
}
`;

export const WEATHER_FLAT_FRAGMENT = /* glsl */ `
${WEATHER_NOISE_GLSL}
uniform vec2 uWindowCenter;   // field-space centre of the baked window
uniform float uWindowHalf;    // half width (world units)
uniform float uCloudScale;    // weather frequency per world unit

void main() {
  vec2 st = gl_FragCoord.xy / uFaceSize * 2.0 - 1.0;
  vec2 F = uWindowCenter + st * uWindowHalf;
  vec3 p = vec3(F.x, 0.0, F.y) * uCloudScale + uSeedOffset * 0.37;
  // the field evolves through the axis normal to the plane
  float v = weatherField(p, uWeatherTime, vec3(0.0, 1.0, 0.0));
  float type = clamp(0.45 + gnoise(p * 1.6 + 31.0) * 1.3 + 0.01, 0.0, 1.0);
  gl_FragColor = vec4(clamp(v, 0.0, 1.0), type, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
// The volumetric pass, drawn on the layer's bounding mesh (BackSide).
// ---------------------------------------------------------------------------
export const REALISTIC_CLOUD_VERTEX = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const REALISTIC_CLOUD_FIELD_GLSL = /* glsl */ `
precision highp float;
precision highp sampler3D;
${COMMON_GLSL}

varying vec3 vWorldPos;

uniform int uLoopGuard;
uniform highp sampler3D uCloudNoise;     // Worley fbm (r) + Perlin-Worley (g)
uniform highp sampler3D uCloudErosion;   // Worley fbm alone (detail taps)
uniform float uWeatherBlend;
uniform float uCloudShapeFreq;
uniform float uCloudDetailFreq;
uniform float uCloudCellFreq;
uniform vec3  uCloudWind;
uniform vec3  uCloudVariationOffset;
uniform float uCloudNoiseType; // 0 = soft, 1 = billowy, 2 = wispy
uniform float uCloudCoverage;
uniform float uCloudSoftness;
uniform float uCloudDensity;
uniform float uCloudDetail;
uniform float uCloudTowering;
uniform float uCloudShear;
uniform float uCloudBottom;
uniform float uCloudTop;
uniform float uCloudSilver;
uniform vec3  uCloudColor;      // sRGB albedo tint
uniform vec3  uCloudSkyTint;    // sRGB tint of the sky-lit (ambient) part
uniform float uCloudSteps;
uniform float uExposure;

uniform vec3 uSunDir;
uniform vec3 uSunLight;         // linear sun irradiance (HDR)
uniform vec3 uSkyTop;           // linear sky irradiance above / below the layer
uniform vec3 uSkyBottom;

uniform sampler2D tSceneDepth;
uniform vec2 uDepthResolution;
uniform mat4 uProjectionMatrixInverse;
uniform mat4 uViewMatrixInverse;
uniform float uDepthBias;
uniform float uUseDepth;

#ifdef CLOUD_PLANET
uniform samplerCube uWeatherMap;
uniform samplerCube uWeatherMapNext;
uniform vec2 uCloudRotCS;       // drift rotation around the pole (cos, sin)
uniform float uGroundRadius;    // sea level radius
#else
uniform sampler2D uWeatherMap;
uniform sampler2D uWeatherMapNext;
uniform vec2 uFieldShift;       // accumulated wind drift: field = world - shift
uniform vec2 uWeatherCenter;    // field-space centre of the baked window
uniform float uWeatherInvSpan;  // 1 / window width
uniform float uWeatherSize;     // weather map texels per side
uniform vec2 uShearDir;         // downwind direction (XZ)
uniform vec2 uCloudCenter;      // XZ centre of the cloud disc
uniform float uCloudRadius;
uniform float uCloudFar;
${CLOUD_FOOTPRINT_GLSL}
#endif

// 0..1 cloud cover from the weather field and the coverage slider
float cloudCover(vec4 w) {
  float cut = 1.0 - uCloudCoverage;
  float soft = max(uCloudSoftness, 0.01);
  return smoothstep(cut - soft * 0.15, cut + soft + 0.05, w.r);
}

// Vertical extent of the cloud types as fractions of the layer: x / y base
// ramp, z / w top ramp. Stratiform decks stay low and flat, cumulus are as
// tall as wide, cumulonimbus fill the layer; dense cores build higher than
// their fringes, which shapes domes.
vec4 cloudGradient(float type, float cov) {
  float tt = sat(type * (0.4 + 1.2 * uCloudTowering));
  float top = mix(0.3, 1.0, sat(tt * 0.75 + cov * 0.45));
  if (uCloudNoiseType > 1.5) top *= 0.6;
  else if (uCloudNoiseType > 0.5) top = mix(top, 1.0, 0.25);
  return vec4(0.0, 0.07, top * mix(0.3, 0.15, tt), top);
}

// per-cell tower heights (w.w = column noise)
vec4 cloudColumnGradient(vec4 w) {
  vec4 g = cloudGradient(w.y, w.x);
  float tt = sat(w.y * (0.4 + 1.2 * uCloudTowering));
  g.w = min(g.w * mix(1.0, mix(0.62, 1.18, w.w), 0.3 + 0.7 * tt), 1.0);
  g.z = min(g.z, g.w * 0.8);
  return g;
}

float cloudProfile(float hf, vec4 g) {
  return smoothstep(g.x, g.y, hf) * (1.0 - smoothstep(g.z, g.w, hf));
}

#ifdef CLOUD_PLANET
vec3 cloudRotate(vec3 d) {
  return vec3(d.x * uCloudRotCS.x - d.z * uCloudRotCS.y, d.y, d.x * uCloudRotCS.y + d.z * uCloudRotCS.x);
}

// Zonal wind shear: the upper part of a cloud is carried downstream, so
// towers lean. Trade-wind easterlies in the tropics, westerlies at mid
// latitudes.
vec3 shearOffset(vec3 d, float hf) {
  float lat = abs(d.y);
  float s = mix(-1.0, 1.0, smoothstep(0.42, 0.58, lat)) * (1.0 - smoothstep(0.85, 0.97, lat));
  return vec3(-d.z, 0.0, d.x) * (s * uCloudShear * hf);
}

vec4 weatherRotated(vec3 dr) {
  return mix(textureLod(uWeatherMap, dr, 0.0), textureLod(uWeatherMapNext, dr, 0.0), uWeatherBlend);
}

vec3 cloudUp(vec3 p) { return normalize(p); }

float heightFrac(vec3 p) {
  return (length(p) - uCloudBottom) / (uCloudTop - uCloudBottom);
}

// weather at p: x cover, y type, z unused, w column noise (-1 = not fetched)
vec4 cloudWeather(vec3 p, float hf) {
  vec3 d = normalize(p);
  vec4 w = weatherRotated(cloudRotate(d + shearOffset(d, hf)));
  return vec4(cloudCover(w), w.g, 0.0, -1.0);
}

vec4 cloudWeatherLight(vec3 p, float hf) {
  vec4 w = cloudWeather(p, hf);
  w.w = 0.5;
  return w;
}

// position of the billow noise (the billows ride a little of the shear)
vec3 billowPos(vec3 p, float hf) {
  float r = length(p);
  vec3 d = p / r;
  return cloudRotate(d + shearOffset(d, 0.3) * hf) * r;
}

// per-column tower height noise: sampled at the base radius so it is
// constant up a column
float columnNoise(vec3 p, float hf) {
  vec3 d = normalize(p);
  return textureLod(uCloudNoise, cloudRotate(d + shearOffset(d, hf)) * uCloudBottom * uCloudCellFreq + uCloudWind * 0.2 + uCloudVariationOffset, 0.0).r;
}

// direct sun reaching p: planet shadow with a soft penumbra and reddening
// toward the terminator (stands in for the transmittance LUT)
vec3 sunIrradiance(vec3 p) {
  float r = length(p);
  float mu = dot(p / r, uSunDir);
  float muH = -sqrt(max(1.0 - (uGroundRadius * uGroundRadius) / (r * r), 0.0));
  float lit = smoothstep(muH - 0.035, muH + 0.012, mu);
  float air = min(1.0 / max(mu - muH + 0.02, 0.02), 25.0);
  return uSunLight * lit * exp(-vec3(0.06, 0.14, 0.32) * air * 0.35);
}

vec3 skyIrradiance(vec3 p, float hf) {
  float mu = dot(normalize(p), uSunDir);
  float day = smoothstep(-0.22, 0.35, mu);
  return mix(uSkyBottom, uSkyTop, sat(hf)) * day + vec3(0.004, 0.005, 0.008) * 6.0;
}
#else
vec3 cloudUp(vec3 p) { return vec3(0.0, 1.0, 0.0); }

float heightFrac(vec3 p) {
  return (p.y - uCloudBottom) / (uCloudTop - uCloudBottom);
}

// Cubic B-spline reconstruction from four bilinear taps. Bilinear leaves a
// crease at every texel edge; the coverage threshold amplifies it, and since
// the cover is the same at every height each crease shows as a vertical
// streak on the cloud sides.
vec4 weatherBSpline(sampler2D tex, vec2 uv) {
  vec2 st = uv * uWeatherSize - 0.5;
  vec2 i = floor(st);
  vec2 f = st - i;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (-f3 + 3.0 * f2 - 3.0 * f + 1.0) / 6.0;
  vec2 w1 = (3.0 * f3 - 6.0 * f2 + 4.0) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1;
  vec2 g1 = 1.0 - g0;
  vec2 h0 = (i - 0.5 + w1 / g0) / uWeatherSize;
  vec2 h1 = (i + 1.5 + w3 / g1) / uWeatherSize;
  return g0.y * (g0.x * textureLod(tex, h0, 0.0) + g1.x * textureLod(tex, vec2(h1.x, h0.y), 0.0))
       + g1.y * (g0.x * textureLod(tex, vec2(h0.x, h1.y), 0.0) + g1.x * textureLod(tex, h1, 0.0));
}

vec4 weatherAt2D(vec2 F) {
  vec2 uv = (F - uWeatherCenter) * uWeatherInvSpan + 0.5;
  return mix(weatherBSpline(uWeatherMap, uv), weatherBSpline(uWeatherMapNext, uv), uWeatherBlend);
}

// the clouds fade out toward the edge of the disc over the board
float edgeFade(vec3 p) {
  float d = cloudFootprintDist(p.xz - uCloudCenter) / max(uCloudRadius, 1.0);
  return 1.0 - smoothstep(0.72, 1.0, d);
}

// bilinear weather for the light march (a coarse lookup is enough there)
vec2 weatherWarp(vec3 p) {
  // A weather map is 2D. Warp it with a genuinely 3D field so the edges of
  // thick clouds round off at each height instead of forming vertical walls.
  vec2 n = textureLod(uCloudNoise, p * uCloudShapeFreq * 0.7
    + uCloudVariationOffset + uCloudWind * 0.35, 0.0).rg;
  return (n - vec2(0.65, 0.55)) * (0.35 / max(uCloudShapeFreq, 1e-6));
}

vec4 cloudWeatherLight(vec3 p, float hf) {
  vec2 F = p.xz - uFieldShift - uShearDir * (uCloudShear * hf);
  F += weatherWarp(p);
  vec2 uv = (F - uWeatherCenter) * uWeatherInvSpan + 0.5;
  vec4 w = mix(textureLod(uWeatherMap, uv, 0.0), textureLod(uWeatherMapNext, uv, 0.0), uWeatherBlend);
  return vec4(cloudCover(w) * edgeFade(p), w.g, 0.0, 0.5);
}

vec4 cloudWeather(vec3 p, float hf) {
  vec2 F = p.xz - uFieldShift;
  F += weatherWarp(p);
  vec4 w = weatherAt2D(F - uShearDir * (uCloudShear * hf));
  return vec4(cloudCover(w) * edgeFade(p), w.g, 0.0, -1.0);
}

vec3 billowPos(vec3 p, float hf) {
  vec2 F = p.xz - uFieldShift - uShearDir * (uCloudShear * 0.3 * hf);
  return vec3(F.x, p.y, F.y);
}

float columnNoise(vec3 p, float hf) {
  vec2 F = p.xz - uFieldShift - uShearDir * (uCloudShear * hf);
  return textureLod(uCloudNoise, vec3(F.x, uCloudBottom, F.y) * uCloudCellFreq + uCloudWind * 0.2 + uCloudVariationOffset, 0.0).r;
}

vec3 sunIrradiance(vec3 p) { return uSunLight; }

vec3 skyIrradiance(vec3 p, float hf) {
  return mix(uSkyBottom, uSkyTop, sat(hf)) + vec3(0.004, 0.005, 0.008) * 6.0;
}
#endif

#define TOP_JITTER 0.09

// Density at height fraction hf of column g / cover cov; pr = billow position.
float cloudShape(vec3 pr, float hf, vec4 g, float cov, float detail) {
  if (hf <= 0.0 || hf >= 1.0 || hf >= g.w + 1.1 * TOP_JITTER) return 0.0;
  vec3 noisePoint = pr * uCloudShapeFreq + uCloudWind * 0.35 + uCloudVariationOffset;
  if (uCloudNoiseType > 1.5) noisePoint *= vec3(0.55, 1.7, 1.4);
  else if (uCloudNoiseType > 0.5) noisePoint *= 0.75;
  vec2 n = textureLod(uCloudNoise, noisePoint, 0.0).rg;
  // The billows move the top ramp: per-column top heights alone have no
  // vertical structure, and seen from the side they read as vertical
  // streaks running down the whole body. The flat bases stay flat.
  float hTop = hf + (n.x - 0.55) * (2.0 * TOP_JITTER);
  float prof = smoothstep(g.x, max(g.y, 0.12), hf) * (1.0 - smoothstep(max(g.z, g.w * 0.4), g.w, hTop));
  if (prof <= 0.0) return 0.0;
  float base = sat(remap(n.y, mix(0.24, 0.38, n.x), 0.82, 0.0, 1.0));
  if (uCloudNoiseType > 1.5) base = pow(base, 1.35);
  else if (uCloudNoiseType > 0.5) base = mix(base, 0.35 + 0.65 * smoothstep(0.25, 0.75, n.x), 0.55);
  // profile BEFORE the coverage remap: each column gets its own top height
  // (cauliflower tops); coverage thresholds the billows so system fringes
  // break into cumulus fields and turn translucent
  float dens = sat(remap(base * prof, 1.0 - cov, 1.0, 0.0, 1.0)) * cov;
  if (uCloudNoiseType > 1.5) dens *= 0.62;
  if (detail <= 0.0 || dens <= 0.0) return dens;
  // erosion: wispy bottoms, billowy tops
  float hfb = textureLod(uCloudErosion, pr * uCloudDetailFreq + uCloudWind + uCloudVariationOffset, 0.0).r;
  float m = mix(hfb, 1.0 - hfb, sat(hf * 4.0));
  return sat(remap(dens, m * 0.8 * uCloudDetail * detail, 1.0, 0.0, 1.0));
}

float cloudDensityAt(vec3 p, float detail) {
  float hf = heightFrac(p);
  if (hf <= 0.0 || hf >= 1.0) return 0.0;
  vec4 w = cloudWeather(p, hf);
  if (w.x <= 0.01) return 0.0;
  w.w = columnNoise(p, hf);
  return cloudShape(billowPos(p, hf), hf, cloudColumnGradient(w), w.x, detail);
}
`;

export const REALISTIC_CLOUD_FRAGMENT = /* glsl */ `
${REALISTIC_CLOUD_FIELD_GLSL}

vec3 reconstructWorldPosition(vec2 uv, float depth) {
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uProjectionMatrixInverse * clip;
  view.xyz /= view.w;
  return (uViewMatrixInverse * vec4(view.xyz, 1.0)).xyz;
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorldPos - cameraPosition);
  float thick = uCloudTop - uCloudBottom;

  // ---- the layer segment [t0, t1] along the ray
  float t0 = 0.0, t1 = -1.0;
#ifdef CLOUD_PLANET
  float camR = length(ro);
  vec2 tOut = raySphere(ro, rd, uCloudTop);
  vec2 tIn = raySphere(ro, rd, uCloudBottom);
  bool hitsIn = tIn.x < tIn.y && tIn.x > 0.0;
  if (tOut.x < tOut.y && tOut.y > 0.0) {
    if (camR > uCloudTop)          { t0 = tOut.x; t1 = hitsIn ? tIn.x : tOut.y; }
    else if (camR > uCloudBottom)  { t0 = 0.0;    t1 = hitsIn ? tIn.x : tOut.y; }
    else                           { t0 = tIn.y;  t1 = tOut.y; }
  }
  // the sea sphere occludes the layer even where nothing wrote depth
  vec2 tg = raySphere(ro, rd, uGroundRadius);
  if (tg.x < tg.y && tg.x > 0.0) t1 = min(t1, tg.x);
#else
  if (abs(rd.y) < 1e-5) {
    if (ro.y > uCloudBottom && ro.y < uCloudTop) { t0 = 0.0; t1 = uCloudFar; }
  } else {
    float ta = (uCloudBottom - ro.y) / rd.y;
    float tb = (uCloudTop - ro.y) / rd.y;
    t0 = max(min(ta, tb), 0.0);
    t1 = min(max(ta, tb), uCloudFar);
  }
  // clamp to the cloud footprint (zero cover past it)
  if (!cloudFootprintClip(ro.xz - uCloudCenter, rd.xz, t0, t1)) discard;
#endif
  if (t1 <= t0) discard;

  // The unclipped segment sets the sample lattice; the opaque scene only
  // shortens it (redistributing samples per pixel would make the field jump
  // at terrain silhouettes).
  float segLen = t1 - t0;
  float tEnd = t1;
  vec2 depthUv = gl_FragCoord.xy / max(uDepthResolution, vec2(1.0));
  if (uUseDepth > 0.5 && depthUv.x >= 0.0 && depthUv.x <= 1.0 && depthUv.y >= 0.0 && depthUv.y <= 1.0) {
    float sceneDepth = texture2D(tSceneDepth, depthUv).x;
    if (sceneDepth < 0.99999) {
      vec3 sceneHit = reconstructWorldPosition(depthUv, sceneDepth);
      float hitT = dot(sceneHit - ro, rd) - uDepthBias;
      tEnd = min(tEnd, hitT);
    }
  }
  if (tEnd <= t0) discard;

  // Use the requested quality budget. The old billow-based estimate fell to
  // 12–24 steps in thick clouds even at 96-step quality, leaving horizontal
  // contour bands at their bases. Integrate complete, disjoint intervals.
  float steps = clamp(uCloudSteps, 12.0, float(${REALISTIC_MAX_STEPS}));

  float T = 1.0;
  vec3 L = vec3(0.0);

  // extinction per world unit: a full-thickness dense column is ~OD 14
  float sigma = 14.0 / thick * uCloudDensity;
  float cosT = dot(rd, uSunDir);
  vec3 tint = srgbToLinear(uCloudColor);
  vec3 ambTint = srgbToLinear(uCloudSkyTint);
  // multiple-scattering octaves: forward lobe = silver linings, back lobe
  // keeps the sides lit; the phases only depend on the view / sun angle
  vec3 msPh = vec3(mix(phaseHG(cosT, 0.7), phaseHG(cosT, -0.25), 0.4) + phaseHG(cosT, 0.88) * 0.3 * uCloudSilver,
                   mix(phaseHG(cosT, 0.35), phaseHG(cosT, -0.125), 0.4) * 0.5,
                   mix(phaseHG(cosT, 0.175), phaseHG(cosT, -0.0625), 0.4) * 0.25);
  // powder darkening eases off looking toward the sun, where thin edges glow
  float powderView = 1.0 - 0.7 * sat(cosT);

  for (int i = 0; i < ${REALISTIC_MAX_STEPS} + uLoopGuard; i++) {
    float intervalStart = t0 + segLen * float(i) / steps;
    if (float(i) >= steps || T < 0.01 || intervalStart >= tEnd) break;
    float ds = segLen / steps;
    float dsi = min(ds, tEnd - intervalStart);
    float t = intervalStart + dsi * 0.5;
    vec3 p = ro + rd * t;
    float hf = heightFrac(p);
    if (hf > 0.0 && hf < 1.0) {
      // one weather lookup per sample, reused by the light march
      vec4 w = cloudWeather(p, hf);
      float dens = 0.0;
      vec4 g = vec4(0.0);
      if (w.x > 0.01) {
        // Use the same column at every height; conditionally changing its
        // height partway through the march created a visible horizontal shelf.
        w.w = columnNoise(p, hf);
        g = cloudColumnGradient(w);
        // erosion fades out where the step is longer than its cells: under-
        // sampled detail only adds aliasing (streaks on long grazing rays)
        float detailW = sat(2.0 - ds * uCloudDetailFreq * 4.0);
        // Two symmetric density taps, each with its own weather and profile.
        // Lighting stays at the interval centre, so surface brightness cannot
        // turn a pixel's random sampling phase into visible grain or stripes.
        vec3 offset = rd * (dsi * 0.288675);
        dens = 0.5 * (cloudDensityAt(p - offset, detailW) + cloudDensityAt(p + offset, detailW));
      }
      if (dens > 0.003) {
        // light march toward the sun (cone-ish growing steps)
        float odL = 0.0;
        float ls = thick * 0.06;
        vec3 lp = p;
        for (int j = 0; j < 5 + uLoopGuard; j++) {
          lp += uSunDir * ls;
          float hj = heightFrac(lp);
          // past the first step the sun ray has left this column: its own
          // cover and profile (reusing the sample's column, as on a thin
          // planet shell, lit thick slabs in vertical bands per column)
          if (hj > 0.0 && hj < 1.0) {
            vec4 wl = cloudWeatherLight(lp, hj);
            wl.w = columnNoise(lp, hj);
            if (wl.x > 0.01) odL += cloudShape(billowPos(lp, hj), hj, cloudColumnGradient(wl), wl.x, j < 2 ? 1.0 : 0.0) * ls;
          }
          ls *= 1.6;
        }
        odL *= sigma;

        float ms = dot(msPh, exp(-odL * vec3(1.0, 0.55, 0.3025)));
        float powder = 1.0 - exp(-dens * sigma * thick * 0.15);
        vec3 up = cloudUp(p);
        vec3 sunC = sunIrradiance(p);
        // less of the sky dome reaches deep under a tall top
        float skyVis = mix(0.4, 1.0, sat(hf / max(g.w, 0.05)));
        vec3 amb = skyIrradiance(p, hf) / PI * skyVis * ambTint;
        // light bounced off the sunlit ground below the bases
        vec3 bounce = sunC * (max(dot(up, uSunDir), 0.0) * 0.05 * (1.0 - hf));
        vec3 S = (sunC * ms * mix(1.0, mix(0.45, 1.0, powder), powderView) * 2.8 + amb * 1.1 + bounce) * tint;

        float Tr = exp(-dens * sigma * dsi);
        L += T * S * (1.0 - Tr);
        T *= Tr;
      }
    }
  }

  float alpha = 1.0 - T;
  if (alpha < 0.003) discard;
  // the layer is drawn over an already display-encoded frame: expose + ACES +
  // sRGB here (Procedural Planets does it once in its composite)
  vec3 col = aces(L / alpha * uExposure * 0.85);
  gl_FragColor = vec4(linearToSrgb(col), alpha);
}
`;
