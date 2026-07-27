import * as THREE from 'three';
import { COMMON_UNIFORMS_GLSL, TERRAIN_HEIGHT_TEX_GLSL } from '../terrain/terrainGLSL.js';
import { PALETTE_UNIFORMS_GLSL } from '../shaders/terrainColor.glsl.js';
import {
  PROCEDURAL_SKY_UNIFORMS_GLSL,
  PROCEDURAL_SKY_EVALUATION_GLSL,
  createProceduralSkyUniforms,
} from '../sky/proceduralSkyGLSL.js';
import { generateStackGLSL } from '../terrain/noise/noiseStackCodegen.js';
import { defaultLegacyStack } from '../terrain/noise/NoiseStack.js';
import { buildWaterHeightShaderParts } from './waterShaderGLSL.js';
import { WATER_OPTICS_GLSL } from './waterOpticsGLSL.js';
import { WATER_WAVES_GLSL } from './waterWavesGLSL.js';

const DEFAULT_STACK_GLSL = generateStackGLSL(defaultLegacyStack());

// ============================================================================
// Realistic Water Surface V2 — physical depth absorption, coherent directional
// normals, live procedural-sky reflection, roughness-aware sunlight and foam.
// This remains a single transparent pass with no scene/reflection render target.
// ============================================================================

const VERTEX = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const buildFragment = (stackGLSL, infinite = false) => {
  const { dependencies, terrainHeightFunction } = buildWaterHeightShaderParts(stackGLSL, infinite);
  return /* glsl */ `
precision highp float;

${COMMON_UNIFORMS_GLSL}
${dependencies}
${TERRAIN_HEIGHT_TEX_GLSL}
${PALETTE_UNIFORMS_GLSL}
${terrainHeightFunction}
${PROCEDURAL_SKY_UNIFORMS_GLSL}

uniform float uWaterAnim;
uniform float uWaterFadeStart;
uniform float uWaterFadeEnd;

uniform float uWaterQuality;
uniform float uWaterDetail;
uniform float uWaterReflection;
uniform float uWaveComplexity;
uniform float uRoughness;
uniform float uReflectionQuality;
uniform float uMicroWaveDetail;
uniform float uSkyReflectionEnabled;

// realistic water controls
uniform float uWaterTier;          // 1=realistic, 2=volumetric, 3=cinematic
uniform float uWaterOpacity;
uniform float uFresnelStrength;
uniform float uRefractionStrength;
uniform float uSpecularStrength;
uniform float uDepthColorStr;
uniform float uDepthOpacityStr;
uniform float uMaxVisibleDepth;
uniform float uDepthFalloff;
uniform float uShallowDist;
uniform float uDeepDist;
uniform float uAbsorptionStr;
uniform float uWaveSpeed;
uniform float uWaveScale;
uniform float uWaveStrength;
uniform float uSmallWaveStr;
uniform float uLargeWaveStr;
uniform float uNormalIntensity;
uniform vec2  uWaveDir;
uniform float uAnimSpeed;
uniform float uFoamEnabled;
uniform float uFoamStrength;
uniform float uFoamWidth;
uniform float uFoamSoftness;
uniform float uFoamAnimSpeed;
uniform float uSlopeFoam;
uniform float uCliffFoam;
uniform float uCausticsStr;
uniform float uRefractionQual;
uniform float uFoamQual;
uniform float uCausticsQual;
uniform float uDebugMode;          // see WaterDebugViews / setWaterDebugMode
uniform float uVisualFoamBreakup;
uniform float uVisualWetSandRange;
uniform float uVisualShallowWaterSoftness;

varying vec3 vWorldPos;

${PROCEDURAL_SKY_EVALUATION_GLSL}
${WATER_OPTICS_GLSL}
${WATER_WAVES_GLSL}

float terrainHeightAt(vec2 xz) {
  return waterTerrainHeightAt(xz);
}

// Cheap cross-kernel smoothing for depth tint. Reuses center sample when provided.
float smoothedFloorHeight(vec2 xz, float centerH) {
  float e = mix(8.0, 16.0, clamp(uVisualShallowWaterSoftness, 0.0, 1.0));
  float h1 = terrainHeightAt(xz + vec2(e, 0.0));
  float h2 = terrainHeightAt(xz - vec2(e, 0.0));
  float h3 = terrainHeightAt(xz + vec2(0.0, e));
  float h4 = terrainHeightAt(xz + vec2(0.0, -e));
  return (centerH + h1 + h2 + h3 + h4) * 0.2;
}

float slopeFromCenter(vec2 xz, float centerH) {
  float e = 4.0;
  float hx = terrainHeightAt(xz + vec2(e, 0.0));
  float hz = terrainHeightAt(xz + vec2(0.0, e));
  return length(vec2(hx - centerH, hz - centerH)) / e;
}

void main() {
  vec2 xz = vWorldPos.xz;

#ifndef INFINITE_MODE
  if (tileOccupiedAt(xz) < 0.5) discard;
#endif

  float floorH = terrainHeightAt(xz);
  float depth = uSeaLevel - floorH;
  if (depth <= 0.02) discard;

  // Smoothed bathymetry for depth tint — 4 extra samples max (not 20+).
  float visualDepth = depth;
  if (uDepthColorStr > 0.05 || uDepthOpacityStr > 0.05) {
    visualDepth = uSeaLevel - smoothedFloorHeight(xz, floorH);
  }
  visualDepth = max(visualDepth, 0.0);

  float camDist = length(cameraPosition - vWorldPos);
  float farWater = smoothstep(700.0, 2400.0, camDist);
  float roughness = clamp(uRoughness + farWater * 0.18, 0.04, 1.0);
  float t = uTime * uWaterAnim * uAnimSpeed;
  vec3 n = waterDirectionalNormal(xz, t, camDist, roughness);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  if (dot(n, viewDir) < 0.0) n = -n;

  // depth grading — smoothed bathymetry only (not raw relief)
  float shoreSoft = clamp(uVisualShallowWaterSoftness, 0.0, 1.0);
  float shallowT = smoothstep(0.0, uShallowDist * (1.0 + shoreSoft * 0.85), visualDepth);
  float deepT = smoothstep(uShallowDist, uDeepDist * (1.0 + shoreSoft * 0.45), visualDepth);
  float dGrade = pow(clamp(visualDepth / max(uMaxVisibleDepth, 1.0), 0.0, 1.0), max(uDepthFalloff, 0.1));
  dGrade = mix(shallowT * 0.35, deepT, dGrade) * uDepthColorStr;

  vec3 shallowColor = mix(
    vec3(dot(uColShallow, vec3(0.299, 0.587, 0.114))),
    uColShallow,
    uPaletteSaturation
  ) * uPaletteTint;
  vec3 deepColor = mix(
    vec3(dot(uColDeep, vec3(0.299, 0.587, 0.114))),
    uColDeep,
    uPaletteSaturation
  ) * uPaletteTint;
  vec3 scatteringColor = mix(shallowColor, deepColor, clamp(dGrade, 0.0, 1.0));

  // Beer–Lambert absorption. Looking across the surface increases the path
  // length, so shallow grazing views naturally become denser than top-down ones.
  float opticalDepth = visualDepth / max(abs(viewDir.y), 0.15);
  vec3 absorptionRGB = waterAbsorptionCoefficients(
    deepColor,
    uAbsorptionStr,
    uWaterOpacity,
    uDepthOpacityStr
  );
  vec3 transmittance = waterBeerLambert(absorptionRGB, opticalDepth);
  float transmissionExponent = pow(
    0.45 / max(uRefractionStrength, 0.05),
    0.18
  );
  transmittance = pow(
    transmittance,
    vec3(clamp(transmissionExponent, 0.72, 1.45))
  );
  float volumeAlpha = waterVolumeOpacity(transmittance);

  // Schlick Fresnel now follows the animated wave normal.
  float fres = waterSchlickFresnel(n, viewDir, uFresnelStrength);

  // Evaluate the same live procedural sky as the sky dome. Rough water blends
  // toward a broad reflection direction; distant water trends toward horizon
  // radiance and suppresses micro detail through waterDirectionalNormal().
  vec3 reflectedDirection = reflect(-viewDir, n);
  float reflectionDetail = clamp(uReflectionQuality, 0.0, 1.0);
  float reflectionBlur = clamp(
    roughness * roughness + (1.0 - reflectionDetail) * 0.32,
    0.0,
    1.0
  );
  vec3 broadDirection = normalize(vec3(
    reflectedDirection.x * 0.42,
    max(reflectedDirection.y, 0.08),
    reflectedDirection.z * 0.42
  ));
  vec3 reflectedSkySharp = evaluateProceduralSkyLinear(
    reflectedDirection,
    mix(1.0, 0.12, reflectionBlur),
    mix(0.35, 0.0, reflectionBlur)
  );
  vec3 reflectedSkyBroad = evaluateProceduralSkyLinear(broadDirection, 0.0, 0.0);
  vec3 reflectedSky = mix(
    reflectedSkySharp,
    reflectedSkyBroad,
    reflectionBlur * 0.82
  );
  vec3 horizonDirection = normalize(vec3(
    reflectedDirection.x,
    0.06,
    reflectedDirection.z
  ));
  reflectedSky = mix(
    reflectedSky,
    evaluateProceduralSkyLinear(horizonDirection, 0.0, 0.0),
    farWater * 0.42
  );
  vec3 fallbackReflection = mix(
    uSkyFogColor,
    vec3(0.12, 0.24, 0.38),
    clamp(reflectedDirection.y, 0.0, 1.0)
  );
  float liveSkyAmount = uSkyReflectionEnabled
    * mix(0.35, 1.0, reflectionDetail);
  reflectedSky = mix(fallbackReflection, reflectedSky, liveSkyAmount);

  float reflectionScale = clamp(uWaterReflection, 0.0, 1.5);
  vec3 reflectionTerm = reflectedSky * fres * reflectionScale;

  // Roughness-aware GGX sunlight uses the current sky sun color/intensity.
  vec3 skySunDir = normalize(uSkySunDir);
  float sunSpecular = min(
    waterGgxSunSpecular(n, viewDir, skySunDir, roughness),
    8.0
  );
  vec3 sunSpecularTerm = uSkySunColor
    * uSkyLightIntensity
    * sunSpecular
    * uSpecularStrength
    * reflectionScale;

  // The transparent blend supplies background transmission until Phase 3 adds
  // an opaque-scene color buffer. The emitted body color is premultiplied.
  float diff = max(dot(n, uSunDir), 0.0);
  vec3 bodyPremultiplied = scatteringColor
    * (vec3(1.0) - transmittance)
    * (0.62 + 0.38 * diff)
    * (1.0 - fres);
  vec3 premultipliedColor = bodyPremultiplied + reflectionTerm + sunSpecularTerm;
  float reflectionAlpha = clamp(fres * reflectionScale, 0.0, 0.98);
  float alpha = 1.0 - (1.0 - volumeAlpha) * (1.0 - reflectionAlpha);

  // shoreline foam — depth-based only; slope foam restricted to very shallow water
  float shoreDist = depth;
  float foamNoise = 0.0;
  if (uFoamEnabled > 0.5 && uFoamQual > 0.1) {
    foamNoise = vnoise(xz * 0.18 + vec2(t * uFoamAnimSpeed * 1.4, -t * uFoamAnimSpeed * 1.1));
  }
  float breakup = clamp(uVisualFoamBreakup, 0.0, 1.0);
  float foamEdgeNoise = foamNoise * mix(1.4, 4.2, breakup);
  float foamPatch = mix(1.0, smoothstep(0.18, 0.82, vnoise(xz * 0.055 + vec2(t * 0.35, t * -0.28))), breakup);
  float shoreFoam = smoothstep(uFoamWidth + uFoamSoftness + uVisualWetSandRange * 0.05, uFoamSoftness, shoreDist + foamEdgeNoise);
  float nearShore = smoothstep(10.0 + uVisualWetSandRange * 0.35, 0.0, shoreDist);
  float slopeFoam = 0.0;
  float cliffFoam = 0.0;
  if (uFoamEnabled > 0.5 && nearShore > 0.01 && (uSlopeFoam > 0.01 || uCliffFoam > 0.01)) {
    float slope = slopeFromCenter(xz, floorH);
    slopeFoam = smoothstep(0.35, 1.1, slope) * uSlopeFoam * nearShore;
    cliffFoam = smoothstep(0.85, 1.8, slope) * uCliffFoam * nearShore;
  }
  float foam = clamp((shoreFoam * foamPatch + slopeFoam * 0.2 + cliffFoam * 0.15) * uFoamStrength, 0.0, 1.0);
  premultipliedColor = mix(premultipliedColor, uColFoam, foam);
  alpha = mix(alpha, 1.0, foam);

  // Actual distorted scene-color refraction arrives with the Volumetric pass.
  // This transmission term keeps the existing debug view physically meaningful.
  vec3 refractionTerm = transmittance * (1.0 - fres);

  // fake caustics in shallow water (smoothed depth, coarse noise)
  if (uCausticsQual > 0.05 && uWaterTier > 1.5) {
    float shallowMask = 1.0 - smoothstep(uShallowDist * 0.5, uDeepDist, visualDepth);
    float c1 = vnoise(xz * 0.09 + vec2(t * 0.9, -t * 0.7));
    float c2 = vnoise(xz * 0.14 - vec2(t * 0.6, t * 0.5));
    float caust = pow(max(c1 * c2, 0.0), 2.2) * shallowMask;
    premultipliedColor += vec3(0.9, 0.95, 1.0)
      * caust * uCausticsStr * uCausticsQual * 0.28 * alpha;
  }

  float edgeFade = 1.0 - smoothstep(uWaterFadeStart, uWaterFadeEnd, camDist);
  premultipliedColor *= edgeFade;
  alpha *= edgeFade;
  if (alpha < 0.01) discard;

  // debug views
  if (uDebugMode > 0.5) {
    if (uDebugMode < 1.5) {
      float dv = clamp(depth / max(uMaxVisibleDepth, 1.0), 0.0, 1.0);
      gl_FragColor = vec4(vec3(1.0 - dv, dv * 0.5, dv), 1.0);
      return;
    }
    if (uDebugMode < 2.5) {
      float sv = smoothstep(uFoamWidth + 2.0, 0.5, depth);
      gl_FragColor = vec4(vec3(sv), 1.0);
      return;
    }
    if (uDebugMode < 3.5) {
      gl_FragColor = vec4(vec3(foam), 1.0);
      return;
    }
    if (uDebugMode < 4.5) {
      gl_FragColor = vec4(0.1, 0.45, 0.95, 1.0);
      return;
    }
    if (uDebugMode < 5.5) {
      gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
      return;
    }
    if (uDebugMode < 6.5) {
      float od = 1.0 - exp(-opticalDepth / max(uMaxVisibleDepth, 1.0));
      gl_FragColor = vec4(vec3(od), 1.0);
      return;
    }
    if (uDebugMode < 7.5) {
      gl_FragColor = vec4(transmittance, 1.0);
      return;
    }
    if (uDebugMode < 8.5) {
      gl_FragColor = vec4(vec3(fres), 1.0);
      return;
    }
    if (uDebugMode < 9.5) {
      gl_FragColor = vec4(min(reflectedSky, vec3(1.0)), 1.0);
      return;
    }
    if (uDebugMode < 10.5) {
      gl_FragColor = vec4(clamp(refractionTerm, 0.0, 1.0), 1.0);
      return;
    }
    if (uDebugMode < 11.5) {
      gl_FragColor = vec4(vec3(alpha), 1.0);
      return;
    }
    gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
    return;
  }

  vec3 straightColor = premultipliedColor / max(alpha, 0.001);
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * camDist * camDist);
  fogF *= mix(0.82, 0.68, farWater);
  straightColor = mix(straightColor, uFogColor, clamp(fogF, 0.0, 1.0));
  straightColor = pow(max(straightColor, vec3(0.0)), vec3(1.0 / 2.2));
  gl_FragColor = vec4(straightColor * alpha, alpha);
}
`;
};

function realisticUniforms(sharedUniforms, environmentUniforms) {
  const skyUniforms = environmentUniforms ?? createProceduralSkyUniforms();
  return {
    ...sharedUniforms,
    ...skyUniforms,
    uWaterQuality: { value: 2.0 },
    uWaterDetail: { value: 1.0 },
    uWaterReflection: { value: 1.0 },
    uWaveComplexity: { value: 1.0 },
    uRoughness: { value: 0.35 },
    uReflectionQuality: { value: 1.0 },
    uMicroWaveDetail: { value: 1.0 },
    uSkyReflectionEnabled: { value: 1.0 },
    uWaterAnim: { value: 1.0 },
    uWaterFadeStart: { value: 99999.0 },
    uWaterFadeEnd: { value: 100000.0 },
    uWaterTier: { value: 1.0 },
    uWaterOpacity: { value: 0.72 },
    uFresnelStrength: { value: 1.0 },
    uRefractionStrength: { value: 0.45 },
    uSpecularStrength: { value: 1.0 },
    uDepthColorStr: { value: 1.0 },
    uDepthOpacityStr: { value: 1.0 },
    uMaxVisibleDepth: { value: 120.0 },
    uDepthFalloff: { value: 1.0 },
    uShallowDist: { value: 8.0 },
    uDeepDist: { value: 55.0 },
    uAbsorptionStr: { value: 1.0 },
    uWaveSpeed: { value: 1.0 },
    uWaveScale: { value: 1.0 },
    uWaveStrength: { value: 1.0 },
    uSmallWaveStr: { value: 0.65 },
    uLargeWaveStr: { value: 1.0 },
    uNormalIntensity: { value: 1.0 },
    uWaveDir: { value: new THREE.Vector2(1, 0) },
    uAnimSpeed: { value: 1.0 },
    uFoamEnabled: { value: 1.0 },
    uFoamStrength: { value: 0.75 },
    uFoamWidth: { value: 3.2 },
    uFoamSoftness: { value: 0.6 },
    uFoamAnimSpeed: { value: 1.0 },
    uSlopeFoam: { value: 0.5 },
    uCliffFoam: { value: 0.65 },
    uCausticsStr: { value: 0.4 },
    uRefractionQual: { value: 0.6 },
    uFoamQual: { value: 1.0 },
    uCausticsQual: { value: 0.5 },
    uDebugMode: { value: 0.0 },
  };
}

export function createRealisticWaterMaterial(
  sharedUniforms,
  octaves = 7,
  stackGLSL = DEFAULT_STACK_GLSL,
  environmentUniforms = null,
) {
  const mat = new THREE.ShaderMaterial({
    uniforms: realisticUniforms(sharedUniforms, environmentUniforms),
    defines: {},
    vertexShader: VERTEX,
    fragmentShader: buildFragment(stackGLSL, false),
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
  });
  mat.userData.bakedHeightOnly = true;
  return mat;
}

export function createInfiniteRealisticWaterMaterial(
  sharedUniforms,
  octaves = 7,
  stackGLSL = DEFAULT_STACK_GLSL,
  environmentUniforms = null,
) {
  const mat = new THREE.ShaderMaterial({
    uniforms: realisticUniforms(sharedUniforms, environmentUniforms),
    defines: { OCTAVES: octaves, INFINITE_MODE: 1 },
    vertexShader: VERTEX,
    fragmentShader: buildFragment(stackGLSL, true),
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
  });
  mat.uniforms.uWaterFadeStart.value = 2000.0;
  mat.uniforms.uWaterFadeEnd.value = 2500.0;
  return mat;
}

export function rebuildRealisticWaterShaderSource(mat, stackGLSL) {
  const infinite = Object.hasOwn(mat.defines ?? {}, 'INFINITE_MODE');
  mat.fragmentShader = buildFragment(stackGLSL, infinite);
  mat.needsUpdate = true;
}

export function applyRealisticWaterUniforms(mat, params, mode) {
  if (!mat?.uniforms) return;
  const u = mat.uniforms;
  const tier = mode === 'cinematic' ? 3 : mode === 'volumetric' ? 2 : 1;
  const dirRad = (params.waterWaveDirection ?? 0) * Math.PI / 180;
  u.uWaterTier.value = tier;
  u.uWaterOpacity.value = params.waterOpacity ?? 0.72;
  u.uRoughness.value = params.waterRoughness ?? 0.35;
  u.uReflectionQuality.value = params.waterReflectionQuality ?? 1;
  u.uMicroWaveDetail.value = params.waterNormalResolution ?? 1;
  u.uSkyReflectionEnabled.value = params.skyboxEnabled !== false ? 1 : 0;
  u.uFresnelStrength.value = params.waterFresnelStrength ?? 1;
  u.uRefractionStrength.value = params.waterRefractionStrength ?? 0.45;
  u.uSpecularStrength.value = params.waterSpecularStrength ?? 1;
  u.uDepthColorStr.value = params.waterDepthColorStrength ?? 1;
  u.uDepthOpacityStr.value = params.waterDepthOpacityStrength ?? 1;
  u.uMaxVisibleDepth.value = params.waterMaxVisibleDepth ?? 120;
  u.uDepthFalloff.value = params.waterDepthFalloff ?? 1;
  u.uShallowDist.value = params.waterShallowDistance ?? 8;
  u.uDeepDist.value = params.waterDeepDistance ?? 55;
  u.uAbsorptionStr.value = params.waterAbsorptionStrength ?? 1;
  u.uWaveSpeed.value = params.waterWaveSpeed ?? 1;
  u.uWaveScale.value = params.waterWaveScale ?? 1;
  u.uWaveStrength.value = params.waterWaveStrength ?? 1;
  u.uSmallWaveStr.value = params.waterSmallWaveStrength ?? 0.65;
  u.uLargeWaveStr.value = params.waterLargeWaveStrength ?? 1;
  u.uNormalIntensity.value = params.waterNormalIntensity ?? 1;
  u.uWaveDir.value.set(Math.cos(dirRad), Math.sin(dirRad));
  u.uAnimSpeed.value = params.waterAnimSpeed ?? 1;
  u.uFoamEnabled.value = params.waterFoamEnabled !== false ? 1 : 0;
  u.uFoamStrength.value = params.waterFoamStrength ?? 0.75;
  u.uFoamWidth.value = params.waterFoamWidth ?? 3.2;
  u.uFoamSoftness.value = params.waterFoamSoftness ?? 0.6;
  u.uFoamAnimSpeed.value = params.waterFoamAnimSpeed ?? 1;
  u.uSlopeFoam.value = params.waterSlopeFoam ?? 0.5;
  u.uCliffFoam.value = params.waterCliffFoam ?? 0.65;
  u.uCausticsStr.value = params.waterUnderwaterCaustics ?? 0.4;
  u.uRefractionQual.value = (params.waterRefractionQuality ?? 0.6) * (tier >= 2 ? 1 : 0.5);
  u.uFoamQual.value = params.waterFoamQuality ?? 1;
  u.uCausticsQual.value = (params.waterCausticsQuality ?? 0.5) * (tier >= 2 ? 1 : 0.25);
}

export function setWaterDebugMode(mat, debugView) {
  if (!mat?.uniforms?.uDebugMode) return;
  const map = {
    off: 0,
    depth: 1,
    shoreline: 2,
    foam: 3,
    mask: 4,
    normal: 5,
    opticalDepth: 6,
    transmittance: 7,
    fresnel: 8,
    reflection: 9,
    refraction: 10,
    opacity: 11,
  };
  mat.uniforms.uDebugMode.value = map[debugView] ?? 0;
}
