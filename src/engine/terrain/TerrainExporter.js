import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { zipSync } from 'fflate';
import {
  createTileExportManifest,
  tileExportFolder,
  tilePackageAssetPath,
  tilePackageHeightmapPath,
} from './TerrainExportLayout.js';
import { COMMON_UNIFORMS_GLSL, NOISE_GLSL, buildHeightGLSL } from './terrainGLSL.js';
import { BIOME_GLSL } from './biomeGLSL.js';
import {
  PALETTE_UNIFORMS_GLSL,
  TERRAIN_COLOR_FUNCTIONS_GLSL,
} from '../shaders/terrainColor.glsl.js';
import { generateStackGLSL } from './noise/noiseStackCodegen.js';
import { defaultLegacyStack } from './noise/NoiseStack.js';

const DEFAULT_STACK_GLSL = generateStackGLSL(defaultLegacyStack());

// Quad shaders for baking
const BAKE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const buildBakeFragment = (heightGLSL) => /* glsl */ `
  precision highp float;

  ${COMMON_UNIFORMS_GLSL}
  ${NOISE_GLSL}
  ${BIOME_GLSL}
  ${heightGLSL}
  ${PALETTE_UNIFORMS_GLSL}
  ${TERRAIN_COLOR_FUNCTIONS_GLSL}

  uniform float uAO;
  uniform float uNormalStrength;
  uniform float uEps;
  uniform float uBoardSize;
  uniform vec2 uBoardSizeXZ;    // baked region size (per-axis; == uBoardSize,uBoardSize for one cell)
  uniform vec2 uCellOffset;     // world XZ of the baked region center
  uniform int uBakeMode;       // 0 = heightmap, 1 = normalmap, 2 = color, 3 = biome splat
  uniform bool uBakeLighting;

  varying vec2 vUv;

  // Stable 24-bit float packing into RGB
  vec4 packDepth(float v) {
    float value = clamp(v, 0.0, 1.0) * 16777215.0;
    float r = floor(value / 65536.0);
    value -= r * 65536.0;
    float g = floor(value / 256.0);
    value -= g * 256.0;
    float b = floor(value);
    return vec4(r / 255.0, g / 255.0, b / 255.0, 1.0);
  }

  void main() {
    // Map UV back to world coordinates for the baked region (one cell, or the
    // whole assembly for the union-wide auxiliary maps).
    vec2 xz = uCellOffset + (vUv - 0.5) * uBoardSizeXZ;

    Climate cl = climateAt(xz * uFrequency + uSeedOffset);
    BiomeWeights bw = biomeWeightsAt(cl);

    float eps = uEps;
    // Export the final authoring stack, including paint, erosion and baked
    // spline offsets, rather than only the procedural source field.
    float hC = heightAt(xz);
    float hX = heightAt(xz + vec2(eps, 0.0));
    float hZ = heightAt(xz + vec2(0.0, eps));

    if (uBakeMode == 0) {
      float h01 = clamp(hC / max(uHeightScale, 1e-3), 0.0, 1.0);
      gl_FragColor = packDepth(h01);
      return;
    }

    vec3 nGeo = normalize(vec3(-(hX - hC) / eps, 1.0, -(hZ - hC) / eps));
    vec3 n = normalize(vec3(nGeo.x * uNormalStrength, 1.0, nGeo.z * uNormalStrength));

    if (uBakeMode == 1) {
      // Tangent space normal map (R: x, G: z, B: y)
      vec3 tangentNormal = vec3(n.x, n.z, n.y);
      gl_FragColor = vec4(tangentNormal * 0.5 + 0.5, 1.0);
      return;
    }

    float slope = 1.0 - nGeo.y;
    float hRel = hC - uSeaLevel;
    float h01 = hC / max(uHeightScale, 1e-3);
    float jitter = (cl.region - 0.5) * 0.8 + (vnoise(xz * 0.045 + uSeedOffset) - 0.5) * 0.6;
    float detail = vnoise(xz * 0.35 + uSeedOffset.yx);

    TerrainColorResult tc = computeTerrainAlbedo(cl, bw, hC, hRel, h01, slope, detail, jitter, vnoise(xz * 0.9));

    if (uBakeMode == 2) {
      if (uBakeLighting) {
        float concave = clamp(((hX + hZ) * 0.5 - hC) / (eps * 0.9), 0.0, 1.0);
        float valley = 1.0 - smoothstep(0.0, uHeightScale * 0.55, hC);
        float ao = 1.0 - uAO * (concave * 0.45 + valley * 0.22);
        ao = applyRidgeAccent(ao, (hC - (hX + hZ) * 0.5) / (eps * 0.9));
        vec3 viewDir = vec3(0.0, 1.0, 0.0);
        vec3 col = terrainLighting(
          tc.albedo, n, uSunDir, ao,
          tc.snow, tc.sandBand, hRel, tc.flatness, bw.wetland,
          viewDir
        );
        col = pow(col, vec3(1.0 / 2.2));
        gl_FragColor = vec4(col, 1.0);
      } else {
        gl_FragColor = vec4(pow(tc.albedo, vec3(1.0 / 2.2)), 1.0);
      }
      return;
    }

    if (uBakeMode == 3) {
      // Biome weights: R=desert, G=canyon, B=wetland, A=mountains
      gl_FragColor = vec4(bw.desert, bw.canyon, bw.wetland, bw.mountains);
      return;
    }
  }
`;

function rtToCanvas(renderer, rt, w, h) {
  const pixels = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, pixels);
  
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(w, h);

  // WebGL is bottom-up; Canvas is top-down. Flip vertically.
  for (let y = 0; y < h; y++) {
    const srcRow = (h - 1 - y) * w * 4;
    const dstRow = y * w * 4;
    imgData.data.set(pixels.subarray(srcRow, srcRow + w * 4), dstRow);
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

async function canvasToUint8Array(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result));
      reader.readAsArrayBuffer(blob);
    }, 'image/png');
  });
}

export class TerrainExporter {
  static async export(renderer, engineParams, engineUniforms, boardSize, options, onToast, stackGLSL = DEFAULT_STACK_GLSL) {
    const format = options.format || 'glb';
    const meshRes = parseInt(options.meshRes, 10) || 256;
    const includeMesh = options.includeMesh !== false;
    const includeSkirts = !!options.includeSkirts;
    const includeBase = !!options.includeBase;
    const bakeColor = !!options.bakeColor;
    const texRes = parseInt(options.texRes, 10) || 1024;
    const bakeLighting = !!options.bakeLighting;
    const bakeNormal = !!options.bakeNormal;
    const exportHeightmap = !!options.exportHeightmap;
    const exportCollision = !!options.exportCollision;
    const collisionRes = parseInt(options.collisionRes, 10) || 128;
    const exportWater = !!options.exportWater;
    const exportPreset = !!options.exportPreset;

    // Tile assembly: cellSize == the single-board size (boardSize). For one tile
    // this is the classic centered board. tileMode controls multi-tile output.
    const cellSize = boardSize;
    const tiles = (Array.isArray(options.tiles) && options.tiles.length)
      ? options.tiles : [{ cx: 0, cz: 0 }];
    const tileShape = options.tileAssemblyShape === 'circle' ? 'circle' : 'square';
    const tileMode = tileShape === 'circle' ? 'merged' : (options.exportTileMode === 'separate' ? 'separate' : 'merged');
    const diskRadiusWorld = ((Number(options.diskRadiusCells) || 0) + 0.5) * cellSize;
    const inExportDisk = (x, z) => tileShape !== 'circle' || Math.hypot(x, z) <= diskRadiusWorld + 1e-6;
    const tileSet = new Set(tiles.map((t) => `${t.cx},${t.cz}`));
    const hasNeighbor = (cx, cz) => tileSet.has(`${cx},${cz}`);
    const cellCenter = (cx, cz) => ({ x: cx * cellSize, z: cz * cellSize });
    // union bounds (for the auxiliary union-wide maps + water plane)
    let minCX = Infinity, minCZ = Infinity, maxCX = -Infinity, maxCZ = -Infinity;
    for (const t of tiles) {
      minCX = Math.min(minCX, t.cx); minCZ = Math.min(minCZ, t.cz);
      maxCX = Math.max(maxCX, t.cx); maxCZ = Math.max(maxCZ, t.cz);
    }
    const unionCols = maxCX - minCX + 1, unionRows = maxCZ - minCZ + 1;
    const unionSpanX = unionCols * cellSize, unionSpanZ = unionRows * cellSize;
    const unionCenter = { x: (minCX + maxCX) * 0.5 * cellSize, z: (minCZ + maxCZ) * 0.5 * cellSize };

    const heightScale = engineParams.heightScale;
    const seaLevel = engineParams.seaLevel;

    // --- 1. Bake maps via GPU ---
    onToast('Baking shader parameters...');
    const quadScene = new THREE.Scene();
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    quadScene.add(quadMesh);

    // Setup uniforms
    const bakeUniforms = {
      uBoardSize: { value: boardSize },
      uBoardSizeXZ: { value: new THREE.Vector2(boardSize, boardSize) },
      uCellOffset: { value: new THREE.Vector2(0, 0) },
      uBakeMode: { value: 0 },
      uBakeLighting: { value: bakeLighting },
      uEps: { value: Math.max(0.35, boardSize / 4096) }
    };
    // Copy active engine uniforms
    for (const key in engineUniforms) {
      const val = engineUniforms[key].value;
      if (val && typeof val.clone === 'function') {
        bakeUniforms[key] = { value: val.clone() };
      } else {
        bakeUniforms[key] = { value: val };
      }
    }

    const oct = Math.round(engineParams.octaves);
    const bakeMat = new THREE.ShaderMaterial({
      defines: { OCTAVES: oct },
      uniforms: bakeUniforms,
      vertexShader: BAKE_VERTEX,
      fragmentShader: buildBakeFragment(buildHeightGLSL(stackGLSL.body2d))
    });
    quadMesh.material = bakeMat;

    // Region bake helpers. uCellOffset + uBoardSizeXZ select the world rectangle
    // sampled by the bake shader, so one set of shaders covers each cell and the
    // union-wide auxiliary maps. The occupancy uniforms were copied from the
    // engine above, so the per-cell rim falloff matches the live view.
    const setRegion = (ox, oz, sx, sz) => {
      bakeUniforms.uCellOffset.value.set(ox, oz);
      bakeUniforms.uBoardSizeXZ.value.set(sx, sz);
    };
    const bakeHeightGrid = (ox, oz, sx, sz, gx, gz) => {
      const wpx = gx + 1, hpx = gz + 1;
      const rt = new THREE.WebGLRenderTarget(wpx, hpx, {
        format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      });
      setRegion(ox, oz, sx, sz);
      bakeUniforms.uBakeMode.value = 0;
      renderer.setRenderTarget(rt);
      renderer.render(quadScene, quadCam);
      const px = new Uint8Array(wpx * hpx * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, wpx, hpx, px);
      renderer.setRenderTarget(null);
      rt.dispose();
      const at = (i, j) => {
        const idx = (j * wpx + i) * 4;
        const h01 = (px[idx] * 65536 + px[idx + 1] * 256 + px[idx + 2]) / 16777215;
        return h01 * heightScale;
      };
      return { wpx, hpx, px, at };
    };
    const bakeRegionCanvas = (mode, ox, oz, sx, sz, res) => {
      const rt = new THREE.WebGLRenderTarget(res, res);
      setRegion(ox, oz, sx, sz);
      bakeUniforms.uBakeMode.value = mode;
      renderer.setRenderTarget(rt);
      renderer.render(quadScene, quadCam);
      const c = rtToCanvas(renderer, rt, res, res);
      renderer.setRenderTarget(null);
      rt.dispose();
      return c;
    };
    const bakeHeightAsset = (ox, oz, sx, sz) => {
      const visualRT = new THREE.WebGLRenderTarget(texRes, texRes);
      setRegion(ox, oz, sx, sz);
      bakeUniforms.uBakeMode.value = 0;
      renderer.setRenderTarget(visualRT);
      renderer.render(quadScene, quadCam);
      const visualPixels = new Uint8Array(texRes * texRes * 4);
      renderer.readRenderTargetPixels(visualRT, 0, 0, texRes, texRes, visualPixels);
      renderer.setRenderTarget(null);
      visualRT.dispose();

      const canvas = document.createElement('canvas');
      canvas.width = texRes;
      canvas.height = texRes;
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(texRes, texRes);
      const raw16 = new Uint8Array(texRes * texRes * 2);
      const rawView = new DataView(raw16.buffer);
      for (let y = 0; y < texRes; y++) {
        const srcRow = (texRes - 1 - y) * texRes * 4;
        const dstRow = y * texRes * 4;
        for (let x = 0; x < texRes; x++) {
          const sIdx = srcRow + x * 4;
          const dIdx = dstRow + x * 4;
          const height01 = (visualPixels[sIdx] * 65536 + visualPixels[sIdx + 1] * 256 + visualPixels[sIdx + 2]) / 16777215;
          const val = Math.round(height01 * 255);
          img.data[dIdx] = val; img.data[dIdx + 1] = val; img.data[dIdx + 2] = val; img.data[dIdx + 3] = 255;
          rawView.setUint16((y * texRes + x) * 2, Math.round(height01 * 65535), true);
        }
      }
      ctx.putImageData(img, 0, 0);
      return { canvas, raw16 };
    };

    const skirtDepth = Math.max(24, heightScale * 0.08);
    const baseHeight = -skirtDepth;
    const multi = tiles.length > 1;
    const separateTileExport = multi && tileShape === 'square' && tileMode === 'separate';

    // --- 2. Construct 3D Mesh (one terrain block per occupied cell) ---
    const exportGroup = new THREE.Group();
    exportGroup.name = multi ? 'Terrain_Assembly' : 'Terrain_Board';

    if (includeMesh) {
      onToast(multi ? 'Generating tile geometry...' : 'Generating terrain geometry...');
      const slabMaterial = new THREE.MeshStandardMaterial({
        name: 'Slab_Material', color: 0x231e19, roughness: 0.9, metalness: 0.05,
        side: THREE.DoubleSide,
      });

      for (const cell of tiles) {
        const ctr = cellCenter(cell.cx, cell.cz);
        const { at } = bakeHeightGrid(ctr.x, ctr.z, cellSize, cellSize, meshRes, meshRes);

        let colorTex = null, normalTex = null;
        if (bakeColor) {
          const cv = bakeRegionCanvas(2, ctr.x, ctr.z, cellSize, cellSize, texRes);
          colorTex = new THREE.CanvasTexture(cv);
          colorTex.colorSpace = THREE.SRGBColorSpace;
        }
        if (bakeNormal) {
          const nv = bakeRegionCanvas(1, ctr.x, ctr.z, cellSize, cellSize, texRes);
          normalTex = new THREE.CanvasTexture(nv);
        }
        const terrainMaterial = new THREE.MeshStandardMaterial({
          name: multi ? `Terrain_Material_${cell.cx}_${cell.cz}` : 'Terrain_Material',
          map: colorTex, normalMap: normalTex, roughness: 0.85, metalness: 0.05,
        });

        // surface grid for this cell
        const positions = [], uvs = [], indices = [];
        for (let j = 0; j <= meshRes; j++) {
          const z = ctr.z + (j / meshRes - 0.5) * cellSize;
          for (let i = 0; i <= meshRes; i++) {
            positions.push(ctr.x + (i / meshRes - 0.5) * cellSize, at(i, j), z);
            uvs.push(i / meshRes, j / meshRes);
          }
        }
        for (let j = 0; j < meshRes; j++) {
          for (let i = 0; i < meshRes; i++) {
            const p0 = j * (meshRes + 1) + i, p1 = p0 + 1;
            const p2 = (j + 1) * (meshRes + 1) + i, p3 = p2 + 1;
            const ax = positions[p0 * 3], az = positions[p0 * 3 + 2];
            const bx = positions[p1 * 3], bz = positions[p1 * 3 + 2];
            const cx = positions[p2 * 3], cz = positions[p2 * 3 + 2];
            const dx = positions[p3 * 3], dz = positions[p3 * 3 + 2];
            if (inExportDisk(ax, az) && inExportDisk(cx, cz) && inExportDisk(bx, bz)) indices.push(p0, p2, p1);
            if (inExportDisk(bx, bz) && inExportDisk(cx, cz) && inExportDisk(dx, dz)) indices.push(p1, p2, p3);
          }
        }
        const terrainGeo = new THREE.BufferGeometry();
        terrainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        terrainGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
        terrainGeo.setIndex(indices);
        terrainGeo.computeVertexNormals();
        const terrainMesh = new THREE.Mesh(terrainGeo, terrainMaterial);
        terrainMesh.name = multi ? `Terrain_Tile_${cell.cx}_${cell.cz}` : 'Terrain_Surface';
        exportGroup.add(terrainMesh);

        // walls + base. 'separate' gives every tile all four walls (standalone
        // diorama pieces); 'merged' walls only outward-facing edges so adjacent
        // tiles fuse into one continuous landscape.
        if (includeSkirts && tileShape !== 'circle') {
          const sides = (multi && tileMode === 'merged')
            ? {
                bottom: !hasNeighbor(cell.cx, cell.cz - 1),
                top: !hasNeighbor(cell.cx, cell.cz + 1),
                left: !hasNeighbor(cell.cx - 1, cell.cz),
                right: !hasNeighbor(cell.cx + 1, cell.cz),
              }
            : { bottom: true, top: true, left: true, right: true };

          const sp = [], si = [];
          const addWall = (edge) => {
            const base = sp.length / 3;
            for (const { i, j } of edge) {
              const x = ctr.x + (i / meshRes - 0.5) * cellSize;
              const z = ctr.z + (j / meshRes - 0.5) * cellSize;
              sp.push(x, at(i, j), z);
              sp.push(x, baseHeight, z);
            }
            for (let k = 0; k < edge.length - 1; k++) {
              const tl = base + 2 * k, bl = tl + 1, tr = base + 2 * (k + 1), br = tr + 1;
              si.push(tl, bl, tr, tr, bl, br);   // DoubleSide → winding-agnostic
            }
          };
          const edgeI = (j) => Array.from({ length: meshRes + 1 }, (_, i) => ({ i, j }));
          const edgeJ = (i) => Array.from({ length: meshRes + 1 }, (_, j) => ({ i, j }));
          if (sides.bottom) addWall(edgeI(0));
          if (sides.top) addWall(edgeI(meshRes));
          if (sides.left) addWall(edgeJ(0));
          if (sides.right) addWall(edgeJ(meshRes));

          if (includeBase) {
            const b = sp.length / 3;
            const x0 = ctr.x - cellSize / 2, x1 = ctr.x + cellSize / 2;
            const z0 = ctr.z - cellSize / 2, z1 = ctr.z + cellSize / 2;
            sp.push(x0, baseHeight, z0, x1, baseHeight, z0, x1, baseHeight, z1, x0, baseHeight, z1);
            si.push(b, b + 1, b + 2, b, b + 2, b + 3);
          }

          if (sp.length) {
            const slabGeo = new THREE.BufferGeometry();
            slabGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sp), 3));
            slabGeo.setIndex(si);
            slabGeo.computeVertexNormals();
            const slabMesh = new THREE.Mesh(slabGeo, slabMaterial);
            slabMesh.name = multi ? `Tile_Base_${cell.cx}_${cell.cz}` : 'Terrain_Base_Slab';
            exportGroup.add(slabMesh);
          }
        }
      }
      if (includeSkirts && tileShape === 'circle') {
        const seg = Math.max(64, meshRes * 2);
        const sp = [], si = [];
        for (let k = 0; k <= seg; k++) {
          const a = (k / seg) * Math.PI * 2;
          const x = Math.cos(a) * diskRadiusWorld;
          const z = Math.sin(a) * diskRadiusWorld;
          sp.push(x, seaLevel, z, x, baseHeight, z);
        }
        for (let k = 0; k < seg; k++) {
          const tl = k * 2, bl = tl + 1, tr = (k + 1) * 2, br = tr + 1;
          si.push(tl, bl, tr, tr, bl, br);
        }
        const wallGeo = new THREE.BufferGeometry();
        wallGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sp), 3));
        wallGeo.setIndex(si); wallGeo.computeVertexNormals();
        const wallMesh = new THREE.Mesh(wallGeo, slabMaterial);
        wallMesh.name = 'Circular_Base_Skirt';
        exportGroup.add(wallMesh);
      }
    }

    // D. Union-wide grayscale heightmap (one image covering the whole assembly)
    let heightCanvas = null;
    let heightRaw16 = null;
    if (exportHeightmap) {
      onToast('Baking grayscale heightmap...');
      const asset = bakeHeightAsset(unionCenter.x, unionCenter.z, unionSpanX, unionSpanZ);
      heightCanvas = asset.canvas;
      heightRaw16 = asset.raw16;
    }

    // E. Union-wide splat / biome map
    let splatCanvas = null;
    if (exportHeightmap && options.exportSplat) {
      onToast('Baking splat map...');
      splatCanvas = bakeRegionCanvas(3, unionCenter.x, unionCenter.z, unionSpanX, unionSpanZ, texRes);
    }

    // Union-wide color / normal canvases for the separate PNG zip entries. The
    // GLB already embeds crisp per-cell textures; these are an overview of the
    // whole assembly (== the single cell when there is one tile).
    let colorCanvas = null, normalCanvas = null;
    if (bakeColor) colorCanvas = bakeRegionCanvas(2, unionCenter.x, unionCenter.z, unionSpanX, unionSpanZ, texRes);
    if (bakeNormal) normalCanvas = bakeRegionCanvas(1, unionCenter.x, unionCenter.z, unionSpanX, unionSpanZ, texRes);

    // A multi-tile whole-terrain export has exactly one surface object. Re-map
    // every cell to the union texture before merging so boundary vertices share
    // both position and UVs, then recompute normals after welding.
    if (includeMesh && multi && !separateTileExport) {
      const surfaceMeshes = [];
      exportGroup.traverse((obj) => {
        if (obj.isMesh && /^Terrain_Tile_/.test(obj.name)) surfaceMeshes.push(obj);
      });
      if (surfaceMeshes.length) {
        const mergedParts = surfaceMeshes.map((mesh) => {
          const geo = mesh.geometry.clone();
          const pos = geo.getAttribute('position');
          const uv = geo.getAttribute('uv');
          for (let i = 0; i < pos.count; i++) {
            uv.setXY(i,
              (pos.getX(i) - (unionCenter.x - unionSpanX * 0.5)) / unionSpanX,
              (pos.getZ(i) - (unionCenter.z - unionSpanZ * 0.5)) / unionSpanZ,
            );
          }
          geo.deleteAttribute('normal');
          return geo;
        });
        const joinedGeo = mergeGeometries(mergedParts);
        const combinedGeo = mergeVertices(joinedGeo);
        joinedGeo.dispose();
        combinedGeo.computeVertexNormals();
        mergedParts.forEach((geo) => geo.dispose());

        let mergedColor = null, mergedNormal = null;
        if (colorCanvas) {
          mergedColor = new THREE.CanvasTexture(colorCanvas);
          mergedColor.colorSpace = THREE.SRGBColorSpace;
        }
        if (normalCanvas) mergedNormal = new THREE.CanvasTexture(normalCanvas);
        const mergedMaterial = new THREE.MeshStandardMaterial({
          name: 'Terrain_Material', map: mergedColor, normalMap: mergedNormal,
          roughness: 0.85, metalness: 0.05,
        });
        surfaceMeshes.forEach((mesh) => {
          exportGroup.remove(mesh);
          mesh.geometry.dispose();
          if (mesh.material.map) mesh.material.map.dispose();
          if (mesh.material.normalMap) mesh.material.normalMap.dispose();
          mesh.material.dispose();
        });
        const terrainMesh = new THREE.Mesh(combinedGeo, mergedMaterial);
        terrainMesh.name = 'Terrain_Surface';
        exportGroup.add(terrainMesh);

        // Keep the whole terrain in one mesh node even when skirts/base slabs
        // are enabled. Material groups retain the terrain texture on top and
        // the slab material on the side/bottom faces.
        const slabMeshes = [];
        exportGroup.traverse((obj) => {
          if (obj.isMesh && (/^Tile_Base_/.test(obj.name) || obj.name === 'Circular_Base_Skirt')) slabMeshes.push(obj);
        });
        if (slabMeshes.length) {
          const parts = [terrainMesh.geometry.clone(), ...slabMeshes.map((mesh) => {
            const geo = mesh.geometry.clone();
            if (!geo.getAttribute('uv')) {
              const position = geo.getAttribute('position');
              geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(position.count * 2), 2));
            }
            return geo;
          })];
          const terrainAndSlabs = mergeGeometries(parts, true);
          parts.forEach((geo) => geo.dispose());
          const materials = [terrainMesh.material, ...slabMeshes.map((mesh) => mesh.material)];
          exportGroup.remove(terrainMesh);
          terrainMesh.geometry.dispose();
          slabMeshes.forEach((mesh) => {
            exportGroup.remove(mesh);
            mesh.geometry.dispose();
          });
          const wholeTerrain = new THREE.Mesh(terrainAndSlabs, materials);
          wholeTerrain.name = 'Terrain_Surface';
          exportGroup.add(wholeTerrain);
        }
      }
    }

    // F. Add Water Mesh spanning the whole assembly
    if (!separateTileExport && exportWater && !options.excludeWaterFromExport && seaLevel > 0.5) {
      onToast('Adding water plane...');
      const waterGeo = tileShape === 'circle' ? new THREE.CircleGeometry(diskRadiusWorld, 96) : new THREE.PlaneGeometry(unionSpanX, unionSpanZ);
      waterGeo.rotateX(-Math.PI / 2);
      const waterMat = new THREE.MeshStandardMaterial({
        name: 'Water_Material', color: 0x0f5e73, roughness: 0.1, metalness: 0.8,
        transparent: true, opacity: 0.6,
      });
      const waterMesh = new THREE.Mesh(waterGeo, waterMat);
      waterMesh.name = 'Water';
      waterMesh.position.set(tileShape === 'circle' ? 0 : unionCenter.x, seaLevel, tileShape === 'circle' ? 0 : unionCenter.z);
      exportGroup.add(waterMesh);
    }

    // --- 3. Collision Mesh ---
    const buildCollisionModel = (ox, oz, sx, sz, name = 'Collision_Mesh') => {
      const { at } = bakeHeightGrid(ox, oz, sx, sz, collisionRes, collisionRes);
      const positions = [], indices = [];
      for (let j = 0; j <= collisionRes; j++) {
        const z = oz + (j / collisionRes - 0.5) * sz;
        for (let i = 0; i <= collisionRes; i++) {
          const x = ox + (i / collisionRes - 0.5) * sx;
          positions.push(x, at(i, j), z);
        }
      }
      for (let j = 0; j < collisionRes; j++) {
        for (let i = 0; i < collisionRes; i++) {
          const p0 = j * (collisionRes + 1) + i;
          const p1 = p0 + 1;
          const p2 = (j + 1) * (collisionRes + 1) + i;
          const p3 = p2 + 1;
          indices.push(p0, p2, p1, p1, p2, p3);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const model = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ name: 'Collision_Material', wireframe: true, visible: false }));
      model.name = name;
      return model;
    };
    let collisionModel = null;
    if (exportCollision && !separateTileExport) {
      onToast('Generating collision geometry...');
      collisionModel = buildCollisionModel(unionCenter.x, unionCenter.z, unionSpanX, unionSpanZ);
    }

    // Separate mode serializes a self-contained model for every occupied cell.
    // The original export group remains the owner of terrain resources; clones
    // are only used while their individual GLB/OBJ payloads are generated.
    const tilePackages = [];
    if (separateTileExport) {
      onToast('Preparing individual tile packages...');
      for (const cell of tiles) {
        const ctr = cellCenter(cell.cx, cell.cz);
        const group = new THREE.Group();
        group.name = `Terrain_Tile_${cell.cx}_${cell.cz}`;
        const surface = exportGroup.getObjectByName(`Terrain_Tile_${cell.cx}_${cell.cz}`);
        const base = exportGroup.getObjectByName(`Tile_Base_${cell.cx}_${cell.cz}`);
        if (surface) group.add(surface.clone());
        if (base) group.add(base.clone());

        let water = null;
        if (exportWater && !options.excludeWaterFromExport && seaLevel > 0.5) {
          const waterGeo = new THREE.PlaneGeometry(cellSize, cellSize);
          waterGeo.rotateX(-Math.PI / 2);
          water = new THREE.Mesh(waterGeo, new THREE.MeshStandardMaterial({
            name: 'Water_Material', color: 0x0f5e73, roughness: 0.1, metalness: 0.8,
            transparent: true, opacity: 0.6,
          }));
          water.name = 'Water';
          water.position.set(ctr.x, seaLevel, ctr.z);
          group.add(water);
        }

        const height = exportHeightmap ? bakeHeightAsset(ctr.x, ctr.z, cellSize, cellSize) : null;
        tilePackages.push({
          cell,
          group,
          water,
          colorCanvas: bakeColor ? bakeRegionCanvas(2, ctr.x, ctr.z, cellSize, cellSize, texRes) : null,
          normalCanvas: bakeNormal ? bakeRegionCanvas(1, ctr.x, ctr.z, cellSize, cellSize, texRes) : null,
          heightCanvas: height?.canvas ?? null,
          heightRaw16: height?.raw16 ?? null,
          splatCanvas: exportHeightmap && options.exportSplat
            ? bakeRegionCanvas(3, ctr.x, ctr.z, cellSize, cellSize, texRes) : null,
          collisionModel: exportCollision ? buildCollisionModel(ctr.x, ctr.z, cellSize, cellSize, `Collision_Tile_${cell.cx}_${cell.cz}`) : null,
        });
      }
    }

    // Cleanup bake resources (kept alive until here so the collision pass could
    // re-render the quad).
    bakeMat.dispose();
    quadMesh.geometry.dispose();

    // --- 4. Serialize & Download ---
    const zipFiles = {};
    const pathFor = (path) => {
      const root = options.packageRoot;
      if (!root) return path;
      if (path === root || path.startsWith(`${root}/`)) return path;
      return options.packagePaths?.[path] ?? `${root}/${path}`;
    };

    // Preset JSON
    if (exportPreset) {
      const presetData = {
        app: 'terrain-studio',
        version: 1,
        exportedAt: new Date().toISOString(),
        params: engineParams,
      };
      zipFiles[pathFor('terrain_preset.json')] = new TextEncoder().encode(JSON.stringify(presetData, null, 2));
    }

    // Textures separately in zip
    if (colorCanvas) {
      zipFiles[pathFor('textures/terrain_color.png')] = await canvasToUint8Array(colorCanvas);
    }
    if (normalCanvas) {
      zipFiles[pathFor('textures/terrain_normal.png')] = await canvasToUint8Array(normalCanvas);
    }
    if (heightCanvas) {
      if (options.heightmapRawPath && heightRaw16) zipFiles[pathFor(options.heightmapRawPath)] = heightRaw16;
      else zipFiles[pathFor('textures/terrain_heightmap.png')] = await canvasToUint8Array(heightCanvas);
    }
    if (splatCanvas) {
      zipFiles[pathFor('textures/terrain_splat.png')] = await canvasToUint8Array(splatCanvas);
    }

    // GLTF / GLB Export
    let exportedModel = null;
    let exportedCollision = null;
    const serializeModel = (model) => new Promise((resolve) => {
      if (format === 'glb') {
        new GLTFExporter().parse(
          model,
          (result) => resolve(new Uint8Array(result)),
          (err) => { console.error(err); resolve(null); },
          { binary: true, animations: [] },
        );
      } else {
        resolve(new TextEncoder().encode(new OBJExporter().parse(model)));
      }
    });
    const serializeCollision = (model) => new Promise((resolve) => {
      new GLTFExporter().parse(
        model,
        (result) => resolve(new Uint8Array(result)),
        (err) => { console.error(err); resolve(null); },
        { binary: true, animations: [] },
      );
    });

    if (includeMesh && separateTileExport) {
      for (const tile of tilePackages) {
        onToast(`Packaging tile ${tile.cell.cx}, ${tile.cell.cz}...`);
        tile.model = await serializeModel(tile.group);
      }
    } else if (includeMesh) {
      onToast(`Packaging primary ${format.toUpperCase()}...`);
      exportedModel = await serializeModel(exportGroup);
    }

    if (separateTileExport && exportCollision) {
      for (const tile of tilePackages) {
        if (tile.collisionModel) tile.collision = await serializeCollision(tile.collisionModel);
      }
    } else if (exportCollision && collisionModel) {
      onToast('Packaging collision mesh...');
      exportedCollision = await serializeCollision(collisionModel);
    }

    // Cleanup exported geometry
    exportGroup.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry.dispose();
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        materials.forEach((material) => {
          if (material.map) material.map.dispose();
          if (material.normalMap) material.normalMap.dispose();
          material.dispose();
        });
      }
    });

    if (collisionModel) {
      collisionModel.geometry.dispose();
      collisionModel.material.dispose();
    }
    for (const tile of tilePackages) {
      if (tile.water) {
        tile.water.geometry.dispose();
        tile.water.material.dispose();
      }
      if (tile.collisionModel) {
        tile.collisionModel.geometry.dispose();
        tile.collisionModel.material.dispose();
      }
    }

    // Download helpers
    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    // Download results
    const modelExt = format === 'glb' ? 'glb' : 'obj';
    if (exportedModel) {
      zipFiles[pathFor(`terrain.${modelExt}`)] = exportedModel;
    }

    if (exportedCollision) {
      zipFiles[pathFor('collision.glb')] = exportedCollision;
    }

    if (separateTileExport) {
      const manifest = createTileExportManifest(tiles, format, {
        includeMesh,
        packageRoot: options.packageRoot,
        packagePaths: options.packagePaths,
        heightmapRawPath: options.heightmapRawPath,
        exportCollision,
        exportWater: exportWater && !options.excludeWaterFromExport && seaLevel > 0.5,
        bakeColor,
        bakeNormal,
        exportHeightmap,
        exportSplat: options.exportSplat,
      });
      zipFiles[pathFor('tiles.json')] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
      for (const tile of tilePackages) {
        if (tile.model) zipFiles[pathFor(tilePackageAssetPath(tile.cell, `terrain.${modelExt}`, options))] = tile.model;
        if (tile.collision) zipFiles[pathFor(tilePackageAssetPath(tile.cell, 'collision.glb', options))] = tile.collision;
        if (tile.colorCanvas) zipFiles[pathFor(tilePackageAssetPath(tile.cell, 'textures/terrain_color.png', options))] = await canvasToUint8Array(tile.colorCanvas);
        if (tile.normalCanvas) zipFiles[pathFor(tilePackageAssetPath(tile.cell, 'textures/terrain_normal.png', options))] = await canvasToUint8Array(tile.normalCanvas);
        if (tile.heightCanvas) {
          const heightPath = tilePackageHeightmapPath(tile.cell, options);
          zipFiles[pathFor(heightPath)] = options.heightmapRawPath && tile.heightRaw16
            ? tile.heightRaw16 : await canvasToUint8Array(tile.heightCanvas);
        }
        if (tile.splatCanvas) zipFiles[pathFor(tilePackageAssetPath(tile.cell, 'textures/terrain_splat.png', options))] = await canvasToUint8Array(tile.splatCanvas);
        if (exportPreset) {
          zipFiles[pathFor(`${tileExportFolder(tile.cell)}/terrain_preset.json`)] = new TextEncoder().encode(JSON.stringify({
            app: 'terrain-studio', version: 1, exportedAt: new Date().toISOString(),
            params: engineParams, tile: tile.cell,
          }, null, 2));
        }
      }
    }

    // Water masks (and any other caller-supplied files) ride along in the same zip.
    if (options.extraZipFiles) {
      for (const [path, data] of Object.entries(options.extraZipFiles)) zipFiles[pathFor(path)] = data;
    }

    if (Object.keys(zipFiles).length > 0) {
      onToast('Compressing export package (ZIP)...');
      const zipped = zipSync(zipFiles);
      downloadBlob(new Blob([zipped]), `${options.exportPresetId && options.exportPresetId !== 'custom' ? `${options.exportPresetId}_` : ''}terrain_export-${engineParams.seed}.zip`);
    }

    onToast('Export completed successfully!');
  }
}
