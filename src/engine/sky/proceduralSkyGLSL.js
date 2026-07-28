import * as THREE from 'three';

// ============================================================================
// Shared procedural-sky shader evaluation.
//
// The sky dome and Realistic Water V2 include the same function and bind the
// same uniform objects. This keeps analytical water reflections in lock-step
// with time of day and sky appearance without a reflection render target.
// ============================================================================

export const PROCEDURAL_SKY_UNIFORMS_GLSL = /* glsl */ `
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSkySunColor;
uniform vec3 uSkyFogColor;
uniform vec3 uSkySunDir;
uniform float uSkyLightIntensity;
uniform float uSkyBrightness;
uniform float uSkyHaze;
uniform float uSkyStars;
uniform float uSkyHdrIntensity;
uniform float uSkySunGlow;
uniform float uSkyHorizonGlow;
uniform vec3 uSkyAtmosphereTint;
`;

export const PROCEDURAL_SKY_EVALUATION_GLSL = /* glsl */ `
vec3 evaluateProceduralSkyLinear(
  vec3 direction,
  float sunDiscStrength,
  float starStrength
) {
  vec3 dir = normalize(direction);
  float y = dir.y;

  float horizonBlend = 1.0 - pow(max(y, 0.0), 0.45);
  vec3 skyCol = mix(uSkyZenith, uSkyHorizon, horizonBlend) * uSkyAtmosphereTint;

  float hazeBand = exp(-abs(y) * 8.0);
  skyCol = mix(skyCol, uSkyFogColor, hazeBand * uSkyHaze);
  if (y < 0.0) {
    float belowBlend = clamp(-y * 5.0, 0.0, 1.0);
    skyCol = mix(skyCol, uSkyFogColor, belowBlend);
  }

  float sunDot = max(dot(dir, normalize(uSkySunDir)), 0.0);
  float sunDisc = smoothstep(0.9994, 0.9998, sunDot);
  float sunGlow = pow(sunDot, 256.0) * 0.8;
  float sunHalo = pow(sunDot, 32.0) * 0.25;
  float sunScatter = pow(sunDot, 8.0) * 0.08;
  vec3 sunCol = uSkySunColor * uSkyLightIntensity;
  skyCol += sunCol * (
    sunDisc * 3.0 * sunDiscStrength
    + sunGlow * mix(0.35, 1.0, sunDiscStrength)
    + sunHalo * uSkySunGlow
  ) * uSkySunGlow;

  float scatterMask = exp(-abs(y) * 3.0);
  skyCol += uSkySunColor * sunScatter * scatterMask * uSkyLightIntensity;

  float horizonWarmth = pow(sunDot, 4.0) * hazeBand * 0.3;
  skyCol += uSkySunColor * horizonWarmth * uSkyLightIntensity * (1.0 + uSkyHorizonGlow);
  skyCol += uSkyHorizon * hazeBand * uSkyHorizonGlow * 0.35;

  float nightFactor = smoothstep(0.15, -0.1, uSkySunDir.y)
    * uSkyStars * starStrength;
  if (nightFactor > 0.01 && y > 0.0) {
    vec3 starGrid = floor(dir * 300.0);
    vec3 p = fract(starGrid * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    float starHash = fract((p.x + p.y) * p.z);
    float star = step(0.998, starHash) * pow(max(y, 0.0), 0.3);
    float twinkle = 0.7 + 0.3 * sin(starHash * 6283.0 + starGrid.x * 0.5);
    skyCol += vec3(0.8, 0.85, 1.0) * star * twinkle * nightFactor * 0.6;
  }

  return max(skyCol * uSkyBrightness * uSkyHdrIntensity, vec3(0.0));
}
`;

export function createProceduralSkyUniforms() {
  return {
    uSkyZenith:         { value: new THREE.Color(0.18, 0.35, 0.72) },
    uSkyHorizon:        { value: new THREE.Color(0.50, 0.62, 0.78) },
    uSkySunColor:       { value: new THREE.Color(1.0, 0.98, 0.92) },
    uSkyFogColor:       { value: new THREE.Color(0.55, 0.62, 0.75) },
    uSkySunDir:         { value: new THREE.Vector3(0.5, 0.7, 0.3).normalize() },
    uSkyLightIntensity: { value: 1.0 },
    uSkyBrightness:     { value: 1.0 },
    uSkyHaze:           { value: 0.55 },
    uSkyStars:          { value: 1.0 },
    uSkyHdrIntensity:   { value: 1.08 },
    uSkySunGlow:        { value: 1.0 },
    uSkyHorizonGlow:    { value: 0.35 },
    uSkyAtmosphereTint: { value: new THREE.Color(1.0, 0.98, 0.92) },
  };
}
