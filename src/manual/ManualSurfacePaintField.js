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

  _writeWeights(pixelIndex, weights) {
    const coverage = clamp(weights.reduce((sum, value) => sum + Math.max(0, value), 0), 0, 1);
    const ranked = weights
      .map((value, channel) => ({ channel, value: Math.max(0, value) }))
      .sort((a, b) => b.value - a.value);
    const kept = ranked.slice(0, 2);
    const keptSum = kept.reduce((sum, item) => sum + item.value, 0);
    const scale = keptSum > 1e-6 ? coverage / keptSum : 0;
    const next = new Array(CHANNEL_COUNT).fill(0);
    for (const item of kept) next[item.channel] = item.value * scale;
    for (let channel = 0; channel < CHANNEL_COUNT; channel++) this._writeChannel(pixelIndex, channel, next[channel]);
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
    const sourceA = tool === 'blend' ? this.weightsA.slice() : this.weightsA;
    const sourceB = tool === 'blend' ? this.weightsB.slice() : this.weightsB;
    const sampleStep = Math.max(1, Math.round(pixelRadius * 0.06));

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const alpha = this._brushAlpha(Math.hypot(px - center.px, py - center.py), pixelRadius, falloff, strength);
        if (alpha <= 0) continue;
        const pixelIndex = py * this.resolution + px;
        const current = this._readWeights(pixelIndex, sourceA, sourceB);

        if (tool === 'erase') {
          this._writeWeights(pixelIndex, current.map((weight) => weight * (1 - alpha)));
          continue;
        }

        if (tool === 'blend') {
          const average = new Array(CHANNEL_COUNT).fill(0);
          let count = 0;
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              const sx = clamp(px + ox * sampleStep, 0, this.resolution - 1);
              const sy = clamp(py + oy * sampleStep, 0, this.resolution - 1);
              const sample = this._readWeights(sy * this.resolution + sx, sourceA, sourceB);
              for (let c = 0; c < CHANNEL_COUNT; c++) average[c] += sample[c];
              count++;
            }
          }
          this._writeWeights(pixelIndex, current.map((weight, c) => weight + (average[c] / count - weight) * alpha));
          continue;
        }

        const next = current.map((weight) => weight * (1 - alpha));
        next[channel] += alpha;
        this._writeWeights(pixelIndex, next);
      }
    }

    this.textureA.needsUpdate = true;
    this.textureB.needsUpdate = true;
    this.revision++;
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
