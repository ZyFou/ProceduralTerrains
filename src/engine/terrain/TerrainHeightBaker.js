import * as THREE from 'three';
import { COMMON_UNIFORMS_GLSL, NOISE_GLSL, buildHeightGLSL } from './terrainGLSL.js';
import { BIOME_GLSL } from './biomeGLSL.js';
import { generateStackGLSL } from './noise/noiseStackCodegen.js';
import { defaultLegacyStack } from './noise/NoiseStack.js';

const DEFAULT_STACK_GLSL = generateStackGLSL(defaultLegacyStack());

// ============================================================================
// Studio (flat board) height baker — the 2D analog of
// PlanetHeightBaker. The studio terrain + water fragment shaders re-evaluate
// the full ~46-octave height field FOR EVERY PIXEL, EVERY FRAME (the terrain
// fragment does it three times to build the analytic normal). Whenever the
// camera orbits or the player walks, that per-pixel cost — not the triangle
// count — is what drops the framerate on weak GPUs.
//
// This baker evaluates the field once into a 2D texture whenever it actually
// changes (seed / shape / biome / paint edits, tracked by the engine's terrain
// generation counter). The R16F texture stores height / heightScale in its red
// channel. Visible shaders reconstruct geometric normals from neighbouring
// samples, so the procedural field is evaluated once rather than three times
// per baked texel while the target uses one quarter of the previous memory.
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

void main() {
  vec2 bakeUv = uBakeUvTransform.xy + vUv * uBakeUvTransform.zw;
  vec2 xz = uBakeOrigin + bakeUv * max(uBakeSpan, vec2(1.0));
  float h01 = heightAt(xz) / max(uHeightScale, 1e-3);
  gl_FragColor = vec4(h01, 0.0, 0.0, 1.0);
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
    climate.erosion
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
   * @param {number} [opts.previewSize] longest edge of the immediate preview
   */
  constructor({
    renderer,
    uniforms,
    size = 2048,
    maxSize = 4096,
    previewSize = 384,
  }) {
    this.renderer = renderer;
    this.uniforms = uniforms;
    this._baseSize = size;
    this._maxSize = maxSize;
    this._texW = size;
    this._texH = size;
    this._biomeW = 512;
    this._biomeH = 512;
    this._previewBaseSize = previewSize;
    this._previewW = previewSize;
    this._previewH = previewSize;
    this._previewBiomeW = Math.max(64, Math.round(previewSize * 0.5));
    this._previewBiomeH = Math.max(64, Math.round(previewSize * 0.5));
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
    this.previewTarget = this._makeTarget(
      this._previewW,
      this._previewH,
      'TerrainHeightPreviewR16F',
    );
    this.previewBiomeTarget = this._makeBiomeTarget(
      this._previewBiomeW,
      this._previewBiomeH,
      'TerrainBiomeClimatePreview',
    );

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
  }

  get texture() { return this.target.texture; }
  get biomeTexture() { return this.biomeTarget.texture; }
  get previewTexture() { return this.previewTarget.texture; }
  get previewBiomeTexture() { return this.previewBiomeTarget.texture; }

  _makeTarget(w, h, name = 'TerrainHeightR16F') {
    const target = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RedFormat,
      internalFormat: 'R16F',
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

    // The preview always covers the complete new union, but caps its longest
    // edge so regeneration/expansion only requires two small immediate passes.
    const previewW = Math.max(64, Math.round(this._previewBaseSize * cols / maxCells));
    const previewH = Math.max(64, Math.round(this._previewBaseSize * rows / maxCells));
    if (this.previewTarget.width !== previewW || this.previewTarget.height !== previewH) {
      this.previewTarget.dispose();
      this.previewTarget = this._makeTarget(previewW, previewH, 'TerrainHeightPreviewR16F');
    }
    this._previewW = previewW;
    this._previewH = previewH;

    const previewBiomeW = Math.max(64, Math.round(previewW * 0.5));
    const previewBiomeH = Math.max(64, Math.round(previewH * 0.5));
    if (this.previewBiomeTarget.width !== previewBiomeW
        || this.previewBiomeTarget.height !== previewBiomeH) {
      this.previewBiomeTarget.dispose();
      this.previewBiomeTarget = this._makeBiomeTarget(
        previewBiomeW,
        previewBiomeH,
        'TerrainBiomeClimatePreview',
      );
    }
    this._previewBiomeW = previewBiomeW;
    this._previewBiomeH = previewBiomeH;
  }

  _ensureMaterial(octaves, stackGLSL) {
    if (this.material && this._octaves === octaves && this._stackSig === stackGLSL.sig) return;
    if (this.material) this.material.dispose();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...this.uniforms,                // share the live height uniforms
        uBakeUvTransform: this._bakeUvTransform,
      },
      defines: { OCTAVES: octaves },     // no INFINITE_MODE → island falloff applies
      vertexShader: BAKE_VERTEX,
      fragmentShader: buildBakeFragment(buildHeightGLSL(stackGLSL.body2d)),
      depthTest: false,
      depthWrite: false,
    });
    this.mesh.material = this.material;
    this._octaves = octaves;
    this._stackSig = stackGLSL.sig;
  }

  /**
   * Start a progressive bake. Existing textures remain hidden by the Engine
   * until every stripe has completed, so consumers never sample a half-written
   * terrain field.
   */
  begin(octaves, stackGLSL = DEFAULT_STACK_GLSL, cols = 1, rows = 1) {
    this._ensureTargetSize(cols, rows);
    this._ensureMaterial(octaves, stackGLSL);
    // Publishable same-frame approximation. This uses the exact height/climate
    // logic over the complete new bounds, only at a lower spatial resolution.
    // The high-quality targets remain progressive and double-buffered below.
    this._renderStripe(
      this.previewTarget,
      this.material,
      this._previewW,
      this._previewH,
      0,
      this._previewH,
    );
    this._renderStripe(
      this.previewBiomeTarget,
      this.biomeMaterial,
      this._previewBiomeW,
      this._previewBiomeH,
      0,
      this._previewBiomeH,
    );
    this._bakeUvTransform.value.set(0, 0, 1, 1);
    this._activeJob = {
      id: ++this._jobSerial,
      pass: 'height',
      row: 0,
    };
    return {
      id: this._activeJob.id,
      heightTexture: this.previewTexture,
      biomeTexture: this.previewBiomeTexture,
    };
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

  dispose() {
    this.target.dispose();
    this._writeTarget.dispose();
    this.biomeTarget.dispose();
    this._writeBiomeTarget.dispose();
    this.previewTarget.dispose();
    this.previewBiomeTarget.dispose();
    this.mesh.geometry.dispose();
    if (this.material) this.material.dispose();
    this.biomeMaterial.dispose();
    this.material = null;
    this._activeJob = null;
  }
}
