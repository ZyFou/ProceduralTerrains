import * as THREE from 'three';
import { COMMON_UNIFORMS_GLSL, NOISE_GLSL } from './terrainGLSL.js';
import { BIOME_GLSL } from './biomeGLSL.js';
import {
  PLANET_UNIFORMS_GLSL, PLANET_NOISE_GLSL, buildPlanetHeightGLSL,
} from './planetGLSL.js';
import { generateStackGLSL } from './noise/noiseStackCodegen.js';
import { defaultLegacyStack } from './noise/NoiseStack.js';

const DEFAULT_STACK_GLSL = generateStackGLSL(defaultLegacyStack());

// ============================================================================
// Planet height/normal cubemap baker.
//
// The planet height field is a pure (static) function of a unit sphere
// direction, yet the terrain + water fragment shaders re-evaluate it ~46 noise
// octaves deep FOR EVERY PIXEL, EVERY FRAME — the terrain fragment even does it
// three times (centre + two neighbours) to build the analytic normal. When the
// camera is close, the globe fills the screen and that per-pixel cost (not the
// triangle count) is what halves the framerate.
//
// This baker evaluates the field once into a cubemap whenever it actually
// changes (seed / shape / biome edits — tracked by the engine's terrain
// generation counter). Restore the stable packed representation:
//   RGB = geometric surface normal (encoded * 0.5 + 0.5)
//   A   = height / heightScale
//
// Resolution note: at 1024/face the equator is sampled ~4096× — finer than the
// full-LOD mesh (~2k verts around) and finer than the analytic normal epsilon
// (uPlanetEps), so this is a performance win with no visible quality loss.
//
// The bake is rendered with a CubeCamera at the origin looking at a unit box
// (BackSide). A box gives EXACT ray directions per fragment (normalize of the
// linearly-interpolated planar position) with only 12 triangles, and the
// CubeCamera provides the six face orientations. The engine renders one face
// per frame: first a 256px preview, then the requested full-resolution cube.
// ============================================================================

const BAKE_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;                       // origin-centred box → position is the ray
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const buildBakeFragment = (planetHeightGLSL) => /* glsl */ `
precision highp float;

${COMMON_UNIFORMS_GLSL}
${PLANET_UNIFORMS_GLSL}
${NOISE_GLSL}
${BIOME_GLSL}
${PLANET_NOISE_GLSL}
${planetHeightGLSL}

varying vec3 vDir;

void main() {
  vec3 dir = normalize(vDir);

  vec3 ref = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(ref, dir));
  vec3 t2 = cross(dir, t1);
  float eps = uPlanetEps;
  vec3 dA = normalize(dir + t1 * eps);
  vec3 dB = normalize(dir + t2 * eps);
  float hC = heightAt3D(dir);
  float hA = heightAt3D(dA);
  float hB = heightAt3D(dB);
  vec3 pC = dir * (uPlanetRadius + hC);
  vec3 pA = dA * (uPlanetRadius + hA);
  vec3 pB = dB * (uPlanetRadius + hB);
  vec3 nGeo = normalize(cross(pA - pC, pB - pC));
  if (dot(nGeo, dir) < 0.0) nGeo = -nGeo;
  float h01 = hC / max(uHeightScale, 1e-3);
  gl_FragColor = vec4(nGeo * 0.5 + 0.5, h01);
}
`;

export class PlanetHeightBaker {
  /**
   * @param {object} opts
   * @param {THREE.WebGLRenderer} opts.renderer
   * @param {object} opts.uniforms   shared terrain uniforms (live objects)
   * @param {number} [opts.size]     cube face resolution (default 1024)
   */
  constructor({ renderer, uniforms, size = 1024, previewSize = 256, requirePrepared = false }) {
    this.renderer = renderer;
    this.uniforms = uniforms;
    this.size = size;
    this._requirePrepared = requirePrepared;

    this.previewSize = Math.min(size, Math.max(16, previewSize));
    this.previewTarget = this._makeTarget(this.previewSize, 'PlanetHeightNormalPreviewRGBA16F');
    this.target = this._makeTarget(size, 'PlanetHeightNormalRGBA16F');
    this.previewCamera = new THREE.CubeCamera(0.05, 10, this.previewTarget);
    this.cubeCam = new THREE.CubeCamera(0.05, 10, this.target);

    this.bakeScene = new THREE.Scene();
    this.material = null;   // built on first bake so OCTAVES matches the params
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    this.mesh.frustumCulled = false;
    this.bakeScene.add(this.mesh);

    this._octaves = -1;
    this._stackSig = null;
    this._programSerial = 0;
    this._programPrepared = false;
    this._phase = 'idle';
    this._face = 0;
    this._texture = null;
  }

  get texture() { return this._texture; }
  get phase() { return this._phase; }
  get ready() { return !!this._texture; }
  get complete() { return this._phase === 'complete'; }

  _makeTarget(size, name) {
    const target = new THREE.WebGLCubeRenderTarget(size, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    target.texture.colorSpace = THREE.NoColorSpace;
    target.texture.name = name;
    return target;
  }

  _makeProgramMaterial(octaves, stackGLSL) {
    return new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      defines: { OCTAVES: octaves, PLANET_MODE: 1 },
      vertexShader: BAKE_VERTEX,
      fragmentShader: buildBakeFragment(buildPlanetHeightGLSL(stackGLSL.body3d)),
      side: THREE.BackSide,
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
    this._programPrepared = false;
    this._programSerial++;
  }

  prepareProgram(octaves, stackGLSL = DEFAULT_STACK_GLSL) {
    const programSig = stackGLSL.heightSig || stackGLSL.sig;
    const serial = ++this._programSerial;
    const current = this._programPrepared
      && this._octaves === octaves
      && this._stackSig === programSig;
    if (current) return { serial, current: true, octaves, stackSig: programSig, passes: [] };
    const material = this._makeProgramMaterial(octaves, stackGLSL);
    const preview = this.previewSize < this.size;
    const cubeCamera = preview ? this.previewCamera : this.cubeCam;
    const renderTarget = preview ? this.previewTarget : this.target;
    if (cubeCamera.parent === null) cubeCamera.updateMatrixWorld();
    if (cubeCamera.coordinateSystem !== this.renderer.coordinateSystem) {
      cubeCamera.coordinateSystem = this.renderer.coordinateSystem;
      cubeCamera.updateCoordinateSystem();
    }
    return {
      serial, current: false, material, octaves, stackSig: programSig,
      passes: [{
        scene: this.bakeScene, camera: cubeCamera.children[0], mesh: this.mesh,
        material, renderTarget, activeCubeFace: 0, activeMipmapLevel: 0, disableXr: true,
      }],
    };
  }

  publishPrepared(handle) {
    if (!handle || handle.serial !== this._programSerial) return false;
    if (!handle.current) {
      const previous = this.material;
      this.material = handle.material;
      this.mesh.material = this.material;
      this._octaves = handle.octaves;
      this._stackSig = handle.stackSig;
      handle.published = true;
      previous?.dispose();
    }
    this._programPrepared = true;
    return true;
  }

  discardPrepared(handle) {
    if (handle?.material && !handle.published && handle.material !== this.material) {
      handle.material.dispose();
    }
  }
  /** Start a progressive bake. One call to step() renders exactly one face. */
  begin(octaves, stackGLSL = DEFAULT_STACK_GLSL) {
    const programSig = stackGLSL.heightSig || stackGLSL.sig;
    if (this._requirePrepared && (!this._programPrepared
        || !this.material || this._octaves !== octaves || this._stackSig !== programSig)) {
      return false;
    }
    this._ensureMaterial(octaves, stackGLSL);
    this._texture = null;
    this._phase = this.previewSize < this.size ? 'preview' : 'full';
    this._face = 0;
  }

  step() {
    if (this._phase === 'idle' || this._phase === 'complete') {
      return { updated: false, ready: this.ready, complete: this.complete, texture: this.texture };
    }
    const preview = this._phase === 'preview';
    const cubeCamera = preview ? this.previewCamera : this.cubeCam;
    const target = preview ? this.previewTarget : this.target;
    this._renderFace(cubeCamera, target, this._face);
    this._face += 1;

    if (this._face >= 6) {
      target.texture.needsPMREMUpdate = true;
      this._texture = target.texture;
      if (preview) {
        this._phase = 'full';
        this._face = 0;
      } else {
        this._phase = 'complete';
      }
    }
    return {
      updated: true,
      ready: this.ready,
      complete: this.complete,
      texture: this.texture,
      phase: this._phase,
      face: this._face,
    };
  }

  _renderFace(cubeCamera, target, face) {
    const r = this.renderer;
    if (cubeCamera.parent === null) cubeCamera.updateMatrixWorld();
    if (cubeCamera.coordinateSystem !== r.coordinateSystem) {
      cubeCamera.coordinateSystem = r.coordinateSystem;
      cubeCamera.updateCoordinateSystem();
    }
    const previousTarget = r.getRenderTarget();
    const previousFace = r.getActiveCubeFace?.() ?? 0;
    const previousMip = r.getActiveMipmapLevel?.() ?? 0;
    const previousXr = r.xr?.enabled;
    try {
      if (r.xr) r.xr.enabled = false;
      r.setRenderTarget(target, face, 0);
      r.render(this.bakeScene, cubeCamera.children[face]);
    } finally {
      r.setRenderTarget(previousTarget, previousFace, previousMip);
      if (r.xr && previousXr !== undefined) r.xr.enabled = previousXr;
    }
  }

  /** Compatibility helper for tools that explicitly request a blocking bake. */
  bake(octaves, stackGLSL = DEFAULT_STACK_GLSL) {
    this.begin(octaves, stackGLSL);
    while (!this.complete) this.step();
  }

  dispose() {
    this.previewTarget.dispose();
    this.target.dispose();
    this.mesh.geometry.dispose();
    if (this.material) this.material.dispose();
    this.material = null;
  }
}
