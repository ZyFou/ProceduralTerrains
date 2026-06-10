import * as THREE from 'three';
import { COMMON_UNIFORMS_GLSL, NOISE_GLSL, HEIGHT_GLSL } from './terrainGLSL.js';
import { BIOME_GLSL } from './biomeGLSL.js';
import {
  PALETTE_UNIFORMS_GLSL,
  TERRAIN_COLOR_FUNCTIONS_GLSL,
} from '../shaders/terrainColor.glsl.js';
import { createPaletteUniforms } from '../style/PaletteUniforms.js';
import { EARTH_PALETTE } from '../style/ColorPalette.js';
import { applyPlanetStyleToUniforms } from '../style/PaletteUniforms.js';
import { DEFAULT_PLANET_STYLE } from '../style/PlanetStyleConfig.js';

// ============================================================================
// Terrain shader. Everything happens on the GPU:
//  - vertex: world XZ -> procedural height, skirt drop on chunk borders
//  - fragment: finite-difference procedural normals, biome color from
//    palette uniforms + height / slope / moisture, sun + hemisphere lighting,
//    cavity AO, chunk grid overlay, LOD debug tint, exp2 fog.
// ============================================================================

const VERTEX = /* glsl */ `
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${BIOME_GLSL}
${HEIGHT_GLSL}

uniform float uSkirtDepth;

attribute float aSkirt;
attribute float aLod;

varying vec3  vWorldPos;
varying float vLod;
varying float vSkirt;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float h = heightAt(wp.xz);
  wp.y = h - aSkirt * uSkirtDepth;

  vWorldPos = wp.xyz;
  vLod = aLod;
  vSkirt = aSkirt;

  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;

${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${BIOME_GLSL}
${HEIGHT_GLSL}
${PALETTE_UNIFORMS_GLSL}
${TERRAIN_COLOR_FUNCTIONS_GLSL}

uniform float uNormalStrength;
uniform float uAO;
uniform float uGrid;
uniform float uLodDebug;
uniform float uColorMode;
uniform float uEps;

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
  vec2 xz = vWorldPos.xz;

  Climate cl = climateAt(xz * uFrequency + uSeedOffset);
  BiomeWeights bw = biomeWeightsAt(cl);

  float eps = uEps;
  float hC = shapeHeight(xz, cl);
  float hX = shapeHeight(xz + vec2(eps, 0.0), cl);
  float hZ = shapeHeight(xz + vec2(0.0, eps), cl);

  if (uColorMode > 0.5) {
    gl_FragColor = vec4(vec3(clamp(hC / max(uHeightScale, 1e-3), 0.0, 1.0)), 1.0);
    return;
  }

  vec3 nGeo = normalize(vec3(-(hX - hC) / eps, 1.0, -(hZ - hC) / eps));
  vec3 n = normalize(vec3(nGeo.x * uNormalStrength, 1.0, nGeo.z * uNormalStrength));

  float slope = 1.0 - nGeo.y;
  float hRel = hC - uSeaLevel;
  float h01 = hC / max(uHeightScale, 1e-3);

  if (uBiomeDebug > 0.5) {
    vec3 dbg = terrainBiomeDebugColor(bw, h01);
    float shade = 0.55 + 0.45 * max(dot(n, uSunDir), 0.0);
    gl_FragColor = vec4(pow(dbg * shade, vec3(1.0 / 2.2)), 1.0);
    return;
  }

  float jitter = (cl.region - 0.5) * 0.8 + (vnoise(xz * 0.045 + uSeedOffset) - 0.5) * 0.6;
  float detail = vnoise(xz * 0.35 + uSeedOffset.yx);

  TerrainColorResult tc = computeTerrainAlbedo(xz, cl, bw, hC, hRel, h01, slope, detail, jitter);

  float concave = clamp(((hX + hZ) * 0.5 - hC) / (eps * 0.9), 0.0, 1.0);
  float valley = 1.0 - smoothstep(0.0, uHeightScale * 0.55, hC);
  float ao = 1.0 - uAO * (concave * 0.45 + valley * 0.22);

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 col = terrainLighting(
    tc.albedo, n, uSunDir, ao,
    tc.snow, tc.sandBand, hRel, tc.flatness, bw.wetland,
    viewDir
  );

  if (uGrid > 0.001) {
    vec2 gw = fwidth(xz) + 1e-5;
    vec2 gp = abs(fract(xz / uChunkSize - 0.5) - 0.5) * uChunkSize / gw;
    float line = 1.0 - min(min(gp.x, gp.y), 1.0);
    float gridFade = smoothstep(420.0, 60.0, length(cameraPosition - vWorldPos) / 8.0);
    col = mix(col, vec3(0.45, 0.80, 0.95), line * uGrid * 0.22 * (0.35 + 0.65 * gridFade));
  }

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

export function createTerrainUniforms() {
  const paletteUniforms = createPaletteUniforms();
  const defaults = {
    ...DEFAULT_PLANET_STYLE,
    palette: EARTH_PALETTE,
  };
  applyPlanetStyleToUniforms(paletteUniforms, defaults);

  return {
    uSeedOffset:     { value: new THREE.Vector2(0, 0) },
    uFrequency:      { value: 0.002 },
    uHeightScale:    { value: 420 },
    uSeaLevel:       { value: 42 },
    uAmplitude:      { value: 1.0 },
    uPersistence:    { value: 0.5 },
    uLacunarity:     { value: 2.05 },
    uRidge:          { value: 0.65 },
    uWarp:           { value: 0.9 },
    uFalloff:        { value: 0.5 },
    uBoardHalf:      { value: 1024 },
    uChunkSize:      { value: 128 },
    uMoistScale:     { value: 1.0 },
    uMoistBias:      { value: 0.0 },
    uBiomeScale:     { value: 1.0 },
    uTempBias:       { value: 0.0 },
    uBiomeDebug:     { value: 0.0 },
    uSnowLine:       { value: 0.7 },
    uNormalStrength: { value: 1.25 },
    uAO:             { value: 0.75 },
    uGrid:           { value: 1.0 },
    uLodDebug:       { value: 0.0 },
    uColorMode:      { value: 0.0 },
    uEps:            { value: 0.6 },
    uSkirtDepth:     { value: 40 },
    uSunDir:         { value: new THREE.Vector3(0.5, 0.7, 0.3).normalize() },
    uFogColor:       { value: new THREE.Color(0x0b0e14) },
    uFogDensity:     { value: 0.000045 },
    uTime:           { value: 0 },
    ...paletteUniforms,
  };
}

export function createTerrainMaterial(uniforms, octaves = 7) {
  return new THREE.ShaderMaterial({
    uniforms,
    defines: { OCTAVES: octaves },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.DoubleSide,
  });
}

export function createInfiniteTerrainMaterial(uniforms, octaves = 7) {
  return new THREE.ShaderMaterial({
    uniforms,
    defines: { OCTAVES: octaves, INFINITE_MODE: 1 },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.DoubleSide,
  });
}
