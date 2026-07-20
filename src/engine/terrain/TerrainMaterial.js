import * as THREE from 'three';
import { COMMON_UNIFORMS_GLSL, NOISE_GLSL, buildHeightGLSL, TERRAIN_HEIGHT_TEX_GLSL } from './terrainGLSL.js';
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

const buildVertex = (heightGLSL) => /* glsl */ `
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${BIOME_GLSL}
${heightGLSL}

uniform float uSkirtDepth;
uniform float uPlinthBaseY;
uniform float uWallThickness;

attribute float aSkirt;
attribute float aLod;
attribute float aWall;   // 1 on the dedicated circular radial-wall mesh, else 0

varying vec3  vWorldPos;
varying float vLod;
varying float vSkirt;
varying float vWall;
varying float vWallMesh;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float h = heightAt(wp.xz);

  float skirt = aSkirt;
  float wall = 0.0;   // outer-perimeter skirt -> plinth wall
  if (uInfiniteMode < 0.5) {
    if (uUseTiles > 0.5) {
      if (uTileShape > 0.5) {
        if (aWall > 0.5) {
          // Dedicated radial wall: its top ring (aSkirt 0) follows the terrain
          // silhouette at the disk perimeter, its base ring (aSkirt 1) drops to
          // the plinth base. Shaded as the plinth wall.
          wall = aSkirt;
          skirt = 0.0;
        } else {
          // Disk chunk: the curved perimeter is the radial wall's job, so chunk
          // skirts survive ONLY as LOD crack fillers — full depth, terrain
          // coloured, no darkening, no wall shading. Suppress the drop on cell
          // boundaries between two occupied cells (interior seams), otherwise the
          // vertical flap reads as a dark line between tiles.
          float interiorSeam = tileInteriorSeam(wp.xz);
          skirt = aSkirt * (1.0 - interiorSeam);
          wall = 0.0;
        }
      } else {
        // multi-cell square assembly: only skirts on a cell edge facing empty
        // space become the plinth wall; shared seams stay continuous terrain.
        vec3 tw = tileWall(wp.xz);
        float onOuter = step(0.5, tw.x);
        float interiorSeam = tileInteriorSeam(wp.xz);
        skirt = aSkirt * (1.0 - interiorSeam);
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

const buildFragment = (heightGLSL) => /* glsl */ `
precision highp float;

${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${BIOME_GLSL}
${heightGLSL}
${TERRAIN_HEIGHT_TEX_GLSL}
${PALETTE_UNIFORMS_GLSL}
${TERRAIN_COLOR_FUNCTIONS_GLSL}
${SURFACE_TEXTURE_UNIFORMS_GLSL}
${SURFACE_TEXTURE_FUNCTIONS_GLSL}
${TERRAIN_DETAIL_GLSL}

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
vec3 applyTerrainCaustics(vec3 col, vec2 xz, float hC, vec3 nGeo, vec3 lightN) {
  float amt = uCausticStrength * uCausticBlend;
  if (amt < 0.001) return col;

  float below = uSeaLevel - hC;          // >0 when terrain is under water
  if (below <= 0.0) return col;

  // shallow terrain near the shoreline catches the most light; deep fades out
  float depthFade = 1.0 - clamp(below / max(uCausticDepthFade, 1.0), 0.0, 1.0);
  depthFade = depthFade * depthFade;     // bias toward shallow water
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

  Climate cl = climateAt(xz * uFrequency + uSeedOffset);
  BiomeWeights bw = biomeWeightsAt(cl);
  vec4 paintedBiome = paintBiomeAt(xz);
  vec4 splineMask = splineMaskAt(xz);
  bw.desert = clamp(max(bw.desert, paintedBiome.r), 0.0, 1.0);
  bw.canyon = clamp(max(bw.canyon, max(paintedBiome.g, splineMask.r * (1.0 - splineMask.b))), 0.0, 1.0);
  bw.wetland = clamp(max(bw.wetland, max(paintedBiome.b, splineMask.r * splineMask.b)), 0.0, 1.0);
  bw.mountains = clamp(max(bw.mountains, paintedBiome.a), 0.0, 1.0);
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

  float eps = uEps;
  float hC, hX, hZ;
  vec3 nGeo;
  if (uInfiniteMode < 0.5 && uUseTerrainHeightTex > 0.5) {
    // Baked path: one fetch covers height + geometric normal, two more cover
    // the neighbour heights used by the concavity AO term — versus three full
    // ~46-octave evaluations. Branch is on a uniform, so it stays warp-coherent.
    vec2 uv = bakedUvAt(xz);
    float du = uEps / max(uBakeSpan.x, 1.0);
    vec4 hT = texture2D(uTerrainHeightTex, uv);
    hC = hT.a * uHeightScale;
    nGeo = normalize(hT.rgb * 2.0 - 1.0);
    hX = texture2D(uTerrainHeightTex, uv + vec2(du, 0.0)).a * uHeightScale;
    hZ = texture2D(uTerrainHeightTex, uv + vec2(0.0, du)).a * uHeightScale;
  } else
  {
    hC = heightAt(xz);
    hX = heightAt(xz + vec2(eps, 0.0));
    hZ = heightAt(xz + vec2(0.0, eps));
    nGeo = normalize(vec3(-(hX - hC) / eps, 1.0, -(hZ - hC) / eps));
  }

  if (uTileDebugView > 0.5) {
    float h01 = clamp(hC / max(uHeightScale, 1e-3), 0.0, 1.0);
    if (uTileDebugView < 1.5) {
      float n = stackHeight2D(xz, cl);
      if (uInfiniteMode < 0.5 && uImportNoiseMode > 1.5) {
        float importedNoise = importedMapValue(uImportNoiseTex, tileUvAt(xz)) * uAmplitude;
        n = (uImportNoiseMode > 2.5) ? mix(n, importedNoise, uImportNoiseBlend) : importedNoise;
      }
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

  TerrainColorResult tc = computeTerrainAlbedo(cl, bw, hC, hRel, h01, slope, detail, jitter, vnoise(xz * 0.9));
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

  // Geo-aligned OpenTopoMap (or file) imagery — same UV region as the real-world
  // height import. Applied after surface materials so the map reads as true albedo.
  if (uInfiniteMode < 0.5 && uImportImageryMode > 1.5) {
    vec2 iuv = importHeightUvAt(xz);
    if (iuv.x >= 0.0 && iuv.x <= 1.0 && iuv.y >= 0.0 && iuv.y <= 1.0) {
      vec3 mapCol = texture2D(uImportImageryTex, clamp(iuv, 0.0, 1.0)).rgb;
      td.albedo = (uImportImageryMode > 2.5)
        ? mix(td.albedo, mapCol, uImportImageryBlend)
        : mapCol;
    }
  }

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
  col = applyTerrainCaustics(col, xz, hC, nGeo, n);

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

  // Skirts darken to read as a recessed crack filler — except in circle mode,
  // where they exist purely to plug LOD T-junctions and must stay terrain-toned.
  float skirtDarken = vSkirt * 0.55;
  if (uInfiniteMode < 0.5 && uTileShape > 0.5) skirtDarken = 0.0;
  col *= 1.0 - skirtDarken;

  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

  col = pow(col, vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}
`;

// Minimal boot fragment: height + a simple height/slope-banded colour + sun +
// fog only. It skips the palette/colour, surface-texture, terrain-detail and
// caustic blocks — the dominant cost of the full fragment's synchronous
// GLSL→HLSL translation on Windows/ANGLE (the multi-second tab freeze). Used
// for the first Tile paint; the live material's source is then swapped in place
// (rebuildTerrainShaderSource) for an instant program-cache hit.
const buildMinimalFragment = () => /* glsl */ `
precision highp float;

${COMMON_UNIFORMS_GLSL}
${TERRAIN_HEIGHT_TEX_GLSL}
${PALETTE_UNIFORMS_GLSL}

uniform float uColorMode;
uniform float uEps;
uniform vec3  uPlinthColor;

varying vec3  vWorldPos;
varying float vSkirt;
varying float vWall;
varying float vWallMesh;

void main() {
  vec2 xz = vWorldPos.xz;

  if (uInfiniteMode < 0.5 && uTileShape > 0.5 && vWallMesh < 0.5 && tileOccupiedAt(xz) < 0.5) discard;

  float hC;
  vec3 nGeo;
  if (uInfiniteMode < 0.5 && uUseTerrainHeightTex > 0.5) {
    vec4 hT = texture2D(uTerrainHeightTex, bakedUvAt(xz));
    hC = hT.a * uHeightScale;
    nGeo = normalize(hT.rgb * 2.0 - 1.0);
  } else
  {
    hC = vWorldPos.y;
    nGeo = vec3(0.0, 1.0, 0.0);
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
  float hRel = hC - uSeaLevel;

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

  vec3 n = normalize(vec3(nGeo.x, 1.0, nGeo.z));
  float diff = max(dot(n, uSunDir), 0.0);
  vec3 col = albedo * (uTerrainSunCol * uTerrainSunIntensity * diff
                       + uTerrainSkyAmb * 0.5 + uTerrainBounce * 0.25);

  col *= 1.0 - vSkirt * 0.55;

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
    // Underwater caustics (shared by every terrain material — studio/infinite
    // declare + use them; the planet material harmlessly ignores them). Default
    // off; the engine raises uCausticBlend with camera submersion each frame.
    uCausticStrength: { value: 0.0 },
    uCausticBlend:    { value: 0.0 },
    uCausticScale:    { value: 1.0 },
    uCausticSpeed:    { value: 1.0 },
    uCausticColor:    { value: new THREE.Vector3(0.85, 0.95, 1.0) },
    uCausticDepthFade:{ value: 70.0 },
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
    uSplineEnabled: { value: 0.0 },
    uSplineResolution: { value: 512.0 },
    uSplineOrigin: { value: new THREE.Vector2(-1024, -1024) },
    uSplineSpan: { value: new THREE.Vector2(2048, 2048) },
    uSplineHeightTexture: { value: null },
    uSplineMaskTexture: { value: null },
    uSplineAuxTexture: { value: null },
    // Planet-mode baked height/normal cubemap (shared by the planet terrain +
    // water shaders). When uUsePlanetHeightTex is 1, those shaders sample this
    // texture instead of re-evaluating the ~46-octave height field per pixel.
    // Ignored by the studio/infinite materials, which never declare them.
    uPlanetHeightTex:    { value: null },
    uUsePlanetHeightTex: { value: 0.0 },

    // Studio-mode baked height/normal texture (shared by the studio terrain +
    // water shaders). When uUseTerrainHeightTex is 1, those shaders sample this
    // 2D texture instead of re-evaluating the height field per pixel. The shared
    // Tile/Infinite program always declares it; uInfiniteMode keeps unbounded
    // terrain on the procedural path.
    uTerrainHeightTex:    { value: null },
    uUseTerrainHeightTex: { value: 0.0 },
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
    uSurfNormal:     { value: surfFallbackTexture() },
    uSurfRough:      { value: surfFallbackTexture() },
    uSurfAO:         { value: surfFallbackTexture() },
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

export function createTerrainMaterial(uniforms, octaves = 7, stackGLSL = DEFAULT_STACK_GLSL) {
  const h = buildHeightGLSL(stackGLSL.body2d);
  return new THREE.ShaderMaterial({
    uniforms,
    defines: { OCTAVES: octaves },
    vertexShader: buildVertex(h),
    fragmentShader: buildFragment(h),
    side: THREE.DoubleSide,
  });
}

export function createInfiniteTerrainMaterial(uniforms, octaves = 7, stackGLSL = DEFAULT_STACK_GLSL) {
  // A distinct material object keeps mode ownership/disposal simple, while the
  // identical source + defines let Three.js reuse Tile's compiled GPU program.
  return createTerrainMaterial(uniforms, octaves, stackGLSL);
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
    vertexShader: buildVertex(h),
    fragmentShader: buildMinimalFragment(h),
    side: THREE.DoubleSide,
  });
  mat.userData.minimalFragment = true;
  return mat;
}

// Update a live terrain material's shader source to a new generated stack
// in place (same material object → every mesh referencing it updates). The
// program for the identical source was warm-compiled first, so the relink is
// served from three's cache.
export function rebuildTerrainShaderSource(mat, stackGLSL) {
  const h = buildHeightGLSL(stackGLSL.body2d);
  mat.vertexShader = buildVertex(h);
  mat.fragmentShader = buildFragment(h);
  mat.userData.minimalFragment = false;   // boot materials upgrade to the full fragment here
  mat.needsUpdate = true;
}

// Node authoring keeps the inexpensive palette-based fragment while swapping
// only the generated height source. This preserves a correct live 3D preview
// without paying for the full surface/detail fragment after every graph edit.
export function rebuildTerrainPreviewShaderSource(mat, stackGLSL) {
  const h = buildHeightGLSL(stackGLSL.body2d);
  mat.vertexShader = buildVertex(h);
  mat.fragmentShader = buildMinimalFragment();
  mat.userData.minimalFragment = true;
  mat.needsUpdate = true;
}
