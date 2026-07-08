import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { zipSync } from 'fflate';
import { COMMON_UNIFORMS_GLSL, NOISE_GLSL } from './terrainGLSL.js';
import { BIOME_GLSL } from './biomeGLSL.js';
import {
  PLANET_UNIFORMS_GLSL, PLANET_NOISE_GLSL, buildPlanetHeightGLSL,
} from './planetGLSL.js';
import {
  PALETTE_UNIFORMS_GLSL, TERRAIN_COLOR_FUNCTIONS_GLSL,
} from '../shaders/terrainColor.glsl.js';
import { PlanetHeightSampler } from './PlanetHeightSampler.js';
import { generateStackGLSL } from './noise/noiseStackCodegen.js';
import { defaultLegacyStack } from './noise/NoiseStack.js';

const DEFAULT_STACK_GLSL = generateStackGLSL(defaultLegacyStack());

// ============================================================================
// PlanetExporter: bakes the full cube-sphere planet into a single watertight
// mesh (6 faces) and downloads it as GLB / OBJ. Vertex positions come from the
// CPU PlanetHeightSampler (the exact f32 twin of the GPU height field), and
// each face's surface colour is GPU-baked into its own texture using the same
// palette + biome shaders as the live planet, so the exported model matches
// what is on screen.
// ============================================================================

// same six cube faces as PlanetWorld (full-face origin + edge vectors)
const FACES = [
  { name: 'pos_x', o: [ 1, -1, -1], u: [0, 2, 0], v: [0, 0, 2] },
  { name: 'neg_x', o: [-1, -1,  1], u: [0, 2, 0], v: [0, 0, -2] },
  { name: 'pos_y', o: [-1,  1, -1], u: [0, 0, 2], v: [2, 0, 0] },
  { name: 'neg_y', o: [-1, -1,  1], u: [0, 0, -2], v: [2, 0, 0] },
  { name: 'pos_z', o: [-1, -1,  1], u: [2, 0, 0], v: [0, 2, 0] },
  { name: 'neg_z', o: [ 1, -1, -1], u: [-2, 0, 0], v: [0, 2, 0] },
];

const BAKE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
`;

const buildBakeFragment = (planetHeightGLSL) => /* glsl */ `
  precision highp float;
  ${COMMON_UNIFORMS_GLSL}
  ${PLANET_UNIFORMS_GLSL}
  ${NOISE_GLSL}
  ${BIOME_GLSL}
  ${PLANET_NOISE_GLSL}
  ${planetHeightGLSL}
  ${PALETTE_UNIFORMS_GLSL}
  ${TERRAIN_COLOR_FUNCTIONS_GLSL}

  uniform vec3 uFaceOrigin, uFaceU, uFaceV;
  uniform float uNormalStrength, uAO;
  uniform bool uBakeLighting;
  varying vec2 vUv;

  void main() {
    vec3 cube = uFaceOrigin + vUv.x * uFaceU + vUv.y * uFaceV;
    vec3 dir = normalize(cube);

    vec3 ref = abs(dir.y) < 0.99 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);
    vec3 t1 = normalize(cross(ref, dir));
    vec3 t2 = cross(dir, t1);
    float eps = uPlanetEps;
    vec3 dA = normalize(dir + t1 * eps);
    vec3 dB = normalize(dir + t2 * eps);
    float hC = heightAt3D(dir), hA = heightAt3D(dA), hB = heightAt3D(dB);
    vec3 pC = dir*(uPlanetRadius+hC), pA = dA*(uPlanetRadius+hA), pB = dB*(uPlanetRadius+hB);
    vec3 nGeo = normalize(cross(pA-pC, pB-pC));
    if (dot(nGeo, dir) < 0.0) nGeo = -nGeo;
    float up = clamp(dot(nGeo, dir), 0.0, 1.0);
    vec3 n = normalize(mix(dir, nGeo, uNormalStrength));

    Climate cl = planetClimateAt(dir);
    BiomeWeights bw = biomeWeightsAt(cl);
    float slope = 1.0 - up;
    float hRel = hC - uSeaLevel;
    float h01 = hC / max(uHeightScale, 1e-3);
    // triplanar color-detail (matches PlanetMaterial's live shader so baked
    // textures line up): avoids the sphere xz-projection stretching
    vec3 colP = pC;
    vec3 colBlend = abs(dir);
    colBlend /= max(colBlend.x + colBlend.y + colBlend.z, 1e-4);
    vec3 colSeed = vec3(uSeedOffset, uSeedOffset.x - uSeedOffset.y);
    float jitter = (cl.region-0.5)*0.8 + (vnoiseTri(colP*0.045+colSeed, colBlend)-0.5)*0.6;
    float detail = vnoiseTri(colP*0.35 + colSeed.yzx, colBlend);
    float microN = vnoiseTri(colP*0.9, colBlend);
    TerrainColorResult tc = computeTerrainAlbedo(cl, bw, hC, hRel, h01, slope, detail, jitter, microN);

    vec3 col = tc.albedo;
    if (uBakeLighting) {
      float concave = clamp(((hA+hB)*0.5 - hC) / (uHeightScale*0.02 + 1.0), 0.0, 1.0);
      float valley = 1.0 - smoothstep(0.0, uHeightScale*0.55, hC);
      float ao = 1.0 - uAO*(concave*0.45 + valley*0.22);
      ao = applyRidgeAccent(ao, (hC - (hA+hB)*0.5) / (uHeightScale*0.02 + 1.0));
      float diff = max(dot(n, uSunDir), 0.0);
      vec3 sunCol = uTerrainSunCol * uTerrainSunIntensity;
      vec3 skyAmb = uTerrainSkyAmb * 0.50 * (up*0.5+0.5);
      vec3 bounce = uTerrainBounce * 0.25 * (1.0 - up*0.5);
      col = tc.albedo * (sunCol*diff + skyAmb + bounce) * ao;
    }
    col = pow(col, vec3(1.0/2.2));
    gl_FragColor = vec4(col, 1.0);
  }
`;

function rtToCanvas(renderer, rt, w, h) {
  const px = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const s = (h - 1 - y) * w * 4;
    img.data.set(px.subarray(s, s + w * 4), y * w * 4);
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function canvasToPng(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      const r = new FileReader();
      r.onload = () => resolve(new Uint8Array(r.result));
      r.readAsArrayBuffer(blob);
    }, 'image/png');
  });
}

export class PlanetExporter {
  static async export(renderer, params, uniforms, options, onToast, stackGLSL = DEFAULT_STACK_GLSL, stack = null) {
    const format = options.format || 'glb';
    const meshRes = parseInt(options.meshRes, 10) || 128;   // quads per face side
    const bakeColor = options.bakeColor !== false;
    const texRes = parseInt(options.texRes, 10) || 1024;
    const bakeLighting = !!options.bakeLighting;
    const exportWater = !!options.exportWater;
    const exportPreset = !!options.exportPreset;

    const radius = params.planetRadius;
    const heightScale = params.heightScale;
    const seaLevel = params.seaLevel;

    const sampler = new PlanetHeightSampler(uniforms, () => ({
      octaves: Math.round(params.octaves),
    }), stack);

    // GPU bake setup (shared across faces)
    const quadScene = new THREE.Scene();
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    quadScene.add(quadMesh);

    const bakeUniforms = {
      uFaceOrigin: { value: new THREE.Vector3() },
      uFaceU: { value: new THREE.Vector3() },
      uFaceV: { value: new THREE.Vector3() },
      uBakeLighting: { value: bakeLighting },
    };
    for (const key in uniforms) {
      const val = uniforms[key].value;
      bakeUniforms[key] = { value: (val && typeof val.clone === 'function') ? val.clone() : val };
    }
    const bakeMat = new THREE.ShaderMaterial({
      defines: { OCTAVES: Math.round(params.octaves), PLANET_MODE: 1 },
      uniforms: bakeUniforms,
      vertexShader: BAKE_VERTEX,
      fragmentShader: buildBakeFragment(buildPlanetHeightGLSL(stackGLSL.body3d)),
    });
    quadMesh.material = bakeMat;

    const group = new THREE.Group();
    group.name = 'Planet';
    const vps = meshRes + 1;
    const tmp = new THREE.Vector3();

    for (let fi = 0; fi < FACES.length; fi++) {
      const face = FACES[fi];
      onToast(`Building face ${fi + 1}/6 (${face.name})…`);
      const O = new THREE.Vector3(...face.o);
      const U = new THREE.Vector3(...face.u);
      const V = new THREE.Vector3(...face.v);

      // --- geometry (positions from the CPU sampler) ---
      const positions = new Float32Array(vps * vps * 3);
      const uvs = new Float32Array(vps * vps * 2);
      let p = 0, t = 0;
      for (let j = 0; j < vps; j++) {
        for (let i = 0; i < vps; i++) {
          const fu = i / meshRes, fv = j / meshRes;
          tmp.copy(O).addScaledVector(U, fu).addScaledVector(V, fv).normalize();
          const r = radius + sampler.heightAt3D(tmp.x, tmp.y, tmp.z);
          positions[p++] = tmp.x * r;
          positions[p++] = tmp.y * r;
          positions[p++] = tmp.z * r;
          uvs[t++] = fu; uvs[t++] = fv;
        }
      }
      const indices = [];
      for (let j = 0; j < meshRes; j++) {
        for (let i = 0; i < meshRes; i++) {
          const a = j * vps + i, b = a + 1, c = a + vps, d = c + 1;
          // CCW as seen from OUTSIDE (each face's U×V points outward), so
          // computeVertexNormals produces outward normals and the exported
          // GLB renders front faces outward — not inside-out. The live planet
          // uses DoubleSide so it never depended on this winding.
          indices.push(a, b, c, b, d, c);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();

      // --- GPU-baked colour texture for this face ---
      let map = null;
      if (bakeColor) {
        bakeUniforms.uFaceOrigin.value.copy(O);
        bakeUniforms.uFaceU.value.copy(U);
        bakeUniforms.uFaceV.value.copy(V);
        const rt = new THREE.WebGLRenderTarget(texRes, texRes);
        renderer.setRenderTarget(rt);
        renderer.render(quadScene, quadCam);
        const canvas = rtToCanvas(renderer, rt, texRes, texRes);
        renderer.setRenderTarget(null);
        rt.dispose();
        map = new THREE.CanvasTexture(canvas);
        map.colorSpace = THREE.SRGBColorSpace;
        map._canvas = canvas;   // keep for zip export
      }

      const mat = new THREE.MeshStandardMaterial({
        name: `Planet_${face.name}`,
        map, roughness: 0.9, metalness: 0.03,
        color: map ? 0xffffff : 0x8a9a6a,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `Planet_${face.name}`;
      group.add(mesh);
    }

    // --- water shell ---
    if (exportWater && seaLevel > 0.5) {
      onToast('Adding ocean shell…');
      const waterGeo = new THREE.SphereGeometry(radius + seaLevel, 128, 96);
      const waterMat = new THREE.MeshStandardMaterial({
        name: 'Planet_Ocean', color: 0x12506a,
        roughness: 0.15, metalness: 0.6, transparent: true, opacity: 0.75,
      });
      const waterMesh = new THREE.Mesh(waterGeo, waterMat);
      waterMesh.name = 'Planet_Ocean';
      group.add(waterMesh);
    }

    bakeMat.dispose();
    quadMesh.geometry.dispose();

    // --- serialize ---
    onToast(`Packaging ${format.toUpperCase()}…`);
    const zipFiles = {};

    let model = null;
    if (format === 'glb') {
      model = await new Promise((resolve) => {
        new GLTFExporter().parse(
          group,
          (res) => resolve(new Uint8Array(res)),
          (err) => { console.error(err); resolve(null); },
          { binary: true }
        );
      });
      if (model) zipFiles['planet.glb'] = model;
    } else {
      const objText = new OBJExporter().parse(group);
      zipFiles['planet.obj'] = new TextEncoder().encode(objText);
      // OBJ can't embed textures — write the baked face maps alongside
      let fi = 0;
      for (const child of group.children) {
        if (child.material?.map?._canvas) {
          zipFiles[`textures/${child.name}.png`] = await canvasToPng(child.material.map._canvas);
        }
        fi++;
      }
    }

    if (exportPreset) {
      zipFiles['planet_preset.json'] = new TextEncoder().encode(
        JSON.stringify({ app: 'terrain-studio', mode: 'planet', version: 1, params }, null, 2)
      );
    }

    // cleanup
    group.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });

    // Water masks (and any other caller-supplied files) ride along in the same zip.
    if (options.extraZipFiles) Object.assign(zipFiles, options.extraZipFiles);

    if (Object.keys(zipFiles).length > 0) {
      onToast('Compressing planet package (ZIP)…');
      const zipped = zipSync(zipFiles);
      const url = URL.createObjectURL(new Blob([zipped]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `planet_export-${params.seed}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    onToast('Planet export complete!');
  }
}
