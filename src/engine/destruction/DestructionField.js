import * as THREE from 'three';
import { unzlibSync, zlibSync } from 'fflate';

const MAX_RESOLUTION = 640;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smoothstep = (value) => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function hash01(value) {
  let n = Math.imul(value | 0, 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 0xffffffff;
}

function makeTexture(resolution) {
  const data = new Uint16Array(resolution * resolution * 4);
  const texture = new THREE.DataTexture(data, resolution, resolution, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function destructionResolutionForTier(gpuTier) {
  if (gpuTier === 'low') return 384;
  if (gpuTier === 'medium') return 512;
  return 640;
}

/** Additive, Studio-only crater and scorch field. */
export class DestructionField {
  constructor({ resolution = 512 } = {}) {
    this.resolution = clamp(Math.round(resolution) || 512, 2, MAX_RESOLUTION);
    this.origin = { x: 0, z: 0 };
    this.span = { x: 1, z: 1 };
    this.delta = new Float32Array(this.resolution * this.resolution);
    this.scorch = new Uint8Array(this.resolution * this.resolution);
    this.texture = makeTexture(this.resolution);
    this.enabled = false;
    this.active = true;
    this.revision = 0;
    this._uploadPending = true;
  }

  hasDamage() {
    for (let i = 0; i < this.delta.length; i++) {
      if (Math.abs(this.delta[i]) > 0.0001 || this.scorch[i] > 0) return true;
    }
    return false;
  }

  setRegion(origin, span, { reproject = true } = {}) {
    const nextOrigin = { x: Number(origin?.x) || 0, z: Number(origin?.z) || 0 };
    const nextSpan = { x: Math.max(1, Number(span?.x) || 1), z: Math.max(1, Number(span?.z) || 1) };
    const same = Math.abs(nextOrigin.x - this.origin.x) < 1e-6
      && Math.abs(nextOrigin.z - this.origin.z) < 1e-6
      && Math.abs(nextSpan.x - this.span.x) < 1e-6
      && Math.abs(nextSpan.z - this.span.z) < 1e-6;
    if (same) return false;

    const previous = reproject && this.hasDamage() ? this.snapshot() : null;
    this.origin = nextOrigin;
    this.span = nextSpan;
    if (previous) this._reproject(previous);
    this._uploadPending = true;
    return true;
  }

  _reproject(previous) {
    this.delta.fill(0);
    this.scorch.fill(0);
    const max = this.resolution - 1;
    for (let py = 0; py <= max; py++) {
      const z = this.origin.z + (py / max) * this.span.z;
      for (let px = 0; px <= max; px++) {
        const x = this.origin.x + (px / max) * this.span.x;
        const sample = DestructionField.sampleSnapshot(previous, x, z);
        const index = py * this.resolution + px;
        this.delta[index] = sample.delta;
        this.scorch[index] = Math.round(sample.scorch * 255);
      }
    }
  }

  worldToPixel(x, z) {
    return {
      x: ((x - this.origin.x) / this.span.x) * (this.resolution - 1),
      y: ((z - this.origin.z) / this.span.z) * (this.resolution - 1),
    };
  }

  stampCrater({ x, z, radius, depth, rimHeight, scorch = 0.75, shape = 'bowl', falloff = 0.72, seed = 1 }) {
    const center = this.worldToPixel(x, z);
    const rx = Math.max(1, radius / this.span.x * (this.resolution - 1));
    const ry = Math.max(1, radius / this.span.z * (this.resolution - 1));
    const minX = clamp(Math.floor(center.x - rx), 0, this.resolution - 1);
    const maxX = clamp(Math.ceil(center.x + rx), 0, this.resolution - 1);
    const minY = clamp(Math.floor(center.y - ry), 0, this.resolution - 1);
    const maxY = clamp(Math.ceil(center.y + ry), 0, this.resolution - 1);
    const patch = this.capturePatch(minX, maxX, minY, maxY);

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const nx = (px - center.x) / rx;
        const ny = (py - center.y) / ry;
        const distance = Math.hypot(nx, ny);
        if (distance > 1) continue;
        const index = py * this.resolution + px;
        const angle = Math.atan2(ny, nx);
        const angularCell = Math.floor((angle + Math.PI) * 17.5);
        const irregularAmount = shape === 'ragged' ? 0.38 : shape === 'punch' ? 0.08 : 0.18;
        const irregularity = 1 - irregularAmount * 0.5 + hash01((seed | 0) + angularCell * 7919) * irregularAmount;
        const warped = distance / irregularity;
        if (warped > 1) continue;
        const softness = clamp(Number(falloff) || 0.72, 0.1, 1);
        const bowlRadius = shape === 'punch' ? 0.68 : 0.7 + softness * 0.12;
        const bowlT = 1 - smoothstep(warped / bowlRadius);
        const bowlPower = shape === 'punch' ? 0.72 : shape === 'ragged' ? 1.55 : 2;
        const bowl = -Math.max(0, depth) * (bowlT ** bowlPower);
        const rimDistance = (warped - 0.84) / 0.095;
        const rim = Math.max(0, rimHeight) * Math.exp(-(rimDistance ** 2));
        const edgeWidth = 0.025 + softness * 0.075;
        const edge = 1 - smoothstep((warped - (1 - edgeWidth)) / edgeWidth);
        this.delta[index] = clamp(this.delta[index] + (bowl + rim) * edge, -3000, 3000);
        const burn = Math.max(0, scorch) * (1 - smoothstep(warped)) * 255;
        this.scorch[index] = Math.max(this.scorch[index], Math.round(clamp(burn, 0, 255)));
      }
    }

    this.enabled = true;
    this.revision++;
    this._uploadPending = true;
    return patch;
  }

  capturePatch(minX, maxX, minY, maxY) {
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const delta = new Float32Array(width * height);
    const scorch = new Uint8Array(width * height);
    for (let row = 0; row < height; row++) {
      const source = (minY + row) * this.resolution + minX;
      delta.set(this.delta.subarray(source, source + width), row * width);
      scorch.set(this.scorch.subarray(source, source + width), row * width);
    }
    return { minX, minY, width, height, delta, scorch };
  }

  restorePatch(patch) {
    if (!patch?.delta || !patch?.scorch) return false;
    for (let row = 0; row < patch.height; row++) {
      const target = (patch.minY + row) * this.resolution + patch.minX;
      const source = row * patch.width;
      this.delta.set(patch.delta.subarray(source, source + patch.width), target);
      this.scorch.set(patch.scorch.subarray(source, source + patch.width), target);
    }
    this.enabled = this.hasDamage();
    this.revision++;
    this._uploadPending = true;
    return true;
  }

  clear() {
    const snapshot = this.hasDamage() ? this.snapshot() : null;
    this.delta.fill(0);
    this.scorch.fill(0);
    this.enabled = false;
    this.revision++;
    this._uploadPending = true;
    return snapshot;
  }

  snapshot() {
    return {
      resolution: this.resolution,
      origin: { ...this.origin },
      span: { ...this.span },
      delta: this.delta.slice(),
      scorch: this.scorch.slice(),
      enabled: this.enabled,
    };
  }

  restoreSnapshot(snapshot) {
    if (!snapshot || snapshot.resolution !== this.resolution
        || snapshot.delta?.length !== this.delta.length
        || snapshot.scorch?.length !== this.scorch.length) return false;
    this.origin = { ...snapshot.origin };
    this.span = { ...snapshot.span };
    this.delta.set(snapshot.delta);
    this.scorch.set(snapshot.scorch);
    this.enabled = snapshot.enabled !== false && this.hasDamage();
    this.revision++;
    this._uploadPending = true;
    return true;
  }

  static sampleSnapshot(snapshot, x, z) {
    const u = (x - snapshot.origin.x) / snapshot.span.x;
    const v = (z - snapshot.origin.z) / snapshot.span.z;
    if (u < 0 || u > 1 || v < 0 || v > 1) return { delta: 0, scorch: 0 };
    const n = snapshot.resolution;
    const fx = u * (n - 1);
    const fy = v * (n - 1);
    const x0 = clamp(Math.floor(fx), 0, n - 1);
    const y0 = clamp(Math.floor(fy), 0, n - 1);
    const x1 = Math.min(n - 1, x0 + 1);
    const y1 = Math.min(n - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const sample = (array) => {
      const top = array[y0 * n + x0] + (array[y0 * n + x1] - array[y0 * n + x0]) * tx;
      const bottom = array[y1 * n + x0] + (array[y1 * n + x1] - array[y1 * n + x0]) * tx;
      return top + (bottom - top) * ty;
    };
    return { delta: sample(snapshot.delta), scorch: sample(snapshot.scorch) / 255 };
  }

  offsetAt(x, z) {
    if (!this.enabled || !this.active) return 0;
    return DestructionField.sampleSnapshot(this, x, z).delta;
  }

  flushUploads() {
    if (!this._uploadPending) return false;
    const out = this.texture.image.data;
    for (let i = 0; i < this.delta.length; i++) {
      out[i * 4] = THREE.DataUtils.toHalfFloat(this.delta[i]);
      out[i * 4 + 1] = THREE.DataUtils.toHalfFloat(this.scorch[i] / 255);
      out[i * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
    }
    this.texture.needsUpdate = true;
    this._uploadPending = false;
    return true;
  }

  applyTo(uniforms, active = true) {
    if (!uniforms) return;
    this.active = !!active;
    uniforms.uDestructionTexture.value = this.texture;
    uniforms.uDestructionOrigin.value.set(this.origin.x, this.origin.z);
    uniforms.uDestructionSpan.value.set(this.span.x, this.span.z);
    uniforms.uDestructionEnabled.value = this.active && this.enabled ? 1 : 0;
  }

  serialize({ jsonSafe = true } = {}) {
    if (!this.hasDamage()) return null;
    if (!jsonSafe) return this.snapshot();
    const deltaBytes = new Uint8Array(this.delta.buffer, this.delta.byteOffset, this.delta.byteLength);
    return {
      version: 1,
      encoding: 'deflate-base64',
      resolution: this.resolution,
      origin: { ...this.origin },
      span: { ...this.span },
      delta: bytesToBase64(zlibSync(deltaBytes, { level: 6 })),
      scorch: bytesToBase64(zlibSync(this.scorch, { level: 6 })),
      enabled: this.enabled,
    };
  }

  restore(document) {
    if (!document) { this.clear(); return false; }
    try {
      if (document.version !== 1 || document.encoding !== 'deflate-base64') throw new Error('Unsupported destruction document');
      const resolution = Math.round(Number(document.resolution));
      if (resolution < 2 || resolution > MAX_RESOLUTION) throw new Error('Invalid destruction resolution');
      const deltaCompressed = base64ToBytes(document.delta);
      const scorchCompressed = base64ToBytes(document.scorch);
      if (!deltaCompressed || !scorchCompressed) throw new Error('Invalid destruction data');
      const expectedDeltaBytes = resolution * resolution * 4;
      const expectedScorchBytes = resolution * resolution;
      if (deltaCompressed.byteLength > expectedDeltaBytes + 1024 || scorchCompressed.byteLength > expectedScorchBytes + 1024) {
        throw new Error('Invalid destruction data size');
      }
      const deltaBytes = unzlibSync(deltaCompressed);
      const scorch = unzlibSync(scorchCompressed);
      if (deltaBytes.byteLength !== expectedDeltaBytes || scorch.byteLength !== expectedScorchBytes) throw new Error('Invalid destruction data size');
      const copied = deltaBytes.slice();
      const source = {
        resolution,
        origin: { x: Number(document.origin?.x) || 0, z: Number(document.origin?.z) || 0 },
        span: { x: Math.max(1, Number(document.span?.x) || 1), z: Math.max(1, Number(document.span?.z) || 1) },
        delta: new Float32Array(copied.buffer),
        scorch,
        enabled: document.enabled !== false,
      };
      if (resolution === this.resolution) {
        this.origin = source.origin;
        this.span = source.span;
        this.delta.set(source.delta);
        this.scorch.set(source.scorch);
      } else {
        this._reproject(source);
      }
      this.enabled = source.enabled && this.hasDamage();
      this.revision++;
      this._uploadPending = true;
      return true;
    } catch {
      this.delta.fill(0);
      this.scorch.fill(0);
      this.enabled = false;
      this.revision++;
      this._uploadPending = true;
      return false;
    }
  }

  dispose() {
    this.texture.dispose();
    this.delta = null;
    this.scorch = null;
  }
}
