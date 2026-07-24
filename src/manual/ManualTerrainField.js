import * as THREE from 'three';
import {
  blendManualShapeHeight,
  evaluateManualShapeSample,
} from './ManualShapeCatalog.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smoothstep = (value) => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

function resolutionForTier(gpuTier) {
  if (gpuTier === 'low') return 384;
  if (gpuTier === 'medium') return 512;
  return 640;
}

function typedArrayToBase64(array) {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function base64ToFloat32(base64) {
  if (typeof base64 !== 'string' || !base64) return null;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  if (bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) return null;
  const copy = bytes.slice();
  return new Float32Array(copy.buffer);
}

export class ManualTerrainField {
  constructor({ uniforms, getBounds, gpuTier = 'high', resolution }) {
    this.uniforms = uniforms;
    this.getBounds = getBounds;
    this.resolution = resolution || resolutionForTier(gpuTier);
    this.shapeHeight = new Float32Array(this.resolution * this.resolution);
    this.sculptDelta = new Float32Array(this.resolution * this.resolution);
    this.heightDelta = new Float32Array(this.resolution * this.resolution);
    this.heightData = new Uint16Array(this.resolution * this.resolution * 4);
    this.origin = { x: 0, z: 0 };
    this.span = { x: 1, z: 1 };
    this.revision = 0;
    this.sculptRevision = 0;

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

  _composeIndex(index) {
    this.heightDelta[index] = this.shapeHeight[index] + this.sculptDelta[index];
    this.heightData[index * 4] = THREE.DataUtils.toHalfFloat(this.heightDelta[index]);
    this.heightData[index * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
  }

  _composeAll() {
    for (let index = 0; index < this.heightDelta.length; index++) this._composeIndex(index);
    this.texture.needsUpdate = true;
  }

  _upload() {
    this._composeAll();
  }

  rebuild(shapes) {
    this._syncBounds();
    this.shapeHeight.fill(0);
    const resolution = this.resolution;
    const maxX = resolution - 1;
    const maxY = resolution - 1;

    for (const shape of shapes) {
      if (shape.enabled === false || shape.opacity <= 0) continue;
      const radius = Math.max(shape.scale.x, shape.scale.z) * 1.2;
      const minPx = clamp(Math.floor(((shape.position.x - radius - this.origin.x) / this.span.x) * maxX), 0, maxX);
      const maxPx = clamp(Math.ceil(((shape.position.x + radius - this.origin.x) / this.span.x) * maxX), 0, maxX);
      const minPy = clamp(Math.floor(((shape.position.z - radius - this.origin.z) / this.span.z) * maxY), 0, maxY);
      const maxPy = clamp(Math.ceil(((shape.position.z + radius - this.origin.z) / this.span.z) * maxY), 0, maxY);

      for (let py = minPy; py <= maxPy; py++) {
        const z = this.origin.z + (py / maxY) * this.span.z;
        const row = py * resolution;
        for (let px = minPx; px <= maxPx; px++) {
          const x = this.origin.x + (px / maxX) * this.span.x;
          const index = row + px;
          const sample = evaluateManualShapeSample(shape, x, z);
          this.shapeHeight[index] = blendManualShapeHeight(this.shapeHeight[index], shape, sample);
        }
      }
    }

    this._composeAll();
    this.revision++;
  }

  worldToPixel(x, z) {
    return {
      px: ((x - this.origin.x) / this.span.x) * (this.resolution - 1),
      py: ((z - this.origin.z) / this.span.z) * (this.resolution - 1),
    };
  }

  _sampleArray(array, px, py) {
    const ix = clamp(Math.round(px), 0, this.resolution - 1);
    const iy = clamp(Math.round(py), 0, this.resolution - 1);
    return array[iy * this.resolution + ix];
  }

  stamp({
    x,
    z,
    radius,
    strength,
    falloff,
    tool,
    targetHeight = 0,
  }) {
    const center = this.worldToPixel(x, z);
    const pixelRadius = Math.max(1, radius / Math.max(this.span.x, this.span.z) * this.resolution);
    const minX = clamp(Math.floor(center.px - pixelRadius), 0, this.resolution - 1);
    const maxX = clamp(Math.ceil(center.px + pixelRadius), 0, this.resolution - 1);
    const minY = clamp(Math.floor(center.py - pixelRadius), 0, this.resolution - 1);
    const maxY = clamp(Math.ceil(center.py + pixelRadius), 0, this.resolution - 1);
    const sourceSculpt = tool === 'smooth' || tool === 'erode' ? this.sculptDelta.slice() : this.sculptDelta;
    const sourceTotal = tool === 'smooth' || tool === 'erode' ? this.heightDelta.slice() : this.heightDelta;

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const distance = Math.hypot(px - center.px, py - center.py);
        if (distance > pixelRadius) continue;
        const radial = 1 - distance / pixelRadius;
        const softness = Math.max(0.02, falloff);
        const alpha = smoothstep(radial / softness) * clamp(strength, 0.01, 1);
        if (alpha <= 0) continue;
        const index = py * this.resolution + px;
        const current = this.sculptDelta[index];
        let next = current;

        if (tool === 'lower') {
          next = current - 16 * alpha;
        } else if (tool === 'flatten') {
          next = current + ((targetHeight - this.shapeHeight[index]) - current) * alpha;
        } else if (tool === 'smooth' || tool === 'erode') {
          const step = Math.max(1, Math.round(pixelRadius * 0.07));
          let sum = 0;
          let count = 0;
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              const sx = clamp(px + ox * step, 0, this.resolution - 1);
              const sy = clamp(py + oy * step, 0, this.resolution - 1);
              sum += sourceTotal[sy * this.resolution + sx];
              count++;
            }
          }
          const average = sum / Math.max(1, count);
          const desired = average - this.shapeHeight[index];
          if (tool === 'smooth') {
            next = current + (desired - current) * alpha;
          } else {
            const currentTotal = this.shapeHeight[index] + sourceSculpt[index];
            const erodedTotal = currentTotal > average
              ? average - 2.5 * alpha
              : currentTotal + (average - currentTotal) * alpha * 0.18;
            next = current + ((erodedTotal - this.shapeHeight[index]) - current) * alpha;
          }
        } else if (tool === 'erase') {
          next = current * (1 - alpha);
        } else {
          next = current + 16 * alpha;
        }

        this.sculptDelta[index] = clamp(next, -3000, 3000);
        this._composeIndex(index);
      }
    }

    this.texture.needsUpdate = true;
    this.revision++;
    this.sculptRevision++;
  }

  clearSculpt() {
    this.sculptDelta.fill(0);
    this._composeAll();
    this.revision++;
    this.sculptRevision++;
  }

  isSculptEmpty() {
    for (let index = 0; index < this.sculptDelta.length; index++) {
      if (Math.abs(this.sculptDelta[index]) > 0.0001) return false;
    }
    return true;
  }

  serializeSculpt() {
    if (this.isSculptEmpty()) return null;
    return {
      version: 1,
      resolution: this.resolution,
      data: typedArrayToBase64(this.sculptDelta),
    };
  }

  loadSculpt(input) {
    this.sculptDelta.fill(0);
    const source = input?.version === 1 ? base64ToFloat32(input.data) : null;
    const sourceResolution = Math.max(1, Math.round(Number(input?.resolution) || 0));
    if (source && source.length === sourceResolution * sourceResolution) {
      if (sourceResolution === this.resolution) {
        this.sculptDelta.set(source);
      } else {
        const targetMax = this.resolution - 1;
        const sourceMax = sourceResolution - 1;
        for (let py = 0; py < this.resolution; py++) {
          const sy = clamp(Math.round((py / targetMax) * sourceMax), 0, sourceMax);
          for (let px = 0; px < this.resolution; px++) {
            const sx = clamp(Math.round((px / targetMax) * sourceMax), 0, sourceMax);
            this.sculptDelta[py * this.resolution + px] = source[sy * sourceResolution + sx];
          }
        }
      }
    }
    this._composeAll();
    this.revision++;
    this.sculptRevision++;
    return !!source;
  }

  sampleHeightOffset(x, z) {
    const u = (x - this.origin.x) / this.span.x;
    const v = (z - this.origin.z) / this.span.z;
    if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
    return this._sampleArray(this.heightDelta, u * (this.resolution - 1), v * (this.resolution - 1));
  }

  dispose() {
    this.texture.dispose();
  }
}
