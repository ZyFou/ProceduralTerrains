import * as THREE from 'three';
import { hashInt, macroDensity, shouldPlaceType } from './PropPlacement.js';
import {
  ALIGN, PROP_TYPES, flowerTint, grassTint, terrainRockTint, treeTint,
} from './propCatalog.js';
import { createWindUniforms } from './windGLSL.js';
import { makeWindMaterial } from './GrassMaterial.js';
import {
  enabledAssetsForType,
  normalizePropAsset,
  normalizePropAssetLibrary,
  propAssetColorRGB,
  selectPropAsset,
} from './PropAssetLibrary.js';
import {
  createImportedModelObject,
  disposeImportedModelParts,
  loadImportedPropModel,
} from './ImportedPropModel.js';

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

export const PROP_QUALITY_BUDGETS = Object.freeze([
  Object.freeze({ grass: 900, flowers: 80, rocks: 180, trees: 440, distanceScale: 0.65, buildMs: 1.5, grassDistance: 140, nearDistance: 80 }),
  Object.freeze({ grass: 1800, flowers: 180, rocks: 320, trees: 900, distanceScale: 1, buildMs: 2.5, grassDistance: 220, nearDistance: 180 }),
  Object.freeze({ grass: 2800, flowers: 260, rocks: 480, trees: 1400, distanceScale: 1.15, buildMs: 3, grassDistance: 320, nearDistance: 280 }),
  Object.freeze({ grass: 5000, flowers: 450, rocks: 800, trees: 2500, distanceScale: 1.35, buildMs: 4, grassDistance: 480, nearDistance: 420 }),
]);

const ATLAS_GRID = 4;
const ATLAS_SIZE = 512;
const ATLAS_TILES = Object.freeze({ grass: 0, flower: 1, broadleaf: 2, conifer: 3, bark: 4 });

function atlasUv(tile, u, v) {
  const col = tile % ATLAS_GRID;
  const row = Math.floor(tile / ATLAS_GRID);
  const pad = 2 / (ATLAS_SIZE / ATLAS_GRID);
  return [
    (col + pad + u * (1 - pad * 2)) / ATLAS_GRID,
    (row + pad + v * (1 - pad * 2)) / ATLAS_GRID,
  ];
}

// One self-contained foliage atlas. It is generated deterministically once and
// uploaded as a normal mipmapped texture, so there are no external asset loads.
function makeFoliageAtlas() {
  const data = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
  const tileSize = ATLAS_SIZE / ATLAS_GRID;
  const setPixel = (tile, px, py, color, alpha) => {
    const col = tile % ATLAS_GRID;
    const row = Math.floor(tile / ATLAS_GRID);
    const x = col * tileSize + px;
    const y = row * tileSize + py;
    const i = (y * ATLAS_SIZE + x) * 4;
    data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2]; data[i + 3] = alpha;
  };
  const noise = (x, y, salt) => hashInt(x + salt * 13, y - salt * 7, salt * 97);

  for (let y = 0; y < tileSize; y++) {
    const v = y / (tileSize - 1);
    for (let x = 0; x < tileSize; x++) {
      const u = x / (tileSize - 1);
      // Give transparent texels a representative edge colour. Standard
      // mipmap generation averages RGB independently of alpha; leaving those
      // texels black turns thin blades and tree crowns into dark silhouettes
      // as soon as a lower mip is selected.
      setPixel(ATLAS_TILES.grass, x, y, [72, 138, 56], 0);
      setPixel(ATLAS_TILES.flower, x, y, [82, 145, 66], 0);
      setPixel(ATLAS_TILES.broadleaf, x, y, [82, 146, 72], 0);
      setPixel(ATLAS_TILES.conifer, x, y, [62, 116, 78], 0);
      // Grass card: several tapered blades with irregular lean.
      let grassAlpha = 0;
      for (let blade = 0; blade < 9; blade++) {
        const base = 0.08 + blade * 0.105;
        const height = 0.48 + noise(blade, 3, 1) * 0.5;
        if (v > height) continue;
        const t = v / height;
        const center = base + Math.sin(t * 2.4 + blade) * (0.025 + blade % 2 * 0.01);
        const width = (0.022 + noise(blade, 5, 2) * 0.018) * (1 - t * 0.9);
        if (Math.abs(u - center) < width) grassAlpha = 255;
      }
      if (grassAlpha) {
        const shade = 0.72 + v * 0.28 + noise(x, y, 3) * 0.08;
        setPixel(ATLAS_TILES.grass, x, y, [82 * shade, 156 * shade, 66 * shade], grassAlpha);
      }

      // Wildflower cluster: stems, leaves and a pale tintable flower head.
      const stem = Math.abs(u - 0.5 - Math.sin(v * 5) * 0.012) < 0.018 && v < 0.78;
      const leaf = v > 0.28 && v < 0.54 && Math.abs(u - (0.5 + (v - 0.4) * 1.2)) < 0.04;
      const dx = u - 0.5, dy = v - 0.82;
      const ang = Math.atan2(dy, dx) * 5;
      const petalR = 0.12 + Math.cos(ang) * 0.035;
      const flower = Math.hypot(dx, dy) < petalR;
      if (stem || leaf || flower) {
        const color = flower ? [250, 242, 221] : [78, 151, 63];
        setPixel(ATLAS_TILES.flower, x, y, color, 255);
      }

      // Broadleaf crown: ragged ellipse with small transparent gaps.
      const bx = (u - 0.5) / 0.47;
      const by = (v - 0.52) / 0.46;
      const broadEdge = bx * bx + by * by + (noise(x >> 2, y >> 2, 4) - 0.5) * 0.24;
      const broadHole = noise(x, y, 5) > 0.985 && broadEdge < 0.78;
      if (broadEdge < 1 && !broadHole) {
        const shade = 0.72 + v * 0.25 + noise(x >> 1, y >> 1, 6) * 0.16;
        setPixel(ATLAS_TILES.broadleaf, x, y, [91 * shade, 158 * shade, 79 * shade], 255);
      }

      // Conifer crown: three layered triangular branch tiers.
      let conifer = false;
      for (let layer = 0; layer < 3; layer++) {
        const y0 = 0.08 + layer * 0.23;
        const y1 = 0.62 + layer * 0.18;
        if (v >= y0 && v <= y1) {
          const t = (v - y0) / (y1 - y0);
          const half = (0.46 - layer * 0.08) * (1 - t);
          conifer ||= Math.abs(u - 0.5) < half;
        }
      }
      if (conifer && noise(x, y, 7) > 0.025) {
        const shade = 0.68 + v * 0.2 + noise(x >> 1, y >> 1, 8) * 0.12;
        setPixel(ATLAS_TILES.conifer, x, y, [68 * shade, 126 * shade, 84 * shade], 255);
      }

      const barkShade = 0.62 + noise(x >> 2, y, 9) * 0.28 + Math.sin(u * 44) * 0.08;
      setPixel(ATLAS_TILES.bark, x, y, [145 * barkShade, 106 * barkShade, 72 * barkShade], 255);
    }
  }

  const texture = new THREE.DataTexture(data, ATLAS_SIZE, ATLAS_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = 'procedural-props-foliage-atlas';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function geometryBuilder() {
  const positions = [], colors = [], bends = [], uvs = [], indices = [];
  const addVertex = (p, uv, bend, color = [1, 1, 1]) => {
    positions.push(p[0], p[1], p[2]);
    uvs.push(uv[0], uv[1]);
    bends.push(bend);
    colors.push(color[0], color[1], color[2]);
    return positions.length / 3 - 1;
  };
  const addQuad = (a, b, c, d, tile, bendBottom = 0, bendTop = 1, color = [1, 1, 1]) => {
    const i = positions.length / 3;
    addVertex(a, atlasUv(tile, 0, 0), bendBottom, color);
    addVertex(b, atlasUv(tile, 1, 0), bendBottom, color);
    addVertex(c, atlasUv(tile, 1, 1), bendTop, color);
    addVertex(d, atlasUv(tile, 0, 1), bendTop, color);
    indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  const finish = (name) => {
    const geometry = new THREE.BufferGeometry();
    geometry.name = name;
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('aBend', new THREE.Float32BufferAttribute(bends, 1));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  };
  return { addQuad, finish };
}

function addCard(builder, { angle = 0, width = 1, height = 1, y = 0, x = 0, z = 0, tile, bendBottom = 0, bendTop = 1 }) {
  const sx = Math.cos(angle) * width * 0.5;
  const sz = Math.sin(angle) * width * 0.5;
  builder.addQuad(
    [x - sx, y, z - sz], [x + sx, y, z + sz],
    [x + sx, y + height, z + sz], [x - sx, y + height, z - sz],
    tile, bendBottom, bendTop,
  );
}

function makeCardGeometry({ name, cards, tile, width = 1, height = 1 }) {
  const builder = geometryBuilder();
  for (let i = 0; i < cards; i++) {
    addCard(builder, { angle: (i / cards) * Math.PI, width, height, tile });
  }
  return builder.finish(name);
}

function addTrunk(builder, { height, bottomRadius, topRadius, segments = 6 }) {
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    builder.addQuad(
      [Math.cos(a0) * bottomRadius, 0, Math.sin(a0) * bottomRadius],
      [Math.cos(a1) * bottomRadius, 0, Math.sin(a1) * bottomRadius],
      [Math.cos(a1) * topRadius, height, Math.sin(a1) * topRadius],
      [Math.cos(a0) * topRadius, height, Math.sin(a0) * topRadius],
      ATLAS_TILES.bark, 0, 0.12,
    );
  }
}

function makeTreeGeometry(kind, far = false) {
  const tile = kind === 'conifer' ? ATLAS_TILES.conifer : ATLAS_TILES.broadleaf;
  if (far) return makeCardGeometry({ name: `${kind}-far`, cards: 2, tile, width: kind === 'conifer' ? 0.58 : 0.72, height: 1 });
  const builder = geometryBuilder();
  if (kind === 'conifer') {
    addTrunk(builder, { height: 0.78, bottomRadius: 0.045, topRadius: 0.018 });
    const layers = [
      { y: 0.18, h: 0.55, w: 0.62 }, { y: 0.38, h: 0.48, w: 0.49 }, { y: 0.57, h: 0.43, w: 0.36 },
    ];
    for (const layer of layers) {
      for (let i = 0; i < 3; i++) addCard(builder, { angle: i * Math.PI / 3, width: layer.w, height: layer.h, y: layer.y, tile, bendBottom: 0.22, bendTop: 0.72 });
    }
  } else {
    addTrunk(builder, { height: 0.64, bottomRadius: 0.06, topRadius: 0.025 });
    const crowns = [
      [-0.12, 0.43, 0.02, 0.56, 0.48], [0.14, 0.48, -0.05, 0.52, 0.46], [0, 0.55, 0.09, 0.62, 0.45],
    ];
    for (const [x, y, z, w, h] of crowns) {
      addCard(builder, { angle: 0.15, width: w, height: h, x, y, z, tile, bendBottom: 0.25, bendTop: 0.8 });
      addCard(builder, { angle: Math.PI * 0.5 + 0.15, width: w, height: h, x, y, z, tile, bendBottom: 0.25, bendTop: 0.8 });
    }
  }
  return builder.finish(`${kind}-near`);
}

function makeRockGeometry(detail, name) {
  const geometry = new THREE.IcosahedronGeometry(1, detail);
  geometry.name = name;
  const position = geometry.getAttribute('position');
  const colors = [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const warp = 0.84 + Math.sin(x * 4.9 + z * 2.7) * 0.1 + Math.cos(y * 6.1 - x * 2.2) * 0.06;
    position.setXYZ(i, x * warp, Math.max(-0.72, y * (0.82 + Math.sin(z * 3.8) * 0.08)), z * warp);
    const shade = clamp(0.68 + y * 0.17 + Math.sin(x * 8.1 + z * 5.7) * 0.09, 0.42, 1);
    colors.push(shade, shade * 0.98, shade * 0.92);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function configureCutoutMaterial(material, atlas, alphaTest = 0.42) {
  material.map = atlas;
  // Most foliage cards face sideways, so terrain lights alone can leave both
  // sides almost unlit in valleys. Reuse the atlas as a modest ambient albedo
  // term: the cutouts retain their authored colour while direct light still
  // provides the main contrast and the instance tint remains on the diffuse
  // contribution.
  if (material.emissive) {
    material.emissive.setHex(0xffffff);
    material.emissiveMap = atlas;
    material.emissiveIntensity = 0.48;
  }
  material.alphaTest = alphaTest;
  material.transparent = false;
  material.depthWrite = true;
  material.side = THREE.DoubleSide;
  material.needsUpdate = true;
  return material;
}

// Dithered fades keep foliage alpha-tested (depth-writing, no transparent
// sorting) while softening both LOD changes and the final cull boundary.
function configureDistanceFade(material) {
  const originalCompile = material.onBeforeCompile;
  const originalCacheKey = material.customProgramCacheKey?.bind(material);
  const fadeUniforms = {
    center: { value: new THREE.Vector3() },
    ranges: { value: new THREE.Vector4(0, 0, 1e6, 1e6 + 1) },
  };
  material.userData.propFadeUniforms = fadeUniforms;
  material.onBeforeCompile = (shader, renderer) => {
    originalCompile?.(shader, renderer);
    shader.uniforms.uPropFadeCenter = fadeUniforms.center;
    shader.uniforms.uPropFadeRanges = fadeUniforms.ranges;
    shader.vertexShader = `varying vec3 vPropWorldPosition;\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      `vec4 propWorldPosition = vec4(transformed, 1.0);
      #ifdef USE_BATCHING
        propWorldPosition = batchingMatrix * propWorldPosition;
      #endif
      #ifdef USE_INSTANCING
        propWorldPosition = instanceMatrix * propWorldPosition;
      #endif
      vPropWorldPosition = (modelMatrix * propWorldPosition).xyz;
      #include <project_vertex>`,
    );
    shader.fragmentShader = `
      uniform vec3 uPropFadeCenter;
      uniform vec4 uPropFadeRanges;
      varying vec3 vPropWorldPosition;
      float propDither(vec2 p) {
        return fract(52.9829189 * fract(dot(floor(p), vec2(0.06711056, 0.00583715))));
      }
    ${shader.fragmentShader}`.replace(
      '#include <alphatest_fragment>',
      `#include <alphatest_fragment>
      float propDistance = distance(vPropWorldPosition, uPropFadeCenter);
      float propFadeIn = uPropFadeRanges.y <= 0.0
        ? 1.0 : smoothstep(uPropFadeRanges.x, uPropFadeRanges.y, propDistance);
      float propFadeOut = 1.0 - smoothstep(
        uPropFadeRanges.z, uPropFadeRanges.w, propDistance
      );
      if (propDither(gl_FragCoord.xy) > propFadeIn * propFadeOut) discard;`,
    );
  };
  material.customProgramCacheKey = () => `${originalCacheKey?.() ?? material.type}:prop-distance-fade-v1`;
  return material;
}

function qualityIndex(perf) {
  if (Number.isFinite(Number(perf?.propQuality))) return clamp(Math.round(perf.propQuality), 0, 3);
  return { performance: 0, balanced: 1, high: 2, ultra: 3 }[perf?.preset] ?? 2;
}

export async function createPropAssetPreviewModel(rawAsset) {
  const asset = normalizePropAsset(rawAsset);
  if (asset.model) {
    const parts = await loadImportedPropModel(asset.model);
    const object = createImportedModelObject(parts, `prop-asset-preview-${asset.id}`);
    object.scale.set(asset.scale * asset.width, asset.scale * asset.height, asset.scale * asset.width);
    object.userData.disposePreview = () => disposeImportedModelParts(parts);
    return object;
  }
  const atlas = makeFoliageAtlas();
  let geometry;
  let material;
  if (asset.type === 'rock') {
    geometry = makeRockGeometry(1, `preview-${asset.id}`);
    material = new THREE.MeshStandardMaterial({
      color: asset.color, vertexColors: true, roughness: 0.92, metalness: 0,
    });
  } else {
    geometry = asset.type === 'grass'
      ? makeCardGeometry({ name: `preview-${asset.id}`, cards: 3, tile: ATLAS_TILES.grass, width: 1.1 })
      : asset.type === 'flower'
        ? makeCardGeometry({ name: `preview-${asset.id}`, cards: 2, tile: ATLAS_TILES.flower, width: 0.56 })
        : makeTreeGeometry(asset.type, false);
    material = configureCutoutMaterial(new THREE.MeshStandardMaterial({
      color: asset.color, roughness: 0.85, metalness: 0,
    }), atlas, asset.type === 'grass' || asset.type === 'flower' ? 0.42 : 0.46);
  }
  const object = new THREE.Mesh(geometry, material);
  object.name = `prop-asset-preview-${asset.id}`;
  object.scale.set(asset.scale * asset.width, asset.scale * asset.height, asset.scale * asset.width);
  object.userData.disposePreview = () => {
    geometry.dispose();
    material.dispose();
    atlas.dispose();
  };
  return object;
}

function emptyBuckets() {
  return { grass: [], flower: [], rock: [], broadleaf: [], conifer: [] };
}

export class ProceduralPropsManager {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'procedural-props';
    this.scene.add(this.group);

    this.atlas = makeFoliageAtlas();
    this.grassNearGeometry = makeCardGeometry({ name: 'grass-near', cards: 3, tile: ATLAS_TILES.grass, width: 1.1 });
    this.grassMidGeometry = makeCardGeometry({ name: 'grass-mid', cards: 2, tile: ATLAS_TILES.grass, width: 1.25 });
    this.flowerGeometry = makeCardGeometry({ name: 'flowers', cards: 2, tile: ATLAS_TILES.flower, width: 0.56 });
    this.rockNearGeometry = makeRockGeometry(1, 'rock-near'); // 80 triangles
    this.rockFarGeometry = makeRockGeometry(0, 'rock-far');  // 20 triangles
    this.broadleafNearGeometry = makeTreeGeometry('broadleaf', false);
    this.broadleafFarGeometry = makeTreeGeometry('broadleaf', true);
    this.coniferNearGeometry = makeTreeGeometry('conifer', false);
    this.coniferFarGeometry = makeTreeGeometry('conifer', true);

    this.windUniforms = createWindUniforms();
    this.grassNearMaterial = configureDistanceFade(configureCutoutMaterial(makeWindMaterial(this.windUniforms, { strengthMul: 1, name: 'grass-near' }), this.atlas));
    this.grassMidMaterial = configureDistanceFade(configureCutoutMaterial(makeWindMaterial(this.windUniforms, { strengthMul: 0.72, name: 'grass-mid' }), this.atlas));
    this.flowerMaterial = configureDistanceFade(configureCutoutMaterial(makeWindMaterial(this.windUniforms, { strengthMul: 0.62, name: 'flowers' }), this.atlas));
    this.treeMaterial = configureDistanceFade(configureCutoutMaterial(makeWindMaterial(this.windUniforms, { strengthMul: 0.18, name: 'trees' }), this.atlas, 0.46));
    // Rock vertex colours already bake a coarse face-to-face albedo variation;
    // an unlit base keeps distant boulders readable under every sky preset.
    this.rockMaterial = configureDistanceFade(new THREE.MeshBasicMaterial({
      vertexColors: true,
    }));

    this.meshes = [];
    this._meshPool = new Map();
    this._customModels = new Map();
    this._sectors = new Map();
    this._desiredSectors = new Set();
    this._buildQueue = [];
    this._queued = new Set();
    this._scatterKey = '';
    this._assetLibrarySource = null;
    this._normalizedAssets = [];
    this._assetLibraryRevision = 0;
    this._centerSectorKey = '';
    this._lastPaintRevision = -1;
    this._lastPlanetKey = '';
    this._planetBuildState = null;
    this._lastCenter = new THREE.Vector3(Infinity, Infinity, Infinity);
    this._sectorSize = 192;
    this._quality = 2;
    this._qualityBudget = PROP_QUALITY_BUDGETS[2];
    this._containsPoint = null;
    this._tmpMat = new THREE.Matrix4();
    this._tmpPos = new THREE.Vector3();
    this._tmpScale = new THREE.Vector3();
    this._qAlign = new THREE.Quaternion();
    this._qFull = new THREE.Quaternion();
    this._qYaw = new THREE.Quaternion();
    this._qIdentity = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);
    this._tmpNormal = new THREE.Vector3();
    this._tmpColor = new THREE.Color();
    this._centerScratch = new THREE.Vector3();
    this._planetCamDir = new THREE.Vector3();
    this._planetRef = new THREE.Vector3();
    this._planetT1 = new THREE.Vector3();
    this._planetT2 = new THREE.Vector3();
    this._planetDir = new THREE.Vector3();
    this._diagnostics = {
      instances: { grass: 0, flowers: 0, rocks: 0, trees: 0 },
      lod: {}, buildMs: 0, samples: 0, sectors: 0, queuedSectors: 0,
      cacheHits: 0, cacheMisses: 0, surfaceReadbacks: 0, triangles: 0, drawCalls: 0,
    };
    this._disposed = false;
  }

  update({
    mode, camera, params, perf = null, boardSize, sampler, planetSampler,
    paintLayers, splineRevision = -1, terrainRevision = -1, containsPoint = null,
    centerOverride = null, dirtyBounds = null,
  }) {
    const enabled = !!params.propsEnabled;
    this.group.visible = enabled;
    if (!enabled || !camera) return;
    const started = performance.now();
    this._quality = qualityIndex(perf);
    this._qualityBudget = PROP_QUALITY_BUDGETS[this._quality];
    this._sectorSize = clamp((params.chunkSize || 128) * 1.5, 128, 256);
    this._containsPoint = containsPoint;
    const center = this._resolveCenter(mode, camera, boardSize, centerOverride);
    const paintRevision = paintLayers?.revision ?? -1;
    if (params.propsAssets !== this._assetLibrarySource) {
      this._assetLibrarySource = params.propsAssets;
      this._normalizedAssets = normalizePropAssetLibrary(params.propsAssets);
      this._assetLibraryRevision++;
    }
    const assets = this._normalizedAssets;
    this._syncCustomModels(assets);
    this._assetsByType = Object.fromEntries(PROP_TYPES.map((desc) => [
      desc.id, enabledAssetsForType(assets, desc.id),
    ]));
    const scatterKey = [
      mode, params.seed, params.propsDensity, params.propsGrassDensity,
      params.propsGrass, params.propsFlowers, params.propsRocks, params.propsRockScale,
      params.propsTreeDensity, params.propsTreeScale, params.seaLevel, boardSize,
      this._assetLibraryRevision,
      splineRevision, terrainRevision,
    ].join('|');
    const structuralChanged = scatterKey !== this._scatterKey;
    const paintChanged = paintRevision !== this._lastPaintRevision;
    const scatterChanged = structuralChanged || (paintChanged && (!dirtyBounds || dirtyBounds.all));
    this._scatterKey = scatterKey;
    this._lastPaintRevision = paintRevision;

    if (!structuralChanged && paintChanged && dirtyBounds && !dirtyBounds.all && mode !== 'planet') {
      this._invalidateBounds(dirtyBounds);
    }

    if (mode === 'planet') {
      this._updatePlanet({ camera, center, params, planetSampler, scatterChanged });
    } else {
      this._updateFlat({ mode, center, params, sampler, scatterChanged, synchronous: !perf });
    }
    this._diagnostics.buildMs = performance.now() - started;
    this._diagnostics.surfaceReadbacks = sampler?.surfaceField?.readbackCount ?? sampler?.surfaceReadbacks ?? 0;
  }

  _syncCustomModels(assets) {
    const wanted = new Set();
    for (const asset of assets) {
      if (!asset.model) continue;
      wanted.add(asset.id);
      const current = this._customModels.get(asset.id);
      if (current?.source === asset.model.data) continue;
      if (current?.parts) disposeImportedModelParts(current.parts);
      const entry = { source: asset.model.data, parts: null, error: null };
      this._customModels.set(asset.id, entry);
      loadImportedPropModel(asset.model).then((parts) => {
        if (this._disposed || this._customModels.get(asset.id) !== entry) {
          disposeImportedModelParts(parts);
          return;
        }
        entry.parts = parts.map((part) => ({
          geometry: part.geometry,
          material: configureDistanceFade(part.material),
        }));
        this._scatterKey = '';
      }).catch((error) => {
        if (this._customModels.get(asset.id) !== entry) return;
        entry.error = error;
        console.warn(`Could not load imported prop ${asset.model.name}:`, error);
      });
    }
    for (const [assetId, entry] of this._customModels) {
      if (wanted.has(assetId)) continue;
      if (entry.parts) disposeImportedModelParts(entry.parts);
      this._customModels.delete(assetId);
    }
  }

  _resolveCenter(mode, camera, boardSize, centerOverride = null) {
    if (mode === 'studio') {
      if (centerOverride) return this._centerScratch.set(centerOverride.x, 0, centerOverride.z);
      const half = boardSize / 2;
      return this._centerScratch.set(clamp(camera.position.x, -half, half), 0, clamp(camera.position.z, -half, half));
    }
    return this._centerScratch.copy(camera.position);
  }

  _updateFlat({ mode, center, params, sampler, scatterChanged, synchronous }) {
    if (!sampler) return;
    if (scatterChanged) {
      this._sectors.clear();
      this._buildQueue.length = 0;
      this._queued.clear();
    }
    const requestedRadius = Math.max(32, params.propsCullDistance || 760);
    const radius = requestedRadius * this._qualityBudget.distanceScale;
    const centerMoved = this._lastCenter.distanceToSquared(center) >= 16;
    const centerSx = Math.floor(center.x / this._sectorSize);
    const centerSz = Math.floor(center.z / this._sectorSize);
    const centerSectorKey = `${centerSx}:${centerSz}:${this._quality}`;
    const desired = new Set();
    const range = Math.ceil(radius / this._sectorSize) + 1;
    const queued = [];
    for (let sz = centerSz - range; sz <= centerSz + range; sz++) {
      for (let sx = centerSx - range; sx <= centerSx + range; sx++) {
        const cx = (sx + 0.5) * this._sectorSize;
        const cz = (sz + 0.5) * this._sectorSize;
        if (Math.hypot(cx - center.x, cz - center.z) > radius + this._sectorSize * 0.72) continue;
        const key = `${sx},${sz}`;
        desired.add(key);
        if (!this._sectors.has(key) && !this._queued.has(key)) queued.push({ key, sx, sz, d: Math.hypot(cx - center.x, cz - center.z) });
      }
    }
    for (const key of this._sectors.keys()) if (!desired.has(key)) this._sectors.delete(key);
    queued.sort((a, b) => a.d - b.d);
    for (const entry of queued) { this._buildQueue.push(entry); this._queued.add(entry.key); }
    this._desiredSectors = desired;
    const activeChanged = scatterChanged || centerMoved || centerSectorKey !== this._centerSectorKey || queued.length > 0;
    this._centerSectorKey = centerSectorKey;
    this._lastCenter.copy(center);

    let built = false;
    const start = performance.now();
    const batchActive = this._buildQueue.length > 0;
    if (batchActive) sampler.beginBatch?.(center.x, center.z);
    try {
      while (this._buildQueue.length) {
        if (!synchronous && built && performance.now() - start >= this._qualityBudget.buildMs) break;
        const entry = this._buildQueue.shift();
        this._queued.delete(entry.key);
        if (!this._desiredSectors.has(entry.key)) continue;
        this._sectors.set(entry.key, this._buildFlatSector(entry.sx, entry.sz, params, sampler));
        built = true;
      }
    } finally {
      if (batchActive) sampler.endBatch?.();
    }
    if (activeChanged || built) this._commitFlat(center, radius, params);
    else this._diagnostics.cacheHits++;
    this._diagnostics.sectors = this._sectors.size;
    this._diagnostics.queuedSectors = this._buildQueue.length;
  }

  _invalidateBounds(bounds) {
    const minSx = Math.floor(bounds.minX / this._sectorSize);
    const maxSx = Math.floor(bounds.maxX / this._sectorSize);
    const minSz = Math.floor(bounds.minZ / this._sectorSize);
    const maxSz = Math.floor(bounds.maxZ / this._sectorSize);
    for (let sz = minSz; sz <= maxSz; sz++) {
      for (let sx = minSx; sx <= maxSx; sx++) {
        const key = `${sx},${sz}`;
        this._sectors.delete(key);
        if (this._queued.has(key)) {
          this._queued.delete(key);
          this._buildQueue = this._buildQueue.filter((entry) => entry.key !== key);
        }
      }
    }
  }

  _buildFlatSector(sx, sz, params, sampler) {
    const buckets = emptyBuckets();
    const minX = sx * this._sectorSize;
    const minZ = sz * this._sectorSize;
    const maxX = minX + this._sectorSize;
    const maxZ = minZ + this._sectorSize;
    const master = clamp(params.propsDensity ?? 0.65, 0, 2);
    for (let typeIndex = 0; typeIndex < PROP_TYPES.length; typeIndex++) {
      const desc = PROP_TYPES[typeIndex];
      const assets = this._assetsByType?.[desc.id] || [];
      const libraryDensity = assets.length ? 1 : 0;
      const cell = desc.cellSize;
      const minGx = Math.floor(minX / cell);
      const maxGx = Math.ceil(maxX / cell);
      const minGz = Math.floor(minZ / cell);
      const maxGz = Math.ceil(maxZ / cell);
      const typeDensity = clamp(params[desc.densityParam] ?? 1, 0, 2);
      if (master <= 0 || typeDensity <= 0 || libraryDensity <= 0) continue;
      for (let gz = minGz; gz < maxGz; gz++) {
        for (let gx = minGx; gx < maxGx; gx++) {
          const salt = 31 + typeIndex * 101;
          const jitterX = hashInt(gx + salt, gz - 17, params.seed);
          const jitterZ = hashInt(gx - 43, gz + salt, params.seed);
          const x = gx * cell + (jitterX - 0.5) * cell * 0.84;
          const z = gz * cell + (jitterZ - 0.5) * cell * 0.84;
          if (x < minX || x >= maxX || z < minZ || z >= maxZ) continue;
          if (this._containsPoint && !this._containsPoint(x, z)) continue;
          if ((desc.id === 'broadleaf' || desc.id === 'conifer') && !this._treeSpacingWinner(gx, gz, params.seed, salt)) continue;
          const priority = hashInt(gx + salt * 2, gz - salt * 3, params.seed);
          const paintDensity = sampler.paintDensityForTypeAt?.(desc.id, x, z)
            ?? ((desc.id === 'grass' || desc.id === 'flower') ? (sampler.paintDensityAt?.(x, z) ?? 0) : 0);
          const upperBound = clamp(master * (typeDensity + paintDensity) * libraryDensity * (desc.density ?? 1), 0, 1);
          if (priority > upperBound) continue;
          const sample = sampler.sampleAt(x, z);
          this._diagnostics.samples++;
          const macro = macroDensity(x, z, params.seed, salt);
          if (!shouldPlaceType(desc, sample, params, { roll: priority, macro })) continue;
          const asset = selectPropAsset(assets, hashInt(gx - salt * 5, gz + salt * 7, params.seed));
          if (asset) buckets[desc.render].push(this._composeItem(desc, sample, gx, gz, params, priority, null, asset));
        }
      }
    }
    this._diagnostics.cacheMisses++;
    return buckets;
  }

  _treeSpacingWinner(gx, gz, seed, salt) {
    const value = hashInt(gx + salt, gz - salt, seed);
    return value >= hashInt(gx - 1 + salt, gz - salt, seed)
      && value >= hashInt(gx + 1 + salt, gz - salt, seed)
      && value >= hashInt(gx + salt, gz - 1 - salt, seed)
      && value >= hashInt(gx + salt, gz + 1 - salt, seed);
  }

  _composeItem(desc, sample, gx, gz, params, priority, planetDir = null, asset = null) {
    const scaleSeed = hashInt(gx + 29, gz + 11, params.seed);
    let scale = lerp(desc.scaleRange[0], desc.scaleRange[1], scaleSeed);
    if (desc.scaleParam) scale *= clamp(params[desc.scaleParam] ?? 1, 0.05, 2.5);
    const rootDepth = desc.rootDepth ?? scale * (desc.rootDepthRatio ?? 0);
    let pos;
    let normal;
    let alignAmount = desc.alignAmount ?? (desc.alignMode === ALIGN.NORMAL ? 1 : 0);
    if (planetDir) {
      const surfaceRadius = sample.surfaceRadius - rootDepth;
      pos = [planetDir.x * surfaceRadius, planetDir.y * surfaceRadius, planetDir.z * surfaceRadius];
      if (desc.alignMode === ALIGN.UPRIGHT) normal = [planetDir.x, planetDir.y, planetDir.z];
      else {
        normal = [
          lerp(planetDir.x, sample.normal.x, alignAmount),
          lerp(planetDir.y, sample.normal.y, alignAmount),
          lerp(planetDir.z, sample.normal.z, alignAmount),
        ];
      }
      alignAmount = 1;
    } else {
      const [x, y, z] = sample.position;
      pos = [x, y - rootDepth, z];
      normal = [sample.normal.x, sample.normal.y, sample.normal.z];
    }
    let finalScale = scale;
    if (desc.id === 'grass') {
      const patch = lerp(0.85, 1.8, hashInt(gx + 61, gz - 23, params.seed));
      finalScale = [patch, scale, patch];
    } else if (desc.id === 'rock') {
      finalScale = [
        scale * lerp(0.75, 1.45, hashInt(gx + 61, gz - 23, params.seed)),
        scale * lerp(0.55, 0.95, hashInt(gx - 19, gz + 67, params.seed)),
        scale * lerp(0.7, 1.35, hashInt(gx + 101, gz + 7, params.seed)),
      ];
    }
    if (asset) {
      const assetScale = asset.scale;
      const assetWidth = asset.width;
      const assetHeight = asset.height;
      if (Array.isArray(finalScale)) {
        finalScale = [
          finalScale[0] * assetScale * assetWidth,
          finalScale[1] * assetScale * assetHeight,
          finalScale[2] * assetScale * assetWidth,
        ];
      } else if (assetWidth === assetHeight) {
        finalScale *= assetScale * assetWidth;
      } else {
        finalScale = [
          finalScale * assetScale * assetWidth,
          finalScale * assetScale * assetHeight,
          finalScale * assetScale * assetWidth,
        ];
      }
    }
    const terrainTint = desc.id === 'grass' ? grassTint(sample)
      : desc.id === 'rock' ? terrainRockTint(sample)
        : desc.id === 'broadleaf' ? treeTint(sample, false)
          : desc.id === 'conifer' ? treeTint(sample, true)
            : flowerTint(hashInt(gx + 3, gz + 41, params.seed));
    const assetTint = propAssetColorRGB(asset);
    const tint = asset?.model
      ? assetTint
      : asset
        ? terrainTint.map((channel, index) => lerp(channel, assetTint[index], 0.68))
      : terrainTint;
    return {
      render: desc.render, pos, normal, yaw: hashInt(gx, gz, params.seed) * Math.PI * 2,
      scale: finalScale, alignAmount, tint, priority, assetId: asset?.id,
    };
  }

  _commitFlat(center, radius, params) {
    const all = emptyBuckets();
    for (const sector of this._sectors.values()) {
      for (const key of Object.keys(all)) all[key].push(...sector[key]);
    }
    this._commitBuckets(all, center, radius, params, false);
  }

  _updatePlanet({ camera, params, planetSampler, scatterChanged }) {
    if (!planetSampler) return;
    const dir = this._planetCamDir.copy(camera.position).normalize();
    const radius = Math.max(32, params.propsCullDistance || 760) * this._qualityBudget.distanceScale;
    const planetRadius = Math.max(1, params.planetRadius || 16000);
    const altitude = Math.max(0, camera.position.length() - planetRadius);
    const angularStep = this._sectorSize / Math.max(1, params.planetRadius || 16000);
    const lat = Math.asin(clamp(dir.y, -1, 1));
    const lon = Math.atan2(dir.z, dir.x);
    const nearSurface = altitude <= Math.max(1000, radius * 1.5);
    const altitudeBand = nearSurface ? Math.round(altitude / Math.max(8, radius * 0.08)) : 'orbit';
    const planetKey = `${Math.round(lat / angularStep)}:${Math.round(lon / angularStep)}:${altitudeBand}:${this._quality}:${this._scatterKey}`;

    // Physical props cannot contribute at whole-planet viewing distances. Do
    // no scatter work there, but retain a distinct cache key so entering Walk
    // or low-altitude Plane mode starts a fresh incremental surface build.
    if (!nearSurface) {
      if (scatterChanged || planetKey !== this._lastPlanetKey || this._planetBuildState) {
        this._planetBuildState = null;
        this._lastPlanetKey = planetKey;
        this._commitBuckets(emptyBuckets(), camera.position, radius, params, true);
        this._diagnostics.sectors = 0;
        this._diagnostics.queuedSectors = 0;
      } else {
        this._diagnostics.cacheHits++;
      }
      return;
    }

    const needsBuild = scatterChanged || planetKey !== this._lastPlanetKey;
    if (!needsBuild && !this._planetBuildState) { this._diagnostics.cacheHits++; return; }
    this._lastPlanetKey = planetKey;

    if (needsBuild) {
      const ref = Math.abs(dir.y) < 0.96 ? this._planetRef.set(0, 1, 0) : this._planetRef.set(1, 0, 0);
      const t1 = this._planetT1.crossVectors(ref, dir).normalize();
      const t2 = this._planetT2.crossVectors(dir, t1).normalize();
      this._commitBuckets(emptyBuckets(), camera.position, radius, params, true);
      this._planetBuildState = this._createPlanetBuildState({
        key: planetKey, dir, t1, t2, radius, params, planetSampler,
      });
    }

    const state = this._planetBuildState;
    const changed = this._processPlanetBuild(state);
    if (changed || state.complete) this._commitBuckets(state.buckets, camera.position, radius, params, true);
    this._diagnostics.sectors = 1;
    this._diagnostics.queuedSectors = state.complete ? 0 : 1;
    if (state.complete) {
      this._diagnostics.cacheMisses++;
      this._planetBuildState = null;
    }
  }

  _createPlanetBuildState({ key, dir, t1, t2, radius, params, planetSampler }) {
    const master = clamp(params.propsDensity ?? 0.65, 0, 2);
    const treeCaps = [Math.ceil(this._qualityBudget.trees * 0.55), Math.floor(this._qualityBudget.trees * 0.45)];
    const caps = {
      grass: this._qualityBudget.grass,
      flower: this._qualityBudget.flowers,
      rock: this._qualityBudget.rocks,
      broadleaf: treeCaps[0],
      conifer: treeCaps[1],
    };
    const types = PROP_TYPES.map((desc, typeIndex) => {
      const range = Math.ceil(radius / desc.cellSize);
      const typeDensity = clamp(params[desc.densityParam] ?? 1, 0, 2);
      const assets = this._assetsByType?.[desc.id] || [];
      const libraryDensity = assets.length ? 1 : 0;
      const densityGate = clamp(master * typeDensity * libraryDensity * (desc.density ?? 1), 0, 1);
      const estimatedCells = Math.max(1, Math.PI * (radius / desc.cellSize) ** 2);
      return {
        desc, assets, typeIndex, range, gx: -range, gy: -range,
        salt: 31 + typeIndex * 101,
        // Oversample enough to absorb biome/slope rejection without asking
        // the expensive Planet sampler to evaluate tens of thousands of cells.
        preGate: Math.min(densityGate, caps[desc.id] * 1.7 / estimatedCells),
      };
    });
    return {
      key, dir: dir.clone(), t1: t1.clone(), t2: t2.clone(), radius,
      params, planetSampler, types, typeIndex: 0, buckets: emptyBuckets(),
      complete: false,
    };
  }

  _processPlanetBuild(state) {
    if (!state || state.complete) return false;
    const started = performance.now();
    let changed = false;
    let iterations = 0;
    while (state.typeIndex < state.types.length) {
      const cursor = state.types[state.typeIndex];
      const { desc, range, salt } = cursor;
      if (cursor.gy > range) { state.typeIndex++; continue; }
      const gx = cursor.gx;
      const gy = cursor.gy;
      cursor.gx++;
      if (cursor.gx > range) { cursor.gx = -range; cursor.gy++; }
      iterations++;

      if (cursor.preGate > 0
        && (!(desc.id === 'broadleaf' || desc.id === 'conifer') || this._treeSpacingWinner(gx, gy, state.params.seed, salt))) {
        const ox = gx * desc.cellSize + (hashInt(gx + salt, gy - 17, state.params.seed) - 0.5) * desc.cellSize * 0.84;
        const oy = gy * desc.cellSize + (hashInt(gx - 43, gy + salt, state.params.seed) - 0.5) * desc.cellSize * 0.84;
        if (Math.hypot(ox, oy) <= state.radius) {
          const priority = hashInt(gx + salt * 2, gy - salt * 3, state.params.seed);
          if (priority <= cursor.preGate) {
            const sampleDir = this._planetDir.copy(state.dir).multiplyScalar(state.params.planetRadius)
              .addScaledVector(state.t1, ox).addScaledVector(state.t2, oy).normalize();
            const sample = state.planetSampler.sampleAt3D(sampleDir.x, sampleDir.y, sampleDir.z);
            this._diagnostics.samples++;
            const macro = macroDensity(gx * desc.cellSize, gy * desc.cellSize, state.params.seed, salt);
            if (shouldPlaceType(desc, sample, state.params, { roll: priority, macro })) {
              const asset = selectPropAsset(cursor.assets, hashInt(gx - salt * 5, gy + salt * 7, state.params.seed));
              if (!asset) continue;
              state.buckets[desc.render].push(this._composeItem(
                desc, sample, gx, gy, state.params, priority, sampleDir, asset,
              ));
              changed = true;
            }
          }
        }
      }

      if ((iterations & 63) === 0
        && performance.now() - started >= this._qualityBudget.buildMs) return changed;
    }
    state.complete = true;
    return changed;
  }

  _commitBuckets(all, center, radius, params, spherical = false) {
    const budget = this._qualityBudget;
    const distanceOf = spherical
      ? (item) => Math.hypot(item.pos[0] - center.x, item.pos[1] - center.y, item.pos[2] - center.z)
      : (item) => Math.hypot(item.pos[0] - center.x, item.pos[2] - center.z);
    const select = (items, cap, maxDistance = radius) => items
      .filter((item) => distanceOf(item) <= maxDistance)
      .sort((a, b) => b.priority - a.priority)
      .slice(0, cap);
    const grassMax = Math.min(radius, budget.grassDistance);
    const flowerMax = Math.min(grassMax, budget.grassDistance * 0.78);
    const grass = select(all.grass, budget.grass, grassMax);
    const flowers = select(all.flower, budget.flowers, flowerMax);
    const rocks = select(all.rock, budget.rocks);
    const broadleafCap = Math.ceil(budget.trees * 0.55);
    const broadleaf = select(all.broadleaf, broadleafCap);
    const conifer = select(all.conifer, Math.max(0, budget.trees - broadleafCap));
    const requestedLod = Math.max(24, params.propsLodDistance || 280);
    const nearDistance = Math.min(requestedLod, budget.nearDistance);
    const split = (items, distance = nearDistance) => {
      const near = [], far = [];
      for (const item of items) (distanceOf(item) < distance ? near : far).push(item);
      return [near, far];
    };
    const [grassNear, grassMid] = split(grass, Math.min(nearDistance, grassMax * 0.6));
    const [rockNear, rockFar] = split(rocks);
    const [broadleafNear, broadleafFar] = split(broadleaf);
    const [coniferNear, coniferFar] = split(conifer);
    const lodFade = clamp(nearDistance * 0.12, 6, 28);
    const grassLod = Math.min(nearDistance, grassMax * 0.6);
    const grassCullFade = clamp(grassMax * 0.1, 8, 36);
    const flowerCullFade = clamp(flowerMax * 0.12, 6, 28);
    const cullFade = clamp(radius * 0.06, 10, 42);
    this._fadeRanges = {
      grassNear: [0, 0, grassLod - lodFade, grassLod + lodFade],
      grassMid: [grassLod - lodFade, grassLod + lodFade, grassMax - grassCullFade, grassMax],
      flowers: [0, 0, flowerMax - flowerCullFade, flowerMax],
      rocksNear: [0, 0, nearDistance - lodFade, nearDistance + lodFade],
      rocksFar: [nearDistance - lodFade, nearDistance + lodFade, radius - cullFade, radius],
      broadleafNear: [0, 0, nearDistance - lodFade, nearDistance + lodFade],
      broadleafFar: [nearDistance - lodFade, nearDistance + lodFade, radius - cullFade, radius],
      coniferNear: [0, 0, nearDistance - lodFade, nearDistance + lodFade],
      coniferFar: [nearDistance - lodFade, nearDistance + lodFade, radius - cullFade, radius],
    };
    this._replaceMeshes({ grassNear, grassMid, flowers, rockNear, rockFar, broadleafNear, broadleafFar, coniferNear, coniferFar });
  }

  _replaceMeshes(batches) {
    const active = new Set();
    const isCustom = (item) => !!this._customModels.get(item.assetId)?.parts;
    const specs = [
      ['grass-near', this.grassNearGeometry, this.grassNearMaterial, batches.grassNear.filter((item) => !isCustom(item)), 'grassNear'],
      ['grass-mid', this.grassMidGeometry, this.grassMidMaterial, batches.grassMid.filter((item) => !isCustom(item)), 'grassMid'],
      ['flowers', this.flowerGeometry, this.flowerMaterial, batches.flowers.filter((item) => !isCustom(item)), 'flowers'],
      ['rocks-near', this.rockNearGeometry, this.rockMaterial, batches.rockNear.filter((item) => !isCustom(item)), 'rocksNear'],
      ['rocks-far', this.rockFarGeometry, this.rockMaterial, batches.rockFar.filter((item) => !isCustom(item)), 'rocksFar'],
      ['broadleaf-near', this.broadleafNearGeometry, this.treeMaterial, batches.broadleafNear.filter((item) => !isCustom(item)), 'broadleafNear'],
      ['broadleaf-far', this.broadleafFarGeometry, this.treeMaterial, batches.broadleafFar.filter((item) => !isCustom(item)), 'broadleafFar'],
      ['conifer-near', this.coniferNearGeometry, this.treeMaterial, batches.coniferNear.filter((item) => !isCustom(item)), 'coniferNear'],
      ['conifer-far', this.coniferFarGeometry, this.treeMaterial, batches.coniferFar.filter((item) => !isCustom(item)), 'coniferFar'],
    ];
    for (const [batchKey, items] of Object.entries(batches)) {
      const byAsset = new Map();
      for (const item of items) {
        if (!isCustom(item)) continue;
        if (!byAsset.has(item.assetId)) byAsset.set(item.assetId, []);
        byAsset.get(item.assetId).push(item);
      }
      for (const [assetId, customItems] of byAsset) {
        const safeId = assetId.replace(/[^a-z0-9_-]/gi, '_');
        const parts = this._customModels.get(assetId).parts;
        parts.forEach((part, partIndex) => {
          specs.push([
            `custom-${safeId}-${batchKey}-${partIndex}`,
            part.geometry,
            part.material,
            customItems,
            batchKey,
          ]);
        });
      }
    }
    let triangles = 0, drawCalls = 0;
    for (const [name, geometry, material, items, fadeKey] of specs) {
      this._updateInstanced(name, geometry, material, items, active, fadeKey);
      if (items.length) {
        drawCalls++;
        const available = geometry.index ? geometry.index.count : geometry.getAttribute('position').count;
        const tri = Math.min(available, geometry.drawRange.count) / 3;
        triangles += tri * items.length;
      }
    }
    for (const [name, mesh] of this._meshPool) if (!active.has(name)) mesh.count = 0;
    this.meshes = [...this._meshPool.values()];
    this._diagnostics.instances = {
      grass: batches.grassNear.length + batches.grassMid.length,
      flowers: batches.flowers.length,
      rocks: batches.rockNear.length + batches.rockFar.length,
      trees: batches.broadleafNear.length + batches.broadleafFar.length + batches.coniferNear.length + batches.coniferFar.length,
    };
    this._diagnostics.lod = Object.fromEntries(Object.entries(batches).map(([key, items]) => [key, items.length]));
    this._diagnostics.triangles = triangles;
    this._diagnostics.drawCalls = drawCalls;
  }

  _updateInstanced(name, geometry, material, items, active, fadeKey = null) {
    let mesh = this._meshPool.get(name);
    if (!mesh && !items.length) return;
    if (!mesh || mesh.instanceMatrix.count < items.length || mesh.geometry !== geometry || mesh.material !== material) {
      const capacity = Math.max(16, 2 ** Math.ceil(Math.log2(items.length || 1)));
      if (mesh) {
        this.group.remove(mesh);
        mesh.dispose?.();
      }
      mesh = new THREE.InstancedMesh(geometry, material, capacity);
      mesh.name = `procedural-${name}`;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this._meshPool.set(name, mesh);
      this.group.add(mesh);
    }
    mesh.count = items.length;
    active.add(name);
    const rangeKey = fadeKey || name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const fade = this._fadeRanges?.[rangeKey] || [0, 0, 1e6, 1e6 + 1];
    mesh.userData.propFadeRanges = fade;
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
      const uniforms = mesh.material.userData.propFadeUniforms;
      if (!uniforms) return;
      uniforms.center.value.copy(camera.position);
      uniforms.ranges.value.fromArray(mesh.userData.propFadeRanges);
    };
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      this._tmpPos.fromArray(item.pos);
      this._tmpNormal.fromArray(item.normal).normalize();
      this._qFull.setFromUnitVectors(this._up, this._tmpNormal);
      this._qAlign.copy(this._qIdentity).slerp(this._qFull, item.alignAmount ?? 1);
      this._qYaw.setFromAxisAngle(this._up, item.yaw);
      this._qAlign.multiply(this._qYaw);
      if (Array.isArray(item.scale)) this._tmpScale.fromArray(item.scale);
      else this._tmpScale.setScalar(item.scale);
      this._tmpMat.compose(this._tmpPos, this._qAlign, this._tmpScale);
      mesh.setMatrixAt(i, this._tmpMat);
      this._tmpColor.fromArray(item.tint || [1, 1, 1]);
      mesh.setColorAt(i, this._tmpColor);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  tickWind(timeSeconds, params) {
    const uniforms = this.windUniforms;
    uniforms.uTime.value = timeSeconds;
    uniforms.uWindStrength.value = 0.3 * Math.max(0, params?.propsWind ?? 0.6);
    uniforms.uWindSpeed.value = params?.propsWindSpeed ?? 1.6;
    uniforms.uGustIntensity.value = params?.propsGust ?? 0.45;
  }

  getDiagnostics() {
    return {
      ...this._diagnostics,
      instances: { ...this._diagnostics.instances },
      lod: { ...this._diagnostics.lod },
      quality: this._quality,
    };
  }

  _clearMeshes() {
    for (const mesh of this._meshPool.values()) this.group.remove(mesh);
    this._meshPool.clear();
    this.meshes = [];
  }

  dispose() {
    this._disposed = true;
    this._clearMeshes();
    this._sectors.clear();
    this._planetBuildState = null;
    this._buildQueue.length = 0;
    this.scene.remove(this.group);
    [
      this.grassNearGeometry, this.grassMidGeometry, this.flowerGeometry,
      this.rockNearGeometry, this.rockFarGeometry,
      this.broadleafNearGeometry, this.broadleafFarGeometry,
      this.coniferNearGeometry, this.coniferFarGeometry,
    ].forEach((geometry) => geometry.dispose());
    [this.grassNearMaterial, this.grassMidMaterial, this.flowerMaterial, this.treeMaterial, this.rockMaterial]
      .forEach((material) => material.dispose());
    for (const entry of this._customModels.values()) {
      if (entry.parts) disposeImportedModelParts(entry.parts);
    }
    this._customModels.clear();
    this.atlas.dispose();
  }
}
