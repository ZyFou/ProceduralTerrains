import * as THREE from 'three';
import { MINI_BEVEL_GLSL } from './MiniBevel.js';
import { MINI_LIGHTING_GLSL, miniLightingUniforms } from './MiniLighting.js';
import { WATER_OPTICS_GLSL } from '../water/waterOpticsGLSL.js';
import { WATER_WAVES_GLSL } from '../water/waterWavesGLSL.js';

// ============================================================================
// Mini Terrain water — a dedicated stylised water for the diorama.
//
// One colour model shared by the SURFACE and the CUT FACES so the edge of the
// volume reads as the same water seen from two sides:
//   * the seen background (water-free scene capture: colour + depth) is
//     refracted, lit by caustics where it is submerged and sunlit, then
//     absorbed along the real optical path (Beer–Lambert, red first);
//   * the in-scattered body colour depends on the depth of water above the
//     point that is seen (pale turquoise shallows → teal → deep blue);
//   * the surface adds a soft studio reflection (Fresnel), a restrained sun
//     glint (never burned), cliff shadows from the Mini light map and a thin
//     animated shore foam;
//   * the cut faces add only a crisp glass edge at the waterline and corners.
//
// Short, moderate waves sized to the diorama live in the normals only; the
// surface stays flat at the water level so it always meets the cut faces.
// All per-pixel sums are written out (no loops) for ANGLE/FXC.
// Realistic variant (MINI_WATER_REALISTIC define, Water Shader = Realistic):
// the classic worlds' wave field (spectrum + gusts + aperiodic ripples) and
// optics — the deep colour is the water body, the shallow hue sets spectral
// absorption, Schlick Fresnel and a GGX sun. The define compiles a separate
// program, so the Stylized program is untouched when it is off.
// Reflections (both variants): sky only, sky + terrain mirrored by marching
// the light-map / bake height field, or off; strength, blur and distortion.
// Without a scene capture (should not happen in Mini, which always runs a
// capture-capable backend) the material falls back to premultiplied alpha.
//
// The same surface also serves the "Stylized" water mode of the classic
// worlds (Tile / Infinite, see water/StylizedWaterLayer.js): unbounded
// (uMiniHalf huge), reflecting the procedural sky instead of the studio
// backdrop, fogged like the terrain, and reading the water depth from the
// studio height bake when one is current (else from the captured scene).
// ============================================================================

export const MINI_WATER_COMMON_GLSL = /* glsl */ `
${MINI_LIGHTING_GLSL}
${MINI_BEVEL_GLSL}
uniform vec3 uSunDir;
uniform float uSeaLevel;
uniform float uTime;

uniform vec3 uMiniWaterShallow;
uniform vec3 uMiniWaterMid;
uniform vec3 uMiniWaterDeep;
uniform vec3 uMiniWaterSide;
uniform vec3 uMiniWaterAbsorb;    // per-channel absorption per world unit
uniform float uMiniWaterDepthRange;
uniform float uMiniWaterAnim;     // animated time (seconds * speed, 0 when paused)
uniform float uMiniHalf;
uniform float uMiniWaterEdges;
uniform float uMiniWaterBevel;
uniform float uMiniBevelRounded;
uniform float uMiniCaustics;

uniform sampler2D uMiniLightTex;  // R = sun visibility, G = AO, B = terrain height
uniform float uMiniLightEnabled;

uniform sampler2D uSceneColor;
uniform sampler2D uSceneDepth;
uniform vec2 uSceneViewportInv;
uniform float uSceneNear;
uniform float uSceneFar;
uniform float uSceneRefractionEnabled;

float miniLinearDepth(float rawDepth) {
  float z = rawDepth * 2.0 - 1.0;
  return (2.0 * uSceneNear * uSceneFar)
    / max(uSceneFar + uSceneNear - z * (uSceneFar - uSceneNear), 0.0001);
}

// Distance from the camera to the opaque scene along this pixel's ray.
float miniSceneDistance(vec2 uv, vec3 rayDir) {
  vec3 camForward = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  float cosA = max(dot(rayDir, camForward), 1e-3);
  return miniLinearDepth(texture2D(uSceneDepth, uv).r) / cosA;
}

vec3 miniSceneColor(vec2 uv) {
  return pow(max(texture2D(uSceneColor, uv).rgb, vec3(0.0)), vec3(2.2));
}

vec3 miniLight(vec2 xz) {
  if (uMiniLightEnabled < 0.5) return vec3(1.0, 1.0, uSeaLevel - 30.0);
  vec2 uv = xz / max(uMiniHalf * 2.0, 1.0) + 0.5;
  return texture2D(uMiniLightTex, clamp(uv, 0.0, 1.0)).rgb;
}

// Body colour for a column of water of the given depth.
#ifdef MINI_WATER_REALISTIC
// Realistic: the in-scattered colour of the water itself. Depth shows through
// absorption of the floor, not through a painted shallow→deep ramp.
vec3 miniWaterBody(float depth) {
  return uMiniWaterDeep * 0.6;
}
#else
vec3 miniWaterBody(float depth) {
  float r = max(uMiniWaterDepthRange, 1.0);
  vec3 c = mix(uMiniWaterShallow, uMiniWaterMid, smoothstep(0.0, r * 0.35, depth));
  return mix(c, uMiniWaterDeep, smoothstep(r * 0.25, r, depth));
}
#endif

float miniCausticLayer(vec2 p, float t) {
  vec2 w = p + 0.55 * vec2(sin(p.y * 1.7 + t), sin(p.x * 1.3 - t * 0.8));
  float v = sin(w.x * 2.2) * sin(w.y * 2.2);
  float line = 1.0 - abs(v);
  return line * line * line * line * line * line;
}

float miniCaustic(vec2 xz, float t) {
  float a = miniCausticLayer(xz * 0.075, t * 0.9);
  float b = miniCausticLayer(xz * 0.11 + vec2(3.1, 1.7), -t * 0.75);
  return min(a, b) * 0.9 + max(a, b) * 0.08;
}
`;

const SURFACE_VERTEX = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SURFACE_FRAGMENT = /* glsl */ `
precision highp float;
${MINI_WATER_COMMON_GLSL}
uniform float uMiniRefraction;
uniform float uMiniWaveStrength;
uniform float uMiniFoamWidth;
uniform float uMiniReflect;
uniform float uMiniWaveScale;
uniform float uWaterQuality;
uniform float uWaterDetail;
uniform float uWaterReflection;
uniform float uWaveComplexity;
uniform float uMiniSpecular;
uniform float uMiniFoamStrength;
uniform vec3 uMiniFoamColor;
// environment: 0 = studio backdrop (Mini), 1 = procedural sky colours
uniform float uMiniEnvSky;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uFogColor;
uniform float uFogDensity;
// depth source when no Mini light map: the studio height bake (if current)
uniform sampler2D uTerrainHeightTex;
uniform float uUseTerrainHeightTex;
uniform float uMiniBakeDepth;
uniform vec2 uBakeOrigin;
uniform vec2 uBakeSpan;
uniform float uHeightScale;
// Infinite World: the plane ends at the terrain render distance
uniform float uWaterFadeStart;
uniform float uWaterFadeEnd;
// reflections
uniform float uMiniReflectTerrain;   // 1 = mirror the terrain height field
uniform int uMiniTraceSteps;         // height-field march length (0 = off)
uniform float uMiniReflectBlur;      // 0 sharp … 1 soft
uniform float uMiniReflectDistort;   // how far the waves bend reflections
uniform float uMiniShoreClear;       // width of the fully clear waterline band
uniform vec2 uSceneTexelSize;
uniform mat4 projectionMatrix;
varying vec3 vWorldPos;

#ifdef MINI_WATER_REALISTIC
uniform vec2 uWaveDir;
uniform float uWaveScale;
uniform float uWaveSpeed;
uniform float uWaveStrength;
uniform float uLargeWaveStr;
uniform float uSmallWaveStr;
uniform float uNormalIntensity;
uniform float uMicroWaveDetail;

float miniValueHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Same quintic value noise as the terrain, used by the shared wave field.
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = miniValueHash(i);
  float b = miniValueHash(i + vec2(1.0, 0.0));
  float c = miniValueHash(i + vec2(0.0, 1.0));
  float d = miniValueHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

${WATER_OPTICS_GLSL}
${WATER_WAVES_GLSL}
#endif

float miniHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 miniGradDir(vec2 i) {
  float a = miniHash(i) * 6.2831853;
  return vec2(cos(a), sin(a));
}

// Gradient noise with analytic derivatives: x = value, yz = d/dx, d/dy.
// Unlike value noise it has no axis-aligned cell plateaus, so the ripples
// never read as a grid.
vec3 miniGradNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec2 ga = miniGradDir(i);
  vec2 gb = miniGradDir(i + vec2(1.0, 0.0));
  vec2 gc = miniGradDir(i + vec2(0.0, 1.0));
  vec2 gd = miniGradDir(i + vec2(1.0, 1.0));
  float va = dot(ga, f);
  float vb = dot(gb, f - vec2(1.0, 0.0));
  float vc = dot(gc, f - vec2(0.0, 1.0));
  float vd = dot(gd, f - vec2(1.0, 1.0));
  float k = va - vb - vc + vd;
  float v = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * k;
  vec2 d = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd)
         + du * (u.yx * k + vec2(vb, vc) - va);
  return vec3(v, d);
}

float miniNoise(vec2 p) {
  return miniGradNoise(p).x * 0.5 + 0.5;
}

// One trochoid-like wave band: sharp crests (exp(sin - 1)), deep-water
// dispersion (longer waves travel faster) and a band limit against the pixel
// footprint so distant water never aliases into a shimmering grid.
vec2 miniWaveBand(vec2 p, float angle, float len, float slope, float t, float footprint) {
  vec2 dir = vec2(cos(angle), sin(angle));
  float k = 6.2831853 / len;
  float phase = dot(p, dir) * k - t * sqrt(9.81 * k) * 0.55;
  float s = sin(phase);
  float limit = 1.0 - smoothstep(len * 0.12, len * 0.38, footprint);
  return dir * (exp(s - 1.0) * cos(phase) * slope * limit);
}

vec3 miniWaterNormal(vec2 p, float t, float footprint, float calm) {
  if (uWaveComplexity <= 0.0) return vec3(0.0, 1.0, 0.0);
  vec2 q = p;
  if (uWaterQuality > 0.5) {
    // slow domain warp bends every crest line: no straight, repeating rows
    vec3 w0 = miniGradNoise(p * 0.011 + vec2(t * 0.013, -t * 0.009));
    vec3 w1 = miniGradNoise(p * 0.011 + vec2(17.3, -4.1) - vec2(t * 0.011, t * 0.007));
    q += vec2(w0.x, w1.x) * 14.0;
  }

  float wind = 0.62;
  vec2 s = vec2(0.0);
  s += miniWaveBand(q, wind - 0.92, 41.0, 0.050, t, footprint);
  s += miniWaveBand(q, wind + 0.58, 27.8, 0.055, t, footprint);
  s += miniWaveBand(q, wind - 0.27, 19.4, 0.060, t, footprint);
  if (uWaterQuality > 0.5) {
    s += miniWaveBand(q, wind + 1.13, 13.6, 0.055, t, footprint) * uWaveComplexity;
    s += miniWaveBand(q, wind + 0.09, 9.8, 0.060, t, footprint);
  }
  if (uWaterQuality > 1.5) {
    s += miniWaveBand(q, wind - 1.41, 6.9, 0.050, t, footprint);
    s += miniWaveBand(q, wind + 0.37, 4.7, 0.045, t, footprint);
  }

  // capillary ripples: two rotated, drifting gradient-noise octaves
  const mat2 ROT_A = mat2(0.80, -0.60, 0.60, 0.80);
  const mat2 ROT_B = mat2(-0.39, 0.92, -0.92, -0.39);
  vec2 r1p = ROT_A * (p * 0.21) + vec2(t * 0.21, t * 0.07);
  vec2 r2p = ROT_B * (p * 0.53) - vec2(t * 0.09, t * 0.33);
  // d/dp n(R p f) = f * transpose(R) * grad (row-vector product)
  vec2 r1 = vec2(0.0);
  vec2 r2 = vec2(0.0);
  if (uWaterDetail > 0.0) {
    r1 = (miniGradNoise(r1p).yz * ROT_A) * 0.21 * 0.20;
    if (uWaterQuality > 1.5) r2 = (miniGradNoise(r2p).yz * ROT_B) * 0.53 * 0.07;
  }
  r1 *= 1.0 - smoothstep(1.2, 3.2, footprint);
  r2 *= 1.0 - smoothstep(0.5, 1.4, footprint);
  s += (r1 + r2) * 1.2 * uWaterDetail;

  s *= uMiniWaveStrength * calm * 1.7 * uWaveComplexity;
  return normalize(vec3(-s.x, 1.0, -s.y));
}

// Soft studio environment seen in reflections: warm bright horizon, pale
// blue zenith, slightly darker below the horizon. No HDR spikes.
vec3 miniEnvironment(vec3 dir) {
  vec3 horizon = mix(vec3(0.80, 0.81, 0.79), uSkyHorizon, uMiniEnvSky);
  vec3 zenith = mix(vec3(0.50, 0.66, 0.84), uSkyZenith, uMiniEnvSky);
  vec3 low = mix(vec3(0.55, 0.58, 0.58), uSkyHorizon * 0.7, uMiniEnvSky);
  vec3 c = mix(horizon, zenith, smoothstep(0.02, 0.75, dir.y));
  return mix(low, c, smoothstep(-0.25, 0.02, dir.y));
}

// Terrain height under a point from the studio bake, or -1e4 when unknown.
float miniBakedTerrain(vec2 xz) {
  if (uMiniBakeDepth < 0.5 || uUseTerrainHeightTex < 0.5) return -1e4;
  vec2 uv = (xz - uBakeOrigin) / max(uBakeSpan, vec2(1.0));
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -1e4;
  return texture2D(uTerrainHeightTex, uv).a * uHeightScale;
}

#ifdef MINI_WATER_TERRAIN_REFLECTION
// Height field for reflection rays: the Mini light map (B = filtered terrain
// height over the footprint) or the studio bake for Stylized Tile water.
float miniTraceHeight(vec2 xz) {
  float height = -1e4;
  if (uMiniLightEnabled > 0.5) {
    height = textureLod(uMiniLightTex, clamp(xz / max(uMiniHalf * 2.0, 1.0) + 0.5, 0.0, 1.0), 0.0).b;
  } else if (uMiniBakeDepth > 0.5 && uUseTerrainHeightTex > 0.5) {
    vec2 uv = (xz - uBakeOrigin) / max(uBakeSpan, vec2(1.0));
    if (uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0) {
      height = textureLod(uTerrainHeightTex, uv, 0.0).a * uHeightScale;
    }
  }
  return height;
}

// March a mirrored ray through that height field. Steps scale with the
// ray's clearance above the terrain (fast in open air, careful near banks),
// then a short bisection pins the hit. Returns 1 on a hit.
float miniTraceTerrain(vec3 origin, vec3 dir, float jitter, out vec3 hitPos) {
  hitPos = origin;
  vec2 lo2 = vec2(0.0);
  vec2 hi2 = vec2(0.0);
  if (uMiniLightEnabled > 0.5) {
    lo2 = vec2(-uMiniHalf);
    hi2 = vec2(uMiniHalf);
  } else if (uMiniBakeDepth > 0.5 && uUseTerrainHeightTex > 0.5) {
    lo2 = uBakeOrigin;
    hi2 = uBakeOrigin + uBakeSpan;
  } else {
    return 0.0;
  }
  vec2 safeDir = vec2(
    abs(dir.x) < 1e-5 ? 1e-5 : dir.x,
    abs(dir.z) < 1e-5 ? 1e-5 : dir.z
  );
  vec2 exitT = max((lo2 - origin.xz) / safeDir, (hi2 - origin.xz) / safeDir);
  float tEnd = min(exitT.x, exitT.y);
  float rise = max(dir.y, 0.002);
  tEnd = min(tEnd, (max(uHeightScale, 1.0) * 1.2 + abs(uSeaLevel) - origin.y) / rise);
  if (tEnd <= 0.0) return 0.0;
  float prevT = 0.0;
  float tCur = 0.3 + jitter * 0.5;
  for (int i = 0; i < uMiniTraceSteps; i++) {
    vec3 pos = origin + dir * tCur;
    float gap = pos.y - miniTraceHeight(pos.xz);
    if (gap < 0.0) {
      float a = prevT;
      float b = tCur;
      for (int r = 0; r < 5; r++) {
        float mid = 0.5 * (a + b);
        vec3 midPos = origin + dir * mid;
        if (midPos.y < miniTraceHeight(midPos.xz)) b = mid;
        else a = mid;
      }
      hitPos = origin + dir * b;
      return 1.0;
    }
    prevT = tCur;
    tCur += max(gap * 0.55, 0.4 + tCur * 0.012);
    if (tCur > tEnd) return 0.0;
  }
  return 0.0;
}

#endif

// What the water mirrors along reflect(rayDir, n): the environment, with the
// terrain composited where the mirrored ray meets it (coloured from the
// water-free capture when the hit is on screen).
vec3 miniReflection(vec3 p, vec3 rayDir, vec3 n, out float terrainHit) {
  terrainHit = 0.0;
  vec3 nr = normalize(mix(vec3(0.0, 1.0, 0.0), n, uMiniReflectDistort));
  vec3 dir = reflect(rayDir, nr);
  vec3 env = miniEnvironment(dir);
  if (uMiniReflectBlur > 0.0) {
    // rough water reflects a broad patch of sky, not one direction
    vec3 broad = normalize(vec3(dir.x * 0.4, max(dir.y, 0.1), dir.z * 0.4));
    env = mix(env, miniEnvironment(broad), uMiniReflectBlur * 0.6);
  }
#ifndef MINI_WATER_TERRAIN_REFLECTION
  return env;
#else
  if (uMiniReflectTerrain < 0.5 || uMiniTraceSteps <= 0 || dir.y <= 0.0 || uWaterQuality < 0.5) return env;
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec3 hit;
  terrainHit = miniTraceTerrain(vec3(p.x, max(p.y, uSeaLevel), p.z), dir, jitter, hit);
  if (terrainHit < 0.5) return env;
  // off-screen fallback: the environment darkened like a shaded bank
  vec3 terrainCol = env * vec3(0.32, 0.34, 0.30);
  if (uSceneRefractionEnabled > 0.5) {
    vec4 clip = projectionMatrix * (viewMatrix * vec4(hit, 1.0));
    if (clip.w > 0.0) {
      vec2 huv = clip.xy / clip.w * 0.5 + 0.5;
      vec2 edge = min(huv, vec2(1.0) - huv);
      float onScreen = smoothstep(0.0, 0.05, min(edge.x, edge.y));
      if (onScreen > 0.0) {
        vec2 o = uSceneTexelSize * mix(0.75, 6.0, uMiniReflectBlur);
        vec3 c = miniSceneColor(huv) * 0.36;
        c += miniSceneColor(huv + vec2(o.x, 0.0)) * 0.16;
        c += miniSceneColor(huv - vec2(o.x, 0.0)) * 0.16;
        c += miniSceneColor(huv + vec2(0.0, o.y)) * 0.16;
        c += miniSceneColor(huv - vec2(0.0, o.y)) * 0.16;
        terrainCol = mix(terrainCol, c, onScreen);
      }
    }
  }
  return terrainCol;
#endif
}

void main() {
  vec3 p = vWorldPos;
  if (miniBevelDistance(p.xz, uMiniHalf, uMiniWaterBevel, uMiniBevelRounded) < 0.0) discard;
  vec3 rayDir = normalize(p - cameraPosition);
  vec3 viewDir = -rayDir;
  float fragDist = length(p - cameraPosition);
  float t = uMiniWaterAnim;
  vec3 lightHere = miniLight(p.xz);
  float bakedHere = miniBakedTerrain(p.xz);
  float columnHere = uMiniLightEnabled > 0.5 ? max(uSeaLevel - lightHere.b, 0.0)
    : (bakedHere > -1e3 ? max(uSeaLevel - bakedHere, 0.0) : 20.0);
  // shallow, sheltered water is calmer; open water carries the full spectrum
  float calm = mix(0.45, 1.0, smoothstep(0.5, 9.0, columnHere));
  float footprint = length(fwidth(p.xz));
  float waveScale = max(uMiniWaveScale, 0.05);
#ifdef MINI_WATER_REALISTIC
  // the classic worlds' wave field: Gerstner sea, gust slicks, aperiodic
  // ripples; the sea state itself calms down in shallow, sheltered water
  waterWaveShelter = calm;
  vec3 n = waterDirectionalNormal(p.xz, t, fragDist, 0.08);
#else
  vec3 n = miniWaterNormal(p.xz / waveScale, t, footprint / waveScale, calm);
#endif
  if (dot(n, viewDir) < 0.0) n = -n;

  vec2 uv = gl_FragCoord.xy * uSceneViewportInv;
  vec2 screenUv = uv;
  float edgeFade = 1.0 - smoothstep(uWaterFadeStart, uWaterFadeEnd, length(cameraPosition.xz - p.xz));
  if (edgeFade < 0.002) discard;
  vec3 background = vec3(0.0);
  float sceneDist = fragDist + 60.0;
  float hasScene = step(0.5, uSceneRefractionEnabled);
  if (hasScene > 0.5) {
    sceneDist = miniSceneDistance(uv, rayDir);
    float thickness = clamp((sceneDist - fragDist) / 50.0, 0.0, 1.0);
    vec2 ruv = clamp(uv + n.xz * uMiniRefraction * thickness, vec2(0.002), vec2(0.998));
    float refractedDist = miniSceneDistance(ruv, rayDir);
    // never pull in something that is in front of the water surface
    if (refractedDist > fragDist + 0.5) {
      uv = ruv;
      sceneDist = refractedDist;
    }
    background = miniSceneColor(uv);
  }

  vec3 seabed = cameraPosition + rayDir * sceneDist;
  vec3 lightSurface = miniLight(p.xz);
  vec3 lightSeabed = miniLight(seabed.xz);
  // vertical water depth under this surface point, from the filtered height
  // in the light map: smooth, view independent (no capture-resolution steps)
  float seabedDepth = max(uSeaLevel - seabed.y, 0.0);
  // without a current light map, the captured seabed is the depth source
  float columnDepth = uMiniLightEnabled > 0.5 ? max(uSeaLevel - lightSurface.b, 0.0)
    : (bakedHere > -1e3 ? max(uSeaLevel - bakedHere, 0.0) : seabedDepth);
  // optical path: flat-bottom estimate from the column depth, shortened where
  // the captured scene is nearer (slopes, beaches, cliffs under the surface)
  float flatPath = columnDepth / max(-rayDir.y, 0.12);
  float path = min(flatPath, max(sceneDist - fragDist, 0.0) + 3.0);
  float sunUp = clamp(uSunDir.y * 1.3, 0.0, 1.0);

  // caustics on the sunlit, submerged seabed only (tinted, not white noise)
  float caustic = miniCaustic(seabed.xz, t) * uMiniCaustics
    * exp(-seabedDepth / 26.0) * smoothstep(0.6, 3.0, seabedDepth)
    * sunUp * lightSeabed.r;
  background *= 1.0 + caustic * vec3(0.85, 1.0, 0.95);

  float terrainHit;
#ifdef MINI_WATER_REALISTIC
  // light also travels down to the seabed before coming back up
  float sunMu = waterRefractedCosine(clamp(normalize(uSunDir).y, 0.08, 1.0));
  path += min(seabedDepth, columnDepth + 2.0) / max(sunMu, 0.3);
  vec3 transmittance = exp(-uMiniWaterAbsorb * path);
  // Shore Clarity: the last units of water turn glass clear
  if (uMiniShoreClear > 0.0) {
    transmittance = mix(transmittance, vec3(1.0), 1.0 - smoothstep(0.0, uMiniShoreClear, columnDepth));
  }
  vec3 body = miniWaterBody(columnDepth);
  vec3 bodyLight = miniLighting(sunUp, mix(0.78, 1.0, lightSurface.r), lightSurface.g);
  // submerged ground is wet, so darker than the dry capture
  vec3 col = background * 0.85 * transmittance + body * bodyLight * (vec3(1.0) - transmittance);

  // physical Fresnel reflection + GGX sun (roughness from unresolved ripples)
  float fresnel = waterSchlickFresnel(n, viewDir, 1.0);
  vec3 reflected = miniReflection(p, rayDir, n, terrainHit);
  col = mix(col, reflected, clamp(fresnel * uMiniReflect / 0.6 * uWaterReflection, 0.0, 0.98));
  float rough = waterFilteredRoughness(
    mix(0.06, 0.32, uMiniReflectBlur),
    uNormalIntensity
  );
  float sunSpec = min(waterGgxSunSpecular(n, viewDir, normalize(uSunDir), rough), 16.0);
  col += uTerrainSunCol * uTerrainSunIntensity * sunSpec * sunUp * lightSurface.r
    * uMiniSpecular * uWaterReflection * (1.0 - terrainHit);
#else
  vec3 transmittance = exp(-uMiniWaterAbsorb * path);
  // Shore Clarity: the last units of water turn glass clear
  if (uMiniShoreClear > 0.0) {
    transmittance = mix(transmittance, vec3(1.0), 1.0 - smoothstep(0.0, uMiniShoreClear, columnDepth));
  }
  vec3 body = miniWaterBody(columnDepth);
  vec3 bodyLight = miniLighting(sunUp, mix(0.78, 1.0, lightSurface.r), lightSurface.g);
  vec3 col = background * transmittance + body * bodyLight * (vec3(1.0) - transmittance);

  // soft studio reflection + restrained sun glint
  float ndv = clamp(dot(n, viewDir), 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  col = mix(col, miniReflection(p, rayDir, n, terrainHit), clamp(fresnel * uMiniReflect * uWaterReflection, 0.0, 0.85));
  vec3 halfDir = normalize(normalize(uSunDir) + viewDir);
  float nh = max(dot(n, halfDir), 0.0);
  float glint = pow(nh, 900.0) * 0.8 + pow(nh, 120.0) * 0.05;
  col += uTerrainSunCol * uTerrainSunIntensity * glint * sunUp * lightSurface.r * uMiniSpecular * uWaterReflection * (1.0 - terrainHit);
#endif

  // thin animated shore foam where the water column is very shallow
  float shore = uMiniFoamWidth > 0.0 ? 1.0 - smoothstep(0.0, max(uMiniFoamWidth, 0.001), columnDepth) : 0.0;
  float breakup = miniNoise(p.xz * 0.31 + vec2(t * 0.5, t * 0.3)) * 0.6
                + miniNoise(mat2(0.8, -0.6, 0.6, 0.8) * p.xz * 0.97 - t * 0.4) * 0.4;
  // continuous line with soft variation (a hard threshold on a thin band
  // breaks into dashes along steep shores)
  float foam = shore * (0.4 + 0.6 * smoothstep(0.3, 0.75, breakup + shore * 0.25));
  // a shore is where the bed rises: wide flat shallows (lagoons, sandbanks)
  // keep only a faint trace instead of turning white
  float bedSlope = fwidth(columnDepth) / max(footprint, 1e-3);
  foam *= mix(0.25, 1.0, smoothstep(0.015, 0.09, bedSlope));
  col = mix(col, uMiniFoamColor * bodyLight, clamp(foam * uMiniFoamStrength * hasScene, 0.0, 1.0));

  // crisp glass edge where the surface meets the cut faces
  float edgeDist = miniBevelDistance(p.xz, uMiniHalf, uMiniWaterBevel, uMiniBevelRounded);
  float edgePx = edgeDist / max(fwidth(edgeDist), 1e-4);
  col = mix(col, vec3(0.94, 0.98, 0.97) * bodyLight, clamp((1.0 - smoothstep(0.0, 1.6, edgePx)) * 0.55 * uMiniWaterEdges, 0.0, 1.0));

  // distance fog, the terrain's formula (negligible at diorama scale)
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * fragDist * fragDist);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

  if (hasScene > 0.5) {
    // far edge (Infinite World): dissolve into the water-free scene behind
    col = mix(miniSceneColor(screenUv), col, edgeFade);
    gl_FragColor = vec4(pow(max(col, vec3(0.0)), vec3(1.0 / 2.2)), 1.0);
  } else {
    // no capture: the blended terrain behind is the background, so opacity
    // follows the same absorption (clear shallows, opaque deep water)
    // (col already carries the body weighted by 1 - T: un-weight it first)
    float bodyAlpha = clamp(1.0 - dot(transmittance, vec3(0.2126, 0.7152, 0.0722)), 0.18, 0.97);
    vec3 straight = col / bodyAlpha;
    float alpha = max(bodyAlpha, max(foam * uMiniFoamStrength, fresnel * uMiniReflect * uWaterReflection * 0.85)) * edgeFade;
    gl_FragColor = vec4(pow(max(straight, vec3(0.0)), vec3(1.0 / 2.2)) * alpha, alpha);
  }
}
`;

const CUT_VERTEX = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const CUT_FRAGMENT = /* glsl */ `
precision highp float;
${MINI_WATER_COMMON_GLSL}
uniform float uCutHalf;
uniform float uCutBottom;
varying vec3 vWorldPos;

float cutRoundedExit(vec2 p, vec2 dir, vec2 quadrant) {
  vec2 center = quadrant * (uCutHalf - uMiniWaterBevel);
  vec2 offset = p - center;
  float a = dot(dir, dir);
  float b = dot(offset, dir);
  float discriminant = b * b - a * (dot(offset, offset) - uMiniWaterBevel * uMiniWaterBevel);
  if (a < 1e-10 || discriminant < 0.0) return 1e20;
  float t = (-b + sqrt(discriminant)) / a;
  vec2 hit = (p + dir * t - center) * quadrant;
  return t > 0.0 && min(hit.x, hit.y) >= -0.001 ? t : 1e20;
}

float cutHexPlaneExit(vec2 p, vec2 dir, vec2 n) {
  float along = dot(dir, n);
  return along > 1e-5 ? (uCutHalf * 0.866025404 - dot(p, n)) / along : 1e20;
}

float cutBoxExit(vec3 p, vec3 dir) {
  vec3 d = vec3(
    abs(dir.x) < 1e-5 ? 1e-5 : dir.x,
    abs(dir.y) < 1e-5 ? 1e-5 : dir.y,
    abs(dir.z) < 1e-5 ? 1e-5 : dir.z
  );
  float tx = ((d.x > 0.0 ? uCutHalf : -uCutHalf) - p.x) / d.x;
  float tz = ((d.z > 0.0 ? uCutHalf : -uCutHalf) - p.z) / d.z;
  float ty = ((d.y > 0.0 ? uSeaLevel : uCutBottom) - p.y) / d.y;
  float distance = min(min(tx, tz), ty);
  // Clip the optical path to the footprint's side planes or rounded corners.
  if (uMiniHexagon > 0.5) {
    distance = min(distance, cutHexPlaneExit(p.xz, d.xz, vec2(1.0, 0.0)));
    distance = min(distance, cutHexPlaneExit(p.xz, d.xz, vec2(0.5, 0.866025404)));
    distance = min(distance, cutHexPlaneExit(p.xz, d.xz, vec2(-0.5, 0.866025404)));
    distance = min(distance, cutHexPlaneExit(p.xz, d.xz, vec2(-1.0, 0.0)));
    distance = min(distance, cutHexPlaneExit(p.xz, d.xz, vec2(-0.5, -0.866025404)));
    distance = min(distance, cutHexPlaneExit(p.xz, d.xz, vec2(0.5, -0.866025404)));
  } else if (uMiniWaterBevel > 0.0 && uMiniBevelRounded > 0.5) {
    distance = min(distance, cutRoundedExit(p.xz, d.xz, vec2(1.0, 1.0)));
    distance = min(distance, cutRoundedExit(p.xz, d.xz, vec2(1.0, -1.0)));
    distance = min(distance, cutRoundedExit(p.xz, d.xz, vec2(-1.0, 1.0)));
    distance = min(distance, cutRoundedExit(p.xz, d.xz, vec2(-1.0, -1.0)));
  } else if (uMiniWaterBevel > 0.0) {
    float limit = 2.0 * uCutHalf - uMiniWaterBevel;
    if (d.x + d.z > 1e-5) distance = min(distance, (limit - p.x - p.z) / (d.x + d.z));
    if (d.x - d.z > 1e-5) distance = min(distance, (limit - p.x + p.z) / (d.x - d.z));
    if (-d.x + d.z > 1e-5) distance = min(distance, (limit + p.x - p.z) / (-d.x + d.z));
    if (-d.x - d.z > 1e-5) distance = min(distance, (limit + p.x + p.z) / (-d.x - d.z));
  }
  return max(distance, 0.0);
}

void main() {
  vec3 p = vWorldPos;
  vec3 rayDir = normalize(p - cameraPosition);
  float fragDist = length(p - cameraPosition);
  float path = cutBoxExit(p + rayDir * 0.05, rayDir);
  vec2 uv = gl_FragCoord.xy * uSceneViewportInv;
  vec3 background = vec3(0.0);
  float hasScene = step(0.5, uSceneRefractionEnabled);
  if (hasScene > 0.5) {
    float sceneDist = miniSceneDistance(uv, rayDir);
    path = min(path, max(sceneDist - fragDist, 0.0));
    background = miniSceneColor(uv);
  }

  // Same colour model as the surface right above this column: body colour
  // from the column depth, same light, same absorption. The section reads
  // as a slice of the very water seen from the top, not a different glass.
  vec3 light = miniLight(p.xz);
  float sunUp = clamp(uSunDir.y * 1.3, 0.0, 1.0);
  float depthBelow = max(uSeaLevel - p.y, 0.0);
  float column = uMiniLightEnabled > 0.5 ? max(uSeaLevel - light.b, depthBelow) : max(depthBelow * 1.2, 1.0);
  vec3 body = miniWaterBody(column);
  vec3 bodyLight = miniLighting(sunUp, mix(0.78, 1.0, light.r), light.g);
  // light fades slightly with depth inside the slice
  float inside = clamp(depthBelow / max(column, 1.0), 0.0, 1.0);
  body *= bodyLight * mix(1.0, 0.74, inside);
  vec3 transmittance = exp(-uMiniWaterAbsorb * 1.4 * path);
  vec3 col = background * transmittance + body * (vec3(1.0) - transmittance);

  // crisp glass edges: the waterline and the vertical corners
  float topDist = uSeaLevel - p.y;
  float topPx = topDist / max(fwidth(topDist), 1e-4);
  vec2 corner = vec2(uCutHalf, uCutHalf - uMiniWaterBevel);
  float cornerDist = min(length(abs(p.xz) - corner), length(abs(p.xz) - corner.yx));
  if (uMiniHexagon > 0.5) {
    vec2 q = abs(p.xz);
    cornerDist = min(length(q - vec2(0.0, uCutHalf)), length(q - vec2(uCutHalf * 0.866025404, uCutHalf * 0.5)));
  }
  float cornerPx = cornerDist / max(fwidth(cornerDist), 1e-4);
  float roundedCorner = uMiniWaterBevel > 0.0 ? uMiniBevelRounded : 0.0;
  float edge = clamp(max(1.0 - smoothstep(0.0, 1.6, topPx), (1.0 - smoothstep(0.0, 1.4, cornerPx)) * 0.5 * (1.0 - roundedCorner)) * uMiniWaterEdges, 0.0, 1.0);
  col = mix(col, vec3(0.93, 0.98, 0.97) * bodyLight, edge * 0.5);

  if (hasScene > 0.5) {
    gl_FragColor = vec4(pow(max(col, vec3(0.0)), vec3(1.0 / 2.2)), 1.0);
  } else {
    float alpha = clamp(1.0 - dot(transmittance, vec3(0.2126, 0.7152, 0.0722)) + edge * 0.3, 0.0, 1.0);
    gl_FragColor = vec4(pow(max(col, vec3(0.0)), vec3(1.0 / 2.2)) * alpha, alpha);
  }
}
`;

function waterUniforms(shared) {
  return {
    ...miniLightingUniforms(shared),
    uSunDir: shared.uSunDir,
    uSeaLevel: shared.uSeaLevel,
    uTime: shared.uTime,
    uMiniWaterShallow: { value: new THREE.Vector3(0.27, 0.77, 0.67) },
    uMiniWaterMid: { value: new THREE.Vector3(0.05, 0.47, 0.54) },
    uMiniWaterDeep: { value: new THREE.Vector3(0.01, 0.16, 0.31) },
    uMiniWaterSide: { value: new THREE.Vector3(0.39, 0.78, 0.72) },
    uMiniWaterAbsorb: { value: new THREE.Vector3(0.045, 0.019, 0.013) },
    uMiniWaterDepthRange: { value: 70 },
    uMiniWaterAnim: { value: 0 },
    uMiniHalf: { value: 512 },
    uMiniWaterEdges: { value: 1 },
    uMiniWaterBevel: { value: 0 },
    uMiniHexagon: shared.uMiniHexagon ?? { value: 0 },
    uMiniBevelRounded: shared.uMiniBevelRounded ?? { value: 0 },
    uMiniCaustics: { value: 0.9 },
    uMiniLightTex: { value: null },
    uMiniLightEnabled: { value: 0 },
    uSceneColor: { value: null },
    uSceneDepth: { value: null },
    uSceneTexelSize: { value: new THREE.Vector2(1, 1) },
    uSceneViewportInv: { value: new THREE.Vector2(1, 1) },
    uSceneNear: { value: 1 },
    uSceneFar: { value: 50000 },
    uSceneRefractionEnabled: { value: 0 },
  };
}

export function createMiniWaterSurfaceMaterial(shared, { name = 'MiniWaterSurface', sky = null } = {}) {
  return new THREE.ShaderMaterial({
    name,
    uniforms: {
      ...waterUniforms(shared),
      uMiniRefraction: { value: 0.035 },
      uMiniWaveStrength: { value: 1.0 },
      uMiniFoamWidth: { value: 2.4 },
      uMiniReflect: { value: 0.6 },
      uMiniWaveScale: { value: 1.0 },
      uWaterQuality: { value: 2 },
      uWaterDetail: { value: 1 },
      uWaterReflection: { value: 1 },
      uWaveComplexity: { value: 1 },
      uMiniSpecular: { value: 1 },
      uMiniFoamStrength: { value: 0.8 },
      uMiniFoamColor: { value: new THREE.Vector3(0.97, 0.98, 0.97) },
      uMiniEnvSky: { value: sky ? 1 : 0 },
      uSkyZenith: sky?.uSkyZenith ?? { value: new THREE.Color(0.3, 0.5, 0.85) },
      uSkyHorizon: sky?.uSkyHorizon ?? { value: new THREE.Color(0.75, 0.8, 0.85) },
      uFogColor: shared.uFogColor ?? { value: new THREE.Color(0.8, 0.84, 0.86) },
      uFogDensity: shared.uFogDensity ?? { value: 0 },
      uTerrainHeightTex: shared.uTerrainHeightTex ?? { value: null },
      uUseTerrainHeightTex: shared.uUseTerrainHeightTex ?? { value: 0 },
      uMiniBakeDepth: { value: 0 },
      uBakeOrigin: shared.uBakeOrigin ?? { value: new THREE.Vector2() },
      uBakeSpan: shared.uBakeSpan ?? { value: new THREE.Vector2(1, 1) },
      uHeightScale: shared.uHeightScale ?? { value: 1 },
      uWaterFadeStart: { value: 99999 },
      uWaterFadeEnd: { value: 100000 },
      uMiniReflectTerrain: { value: 0 },
      uMiniTraceSteps: { value: 0 },
      uMiniReflectBlur: { value: 0 },
      uMiniReflectDistort: { value: 1 },
      uMiniShoreClear: { value: 0 },
      // shared wave field (Realistic shader)
      uWaveDir: { value: new THREE.Vector2(1, 0) },
      uWaveScale: { value: 1 },
      uWaveSpeed: { value: 1 },
      uWaveStrength: { value: 1 },
      uLargeWaveStr: { value: 0.7 },
      uSmallWaveStr: { value: 0.65 },
      uNormalIntensity: { value: 1 },
      uMicroWaveDetail: { value: 1 },
    },
    vertexShader: SURFACE_VERTEX,
    fragmentShader: SURFACE_FRAGMENT,
    forceSinglePass: true,
    transparent: true,
    premultipliedAlpha: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function createMiniWaterCutMaterial(shared) {
  return new THREE.ShaderMaterial({
    name: 'MiniWaterCut',
    uniforms: {
      ...waterUniforms(shared),
      uCutHalf: { value: 512 },
      uCutBottom: { value: -70 },
    },
    vertexShader: CUT_VERTEX,
    fragmentShader: CUT_FRAGMENT,
    transparent: true,
    premultipliedAlpha: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
}

/**
 * Push the Mini water look into a surface or cut material. `colors` are
 * linear RGB triplets (MiniLook.miniWaterColors); params supply live water
 * settings so the Water panel still steers clarity, waves and foam.
 */
export function applyMiniWaterLook(material, { colors, params, half, depthRange, lightTex, animTime, edges, bevel }) {
  const u = material?.uniforms;
  if (!u) return;
  if (colors) {
    u.uMiniWaterShallow.value.set(...colors.shallow);
    u.uMiniWaterMid.value.set(...colors.mid);
    u.uMiniWaterDeep.value.set(...colors.deep);
    u.uMiniWaterSide.value.set(...colors.side);
  }
  if (params) {
    const palette = params.planetStyle?.palette;
    if (palette?.shallow && palette?.deep) {
      u.uMiniWaterShallow.value.set(...palette.shallow);
      u.uMiniWaterDeep.value.set(...palette.deep);
      u.uMiniWaterMid.value.lerpVectors(u.uMiniWaterShallow.value, u.uMiniWaterDeep.value, 0.5);
      u.uMiniWaterSide.value.copy(u.uMiniWaterShallow.value);
    }
    // waterOpacity (0..1) is the optical density: lower = clearer water
    const density = 0.45 + (params.waterOpacity ?? 0.5) * 1.1;
    const absorb = (params.waterAbsorptionStrength ?? 0.7) * density;
    const clarity = miniTransparencyScale(params);
    u.uMiniWaterAbsorb.value.set(0.050 * absorb, 0.021 * absorb, 0.014 * absorb).multiplyScalar(clarity);
    if (u.uMiniShoreClear) u.uMiniShoreClear.value = Math.min(8, Math.max(0, params.waterDioramaShoreClarity ?? 0));
    u.uMiniCaustics.value = (params.waterUnderwaterCausticsEnabled === false ? 0 : 1)
      * Math.min(1.6, (params.waterUnderwaterCaustics ?? 0.32) * 2.6);
    if (u.uMiniWaveStrength) u.uMiniWaveStrength.value = (params.waterWaveStrength ?? 0.55) * 1.5;
    if (u.uMiniFoamWidth) u.uMiniFoamWidth.value = params.waterFoamEnabled === false ? 0 : (params.waterFoamWidth ?? 2.2) * 0.6;
    if (u.uMiniRefraction) u.uMiniRefraction.value = 0.06 * (params.waterRefractionStrength ?? 0.5);
    if (u.uMiniWaveScale) u.uMiniWaveScale.value = params.waterWaveScale ?? 1;
    if (u.uMiniReflect) u.uMiniReflect.value = 0.6 * (params.waterFresnelStrength ?? 1);
    if (u.uMiniSpecular) u.uMiniSpecular.value = params.waterSpecularStrength ?? 1;
    if (u.uMiniFoamStrength) u.uMiniFoamStrength.value = params.waterFoamStrength ?? 0.8;
    if (u.uMiniFoamColor && palette?.foam) u.uMiniFoamColor.value.set(...palette.foam);
    material.userData.miniWaterParams = params;
    setMiniWaterShader(material, params.waterDioramaShader);
    applyMiniReflectionSettings(material, params, miniRealistic(material));
    if (u.uWaveDir) {
      const dir = (params.waterWaveDirection ?? 0) * Math.PI / 180;
      u.uWaveDir.value.set(Math.cos(dir), Math.sin(dir));
      u.uWaveScale.value = params.waterWaveScale ?? 1;
      // the Mini clock already runs at Wave Speed
      u.uWaveSpeed.value = 1;
      u.uWaveStrength.value = params.waterWaveStrength ?? 0.55;
      u.uLargeWaveStr.value = params.waterLargeWaveStrength ?? 0.7;
      u.uSmallWaveStr.value = params.waterSmallWaveStrength ?? 0.65;
      u.uNormalIntensity.value = params.waterNormalIntensity ?? 1;
      u.uMicroWaveDetail.value = params.waterNormalResolution ?? 1;
    }
  }
  if (Number.isFinite(half)) u.uMiniHalf.value = half;
  if (Number.isFinite(edges)) u.uMiniWaterEdges.value = edges;
  if (Number.isFinite(bevel)) u.uMiniWaterBevel.value = bevel;
  if (Number.isFinite(depthRange)) u.uMiniWaterDepthRange.value = depthRange;
  if (lightTex !== undefined) {
    u.uMiniLightTex.value = lightTex;
    u.uMiniLightEnabled.value = lightTex ? 1 : 0;
  }
  if (Number.isFinite(animTime)) u.uMiniWaterAnim.value = animTime;
  const stored = material.userData?.miniWaterParams;
  if (stored && miniRealistic(material) && (params || colors || Number.isFinite(depthRange))) {
    const absorb = realisticMiniAbsorption(
      u.uMiniWaterShallow.value.toArray(),
      u.uMiniWaterDepthRange.value * 0.6,
      stored.waterAbsorptionStrength ?? 0.7,
      stored.waterOpacity ?? 0.5,
      stored.waterDioramaTint ?? 1,
    );
    u.uMiniWaterAbsorb.value.set(...absorb).multiplyScalar(miniTransparencyScale(stored));
  }
}

export const MINI_WATER_SHADERS = Object.freeze(['stylized', 'realistic']);
export const MINI_WATER_REFLECTION_MODES = Object.freeze(['auto', 'sky', 'terrain', 'off']);

function miniRealistic(material) {
  return !!material?.defines?.MINI_WATER_REALISTIC;
}

/** Switch the surface/cut program between the Stylized and Realistic shader. */
export function setMiniWaterShader(material, shader) {
  if (!material) return;
  const want = shader === 'realistic';
  if (miniRealistic(material) === want) return;
  const defines = { ...(material.defines ?? {}) };
  if (want) defines.MINI_WATER_REALISTIC = 1;
  else delete defines.MINI_WATER_REALISTIC;
  material.defines = defines;
  material.needsUpdate = true;
}

/**
 * Resolve the reflection controls. Auto mirrors the terrain with the Realistic
 * shader and keeps the sky-only reflection of the Stylized look.
 */
export function resolveMiniReflections(params = {}, realistic = params.waterDioramaShader === 'realistic') {
  const mode = MINI_WATER_REFLECTION_MODES.includes(params.waterDioramaReflections)
    ? params.waterDioramaReflections : 'auto';
  const terrain = mode === 'terrain' || (mode === 'auto' && realistic);
  return {
    enabled: mode !== 'off',
    terrain,
    steps: terrain ? (realistic ? 32 : 24) : 0,
    strength: mode === 'off' ? 0 : Math.max(0, params.waterDioramaReflectionStrength ?? 1),
    blur: Math.min(1, Math.max(0, params.waterDioramaReflectionBlur ?? 0)),
    distortion: Math.min(2, Math.max(0, params.waterDioramaReflectionDistortion ?? 1)),
  };
}

function applyMiniReflectionSettings(material, params, realistic) {
  const u = material.uniforms;
  const r = resolveMiniReflections(params, realistic);
  if (u.uMiniReflect) u.uMiniReflect.value *= r.strength;
  if (!u.uMiniReflectTerrain) return;
  // Exclude the nested ray march entirely from the common sky-only program.
  // A uniform branch still makes ANGLE/FXC compile its texture loops on first draw.
  const terrain = r.enabled && r.terrain;
  if (!!material.defines?.MINI_WATER_TERRAIN_REFLECTION !== terrain) {
    const defines = { ...(material.defines ?? {}) };
    if (terrain) defines.MINI_WATER_TERRAIN_REFLECTION = 1;
    else delete defines.MINI_WATER_TERRAIN_REFLECTION;
    material.defines = defines;
    material.needsUpdate = true;
  }
  u.uMiniReflectTerrain.value = r.terrain ? 1 : 0;
  u.uMiniTraceSteps.value = r.steps;
  u.uMiniReflectBlur.value = r.blur;
  u.uMiniReflectDistort.value = r.distortion;
}

/**
 * Spectral absorption per world unit for the Realistic shader (mirrors
 * waterAbsorptionCoefficients in waterOpticsGLSL.js): the shallow colour is
 * the hue light keeps, red always goes first, and the most penetrating
 * channel fades to ~10% over clarityDistance.
 */
export function realisticMiniAbsorption(shallow, clarityDistance, strength, density, tint = 1) {
  const safe = shallow.map((c) => Math.max(c, 0.0001));
  const peak = Math.max(...safe);
  const bias = [0.8, 0.15, 0];
  const base = 2.3 / Math.max(clarityDistance, 1);
  const userDensity = 2 ** ((Math.min(1, Math.max(0, density)) - 0.6) * 2.5);
  // Colour Absorption: 0 = neutral (the floor only dims), 1 = natural, 2 = vivid
  const spectral = Math.min(2, Math.max(0, tint));
  return safe.map((c, i) => (1 + ((1 - c / peak) * 5 + bias[i]) * spectral) * base * Math.max(strength, 0) * userDensity);
}

/**
 * Transparency (0..1, 0.5 = unchanged) scales the absorption rate: each 0.25
 * step doubles or halves how far you can see into the water.
 */
export function miniTransparencyScale(params = {}) {
  const t = Math.min(1, Math.max(0, params.waterDioramaTransparency ?? 0.5));
  return 2 ** ((0.5 - t) * 4);
}
