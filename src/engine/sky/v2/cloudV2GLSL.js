import { CLOUD_FOOTPRINT_GLSL } from '../cloudFootprintGLSL.js';
// ============================================================================
// Realistic V2 cloud mode — GLSL. Billowy cumulus from two baked, mip-mapped
// textures (see render/NoiseVolumeV2.js): a tileable weather map places the
// formations, a Perlin-Worley volume shapes them and Worley octaves erode the
// edges. Lighting is a short cone march toward the sun with a three-term
// multiple-scattering fit, plus height-graded sky light.
//
// Why it is cheap for how it looks:
//   - every noise tap is one explicit-LOD lookup; the level follows the march
//     step, so long steps read pre-filtered noise (no aliasing, cache friendly)
//   - the weather map rejects empty sky before any volume tap
//   - a dither-free sample lattice: equal slices of the layer crossing, or
//     distance-growing steps on long grazing rays, so the budget goes where
//     it is visible and there is no grain to filter away afterwards
//   - erosion taps only run on samples that survived the base shape
//
// Loops are bounded by constants + the zero-valued uLoopGuard (real loops on
// ANGLE/D3D instead of an unrolled program).
// ============================================================================

export const CLOUD_V2_MAX_STEPS = 128;

export const CLOUD_V2_VERTEX = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// Density field + its uniforms. Shared by the volumetric pass and the terrain
// cloud-shadow pass.
export const CLOUD_V2_FIELD_GLSL = /* glsl */ `
precision highp float;
precision highp sampler3D;

uniform int uLoopGuard;
uniform highp sampler3D uNoiseV2;     // r Perlin-Worley, gba Worley fbm
uniform sampler2D uWeatherV2;         // r Perlin, g Worley cells, b Perlin
uniform vec3  uCloudOffset;           // wind drift (xz) + evolution (y), world units
uniform vec3  uCloudVariationOffset;  // seed: xy weather uv, xyz noise domain
uniform float uCloudWeatherFreq;      // weather tiles per world unit
uniform float uCloudNoiseFreq;        // shape-noise tiles per world unit
uniform float uCloudWarp;             // billow warp of the weather lookup (uv)
uniform float uCloudCoverage;
uniform float uCloudEdge;             // coverage ramp width
uniform float uCloudDetail;           // erosion strength
uniform float uCloudTopMin;           // lowest top height of a thin cloud (0..1)
uniform float uCloudContrast;         // base-shape remap (noise type)
uniform float uCloudShear;            // world units the layer top is carried
uniform vec2  uShearDir;
uniform float uCloudBottom;
uniform float uCloudTop;
uniform float uCloudRefDepth;         // natural depth of one cloud (world units)
uniform vec2  uCloudCenter;           // XZ centre of the cloud disc
uniform float uCloudRadius;
uniform float uCloudFar;
${CLOUD_FOOTPRINT_GLSL}

float cv2Sat(float x) { return clamp(x, 0.0, 1.0); }
float cv2Remap(float v, float a, float b, float c, float d) {
  return c + (v - a) / max(b - a, 1e-4) * (d - c);
}

// the clouds fade out toward the edge of the disc over the board
float cv2EdgeFade(vec2 xz) {
  float d = cloudFootprintDist(xz - uCloudCenter) / max(uCloudRadius, 1.0);
  return 1.0 - smoothstep(0.72, 1.0, d);
}

float cloudV2Density(vec3 p, float lod, bool detail) {
  float hf = (p.y - uCloudBottom) / (uCloudTop - uCloudBottom);
  if (hf <= 0.0 || hf >= 1.0) return 0.0;
  // Height in natural cloud depths. A layer thinner than one depth squashes
  // the clouds into it (hf); a thicker one lets them keep growing (z).
  float z = (p.y - uCloudBottom) / uCloudRefDepth;
  float rise = max(hf, z);
  float fade = cv2EdgeFade(p.xz);
  if (fade <= 0.0) return 0.0;

  vec3 q = p + uCloudOffset;
  q.xz -= uShearDir * (uCloudShear * hf);
  vec2 wuv = q.xz * uCloudWeatherFreq + uCloudVariationOffset.xy;
  vec4 w = textureLod(uWeatherV2, wuv, 0.0);
  float th = mix(1.02, 0.40, uCloudCoverage);
  // empty sky: one 2D fetch and out
  if (w.g * 0.58 + w.r * 0.70 < th - 0.10) return 0.0;

  vec3 nq = q * uCloudNoiseFreq + uCloudVariationOffset;
  vec4 n = textureLod(uNoiseV2, nq, lod);
  // billow the footprint: warp the weather lookup with the shape noise
  w = textureLod(uWeatherV2, wuv + (n.gb - 0.55) * uCloudWarp, 0.0);
  float sig = w.g * 0.58 + w.r * 0.70 + (n.a - 0.5) * 0.10;
  // Above one natural depth only the stronger cores keep rising, and less and
  // less of them: a thicker layer grows tapering towers on the same clouds
  // instead of extruding every footprint into a pillar up to the ceiling.
  float over = max(z - 1.0, 0.0);
  sig -= 0.14 * over * over;
  float cov = smoothstep(th, th + uCloudEdge, sig) * fade;
  if (cov <= 0.002) return 0.0;

  // dense cores build higher than their fringes: domed tops, flat bases
  float topH = mix(uCloudTopMin, 1.0, cv2Sat(cov * 0.85 + (w.b - 0.5) * 0.9));
  float prof = smoothstep(0.0, 0.07, rise) * (1.0 - smoothstep(topH * 0.45, topH, hf));
  float lowF = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
  float base = cv2Sat(cv2Remap(n.r, (1.0 - lowF) * uCloudContrast, 1.0, 0.0, 1.0)) * prof;
  float d = cv2Remap(base, 1.0 - cov * 0.86, 1.0, 0.0, 1.0) * cov;
  if (d <= 0.0) return 0.0;

  if (detail) {
    // erosion: wispy bases, billowy tops
    vec3 hn = textureLod(
      uNoiseV2,
      nq * 5.658 + vec3(0.0, uCloudOffset.y * uCloudNoiseFreq * 8.6, 0.0),
      lod
    ).gba;
    float hfb = hn.r * 0.625 + hn.g * 0.25 + hn.b * 0.125;
    float m = mix(hfb, 1.0 - hfb, cv2Sat(rise * 5.0));
    d = cv2Remap(d, m * 0.50 * uCloudDetail, 1.0, 0.0, 1.0);
    if (d > 0.0 && d < 0.35) {
      // finest wisps only where the body thins out
      vec3 hn2 = textureLod(uNoiseV2, nq * 15.93, lod).gba;
      d = cv2Remap(
        d,
        (1.0 - (hn2.r * 0.6 + hn2.g * 0.4)) * 0.16 * uCloudDetail * (1.0 - d / 0.35),
        1.0, 0.0, 1.0
      );
    }
  }
  return cv2Sat(d * 2.6);
}
`;

export const CLOUD_V2_FRAGMENT = /* glsl */ `
${CLOUD_V2_FIELD_GLSL}

varying vec3 vWorldPos;

uniform float uCloudSigma;       // extinction per world unit at density 1
uniform float uCloudSteps;
uniform float uCloudMinStep;     // finest march step (world units)
uniform float uCloudJitter;      // 1 = dithered lattice (filtered low-res pass)
uniform float uCloudSilver;
uniform vec3  uCloudColor;       // sRGB albedo tint
uniform vec3  uCloudSkyTint;     // sRGB tint of the sky-lit part
uniform float uExposure;

uniform vec3 uSunDir;
uniform vec3 uSunLight;          // linear sun irradiance (HDR)
uniform vec3 uSkyTop;            // linear sky irradiance above / below the layer
uniform vec3 uSkyBottom;

uniform sampler2D tSceneDepth;
uniform vec2 uDepthResolution;
uniform mat4 uProjectionMatrixInverse;
uniform mat4 uViewMatrixInverse;
uniform float uDepthBias;
uniform float uUseDepth;

vec3 cv2SrgbToLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }

vec3 cv2LinearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 cv2Aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

float cv2Phase(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5);
}

vec3 cv2WorldFromDepth(vec2 uv, float depth) {
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uProjectionMatrixInverse * clip;
  view.xyz /= view.w;
  return (uViewMatrixInverse * vec4(view.xyz, 1.0)).xyz;
}

// optical depth toward the sun: six growing steps, erosion on the first two
float cv2LightMarch(vec3 p, float ds) {
  float od = 0.0;
  for (int i = 0; i < 6 + uLoopGuard; i++) {
    p += uSunDir * ds;
    od += cloudV2Density(p, 1.0 + float(i) * 0.5, i < 2) * ds;
    ds *= 1.6;
  }
  return od;
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorldPos - cameraPosition);
  float thick = uCloudTop - uCloudBottom;

  // ---- the layer segment [t0, t1] along the ray
  float t0 = 0.0;
  float t1 = -1.0;
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
  if (t1 <= t0) discard;

  // The unclipped segment sets the sample spacing; the opaque scene only
  // shortens the march (per-pixel respacing would make the field jump at
  // terrain silhouettes).
  float segLen = t1 - t0;
  float tEnd = t1;
  vec2 depthUv = gl_FragCoord.xy / max(uDepthResolution, vec2(1.0));
  if (uUseDepth > 0.5 && depthUv.x >= 0.0 && depthUv.x <= 1.0 && depthUv.y >= 0.0 && depthUv.y <= 1.0) {
    float sceneDepth = texture2D(tSceneDepth, depthUv).x;
    if (sceneDepth < 0.99999) {
      vec3 sceneHit = cv2WorldFromDepth(depthUv, sceneDepth);
      tEnd = min(tEnd, dot(sceneHit - ro, rd) - uDepthBias);
    }
  }
  if (tEnd <= t0) discard;

  float steps = clamp(uCloudSteps, 12.0, float(${CLOUD_V2_MAX_STEPS}));
  // Sample lattice, no dither. A ray that crosses the layer spends the whole
  // budget on equal slices of the crossing: every pixel then samples the same
  // heights, so the result is a stack of smooth slices instead of per-pixel
  // grain (nothing for an upscale or the eye to pick up as stripes). Long
  // grazing rays (camera in or near the layer) switch to steps that grow with
  // distance, fine near the eye and coarse toward the horizon.
  float dtSlice = segLen / steps;
  float dtMin = uCloudMinStep;
  float lodScale = uCloudNoiseFreq * 86.0;
  // The noise level never drops below the one a mid-distance view uses. The
  // field is shaped by thresholds, so its sharpest mip is a different (far
  // more eroded) cloud: without the floor a cloud thins out and vanishes as
  // the camera closes in and the steps shorten.
  float lodFloor = 2.1;

  float mu = dot(rd, uSunDir);
  float ph = mix(cv2Phase(mu, 0.72), cv2Phase(mu, -0.22), 0.38);
  // Silver Lining scales only the forward peak (1 = physical lobe)
  ph = min(ph, 1.2) + max(ph - 1.2, 0.0) * clamp(uCloudSilver, 0.0, 2.0);
  float phSoft = mix(ph, 1.0, 0.65);
  vec3 tint = cv2SrgbToLinear(uCloudColor);
  vec3 ambTint = cv2SrgbToLinear(uCloudSkyTint) * 1.35;
  vec3 sunCol = uSunLight * 0.55;
  float lightStep = min(thick, uCloudRefDepth) * 0.0281;

  float T = 1.0;
  vec3 L = vec3(0.0);
  float t = t0;
  // Low-res pass only: interleaved-gradient offset of the lattice. Any 3x3
  // pixel block holds nine well-spread offsets, which the tent upscale
  // averages into the equivalent of a much finer march. Rendered inline (no
  // filter) the lattice stays fixed and coherent instead.
  t += min(dtSlice, max(dtMin, t * 0.032)) * uCloudJitter
    * fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
  vec3 lit = vec3(0.0);
  for (int i = 0; i < ${CLOUD_V2_MAX_STEPS} + uLoopGuard; i++) {
    if (float(i) >= steps || t >= tEnd || T < 0.012) break;
    float stride = min(dtSlice, max(dtMin, t * 0.032));
    // integrate the part of this interval in front of the opaque scene
    float dt = min(stride, tEnd - t);
    vec3 p = ro + rd * (t + dt * 0.5);
    float lod = clamp(log2(max(stride * lodScale, lodFloor)), 0.0, 4.0);
    float dn = cloudV2Density(p, lod, true);
    if (dn > 0.0) {
      // The sun march is the expensive part. Once most of the pixel is
      // resolved the remaining samples weigh little: they reuse the last
      // lighting, dimmed as they sit deeper in the cloud.
      if (T > 0.22 || lit == vec3(0.0)) {
        float od = cv2LightMarch(p, lightStep) * uCloudSigma;
        // direct + two wider, deeper-reaching scattering orders
        float lum = exp(-od) * ph + 0.34 * exp(-od * 0.26) * phSoft + 0.11 * exp(-od * 0.06);
        float hf = (p.y - uCloudBottom) / thick;
        vec3 amb = mix(uSkyBottom, uSkyTop * 1.7, hf) * ambTint * exp(-dn * 0.6);
        lit = (sunCol * lum * 0.66 + amb) * tint;
      } else {
        lit *= 0.86;
      }
      float Tr = exp(-dn * uCloudSigma * dt);
      L += T * (1.0 - Tr) * lit;
      T *= Tr;
    }
    t += stride;
  }

  float alpha = 1.0 - T;
  if (alpha < 0.003) discard;
  // drawn over an already display-encoded frame: expose + ACES + sRGB here
  vec3 col = cv2Aces(L / alpha * uExposure * 0.54);
  gl_FragColor = vec4(cv2LinearToSrgb(col), alpha);
}
`;
