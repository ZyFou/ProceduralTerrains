import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { zipSync } from 'fflate';
import { COMMON_UNIFORMS_GLSL, NOISE_GLSL, HEIGHT_GLSL } from './terrainGLSL.js';
import { BIOME_GLSL } from './biomeGLSL.js';
import {
  PALETTE_UNIFORMS_GLSL,
  TERRAIN_COLOR_FUNCTIONS_GLSL,
} from '../shaders/terrainColor.glsl.js';

// Quad shaders for baking
const BAKE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const BAKE_FRAGMENT = /* glsl */ `
  precision highp float;

  ${COMMON_UNIFORMS_GLSL}
  ${NOISE_GLSL}
  ${BIOME_GLSL}
  ${HEIGHT_GLSL}
  ${PALETTE_UNIFORMS_GLSL}
  ${TERRAIN_COLOR_FUNCTIONS_GLSL}

  uniform float uAO;
  uniform float uNormalStrength;
  uniform float uEps;
  uniform float uBoardSize;
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
    // Map UV back to world coordinates centered on board
    vec2 xz = (vUv - 0.5) * uBoardSize;

    Climate cl = climateAt(xz * uFrequency + uSeedOffset);
    BiomeWeights bw = biomeWeightsAt(cl);

    float eps = uEps;
    float hC = shapeHeight(xz, cl);
    float hX = shapeHeight(xz + vec2(eps, 0.0), cl);
    float hZ = shapeHeight(xz + vec2(0.0, eps), cl);

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

    TerrainColorResult tc = computeTerrainAlbedo(xz, cl, bw, hC, hRel, h01, slope, detail, jitter);

    if (uBakeMode == 2) {
      if (uBakeLighting) {
        float concave = clamp(((hX + hZ) * 0.5 - hC) / (eps * 0.9), 0.0, 1.0);
        float valley = 1.0 - smoothstep(0.0, uHeightScale * 0.55, hC);
        float ao = 1.0 - uAO * (concave * 0.45 + valley * 0.22);
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
  static async export(renderer, engineParams, engineUniforms, boardSize, options, onToast) {
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
      fragmentShader: BAKE_FRAGMENT
    });
    quadMesh.material = bakeMat;

    // A. Render High-Precision Heightmap (needed for mesh deformation and heightmap file export)
    // To map N segments perfectly, we need N+1 vertices. Hence target height size is meshRes + 1.
    const hSize = meshRes + 1;
    const heightRT = new THREE.WebGLRenderTarget(hSize, hSize, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter
    });
    bakeUniforms.uBakeMode.value = 0;
    renderer.setRenderTarget(heightRT);
    renderer.render(quadScene, quadCam);
    
    // Read back height pixels
    const heightPixels = new Uint8Array(hSize * hSize * 4);
    renderer.readRenderTargetPixels(heightRT, 0, 0, hSize, hSize, heightPixels);
    renderer.setRenderTarget(null);

    // Helper to get float height at (i, j) vertex coordinates
    function getHeightAt(i, j) {
      const idx = (j * hSize + i) * 4;
      const r = heightPixels[idx];
      const g = heightPixels[idx + 1];
      const b = heightPixels[idx + 2];
      const h01 = (r * 65536 + g * 256 + b) / 16777215;
      return h01 * heightScale;
    }

    // B. Bake Color Map
    let colorCanvas = null;
    if (bakeColor) {
      onToast('Baking color map...');
      const colorRT = new THREE.WebGLRenderTarget(texRes, texRes);
      bakeUniforms.uBakeMode.value = 2;
      renderer.setRenderTarget(colorRT);
      renderer.render(quadScene, quadCam);
      colorCanvas = rtToCanvas(renderer, colorRT, texRes, texRes);
      renderer.setRenderTarget(null);
      colorRT.dispose();
    }

    // C. Bake Normal Map
    let normalCanvas = null;
    if (bakeNormal) {
      onToast('Baking normal map...');
      const normalRT = new THREE.WebGLRenderTarget(texRes, texRes);
      bakeUniforms.uBakeMode.value = 1;
      renderer.setRenderTarget(normalRT);
      renderer.render(quadScene, quadCam);
      normalCanvas = rtToCanvas(renderer, normalRT, texRes, texRes);
      renderer.setRenderTarget(null);
      normalRT.dispose();
    }

    // D. Bake Heightmap Canvas for separate image export
    let heightCanvas = null;
    if (exportHeightmap) {
      onToast('Baking grayscale heightmap...');
      // Render standard 8-bit visual heightmap or simple orthographic capture
      const visualRT = new THREE.WebGLRenderTarget(texRes, texRes);
      // We can use a shader logic or just copy height values directly to a gray canvas
      // Let's implement height mode to write grayscale albedo in bake shader
      bakeUniforms.uBakeMode.value = 0;
      renderer.setRenderTarget(visualRT);
      renderer.render(quadScene, quadCam);
      
      const visualPixels = new Uint8Array(texRes * texRes * 4);
      renderer.readRenderTargetPixels(visualRT, 0, 0, texRes, texRes, visualPixels);
      renderer.setRenderTarget(null);
      visualRT.dispose();

      heightCanvas = document.createElement('canvas');
      heightCanvas.width = texRes;
      heightCanvas.height = texRes;
      const ctx = heightCanvas.getContext('2d');
      const img = ctx.createImageData(texRes, texRes);
      for (let y = 0; y < texRes; y++) {
        const srcRow = (texRes - 1 - y) * texRes * 4;
        const dstRow = y * texRes * 4;
        for (let x = 0; x < texRes; x++) {
          const sIdx = srcRow + x * 4;
          const dIdx = dstRow + x * 4;
          // Unpack depth to value
          const r = visualPixels[sIdx];
          const g = visualPixels[sIdx + 1];
          const b = visualPixels[sIdx + 2];
          const val = Math.round(((r * 65536 + g * 256 + b) / 16777215) * 255);
          img.data[dIdx] = val;
          img.data[dIdx + 1] = val;
          img.data[dIdx + 2] = val;
          img.data[dIdx + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }

    // E. Bake Splat / Biome map
    let splatCanvas = null;
    if (exportHeightmap && options.exportSplat) {
      onToast('Baking splat map...');
      const splatRT = new THREE.WebGLRenderTarget(texRes, texRes);
      bakeUniforms.uBakeMode.value = 3;
      renderer.setRenderTarget(splatRT);
      renderer.render(quadScene, quadCam);
      splatCanvas = rtToCanvas(renderer, splatRT, texRes, texRes);
      renderer.setRenderTarget(null);
      splatRT.dispose();
    }

    // Cleanup quad resources
    bakeMat.dispose();
    quadMesh.geometry.dispose();
    heightRT.dispose();

    // --- 2. Construct 3D Mesh ---
    const exportGroup = new THREE.Group();
    exportGroup.name = 'Terrain_Board';

    let colorTex = null;
    let normalTex = null;
    if (colorCanvas) {
      colorTex = new THREE.CanvasTexture(colorCanvas);
      colorTex.colorSpace = THREE.SRGBColorSpace;
    }
    if (normalCanvas) {
      normalTex = new THREE.CanvasTexture(normalCanvas);
    }

    const terrainMaterial = new THREE.MeshStandardMaterial({
      name: 'Terrain_Material',
      map: colorTex,
      normalMap: normalTex,
      roughness: 0.85,
      metalness: 0.05
    });

    if (includeMesh) {
      onToast('Generating terrain geometry...');
      const positions = [];
      const uvs = [];
      const indices = [];

      for (let j = 0; j <= meshRes; j++) {
        const z = (j / meshRes - 0.5) * boardSize;
        const v = j / meshRes;
        for (let i = 0; i <= meshRes; i++) {
          const x = (i / meshRes - 0.5) * boardSize;
          const u = i / meshRes;
          const y = getHeightAt(i, j);

          positions.push(x, y, z);
          uvs.push(u, v);
        }
      }

      for (let j = 0; j < meshRes; j++) {
        for (let i = 0; i < meshRes; i++) {
          const p0 = j * (meshRes + 1) + i;
          const p1 = j * (meshRes + 1) + (i + 1);
          const p2 = (j + 1) * (meshRes + 1) + i;
          const p3 = (j + 1) * (meshRes + 1) + (i + 1);

          // Winding CCW from top view
          indices.push(p0, p2, p1);
          indices.push(p1, p2, p3);
        }
      }

      const terrainGeo = new THREE.BufferGeometry();
      terrainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
      terrainGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
      terrainGeo.setIndex(indices);
      terrainGeo.computeVertexNormals();

      const terrainMesh = new THREE.Mesh(terrainGeo, terrainMaterial);
      terrainMesh.name = 'Terrain_Surface';
      exportGroup.add(terrainMesh);

      // Skirts & slab
      if (includeSkirts) {
        onToast('Generating borders/skirts...');
        const slabPositions = [];
        const slabUvs = [];
        const slabIndices = [];

        const skirtDepth = Math.max(24, heightScale * 0.08);
        const baseHeight = -skirtDepth;

        // Build list of boundary vertices
        const perimeter = [];
        // Bottom (j = 0)
        for (let i = 0; i <= meshRes; i++) perimeter.push({ i, j: 0 });
        // Right (i = meshRes)
        for (let j = 1; j <= meshRes; j++) perimeter.push({ i: meshRes, j });
        // Top (j = meshRes)
        for (let i = meshRes - 1; i >= 0; i--) perimeter.push({ i, j: meshRes });
        // Left (i = 0)
        for (let j = meshRes - 1; j >= 1; j--) perimeter.push({ i: 0, j });

        const lp = perimeter.length;
        for (let k = 0; k < lp; k++) {
          const { i, j } = perimeter[k];
          const x = (i / meshRes - 0.5) * boardSize;
          const z = (j / meshRes - 0.5) * boardSize;
          const y = getHeightAt(i, j);

          slabPositions.push(x, y, z);
          slabPositions.push(x, baseHeight, z);

          const u = i / meshRes;
          const v = j / meshRes;
          slabUvs.push(u, v);
          slabUvs.push(u, v);
        }

        for (let k = 0; k < lp; k++) {
          const next = (k + 1) % lp;
          const tl = 2 * k;
          const bl = 2 * k + 1;
          const tr = 2 * next;
          const br = 2 * next + 1;

          // Outward facing quads
          slabIndices.push(tl, bl, tr);
          slabIndices.push(tr, bl, br);
        }

        // Slab bottom face
        if (includeBase) {
          const vOffset = slabPositions.length / 3;
          for (let j = 0; j <= meshRes; j++) {
            const z = (j / meshRes - 0.5) * boardSize;
            const v = j / meshRes;
            for (let i = 0; i <= meshRes; i++) {
              const x = (i / meshRes - 0.5) * boardSize;
              const u = i / meshRes;
              slabPositions.push(x, baseHeight, z);
              slabUvs.push(u, v);
            }
          }

          for (let j = 0; j < meshRes; j++) {
            for (let i = 0; i < meshRes; i++) {
              const p0 = vOffset + j * (meshRes + 1) + i;
              const p1 = vOffset + j * (meshRes + 1) + (i + 1);
              const p2 = vOffset + (j + 1) * (meshRes + 1) + i;
              const p3 = vOffset + (j + 1) * (meshRes + 1) + (i + 1);

              // Downward facing triangles (clockwise)
              slabIndices.push(p0, p1, p2);
              slabIndices.push(p1, p3, p2);
            }
          }
        }

        const slabGeo = new THREE.BufferGeometry();
        slabGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(slabPositions), 3));
        slabGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(slabUvs), 2));
        slabGeo.setIndex(slabIndices);
        slabGeo.computeVertexNormals();

        const slabMaterial = new THREE.MeshStandardMaterial({
          name: 'Slab_Material',
          color: 0x231e19,
          roughness: 0.9,
          metalness: 0.05
        });

        const slabMesh = new THREE.Mesh(slabGeo, slabMaterial);
        slabMesh.name = 'Terrain_Base_Slab';
        exportGroup.add(slabMesh);
      }
    }

    // F. Add Water Mesh
    if (exportWater && seaLevel > 0.5) {
      onToast('Adding water plane...');
      const waterGeo = new THREE.PlaneGeometry(boardSize, boardSize);
      waterGeo.rotateX(-Math.PI / 2);
      const waterMat = new THREE.MeshStandardMaterial({
        name: 'Water_Material',
        color: 0x0f5e73,
        roughness: 0.1,
        metalness: 0.8,
        transparent: true,
        opacity: 0.6
      });
      const waterMesh = new THREE.Mesh(waterGeo, waterMat);
      waterMesh.name = 'Water_Plane';
      waterMesh.position.y = seaLevel;
      exportGroup.add(waterMesh);
    }

    // --- 3. Collision Mesh ---
    let collisionModel = null;
    if (exportCollision) {
      onToast('Generating collision geometry...');
      // Compute lower-res heightmap for collision
      const colHSize = collisionRes + 1;
      const colRT = new THREE.WebGLRenderTarget(colHSize, colHSize, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter
      });
      bakeUniforms.uBakeMode.value = 0;
      renderer.setRenderTarget(colRT);
      renderer.render(quadScene, quadCam);
      
      const colPixels = new Uint8Array(colHSize * colHSize * 4);
      renderer.readRenderTargetPixels(colRT, 0, 0, colHSize, colHSize, colPixels);
      renderer.setRenderTarget(null);
      colRT.dispose();

      function getColHeightAt(i, j) {
        const idx = (j * colHSize + i) * 4;
        const r = colPixels[idx];
        const g = colPixels[idx + 1];
        const b = colPixels[idx + 2];
        const h01 = (r * 65536 + g * 256 + b) / 16777215;
        return h01 * heightScale;
      }

      const colPositions = [];
      const colIndices = [];

      for (let j = 0; j <= collisionRes; j++) {
        const z = (j / collisionRes - 0.5) * boardSize;
        for (let i = 0; i <= collisionRes; i++) {
          const x = (i / collisionRes - 0.5) * boardSize;
          const y = getColHeightAt(i, j);
          colPositions.push(x, y, z);
        }
      }

      for (let j = 0; j < collisionRes; j++) {
        for (let i = 0; i < collisionRes; i++) {
          const p0 = j * (collisionRes + 1) + i;
          const p1 = j * (collisionRes + 1) + (i + 1);
          const p2 = (j + 1) * (collisionRes + 1) + i;
          const p3 = (j + 1) * (collisionRes + 1) + (i + 1);

          colIndices.push(p0, p2, p1);
          colIndices.push(p1, p2, p3);
        }
      }

      const colGeo = new THREE.BufferGeometry();
      colGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(colPositions), 3));
      colGeo.setIndex(colIndices);
      colGeo.computeVertexNormals();

      const colMaterial = new THREE.MeshBasicMaterial({ name: 'Collision_Material', wireframe: true, visible: false });
      collisionModel = new THREE.Mesh(colGeo, colMaterial);
      collisionModel.name = 'Collision_Mesh';
    }

    // --- 4. Serialize & Download ---
    const zipFiles = {};

    // Preset JSON
    if (exportPreset) {
      const presetData = {
        app: 'terrain-studio',
        version: 1,
        exportedAt: new Date().toISOString(),
        params: engineParams,
      };
      zipFiles['terrain_preset.json'] = new TextEncoder().encode(JSON.stringify(presetData, null, 2));
    }

    // Textures separately in zip
    if (colorCanvas) {
      zipFiles['textures/terrain_color.png'] = await canvasToUint8Array(colorCanvas);
    }
    if (normalCanvas) {
      zipFiles['textures/terrain_normal.png'] = await canvasToUint8Array(normalCanvas);
    }
    if (heightCanvas) {
      zipFiles['textures/terrain_heightmap.png'] = await canvasToUint8Array(heightCanvas);
    }
    if (splatCanvas) {
      zipFiles['textures/terrain_splat.png'] = await canvasToUint8Array(splatCanvas);
    }

    // GLTF / GLB Export
    let exportedModel = null;
    let exportedCollision = null;

    if (includeMesh) {
      onToast(`Packaging primary ${format.toUpperCase()}...`);
      exportedModel = await new Promise((resolve) => {
        if (format === 'glb') {
          const exporter = new GLTFExporter();
          exporter.parse(
            exportGroup,
            (result) => resolve(new Uint8Array(result)),
            (err) => { console.error(err); resolve(null); },
            { binary: true, animations: [] }
          );
        } else {
          const exporter = new OBJExporter();
          const objText = exporter.parse(exportGroup);
          resolve(new TextEncoder().encode(objText));
        }
      });
    }

    // Collision GLTF Export
    if (exportCollision && collisionModel) {
      onToast('Packaging collision mesh...');
      exportedCollision = await new Promise((resolve) => {
        const exporter = new GLTFExporter();
        exporter.parse(
          collisionModel,
          (result) => resolve(new Uint8Array(result)),
          (err) => { console.error(err); resolve(null); },
          { binary: true, animations: [] }
        );
      });
    }

    // Cleanup exported geometry
    exportGroup.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry.dispose();
        if (obj.material.map) obj.material.map.dispose();
        if (obj.material.normalMap) obj.material.normalMap.dispose();
        obj.material.dispose();
      }
    });

    if (collisionModel) {
      collisionModel.geometry.dispose();
      collisionModel.material.dispose();
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
      zipFiles[`terrain.${modelExt}`] = exportedModel;
    }

    if (exportedCollision) {
      zipFiles['collision.glb'] = exportedCollision;
    }

    if (Object.keys(zipFiles).length > 0) {
      onToast('Compressing export package (ZIP)...');
      const zipped = zipSync(zipFiles);
      downloadBlob(new Blob([zipped]), `terrain_export-${engineParams.seed}.zip`);
    }

    onToast('Export completed successfully!');
  }
}
