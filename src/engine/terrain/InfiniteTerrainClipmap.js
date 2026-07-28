import * as THREE from 'three';
import {
  COMMON_UNIFORMS_GLSL,
  NOISE_GLSL,
  buildHeightGLSL,
} from './terrainGLSL.js';
import { BIOME_GLSL } from './biomeGLSL.js';
import { generateStackGLSL } from './noise/noiseStackCodegen.js';
import { defaultLegacyStack } from './noise/NoiseStack.js';

const DEFAULT_STACK_GLSL = generateStackGLSL(defaultLegacyStack());

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const buildFragment = (heightGLSL) => /* glsl */ `
precision highp float;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${BIOME_GLSL}
${heightGLSL}

uniform vec2 uClipBakeOrigin;
uniform vec2 uClipBakeSpan;
varying vec2 vUv;

void main() {
  vec2 xz = uClipBakeOrigin + vUv * uClipBakeSpan;
  Climate climate = climateAt(xz * uFrequency + uSeedOffset);
  float h01 = heightAtWithClimate(xz, climate) / max(uHeightScale, 1e-3);
  gl_FragColor = vec4(h01, climate.temp, climate.moist, climate.cont);
}
`;

const LEVEL_COUNT = 3;

/**
 * Rolling three-level terrain field cache for Infinite World.
 *
 * One level is refreshed per frame and origins are snapped to texels. Terrain
 * and water share the same uniform objects, so a completed level becomes
 * visible to both without material rebuilds or texture copies.
 */
export class InfiniteTerrainClipmap {
  constructor({
    renderer,
    uniforms,
    chunkSize,
    viewRadius,
    octaves,
    stackGLSL = DEFAULT_STACK_GLSL,
    resolutions = [512, 384, 256],
  }) {
    this.renderer = renderer;
    this.uniforms = uniforms;
    this.chunkSize = Math.max(1, chunkSize);
    this.viewRadius = Math.max(2, viewRadius);
    this.levels = [];
    this.queue = [];
    this.generation = -1;
    this._disposed = false;

    const maxSpan = this.chunkSize * (this.viewRadius * 2 + 4);
    const spans = [
      this.chunkSize * 8,
      this.chunkSize * 24,
      Math.max(this.chunkSize * 32, maxSpan),
    ];
    for (let index = 0; index < LEVEL_COUNT; index++) {
      const resolution = Math.max(64, Math.round(resolutions[index] || 256));
      const target = new THREE.WebGLRenderTarget(resolution, resolution, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        internalFormat: 'RGBA16F',
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        generateMipmaps: false,
      });
      target.texture.colorSpace = THREE.NoColorSpace;
      target.texture.name = `InfiniteTerrainFieldL${index}`;
      this.levels.push({
        index,
        resolution,
        span: spans[index],
        origin: new THREE.Vector2(),
        pendingOrigin: new THREE.Vector2(),
        ready: false,
        target,
      });
      uniforms[`uInfiniteFieldTex${index}`].value = target.texture;
    }

    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...uniforms,
        uClipBakeOrigin: { value: new THREE.Vector2() },
        uClipBakeSpan: { value: new THREE.Vector2(1, 1) },
      },
      defines: { OCTAVES: octaves },
      vertexShader: VERTEX,
      fragmentShader: buildFragment(buildHeightGLSL(stackGLSL.body2d)),
      depthTest: false,
      depthWrite: false,
    });
    this._octaves = octaves;
    this._stackSig = stackGLSL.sig;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    uniforms.uUseInfiniteFieldCache.value = 1;
    this._publishReady();
  }

  setProgram(octaves, stackGLSL = DEFAULT_STACK_GLSL) {
    if (this._disposed) return false;
    if (this._octaves === octaves && this._stackSig === stackGLSL.sig) return false;
    this._octaves = octaves;
    this._stackSig = stackGLSL.sig;
    this.material.defines.OCTAVES = octaves;
    this.material.fragmentShader = buildFragment(buildHeightGLSL(stackGLSL.body2d));
    this.material.needsUpdate = true;
    this.generation = -1;
    this.queue.length = 0;
    for (const level of this.levels) level.ready = false;
    this._publishReady();
    return true;
  }

  request(center, generation) {
    if (this._disposed) return;
    const generationChanged = generation !== this.generation;
    if (generationChanged) {
      this.generation = generation;
      this.queue.length = 0;
      for (const level of this.levels) level.ready = false;
    }

    for (const level of this.levels) {
      const texel = level.span / level.resolution;
      const snappedX = Math.floor((center.x - level.span * 0.5) / texel) * texel;
      const snappedZ = Math.floor((center.z - level.span * 0.5) / texel) * texel;
      const margin = level.span * 0.22;
      const insideStableRegion = level.ready
        && center.x >= level.origin.x + margin
        && center.x <= level.origin.x + level.span - margin
        && center.z >= level.origin.y + margin
        && center.z <= level.origin.y + level.span - margin;
      if (generationChanged || !insideStableRegion) {
        level.pendingOrigin.set(snappedX, snappedZ);
        if (!this.queue.includes(level.index)) this.queue.push(level.index);
      }
    }
    this._publishReady();
  }

  update(center, generation) {
    this.request(center, generation);
    if (!this.queue.length) return false;
    const index = this.queue.shift();
    const level = this.levels[index];
    const previousTarget = this.renderer.getRenderTarget();
    const u = this.material.uniforms;
    u.uClipBakeOrigin.value.copy(level.pendingOrigin);
    u.uClipBakeSpan.value.setScalar(level.span);
    try {
      this.renderer.setRenderTarget(level.target);
      this.renderer.render(this.scene, this.camera);
    } finally {
      this.renderer.setRenderTarget(previousTarget);
    }
    level.origin.copy(level.pendingOrigin);
    level.ready = true;
    this.uniforms[`uInfiniteFieldOrigin${index}`].value.copy(level.origin);
    this.uniforms[`uInfiniteFieldSpan${index}`].value.setScalar(level.span);
    this._publishReady();
    return true;
  }

  _publishReady() {
    const ready = this.uniforms.uInfiniteFieldReady.value;
    ready.set(
      this.levels[0]?.ready ? 1 : 0,
      this.levels[1]?.ready ? 1 : 0,
      this.levels[2]?.ready ? 1 : 0,
    );
  }

  diagnostics() {
    return {
      generation: this.generation,
      pendingLevels: [...this.queue],
      levels: this.levels.map((level) => ({
        resolution: level.resolution,
        span: level.span,
        ready: level.ready,
        origin: { x: level.origin.x, z: level.origin.y },
      })),
    };
  }

  dispose() {
    this._disposed = true;
    this.uniforms.uUseInfiniteFieldCache.value = 0;
    this.uniforms.uInfiniteFieldReady.value.set(0, 0, 0);
    for (const level of this.levels) level.target.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.levels = [];
    this.queue = [];
  }
}
