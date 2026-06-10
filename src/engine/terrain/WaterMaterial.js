import * as THREE from 'three';
import { COMMON_UNIFORMS_GLSL, NOISE_GLSL, HEIGHT_GLSL } from './terrainGLSL.js';

// ============================================================================
// Sea-level water plane. Shares the terrain uniforms + height function so
// depth tint and shore foam line up exactly with the terrain underneath.
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

${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${HEIGHT_GLSL}

uniform float uWaterAnim;

varying vec3 vWorldPos;

void main() {
  vec2 xz = vWorldPos.xz;

  // depth of the sea floor below this fragment (same height field as terrain)
  float floorH = heightAt(xz);
  float depth = uSeaLevel - floorH;
  if (depth <= 0.02) discard;

  // animated ripple normal from two scrolling value-noise fields
  float t = uTime * uWaterAnim;
  float e = 1.6;
  vec2 rp = xz * 0.055;
  float r0 = vnoise(rp + vec2(t * 0.6, t * 0.45)) + 0.5 * vnoise(rp * 2.7 - vec2(t * 0.8, t * 0.3));
  float rX = vnoise(rp + vec2(e * 0.055, 0.0) + vec2(t * 0.6, t * 0.45)) + 0.5 * vnoise((rp + vec2(e * 0.055, 0.0)) * 2.7 - vec2(t * 0.8, t * 0.3));
  float rZ = vnoise(rp + vec2(0.0, e * 0.055) + vec2(t * 0.6, t * 0.45)) + 0.5 * vnoise((rp + vec2(0.0, e * 0.055)) * 2.7 - vec2(t * 0.8, t * 0.3));
  vec3 n = normalize(vec3(-(rX - r0) * 1.6, 1.0, -(rZ - r0) * 1.6));

  // depth-graded color
  vec3 shallowCol = vec3(0.085, 0.330, 0.360);
  vec3 deepCol    = vec3(0.010, 0.075, 0.150);
  float dGrade = clamp(depth / 55.0, 0.0, 1.0);
  vec3 col = mix(shallowCol, deepCol, dGrade);

  // lighting: soft diffuse + sun glints
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float diff = max(dot(n, uSunDir), 0.0);
  col *= 0.55 + 0.65 * diff;
  float spec = pow(max(dot(reflect(-uSunDir, n), viewDir), 0.0), 90.0);
  col += vec3(1.0, 0.95, 0.85) * spec * 0.55;

  // fresnel: steeper viewing angle = clearer water
  float fres = pow(1.0 - max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0), 3.0);
  col += vec3(0.30, 0.42, 0.55) * fres * 0.25;

  // shore foam: thin animated band where the water gets shallow
  float foamNoise = vnoise(xz * 0.22 + vec2(t * 1.4, -t * 1.1));
  float foam = smoothstep(3.2, 0.6, depth + foamNoise * 2.4);
  col = mix(col, vec3(0.82, 0.90, 0.94), foam * 0.75);

  float alpha = clamp(0.50 + dGrade * 0.42 + fres * 0.15 + foam * 0.3, 0.0, 0.94);

  // fog + gamma (matches terrain material)
  float dist = length(cameraPosition - vWorldPos);
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
  col = pow(col, vec3(1.0 / 2.2));

  gl_FragColor = vec4(col, alpha);
}
`;

export function createWaterMaterial(sharedUniforms, octaves = 7) {
  const uniforms = {
    ...sharedUniforms,                 // share uniform OBJECTS with terrain
    uWaterAnim: { value: 1.0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    defines: { OCTAVES: octaves },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return mat;
}
