import * as THREE from 'three';
import { COMMON_UNIFORMS_GLSL, NOISE_GLSL, buildHeightGLSL, TERRAIN_HEIGHT_TEX_GLSL } from './terrainGLSL.js';
import { BIOME_GLSL } from './biomeGLSL.js';
import { PALETTE_UNIFORMS_GLSL } from '../shaders/terrainColor.glsl.js';
import { generateStackGLSL } from './noise/noiseStackCodegen.js';
import { defaultLegacyStack } from './noise/NoiseStack.js';

const DEFAULT_STACK_GLSL = generateStackGLSL(defaultLegacyStack());

// ============================================================================
// Sea-level water plane. Shares the terrain uniforms + height function so
// depth tint and shore foam line up exactly with the terrain underneath.
// Adds distance-based edge fade to prevent water from rendering beyond
// the terrain in infinite mode.
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
uniform float uWaterFadeStart;   // distance from camera where fade begins
uniform float uWaterFadeEnd;     // distance from camera where water is fully transparent

// Quality controls — all uniforms so quality sliders never recompile the
// shader. Defaults (quality 2, factors 1.0) reproduce the original visuals.
uniform float uWaterQuality;     // 0 = low, 1 = medium, 2 = high
uniform float uWaterDetail;      // secondary ripple octave amount
uniform float uWaterReflection;  // sun glints + sky fresnel strength
uniform float uWaveComplexity;   // ripple normal strength

varying vec3 vWorldPos;

// Scrolling value-noise ripple height; the fine second octave is skipped
// entirely on low quality (coherent uniform branch — real GPU savings).
float rippleAt(vec2 p, float t) {
  float h = vnoise(p + vec2(t * 0.6, t * 0.45));
  if (uWaterQuality > 0.5) {
    h += 0.5 * uWaterDetail * vnoise(p * 2.7 - vec2(t * 0.8, t * 0.3));
  }
  return h;
}

void main() {
  vec2 xz = vWorldPos.xz;

  // depth of the sea floor below this fragment (same height field as terrain)
  float floorH;
#ifndef INFINITE_MODE
  if (uUseTerrainHeightTex > 0.5) floorH = bakedHeightAt(xz);
  else
#endif
  floorH = heightAt(xz);
  float depth = uSeaLevel - floorH;
  if (depth <= 0.02) discard;

  // animated ripple normal from two scrolling value-noise fields
  float t = uTime * uWaterAnim;
  float e = 1.6;
  vec2 rp = xz * 0.055;
  float r0 = rippleAt(rp, t);
  float rX = rippleAt(rp + vec2(e * 0.055, 0.0), t);
  float rZ = rippleAt(rp + vec2(0.0, e * 0.055), t);
  float nStr = 1.6 * uWaveComplexity;
  vec3 n = normalize(vec3(-(rX - r0) * nStr, 1.0, -(rZ - r0) * nStr));

  float dGrade = clamp(depth / 55.0, 0.0, 1.0);
  vec3 col = mix(uColShallow, uColDeep, dGrade);
  col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, uPaletteSaturation);
  col *= uPaletteTint;

  // lighting: soft diffuse + sun glints
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float diff = max(dot(n, uSunDir), 0.0);
  col *= 0.55 + 0.65 * diff;
  float spec = pow(max(dot(reflect(-uSunDir, n), viewDir), 0.0), 90.0);
  col += vec3(1.0, 0.95, 0.85) * spec * 0.55 * uWaterReflection;

  // fresnel: steeper viewing angle = clearer water
  float fres = pow(1.0 - max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0), 3.0);
  col += vec3(0.30, 0.42, 0.55) * fres * 0.25 * uWaterReflection;

  // shore foam: thin animated band where the water gets shallow.
  // Low quality skips the animated noise and keeps a plain depth band.
  float foamNoise = 0.0;
  if (uWaterQuality > 0.5) {
    foamNoise = vnoise(xz * 0.22 + vec2(t * 1.4, -t * 1.1));
  }
  float foam = smoothstep(3.2, 0.6, depth + foamNoise * 2.4);
  col = mix(col, uColFoam, foam * 0.75);

  float alpha = clamp(0.50 + dGrade * 0.42 + fres * 0.15 + foam * 0.3, 0.0, 0.94);

  // distance-based edge fade: smoothly fade water to transparent near the
  // terrain render distance so water never extends beyond loaded terrain
  float camDist = length(cameraPosition.xz - vWorldPos.xz);
  float edgeFade = 1.0 - smoothstep(uWaterFadeStart, uWaterFadeEnd, camDist);
  alpha *= edgeFade;
  if (alpha < 0.01) discard;

  // fog + gamma (matches terrain material)
  float dist = length(cameraPosition - vWorldPos);
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
  col = pow(col, vec3(1.0 / 2.2));

  gl_FragColor = vec4(col, alpha);
}
`;

// Per-material quality uniforms (NOT shared with terrain, so water quality
// can never affect terrain rendering). Defaults match the original shader.
function waterQualityUniforms() {
  return {
    uWaterQuality:    { value: 2.0 },
    uWaterDetail:     { value: 1.0 },
    uWaterReflection: { value: 1.0 },
    uWaveComplexity:  { value: 1.0 },
  };
}

export function createWaterMaterial(sharedUniforms, octaves = 7, stackGLSL = DEFAULT_STACK_GLSL) {
  const uniforms = {
    ...sharedUniforms,                 // share uniform OBJECTS with terrain
    ...waterQualityUniforms(),
    uWaterAnim: { value: 1.0 },
    uWaterFadeStart: { value: 99999.0 },  // studio mode: no fade
    uWaterFadeEnd:   { value: 100000.0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    defines: { OCTAVES: octaves },
    vertexShader: VERTEX,
    fragmentShader: buildFragment(buildHeightGLSL(stackGLSL.body2d)),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return mat;
}

// Update a live water material's height shader source in place to a new stack.
export function rebuildWaterShaderSource(mat, stackGLSL) {
  mat.fragmentShader = buildFragment(buildHeightGLSL(stackGLSL.body2d));
  mat.needsUpdate = true;
}

// Infinite mode variant: same shader with INFINITE_MODE define.
export function createInfiniteWaterMaterial(sharedUniforms, octaves = 7, stackGLSL = DEFAULT_STACK_GLSL) {
  const uniforms = {
    ...sharedUniforms,
    ...waterQualityUniforms(),
    uWaterAnim: { value: 1.0 },
    uWaterFadeStart: { value: 2000.0 },   // will be set by InfiniteWorld
    uWaterFadeEnd:   { value: 2500.0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    defines: { OCTAVES: octaves, INFINITE_MODE: 1 },
    vertexShader: VERTEX,
    fragmentShader: buildFragment(buildHeightGLSL(stackGLSL.body2d)),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return mat;
}
