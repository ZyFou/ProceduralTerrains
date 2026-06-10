import * as THREE from 'three';
import { COMMON_UNIFORMS_GLSL, NOISE_GLSL, HEIGHT_GLSL } from './terrainGLSL.js';

// ============================================================================
// Terrain shader. Everything happens on the GPU:
//  - vertex: world XZ -> procedural height, skirt drop on chunk borders
//  - fragment: finite-difference procedural normals, biome color from
//    height / slope / moisture / detail noise, sun + hemisphere lighting,
//    cavity AO, chunk grid overlay, LOD debug tint, exp2 fog.
// ============================================================================

const VERTEX = /* glsl */ `
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${HEIGHT_GLSL}

uniform float uSkirtDepth;

attribute float aSkirt;   // 1 on skirt ring vertices, 0 elsewhere
attribute float aLod;     // constant per geometry: LOD index of this mesh

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
${HEIGHT_GLSL}

uniform float uNormalStrength;
uniform float uAO;
uniform float uSnowLine;     // fraction of uHeightScale where snow starts
uniform float uGrid;         // chunk grid overlay strength (0 = off)
uniform float uLodDebug;     // 1 = tint chunks by LOD level
uniform float uColorMode;    // 0 = shaded, 1 = raw heightmap (for export)
uniform float uEps;          // finite-difference epsilon in world units

varying vec3  vWorldPos;
varying float vLod;
varying float vSkirt;

// ------- biome palette (linear-ish space) -------
const vec3 C_DEEP    = vec3(0.012, 0.075, 0.140);
const vec3 C_SHALLOW = vec3(0.060, 0.290, 0.330);
const vec3 C_SAND    = vec3(0.560, 0.470, 0.300);
const vec3 C_GRASS   = vec3(0.130, 0.260, 0.085);
const vec3 C_FOREST  = vec3(0.052, 0.140, 0.055);
const vec3 C_DRY     = vec3(0.400, 0.330, 0.180);
const vec3 C_ROCK    = vec3(0.260, 0.235, 0.215);
const vec3 C_ROCK_HI = vec3(0.380, 0.365, 0.355);
const vec3 C_SNOW    = vec3(0.870, 0.890, 0.930);

const vec3 LOD_COLORS[4] = vec3[4](
  vec3(0.90, 0.28, 0.30),
  vec3(0.96, 0.65, 0.14),
  vec3(0.96, 0.85, 0.04),
  vec3(0.23, 0.51, 0.96)
);

void main() {
  vec2 xz = vWorldPos.xz;

  // --- procedural normal: finite differences of the analytic height field ---
  float eps = uEps;
  float hC = heightAt(xz);
  float hX = heightAt(xz + vec2(eps, 0.0));
  float hZ = heightAt(xz + vec2(0.0, eps));

  // heightmap export mode: emit normalized height and stop
  if (uColorMode > 0.5) {
    gl_FragColor = vec4(vec3(clamp(hC / max(uHeightScale, 1e-3), 0.0, 1.0)), 1.0);
    return;
  }

  vec3 nGeo = normalize(vec3(-(hX - hC) / eps, 1.0, -(hZ - hC) / eps));
  vec3 n = normalize(vec3(nGeo.x * uNormalStrength, 1.0, nGeo.z * uNormalStrength));

  float slope = 1.0 - nGeo.y;                 // biome slope from neutral normal
  float moisture = moistureAt(xz);
  float hRel = hC - uSeaLevel;                // height above sea, world units

  // threshold jitter so biome borders are organic, not contour lines
  float jitter = vnoise(xz * 0.045 + uSeedOffset) - 0.5;
  float detail = vnoise(xz * 0.35 + uSeedOffset.yx);

  // --- altitude bands ---
  vec3 lowland = mix(C_GRASS, C_DRY, smoothstep(0.55, 0.18, moisture));
  lowland = mix(lowland, C_FOREST,
    smoothstep(0.52, 0.72, moisture) * smoothstep(0.35, 0.65, detail));

  float sandBand = 7.0 + jitter * 8.0;
  vec3 albedo = mix(C_SAND, lowland, smoothstep(sandBand * 0.4, sandBand, hRel));

  // highlands fade toward rock as altitude climbs
  float highBlend = smoothstep(0.30, 0.62, hC / max(uHeightScale, 1e-3) + jitter * 0.08);
  albedo = mix(albedo, C_ROCK_HI, highBlend * 0.65);

  // steep slopes are rock regardless of altitude
  float rockBlend = smoothstep(0.42, 0.72, slope + jitter * 0.06);
  albedo = mix(albedo, mix(C_ROCK, C_ROCK_HI, detail), rockBlend);

  // snow above the snow line, on flat-enough faces
  float snowY = uSnowLine * uHeightScale;
  float snow = smoothstep(snowY - 14.0, snowY + 26.0, hC + jitter * 30.0)
             * smoothstep(0.62, 0.30, slope);
  albedo = mix(albedo, C_SNOW, snow);

  // underwater tinting (sea floor seen through the water plane)
  if (hRel < 0.0) {
    float depth = clamp(-hRel / 55.0, 0.0, 1.0);
    vec3 floorCol = mix(C_SAND * 0.65, C_DEEP, depth);
    albedo = mix(albedo, floorCol, 0.92);
  }

  // micro albedo variation
  albedo *= 0.90 + 0.20 * vnoise(xz * 0.9);

  // --- cavity / valley ambient occlusion ---
  float concave = clamp(((hX + hZ) * 0.5 - hC) / (eps * 0.9), 0.0, 1.0);
  float valley = 1.0 - smoothstep(0.0, uHeightScale * 0.55, hC);
  float ao = 1.0 - uAO * (concave * 0.45 + valley * 0.22);

  // --- lighting ---
  float diff = max(dot(n, uSunDir), 0.0);
  vec3 sunCol = vec3(1.00, 0.94, 0.82) * 1.25;
  vec3 skyAmb = vec3(0.36, 0.46, 0.62) * 0.50 * (n.y * 0.5 + 0.5);
  vec3 bounce = vec3(0.20, 0.16, 0.11) * 0.25 * (1.0 - n.y * 0.5);
  vec3 col = albedo * (sunCol * diff + skyAmb + bounce) * ao;

  // snow sparkle / wet sand sheen via cheap specular
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float spec = pow(max(dot(reflect(-uSunDir, n), viewDir), 0.0), 32.0);
  col += spec * (snow * 0.30 + (1.0 - smoothstep(0.0, sandBand, abs(hRel))) * 0.10);

  // --- chunk grid overlay ---
  if (uGrid > 0.001) {
    vec2 gw = fwidth(xz) + 1e-5;
    vec2 gp = abs(fract(xz / uChunkSize - 0.5) - 0.5) * uChunkSize / gw;
    float line = 1.0 - min(min(gp.x, gp.y), 1.0);
    float gridFade = smoothstep(420.0, 60.0, length(cameraPosition - vWorldPos) / 8.0);
    col = mix(col, vec3(0.45, 0.80, 0.95), line * uGrid * 0.22 * (0.35 + 0.65 * gridFade));
  }

  // --- LOD debug tint ---
  if (uLodDebug > 0.5) {
    int li = int(clamp(vLod, 0.0, 3.0) + 0.5);
    col = mix(col, LOD_COLORS[li], 0.55);
  }

  // skirt walls: darken so they read as a clean board cross-section
  col *= 1.0 - vSkirt * 0.55;

  // --- exp2 fog + gamma ---
  float dist = length(cameraPosition - vWorldPos);
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

  col = pow(col, vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createTerrainUniforms() {
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
