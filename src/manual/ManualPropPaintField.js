const CHANNELS = Object.freeze({ grass: 0, flowers: 1, rocks: 2, trees: 3 });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smoothstep = (value) => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};
const BOUNDS_EPSILON = 1e-6;

function boundsEqual(originA, spanA, originB, spanB) {
  return Math.abs(originA.x - originB.x) <= BOUNDS_EPSILON
    && Math.abs(originA.z - originB.z) <= BOUNDS_EPSILON
    && Math.abs(spanA.x - spanB.x) <= BOUNDS_EPSILON
    && Math.abs(spanA.z - spanB.z) <= BOUNDS_EPSILON;
}

function resolutionForTier(gpuTier) {
  if (gpuTier === 'low') return 256;
  if (gpuTier === 'medium') return 384;
  return 512;
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

export class ManualPropPaintField {
  constructor({ getBounds, gpuTier = 'high', resolution }) {
    this.getBounds = getBounds;
    this.targetResolution = resolution || resolutionForTier(gpuTier);
    this.resolution = 1;
    this.data = new Uint8Array(this.resolution * this.resolution * 4);
    this.origin = { x: 0, z: 0 };
    this.span = { x: 1, z: 1 };
    this.revision = 0;
    this._dirtyBounds = null;
    this._syncBounds();
  }

  ensureAllocated() {
    if (this.resolution === this.targetResolution) return false;
    this.resolution = this.targetResolution;
    this.data = new Uint8Array(this.resolution * this.resolution * 4);
    this._dirtyBounds = { all: true };
    return true;
  }

  _readBounds() {
    const bounds = this.getBounds?.() ?? {};
    return {
      origin: {
        x: Number(bounds.origin?.x) || 0,
        z: Number(bounds.origin?.z) || 0,
      },
      span: {
        x: Math.max(1, Number(bounds.span?.x) || 1),
        z: Math.max(1, Number(bounds.span?.z) || 1),
      },
    };
  }

  _resample(source, sourceOrigin, sourceSpan) {
    const target = new Uint8Array(this.resolution * this.resolution * 4);
    const max = this.resolution - 1;
    for (let py = 0; py < this.resolution; py++) {
      const worldZ = this.origin.z + (py / max) * this.span.z;
      const sy = Math.round(((worldZ - sourceOrigin.z) / sourceSpan.z) * max);
      if (sy < 0 || sy > max) continue;
      for (let px = 0; px < this.resolution; px++) {
        const worldX = this.origin.x + (px / max) * this.span.x;
        const sx = Math.round(((worldX - sourceOrigin.x) / sourceSpan.x) * max);
        if (sx < 0 || sx > max) continue;
        const sourceIndex = (sy * this.resolution + sx) * 4;
        const targetIndex = (py * this.resolution + px) * 4;
        target.set(source.subarray(sourceIndex, sourceIndex + 4), targetIndex);
      }
    }
    return target;
  }

  _syncBounds() {
    const next = this._readBounds();
    if (boundsEqual(this.origin, this.span, next.origin, next.span)) return false;
    const previousData = this.data;
    const previousOrigin = this.origin;
    const previousSpan = this.span;
    this.origin = next.origin;
    this.span = next.span;
    this.data = this._resample(previousData, previousOrigin, previousSpan);
    this._dirtyBounds = { all: true };
    this.revision++;
    return true;
  }

  syncBounds() { return this._syncBounds(); }

  worldToPixel(x, z) {
    return {
      px: ((x - this.origin.x) / this.span.x) * (this.resolution - 1),
      py: ((z - this.origin.z) / this.span.z) * (this.resolution - 1),
    };
  }

  sampleMask(x, z) {
    const { px, py } = this.worldToPixel(x, z);
    if (px < 0 || px > this.resolution - 1 || py < 0 || py > this.resolution - 1) {
      return { grass: 0, flowers: 0, rocks: 0, trees: 0, mixed: 0 };
    }
    const ix = clamp(Math.round(px), 0, this.resolution - 1);
    const iy = clamp(Math.round(py), 0, this.resolution - 1);
    const index = (iy * this.resolution + ix) * 4;
    return {
      grass: this.data[index] / 255,
      flowers: this.data[index + 1] / 255,
      rocks: this.data[index + 2] / 255,
      trees: this.data[index + 3] / 255,
      mixed: 0,
    };
  }

  densityForTypeAt(type, x, z) {
    const mask = this.sampleMask(x, z);
    if (type === 'grass') return mask.grass;
    if (type === 'flower') return mask.flowers;
    if (type === 'rock') return mask.rocks;
    if (type === 'broadleaf' || type === 'conifer') return mask.trees;
    return 0;
  }

  paintDensityAt(x, z) {
    const mask = this.sampleMask(x, z);
    return Math.max(mask.grass, mask.flowers, mask.rocks, mask.trees);
  }

  _markDirty(x, z, radius) {
    const next = { minX: x - radius, maxX: x + radius, minZ: z - radius, maxZ: z + radius };
    if (!this._dirtyBounds || this._dirtyBounds.all) {
      this._dirtyBounds = next;
      return;
    }
    this._dirtyBounds.minX = Math.min(this._dirtyBounds.minX, next.minX);
    this._dirtyBounds.maxX = Math.max(this._dirtyBounds.maxX, next.maxX);
    this._dirtyBounds.minZ = Math.min(this._dirtyBounds.minZ, next.minZ);
    this._dirtyBounds.maxZ = Math.max(this._dirtyBounds.maxZ, next.maxZ);
  }

  consumePropDirtyBounds() {
    const dirty = this._dirtyBounds;
    this._dirtyBounds = null;
    return dirty;
  }

  stamp({ x, z, radius, strength, falloff, tool = 'paint', propType = 'grass' }) {
    this.ensureAllocated();
    this._syncBounds();
    const center = this.worldToPixel(x, z);
    const radiusX = Math.max(1, radius / this.span.x * (this.resolution - 1));
    const radiusY = Math.max(1, radius / this.span.z * (this.resolution - 1));
    const minX = clamp(Math.floor(center.px - radiusX), 0, this.resolution - 1);
    const maxX = clamp(Math.ceil(center.px + radiusX), 0, this.resolution - 1);
    const minY = clamp(Math.floor(center.py - radiusY), 0, this.resolution - 1);
    const maxY = clamp(Math.ceil(center.py + radiusY), 0, this.resolution - 1);
    const channel = CHANNELS[propType] ?? CHANNELS.grass;
    let changed = false;

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const distance = Math.hypot((px - center.px) / radiusX, (py - center.py) / radiusY);
        if (distance > 1) continue;
        const radial = 1 - distance;
        const alpha = smoothstep(radial / Math.max(0.02, falloff)) * clamp(strength, 0.01, 1);
        if (alpha <= 0) continue;
        const index = (py * this.resolution + px) * 4;
        if (tool === 'erase') {
          for (let c = 0; c < 4; c++) {
            const next = Math.round(this.data[index + c] * (1 - alpha));
            changed ||= next !== this.data[index + c];
            this.data[index + c] = next;
          }
        } else {
          const next = Math.round(clamp(this.data[index + channel] + alpha * 255, 0, 255));
          changed ||= next !== this.data[index + channel];
          this.data[index + channel] = next;
        }
      }
    }

    if (changed) {
      this.revision++;
      this._markDirty(x, z, radius);
    }
    return changed;
  }

  clear() {
    if (this.isEmpty()) return false;
    this.data.fill(0);
    this._dirtyBounds = { all: true };
    this.revision++;
    return true;
  }

  isEmpty() {
    for (const value of this.data) if (value !== 0) return false;
    return true;
  }

  serialize() {
    if (this.isEmpty()) return null;
    return {
      version: 1,
      resolution: this.resolution,
      origin: { ...this.origin },
      span: { ...this.span },
      data: typedArrayToBase64(this.data),
    };
  }

  load(input) {
    this.data.fill(0);
    if (input?.version !== 1) {
      this._dirtyBounds = { all: true };
      this.revision++;
      return false;
    }
    const source = base64ToUint8(input.data);
    const sourceResolution = Math.max(1, Math.round(Number(input.resolution) || 0));
    if (!source || source.length !== sourceResolution * sourceResolution * 4) return false;
    this.ensureAllocated();
    this.data.fill(0);
    if (sourceResolution === this.resolution) {
      this.data.set(source);
    } else {
      const targetMax = this.resolution - 1;
      const sourceMax = sourceResolution - 1;
      for (let py = 0; py < this.resolution; py++) {
        const sy = clamp(Math.round((py / targetMax) * sourceMax), 0, sourceMax);
        for (let px = 0; px < this.resolution; px++) {
          const sx = clamp(Math.round((px / targetMax) * sourceMax), 0, sourceMax);
          const sourceIndex = (sy * sourceResolution + sx) * 4;
          const targetIndex = (py * this.resolution + px) * 4;
          this.data.set(source.subarray(sourceIndex, sourceIndex + 4), targetIndex);
        }
      }
    }
    const savedOrigin = input.origin ?? this.origin;
    const savedSpan = input.span ?? this.span;
    const current = this._readBounds();
    this.origin = { x: Number(savedOrigin.x) || 0, z: Number(savedOrigin.z) || 0 };
    this.span = { x: Math.max(1, Number(savedSpan.x) || 1), z: Math.max(1, Number(savedSpan.z) || 1) };
    if (!boundsEqual(this.origin, this.span, current.origin, current.span)) {
      const previous = this.data;
      const previousOrigin = this.origin;
      const previousSpan = this.span;
      this.origin = current.origin;
      this.span = current.span;
      this.data = this._resample(previous, previousOrigin, previousSpan);
    }
    this._dirtyBounds = { all: true };
    this.revision++;
    return true;
  }
}
