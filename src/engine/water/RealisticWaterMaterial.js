import * as THREE from 'three';
import { COMMON_UNIFORMS_GLSL, NOISE_GLSL, buildHeightGLSL, TERRAIN_HEIGHT_TEX_GLSL } from '../terrain/terrainGLSL.js';
import { BIOME_GLSL } from '../terrain/biomeGLSL.js';
import { PALETTE_UNIFORMS_GLSL } from '../shaders/terrainColor.glsl.js';
import { generateStackGLSL } from '../terrain/noise/noiseStackCodegen.js';
import { defaultLegacyStack } from '../terrain/noise/NoiseStack.js';

const DEFAULT_STACK_GLSL = generateStackGLSL(defaultLegacyStack());

// ============================================================================
// Realistic volumetric water — depth tint, layered normals, shoreline foam,
// fresnel, optional caustics/refraction. Quality tier is a uniform so mode
// switches never recompile; only octave/stack changes recompile.
// ============================================================================

const VERTEX = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const buildFragment = (heightGLSL) => /* glsl */ `
precision highp float;

${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${BIOME_GLSL}
${heightGLSL}
${TERRAIN_HEIGHT_TEX_GLSL}
${PALETTE_UNIFORMS_GLSL}

uniform float uWaterAnim;
uniform float uWaterFadeStart;
uniform float uWaterFadeEnd;

uniform float uWaterQuality;
uniform float uWaterDetail;
uniform float uWaterReflection;
uniform float uWaveComplexity;

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
uniform float uDebugMode;          // 0=off, 1=depth, 2=shore, 3=foam, 4=water mask
uniform float uVisualFoamBreakup;
uniform float uVisualWetSandRange;
uniform float uVisualShallowWaterSoftness;

varying vec3 vWorldPos;

float rippleLayer(vec2 p, float t, float scale, float speed) {
  vec2 drift = uWaveDir * t * speed;
  float h = vnoise(p * scale + drift);
  if (uWaterQuality > 0.5) {
    h += 0.45 * uWaterDetail * vnoise(p * scale * 2.4 - drift * 1.3);
  }
  if (uWaterTier > 2.5) {
    h += 0.25 * vnoise(p * scale * 5.1 + drift * 0.7);
  }
  return h;
}

vec3 rippleNormal(vec2 xz, float t) {
  float e = 1.4 / max(uWaveScale, 0.2);
  vec2 rp = xz * 0.055 * uWaveScale;
  float ws = uWaveStrength * uWaveComplexity;
  float r0 = rippleLayer(rp, t, 1.0, uWaveSpeed) * uLargeWaveStr
           + rippleLayer(rp, t, 2.6, uWaveSpeed * 1.3) * uSmallWaveStr;
  float rX = rippleLayer(rp + vec2(e * 0.055, 0.0), t, 1.0, uWaveSpeed) * uLargeWaveStr
           + rippleLayer(rp + vec2(e * 0.055, 0.0), t, 2.6, uWaveSpeed * 1.3) * uSmallWaveStr;
  float rZ = rippleLayer(rp + vec2(0.0, e * 0.055), t, 1.0, uWaveSpeed) * uLargeWaveStr
           + rippleLayer(rp + vec2(0.0, e * 0.055), t, 2.6, uWaveSpeed * 1.3) * uSmallWaveStr;
  float nStr = 1.8 * uNormalIntensity * ws;
  return normalize(vec3(-(rX - r0) * nStr, 1.0, -(rZ - r0) * nStr));
}

float terrainHeightAt(vec2 xz) {
#ifndef INFINITE_MODE
  if (uUseTerrainHeightTex > 0.5) return bakedHeightAt(xz);
#endif
  return heightAt(xz);
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

  float t = uTime * uWaterAnim * uAnimSpeed;
  vec3 n = rippleNormal(xz, t);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);

  // depth grading — smoothed bathymetry only (not raw relief)
  float shoreSoft = clamp(uVisualShallowWaterSoftness, 0.0, 1.0);
  float shallowT = smoothstep(0.0, uShallowDist * (1.0 + shoreSoft * 0.85), visualDepth);
  float deepT = smoothstep(uShallowDist, uDeepDist * (1.0 + shoreSoft * 0.45), visualDepth);
  float dGrade = pow(clamp(visualDepth / max(uMaxVisibleDepth, 1.0), 0.0, 1.0), max(uDepthFalloff, 0.1));
  dGrade = mix(shallowT * 0.35, deepT, dGrade) * uDepthColorStr;

  vec3 col = mix(uColShallow, uColDeep, clamp(dGrade, 0.0, 1.0));
  col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, uPaletteSaturation);
  col *= uPaletteTint;

  // absorption darkens deep water
  col *= 1.0 - uAbsorptionStr * deepT * 0.35;

  // lighting
  float diff = max(dot(n, uSunDir), 0.0);
  col *= 0.52 + 0.68 * diff;
  float spec = pow(max(dot(reflect(-uSunDir, n), viewDir), 0.0), 80.0 + 20.0 * uWaterTier);
  col += vec3(1.0, 0.95, 0.85) * spec * 0.55 * uWaterReflection * uSpecularStrength;

  float fres = pow(1.0 - max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0), 3.0);
  col += vec3(0.30, 0.42, 0.55) * fres * 0.28 * uWaterReflection * uFresnelStrength;

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
  col = mix(col, uColFoam, foam);

  // fake refraction tint (screen-space-ish color shift)
  if (uRefractionQual > 0.05 && uWaterTier > 0.5) {
    float refr = fres * uRefractionStrength * uRefractionQual * 0.12;
    col = mix(col, uColShallow * 1.1, refr);
  }

  // fake caustics in shallow water (smoothed depth, coarse noise)
  if (uCausticsQual > 0.05 && uWaterTier > 1.5) {
    float shallowMask = 1.0 - smoothstep(uShallowDist * 0.5, uDeepDist, visualDepth);
    float c1 = vnoise(xz * 0.09 + vec2(t * 0.9, -t * 0.7));
    float c2 = vnoise(xz * 0.14 - vec2(t * 0.6, t * 0.5));
    float caust = pow(max(c1 * c2, 0.0), 2.2) * shallowMask;
    col += vec3(0.9, 0.95, 1.0) * caust * uCausticsStr * uCausticsQual * 0.28;
  }

  float alpha = clamp(
    uWaterOpacity * (0.45 + deepT * 0.42 * uDepthOpacityStr + fres * 0.12 + foam * 0.25),
    0.0, 0.96
  );

  float camDist = length(cameraPosition.xz - vWorldPos.xz);
  float edgeFade = 1.0 - smoothstep(uWaterFadeStart, uWaterFadeEnd, camDist);
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
    gl_FragColor = vec4(0.1, 0.45, 0.95, 1.0);
    return;
  }

  float dist = length(cameraPosition - vWorldPos);
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
  col = pow(col, vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, alpha);
}
`;

function realisticUniforms(sharedUniforms) {
  return {
    ...sharedUniforms,
    uWaterQuality: { value: 2.0 },
    uWaterDetail: { value: 1.0 },
    uWaterReflection: { value: 1.0 },
    uWaveComplexity: { value: 1.0 },
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

export function createRealisticWaterMaterial(sharedUniforms, octaves = 7, stackGLSL = DEFAULT_STACK_GLSL) {
  return new THREE.ShaderMaterial({
    uniforms: realisticUniforms(sharedUniforms),
    defines: { OCTAVES: octaves },
    vertexShader: VERTEX,
    fragmentShader: buildFragment(buildHeightGLSL(stackGLSL.body2d)),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
  });
}

export function createInfiniteRealisticWaterMaterial(sharedUniforms, octaves = 7, stackGLSL = DEFAULT_STACK_GLSL) {
  const mat = createRealisticWaterMaterial(sharedUniforms, octaves, stackGLSL);
  mat.defines.INFINITE_MODE = 1;
  mat.uniforms.uWaterFadeStart.value = 2000.0;
  mat.uniforms.uWaterFadeEnd.value = 2500.0;
  mat.needsUpdate = true;
  return mat;
}

export function rebuildRealisticWaterShaderSource(mat, stackGLSL) {
  mat.fragmentShader = buildFragment(buildHeightGLSL(stackGLSL.body2d));
  mat.needsUpdate = true;
}

export function applyRealisticWaterUniforms(mat, params, mode) {
  if (!mat?.uniforms) return;
  const u = mat.uniforms;
  const tier = mode === 'cinematic' ? 3 : mode === 'volumetric' ? 2 : 1;
  const dirRad = (params.waterWaveDirection ?? 0) * Math.PI / 180;
  u.uWaterTier.value = tier;
  u.uWaterOpacity.value = params.waterOpacity ?? 0.72;
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
  const map = { off: 0, depth: 1, shoreline: 2, foam: 3, mask: 4 };
  mat.uniforms.uDebugMode.value = map[debugView] ?? 0;
}
