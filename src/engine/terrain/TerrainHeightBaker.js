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
// generation counter). The studio shaders then sample it with a single
// texture2D fetch:
//   RGB = geometric surface normal (encoded *0.5+0.5)
//   A   = height / heightScale   (h01, in [0, 1.35])
//
// The board spans world XZ in [-uBoardHalf, uBoardHalf]; the bake maps the
// fullscreen quad UV straight onto that range, so a later fetch by world XZ
// (uv = xz / (2*uBoardHalf) + 0.5) lines up automatically. Half-float keeps
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

uniform float uEps;
varying vec2 vUv;

void main() {
  vec2 xz = (vUv * 2.0 - 1.0) * uBoardHalf;

  float eps = uEps;
  float hC = heightAt(xz);
  float hX = heightAt(xz + vec2(eps, 0.0));
  float hZ = heightAt(xz + vec2(0.0, eps));

  // identical finite-difference normal to the live terrain fragment
  vec3 nGeo = normalize(vec3(-(hX - hC) / eps, 1.0, -(hZ - hC) / eps));

  float h01 = hC / max(uHeightScale, 1e-3);
  gl_FragColor = vec4(nGeo * 0.5 + 0.5, h01);
}
`;

export class TerrainHeightBaker {
  /**
   * @param {object} opts
   * @param {THREE.WebGLRenderer} opts.renderer
   * @param {object} opts.uniforms   shared terrain uniforms (live objects)
   * @param {number} [opts.size]     texture resolution (default 2048)
   */
  constructor({ renderer, uniforms, size = 2048 }) {
    this.renderer = renderer;
    this.uniforms = uniforms;
    this.size = size;

    this.target = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });

    this.scene = new THREE.Scene();
    this.material = null;   // built on first bake so OCTAVES matches the params
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.cam = new THREE.Camera();   // identity — the quad is already in clip space

    this._octaves = -1;
    this._stackSig = null;
  }

  get texture() { return this.target.texture; }

  _ensureMaterial(octaves, stackGLSL) {
    if (this.material && this._octaves === octaves && this._stackSig === stackGLSL.sig) return;
    if (this.material) this.material.dispose();
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,           // share the live height uniforms
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

  /** Re-evaluate the height field into the 2D texture from the current uniforms. */
  bake(octaves, stackGLSL = DEFAULT_STACK_GLSL) {
    this._ensureMaterial(octaves, stackGLSL);
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    r.setRenderTarget(this.target);
    r.render(this.scene, this.cam);
    r.setRenderTarget(prevTarget);
  }

  dispose() {
    this.target.dispose();
    this.mesh.geometry.dispose();
    if (this.material) this.material.dispose();
    this.material = null;
  }
}
