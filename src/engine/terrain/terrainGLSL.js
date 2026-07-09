// ============================================================================
// Shared GLSL: uniforms, hash/noise primitives, FBM stacks and the height
// field. Included by both the terrain material and the water material so
// every consumer evaluates the exact same deterministic height function.
// ============================================================================

import { NOISE_STACK_PRIMS2D_GLSL } from './noise/noisePrimsGLSL.js';
import { NOISE_STACK_MASKS2D_GLSL } from './noise/masks.js';

export const COMMON_UNIFORMS_GLSL = /* glsl */ `
uniform vec2  uSeedOffset;     // deterministic domain offset derived from seed
uniform float uFrequency;      // base noise frequency (1/world units)
uniform float uHeightScale;    // world-space height of h01 == 1.0
uniform float uSeaLevel;       // world-space water height
uniform float uAmplitude;      // overall noise strength multiplier
uniform float uStackNormalize; // 0 = legacy clamp, 1 = remap by output min/max
uniform float uStackOutMin;    // raw stack height mapped to 0 when normalized
uniform float uStackOutMax;    // raw stack height mapped to 1 when normalized
uniform float uTerrainSmoothing; // spatial low-pass blend for rounded hills
uniform float uPersistence;    // FBM gain
uniform float uLacunarity;     // FBM frequency multiplier
uniform float uRidge;          // ridged-mountain intensity
uniform float uWarp;           // domain warp strength
uniform float uFalloff;        // edge falloff width (0..1)
uniform float uEdgeFalloffMode; // 0 island, 1 mountains
uniform float uBoardHalf;      // half board size in world units
uniform float uChunkSize;      // internal chunk size in world units
uniform vec3  uSunDir;         // normalized, pointing FROM surface TO sun
uniform vec3  uFogColor;
uniform float uFogDensity;
uniform float uTime;
uniform float uPaintEnabled;
uniform float uPaintOpacity;
uniform float uPaintBoardSize;
uniform float uPaintResolution;
uniform float uPaintBaseMult; // scales ONLY the procedural base term in heightAt() (0 = Empty Terrain)
uniform sampler2D uPaintHeightTexture;
uniform sampler2D uPaintBiomeTexture;
uniform sampler2D uPaintPropsTexture;
uniform float uSplineEnabled;
uniform float uSplineResolution;
uniform vec2 uSplineOrigin;
uniform vec2 uSplineSpan;
uniform sampler2D uSplineHeightTexture;
uniform sampler2D uSplineMaskTexture;
uniform sampler2D uSplineAuxTexture;

// --- Noise Stack: per-layer continuous params (declared once, used by the
// codegen-injected stackHeight2D / stackHeight3D). MUST match MAX_LAYERS in
// src/engine/terrain/noise/NoiseStack.js.
#define MAX_NOISE_LAYERS 12
uniform float uLayerStrength[MAX_NOISE_LAYERS]; // strength * opacity (and solo gate)
uniform float uLayerScale[MAX_NOISE_LAYERS];    // primary frequency lane
uniform float uLayerSeed[MAX_NOISE_LAYERS];     // per-layer domain decorrelation
uniform vec4  uLayerParamsA[MAX_NOISE_LAYERS];  // type-specific continuous lanes
uniform vec4  uLayerParamsB[MAX_NOISE_LAYERS];
uniform vec4  uLayerMaskA[MAX_NOISE_LAYERS];    // height mask (min,max,falloff,flags)
uniform vec4  uLayerMaskB[MAX_NOISE_LAYERS];    // noise mask (scale,threshold,soft,invert)
uniform vec4  uLayerMaskC[MAX_NOISE_LAYERS];    // slope mask (min,max,falloff,invert)
uniform float uNoiseDebug;                      // debug view selector (0 = off)
uniform float uTileDebugView;                   // 0 off, 1 noise, 2 height, 3 biome
uniform sampler2D uImportNoiseTex;
uniform sampler2D uImportHeightTex;
uniform sampler2D uImportBiomeTex;
uniform float uImportNoiseMode;                 // 0 disabled/preview, 2 replace, 3 blend
uniform float uImportHeightMode;
uniform float uImportBiomeMode;
uniform float uImportNoiseBlend;
uniform float uImportHeightBlend;
uniform float uImportHeightStrength;
uniform float uImportHeightOffset;
uniform float uImportBiomeBlend;

// Studio height bake region (world XZ). Single cell: origin=(-half,-half), span=boardSize.
uniform vec2 uBakeOrigin;
uniform vec2 uBakeSpan;

// Erosion height-offset field (studio / tile mode). The terrain height is fully
// analytic — there is no stored heightmap to carve — so erosion is expressed as
// an additive, world-space SIGNED height delta (eroded - base) over the bake
// region, sampled in heightAt() exactly like the paint offset. R = delta in
// world units. uErosionEnabled == 0 makes it a free no-op everywhere.
uniform sampler2D uErosionOffsetTex;
uniform float uErosionEnabled;

vec2 tileUvAt(vec2 xz) { return xz / (2.0 * uBoardHalf) + vec2(0.5); }
// World rect the imported HEIGHT map covers: (originX, originZ, spanX, spanZ).
// Defaults to the single origin cell (== tileUvAt) so plain image imports are
// unchanged; real-world imports widen it to the tile-assembly union so each
// cell shows its own geography instead of a clamped edge stretch.
uniform vec4 uImportHeightRegion;
vec2 importHeightUvAt(vec2 xz) { return (xz - uImportHeightRegion.xy) / uImportHeightRegion.zw; }
float importedMapValue(sampler2D tex, vec2 uv) {
  vec3 c = texture2D(tex, clamp(uv, 0.0, 1.0)).rgb;
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// --- Tile mode (multi-cell studio assembly) ---------------------------------
// When uUseTiles > 0.5 the studio board is a grid of square cells. A small
// occupancy texture (1 = occupied) drives an edge falloff that fades ONLY at
// the assembly's outer rim, so neighbouring cells meet seamlessly. A single
// tile is handled by the legacy origin-centred path (uUseTiles stays 0), which
// keeps that case byte-identical to before.
uniform sampler2D uTileOccupancy;   // R8, uTileGridDim cells, 1 = occupied
uniform vec2  uTileGridOrigin;      // world XZ of the min-cell corner (cell 0,0)
uniform vec2  uTileGridDim;         // grid size in cells (cols, rows)
uniform float uTileCellSize;        // one cell's world size (== single board)
uniform float uUseTiles;            // 0 = legacy single board, 1 = tile assembly
uniform float uTileShape;           // 0 = square, 1 = circle
uniform float uTileDiskRadius;      // world-space disk outer radius

float rimFalloff(float t) {
  t = clamp(t, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

float stackSoftClamp(float h) {
  if (h <= 0.0) return 0.0;
  if (h <= 1.0) return h;
  return min(1.35, 1.0 + 0.35 * (1.0 - exp(-(h - 1.0) / 0.35)));
}

float finalizeStackHeight(float h) {
  if (uStackNormalize < 0.5) return clamp(h, 0.0, 1.35);
  float outMin = uStackOutMin;
  float outMax = max(uStackOutMax, outMin + 0.0001);
  return stackSoftClamp((h - outMin) / (outMax - outMin));
}

// Hard disk clip: 1 inside the rendered disk, 0 outside. Pure visibility mask —
// it does NOT attenuate height, so it never produces a half-height boundary.
float diskMask(vec2 xz) {
  return step(length(xz), uTileDiskRadius);
}

// Inward island attenuation for the disk. 1 well inside the disk, fading to 0
// EXACTLY at the perimeter over a band whose width is uFalloff cell-widths, so
// the whole fade lives inside the boundary. uFalloff == 0 disables it entirely.
float diskIsland(vec2 xz) {
  float band = uFalloff * uTileCellSize;
  if (band <= 0.0) return 1.0;
  float t = clamp((uTileDiskRadius - length(xz)) / band, 0.0, 1.0);
  return rimFalloff(t);
}

float tileOccAt(vec2 cell) {
  if (cell.x < 0.0 || cell.y < 0.0 ||
      cell.x > uTileGridDim.x - 0.5 || cell.y > uTileGridDim.y - 0.5) return 0.0;
  vec2 uv = (cell + 0.5) / uTileGridDim;
  return step(0.5, texture2D(uTileOccupancy, uv).r);
}

// Per-cell, occupancy-aware island falloff. Each side fades toward its edge
// only when the neighbour across that edge is empty; a present neighbour keeps
// the factor at 1 across the shared edge so both cells meet at full height.
float tileFalloff(vec2 xz) {
  if (uFalloff <= 0.0) return 1.0;            // no edge attenuation
  vec2 rel = (xz - uTileGridOrigin) / uTileCellSize;
  vec2 cell = floor(rel);
  vec2 lc = (rel - cell) * 2.0 - 1.0;        // [-1,1] within the cell
  float band = uFalloff;
  float fXp = mix(smoothstep(0.0, band, 1.0 - lc.x), 1.0, tileOccAt(cell + vec2( 1.0, 0.0)));
  float fXn = mix(smoothstep(0.0, band, 1.0 + lc.x), 1.0, tileOccAt(cell + vec2(-1.0, 0.0)));
  float fZp = mix(smoothstep(0.0, band, 1.0 - lc.y), 1.0, tileOccAt(cell + vec2(0.0,  1.0)));
  float fZn = mix(smoothstep(0.0, band, 1.0 + lc.y), 1.0, tileOccAt(cell + vec2(0.0, -1.0)));
  return fXp * fXn * fZp * fZn;
}

// Vertex helper: classify a perimeter (skirt) position. A cell boundary where
// exactly one side is occupied is an OUTER edge -> becomes the diorama wall;
// a boundary between two occupied cells is an interior seam (no wall). Robust
// to the float ambiguity of points sitting exactly on a boundary by testing
// the occupancy of the two cells either side of the nearest grid line.
// Returns (onOuter, outDir.x, outDir.z) with outDir pointing toward empty space.
vec3 tileWall(vec2 xz) {
  vec2 rel = (xz - uTileGridOrigin) / uTileCellSize;
  float e = 2.0 / max(uTileCellSize, 1.0);   // ~1 world unit, in cell units
  float fx = floor(rel.x);
  float fz = floor(rel.y);
  // vertical boundary (constant X) at the nearest grid line
  float nx = floor(rel.x + 0.5);
  float onXB = step(abs(rel.x - nx), e);
  float occXL = tileOccAt(vec2(nx - 1.0, fz));
  float occXR = tileOccAt(vec2(nx, fz));
  float wallX = onXB * abs(occXL - occXR);
  // horizontal boundary (constant Z)
  float nz = floor(rel.y + 0.5);
  float onZB = step(abs(rel.y - nz), e);
  float occZD = tileOccAt(vec2(fx, nz - 1.0));
  float occZU = tileOccAt(vec2(fx, nz));
  float wallZ = onZB * abs(occZD - occZU);
  return vec3(wallX + wallZ, (occXL - occXR) * wallX, (occZD - occZU) * wallZ);
}

// 1 on a cell perimeter between two occupied cells (no wall).
float tileInteriorSeam(vec2 xz) {
  vec3 tw = tileWall(xz);
  if (tw.x > 0.5) return 0.0;
  vec2 rel = (xz - uTileGridOrigin) / uTileCellSize;
  vec2 lc = (rel - floor(rel)) * 2.0 - 1.0;
  float band = 2.0 / max(uTileCellSize, 1.0);
  return step(1.0 - band, max(abs(lc.x), abs(lc.y)));
}

// 1 when the world XZ lies inside an occupied tile cell.
float tileOccupiedAt(vec2 xz) {
  if (uUseTiles < 0.5) return 1.0;
  vec2 rel = (xz - uTileGridOrigin) / uTileCellSize;
  float occ = tileOccAt(floor(rel));
  if (uTileShape > 0.5) occ *= diskMask(xz);
  return occ;
}

// Inward island attenuation for the whole assembly (square per-cell rim or the
// circular disk profile). Clipping/visibility is handled separately by
// tileOccupiedAt / diskMask, so this never causes a half-height boundary.
float assemblyFalloff(vec2 xz) {
  float squareFalloff = tileFalloff(xz);
  float circleFalloff = diskIsland(xz);
  return mix(squareFalloff, circleFalloff, step(0.5, uTileShape));
}
`;

// Baked studio height/normal texture sampling. Studio terrain + water fragment
// shaders include this so they can replace the per-pixel ~46-octave height
// field with a single texture2D fetch when the engine's bake is active. Gated
// to non-infinite materials (the infinite world is unbounded — no fixed bake).
// Studio bake covers uBakeOrigin … uBakeOrigin+uBakeSpan in world XZ.
export const TERRAIN_HEIGHT_TEX_GLSL = /* glsl */ `
#ifndef INFINITE_MODE
uniform sampler2D uTerrainHeightTex;
uniform float uUseTerrainHeightTex;   // 1 = sample the baked texture, 0 = live field
vec2 bakedUvAt(vec2 xz) { return (xz - uBakeOrigin) / max(uBakeSpan, vec2(1.0)); }
float bakedHeightAt(vec2 xz) {
  return texture2D(uTerrainHeightTex, bakedUvAt(xz)).a * uHeightScale;
}
#endif
`;

export const NOISE_GLSL = /* glsl */ `
// --- hash without sine precision issues (Dave Hoskins) -----------------------
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// --- quintic value noise -----------------------------------------------------
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

const mat2 ROT2 = mat2(0.80, -0.60, 0.60, 0.80);

// NOTE: all loop bounds are compile-time constants (OCTAVES is a #define
// injected by the material). Dynamic trip counts / breaks make ANGLE's
// D3D11 shader compiler hang while trying to unroll, so avoid them here.

// --- standard FBM at full octave count (rolling hills / plains) --------------
float fbm(vec2 p) {
  float amp = 0.5;
  float sum = 0.0;
  float norm = 0.0;
  for (int i = 0; i < OCTAVES; i++) {
    sum += amp * vnoise(p);
    norm += amp;
    amp *= uPersistence;
    p = ROT2 * p * uLacunarity;
  }
  return sum / max(norm, 1e-4);
}

// --- low-cost 4-octave FBM (domain warp, masks, moisture) --------------------
float fbm4(vec2 p) {
  float amp = 0.5;
  float sum = 0.0;
  float norm = 0.0;
  for (int i = 0; i < 4; i++) {
    sum += amp * vnoise(p);
    norm += amp;
    amp *= uPersistence;
    p = ROT2 * p * uLacunarity;
  }
  return sum / max(norm, 1e-4);
}

// --- ridged multifractal (mountain chains) -----------------------------------
float ridgedFBM(vec2 p) {
  float amp = 0.5;
  float sum = 0.0;
  float norm = 0.0;
  float carry = 1.0;
  for (int i = 0; i < OCTAVES; i++) {
    float v = 1.0 - abs(vnoise(p) * 2.0 - 1.0);
    v = v * v;
    sum += amp * v * carry;     // spectral weighting: detail follows ridges
    carry = clamp(v * 1.4, 0.0, 1.0);
    norm += amp;
    amp *= uPersistence;
    p = ROT2 * p * uLacunarity;
  }
  return sum / max(norm, 1e-4);
}
`;

// ============================================================================
// The terrain height field. Pure function of world XZ + uniforms — fully
// deterministic for a given seed, never influenced by the camera.
//
// The actual stack of noise layers (stackHeight2D) is GENERATED from the live
// NoiseStack by noiseStackCodegen.generateStackGLSL() and injected here via
// buildHeightGLSL(stackBody2D). The default stack is a single `legacy` layer
// whose noise is legacyShape2D() — the original biome-coupled recipe — so
// default projects render bit-identically to before.
//
// Requires BIOME_GLSL (Climate / BiomeWeights / biomeWeightsAt) to be included
// first, and NOISE_GLSL (vnoise / fbm / fbm4 / ridgedFBM / ROT2).
// ============================================================================

// Build the full height GLSL block for a generated 2D stack body. The body is a
// sequence of per-layer blocks that read pw/h and the uLayer* uniform arrays.
export function buildHeightGLSL(stackBody2D) {
  return /* glsl */ `
${NOISE_STACK_PRIMS2D_GLSL}
${NOISE_STACK_MASKS2D_GLSL}

// Canyon/badlands strata: smooth terrace steps. C1-smooth so normals stay
// clean. Used by the legacy recipe and the Terrace modifier layer.
float terrace(float h, float steps) {
  float t = h * steps;
  float s = smoothstep(0.20, 0.80, fract(t));
  return (floor(t) + s) / steps;
}

// The original biome-coupled recipe (layers 1-6), returning h in ~0..1.35
// BEFORE island falloff and the uHeightScale multiply (the wrapper applies
// those to the whole stack). This is the legacy noise type.
float legacyShape2D(vec2 xz, Climate c) {
  vec2 p = xz * uFrequency + uSeedOffset;
  BiomeWeights bw = biomeWeightsAt(c);

  // layer 1: domain warp (canyons reduce warp so strata stay crisp)
  vec2 w = vec2(
    fbm4(p + vec2(13.7, 41.3)),
    fbm4(p + vec2(87.2,  9.1))
  );
  vec2 q = p + (w - 0.5) * uWarp * (1.0 - bw.canyon * 0.5);

  // layer 2: rolling base terrain, amplitude shaped per biome
  float base = fbm(q);
  float baseAmp = 0.30 * (1.0 - bw.desert * 0.45) * (1.0 - bw.wetland * 0.75);
  float h = base * baseAmp + 0.06;

  // layer 3: desert dunes — anisotropic ridge pattern, gentle amplitude
  float dune = 1.0 - abs(vnoise(vec2(q.x * 2.2 + q.y * 0.4, q.y * 0.8) + vec2(311.7, 89.1)) * 2.0 - 1.0);
  h += dune * dune * 0.05 * bw.desert;

  // layer 4: ridged mountain chains — chain noise picks WHERE within a
  // mountain-friendly climate; deserts and wetlands suppress them
  float ridge = ridgedFBM(q * 1.7 + vec2(31.4, 27.2));
  float smoothAmt = clamp(uTerrainSmoothing, 0.0, 1.0);
  float ridgeNeedle = pow(ridge, 1.35);
  float ridgeRounded = pow(ridge, 0.62) * 0.58;
  float ridgeShape = mix(ridgeNeedle, ridgeRounded, smoothAmt);
  float chain = smoothstep(0.34, 0.66, fbm4(q * 0.35 + vec2(5.1, 17.7)));
  float mountains = chain * mix(0.35, 1.0, bw.mountains)
                  * (1.0 - bw.desert * 0.85)
                  * (1.0 - bw.wetland);
  h += ridgeShape * mountains * uRidge * mix(1.15, 0.82, smoothAmt);

  // layer 5: wetlands settle just above sea level (after amplitude so they
  // land at the true water line)
  float sea01 = uSeaLevel / max(uHeightScale, 1.0);
  h = mix(h, sea01 + 0.012 + base * 0.03, bw.wetland * 0.85);

  // layer 6: canyon/badlands strata terracing
  h = mix(h, terrace(h, 14.0), bw.canyon * 0.75);

  return h;
}

// Codegen-injected noise stack. Accumulates h from the ordered layers; pw is
// the (possibly domain-warped) noise-domain coordinate shared by all layers.
// uAmplitude acts as a master strength multiplier for the entire stack.
float stackHeight2D(vec2 xz, Climate c) {
  vec2 pw = xz * uFrequency + uSeedOffset;
  float h = 0.0;
${stackBody2D}
  return h * uAmplitude;
}

float smoothedStackHeight2D(vec2 xz, Climate c) {
  float h = stackHeight2D(xz, c);
  float amt = clamp(uTerrainSmoothing, 0.0, 1.0);
  if (amt <= 0.0001) return h;

  float t = clamp(h / 1.35, 0.0, 1.0);
  float peakStart = 0.42;
  float peak = max(t - peakStart, 0.0);
  float peakMask = smoothstep(peakStart, 0.72, t);
  float compressed = peakStart + peak / (1.0 + amt * 3.2 * peak / (1.0 - peakStart));
  return mix(h, compressed * 1.35, peakMask * amt);
}

// Finalize: island falloff (studio board only) + clamp + world height scale.
float shapeHeight(vec2 xz, Climate c) {
  float proceduralH = smoothedStackHeight2D(xz, c);
  float h = proceduralH;
#ifndef INFINITE_MODE
  if (uImportNoiseMode > 1.5) {
    float importedNoise = importedMapValue(uImportNoiseTex, tileUvAt(xz)) * uAmplitude;
    h = (uImportNoiseMode > 2.5) ? mix(proceduralH, importedNoise, uImportNoiseBlend) : importedNoise;
  }
#endif
#ifndef INFINITE_MODE
  // rim == 1 means the terrain is unaffected at this point (full height).
  // uFalloff == 0 -> rim is 1 everywhere -> no island attenuation, no edge noise.
  float rim = 1.0;
  if (uUseTiles > 0.5) {
    // multi-cell assembly: affect only the outer rim (seamless interiors)
    rim = assemblyFalloff(xz);
  } else if (uFalloff > 0.0) {
    // island/continent falloff toward board edges (square+radial blend). The
    // fade lives entirely inside the boundary: rim hits 0 exactly at the edge.
    vec2 e = abs(xz) / uBoardHalf;
    float edge = mix(max(e.x, e.y), length(e) * 0.7071, 0.5);
    float t = clamp((1.0 - edge) / uFalloff, 0.0, 1.0);
    rim = rimFalloff(t);
  }
  if (uEdgeFalloffMode < 0.5) {
    h *= rim;
  } else {
    // Mountain edges preserve the existing terrain and add a noisy ridged
    // perimeter. uFalloff controls BOTH the band width (via rim) and the noise
    // amplitude, so a small value (0.05) is a subtle rim, not full-height peaks.
    float edgeMask = 1.0 - rim;
    vec2 edgeP = xz * uFrequency + uSeedOffset + vec2(173.7, 419.2);
    float edgeMountains = pow(ridgedFBM(edgeP * 2.35), 1.25);
    float edgeBreakup = vnoise(edgeP * 5.1 + vec2(61.4, 27.8));
    h += (edgeMountains * 0.55 + edgeBreakup * 0.12) * edgeMask * uAmplitude * clamp(uFalloff, 0.0, 1.0);
  }
#endif
  float finalH = finalizeStackHeight(h) * uHeightScale;
#ifndef INFINITE_MODE
  if (uImportHeightMode > 1.5) {
    float importedH = importedMapValue(uImportHeightTex, importHeightUvAt(xz)) * uHeightScale * uImportHeightStrength + uImportHeightOffset;
    finalH = (uImportHeightMode > 2.5) ? mix(finalH, importedH, uImportHeightBlend) : importedH;
  }
#endif
  return finalH;
}

vec2 paintUvAt(vec2 xz) {
  return xz / max(uPaintBoardSize, 1.0) + vec2(0.5);
}

float paintHeightOffsetAt(vec2 xz) {
  if (uPaintEnabled < 0.5) return 0.0;
  vec2 uv = paintUvAt(xz);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  // R already carries the signed world-unit delta (HalfFloat texture) — no
  // fixed-range decode needed, matching erosionOffsetAt's convention.
  return texture2D(uPaintHeightTexture, uv).r * uPaintOpacity;
}

vec4 paintBiomeAt(vec2 xz) {
  if (uPaintEnabled < 0.5) return vec4(0.0);
  vec2 uv = paintUvAt(xz);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  return texture2D(uPaintBiomeTexture, uv) * uPaintOpacity;
}

vec2 splineUvAt(vec2 xz) { return (xz - uSplineOrigin) / max(uSplineSpan, vec2(1.0)); }
float splineHeightOffsetAt(vec2 xz) {
  if (uSplineEnabled < .5) return 0.0;
  vec2 uv = splineUvAt(xz);
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
  return texture2D(uSplineHeightTexture, uv).r;
}
vec4 splineMaskAt(vec2 xz) {
  if (uSplineEnabled < .5) return vec4(0.0);
  vec2 uv = splineUvAt(xz);
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(0.0);
  return texture2D(uSplineMaskTexture, uv);
}

// Erosion height offset: signed world-unit delta added on top of the analytic
// field, sampled over the studio bake region [uBakeOrigin, +uBakeSpan]. Mirrors
// the paint-offset path; free and zero when disabled or outside the region. The
// base field is never mutated, so erosion stays fully non-destructive.
float erosionOffsetAt(vec2 xz) {
  if (uErosionEnabled < 0.5) return 0.0;
  vec2 uv = (xz - uBakeOrigin) / max(uBakeSpan, vec2(1.0));
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
  return texture2D(uErosionOffsetTex, uv).r;
}

float heightAt(vec2 xz) {
  return shapeHeight(xz, climateAt(xz * uFrequency + uSeedOffset)) * uPaintBaseMult
    + paintHeightOffsetAt(xz) + splineHeightOffsetAt(xz) + erosionOffsetAt(xz);
}

// Moisture field for biome blending — now sourced from the climate system.
float moistureAt(vec2 xz) {
  return climateAt(xz * uFrequency + uSeedOffset).moist;
}
`;
}
