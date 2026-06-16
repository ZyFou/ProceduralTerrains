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

  if (tEnd <= tStart) discard;

  float segLen = tEnd - tStart;
  float stepLen = segLen / float(CLOUD_STEPS);

  // small hash dither on the start offset to break up banding
  float dither = cl_hash13(vWorldPos * 0.5 + uCloudTime);
  float t = tStart + stepLen * dither;

  float transmittance = 1.0;
  vec3 scatter = vec3(0.0);
  vec3 ambient = uCloudShadowColor * uCloudShadowStrength;

  for (int i = 0; i < CLOUD_STEPS; i++) {
    // conditional (not a break) keeps the loop bound static for the compiler
    if (transmittance > 0.01) {
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
 */
export function createCloudMaterial(steps = 64, lightSteps = 6, octaves = 5, detailOctaves = 4, useErosion = true) {
  return new THREE.ShaderMaterial({
    uniforms: {
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
    },
    defines: {
      CLOUD_STEPS: Math.max(8, Math.round(steps)),
      CLOUD_LIGHT_STEPS: Math.max(1, Math.round(lightSteps)),
      CLOUD_OCTAVES: Math.max(1, Math.round(octaves)),
      CLOUD_DETAIL_OCTAVES: Math.max(0, Math.round(detailOctaves)),
      CLOUD_USE_EROSION: useErosion ? 1 : 0,
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: false,          // far-side occlusion handled analytically
    side: THREE.BackSide,      // full-disc coverage from inside and outside
  });
}
