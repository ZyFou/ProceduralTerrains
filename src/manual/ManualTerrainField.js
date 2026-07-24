import * as THREE from 'three';
import { evaluateManualShape } from './ManualShapeCatalog.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function resolutionForTier(gpuTier) {
  if (gpuTier === 'low') return 384;
  if (gpuTier === 'medium') return 512;
  return 640;
}

export class ManualTerrainField {
  constructor({ uniforms, getBounds, gpuTier = 'high', resolution }) {
    this.uniforms = uniforms;
    this.getBounds = getBounds;
    this.resolution = resolution || resolutionForTier(gpuTier);
    this.heightDelta = new Float32Array(this.resolution * this.resolution);
    this.heightData = new Uint16Array(this.resolution * this.resolution * 4);
    this.origin = { x: 0, z: 0 };
    this.span = { x: 1, z: 1 };
    this.revision = 0;

    this.texture = new THREE.DataTexture(
      this.heightData,
      this.resolution,
      this.resolution,
      THREE.RGBAFormat,
      THREE.HalfFloatType,
    );
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this._upload();
    this._bindUniforms();
  }

  _bindUniforms() {
    this.uniforms.uManualHeightTexture.value = this.texture;
    this.uniforms.uManualOrigin.value.set(this.origin.x, this.origin.z);
    this.uniforms.uManualSpan.value.set(this.span.x, this.span.z);
  }

  _syncBounds() {
    const bounds = this.getBounds();
    this.origin = { x: Number(bounds?.origin?.x) || 0, z: Number(bounds?.origin?.z) || 0 };
    this.span = {
      x: Math.max(1, Number(bounds?.span?.x) || 1),
      z: Math.max(1, Number(bounds?.span?.z) || 1),
    };
    this.uniforms.uManualOrigin.value.set(this.origin.x, this.origin.z);
    this.uniforms.uManualSpan.value.set(this.span.x, this.span.z);
  }

  _upload() {
    const toHalf = THREE.DataUtils.toHalfFloat;
    const halfOne = toHalf(1);
    for (let index = 0; index < this.heightDelta.length; index++) {
      const offset = index * 4;
      this.heightData[offset] = toHalf(this.heightDelta[index]);
      this.heightData[offset + 3] = halfOne;
    }
    this.texture.needsUpdate = true;
  }

  rebuild(shapes) {
    this._syncBounds();
    this.heightDelta.fill(0);
    const resolution = this.resolution;
    const maxX = resolution - 1;
    const maxY = resolution - 1;

    for (const shape of shapes) {
      const radius = Math.max(shape.scale.x, shape.scale.z) * 1.14;
      const minPx = clamp(Math.floor(((shape.position.x - radius - this.origin.x) / this.span.x) * maxX), 0, maxX);
      const maxPx = clamp(Math.ceil(((shape.position.x + radius - this.origin.x) / this.span.x) * maxX), 0, maxX);
      const minPy = clamp(Math.floor(((shape.position.z - radius - this.origin.z) / this.span.z) * maxY), 0, maxY);
      const maxPy = clamp(Math.ceil(((shape.position.z + radius - this.origin.z) / this.span.z) * maxY), 0, maxY);

      for (let py = minPy; py <= maxPy; py++) {
        const z = this.origin.z + (py / maxY) * this.span.z;
        const row = py * resolution;
        for (let px = minPx; px <= maxPx; px++) {
          const x = this.origin.x + (px / maxX) * this.span.x;
          this.heightDelta[row + px] += evaluateManualShape(shape, x, z);
        }
      }
    }

    this._upload();
    this.revision++;
  }

  sampleHeightOffset(x, z) {
    const u = (x - this.origin.x) / this.span.x;
    const v = (z - this.origin.z) / this.span.z;
    if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
    const px = clamp(Math.round(u * (this.resolution - 1)), 0, this.resolution - 1);
    const py = clamp(Math.round(v * (this.resolution - 1)), 0, this.resolution - 1);
    return this.heightDelta[py * this.resolution + px];
  }

  dispose() {
    this.texture.dispose();
  }
}
