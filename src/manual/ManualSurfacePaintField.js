import * as THREE from 'three';

const CHANNEL_COUNT = 7;
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
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < array.length; index += chunk) {
    binary += String.fromCharCode(...array.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function base64ToUint8(base64) {
  if (typeof base64 !== 'string' || !base64) return null;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function makeTexture(data, resolution) {
  const texture = new THREE.DataTexture(data, resolution, resolution, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export class ManualSurfacePaintField {
  constructor({ getBounds, gpuTier = 'high', resolution }) {
    this.getBounds = getBounds;
    this.resolution = resolution || resolutionForTier(gpuTier);
    this.weightsA = new Uint8Array(this.resolution * this.resolution * 4);
    this.weightsB = new Uint8Array(this.resolution * this.resolution * 4);
    this.textureA = makeTexture(this.weightsA, this.resolution);
    this.textureB = makeTexture(this.weightsB, this.resolution);
    this.origin = { x: 0, z: 0 };
    this.span = { x: 1, z: 1 };
    this.revision = 0;
    this._uploadAPending = false;
    this._uploadBPending = false;
    this._syncBounds();
  }

  _syncBounds() {
    const bounds = this.getBounds?.() ?? {};
    this.origin = {
      x: Number(bounds.origin?.x) || 0,
      z: Number(bounds.origin?.z) || 0,
    };
    this.span = {
      x: Math.max(1, Number(bounds.span?.x) || 1),
      z: Math.max(1, Number(bounds.span?.z) || 1),
    };
  }

  bind(uniforms) {
    if (!uniforms) return;
    uniforms.uPaintBiomeTexture.value = this.textureA;
    uniforms.uPaintPropsTexture.value = this.textureB;
    uniforms.uManualSurfaceOrigin.value.set(this.origin.x, this.origin.z);
    uniforms.uManualSurfaceSpan.value.set(this.span.x, this.span.z);
  }

  worldToPixel(x, z) {
    return {
      px: ((x - this.origin.x) / this.span.x) * (this.resolution - 1),
      py: ((z - this.origin.z) / this.span.z) * (this.resolution - 1),
    };
  }

  _channelAt(pixelIndex, channel, sourceA = this.weightsA, sourceB = this.weightsB) {
    const data = channel < 4 ? sourceA : sourceB;
    return data[pixelIndex * 4 + (channel % 4)] / 255;
  }

  _writeChannel(pixelIndex, channel, value) {
    const data = channel < 4 ? this.weightsA : this.weightsB;
    data[pixelIndex * 4 + (channel % 4)] = Math.round(clamp(value, 0, 1) * 255);
  }

  _readWeights(pixelIndex, sourceA = this.weightsA, sourceB = this.weightsB) {
    return Array.from({ length: CHANNEL_COUNT }, (_, channel) => this._channelAt(pixelIndex, channel, sourceA, sourceB));
  }

  _readWeightsInto(target, pixelIndex, sourceA = this.weightsA, sourceB = this.weightsB) {
    for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
      target[channel] = this._channelAt(pixelIndex, channel, sourceA, sourceB);
    }
    return target;
  }

  _writeWeights(pixelIndex, weights) {
    let coverage = 0;
    let firstChannel = 0;
    let secondChannel = 0;
    let firstValue = -1;
    let secondValue = -1;
    for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
      const value = Math.max(0, weights[channel]);
      coverage += value;
      if (value > firstValue) {
        secondValue = firstValue;
        secondChannel = firstChannel;
        firstValue = value;
        firstChannel = channel;
      } else if (value > secondValue) {
        secondValue = value;
        secondChannel = channel;
      }
    }
    coverage = clamp(coverage, 0, 1);
    const keptSum = Math.max(0, firstValue) + Math.max(0, secondValue);
    const scale = keptSum > 1e-6 ? coverage / keptSum : 0;
    let changedA = false;
    let changedB = false;
    for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
      const next = channel === firstChannel
        ? Math.max(0, firstValue) * scale
        : channel === secondChannel
          ? Math.max(0, secondValue) * scale
          : 0;
      const data = channel < 4 ? this.weightsA : this.weightsB;
      const index = pixelIndex * 4 + (channel % 4);
      const encoded = Math.round(clamp(next, 0, 1) * 255);
      if (data[index] === encoded) continue;
      data[index] = encoded;
      if (channel < 4) changedA = true;
      else changedB = true;
    }
    return (changedA ? 1 : 0) | (changedB ? 2 : 0);
  }

  _copyRegion(source, minX, maxX, minY, maxY) {
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const sourceStart = ((minY + y) * this.resolution + minX) * 4;
      const targetStart = y * width * 4;
      data.set(source.subarray(sourceStart, sourceStart + width * 4), targetStart);
    }
    return { data, minX, minY, width, height };
  }

  _regionPixelIndex(region, px, py) {
    const x = clamp(Math.round(px) - region.minX, 0, region.width - 1);
    const y = clamp(Math.round(py) - region.minY, 0, region.height - 1);
    return y * region.width + x;
  }

  _queueUploads(changedA, changedB) {
    this._uploadAPending ||= changedA;
    this._uploadBPending ||= changedB;
  }

  flushUploads() {
    if (this._uploadAPending) this.textureA.needsUpdate = true;
    if (this._uploadBPending) this.textureB.needsUpdate = true;
    const flushed = this._uploadAPending || this._uploadBPending;
    this._uploadAPending = false;
    this._uploadBPending = false;
    return flushed;
  }

  _brushAlpha(distance, pixelRadius, falloff, strength) {
    if (distance > pixelRadius) return 0;
    const radial = 1 - distance / pixelRadius;
    return smoothstep(radial / Math.max(0.02, falloff)) * clamp(strength, 0.01, 1);
  }

  stamp({ x, z, radius, strength, falloff, tool = 'paint', materialChannel = 0 }) {
    this._syncBounds();
    const center = this.worldToPixel(x, z);
    const pixelRadius = Math.max(1, radius / Math.max(this.span.x, this.span.z) * this.resolution);
    const minX = clamp(Math.floor(center.px - pixelRadius), 0, this.resolution - 1);
    const maxX = clamp(Math.ceil(center.px + pixelRadius), 0, this.resolution - 1);
    const minY = clamp(Math.floor(center.py - pixelRadius), 0, this.resolution - 1);
    const maxY = clamp(Math.ceil(center.py + pixelRadius), 0, this.resolution - 1);
    const channel = clamp(Math.round(materialChannel) || 0, 0, CHANNEL_COUNT - 1);
    const sampleStep = Math.max(1, Math.round(pixelRadius * 0.06));
    const sourceMinX = Math.max(0, minX - sampleStep);
    const sourceMaxX = Math.min(this.resolution - 1, maxX + sampleStep);
    const sourceMinY = Math.max(0, minY - sampleStep);
    const sourceMaxY = Math.min(this.resolution - 1, maxY + sampleStep);
    const sourceA = tool === 'blend'
      ? this._copyRegion(this.weightsA, sourceMinX, sourceMaxX, sourceMinY, sourceMaxY)
      : null;
    const sourceB = tool === 'blend'
      ? this._copyRegion(this.weightsB, sourceMinX, sourceMaxX, sourceMinY, sourceMaxY)
      : null;
    const current = new Float32Array(CHANNEL_COUNT);
    const next = new Float32Array(CHANNEL_COUNT);
    const average = new Float32Array(CHANNEL_COUNT);
    const sample = new Float32Array(CHANNEL_COUNT);
    let changedA = false;
    let changedB = false;

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const alpha = this._brushAlpha(Math.hypot(px - center.px, py - center.py), pixelRadius, falloff, strength);
        if (alpha <= 0) continue;
        const pixelIndex = py * this.resolution + px;
        if (tool === 'blend') {
          this._readWeightsInto(
            current,
            this._regionPixelIndex(sourceA, px, py),
            sourceA.data,
            sourceB.data,
          );
        } else {
          this._readWeightsInto(current, pixelIndex);
        }

        if (tool === 'erase') {
          for (let c = 0; c < CHANNEL_COUNT; c++) next[c] = current[c] * (1 - alpha);
          const changed = this._writeWeights(pixelIndex, next);
          changedA ||= (changed & 1) !== 0;
          changedB ||= (changed & 2) !== 0;
          continue;
        }

        if (tool === 'blend') {
          average.fill(0);
          let count = 0;
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              const sx = clamp(px + ox * sampleStep, 0, this.resolution - 1);
              const sy = clamp(py + oy * sampleStep, 0, this.resolution - 1);
              this._readWeightsInto(
                sample,
                this._regionPixelIndex(sourceA, sx, sy),
                sourceA.data,
                sourceB.data,
              );
              for (let c = 0; c < CHANNEL_COUNT; c++) average[c] += sample[c];
              count++;
            }
          }
          for (let c = 0; c < CHANNEL_COUNT; c++) {
            next[c] = current[c] + (average[c] / count - current[c]) * alpha;
          }
          const changed = this._writeWeights(pixelIndex, next);
          changedA ||= (changed & 1) !== 0;
          changedB ||= (changed & 2) !== 0;
          continue;
        }

        for (let c = 0; c < CHANNEL_COUNT; c++) next[c] = current[c] * (1 - alpha);
        next[channel] += alpha;
        const changed = this._writeWeights(pixelIndex, next);
        changedA ||= (changed & 1) !== 0;
        changedB ||= (changed & 2) !== 0;
      }
    }

    this._queueUploads(changedA, changedB);
    if (changedA || changedB) this.revision++;
  }

  sampleWeights(x, z) {
    const { px, py } = this.worldToPixel(x, z);
    if (px < 0 || px > this.resolution - 1 || py < 0 || py > this.resolution - 1) {
      return new Array(CHANNEL_COUNT).fill(0);
    }
    const ix = clamp(Math.round(px), 0, this.resolution - 1);
    const iy = clamp(Math.round(py), 0, this.resolution - 1);
    return this._readWeights(iy * this.resolution + ix);
  }

  clear() {
    this.weightsA.fill(0);
    this.weightsB.fill(0);
    this.textureA.needsUpdate = true;
    this.textureB.needsUpdate = true;
    this.revision++;
  }

  isEmpty() {
    for (const value of this.weightsA) if (value !== 0) return false;
    for (const value of this.weightsB) if (value !== 0) return false;
    return true;
  }

  serialize() {
    if (this.isEmpty()) return null;
    return {
      version: 1,
      resolution: this.resolution,
      origin: { ...this.origin },
      span: { ...this.span },
      weightsA: typedArrayToBase64(this.weightsA),
      weightsB: typedArrayToBase64(this.weightsB),
    };
  }

  load(input) {
    this.clear();
    if (input?.version !== 1) return false;
    const sourceA = base64ToUint8(input.weightsA);
    const sourceB = base64ToUint8(input.weightsB);
    const sourceResolution = Math.max(1, Math.round(Number(input.resolution) || 0));
    if (!sourceA || !sourceB || sourceA.length !== sourceResolution * sourceResolution * 4 || sourceB.length !== sourceA.length) {
      return false;
    }
    if (sourceResolution === this.resolution) {
      this.weightsA.set(sourceA);
      this.weightsB.set(sourceB);
    } else {
      const targetMax = this.resolution - 1;
      const sourceMax = sourceResolution - 1;
      for (let py = 0; py < this.resolution; py++) {
        const sy = clamp(Math.round((py / targetMax) * sourceMax), 0, sourceMax);
        for (let px = 0; px < this.resolution; px++) {
          const sx = clamp(Math.round((px / targetMax) * sourceMax), 0, sourceMax);
          const sourceIndex = (sy * sourceResolution + sx) * 4;
          const targetIndex = (py * this.resolution + px) * 4;
          this.weightsA.set(sourceA.subarray(sourceIndex, sourceIndex + 4), targetIndex);
          this.weightsB.set(sourceB.subarray(sourceIndex, sourceIndex + 4), targetIndex);
        }
      }
    }
    this._syncBounds();
    this.textureA.needsUpdate = true;
    this.textureB.needsUpdate = true;
    this.revision++;
    return true;
  }

  dispose() {
    this.textureA.dispose();
    this.textureB.dispose();
  }
}
