import * as THREE from 'three';
import {
  COMMON_UNIFORMS_GLSL,
  IMPORTED_IMAGERY_ALBEDO_GLSL,
  NOISE_GLSL,
  buildHeightGLSL,
  TERRAIN_HEIGHT_TEX_GLSL,
  INFINITE_FIELD_CACHE_GLSL,
  TERRAIN_CLIMATE_CACHE_GLSL,
  MANUAL_SURFACE_WEIGHTS_GLSL,
} from './terrainGLSL.js';
import { BIOME_GLSL } from './biomeGLSL.js';
import { generateStackGLSL } from './noise/noiseStackCodegen.js';
import { defaultLegacyStack, MAX_LAYERS } from './noise/NoiseStack.js';
import {
  PALETTE_UNIFORMS_GLSL,
  TERRAIN_COLOR_FUNCTIONS_GLSL,
} from '../shaders/terrainColor.glsl.js';
import { TERRAIN_DETAIL_GLSL } from './TerrainDetailMaterial.js';
import {
  SURFACE_TEXTURE_UNIFORMS_GLSL,
  SURFACE_TEXTURE_FUNCTIONS_GLSL,
  SURFACE_TEXTURE_ROLE_COUNT,
  SURFACE_TEXTURE_ROWS,
} from './surface/terrainSurfaceTextureGLSL.js';
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

const MANUAL_ACTIVE_COMMON_SAMPLERS = new Set([
  'uManualSurfaceTextureA',
  'uManualSurfaceTextureB',
  'uManualHeightTexture',
  'uTileOccupancy',
]);

const MANUAL_COMMON_UNIFORMS_GLSL = COMMON_UNIFORMS_GLSL.replace(
  /^uniform sampler2D ([A-Za-z0-9_]+);.*$/gm,
  (line, name) => (MANUAL_ACTIVE_COMMON_SAMPLERS.has(name) ? line : ''),
);

const MANUAL_HEIGHT_GLSL = /* glsl */ `
${MANUAL_SURFACE_WEIGHTS_GLSL}

float manualHeightOffsetAt(vec2 xz) {
  if (uManualEnabled < 0.5) return 0.0;
  vec2 uv = (xz - uManualOrigin) / max(uManualSpan, vec2(1.0));
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
  return texture2D(uManualHeightTexture, uv).r;
}

// Manual Terrain owns its complete height and surface fields. These stubs keep
// shared analysis/debug code source-compatible without activating the standard
// paint, spline, import, erosion, Studio bake, or Infinite cache samplers.
float paintHeightOffsetAt(vec2 xz) { return 0.0; }
vec4 paintBiomeAt(vec2 xz) { return vec4(0.0); }
float splineHeightOffsetAt(vec2 xz) { return 0.0; }
vec4 splineMaskAt(vec2 xz) { return vec4(0.0); }

float heightAtWithClimate(vec2 xz, Climate climate) {
  return manualHeightOffsetAt(xz);
}

float heightAt(vec2 xz) {
  return manualHeightOffsetAt(xz);
}

float moistureAt(vec2 xz) {
  return climateAt(xz * uFrequency + uSeedOffset).moist;
}

float stackHeight2D(vec2 xz, Climate climate) {
  return clamp(manualHeightOffsetAt(xz) / max(uHeightScale, 1e-3), 0.0, 1.0);
}
`;

const MANUAL_TERRAIN_CACHE_GLSL = /* glsl */ `
float terrainCachedHeightAt(vec2 xz) {
  return manualHeightOffsetAt(xz);
}
`;

// Hybrid Manual projects are Tile-only. Keeping the Infinite World cache in
// their shader would reserve three texture units that can never be used, and
// the generated base + Manual height/surface maps would then exceed the common
// WebGL limit of 16 active texture units. Evaluate the same world-coordinate
// height function directly instead.
const HYBRID_TILE_TERRAIN_CACHE_GLSL = /* glsl */ `
float terrainCachedHeightAt(vec2 xz) {
  return heightAt(xz);
}
`;

const MANUAL_TERRAIN_CLIMATE_GLSL = /* glsl */ `
Climate terrainCachedClimateAt(vec2 xz) {
  return climateAt(xz * uFrequency + uSeedOffset);
}
`;

const buildVertex = (heightGLSL, variant = 'full') => {
  const features = resolveTerrainVariant(variant);
  const manual = features.manual;
  const preview = variant === 'preview';
  return /* glsl */ `
${manual ? MANUAL_COMMON_UNIFORMS_GLSL : COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${BIOME_GLSL}
${heightGLSL}
${manual
    ? MANUAL_TERRAIN_CACHE_GLSL
    : features.tileOnly
      ? HYBRID_TILE_TERRAIN_CACHE_GLSL
      : INFINITE_FIELD_CACHE_GLSL}

uniform float uSkirtDepth;
uniform float uPlinthBaseY;
uniform float uWallThickness;
${preview ? 'uniform float uEps;' : ''}

attribute float aSkirt;
attribute float aLod;
attribute float aWall;   // 1 on the dedicated circular radial-wall mesh, else 0

varying vec3  vWorldPos;
varying float vLod;
varying float vSkirt;
varying float vWall;
varying float vWallMesh;
${preview ? 'varying vec3 vTerrainPreviewNormal;' : ''}

void main() {
  vec4 localPosition = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    localPosition = instanceMatrix * localPosition;
  #endif
  vec4 wp = modelMatrix * localPosition;
  float h = terrainCachedHeightAt(wp.xz);
${preview ? /* glsl */ `
  // Smooth lighting for the lightweight Node preview. Two extra height
  // samples per vertex are much cheaper than evaluating the graph per pixel,
  // and interpolate cleanly across the visible terrain triangles.
  float normalEps = max(uEps, 0.001);
  float hNormalX = terrainCachedHeightAt(wp.xz + vec2(normalEps, 0.0));
  float hNormalZ = terrainCachedHeightAt(wp.xz + vec2(0.0, normalEps));
  vTerrainPreviewNormal = normalize(vec3(
    -(hNormalX - h) / normalEps,
    1.0,
    -(hNormalZ - h) / normalEps
  ));
` : ''}

  float skirt = aSkirt;
  float wall = 0.0;   // outer-perimeter skirt -> plinth wall
  if (uInfiniteMode < 0.5) {
    if (uUseTiles > 0.5) {
      if (uTileShape > 0.5) {
        if (aWall > 0.5) {
          // Dedicated radial wall: top follows the same single analytic
          // terrain sample; the base ring drops to the plinth.
          wall = aSkirt;
          skirt = 0.0;
        } else {
          // Retain both terrain-toned crack covers. Either neighbour can be
          // the finer LOD, so fixed-side ownership can expose a T-junction.
          skirt = aSkirt;
          wall = 0.0;
        }
      } else {
        // multi-cell square assembly: only skirts on a cell edge facing empty
        // space become the plinth wall; shared seams stay continuous terrain.
        vec3 tw = tileWall(wp.xz);
        float onOuter = step(0.5, tw.x);
        skirt = aSkirt;
        wall = aSkirt * onOuter;
        skirt *= 1.0 - onOuter;
        wp.xz += tw.yz * (wall * uWallThickness);
      }
    } else {
      float bx = abs(wp.x);
      float bz = abs(wp.z);
      float onOuter = step(uBoardHalf - 1.0, bx) + step(uBoardHalf - 1.0, bz);
      // outer-edge skirt verts become the plinth wall; interior skirts unchanged
      wall = skirt * step(0.5, onOuter);
      skirt *= 1.0 - step(0.5, onOuter);
      // flare the wall base outward (away from the board) so it sits OUTSIDE the
      // water plane edge — no z-fighting with the water, and it leans over any
      // terrain edge that dips below the waterline so the side never shows through.
      vec2 outDir = vec2(step(uBoardHalf - 1.0, bx) * sign(wp.x),
                         step(uBoardHalf - 1.0, bz) * sign(wp.z));
      wp.xz += outDir * (wall * uWallThickness);
    }
  }

  // interior skirt drops by uSkirtDepth; the perimeter wall drops all the way to
  // the plinth base so the terrain's own edge masks the under-the-map view at
  // whatever LOD the border chunks are rendered at.
  wp.y = mix(h - skirt * uSkirtDepth, uPlinthBaseY, wall);

  vWorldPos = wp.xyz;
  vLod = aLod;
  vSkirt = max(skirt, wall);
  vWall = wall;
  vWallMesh = aWall;

  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
};

const DEFAULT_TERRAIN_GRAPH_COLOR_GLSL = /* glsl */ `
vec3 applyTerrainGraphColor(vec3 fallback, vec2 xz, float h01, float slope, float detail, float moisture) {
  return fallback;
}
`;

const TERRAIN_CLOUD_SHADOW_GLSL = /* glsl */ `
uniform float uTerrainCloudShadowEnabled;
uniform float uTerrainCloudShadowStrength;
uniform vec2 uTerrainCloudShadowCenter;
uniform float uTerrainCloudShadowExtent;
uniform float uTerrainCloudShadowAltitude;
uniform float uTerrainCloudShadowScale;
uniform float uTerrainCloudShadowCoverage;
uniform float uTerrainCloudShadowSoftness;
uniform vec3 uTerrainCloudShadowWind;
uniform float uTerrainCloudShadowTime;
uniform float uTerrainCloudShadowRotation;
uniform float uTerrainCloudShadowEvolve;

float terrainCloudHash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

float terrainCloudNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = terrainCloudHash13(i + vec3(0.0, 0.0, 0.0));
  float n100 = terrainCloudHash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = terrainCloudHash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = terrainCloudHash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = terrainCloudHash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = terrainCloudHash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = terrainCloudHash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = terrainCloudHash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z
  );
}

float terrainCloudFbm(vec3 p) {
  const mat3 rot = mat3(
     0.00,  0.80,  0.60,
    -0.80,  0.36, -0.48,
    -0.60, -0.48,  0.64
  );
  float amp = 0.5, sum = 0.0, norm = 0.0;
  for (int i = 0; i < 3; i++) {
    sum += amp * terrainCloudNoise(p);
    norm += amp;
    amp *= 0.5;
    p = rot * p * 2.02;
  }
  return sum / max(norm, 1e-4);
}

float terrainCloudShadow(vec3 worldPos) {
  if (uTerrainCloudShadowEnabled < 0.5 || uSunDir.y <= 0.01) return 0.0;

  // Project the terrain point toward the sun until it reaches the middle of
  // the cloud slab, then evaluate the same animated base cloud field there.
  float rise = max(uTerrainCloudShadowAltitude - worldPos.y, 0.0);
  vec2 cloudXZ = worldPos.xz + uSunDir.xz * (rise / max(uSunDir.y, 0.08));
  float radius = max(uTerrainCloudShadowExtent, 1.0);
  float radialDistance = length(cloudXZ - uTerrainCloudShadowCenter);
  float edge = 1.0 - smoothstep(radius * 0.65, radius, radialDistance);
  if (edge <= 0.0) return 0.0;

  float c = cos(uTerrainCloudShadowRotation);
  float s = sin(uTerrainCloudShadowRotation);
  vec3 point = vec3(cloudXZ.x, uTerrainCloudShadowAltitude, cloudXZ.y);
  vec3 domain = vec3(
    c * point.x + s * point.z,
    point.y,
    -s * point.x + c * point.z
  );
  vec3 drift = uTerrainCloudShadowWind * uTerrainCloudShadowTime;
  vec3 samplePoint = domain * uTerrainCloudShadowScale
    + drift
    + vec3(0.0, uTerrainCloudShadowTime * uTerrainCloudShadowEvolve, 0.0);
  float base = terrainCloudFbm(samplePoint);
  float threshold = 1.0 - uTerrainCloudShadowCoverage;
  float softness = max(uTerrainCloudShadowSoftness, 0.08);
  float mask = smoothstep(threshold, threshold + softness, base) * edge;

  float sunAboveHorizon = smoothstep(0.01, 0.16, uSunDir.y);
  return smoothstep(0.04, 0.82, mask)
    * clamp(uTerrainCloudShadowStrength, 0.0, 0.85)
    * sunAboveHorizon;
}
`;

const TERRAIN_DETAIL_STUB_GLSL = /* glsl */ `
uniform float uTerrainDetailDebug;
uniform float uTerrainDetailNormalStrength;
uniform float uTerrainDetailScale;

struct TerrainDetailResult {
  vec3 albedo;
  float detail;
  float fade;
  float rockMask;
  float shoreMask;
};

float terrainDetailQualityFactor() { return 0.0; }
float terrainDetailEnabled() { return 0.0; }
float terrainDetailRelief(vec3 worldPos, vec3 n, float scale) { return 0.5; }

TerrainDetailResult applyTerrainDetailLayer(
  TerrainColorResult tc, Climate cl, BiomeWeights bw, vec3 worldPos,
  vec3 normalGeo, float hC, float hRel, float h01, float slope, float jitter
) {
  TerrainDetailResult result;
  result.albedo = tc.albedo;
  result.detail = 0.5;
  result.fade = 0.0;
  result.rockMask = tc.rockBlend;
  result.shoreMask = 0.0;
  return result;
}
`;

const SURFACE_TEXTURE_STUB_GLSL = /* glsl */ `
struct SurfaceTexResult {
  vec3 albedo;
  vec3 normal;
  float ao;
  float rough;
  float amount;
};

SurfaceTexResult applySurfaceMaterials(
  vec3 baseAlbedo, vec3 n, vec3 baseNormal, vec3 nGeo, vec3 wpos, float dist,
  TerrainColorResult tc, Climate cl, BiomeWeights bw, float slope, float hRel,
  float h01, float detail, float jitter
) {
  SurfaceTexResult result;
  result.albedo = baseAlbedo;
  result.normal = n;
  result.ao = 1.0;
  result.rough = 0.8;
  result.amount = 0.0;
  return result;
}
`;

function resolveTerrainVariant(variant = 'full') {
  if (variant === 'manual') {
    return { name: 'manual', detail: true, surface: true, manual: true };
  }
  if (variant === 'hybrid-surface') {
    return { name: 'hybrid-surface', detail: false, surface: true, manual: false, tileOnly: true };
  }
  if (variant === 'hybrid') {
    return { name: 'hybrid', detail: true, surface: true, manual: false, tileOnly: true };
  }
  if (variant === 'base') return { name: 'base', detail: false, surface: false };
  if (variant === 'detail') return { name: 'detail', detail: true, surface: false };
  if (variant === 'surface') return { name: 'surface', detail: false, surface: true };
  return { name: 'full', detail: true, surface: true, manual: false };
}

const buildFragment = (
  heightGLSL,
  graphColorGLSL = DEFAULT_TERRAIN_GRAPH_COLOR_GLSL,
  variant = 'full',
) => {
  const features = resolveTerrainVariant(variant);
  return /* glsl */ `
precision highp float;

${features.manual ? MANUAL_COMMON_UNIFORMS_GLSL : COMMON_UNIFORMS_GLSL}
${features.manual ? '' : IMPORTED_IMAGERY_ALBEDO_GLSL}
${NOISE_GLSL}
${BIOME_GLSL}
${heightGLSL}
${features.manual ? '' : TERRAIN_HEIGHT_TEX_GLSL}
${features.manual
    ? MANUAL_TERRAIN_CACHE_GLSL
    : features.tileOnly
      ? HYBRID_TILE_TERRAIN_CACHE_GLSL
      : INFINITE_FIELD_CACHE_GLSL}
${features.manual
    ? MANUAL_TERRAIN_CLIMATE_GLSL
    : features.tileOnly
      ? ''
      : TERRAIN_CLIMATE_CACHE_GLSL}
${PALETTE_UNIFORMS_GLSL}
${TERRAIN_COLOR_FUNCTIONS_GLSL}
${graphColorGLSL}
${features.surface ? SURFACE_TEXTURE_UNIFORMS_GLSL : ''}
${features.surface ? SURFACE_TEXTURE_FUNCTIONS_GLSL : SURFACE_TEXTURE_STUB_GLSL}
${features.detail ? TERRAIN_DETAIL_GLSL : TERRAIN_DETAIL_STUB_GLSL}

uniform float uNormalStrength;
uniform float uAO;
uniform float uGrid;
uniform float uLodDebug;
uniform float uMergeDebug;   // 1 = tint merged-group / macro-proxy meshes
uniform float uColorMode;
uniform float uEps;
uniform vec3  uPlinthColor;
uniform float uAnalysisEnabled;
uniform float uAnalysisMode;
uniform float uAnalysisOpacity;
uniform float uAnalysisMin;
uniform float uAnalysisMax;
uniform float uAnalysisThresholdA;
uniform float uAnalysisThresholdB;
uniform float uAnalysisContourSpacing;
uniform float uAnalysisContourStrength;

// Underwater caustics — animated dappled light projected on submerged terrain.
// Driven by the UnderwaterController: uCausticBlend ramps with camera submersion
// so caustics only appear while diving (and fade in/out smoothly). World-XZ
// projection keeps them seamless across chunks (Tile + Infinite).
// Wave uniforms mirror the active water material so floor caustics drift with
// the surface ripples (refraction through the wavy water plane).
uniform float uCausticStrength;  // user strength (0 = off)
uniform float uCausticBlend;     // camera-underwater activation 0..1
uniform float uCausticScale;     // user scale multiplier
uniform float uCausticSpeed;     // user speed multiplier
uniform vec3  uCausticColor;
uniform float uCausticDepthFade; // depth (world units) over which caustics fade
uniform float uCausticMinDepth;  // no caustics closer than this to the surface
uniform float uCausticMinDepthFalloff;
uniform float uCausticWaterAnim;
uniform float uCausticAnimSpeed;
uniform float uCausticWaveSpeed;
uniform float uCausticWaveScale;
uniform float uCausticWaveStrength;
uniform float uCausticLargeWaveStr;
uniform float uCausticSmallWaveStr;
uniform float uCausticRippleLegacy; // 1 = legacy water ripples, 0 = realistic
uniform vec2  uCausticWaveDir;

varying vec3  vWorldPos;
varying float vLod;
varying float vSkirt;
varying float vWall;
varying float vWallMesh;

const vec3 LOD_COLORS[4] = vec3[4](
  vec3(0.90, 0.28, 0.30),
  vec3(0.96, 0.65, 0.14),
  vec3(0.96, 0.85, 0.04),
  vec3(0.23, 0.51, 0.96)
);

// Merge-debug colour ramp keyed off aLod (4..8 = quadtree fold tier). Small
// folds (2x2) read green, then yellow → orange → red → magenta as larger
// blocks fold, so the nested quadtree structure is legible.
vec3 mergeTierColor(float vlod) {
  float t = clamp(vlod - 4.0, 0.0, 4.0);
  if (t < 1.0)      return mix(vec3(0.18, 0.95, 0.45), vec3(0.95, 0.95, 0.15), t);
  else if (t < 2.0) return mix(vec3(0.95, 0.95, 0.15), vec3(0.98, 0.55, 0.10), t - 1.0);
  else if (t < 3.0) return mix(vec3(0.98, 0.55, 0.10), vec3(0.95, 0.20, 0.20), t - 2.0);
  else              return mix(vec3(0.95, 0.20, 0.20), vec3(0.95, 0.20, 0.95), t - 3.0);
}

// Real caustic network — thin, bright, animated light filaments (the classic
// distorted-wave-interference caustic). Fixed 5-iteration loop (static bound →
// safe for the D3D11/ANGLE shader compiler), so it unrolls without a hang.
// Each 1×1 uv cell gets a unique hash rotation/scale/phase so the mod-TAU wrap
// no longer produces an identical grid of tiles.
float causticTile(vec2 uv, float t) {
  vec2 id = floor(uv);
  vec2 f = fract(uv) - 0.5;

  float h0 = hash12(id);
  float h1 = hash12(id + vec2(5.2, 1.7));
  float ang = (h0 * 2.0 - 1.0) * 3.14159;
  float cs = cos(ang);
  float sn = sin(ang);
  f = mat2(cs, -sn, sn, cs) * (f * (0.65 + h1 * 0.7));

  vec2 p = mod((f + 0.5) * 6.28318, 6.28318) - 250.0;
  float tLocal = t + (h0 + h1) * 6.0;
  vec2 i = p;
  float c = 1.0;
  const float inten = 0.005;
  for (int n = 0; n < 5; n++) {
    float tt = tLocal * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 5.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 1.0);
}

// Ripple height at the water surface — matches legacy or realistic water shaders.
float causticRippleLayer(vec2 p, float t, float scale, float speed) {
  vec2 drift = uCausticWaveDir * t * speed;
  float h = vnoise(p * scale + drift);
  h += 0.45 * vnoise(p * scale * 2.4 - drift * 1.3);
  return h;
}

float causticRippleHeight(vec2 rp, float t) {
  float legacyH = vnoise(rp + vec2(t * 0.6, t * 0.45));
  legacyH += 0.5 * uCausticSmallWaveStr * vnoise(rp * 2.7 - vec2(t * 0.8, t * 0.3));
  float realisticH =
      causticRippleLayer(rp, t, 1.0, uCausticWaveSpeed) * uCausticLargeWaveStr
    + causticRippleLayer(rp, t, 2.6, uCausticWaveSpeed * 1.3) * uCausticSmallWaveStr;
  return mix(realisticH, legacyH, step(0.5, uCausticRippleLegacy));
}

// Surface slope refracts sunlight — shift caustic sampling to follow the waves.
vec2 causticSurfaceRefraction(vec2 xz, float t) {
  vec2 rp = xz * 0.055 * uCausticWaveScale;
  float e = (uCausticRippleLegacy > 0.5)
    ? 1.6
    : (1.4 / max(uCausticWaveScale, 0.2));
  float r0 = causticRippleHeight(rp, t);
  float rX = causticRippleHeight(rp + vec2(e * 0.055, 0.0), t);
  float rZ = causticRippleHeight(rp + vec2(0.0, e * 0.055), t);
  return vec2(-(rX - r0), -(rZ - r0)) * uCausticWaveStrength;
}

// causticTile is periodic within each cell, but cells are no longer identical.
// Domain warp + two layers break residual tiling; surface refraction ties motion
// to the live water ripples.
float causticPattern(vec2 xz, float t, vec2 refr, float depthSpread) {
  float s = 0.03 / max(uCausticScale, 0.05);
  vec2 uv = xz * s;

  // refract with the water surface — caustics slide as waves pass overhead
  uv += refr * s * 2.8 * depthSpread;

  vec2 warp = vec2(
    fbm4(uv * 0.35 + refr * 0.12),
    fbm4(uv * 0.35 + vec2(4.3, 2.1) + refr * 0.1)
  ) - 0.5;
  uv += warp * 1.6;

  vec2 a = uv;
  vec2 b = ROT2 * (uv * 1.618) + vec2(4.7, 1.3);
  float c = min(causticTile(a, t) + causticTile(b, t * 1.27), 1.0);

  float vary = 0.45 + 0.9 * fbm4(uv * 0.25 + refr * 0.06);
  return clamp(c * vary, 0.0, 1.0);
}

// Project caustics onto the submerged, upward-facing sea floor. World-XZ space
// → seamless across chunks (Tile + Infinite). Modulated by sun lighting and
// water depth so it genuinely sits in the environment, not on the lens.
vec3 applyTerrainCaustics(vec3 col, vec2 xz, float visibleHeight, vec3 nGeo, vec3 lightN) {
  float amt = uCausticStrength * uCausticBlend;
  if (amt < 0.001) return col;

  // Structural skirt and perimeter-wall geometry is not sea floor. Use the
  // visible faceted height because the analytic/baked height can be submerged
  // while a coarse rendered triangle is visibly above the water.
  if (vSkirt > 0.0001 || vWallMesh > 0.5) return col;
  float below = uSeaLevel - visibleHeight; // >0 only when the rendered surface is submerged
  if (below <= 0.0) return col;

  // shallow terrain near the shoreline catches the most light; deep fades out
  float depthFade = 1.0 - clamp(below / max(uCausticDepthFade, 1.0), 0.0, 1.0);
  depthFade *= depthFade;
  // upward-facing surfaces catch the light; vertical cliffs stay dark
  float upFace = clamp(nGeo.y * 1.1, 0.0, 1.0);
  upFace *= upFace;
  // sunlight drives the caustics — facets toward the sun are brightest, and the
  // whole effect dims when the sun is low (no light = no caustics)
  float sunFace = max(dot(lightN, uSunDir), 0.0);
  float sunUp = clamp(uSunDir.y * 2.0, 0.0, 1.0);
  float light = (0.35 + 0.65 * sunFace) * sunUp;

  float t = uTime * uCausticWaterAnim * uCausticAnimSpeed * uCausticSpeed;
  vec2 refr = causticSurfaceRefraction(xz, t);
  float depthSpread = 1.0 + below * 0.012;
  float c = causticPattern(xz, t, refr, depthSpread);

  // additive light, plus a touch of multiplicative brightening so the floor
  // albedo shows through the bright filaments
  vec3 add = uCausticColor * c * amt * depthFade * upFace * light * 2.4;
  return col * (1.0 + c * amt * depthFade * upFace * light * 0.6) + add;
}

vec3 applyTerrainDetailNormal2D(vec3 n, vec3 nGeo, vec3 worldPos, float fade, float rockMask, float shoreMask) {
  float strength = uTerrainDetailNormalStrength * fade * (0.45 + 0.55 * terrainDetailQualityFactor());
  if (strength <= 0.0001) return n;
  float scale = uTerrainDetailScale * mix(0.55, 1.25, terrainDetailQualityFactor());
  float e = max(0.45, 0.55 / max(scale, 0.0001));
  float c = terrainDetailRelief(worldPos, nGeo, scale);
  float dx = terrainDetailRelief(worldPos + vec3(e, 0.0, 0.0), nGeo, scale) - c;
  float dz = terrainDetailRelief(worldPos + vec3(0.0, 0.0, e), nGeo, scale) - c;
  float matStrength = strength * (0.55 + rockMask * 1.05 + shoreMask * 0.25);
  vec3 detailN = normalize(n + vec3(-dx * matStrength * 5.5, 0.0, -dz * matStrength * 5.5));
  return normalize(mix(n, detailN, terrainDetailEnabled()));
}

void main() {
  vec2 xz = vWorldPos.xz;

  // Circular assemblies still use square chunk meshes. Remove every chunk
  // fragment outside the disk so the original board cannot show through at zero
  // height. The radial wall (vWallMesh) sits ON the perimeter, so it is exempt.
  if (uInfiniteMode < 0.5 && uTileShape > 0.5 && vWallMesh < 0.5 && tileOccupiedAt(xz) < 0.5) discard;

  // Correctness path: procedural terrain shading uses the same exact climate
  // function as terrain formation. The low-resolution climate cache introduced
  // visible color blocks and stale biome classifications after water changes.
  Climate cl = ${features.manual
    ? 'terrainCachedClimateAt(xz)'
    : 'climateAt(xz * uFrequency + uSeedOffset)'};
  BiomeWeights bw = biomeWeightsAt(cl);
  vec4 paintedBiome = ${features.manual ? 'vec4(0.0)' : 'paintBiomeAt(xz)'};
  vec4 splineMask = ${features.manual ? 'vec4(0.0)' : 'splineMaskAt(xz)'};
  bw.desert = clamp(max(bw.desert, paintedBiome.r), 0.0, 1.0);
  bw.canyon = clamp(max(bw.canyon, max(paintedBiome.g, splineMask.r * (1.0 - splineMask.b))), 0.0, 1.0);
  bw.wetland = clamp(max(bw.wetland, max(paintedBiome.b, splineMask.r * splineMask.b)), 0.0, 1.0);
  bw.mountains = clamp(max(bw.mountains, paintedBiome.a), 0.0, 1.0);
${features.manual ? '' : /* glsl */ `
  if (uInfiniteMode < 0.5 && uImportBiomeMode > 1.5) {
    float b = importedMapValue(uImportBiomeTex, tileUvAt(xz));
    BiomeWeights importedBw;
    importedBw.desert = 1.0 - smoothstep(0.18, 0.32, b);
    importedBw.canyon = smoothstep(0.22, 0.42, b) * (1.0 - smoothstep(0.43, 0.58, b));
    importedBw.wetland = smoothstep(0.44, 0.60, b) * (1.0 - smoothstep(0.62, 0.78, b));
    importedBw.mountains = smoothstep(0.66, 0.86, b);
    if (uImportBiomeMode > 2.5) {
      bw.desert = mix(bw.desert, importedBw.desert, uImportBiomeBlend);
      bw.canyon = mix(bw.canyon, importedBw.canyon, uImportBiomeBlend);
      bw.wetland = mix(bw.wetland, importedBw.wetland, uImportBiomeBlend);
      bw.mountains = mix(bw.mountains, importedBw.mountains, uImportBiomeBlend);
    } else {
      bw = importedBw;
    }
  }
`}

  float eps = uEps;
  float hC, hX, hZ;
  vec3 nGeo;
${features.manual ? /* glsl */ `
  hC = terrainCachedHeightAt(xz);
  hX = terrainCachedHeightAt(xz + vec2(eps, 0.0));
  hZ = terrainCachedHeightAt(xz + vec2(0.0, eps));
  nGeo = normalize(vec3(-(hX - hC) / eps, 1.0, -(hZ - hC) / eps));
` : /* glsl */ `
  if (uInfiniteMode < 0.5 && uUseTerrainHeightTex > 0.5) {
    // Stable packed bake: the centre fetch contains the exact finite-difference
    // normal plus height. Neighbour heights remain available for concavity AO.
    vec2 uv = bakedUvAt(xz);
    vec2 duv = vec2(
      uEps / max(uBakeSpan.x, 1.0),
      uEps / max(uBakeSpan.y, 1.0)
    );
    vec4 packedHeightNormal = texture2D(uTerrainHeightTex, uv);
    hC = packedHeightNormal.a * uHeightScale;
    hX = texture2D(uTerrainHeightTex, uv + vec2(duv.x, 0.0)).a * uHeightScale;
    hZ = texture2D(uTerrainHeightTex, uv + vec2(0.0, duv.y)).a * uHeightScale;
    nGeo = normalize(packedHeightNormal.rgb * 2.0 - 1.0);
  } else {
    hC = terrainCachedHeightAt(xz);
    float normalDistance = length(cameraPosition - vWorldPos);
    bool farInfiniteNormal = uInfiniteMode > 0.5
      && (vLod > 1.5 || normalDistance > max(uChunkSize * 7.0, 900.0));
    if (farInfiniteNormal) {
      hX = hC;
      hZ = hC;
      nGeo = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
      if (nGeo.y < 0.0) nGeo = -nGeo;
    } else {
      hX = terrainCachedHeightAt(xz + vec2(eps, 0.0));
      hZ = terrainCachedHeightAt(xz + vec2(0.0, eps));
      nGeo = normalize(vec3(-(hX - hC) / eps, 1.0, -(hZ - hC) / eps));
    }
  }
`}

  if (uTileDebugView > 0.5) {
    float h01 = clamp(hC / max(uHeightScale, 1e-3), 0.0, 1.0);
    if (uTileDebugView < 1.5) {
      float n = stackHeight2D(xz, cl);
${features.manual ? '' : /* glsl */ `
      if (uInfiniteMode < 0.5 && uImportNoiseMode > 1.5) {
        float importedNoise = importedMapValue(uImportNoiseTex, tileUvAt(xz)) * uAmplitude;
        n = (uImportNoiseMode > 2.5) ? mix(n, importedNoise, uImportNoiseBlend) : importedNoise;
      }
`}
      gl_FragColor = vec4(vec3(clamp(n, 0.0, 1.0)), 1.0);
    } else if (uTileDebugView < 2.5) {
      gl_FragColor = vec4(vec3(h01), 1.0);
    } else {
      vec3 dbg = terrainBiomeDebugColor(bw, h01);
      gl_FragColor = vec4(dbg, 1.0);
    }
    return;
  }

  if (uColorMode > 0.5) {
    // mode 3 packs the ACTUAL rendered (faceted) surface height — the
    // interpolated displaced vertex Y — so prop placement matches the visible
    // LOD mesh exactly, not the smooth analytic field that floats above crests.
    float hSrc = (uColorMode > 2.5) ? vWorldPos.y : hC;
    float h01 = clamp(hSrc / max(uHeightScale, 1e-3), 0.0, 1.0);
    if (uColorMode > 1.5) {
      // modes 2 & 3: 16-bit height packed into RG (collision / prop surface tile)
      float hi = floor(h01 * 255.0) / 255.0;
      float lo = fract(h01 * 255.0);
      gl_FragColor = vec4(hi, lo, 0.0, 1.0);
    } else {
      // mode 1: 8-bit grayscale (heightmap export)
      gl_FragColor = vec4(vec3(h01), 1.0);
    }
    return;
  }

  // perimeter plinth wall: flat plinth colour (with fog), no terrain shading.
  // Placed after the export/debug early-outs so heightmap/minimap stay clean.
  // vWall interpolates 0 (surface rim vertex) -> 1 (skirt vertex at the base),
  // so a small threshold colours the whole wall, leaving only a hairline of
  // terrain colour at the rim where it meets the surface (a natural transition).
  if (vWall > 0.02) {
    float wd = length(cameraPosition - vWorldPos);
    float wfog = 1.0 - exp(-uFogDensity * uFogDensity * wd * wd);
    vec3 wcol = mix(uPlinthColor, uFogColor, clamp(wfog, 0.0, 1.0));
    gl_FragColor = vec4(wcol, 1.0);
    return;
  }

  vec3 n = normalize(vec3(nGeo.x * uNormalStrength, 1.0, nGeo.z * uNormalStrength));
  vec3 surfaceBaseNormal = n;

  float slope = 1.0 - nGeo.y;
  // Wet/dry color classification follows the surface actually rasterized by
  // the active LOD mesh. Using the higher-resolution bake here colored visible
  // terrain blue when its interpolated triangle sat above the water plane.
  float hRel = vWorldPos.y - uSeaLevel;
  float h01 = hC / max(uHeightScale, 1e-3);

  if (uBiomeDebug > 0.5) {
    vec3 dbg = terrainBiomeDebugColor(bw, h01);
    float shade = 0.55 + 0.45 * max(dot(n, uSunDir), 0.0);
    gl_FragColor = vec4(pow(dbg * shade, vec3(1.0 / 2.2)), 1.0);
    return;
  }

  float jitter = (cl.region - 0.5) * 0.8 + (vnoise(xz * 0.045 + uSeedOffset) - 0.5) * 0.6;
  float detail = vnoise(xz * 0.35 + uSeedOffset.yx);

  TerrainColorResult tc = computeTerrainAlbedo(cl, bw, hC, hRel, h01, slope, detail, jitter, vnoise(xz * 0.9));
  tc.albedo = applyTerrainGraphColor(tc.albedo, xz, clamp(h01, 0.0, 1.0), slope, detail, cl.moist);
  TerrainDetailResult td = applyTerrainDetailLayer(tc, cl, bw, vWorldPos, nGeo, hC, hRel, h01, slope, jitter);
  n = applyTerrainDetailNormal2D(n, nGeo, vWorldPos, td.fade, td.rockMask, td.shoreMask);

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

  // Surface textures: replace / tint the procedural biome colour with real
  // material textures (triplanar, blended by the same signals). No-op cost when
  // the mode is off or the camera is far (uSurfMode/uSurfAmount uniform branch).
  float dist = length(cameraPosition - vWorldPos);
  SurfaceTexResult surf = applySurfaceMaterials(
    td.albedo, n, surfaceBaseNormal, nGeo, vWorldPos, dist, tc, cl, bw, slope, hRel, h01, detail, jitter
  );
  td.albedo = surf.albedo;
  n = surf.normal;

${features.manual ? '' : /* glsl */ `
  // Geo-aligned OpenTopoMap (or file) imagery — same UV region as the real-world
  // height import. Applied after surface materials so the map reads as true albedo.
  td.albedo = applyImportedImageryAlbedo(td.albedo, xz);
`}

  float concave = clamp(((hX + hZ) * 0.5 - hC) / (eps * 0.9), 0.0, 1.0);
  float valley = 1.0 - smoothstep(0.0, uHeightScale * 0.55, hC);
  float ao = (1.0 - uAO * (concave * 0.45 + valley * 0.22)) * surf.ao;
  ao = applyRidgeAccent(ao, (hC - (hX + hZ) * 0.5) / (eps * 0.9));

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 col = terrainLighting(
    td.albedo, n, uSunDir, ao,
    tc.snow, tc.sandBand, hRel, tc.flatness, bw.wetland,
    viewDir
  );

  // sampled roughness -> subtle view-dependent sheen (smoother materials glint)
  if (surf.amount > 0.001) {
    float ssp = pow(max(dot(reflect(-uSunDir, n), viewDir), 0.0), 24.0);
    col += ssp * (1.0 - surf.rough) * surf.amount * 0.15 * max(uSunDir.y, 0.0);
  }

  // underwater caustics on the submerged sea floor (no-op when dry: the
  // uCausticBlend uniform branch is warp-coherent, so above water costs nothing)
  col = applyTerrainCaustics(col, xz, vWorldPos.y, nGeo, n);

  // Analysis is a lightweight branch in the existing terrain pass. It reads
  // the final height function, so paint, erosion and spline edits agree.
  if (uAnalysisEnabled > 0.5) {
    vec3 analysis = vec3(0.0);
    float rangeT = clamp((hC - uAnalysisMin) / max(uAnalysisMax - uAnalysisMin, 0.001), 0.0, 1.0);
    if (uAnalysisMode < 1.5) {
      analysis = mix(vec3(0.05, 0.17, 0.42), vec3(0.92, 0.72, 0.24), rangeT);
      float contour = abs(fract(hC / max(uAnalysisContourSpacing, 1.0)) - .5);
      analysis = mix(analysis, vec3(0.04), (1.0 - smoothstep(.0, .055, contour)) * uAnalysisContourStrength);
    } else if (uAnalysisMode < 2.5) {
      float deg = acos(clamp(nGeo.y, -1.0, 1.0)) * 57.2958;
      analysis = deg < uAnalysisThresholdA ? mix(vec3(.07,.35,.16), vec3(.75,.78,.16), deg / max(uAnalysisThresholdA, 1.0)) : mix(vec3(.92,.58,.10), vec3(.70,.08,.08), clamp((deg-uAnalysisThresholdA)/max(uAnalysisThresholdB-uAnalysisThresholdA,1.0),0.,1.));
    } else if (uAnalysisMode < 3.5) analysis = nGeo * .5 + .5;
    else if (uAnalysisMode < 4.5) { float curv = clamp(((hX + hZ) * .5 - hC) / max(eps * 4.0, .001), -.5, .5); analysis = curv > 0. ? mix(vec3(.35), vec3(.95,.65,.18), curv*2.) : mix(vec3(.35), vec3(.12,.45,.95), -curv*2.); }
    else if (uAnalysisMode < 5.5) { float depth = max(uSeaLevel - hC, 0.0); analysis = mix(vec3(.08,.35,.55), vec3(.01,.02,.18), clamp(depth / max(uAnalysisMax, 1.0), 0., 1.)); }
    else if (uAnalysisMode < 6.5) analysis = terrainBiomeDebugColor(bw, h01);
    else { float p = abs(paintHeightOffsetAt(xz)); float sp = abs(splineHeightOffsetAt(xz)); analysis = vec3(clamp(p/20.,0.,1.), clamp(sp/20.,0.,1.), splineMaskAt(xz).r); }
    col = mix(col, analysis, uAnalysisOpacity);
  }

  if (uGrid > 0.001) {
    vec2 gw = fwidth(xz) + 1e-5;
    vec2 gp = abs(fract(xz / uChunkSize - 0.5) - 0.5) * uChunkSize / gw;
    float line = 1.0 - min(min(gp.x, gp.y), 1.0);
    float gridFade = smoothstep(420.0, 60.0, length(cameraPosition - vWorldPos) / 8.0);
    float gridMul = 1.0;
    if (uInfiniteMode < 0.5 && uUseTiles > 0.5) gridMul = 1.0 - tileInteriorSeam(xz);
    // Grid lines recolour over folded terrain so the chunk grid also shows
    // which chunks have merged, ramped by fold level (green = small fold →
    // magenta = whole board); default blue over live detailed chunks.
    vec3 gridCol = vLod > 3.5 ? mergeTierColor(vLod) : vec3(0.45, 0.80, 0.95);
    col = mix(col, gridCol, line * uGrid * 0.22 * (0.35 + 0.65 * gridFade) * gridMul);
  }

  if (uLodDebug > 0.5) {
    int li = int(clamp(vLod, 0.0, 3.0) + 0.5);
    col = mix(col, LOD_COLORS[li], 0.55);
  }

  // Merge debug: tint folded terrain by fold level (green = small 2x2 fold →
  // magenta = whole board). Detailed chunks stay untouched so folds stand out.
  if (uMergeDebug > 0.5 && vLod > 3.5) {
    col = mix(col, mergeTierColor(vLod), 0.55);
  }

  // Crack-cover skirts retain terrain colour in every production mode.
  // Dark flaps turn ordinary LOD covers into the long grid lines users saw.
  float skirtDarken = 0.0;
  col *= 1.0 - skirtDarken;

  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

  col = pow(col, vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}
`;
};

// Minimal boot fragment: height + a simple height/slope-banded colour + sun +
// fog only. It skips the palette/colour, surface-texture, terrain-detail and
// caustic blocks — the dominant cost of the full fragment's synchronous
// GLSL→HLSL translation on Windows/ANGLE (the multi-second tab freeze). Used
// for the first Tile paint; the live material's source is then swapped in place
// (rebuildTerrainShaderSource) for an instant program-cache hit.
const buildMinimalFragment = (graphColorGLSL = DEFAULT_TERRAIN_GRAPH_COLOR_GLSL) => /* glsl */ `
precision highp float;

${COMMON_UNIFORMS_GLSL}
${TERRAIN_HEIGHT_TEX_GLSL}
${PALETTE_UNIFORMS_GLSL}
${graphColorGLSL}

uniform float uColorMode;
uniform float uEps;
uniform float uNormalStrength;
uniform vec3  uPlinthColor;

varying vec3  vWorldPos;
varying float vSkirt;
varying float vWall;
varying float vWallMesh;
varying vec3  vTerrainPreviewNormal;

void main() {
  vec2 xz = vWorldPos.xz;

  if (uInfiniteMode < 0.5 && uTileShape > 0.5 && vWallMesh < 0.5 && tileOccupiedAt(xz) < 0.5) discard;

  float hC;
  vec3 nGeo;
  if (uInfiniteMode < 0.5 && uUseTerrainHeightTex > 0.5) {
    vec2 uv = bakedUvAt(xz);
    vec2 duv = vec2(
      uEps / max(uBakeSpan.x, 1.0),
      uEps / max(uBakeSpan.y, 1.0)
    );
    vec4 packedHeightNormal = texture2D(uTerrainHeightTex, uv);
    hC = packedHeightNormal.a * uHeightScale;
    nGeo = normalize(packedHeightNormal.rgb * 2.0 - 1.0);
  } else
  {
    hC = vWorldPos.y;
    // Node authoring deliberately keeps this lightweight fragment live while
    // the graph changes. Its height cache is therefore commonly unavailable.
    // Use the smoothly interpolated normal prepared by the preview vertex
    // shader instead of treating every slope as horizontal.
    nGeo = normalize(vTerrainPreviewNormal);
  }

  // keep the height-packing export/sampler modes correct while the boot
  // material is live (prop placement / collision tiles may render early)
  if (uColorMode > 0.5) {
    float hp = clamp(((uColorMode > 2.5) ? vWorldPos.y : hC) / max(uHeightScale, 1e-3), 0.0, 1.0);
    if (uColorMode > 1.5) {
      float hi = floor(hp * 255.0) / 255.0;
      float lo = fract(hp * 255.0);
      gl_FragColor = vec4(hi, lo, 0.0, 1.0);
    } else {
      gl_FragColor = vec4(vec3(hp), 1.0);
    }
    return;
  }

  float dist = length(cameraPosition - vWorldPos);

  if (vWall > 0.02) {
    float wfog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    gl_FragColor = vec4(mix(uPlinthColor, uFogColor, clamp(wfog, 0.0, 1.0)), 1.0);
    return;
  }

  float slope = 1.0 - nGeo.y;
  float h01 = clamp(hC / max(uHeightScale, 1e-3), 0.0, 1.0);
  float hRel = vWorldPos.y - uSeaLevel;

  // banded albedo from the REAL palette uniforms so the interim look already
  // matches the user's style — the boot→full swap reads as added detail, not
  // a colour change
  vec3 albedo = mix(uColGrass, uColDryGrass, smoothstep(0.18, 0.45, h01));
  albedo = mix(albedo, uColRock, smoothstep(0.40, 0.75, h01));
  albedo = mix(albedo, uColRock, clamp(slope * 1.8, 0.0, 1.0) * 0.6);
  albedo = mix(albedo, uColRockHi, smoothstep(0.60, 0.85, h01) * (1.0 - slope));
  albedo = mix(albedo, uColSnow, smoothstep(uSnowLine - 0.08, uSnowLine + 0.06, h01 - slope * 0.25));
  albedo = mix(uColSand, albedo, smoothstep(0.0, 6.0, hRel));
  float luma = dot(albedo, vec3(0.299, 0.587, 0.114));
  albedo = max((mix(vec3(luma), albedo, uPaletteSaturation) - 0.5) * uPaletteContrast + 0.5, vec3(0.0)) * uPaletteTint;
  float graphDetail = fract(sin(dot(floor(xz * 0.02), vec2(12.9898, 78.233))) * 43758.5453);
  albedo = applyTerrainGraphColor(albedo, xz, h01, slope, graphDetail, 0.5);

  vec3 n = normalize(vec3(
    nGeo.x * uNormalStrength,
    max(nGeo.y, 0.0001),
    nGeo.z * uNormalStrength
  ));
  float diff = max(dot(n, uSunDir), 0.0);
  vec3 sunCol = uTerrainSunCol * uTerrainSunIntensity;
  vec3 skyAmb = uTerrainSkyAmb * 0.50 * (n.y * 0.5 + 0.5);
  vec3 bounce = uTerrainBounce * 0.25 * (1.0 - n.y * 0.5);
  vec3 col = albedo * (sunCol * diff + skyAmb + bounce);

  float skirtDarken = 0.0;
  col *= 1.0 - skirtDarken;

  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
  gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}
`;

// 1x1 mid-grey fallback so the four surface-texture samplers are always bound
// (avoids "no texture" warnings while the real atlas is null / before build).
let _surfFallbackTex = null;
function surfFallbackTexture() {
  if (!_surfFallbackTex) {
    _surfFallbackTex = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat);
    _surfFallbackTex.needsUpdate = true;
  }
  return _surfFallbackTex;
}

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
    uTerrainFormationSeaLevel: { value: 42 },
    uAmplitude:      { value: 1.0 },
    uStackNormalize: { value: 0.0 },
    uStackOutMin:    { value: 0.0 },
    uStackOutMax:    { value: 1.35 },
    uTerrainSmoothing: { value: 0.0 },
    uPersistence:    { value: 0.5 },
    uLacunarity:     { value: 2.05 },
    uRidge:          { value: 0.65 },
    uWarp:           { value: 0.9 },
    uFalloff:        { value: 0.5 },
    uEdgeFalloffMode:{ value: 0.0 },
    uInfiniteMode:   { value: 0.0 },
    uBoardHalf:      { value: 1024 },
    uChunkSize:      { value: 128 },
    // Tile mode (multi-cell studio assembly). Defaults reproduce a single
    // origin-centred board (uUseTiles=0 -> legacy falloff/wall path).
    uTileOccupancy:  { value: null },
    uTileGridOrigin: { value: new THREE.Vector2(-1024, -1024) },
    uTileGridDim:    { value: new THREE.Vector2(1, 1) },
    uTileCellSize:   { value: 2048 },
    uUseTiles:       { value: 0.0 },
    uTileShape:      { value: 0.0 },
    uTileDiskRadius: { value: 1024 },
    uMoistScale:     { value: 1.0 },
    uMoistBias:      { value: 0.0 },
    uBiomeScale:     { value: 1.0 },
    uTempBias:       { value: 0.0 },
    uBiomeDebug:     { value: 0.0 },
    uSnowLine:       { value: 0.7 },
    uNormalStrength: { value: 1.25 },
    uAO:             { value: 0.75 },
    uAORidge:        { value: 0.0 },
    uRockSlopeLo:    { value: 0.42 },
    uRockSlopeHi:    { value: 0.72 },
    uSnowSlopeMin:   { value: 0.30 },
    uSnowSlopeMax:   { value: 0.62 },
    uGrid:           { value: 1.0 },
    uLodDebug:       { value: 0.0 },
    uMergeDebug:     { value: 0.0 },
    uColorMode:      { value: 0.0 },
    uEps:            { value: 0.6 },
    uSkirtDepth:     { value: 40 },
    uPlinthBaseY:    { value: -40 },
    uPlinthColor:    { value: new THREE.Color(0x14110d) },
    uAnalysisEnabled: { value: 0.0 },
    uAnalysisMode: { value: 1.0 },
    uAnalysisOpacity: { value: 0.72 },
    uAnalysisMin: { value: 0.0 },
    uAnalysisMax: { value: 600.0 },
    uAnalysisThresholdA: { value: 35.0 },
    uAnalysisThresholdB: { value: 55.0 },
    uAnalysisContourSpacing: { value: 50.0 },
    uAnalysisContourStrength: { value: .35 },
    uWallThickness:  { value: 12 },
    uTerrainCloudShadowEnabled: { value: 0.0 },
    uTerrainCloudShadowStrength: { value: 0.45 },
    uTerrainCloudShadowCenter: { value: new THREE.Vector2() },
    uTerrainCloudShadowExtent: { value: 1.0 },
    uTerrainCloudShadowAltitude: { value: 1000.0 },
    uTerrainCloudShadowScale: { value: 0.001 },
    uTerrainCloudShadowCoverage: { value: 0.5 },
    uTerrainCloudShadowSoftness: { value: 0.16 },
    uTerrainCloudShadowWind: { value: new THREE.Vector3() },
    uTerrainCloudShadowTime: { value: 0.0 },
    uTerrainCloudShadowRotation: { value: 0.0 },
    uTerrainCloudShadowEvolve: { value: 0.0 },
    // Underwater caustics (shared by every terrain material — studio/infinite
    // declare + use them; the planet material harmlessly ignores them). Default
    // off; the engine raises uCausticBlend with camera submersion each frame.
    uCausticStrength: { value: 0.0 },
    uCausticBlend:    { value: 0.0 },
    uCausticScale:    { value: 1.0 },
    uCausticSpeed:    { value: 1.0 },
    uCausticColor:    { value: new THREE.Vector3(0.85, 0.95, 1.0) },
    uCausticDepthFade:{ value: 70.0 },
    uCausticMinDepth: { value: 1.0 },
    uCausticMinDepthFalloff: { value: 1.0 },
    uCausticWaterAnim:     { value: 1.0 },
    uCausticAnimSpeed:     { value: 1.0 },
    uCausticWaveSpeed:     { value: 1.0 },
    uCausticWaveScale:     { value: 1.0 },
    uCausticWaveStrength:  { value: 1.6 },
    uCausticLargeWaveStr:  { value: 1.0 },
    uCausticSmallWaveStr:  { value: 0.65 },
    uCausticRippleLegacy:  { value: 1.0 },
    uCausticWaveDir:       { value: new THREE.Vector2(1, 0) },
    uPlanetRadius:   { value: 8000 },
    uPlanetEps:      { value: 0.0015 },
    uSunDir:         { value: new THREE.Vector3(0.5, 0.7, 0.3).normalize() },
    uFogColor:       { value: new THREE.Color(0x0b0e14) },
    uFogDensity:     { value: 0.000045 },
    uTime:           { value: 0 },
    uPaintEnabled:   { value: 0 },
    uPaintOpacity:   { value: 1 },
    uPaintBoardSize: { value: 1024 },
    uPaintResolution:{ value: 512 },
    uPaintBaseMult:  { value: 1 },
    uPaintHeightTexture: { value: null },
    uPaintBiomeTexture: { value: null },
    uPaintPropsTexture: { value: null },
    uManualSurfaceMode: { value: 0 },
    uManualBaseGenerated: { value: 0 },
    uManualSurfaceOrigin: { value: new THREE.Vector2(-512, -512) },
    uManualSurfaceSpan: { value: new THREE.Vector2(1024, 1024) },
    uManualSurfaceTextureA: { value: null },
    uManualSurfaceTextureB: { value: null },
    uManualEnabled: { value: 0 },
    uManualOrigin: { value: new THREE.Vector2(-512, -512) },
    uManualSpan: { value: new THREE.Vector2(1024, 1024) },
    uManualHeightTexture: { value: null },
    uSplineEnabled: { value: 0.0 },
    uSplineResolution: { value: 512.0 },
    uSplineOrigin: { value: new THREE.Vector2(-1024, -1024) },
    uSplineSpan: { value: new THREE.Vector2(2048, 2048) },
    uSplineHeightTexture: { value: null },
    uSplineMaskTexture: { value: null },
    uSplineAuxTexture: { value: null },
    // Planet-mode baked height cubemap (shared by the planet terrain +
    // water shaders). When uUsePlanetHeightTex is 1, those shaders sample this
    // texture instead of re-evaluating the ~46-octave height field per pixel.
    // Ignored by the studio/infinite materials, which never declare them.
    uPlanetHeightTex:    { value: null },
    uUsePlanetHeightTex: { value: 0.0 },

    // Studio-mode packed height/normal texture (shared by the studio terrain +
    // water shaders). When uUseTerrainHeightTex is 1, those shaders sample this
    // 2D texture instead of re-evaluating the height field per pixel. The shared
    // Tile/Infinite program always declares it; uInfiniteMode keeps unbounded
    // terrain on the procedural path.
    uTerrainHeightTex:    { value: null },
    uUseTerrainHeightTex: { value: 0.0 },
    // Procedural climate bake used only by Studio water tinting.
    // RGBA = temperature, moisture, continentalness, region.
    uTerrainBiomeTex:     { value: null },
    uUseTerrainBiomeTex:  { value: 0.0 },
    // Dedicated Studio water cache. During a rebuild the Engine disables these
    // bindings and hides Studio water; the matching final height + climate
    // textures are then published together.
    uWaterTerrainHeightTex:   { value: null },
    uWaterTerrainBiomeTex:    { value: null },
    uUseWaterTerrainBiomeTex: { value: 0.0 },
    uInfiniteFieldTex0:   { value: null },
    uInfiniteFieldTex1:   { value: null },
    uInfiniteFieldTex2:   { value: null },
    uInfiniteFieldOrigin0:{ value: new THREE.Vector2() },
    uInfiniteFieldOrigin1:{ value: new THREE.Vector2() },
    uInfiniteFieldOrigin2:{ value: new THREE.Vector2() },
    uInfiniteFieldSpan0:  { value: new THREE.Vector2(1, 1) },
    uInfiniteFieldSpan1:  { value: new THREE.Vector2(1, 1) },
    uInfiniteFieldSpan2:  { value: new THREE.Vector2(1, 1) },
    uInfiniteFieldReady:  { value: new THREE.Vector3() },
    uUseInfiniteFieldCache: { value: 0.0 },
    uBakeOrigin:          { value: new THREE.Vector2(-1024, -1024) },
    uBakeSpan:            { value: new THREE.Vector2(2048, 2048) },

    // Erosion height-offset field (signed world-unit delta over the bake region,
    // R channel). Added in heightAt() so mesh/normals/collision/props/export all
    // follow it. Disabled by default — a free no-op until an erosion bake runs.
    uErosionOffsetTex:    { value: null },
    uErosionEnabled:      { value: 0.0 },

    // Noise Stack per-layer continuous params (shared by every height material).
    // Packed each param change by Engine from the live NoiseStack; the GLSL
    // arrays in COMMON_UNIFORMS_GLSL read these.
    uLayerStrength:  { value: new Array(MAX_LAYERS).fill(0) },
    uLayerScale:     { value: new Array(MAX_LAYERS).fill(1) },
    uLayerSeed:      { value: new Array(MAX_LAYERS).fill(0) },
    uLayerParamsA:   { value: Array.from({ length: MAX_LAYERS }, () => new THREE.Vector4()) },
    uLayerParamsB:   { value: Array.from({ length: MAX_LAYERS }, () => new THREE.Vector4()) },
    uLayerMaskA:     { value: Array.from({ length: MAX_LAYERS }, () => new THREE.Vector4()) },
    uLayerMaskB:     { value: Array.from({ length: MAX_LAYERS }, () => new THREE.Vector4()) },
    uLayerMaskC:     { value: Array.from({ length: MAX_LAYERS }, () => new THREE.Vector4()) },
    // Terrain graph color stream. Kept separate from height slots so rich
    // color grading never reduces the realtime landform budget.
    uGraphColorA:    { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
    uGraphColorB:    { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
    uGraphColorC:    { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
    uGraphColorD:    { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
    uGraphColorParams: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
    uNoiseDebug:     { value: 0.0 },
    uTileDebugView:  { value: 0.0 },
    uTerrainDetailQuality: { value: 3.0 },
    uTerrainDetailScale: { value: 0.16 },
    uTerrainDetailStrength: { value: 0.72 },
    uTerrainDetailNormalStrength: { value: 0.42 },
    uTerrainDetailNear: { value: 80.0 },
    uTerrainDetailFar: { value: 190.0 },
    uTerrainRockSlope: { value: 0.28 },
    uTerrainRockSharpness: { value: 0.14 },
    uTerrainTriplanar: { value: 1.0 },
    uTerrainShoreRange: { value: 18.0 },
    uTerrainShoreWetness: { value: 0.35 },
    uTerrainDetailOpacity: { value: 1.0 },
    uTerrainMicroDetail: { value: 0.6 },
    uTerrainMacroVariation: { value: 0.5 },
    uTerrainDetailDebug: { value: 0.0 },
    uVisualTerrainColorVariation: { value: 0.36 },
    uVisualTerrainHeightDetail: { value: 0.42 },
    uVisualWetShoreStrength: { value: 0.55 },
    uVisualRockDetail: { value: 0.45 },
    uVisualSoilDetail: { value: 0.35 },
    uVisualSandDetail: { value: 0.38 },
    uVisualFoamBreakup: { value: 0.45 },
    uVisualWetSandRange: { value: 18.0 },
    uVisualShallowWaterSoftness: { value: 0.38 },
    uImportNoiseTex: { value: null },
    uImportHeightTex:{ value: null },
    uImportBiomeTex: { value: null },
    uImportImageryTex: { value: null },
    uImportNoiseMode:{ value: 0.0 },
    uImportHeightMode:{ value: 0.0 },
    uImportBiomeMode:{ value: 0.0 },
    uImportImageryMode:{ value: 0.0 },
    uImportNoiseBlend:{ value: 1.0 },
    uImportHeightBlend:{ value: 1.0 },
    uImportHeightStrength:{ value: 1.0 },
    uImportHeightOffset:{ value: 0.0 },
    uImportBiomeBlend:{ value: 1.0 },
    uImportImageryBlend:{ value: 1.0 },
    // World rect the imported height map covers (originX, originZ, spanX, spanZ).
    // Kept in sync with the single origin cell by _syncImportedMapUniforms unless
    // a real-world import widens it to the tile-assembly union.
    uImportHeightRegion:{ value: new THREE.Vector4(-1024, -1024, 2048, 2048) },

    // Surface textures (real material maps replacing / tinting the biome colour).
    // Atlas samplers stay null until the engine builds them; uSurfMode 0 keeps the
    // whole feature a no-op (procedural colours), so the shader is unchanged until
    // the user switches to texture mode.
    uSurfDiffuse:    { value: surfFallbackTexture() },
    uSurfProps:      { value: surfFallbackTexture() },
    uSurfMode:       { value: 0.0 },
    uSurfAmount:     { value: 1.0 },
    uSurfTint:       { value: 0.0 },
    uSurfPaletteInfluence: { value: 0.6 },
    uSurfScale:      { value: 1.0 },
    uSurfBreakup:    { value: 0.0 },
    uSurfBlend:      { value: 0.0 },
    uSurfNormalAmt:  { value: 1.0 },
    uSurfRoughAmt:   { value: 1.0 },
    uSurfAOAmt:      { value: 1.0 },
    uSurfTriplanar:  { value: 1.0 },
    // Textures render at full strength across the board and near field, easing
    // to procedural colour only in the far distance (cuts cost + no-mip shimmer
    // for far infinite-world terrain). Studio board distances stay well inside.
    uSurfNear:       { value: 200.0 },
    uSurfFar:        { value: 12000.0 },
    uSurfTile:       { value: new Array(SURFACE_TEXTURE_ROLE_COUNT).fill(12) },
    uSurfRolePresent:{ value: new Array(SURFACE_TEXTURE_ROLE_COUNT).fill(0) },
    uSurfPresent:    { value: new Array(SURFACE_TEXTURE_ROWS).fill(0) },
    ...paletteUniforms,
  };
}

// Default stack GLSL (single legacy layer) — used when no stack is supplied so
// existing call sites stay valid and render exactly as before.
const DEFAULT_STACK_GLSL = generateStackGLSL(defaultLegacyStack());

export function createTerrainMaterial(
  uniforms,
  octaves = 7,
  stackGLSL = DEFAULT_STACK_GLSL,
  options = {},
) {
  const variant = resolveTerrainVariant(options.variant).name;
  const h = variant === 'manual'
    ? MANUAL_HEIGHT_GLSL
    : buildHeightGLSL(stackGLSL.body2d);
  const material = new THREE.ShaderMaterial({
    uniforms,
    defines: { OCTAVES: octaves },
    vertexShader: buildVertex(h, variant),
    fragmentShader: buildFragment(
      h,
      stackGLSL.colorBody || DEFAULT_TERRAIN_GRAPH_COLOR_GLSL,
      variant,
    ),
    side: THREE.DoubleSide,
    extensions: { derivatives: true },
  });
  material.userData.terrainVariant = variant;
  material.userData.heightProgramSig = stackGLSL.sig;
  return material;
}

export function createInfiniteTerrainMaterial(
  uniforms,
  octaves = 7,
  stackGLSL = DEFAULT_STACK_GLSL,
  options = {},
) {
  // A distinct material object keeps mode ownership/disposal simple, while the
  // identical source + defines let Three.js reuse Tile's compiled GPU program.
  return createTerrainMaterial(uniforms, octaves, stackGLSL, options);
}

/**
 * Terrain material with the MINIMAL fragment (see buildMinimalFragment). Same
 * heavy vertex shader — geometry must match exactly — but a fragment that is a
 * fraction of the full source, so ANGLE's synchronous translation is fast.
 * `userData.minimalFragment` marks it for the in-place source upgrade
 * (rebuildTerrainShaderSource) once the full program is warmed.
 */
export function createBootTerrainMaterial(uniforms, octaves = 7, stackGLSL = DEFAULT_STACK_GLSL, _options = {}) {
  const h = buildHeightGLSL(stackGLSL.body2d);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    defines: { OCTAVES: octaves },
    vertexShader: buildVertex(h, 'preview'),
    fragmentShader: buildMinimalFragment(stackGLSL.colorBody || DEFAULT_TERRAIN_GRAPH_COLOR_GLSL),
    side: THREE.DoubleSide,
  });
  mat.userData.minimalFragment = true;
  mat.userData.heightProgramSig = stackGLSL.sig;
  return mat;
}

// Update a live terrain material's shader source to a new generated stack
// in place (same material object → every mesh referencing it updates). The
// program for the identical source was warm-compiled first, so the relink is
// served from three's cache.
export function rebuildTerrainShaderSource(mat, stackGLSL, options = {}) {
  const variant = resolveTerrainVariant(options.variant).name;
  const h = variant === 'manual'
    ? MANUAL_HEIGHT_GLSL
    : buildHeightGLSL(stackGLSL.body2d);
  mat.vertexShader = buildVertex(h, variant);
  mat.fragmentShader = buildFragment(
    h,
    stackGLSL.colorBody || DEFAULT_TERRAIN_GRAPH_COLOR_GLSL,
    variant,
  );
  mat.userData.minimalFragment = false;   // boot materials upgrade to the full fragment here
  mat.userData.terrainVariant = variant;
  mat.userData.heightProgramSig = stackGLSL.sig;
  mat.extensions ||= {};
  mat.extensions.derivatives = true;
  mat.needsUpdate = true;
}

// Node authoring keeps the inexpensive palette-based fragment while swapping
// only the generated height source. This preserves a correct live 3D preview
// without paying for the full surface/detail fragment after every graph edit.
export function rebuildTerrainPreviewShaderSource(mat, stackGLSL) {
  const h = buildHeightGLSL(stackGLSL.body2d);
  mat.vertexShader = buildVertex(h, 'preview');
  mat.fragmentShader = buildMinimalFragment(stackGLSL.colorBody || DEFAULT_TERRAIN_GRAPH_COLOR_GLSL);
  mat.userData.minimalFragment = true;
  mat.userData.heightProgramSig = stackGLSL.sig;
  mat.needsUpdate = true;
}
