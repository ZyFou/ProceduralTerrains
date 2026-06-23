import * as THREE from 'three';
import { CLOUD_NOISE_GLSL, CLOUD_FIELD_GLSL, CLOUD_SLAB_GLSL } from './cloudGLSL.js';

// ============================================================================
// CloudSlabShader: the flat-mode (studio board) analog of CloudVolumeShader.
// Instead of a spherical shell it raymarches a horizontal slab between two
// world-Y planes (uCloudBottom..uCloudTop), fading out past a horizontal radius
// so the clouds sit over the board like a diorama layer.
//
// Shares the noise + cloud-field GLSL and all cloud uniforms with the spherical
// shader — only the geometry of the marched volume differs. Drawn on a large
// horizontal plane after opaque terrain has populated the depth buffer; the slab
// segment is found analytically from the ray vs the two Y planes (clamped to
// uCloudFar to bound the horizon). Opaque scene depth from a prepass clamps the
// marched segment, so hidden clouds exit before doing expensive samples.
//
// Step counts are compile-time #defines (statically bounded loops) exactly as
// in the spherical shader, to keep the ANGLE/D3D11 compiler happy.
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
${CLOUD_SLAB_GLSL}

varying vec3 vWorldPos;

uniform sampler2D tSceneDepth;
uniform vec2 uDepthResolution;
uniform mat4 uProjectionMatrixInverse;
uniform mat4 uViewMatrixInverse;
uniform float uDepthBias;

// Planar occupancy grid (XZ): a small map (built on the CPU from the coverage
// field, conservative + dilated) telling whether a column over the board holds
// any cloud. A cheap texture lookup lets the march skip the expensive density
// over empty columns and reject empty rays — the freed budget also cuts grain.
uniform sampler2D uCloudOccupancy;
uniform float uUseOccupancy;
uniform vec2 uOccCenter;   // board-center XZ
uniform float uOccExtent;  // half-size of the mapped square (= fade radius)

float occAt(vec3 P) {
  vec2 uv = (P.xz - uOccCenter) / (2.0 * max(uOccExtent, 1.0)) + 0.5;
  return texture2D(uCloudOccupancy, uv).r;
}

vec3 reconstructWorldPosition(vec2 uv, float depth) {
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uProjectionMatrixInverse * clip;
  view.xyz /= view.w;
  return (uViewMatrixInverse * vec4(view.xyz, 1.0)).xyz;
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorldPos - cameraPosition);

  // intersect the ray with the two horizontal slab planes
  float t0, t1;
  if (abs(rd.y) < 1e-5) {
    // near-horizontal ray: only inside the slab if the camera already is
    if (ro.y <= uCloudBottom || ro.y >= uCloudTop) discard;
    t0 = 0.0;
    t1 = uCloudFar;
  } else {
    float ta = (uCloudBottom - ro.y) / rd.y;
    float tb = (uCloudTop - ro.y) / rd.y;
    t0 = max(min(ta, tb), 0.0);
    t1 = min(max(ta, tb), uCloudFar);
  }
  if (t1 <= t0) discard;

  // clamp the segment to the cloud disc (radius uCloudRadius around the board
  // center): beyond it the radial fade is zero, so this both skips wasted
  // marching AND keeps the step fine on grazing rays (much less stipple).
  {
    vec2 oc = ro.xz - uCloudCenter.xz;
    vec2 dc = rd.xz;
    float A = dot(dc, dc);
    if (A > 1e-8) {
      float B = dot(oc, dc);
      float C = dot(oc, oc) - uCloudRadius * uCloudRadius;
      float disc = B * B - A * C;
      if (disc < 0.0) discard;                 // ray never crosses the disc
      float sq = sqrt(disc);
      t0 = max(t0, (-B - sq) / A);
      t1 = min(t1, (-B + sq) / A);
      if (t1 <= t0) discard;
    } else {
      // vertical ray: only inside the disc if the camera column is within it
      if (dot(oc, oc) > uCloudRadius * uCloudRadius) discard;
    }
  }

  vec2 depthUv = gl_FragCoord.xy / max(uDepthResolution, vec2(1.0));
  if (depthUv.x >= 0.0 && depthUv.x <= 1.0 && depthUv.y >= 0.0 && depthUv.y <= 1.0) {
    float sceneDepth = texture2D(tSceneDepth, depthUv).x;
    if (sceneDepth < 0.99999) {
      vec3 sceneHit = reconstructWorldPosition(depthUv, sceneDepth);
      float hitT = dot(sceneHit - ro, rd);
      if (hitT > 0.0 && hitT < t1) {
        t1 = hitT - uDepthBias;
        if (t1 <= t0) discard;
      }
    }
  }

  // distance LOD: fewer effective steps when far (uCloudStepScale<1); loop
  // bound stays CLOUD_STEPS (static for ANGLE), extra iterations no-op.
  int effSteps = int(float(CLOUD_STEPS) * clamp(uCloudStepScale, 0.05, 1.0) + 0.5);
  effSteps = max(effSteps, 8);
  float segLen = t1 - t0;
  float stepLen = segLen / float(effSteps);

  float dither = cl_hash13(vec3(gl_FragCoord.xy, uCloudTime));

  float transmittance = 1.0;
  vec3 scatter = vec3(0.0);
  vec3 ambient = uCloudShadowColor * uCloudShadowStrength;

  // whole-ray reject: if the columns the segment crosses are all empty, skip it
  if (uUseOccupancy > 0.5) {
    float oA = occAt(ro + rd * t0);
    float oM = occAt(ro + rd * (t0 + t1) * 0.5);
    float oB = occAt(ro + rd * t1);
    if (max(oA, max(oM, oB)) < 0.5) discard;
  }

  // OCCUPANCY-GRID empty-space skipping: a cheap lookup gates the expensive
  // cloudDensity — empty columns are skipped with a coarse stride, occupied
  // columns march at the fine step. The map is conservative + dilated (no clip).
  float coarse = stepLen * 2.0;
  float t = t0 + stepLen * dither;
  for (int i = 0; i < CLOUD_STEPS; i++) {
    if (t < t1 && transmittance > 0.01) {
      vec3 P = ro + rd * t;
      float occ = uUseOccupancy > 0.5 ? occAt(P) : 1.0;
      if (occ < 0.5) {
        t += coarse;
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

  float alpha = 1.0 - transmittance;
  if (alpha < 0.004) discard;

  vec3 col = scatter / max(alpha, 1e-4);
  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, alpha);
}
`;

export function createCloudSlabMaterial(steps = 24, lightSteps = 6, octaves = 5, detailOctaves = 4, useErosion = true, lightMode = 0) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uCloudBottom:          { value: 900 },
      uCloudTop:             { value: 1520 },
      uCloudRadius:          { value: 1500 },
      uCloudFar:             { value: 9000 },
      uCloudCenter:          { value: new THREE.Vector3() },
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
      uCloudOccupancy:       { value: null },
      uUseOccupancy:         { value: 0.0 },
      uOccCenter:            { value: new THREE.Vector2() },
      uOccExtent:            { value: 1500 },
    },
    defines: {
      CLOUD_STEPS: Math.max(8, Math.round(steps)),
      CLOUD_LIGHT_STEPS: Math.max(1, Math.round(lightSteps)),
      CLOUD_OCTAVES: Math.max(1, Math.round(octaves)),
      CLOUD_DETAIL_OCTAVES: Math.max(0, Math.round(detailOctaves)),
      CLOUD_USE_EROSION: useErosion ? 1 : 0,
      CLOUD_LIGHT_MODE: lightMode ? 1 : 0,
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: false,         // occlusion is handled by tSceneDepth per pixel
    // BackSide on a box that ENCLOSES the slab volume: the back faces always
    // project over the volume's screen footprint from inside, outside, above or
    // below (mirrors the planet shell's BackSide sphere). A flat plane left the
    // clouds clipped at grazing angles from below, where horizon-bound rays hit
    // the finite plane beyond its extent and produced no fragment.
    side: THREE.BackSide,
  });
}
