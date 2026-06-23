import * as THREE from 'three';
import { CLOUD_NOISE_GLSL, CLOUD_FIELD_GLSL, CLOUD_VOLUME_GLSL } from './cloudGLSL.js';

// ============================================================================
// CloudVolumeShader: a transparent material that raymarches the spherical
// cloud shell. It is drawn on a sphere mesh at the OUTER radius using
// THREE.BackSide so the shell's screen footprint is always covered (from
// outside the back faces project over the full disc; from inside they surround
// the camera). The mesh only defines the render area — the visual volume comes
// entirely from the fragment raymarch.
//
// Occlusion by the planet is analytic: the march segment is clamped to the
// inner (planet) sphere, so the far half of the shell behind the globe is
// never accumulated. depthTest is therefore disabled (the planet's depth would
// otherwise wrongly cull near-side clouds drawn on far-side back faces).
//
// Step counts are compile-time #defines (CLOUD_STEPS / CLOUD_LIGHT_STEPS) so
// the loops stay statically bounded for the D3D11/ANGLE compiler. Changing
// quality swaps the defines and recompiles.
// ============================================================================

const VERTEX = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;

${CLOUD_NOISE_GLSL}
${CLOUD_FIELD_GLSL}
${CLOUD_VOLUME_GLSL}

varying vec3 vWorldPos;

// scene-depth occlusion (terrain hides clouds behind it). Active only when a
// depth prepass has populated tSceneDepth (uUseDepth = 1); the analytic inner-
// sphere clamp above already handles the far hemisphere, this adds true relief
// occlusion so clouds no longer show through the surface up close.
uniform sampler2D tSceneDepth;
uniform vec2 uDepthResolution;
uniform mat4 uProjectionMatrixInverse;
uniform mat4 uViewMatrixInverse;
uniform float uDepthBias;
uniform float uUseDepth;

#if defined(CLOUD_CHUNK) && CLOUD_CHUNK > 0
// Per-chunk angular sector: 4 inward planes through the planet origin. The march
// is clipped to dot(N_k, P) >= 0 for every k, so each cube-face cell owns a
// DISJOINT slice of the shell. Back-to-front "over" compositing across the
// chunk meshes (Three sorts transparents by distance) reconstructs exactly the
// single continuous march — no double counting, same visual.
uniform vec3 uCellNormals[4];
#endif

vec3 reconstructWorldPosition(vec2 uv, float depth) {
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uProjectionMatrixInverse * clip;
  view.xyz /= view.w;
  return (uViewMatrixInverse * vec4(view.xyz, 1.0)).xyz;
}

// Directional occupancy grid: a small octahedral map (built on the CPU from the
// coverage field, conservative + dilated) telling whether a column/direction
// holds any cloud. A cheap texture lookup lets the march skip the expensive
// density (FBM + worley + self-shadow) over empty sky and reject empty rays
// outright — the freed step budget also concentrates inside real cloud, cutting
// grazing-angle grain.
uniform sampler2D uCloudOccupancy;
uniform float uUseOccupancy;

vec2 octEncode(vec3 n) {
  n /= (abs(n.x) + abs(n.y) + abs(n.z));
  vec2 p = n.xy;
  if (n.z < 0.0) p = (1.0 - abs(p.yx)) * sign(p);
  return p * 0.5 + 0.5;
}

float occAt(vec3 P) {
  return texture2D(uCloudOccupancy, octEncode(normalize(P))).r;
}

void main() {
  // planet is centered at the world origin, so camera position IS the ray
  // origin in planet-local space.
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorldPos - cameraPosition);

  vec2 outer = cl_raySphere(ro, rd, uCloudOuter);
  if (outer.y <= 0.0 || outer.x >= outer.y) discard;   // shell not ahead

  vec2 inner = cl_raySphere(ro, rd, uCloudInner);
  float tStart = max(outer.x, 0.0);
  float tEnd   = outer.y;

  // planet (inner sphere) occludes the far side of the shell
  if (inner.x > 0.0 && inner.x < tEnd) tEnd = inner.x;
  // camera below the shell (on / near the surface): start past the inner exit
  float ro2 = dot(ro, ro);
  if (ro2 < uCloudInner * uCloudInner && inner.y > tStart) tStart = inner.y;

  // Save the pure shell segment BEFORE depth/chunk modifications. The global
  // sampling lattice (stepLen + baseT) is derived from this so every chunk on
  // a ray shares the exact same sample positions — no seam lines.
  float shellStart = tStart;
  float shellEnd   = tEnd;

  // terrain depth occlusion: clamp the marched segment to the opaque scene hit
  if (uUseDepth > 0.5) {
    vec2 depthUv = gl_FragCoord.xy / max(uDepthResolution, vec2(1.0));
    if (depthUv.x >= 0.0 && depthUv.x <= 1.0 && depthUv.y >= 0.0 && depthUv.y <= 1.0) {
      float sceneDepth = texture2D(tSceneDepth, depthUv).x;
      if (sceneDepth < 0.99999) {
        vec3 sceneHit = reconstructWorldPosition(depthUv, sceneDepth);
        float hitT = dot(sceneHit - ro, rd);
        if (hitT > 0.0 && hitT < tEnd) tEnd = hitT - uDepthBias;
      }
    }
  }

  if (tEnd <= tStart) discard;

  // GLOBAL sampling lattice from the PURE shell segment (before depth clamp and
  // chunk clip). This guarantees the lattice is identical for all chunks on a
  // given ray, so back-to-front "over" compositing reconstructs a seamless
  // single march. The depth clamp and chunk clip only narrow the marched range
  // — the step positions themselves never change.
  int effSteps = int(float(CLOUD_STEPS) * clamp(uCloudStepScale, 0.05, 1.0) + 0.5);
  effSteps = max(effSteps, 8);
  float stepLen = (shellEnd - shellStart) / float(effSteps);
  float dither = cl_hash13(vec3(gl_FragCoord.xy, uCloudTime));
  float baseT = shellStart + stepLen * dither;

#if defined(CLOUD_CHUNK) && CLOUD_CHUNK > 0
  // clip the marched range to this chunk's angular sector (4 origin planes),
  // keeping stepLen/baseT (the global lattice) unchanged. Add a small overlap
  // margin (chunkEps) to ensure no seams between adjacent chunks due to float precision.
  float chunkEps = 0.05 * stepLen;
  for (int k = 0; k < 4; k++) {
    vec3 N = uCellNormals[k];
    float nro = dot(N, ro);
    float nrd = dot(N, rd);
    if (abs(nrd) < 1e-9) {
      if (nro < 0.0) discard;            // ray runs parallel to and outside the plane
    } else {
      float tp = -nro / nrd;
      if (nrd > 0.0) tStart = max(tStart, tp - chunkEps);
      else           tEnd   = min(tEnd, tp + chunkEps);
    }
  }
  if (tEnd <= tStart) discard;
#endif

  float transmittance = 1.0;
  vec3 scatter = vec3(0.0);
  vec3 ambient = uCloudShadowColor * uCloudShadowStrength;

#if defined(CLOUD_CHUNK) && CLOUD_CHUNK > 0
  // chunk mode (experimental): uniform global lattice so adjacent chunks share
  // sample positions. Kept for the opt-in chunked path.
  float n0 = max(0.0, ceil((tStart - baseT) / stepLen));
  float t = baseT + n0 * stepLen;
  for (int i = 0; i < CLOUD_STEPS; i++) {
    if (t < tEnd && transmittance > 0.01) {
      vec3 P = ro + rd * t;
      float dens = cloudDensity(P);
      if (dens > 0.001) {
        float light = uCloudSelfShadow > 0.5 ? cl_lightTransmittance(P) : 1.0;
        vec3 lit = mix(ambient, uCloudColor, light) * (0.55 + 0.45 * uCloudScattering * light);
        float dT = exp(-dens * stepLen * uCloudExtinction);
        scatter += transmittance * (1.0 - dT) * lit;
        transmittance *= dT;
      }
    }
    t += stepLen;
  }
#else
  // single-shell mode (default): OCCUPANCY-GRID empty-space skipping. A cheap
  // directional lookup gates the expensive cloudDensity — empty columns are
  // skipped with a coarse stride and never pay for noise; occupied columns march
  // at the fine step. The occupancy map is conservative + dilated, so a cloud's
  // leading edge is always entered a little early (no overshoot, no banding).
  if (uUseOccupancy > 0.5) {
    // whole-ray reject: if every column the segment crosses is empty, skip it.
    float oA = occAt(ro + rd * shellStart);
    float oM = occAt(ro + rd * (shellStart + shellEnd) * 0.5);
    float oB = occAt(ro + rd * tEnd);
    if (max(oA, max(oM, oB)) < 0.5) discard;
  }

  float coarse = stepLen * 2.0;
  float t = baseT;
  for (int i = 0; i < CLOUD_STEPS; i++) {
    if (t < tEnd && transmittance > 0.01) {
      vec3 P = ro + rd * t;
      float occ = uUseOccupancy > 0.5 ? occAt(P) : 1.0;
      if (occ < 0.5) {
        t += coarse;                 // empty column — skip cheaply, no density eval
      } else {
        float dens = cloudDensity(P);
        if (dens > 0.001) {
          float light = uCloudSelfShadow > 0.5 ? cl_lightTransmittance(P) : 1.0;
          vec3 lit = mix(ambient, uCloudColor, light) * (0.55 + 0.45 * uCloudScattering * light);
          float dT = exp(-dens * stepLen * uCloudExtinction);
          scatter += transmittance * (1.0 - dT) * lit;
          transmittance *= dT;
        }
        t += stepLen;
      }
    }
  }
#endif

  float alpha = 1.0 - transmittance;
  if (alpha < 0.004) discard;

  vec3 col = scatter / max(alpha, 1e-4);   // un-premultiply for normal blending
  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, alpha);
}
`;

/**
 * Create the volumetric cloud material.
 * @param {number} steps       primary raymarch step count (compile-time)
 * @param {number} lightSteps  secondary (sun) march step count (compile-time)
 * @param {number} octaves     base noise FBM octave count (compile-time)
 * @param {number} detailOctaves detail noise FBM octave count (compile-time)
 * @param {boolean} useErosion whether to use cellular erosion (compile-time)
 * @param {number} lightMode  0 = secondary march, 1 = cheap 2-tap analytic shadow
 * @param {boolean} chunk      true = sector-clipped chunk variant (CLOUD_CHUNK)
 */
export function createCloudMaterial(steps = 24, lightSteps = 6, octaves = 5, detailOctaves = 4, useErosion = true, lightMode = 0, chunk = false) {
  const uniforms = {
      uCloudInner:           { value: 16240 },
      uCloudOuter:           { value: 16860 },
      uCloudCoverage:        { value: 0.5 },
      uCloudSoftness:        { value: 0.16 },
      uCloudScale:           { value: 1.0 },
      uCloudDetailScale:     { value: 3.0 },
      uCloudDetailStrength:  { value: 0.35 },
      uCloudErosionScale:    { value: 6.0 },
      uCloudErosionStrength: { value: 0.30 },
      uCloudExtinction:      { value: 0.013 },
      uCloudLightAbsorption: { value: 1.1 },
      uCloudShadowStrength:  { value: 0.6 },
      uCloudScattering:      { value: 1.0 },
      uCloudColor:           { value: new THREE.Color(1, 1, 1) },
      uCloudShadowColor:     { value: new THREE.Color(0.42, 0.47, 0.60) },
      uCloudWind:            { value: new THREE.Vector3() },
      uCloudRotation:        { value: 0.0 },
      uCloudTime:            { value: 0.0 },
      uCloudSelfShadow:      { value: 1.0 },
      uCloudSunDir:          { value: new THREE.Vector3(0.4, 0.7, 0.5).normalize() },
      uCloudNoiseVariant:    { value: 0.0 },
      uCloudStepScale:       { value: 1.0 },
      tSceneDepth:           { value: null },
      uDepthResolution:      { value: new THREE.Vector2(1, 1) },
      uProjectionMatrixInverse: { value: new THREE.Matrix4() },
      uViewMatrixInverse:    { value: new THREE.Matrix4() },
      uDepthBias:            { value: 2.0 },
      uUseDepth:             { value: 0.0 },
      uCloudOccupancy:       { value: null },
      uUseOccupancy:         { value: 0.0 },
  };
  if (chunk) {
    // 4 inward sector planes through the planet origin (set per chunk)
    uniforms.uCellNormals = { value: [
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, -1, 0),
    ] };
  }
  return new THREE.ShaderMaterial({
    uniforms,
    defines: {
      CLOUD_STEPS: Math.max(8, Math.round(steps)),
      CLOUD_LIGHT_STEPS: Math.max(1, Math.round(lightSteps)),
      CLOUD_OCTAVES: Math.max(1, Math.round(octaves)),
      CLOUD_DETAIL_OCTAVES: Math.max(0, Math.round(detailOctaves)),
      CLOUD_USE_EROSION: useErosion ? 1 : 0,
      CLOUD_LIGHT_MODE: lightMode ? 1 : 0,
      CLOUD_CHUNK: chunk ? 1 : 0,
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: false,          // far-side occlusion handled analytically + depth clamp
    side: THREE.BackSide,      // full-disc coverage from inside and outside
  });
}
