import * as THREE from 'three';
import { COMMON_UNIFORMS_GLSL, NOISE_GLSL } from './terrainGLSL.js';
import { BIOME_GLSL } from './biomeGLSL.js';
import {
  PLANET_UNIFORMS_GLSL, PLANET_NOISE_GLSL, buildPlanetHeightGLSL,
} from './planetGLSL.js';
import {
  PALETTE_UNIFORMS_GLSL,
  TERRAIN_COLOR_FUNCTIONS_GLSL,
} from '../shaders/terrainColor.glsl.js';
import { TERRAIN_DETAIL_GLSL } from './TerrainDetailMaterial.js';
import { generateStackGLSL } from './noise/noiseStackCodegen.js';
import { defaultLegacyStack } from './noise/NoiseStack.js';

const DEFAULT_STACK_GLSL = generateStackGLSL(defaultLegacyStack());

// ============================================================================
// Planet (cube-sphere) terrain shader. Shares the terrain uniform objects so
// every style / palette / noise tweak applies in all modes.
//  - vertex: chunk grid local position -> unit cube point (via per-chunk face
//    basis) -> normalize() -> radial displacement by heightAt3D(dir); border
//    skirt vertices drop radially inward to hide LOD cracks.
//  - fragment: analytic tangent-frame normal from heightAt3D, biome color from
//    the shared palette, spherical-up lighting, exp2 fog.
// ============================================================================

const buildVertex = (planetHeightGLSL) => /* glsl */ `
${COMMON_UNIFORMS_GLSL}
${PLANET_UNIFORMS_GLSL}
${NOISE_GLSL}
${BIOME_GLSL}
${PLANET_NOISE_GLSL}
${planetHeightGLSL}

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

const buildFragment = (planetHeightGLSL) => /* glsl */ `
precision highp float;

${COMMON_UNIFORMS_GLSL}
${PLANET_UNIFORMS_GLSL}
${NOISE_GLSL}
${BIOME_GLSL}
${PLANET_NOISE_GLSL}
${planetHeightGLSL}
${PALETTE_UNIFORMS_GLSL}
${TERRAIN_COLOR_FUNCTIONS_GLSL}
${TERRAIN_DETAIL_GLSL}

uniform float uNormalStrength;
uniform float uAO;
uniform float uLodDebug;
uniform samplerCube uPlanetHeightTex;
uniform float uUsePlanetHeightTex;

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

vec3 applyTerrainDetailNormalPlanet(vec3 n, vec3 nGeo, vec3 worldPos, vec3 t1, vec3 t2, float fade, float rockMask, float shoreMask) {
  float strength = uTerrainDetailNormalStrength * fade * (0.45 + 0.55 * terrainDetailQualityFactor());
  if (strength <= 0.0001) return n;
  float scale = uTerrainDetailScale * mix(0.55, 1.25, terrainDetailQualityFactor());
  float e = max(0.45, 0.55 / max(scale, 0.0001));
  float c = terrainDetailNoise(worldPos, nGeo, scale);
  float d1 = terrainDetailNoise(worldPos + t1 * e, nGeo, scale) - c;
  float d2 = terrainDetailNoise(worldPos + t2 * e, nGeo, scale) - c;
  float matStrength = strength * (0.55 + rockMask * 1.05 + shoreMask * 0.25);
  vec3 detailN = normalize(n - t1 * d1 * matStrength * 5.5 - t2 * d2 * matStrength * 5.5);
  return normalize(mix(n, detailN, terrainDetailEnabled()));
}

void main() {
  vec3 dir = normalize(vDir);

  // tangent basis around dir for analytic normals + finite differences
  vec3 ref = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(ref, dir));
  vec3 t2 = cross(dir, t1);

  float eps = uPlanetEps;
  vec3 dA = normalize(dir + t1 * eps);
  vec3 dB = normalize(dir + t2 * eps);

  // Height + geometric normal. When the baked cubemap is active, one fetch
  // replaces the centre height field and two more cover the neighbour heights
  // used by the concavity AO term — versus three full ~46-octave evaluations.
  // The branch is on a uniform, so it stays coherent across the warp (a real
  // GPU saving, not just fewer ALU on paper).
  float hC, hA, hB;
  vec3 nGeo;
  if (uUsePlanetHeightTex > 0.5) {
    vec4 hT = textureCube(uPlanetHeightTex, dir);
    hC = hT.a * uHeightScale;
    nGeo = normalize(hT.rgb * 2.0 - 1.0);
    hA = textureCube(uPlanetHeightTex, dA).a * uHeightScale;
    hB = textureCube(uPlanetHeightTex, dB).a * uHeightScale;
  } else {
    hC = heightAt3D(dir);
    hA = heightAt3D(dA);
    hB = heightAt3D(dB);
    vec3 pC = dir * (uPlanetRadius + hC);
    vec3 pA = dA  * (uPlanetRadius + hA);
    vec3 pB = dB  * (uPlanetRadius + hB);
    nGeo = normalize(cross(pA - pC, pB - pC));
    if (dot(nGeo, dir) < 0.0) nGeo = -nGeo;
  }

  // normal-strength tweak: lean the geometric normal toward/away from up
  float up = clamp(dot(nGeo, dir), 0.0, 1.0);
  vec3 n = normalize(mix(dir, nGeo, uNormalStrength));

  Climate cl = planetClimateAt(dir);
  BiomeWeights bw = biomeWeightsAt(cl);

  float slope = 1.0 - up;
  float hRel = hC - uSeaLevel;
  float h01 = hC / max(uHeightScale, 1e-3);

  if (uBiomeDebug > 0.5) {
    vec3 dbg = terrainBiomeDebugColor(bw, h01);
    float shade = 0.55 + 0.45 * max(dot(n, uSunDir), 0.0);
    gl_FragColor = vec4(pow(dbg * shade, vec3(1.0 / 2.2)), 1.0);
    return;
  }

  // Triplanar color-detail sampling: a flat vWorldPos.xz projection of the
  // sphere stretches toward the poles / vertical faces (same streaking the
  // water had); blend three axis planes by the normal so the grain is uniform.
  vec3 colP = vWorldPos;
  vec3 colBlend = abs(dir);
  colBlend /= max(colBlend.x + colBlend.y + colBlend.z, 1e-4);
  vec3 colSeed = vec3(uSeedOffset, uSeedOffset.x - uSeedOffset.y);

  float jitter = (cl.region - 0.5) * 0.8 + (vnoiseTri(colP * 0.045 + colSeed, colBlend) - 0.5) * 0.6;
  float detail = vnoiseTri(colP * 0.35 + colSeed.yzx, colBlend);
  float microN = vnoiseTri(colP * 0.9, colBlend);

  TerrainColorResult tc = computeTerrainAlbedo(cl, bw, hC, hRel, h01, slope, detail, jitter, microN);
  TerrainDetailResult td = applyTerrainDetailLayer(tc, cl, bw, vWorldPos, nGeo, hC, hRel, h01, slope, jitter);
  n = applyTerrainDetailNormalPlanet(n, nGeo, vWorldPos, t1, t2, td.fade, td.rockMask, td.shoreMask);

  if (uTerrainDetailDebug > 0.5) {
    vec3 dbg = vec3(0.0);
    if (uTerrainDetailDebug < 1.5) {
      dbg = vec3(clamp(slope * 2.4, 0.0, 1.0));
    } else if (uTerrainDetailDebug < 2.5) {
      dbg = mix(vec3(0.08, 0.10, 0.12), vec3(0.70, 0.72, 0.68), td.rockMask);
    } else if (uTerrainDetailDebug < 3.5) {
      dbg = mix(vec3(0.04, 0.08, 0.10), vec3(0.82, 0.68, 0.40), td.shoreMask);
    } else if (uTerrainDetailDebug < 4.5) {
      dbg = vec3(td.fade);
    } else if (uTerrainDetailDebug < 5.5) {
      dbg = vec3(td.detail);
    } else if (uTerrainDetailDebug < 6.5) {
      dbg = td.albedo;
    } else {
      dbg = n * 0.5 + 0.5;
    }
    gl_FragColor = vec4(pow(max(dbg, vec3(0.0)), vec3(1.0 / 2.2)), 1.0);
    return;
  }

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
  vec3 col = td.albedo * (sunCol * diff + skyAmb + bounce) * ao;

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

export function createPlanetMaterial(uniforms, octaves = 7, stackGLSL = DEFAULT_STACK_GLSL) {
  const ph = buildPlanetHeightGLSL(stackGLSL.body3d);
  // Per-chunk face uniforms must NOT be shared — clone fresh ones, merged with
  // the shared terrain/palette uniform objects.
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms, ...makeFaceUniforms() },
    defines: { OCTAVES: octaves, PLANET_MODE: 1 },
    vertexShader: buildVertex(ph),
    fragmentShader: buildFragment(ph),
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

const buildWaterFragment = (planetHeightGLSL) => /* glsl */ `
precision highp float;

${COMMON_UNIFORMS_GLSL}
${PLANET_UNIFORMS_GLSL}
${NOISE_GLSL}
${BIOME_GLSL}
${PLANET_NOISE_GLSL}
${planetHeightGLSL}
${PALETTE_UNIFORMS_GLSL}

uniform float uWaterAnim;
uniform float uWaterQuality;
uniform float uWaterDetail;
uniform float uWaterReflection;
uniform float uWaveComplexity;
uniform samplerCube uPlanetHeightTex;
uniform float uUsePlanetHeightTex;

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

  // ocean only where the terrain sits below sea level. The baked height
  // cubemap (when active) gives the sea-floor height in one fetch instead of
  // re-evaluating the full per-pixel field — this is the bulk of the planet
  // water shader's cost when the ocean fills the screen up close.
  float terrainH = uUsePlanetHeightTex > 0.5
    ? textureCube(uPlanetHeightTex, dir).a * uHeightScale
    : heightAt3D(dir);
  float terrainR = uPlanetRadius + terrainH;
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

export function createPlanetWaterMaterial(uniforms, octaves = 7, stackGLSL = DEFAULT_STACK_GLSL) {
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
    fragmentShader: buildWaterFragment(buildPlanetHeightGLSL(stackGLSL.body3d)),
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
