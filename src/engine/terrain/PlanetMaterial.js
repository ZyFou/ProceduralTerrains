import * as THREE from 'three';
import { COMMON_UNIFORMS_GLSL, NOISE_GLSL } from './terrainGLSL.js';
import { BIOME_GLSL } from './biomeGLSL.js';
import {
  PLANET_UNIFORMS_GLSL, PLANET_NOISE_GLSL, PLANET_HEIGHT_GLSL,
} from './planetGLSL.js';
import {
  PALETTE_UNIFORMS_GLSL,
  TERRAIN_COLOR_FUNCTIONS_GLSL,
} from '../shaders/terrainColor.glsl.js';

// ============================================================================
// Planet (cube-sphere) terrain shader. Shares the terrain uniform objects so
// every style / palette / noise tweak applies in all modes.
//  - vertex: chunk grid local position -> unit cube point (via per-chunk face
//    basis) -> normalize() -> radial displacement by heightAt3D(dir); border
//    skirt vertices drop radially inward to hide LOD cracks.
//  - fragment: analytic tangent-frame normal from heightAt3D, biome color from
//    the shared palette, spherical-up lighting, exp2 fog.
// ============================================================================

const VERTEX = /* glsl */ `
${COMMON_UNIFORMS_GLSL}
${PLANET_UNIFORMS_GLSL}
${NOISE_GLSL}
${BIOME_GLSL}
${PLANET_NOISE_GLSL}
${PLANET_HEIGHT_GLSL}

uniform float uSkirtDepth;

// Per-chunk cube-face mapping: a local grid point (position.xz in [0,1])
// becomes  uFaceOrigin + position.x*uFaceU + position.z*uFaceV  on the unit
// cube, which is then projected to the sphere.
uniform vec3 uFaceOrigin;
uniform vec3 uFaceU;
uniform vec3 uFaceV;

attribute float aSkirt;
attribute float aLod;

varying vec3  vDir;
varying vec3  vWorldPos;
varying float vLod;
varying float vSkirt;

void main() {
  vec3 cube = uFaceOrigin + position.x * uFaceU + position.z * uFaceV;
  vec3 dir = normalize(cube);

  float h = heightAt3D(dir);
  float r = uPlanetRadius + h - aSkirt * uSkirtDepth;
  vec3 wp = dir * r;

  vDir = dir;
  vWorldPos = wp;
  vLod = aLod;
  vSkirt = aSkirt;

  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;

${COMMON_UNIFORMS_GLSL}
${PLANET_UNIFORMS_GLSL}
${NOISE_GLSL}
${BIOME_GLSL}
${PLANET_NOISE_GLSL}
${PLANET_HEIGHT_GLSL}
${PALETTE_UNIFORMS_GLSL}
${TERRAIN_COLOR_FUNCTIONS_GLSL}

uniform float uNormalStrength;
uniform float uAO;
uniform float uLodDebug;

varying vec3  vDir;
varying vec3  vWorldPos;
varying float vLod;
varying float vSkirt;

const vec3 LOD_COLORS[4] = vec3[4](
  vec3(0.90, 0.28, 0.30),
  vec3(0.96, 0.65, 0.14),
  vec3(0.96, 0.85, 0.04),
  vec3(0.23, 0.51, 0.96)
);

void main() {
  vec3 dir = normalize(vDir);

  // tangent basis around dir for analytic normals + finite differences
  vec3 ref = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(ref, dir));
  vec3 t2 = cross(dir, t1);

  float eps = uPlanetEps;
  vec3 dA = normalize(dir + t1 * eps);
  vec3 dB = normalize(dir + t2 * eps);

  float hC = heightAt3D(dir);
  float hA = heightAt3D(dA);
  float hB = heightAt3D(dB);

  vec3 pC = dir * (uPlanetRadius + hC);
  vec3 pA = dA  * (uPlanetRadius + hA);
  vec3 pB = dB  * (uPlanetRadius + hB);

  vec3 nGeo = normalize(cross(pA - pC, pB - pC));
  if (dot(nGeo, dir) < 0.0) nGeo = -nGeo;

  // normal-strength tweak: lean the geometric normal toward/away from up
  float up = clamp(dot(nGeo, dir), 0.0, 1.0);
  vec3 n = normalize(mix(dir, nGeo, uNormalStrength));

  Climate cl = planetClimateAt(dir);
  BiomeWeights bw = biomeWeightsAt(cl);

  float slope = 1.0 - up;
  float hRel = hC - uSeaLevel;
  float h01 = hC / max(uHeightScale, 1e-3);

  // a stable-ish 2D coordinate for the color micro-detail noise
  vec2 colXZ = vWorldPos.xz + vWorldPos.y * vec2(0.37, -0.21);

  if (uBiomeDebug > 0.5) {
    vec3 dbg = terrainBiomeDebugColor(bw, h01);
    float shade = 0.55 + 0.45 * max(dot(n, uSunDir), 0.0);
    gl_FragColor = vec4(pow(dbg * shade, vec3(1.0 / 2.2)), 1.0);
    return;
  }

  float jitter = (cl.region - 0.5) * 0.8 + (vnoise(colXZ * 0.045 + uSeedOffset) - 0.5) * 0.6;
  float detail = vnoise(colXZ * 0.35 + uSeedOffset.yx);

  TerrainColorResult tc = computeTerrainAlbedo(colXZ, cl, bw, hC, hRel, h01, slope, detail, jitter);

  // ambient occlusion from local concavity + low-altitude valleys
  float concave = clamp(((hA + hB) * 0.5 - hC) / (uHeightScale * 0.02 + 1.0), 0.0, 1.0);
  float valley = 1.0 - smoothstep(0.0, uHeightScale * 0.55, hC);
  float ao = 1.0 - uAO * (concave * 0.45 + valley * 0.22);

  // spherical-up lighting (hemisphere term uses planet up = dir, not world +Y)
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float diff = max(dot(n, uSunDir), 0.0);
  vec3 sunCol = uTerrainSunCol * uTerrainSunIntensity;
  vec3 skyAmb = uTerrainSkyAmb * 0.50 * (up * 0.5 + 0.5);
  vec3 bounce = uTerrainBounce * 0.25 * (1.0 - up * 0.5);
  vec3 col = tc.albedo * (sunCol * diff + skyAmb + bounce) * ao;

  float spec = pow(max(dot(reflect(-uSunDir, n), viewDir), 0.0), 32.0);
  float shoreSheen = 1.0 - smoothstep(0.0, max(tc.sandBand, 0.5), abs(hRel));
  col += spec * (tc.snow * 0.30 + shoreSheen * 0.10 + bw.wetland * tc.flatness * 0.15);

  if (uLodDebug > 0.5) {
    int li = int(clamp(vLod, 0.0, 3.0) + 0.5);
    col = mix(col, LOD_COLORS[li], 0.55);
  }

  col *= 1.0 - vSkirt * 0.55;

  float dist = length(cameraPosition - vWorldPos);
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

  col = pow(col, vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}
`;

function makeFaceUniforms() {
  return {
    uFaceOrigin: { value: new THREE.Vector3(-1, -1, 1) },
    uFaceU:      { value: new THREE.Vector3(2, 0, 0) },
    uFaceV:      { value: new THREE.Vector3(0, 2, 0) },
  };
}

export function createPlanetMaterial(uniforms, octaves = 7) {
  // Per-chunk face uniforms must NOT be shared — clone fresh ones, merged with
  // the shared terrain/palette uniform objects.
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms, ...makeFaceUniforms() },
    defines: { OCTAVES: octaves, PLANET_MODE: 1 },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    // analytic outward normal is computed in the shader, so two-sided shading
    // stays correct; matches the studio/infinite terrain materials.
    side: THREE.DoubleSide,
  });
}

// ============================================================================
// Planet water: a sphere shell at radius (planetRadius + seaLevel). The
// fragment samples heightAt3D under each point and discards where the terrain
// pokes above the sea, so oceans only fill the basins. Shares the same height
// field + palette as the terrain, so coastlines line up exactly.
// ============================================================================

const WATER_VERTEX = /* glsl */ `
varying vec3 vDir;
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vDir = normalize(wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WATER_FRAGMENT = /* glsl */ `
precision highp float;

${COMMON_UNIFORMS_GLSL}
${PLANET_UNIFORMS_GLSL}
${NOISE_GLSL}
${BIOME_GLSL}
${PLANET_NOISE_GLSL}
${PLANET_HEIGHT_GLSL}
${PALETTE_UNIFORMS_GLSL}

uniform float uWaterAnim;
uniform float uWaterQuality;
uniform float uWaterDetail;
uniform float uWaterReflection;
uniform float uWaveComplexity;

varying vec3 vDir;
varying vec3 vWorldPos;

// Triplanar value-noise ripple. Sampling by the 3D surface position and
// blending the three axis planes by the surface normal keeps the wavelet
// roughly uniform everywhere on the sphere — a single flat xz projection
// stretches badly toward the poles and the "vertical" faces of the globe.
float rippleTri(vec3 p, vec3 blend, float t) {
  vec2 oa = vec2(t * 0.6, t * 0.45);
  float h = vnoise(p.yz + oa) * blend.x
          + vnoise(p.zx + oa) * blend.y
          + vnoise(p.xy + oa) * blend.z;
  if (uWaterQuality > 0.5) {
    vec2 ob = vec2(t * 0.8, t * 0.3);
    h += 0.5 * uWaterDetail * (
        vnoise(p.yz * 2.7 - ob) * blend.x
      + vnoise(p.zx * 2.7 - ob) * blend.y
      + vnoise(p.xy * 2.7 - ob) * blend.z);
  }
  return h;
}

void main() {
  vec3 dir = normalize(vDir);

  // ocean only where the terrain sits below sea level
  float terrainR = uPlanetRadius + heightAt3D(dir);
  float waterR = uPlanetRadius + uSeaLevel;
  float depth = waterR - terrainR;
  if (depth <= 0.02) discard;

  // tangent frame around the local up (= dir)
  vec3 up = dir;
  vec3 ref = abs(up.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(ref, up));
  vec3 t2 = cross(up, t1);

  // triplanar blend weights from the surface normal (= local up)
  vec3 blend = abs(up);
  blend /= max(blend.x + blend.y + blend.z, 1e-4);

  float t = uTime * uWaterAnim;
  float scale = 0.055;
  vec3 wp = vWorldPos * scale;
  float e = 1.6 * scale;
  float r0 = rippleTri(wp, blend, t);
  float rX = rippleTri(wp + t1 * e, blend, t);
  float rZ = rippleTri(wp + t2 * e, blend, t);
  float nStr = 0.03 * uWaveComplexity;
  vec3 n = normalize(up - t1 * ((rX - r0) * nStr * 30.0) - t2 * ((rZ - r0) * nStr * 30.0));

  float dGrade = clamp(depth / 55.0, 0.0, 1.0);
  vec3 col = mix(uColShallow, uColDeep, dGrade);
  col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, uPaletteSaturation);
  col *= uPaletteTint;

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float diff = max(dot(n, uSunDir), 0.0);
  col *= 0.55 + 0.65 * diff;
  float spec = pow(max(dot(reflect(-uSunDir, n), viewDir), 0.0), 90.0);
  col += vec3(1.0, 0.95, 0.85) * spec * 0.55 * uWaterReflection;

  // spherical fresnel: up is the local normal, not world +Y
  float fres = pow(1.0 - max(dot(viewDir, up), 0.0), 3.0);
  col += vec3(0.30, 0.42, 0.55) * fres * 0.25 * uWaterReflection;

  float foamNoise = 0.0;
  if (uWaterQuality > 0.5) {
    vec3 fp = vWorldPos * 0.22;
    vec2 fo = vec2(t * 1.4, -t * 1.1);
    foamNoise = vnoise(fp.yz + fo) * blend.x
              + vnoise(fp.zx + fo) * blend.y
              + vnoise(fp.xy + fo) * blend.z;
  }
  float foam = smoothstep(3.2, 0.6, depth + foamNoise * 2.4);
  col = mix(col, uColFoam, foam * 0.75);

  float alpha = clamp(0.50 + dGrade * 0.42 + fres * 0.15 + foam * 0.3, 0.0, 0.94);

  col = pow(col, vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, alpha);
}
`;

export function createPlanetWaterMaterial(uniforms, octaves = 7) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      // water knobs are private (never shared with terrain)
      uWaterAnim:       { value: 1.0 },
      uWaterQuality:    { value: 2.0 },
      uWaterDetail:     { value: 1.0 },
      uWaterReflection: { value: 1.0 },
      uWaveComplexity:  { value: 1.0 },
    },
    defines: { OCTAVES: octaves, PLANET_MODE: 1 },
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    transparent: true,
    depthWrite: false,
    // bias the depth test toward the camera so the transparent shell wins over
    // coincident terrain at the shoreline (belt-and-braces with the radius bias)
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    // Outer shell only: cull the inner (back) faces so the far hemisphere of
    // the ocean sphere isn't drawn behind the planet, and overdraw is halved.
    side: THREE.FrontSide,
  });
}
