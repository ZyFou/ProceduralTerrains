import * as THREE from 'three';
import { COMMON_UNIFORMS_GLSL, NOISE_GLSL, buildHeightGLSL } from './terrainGLSL.js';
import { BIOME_GLSL } from './biomeGLSL.js';
import { generateStackGLSL } from './noise/noiseStackCodegen.js';
import { defaultLegacyStack } from './noise/NoiseStack.js';

const DEFAULT_STACK_GLSL = generateStackGLSL(defaultLegacyStack());

// ============================================================================
// Studio (flat board) height/normal baker — the 2D analog of
// PlanetHeightBaker. The studio terrain + water fragment shaders re-evaluate
// the full ~46-octave height field FOR EVERY PIXEL, EVERY FRAME (the terrain
// fragment does it three times to build the analytic normal). Whenever the
// camera orbits or the player walks, that per-pixel cost — not the triangle
// count — is what drops the framerate on weak GPUs.
//
// This baker evaluates the field once into a 2D texture whenever it actually
// changes (seed / shape / biome / paint edits, tracked by the engine's terrain
// generation counter). Restore the stable packed representation used before
// the performance passes:
//   RGB = geometric surface normal (encoded * 0.5 + 0.5)
//   A   = height / heightScale
// Baking the exact finite-difference normal keeps terrain lighting identical to
// the live field. Reconstructing it later from a filtered height-only texture
// visibly flattened the terrain and moved material/shore signals.
//
// The board spans world XZ in [-uBoardHalf, uBoardHalf]; the bake maps the
// fullscreen quad UV straight onto that range, so a later fetch by world XZ
// (uv = (xz - uBakeOrigin) / uBakeSpan) lines up automatically. Half-float keeps
// h01 precise and is linearly filterable in WebGL2.
//
// Vertex displacement stays analytic (matching PlanetMaterial), since vertex
// texture fetch is unreliable on mobile and the vertex stage is a tiny
// fraction of the per-pixel cost this removes.
// ============================================================================

const BAKE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);   // fullscreen clip-space quad
}
`;

const buildBakeFragment = (heightGLSL) => /* glsl */ `
precision highp float;

${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${BIOME_GLSL}
${heightGLSL}

varying vec2 vUv;
uniform vec4 uBakeUvTransform;
uniform float uEps;

void main() {
  vec2 bakeUv = uBakeUvTransform.xy + vUv * uBakeUvTransform.zw;
  vec2 xz = uBakeOrigin + bakeUv * max(uBakeSpan, vec2(1.0));
  float eps = uEps;
  float hC = heightAt(xz);
  float hX = heightAt(xz + vec2(eps, 0.0));
  float hZ = heightAt(xz + vec2(0.0, eps));
  vec3 nGeo = normalize(vec3(-(hX - hC) / eps, 1.0, -(hZ - hC) / eps));
  float h01 = hC / max(uHeightScale, 1e-3);
  gl_FragColor = vec4(nGeo * 0.5 + 0.5, h01);
}
`;

// Climate changes over hundreds of world units, so it does not need the
// high-resolution height target. Baking it separately keeps Studio water on a
// cheap texture lookup while preserving the exact procedural biome layout.
const BIOME_BAKE_FRAGMENT = /* glsl */ `
precision highp float;

${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${BIOME_GLSL}

varying vec2 vUv;
uniform vec4 uBakeUvTransform;

void main() {
  vec2 bakeUv = uBakeUvTransform.xy + vUv * uBakeUvTransform.zw;
  vec2 xz = uBakeOrigin + bakeUv * max(uBakeSpan, vec2(1.0));
  Climate climate = climateAt(xz * uFrequency + uSeedOffset);
  gl_FragColor = vec4(
    climate.temp,
    climate.moist,
    climate.cont,
    climate.region
  );
}
`;

export class TerrainHeightBaker {
  /**
   * @param {object} opts
   * @param {THREE.WebGLRenderer} opts.renderer
   * @param {object} opts.uniforms   shared terrain uniforms (live objects)
   * @param {number} [opts.size]     per-cell texture resolution (default 2048)
   * @param {number} [opts.maxSize]  multi-cell atlas cap (default 4096)
   */
  constructor({
    renderer,
    uniforms,
    size = 2048,
    maxSize = 4096,
    requirePrepared = false,
  }) {
    this.renderer = renderer;
    this.uniforms = uniforms;
    this._baseSize = size;
    this._maxSize = maxSize;
    this._requirePrepared = requirePrepared;
    this._texW = size;
    this._texH = size;
    this._biomeW = 512;
    this._biomeH = 512;
    this._activeJob = null;
    this._jobSerial = 0;
    this._bakeUvTransform = { value: new THREE.Vector4(0, 0, 1, 1) };

    // Double-buffer both outputs. Visible water samples `target` directly even
    // while uUseTerrainHeightTex is disabled, so progressive stripes must render
    // into a private back buffer and become visible only after both passes finish.
    this.target = this._makeTarget(size, size);
    this._writeTarget = this._makeTarget(size, size);
    this.biomeTarget = this._makeBiomeTarget(this._biomeW, this._biomeH);
    this._writeBiomeTarget = this._makeBiomeTarget(this._biomeW, this._biomeH);

    this.scene = new THREE.Scene();
    this.material = null;   // built on first bake so OCTAVES matches the params
    this.biomeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        ...this.uniforms,
        uBakeUvTransform: this._bakeUvTransform,
      },
      // NOISE_GLSL declares FBM helpers with an OCTAVES loop even though this
      // climate-only pass only calls vnoise(). Keep the unused helpers valid.
      defines: { OCTAVES: 1 },
      vertexShader: BAKE_VERTEX,
      fragmentShader: BIOME_BAKE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.cam = new THREE.Camera();   // identity — the quad is already in clip space

    this._octaves = -1;
    this._stackSig = null;
    this._programSerial = 0;
    this._biomeProgramPrepared = false;
  }

  get texture() { return this.target.texture; }
  get biomeTexture() { return this.biomeTarget.texture; }

  _makeTarget(w, h, name = 'TerrainHeightNormalRGBA16F') {
    const target = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });
    target.texture.colorSpace = THREE.NoColorSpace;
    target.texture.name = name;
    return target;
  }

  _makeBiomeTarget(w, h, name = 'TerrainBiomeClimate') {
    const target = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });
    target.texture.colorSpace = THREE.NoColorSpace;
    target.texture.name = name;
    return target;
  }

  /** Resize the bake target to cover a multi-cell union (cols × rows cells). */
  _ensureTargetSize(cols, rows) {
    const cap = Math.max(this._baseSize, this._maxSize || 4096);
    const w = Math.min(cap, this._baseSize * Math.max(1, cols));
    const h = Math.min(cap, this._baseSize * Math.max(1, rows));
    // Keep the published front target alive because visible water may still be
    // sampling it. Only resize the hidden target used by the pending bake.
    if (this._writeTarget.width !== w || this._writeTarget.height !== h) {
      this._writeTarget.dispose();
      this._writeTarget = this._makeTarget(w, h);
    }
    this._texW = w;
    this._texH = h;

    const maxCells = Math.max(1, cols, rows);
    const biomeW = Math.max(128, Math.round(512 * cols / maxCells));
    const biomeH = Math.max(128, Math.round(512 * rows / maxCells));
    if (this._writeBiomeTarget.width !== biomeW
        || this._writeBiomeTarget.height !== biomeH) {
      this._writeBiomeTarget.dispose();
      this._writeBiomeTarget = this._makeBiomeTarget(biomeW, biomeH);
    }
    this._biomeW = biomeW;
    this._biomeH = biomeH;

  }

  _makeProgramMaterial(octaves, stackGLSL) {
    return new THREE.ShaderMaterial({
      uniforms: {
        ...this.uniforms,
        uBakeUvTransform: this._bakeUvTransform,
      },
      defines: { OCTAVES: octaves },
      vertexShader: BAKE_VERTEX,
      fragmentShader: buildBakeFragment(buildHeightGLSL(stackGLSL.body2d)),
      depthTest: false,
      depthWrite: false,
    });
  }

  _ensureMaterial(octaves, stackGLSL) {
    const programSig = stackGLSL.heightSig || stackGLSL.sig;
    if (this.material && this._octaves === octaves && this._stackSig === programSig) return;
    const next = this._makeProgramMaterial(octaves, stackGLSL);
    if (this.material) this.material.dispose();
    this.material = next;
    this.mesh.material = this.material;
    this._octaves = octaves;
    this._stackSig = programSig;
    this._programSerial++;
  }

  prepareProgram(octaves, stackGLSL = DEFAULT_STACK_GLSL, cols = 1, rows = 1) {
    this._ensureTargetSize(cols, rows);
    const serial = ++this._programSerial;
    const programSig = stackGLSL.heightSig || stackGLSL.sig;
    const current = !!this.material
      && this._octaves === octaves
      && this._stackSig === programSig
      && this._biomeProgramPrepared;
    if (current) return { serial, current: true, octaves, stackSig: programSig, passes: [] };
    const material = this._makeProgramMaterial(octaves, stackGLSL);
    return {
      serial, current: false, material, octaves, stackSig: programSig,
      passes: [
        { scene: this.scene, camera: this.cam, mesh: this.mesh, material, renderTarget: this._writeTarget },
        { scene: this.scene, camera: this.cam, mesh: this.mesh, material: this.biomeMaterial, renderTarget: this._writeBiomeTarget },
      ],
    };
  }

  publishPrepared(handle) {
    if (!handle || handle.serial !== this._programSerial) return false;
    if (handle.current) return true;
    const previous = this.material;
    this.material = handle.material;
    this.mesh.material = this.material;
    this._octaves = handle.octaves;
    this._stackSig = handle.stackSig;
    this._biomeProgramPrepared = true;
    handle.published = true;
    previous?.dispose();
    return true;
  }

  discardPrepared(handle) {
    if (handle?.material && !handle.published && handle.material !== this.material) {
      handle.material.dispose();
    }
  }

  get programKey() {
    return this.material ? this._octaves + ':' + this._stackSig : null;
  }
  /**
   * Start a progressive bake without submitting GPU work. Published front
   * textures remain unchanged until every height and climate stripe completes.
   */
  begin(octaves, stackGLSL = DEFAULT_STACK_GLSL, cols = 1, rows = 1) {
    const programSig = stackGLSL.heightSig || stackGLSL.sig;
    if (this._requirePrepared && (!this._biomeProgramPrepared
        || !this.material || this._octaves !== octaves || this._stackSig !== programSig)) {
      return null;
    }
    this._ensureTargetSize(cols, rows);
    this._ensureMaterial(octaves, stackGLSL);
    this._bakeUvTransform.value.set(0, 0, 1, 1);
    this._activeJob = {
      id: ++this._jobSerial,
      pass: 'height',
      row: 0,
    };
    return this._activeJob.id;
  }

  get isBaking() { return !!this._activeJob; }

  /**
   * Render at most maxRows from the current pass. A 1536px bake split into
   * 64-row stripes yields to the browser instead of issuing one long command.
   */
  step(maxRows = 64) {
    const job = this._activeJob;
    if (!job) return { complete: true, progress: 1 };

    const isHeight = job.pass === 'height';
    const width = isHeight ? this._texW : this._biomeW;
    const height = isHeight ? this._texH : this._biomeH;
    const target = isHeight ? this._writeTarget : this._writeBiomeTarget;
    const material = isHeight ? this.material : this.biomeMaterial;
    const rows = Math.min(Math.max(1, Math.round(maxRows)), height - job.row);
    this._renderStripe(target, material, width, height, job.row, rows);
    job.row += rows;

    if (job.row >= height) {
      if (isHeight) {
        job.pass = 'biome';
        job.row = 0;
      } else {
        this._activeJob = null;
        this._bakeUvTransform.value.set(0, 0, 1, 1);
        // Publish the complete height and climate pair in one frame.
        [this.target, this._writeTarget] = [this._writeTarget, this.target];
        [this.biomeTarget, this._writeBiomeTarget] =
          [this._writeBiomeTarget, this.biomeTarget];
        return { complete: true, progress: 1 };
      }
    }

    const heightShare = 0.85;
    const progress = job.pass === 'height'
      ? heightShare * (job.row / this._texH)
      : heightShare + (1 - heightShare) * (job.row / this._biomeH);
    return { complete: false, progress, pass: job.pass };
  }

  _renderStripe(target, material, width, height, row, rows) {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevViewport = r.getViewport(new THREE.Vector4());
    const prevScissor = r.getScissor(new THREE.Vector4());
    const prevScissorTest = r.getScissorTest();
    this.mesh.material = material;
    this._bakeUvTransform.value.set(0, row / height, 1, rows / height);
    try {
      r.setRenderTarget(target);
      r.setViewport(0, row, width, rows);
      r.setScissor(0, row, width, rows);
      r.setScissorTest(true);
      r.render(this.scene, this.cam);
    } finally {
      r.setRenderTarget(prevTarget);
      r.setViewport(prevViewport);
      r.setScissor(prevScissor);
      r.setScissorTest(prevScissorTest);
      this.mesh.material = this.material;
    }
  }

  /** Synchronous compatibility path used by exports and focused tests. */
  bake(octaves, stackGLSL = DEFAULT_STACK_GLSL, cols = 1, rows = 1) {
    this.begin(octaves, stackGLSL, cols, rows);
    while (this._activeJob) this.step(Number.MAX_SAFE_INTEGER);
  }

  cancel() {
    this._activeJob = null;
    this._bakeUvTransform.value.set(0, 0, 1, 1);
  }

  dispose() {
    this.target.dispose();
    this._writeTarget.dispose();
    this.biomeTarget.dispose();
    this._writeBiomeTarget.dispose();
    this.mesh.geometry.dispose();
    if (this.material) this.material.dispose();
    this.biomeMaterial.dispose();
    this.material = null;
    this._activeJob = null;
  }
}
