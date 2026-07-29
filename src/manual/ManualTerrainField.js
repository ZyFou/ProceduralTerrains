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

const hash2 = (x, y, seed) => {
  let value = Math.imul(Math.floor(x), 374761393)
    + Math.imul(Math.floor(y), 668265263)
    + Math.imul(Math.floor(seed), 1442695041);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
};

const valueNoise2D = (x, y, seed) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = smoothstep(fx);
  const sy = smoothstep(fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return (top + (bottom - top) * sy) * 2 - 1;
};

const reliefNoise2D = (x, y, seed, roughness) => {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let weight = 0;
  const persistence = 0.25 + clamp(roughness, 0, 1) * 0.55;
  for (let octave = 0; octave < 4; octave++) {
    value += valueNoise2D(x * frequency, y * frequency, seed + octave * 1013) * amplitude;
    weight += amplitude;
    amplitude *= persistence;
    frequency *= 2.07;
  }
  return weight > 0 ? value / weight : 0;
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
    this._uploadPending = false;

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

  _queueUpload() {
    this._uploadPending = true;
  }

  flushUploads() {
    if (!this._uploadPending) return false;
    this.texture.needsUpdate = true;
    this._uploadPending = false;
    return true;
  }

  _copyHeightRegion(minX, maxX, minY, maxY) {
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const data = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      const sourceStart = (minY + y) * this.resolution + minX;
      data.set(this.heightDelta.subarray(sourceStart, sourceStart + width), y * width);
    }
    return { data, minX, minY, width, height };
  }

  _sampleRegion(region, px, py) {
    const x = clamp(Math.round(px) - region.minX, 0, region.width - 1);
    const y = clamp(Math.round(py) - region.minY, 0, region.height - 1);
    return region.data[y * region.width + x];
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

  _brushAlpha(distance, pixelRadius, falloff, strength) {
    if (distance > pixelRadius) return 0;
    const radial = 1 - distance / pixelRadius;
    const softness = Math.max(0.02, falloff);
    return smoothstep(radial / softness) * clamp(strength, 0.01, 1);
  }

  _stampErosion({
    center,
    pixelRadius,
    minX,
    maxX,
    minY,
    maxY,
    strength,
    falloff,
    iterations,
    deposition,
    talus,
  }) {
    const sourceMinX = Math.max(0, minX - 1);
    const sourceMaxX = Math.min(this.resolution - 1, maxX + 1);
    const sourceMinY = Math.max(0, minY - 1);
    const sourceMaxY = Math.min(this.resolution - 1, maxY + 1);
    const width = sourceMaxX - sourceMinX + 1;
    const height = sourceMaxY - sourceMinY + 1;
    let working = new Float32Array(width * height);
    let next = new Float32Array(width * height);

    for (let localY = 0; localY < height; localY++) {
      const sourceRow = (sourceMinY + localY) * this.resolution;
      const targetRow = localY * width;
      for (let localX = 0; localX < width; localX++) {
        working[targetRow + localX] = this.heightDelta[sourceRow + sourceMinX + localX];
      }
    }

    const passCount = clamp(Math.round(iterations) || 1, 1, 10);
    const depositRatio = clamp(deposition, 0, 1);
    const slopeThreshold = Math.max(0, Number(talus) || 0);
    for (let pass = 0; pass < passCount; pass++) {
      next.set(working);
      for (let py = minY; py <= maxY; py++) {
        const localY = py - sourceMinY;
        for (let px = minX; px <= maxX; px++) {
          const distance = Math.hypot(px - center.px, py - center.py);
          const alpha = this._brushAlpha(distance, pixelRadius, falloff, strength);
          if (alpha <= 0) continue;
          const localX = px - sourceMinX;
          const localIndex = localY * width + localX;
          const current = working[localIndex];
          let lowest = current;
          let lowestIndex = localIndex;

          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              if (ox === 0 && oy === 0) continue;
              const neighborX = localX + ox;
              const neighborY = localY + oy;
              if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) continue;
              const neighborIndex = neighborY * width + neighborX;
              const neighbor = working[neighborIndex];
              if (neighbor < lowest) {
                lowest = neighbor;
                lowestIndex = neighborIndex;
              }
            }
          }

          const mobileSlope = current - lowest - slopeThreshold;
          if (mobileSlope <= 0 || lowestIndex === localIndex) continue;
          const transported = Math.min(
            mobileSlope * 0.42,
            mobileSlope * alpha * (0.32 / Math.sqrt(passCount)),
          );
          next[localIndex] -= transported;
          next[lowestIndex] += transported * depositRatio;
        }
      }
      [working, next] = [next, working];
    }

    for (let py = minY; py <= maxY; py++) {
      const localRow = (py - sourceMinY) * width;
      const terrainRow = py * this.resolution;
      for (let px = minX; px <= maxX; px++) {
        const distance = Math.hypot(px - center.px, py - center.py);
        if (distance > pixelRadius) continue;
        const index = terrainRow + px;
        const erodedHeight = working[localRow + px - sourceMinX];
        this.sculptDelta[index] = clamp(erodedHeight - this.shapeHeight[index], -3000, 3000);
        this._composeIndex(index);
      }
    }
  }

  stamp({
    x,
    z,
    radius,
    strength,
    falloff,
    tool,
    targetHeight = 0,
    creaseWidth = 0.2,
    detailScale = 32,
    detailRoughness = 0.55,
    detailSeed = 1337,
    terraceStep = 24,
    erosionIterations = 3,
    erosionDeposition = 0.65,
    erosionTalus = 1.5,
  }) {
    const center = this.worldToPixel(x, z);
    const pixelRadius = Math.max(1, radius / Math.max(this.span.x, this.span.z) * this.resolution);
    const minX = clamp(Math.floor(center.px - pixelRadius), 0, this.resolution - 1);
    const maxX = clamp(Math.ceil(center.px + pixelRadius), 0, this.resolution - 1);
    const minY = clamp(Math.floor(center.py - pixelRadius), 0, this.resolution - 1);
    const maxY = clamp(Math.ceil(center.py + pixelRadius), 0, this.resolution - 1);
    if (tool === 'erode') {
      this._stampErosion({
        center,
        pixelRadius,
        minX,
        maxX,
        minY,
        maxY,
        strength,
        falloff,
        iterations: erosionIterations,
        deposition: erosionDeposition,
        talus: erosionTalus,
      });
      this._queueUpload();
      this.revision++;
      this.sculptRevision++;
      return;
    }
    const smoothStep = tool === 'smooth' ? Math.max(1, Math.round(pixelRadius * 0.07)) : 0;
    const sourceTotal = tool === 'smooth'
      ? this._copyHeightRegion(
        Math.max(0, minX - smoothStep),
        Math.min(this.resolution - 1, maxX + smoothStep),
        Math.max(0, minY - smoothStep),
        Math.min(this.resolution - 1, maxY + smoothStep),
      )
      : null;

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const distance = Math.hypot(px - center.px, py - center.py);
        const alpha = this._brushAlpha(distance, pixelRadius, falloff, strength);
        if (alpha <= 0) continue;
        const index = py * this.resolution + px;
        const current = this.sculptDelta[index];
        let next = current;

        if (tool === 'lower') {
          next = current - 16 * alpha;
        } else if (tool === 'flatten') {
          next = current + ((targetHeight - this.shapeHeight[index]) - current) * alpha;
        } else if (tool === 'smooth') {
          let sum = 0;
          let count = 0;
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              const sx = clamp(px + ox * smoothStep, 0, this.resolution - 1);
              const sy = clamp(py + oy * smoothStep, 0, this.resolution - 1);
              sum += this._sampleRegion(sourceTotal, sx, sy);
              count++;
            }
          }
          const average = sum / Math.max(1, count);
          const desired = average - this.shapeHeight[index];
          next = current + (desired - current) * alpha;
        } else if (tool === 'crease' || tool === 'ridge') {
          const normalizedDistance = distance / pixelRadius;
          const width = clamp(creaseWidth, 0.04, 0.8);
          const core = Math.exp(-4 * (normalizedDistance / width) ** 2);
          const rimCenter = width * 1.9;
          const rimWidth = Math.max(0.035, width * 0.62);
          const rim = Math.exp(-2.5 * ((normalizedDistance - rimCenter) / rimWidth) ** 2);
          const direction = tool === 'ridge' ? 1 : -1;
          next = current + direction * (24 * core - 5 * rim) * alpha;
        } else if (tool === 'detail') {
          const worldX = this.origin.x + (px / (this.resolution - 1)) * this.span.x;
          const worldZ = this.origin.z + (py / (this.resolution - 1)) * this.span.z;
          const frequency = 1 / Math.max(2, detailScale);
          const relief = reliefNoise2D(
            worldX * frequency,
            worldZ * frequency,
            Math.round(detailSeed),
            detailRoughness,
          );
          next = current + relief * 20 * alpha;
        } else if (tool === 'terrace') {
          const stepHeight = Math.max(1, terraceStep);
          const currentTotal = this.shapeHeight[index] + current;
          const terracedTotal = Math.round(currentTotal / stepHeight) * stepHeight;
          next = current + (terracedTotal - currentTotal) * alpha;
        } else if (tool === 'erase') {
          next = current * (1 - alpha);
        } else {
          next = current + 16 * alpha;
        }

        this.sculptDelta[index] = clamp(next, -3000, 3000);
        this._composeIndex(index);
      }
    }

    this._queueUpload();
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
