import * as THREE from 'three';
import { COMMON_UNIFORMS_GLSL, NOISE_GLSL, buildHeightGLSL, TERRAIN_HEIGHT_TEX_GLSL } from './terrainGLSL.js';
import { BIOME_GLSL } from './biomeGLSL.js';
import { generateStackGLSL } from './noise/noiseStackCodegen.js';
import { defaultLegacyStack, MAX_LAYERS } from './noise/NoiseStack.js';
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

varying vec3  vWorldPos;
varying float vLod;
varying float vSkirt;
varying float vWall;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float h = heightAt(wp.xz);

  float skirt = aSkirt;
  float wall = 0.0;   // outer-perimeter skirt -> plinth wall
  #ifndef INFINITE_MODE
    if (uUseTiles > 0.5) {
      // multi-cell assembly: only skirts on a cell edge facing empty space
      // become the plinth wall; interior seams between two tiles stay terrain.
      vec3 tw = tileWall(wp.xz);
      if (uTileShape > 0.5) tw = vec3(diskWall(wp.xz), normalize(wp.xz + vec2(1e-5)));
      float onOuter = step(0.5, tw.x);
      float interiorSeam = (uTileShape > 0.5) ? 0.0 : tileInteriorSeam(wp.xz);
      skirt = aSkirt * (1.0 - interiorSeam);
      wall = aSkirt * onOuter;
      skirt *= 1.0 - onOuter;
      wp.xz += tw.yz * (wall * uWallThickness);
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
  #endif

  // interior skirt drops by uSkirtDepth; the perimeter wall drops all the way to
  // the plinth base so the terrain's own edge masks the under-the-map view at
  // whatever LOD the border chunks are rendered at.
  wp.y = mix(h - skirt * uSkirtDepth, uPlinthBaseY, wall);

  vWorldPos = wp.xyz;
  vLod = aLod;
  vSkirt = max(skirt, wall);
  vWall = wall;

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

uniform float uNormalStrength;
uniform float uAO;
uniform float uGrid;
uniform float uLodDebug;
uniform float uColorMode;
uniform float uEps;
uniform vec3  uPlinthColor;

varying vec3  vWorldPos;
varying float vLod;
varying float vSkirt;
varying float vWall;

const vec3 LOD_COLORS[4] = vec3[4](
  vec3(0.90, 0.28, 0.30),
  vec3(0.96, 0.65, 0.14),
  vec3(0.96, 0.85, 0.04),
  vec3(0.23, 0.51, 0.96)
);

void main() {
  vec2 xz = vWorldPos.xz;

#ifndef INFINITE_MODE
  // Circular assemblies still use square chunk meshes. Remove every fragment
  // outside the disk so the original board cannot show through at zero height.
  if (uTileShape > 0.5 && tileOccupiedAt(xz) < 0.5) discard;
#endif

  Climate cl = climateAt(xz * uFrequency + uSeedOffset);
  BiomeWeights bw = biomeWeightsAt(cl);
  vec4 paintedBiome = paintBiomeAt(xz);
  bw.desert = clamp(max(bw.desert, paintedBiome.r), 0.0, 1.0);
  bw.canyon = clamp(max(bw.canyon, paintedBiome.g), 0.0, 1.0);
  bw.wetland = clamp(max(bw.wetland, paintedBiome.b), 0.0, 1.0);
  bw.mountains = clamp(max(bw.mountains, paintedBiome.a), 0.0, 1.0);
#ifndef INFINITE_MODE
  if (uImportBiomeMode > 1.5) {
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
#endif

  float eps = uEps;
  float hC, hX, hZ;
  vec3 nGeo;
#ifndef INFINITE_MODE
  if (uUseTerrainHeightTex > 0.5) {
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
#endif
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
#ifndef INFINITE_MODE
      if (uImportNoiseMode > 1.5) {
        float importedNoise = importedMapValue(uImportNoiseTex, tileUvAt(xz)) * uAmplitude;
        n = (uImportNoiseMode > 2.5) ? mix(n, importedNoise, uImportNoiseBlend) : importedNoise;
      }
#endif
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
    float h01 = clamp(hC / max(uHeightScale, 1e-3), 0.0, 1.0);
    if (uColorMode > 1.5) {
      // mode 2: 16-bit height packed into RG (player collision tile)
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
    float gridMul = 1.0;
#ifndef INFINITE_MODE
    if (uUseTiles > 0.5) gridMul = 1.0 - tileInteriorSeam(xz);
#endif
    col = mix(col, vec3(0.45, 0.80, 0.95), line * uGrid * 0.22 * (0.35 + 0.65 * gridFade) * gridMul);
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
    uEdgeFalloffMode:{ value: 0.0 },
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
    uGrid:           { value: 1.0 },
    uLodDebug:       { value: 0.0 },
    uColorMode:      { value: 0.0 },
    uEps:            { value: 0.6 },
    uSkirtDepth:     { value: 40 },
    uPlinthBaseY:    { value: -40 },
    uPlinthColor:    { value: new THREE.Color(0x14110d) },
    uWallThickness:  { value: 12 },
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
    uPaintHeightRange: { value: 180 },
    uPaintHeightTexture: { value: null },
    uPaintBiomeTexture: { value: null },
    // Planet-mode baked height/normal cubemap (shared by the planet terrain +
    // water shaders). When uUsePlanetHeightTex is 1, those shaders sample this
    // texture instead of re-evaluating the ~46-octave height field per pixel.
    // Ignored by the studio/infinite materials, which never declare them.
    uPlanetHeightTex:    { value: null },
    uUsePlanetHeightTex: { value: 0.0 },

    // Studio-mode baked height/normal texture (shared by the studio terrain +
    // water shaders). When uUseTerrainHeightTex is 1, those shaders sample this
    // 2D texture instead of re-evaluating the height field per pixel. Declared
    // only by the non-infinite materials (TERRAIN_HEIGHT_TEX_GLSL).
    uTerrainHeightTex:    { value: null },
    uUseTerrainHeightTex: { value: 0.0 },
    uBakeOrigin:          { value: new THREE.Vector2(-1024, -1024) },
    uBakeSpan:            { value: new THREE.Vector2(2048, 2048) },

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
    uNoiseDebug:     { value: 0.0 },
    uTileDebugView:  { value: 0.0 },
    uImportNoiseTex: { value: null },
    uImportHeightTex:{ value: null },
    uImportBiomeTex: { value: null },
    uImportNoiseMode:{ value: 0.0 },
    uImportHeightMode:{ value: 0.0 },
    uImportBiomeMode:{ value: 0.0 },
    uImportNoiseBlend:{ value: 1.0 },
    uImportHeightBlend:{ value: 1.0 },
    uImportHeightStrength:{ value: 1.0 },
    uImportHeightOffset:{ value: 0.0 },
    uImportBiomeBlend:{ value: 1.0 },
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
  const h = buildHeightGLSL(stackGLSL.body2d);
  return new THREE.ShaderMaterial({
    uniforms,
    defines: { OCTAVES: octaves, INFINITE_MODE: 1 },
    vertexShader: buildVertex(h),
    fragmentShader: buildFragment(h),
    side: THREE.DoubleSide,
  });
}

// Update a live terrain material's shader source to a new generated stack
// in place (same material object → every mesh referencing it updates). The
// program for the identical source was warm-compiled first, so the relink is
// served from three's cache.
export function rebuildTerrainShaderSource(mat, stackGLSL) {
  const h = buildHeightGLSL(stackGLSL.body2d);
  mat.vertexShader = buildVertex(h);
  mat.fragmentShader = buildFragment(h);
  mat.needsUpdate = true;
}
