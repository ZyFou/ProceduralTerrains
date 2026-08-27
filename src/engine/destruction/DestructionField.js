import * as THREE from 'three';
import { unzlibSync, zlibSync } from 'fflate';

const MAX_RESOLUTION = 1024;
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

function angularNoise(seed, angle, steps) {
  const count = Math.max(8, Math.round(steps) || 48);
  const wrapped = ((angle / (Math.PI * 2)) + 1) % 1;
  const position = wrapped * count;
  const cell = Math.floor(position);
  const next = (cell + 1) % count;
  const t = smoothstep(position - cell);
  const a = hash01((seed | 0) + cell * 7919);
  const b = hash01((seed | 0) + next * 7919);
  return a + (b - a) * t;
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
    this._resolutionSource = null;
  }

  hasDamage() {
    for (let i = 0; i < this.delta.length; i++) {
      if (Math.abs(this.delta[i]) > 0.0001 || this.scorch[i] > 0) return true;
    }
    return false;
  }

  setResolution(resolution, { reproject = true } = {}) {
    const next = clamp(Math.round(Number(resolution)) || this.resolution, 2, MAX_RESOLUTION);
    if (next === this.resolution) return false;
    const hasDamage = this.hasDamage();
    const previous = reproject && hasDamage
      ? (this._resolutionSource ?? this.snapshot())
      : null;
    if (previous && !this._resolutionSource) this._resolutionSource = previous;
    if (!reproject || !hasDamage) this._resolutionSource = null;
    this.texture.dispose();
    this.resolution = next;
    this.delta = new Float32Array(next * next);
    this.scorch = new Uint8Array(next * next);
    this.texture = makeTexture(next);
    if (previous) this._reproject(previous);
    this.enabled = previous ? this.hasDamage() : false;
    this.revision++;
    this._uploadPending = true;
    return true;
  }

  setRegion(origin, span, { reproject = true } = {}) {
    const nextOrigin = { x: Number(origin?.x) || 0, z: Number(origin?.z) || 0 };
    const nextSpan = { x: Math.max(1, Number(span?.x) || 1), z: Math.max(1, Number(span?.z) || 1) };
    const same = Math.abs(nextOrigin.x - this.origin.x) < 1e-6
      && Math.abs(nextOrigin.z - this.origin.z) < 1e-6
      && Math.abs(nextSpan.x - this.span.x) < 1e-6
      && Math.abs(nextSpan.z - this.span.z) < 1e-6;
    if (same) return false;

    this._resolutionSource = null;
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

  stampCrater({
    x,
    z,
    radius,
    depth,
    rimHeight,
    scorch = 0.75,
    shape = 'bowl',
    falloff = 0.72,
    seed = 1,
    sampleGrid = 1,
    angularSteps = 48,
    processingPadding = 2,
  }) {
    this._resolutionSource = null;
    const center = this.worldToPixel(x, z);
    const rx = Math.max(1, radius / this.span.x * (this.resolution - 1));
    const ry = Math.max(1, radius / this.span.z * (this.resolution - 1));
    const padding = clamp(Math.round(processingPadding) || 0, 0, 8);
    const minX = clamp(Math.floor(center.x - rx) - padding, 0, this.resolution - 1);
    const maxX = clamp(Math.ceil(center.x + rx) + padding, 0, this.resolution - 1);
    const minY = clamp(Math.floor(center.y - ry) - padding, 0, this.resolution - 1);
    const maxY = clamp(Math.ceil(center.y + ry) + padding, 0, this.resolution - 1);
    const patch = this.capturePatch(minX, maxX, minY, maxY);
    const grid = clamp(Math.round(sampleGrid) || 1, 1, 4);
    const invSamples = 1 / (grid * grid);
    const softness = clamp(Number(falloff) || 0.72, 0.1, 1);
    const bowlRadius = shape === 'punch' ? 0.68 : 0.7 + softness * 0.12;
    const bowlPower = shape === 'punch' ? 0.72 : shape === 'ragged' ? 1.55 : 2;
    const irregularAmount = shape === 'ragged' ? 0.38 : shape === 'punch' ? 0.08 : 0.18;
    const edgeWidth = 0.025 + softness * 0.075;

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        let heightContribution = 0;
        let burnContribution = 0;
        let contributed = false;
        for (let sy = 0; sy < grid; sy++) {
          for (let sx = 0; sx < grid; sx++) {
            const offsetX = (sx + 0.5) / grid - 0.5;
            const offsetY = (sy + 0.5) / grid - 0.5;
            const nx = (px + offsetX - center.x) / rx;
            const ny = (py + offsetY - center.y) / ry;
            const distance = Math.hypot(nx, ny);
            if (distance > 1.25) continue;
            const angle = Math.atan2(ny, nx);
            const irregularity = 1 - irregularAmount * 0.5
              + angularNoise(seed, angle, angularSteps) * irregularAmount;
            const warped = distance / irregularity;
            if (warped > 1) continue;
            const bowlT = 1 - smoothstep(warped / bowlRadius);
            const bowl = -Math.max(0, depth) * (bowlT ** bowlPower);
            const rimDistance = (warped - 0.84) / 0.095;
            const rim = Math.max(0, rimHeight) * Math.exp(-(rimDistance ** 2));
            const edge = 1 - smoothstep((warped - (1 - edgeWidth)) / edgeWidth);
            heightContribution += (bowl + rim) * edge;
            burnContribution += Math.max(0, scorch) * (1 - smoothstep(warped)) * 255;
            contributed = true;
          }
        }
        if (!contributed) continue;
        const index = py * this.resolution + px;
        this.delta[index] = clamp(this.delta[index] + heightContribution * invSamples, -3000, 3000);
        const burn = burnContribution * invSamples;
        this.scorch[index] = Math.max(this.scorch[index], Math.round(clamp(burn, 0, 255)));
      }
    }

    this.enabled = true;
    this.revision++;
    this._uploadPending = true;
    return patch;
  }

  /**
   * Settle only the contribution added since `patch` was captured. This keeps
   * repeated explosions cumulative without progressively softening old craters.
   */
  finalizeCrater(patch, { iterations = 1, blend = 0.28 } = {}) {
    if (!patch?.delta || !patch?.scorch || patch.width < 3 || patch.height < 3) return false;
    const passes = clamp(Math.round(iterations) || 0, 0, 4);
    const amount = clamp(Number(blend) || 0, 0, 1);
    if (!passes || !amount) return false;
    this._resolutionSource = null;

    const size = patch.width * patch.height;
    let contribution = new Float32Array(size);
    let burn = new Float32Array(size);
    for (let row = 0; row < patch.height; row++) {
      const source = (patch.minY + row) * this.resolution + patch.minX;
      const target = row * patch.width;
      for (let column = 0; column < patch.width; column++) {
        const local = target + column;
        const global = source + column;
        contribution[local] = this.delta[global] - patch.delta[local];
        burn[local] = this.scorch[global] > patch.scorch[local] ? this.scorch[global] : 0;
      }
    }

    const blur = (source) => {
      const output = source.slice();
      for (let row = 1; row < patch.height - 1; row++) {
        for (let column = 1; column < patch.width - 1; column++) {
          const index = row * patch.width + column;
          const weighted = source[index - patch.width - 1]
            + source[index - patch.width + 1]
            + source[index + patch.width - 1]
            + source[index + patch.width + 1]
            + 2 * (source[index - patch.width] + source[index - 1]
              + source[index + 1] + source[index + patch.width])
            + 4 * source[index];
          output[index] = source[index] + (weighted / 16 - source[index]) * amount;
        }
      }
      return output;
    };

    for (let pass = 0; pass < passes; pass++) {
      contribution = blur(contribution);
      burn = blur(burn);
    }

    for (let row = 0; row < patch.height; row++) {
      const target = (patch.minY + row) * this.resolution + patch.minX;
      const source = row * patch.width;
      for (let column = 0; column < patch.width; column++) {
        const local = source + column;
        const global = target + column;
        this.delta[global] = clamp(patch.delta[local] + contribution[local], -3000, 3000);
        this.scorch[global] = Math.max(patch.scorch[local], Math.round(clamp(burn[local], 0, 255)));
      }
    }

    this.enabled = true;
    this.revision++;
    this._uploadPending = true;
    return true;
  }

  smoothEdges({ iterations = 1, blend = 0.32 } = {}) {
    if (!this.hasDamage()) return false;
    let minX = this.resolution;
    let minY = this.resolution;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < this.resolution; y++) {
      for (let x = 0; x < this.resolution; x++) {
        const index = y * this.resolution + x;
        if (Math.abs(this.delta[index]) <= 0.0001 && this.scorch[index] === 0) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < minX || maxY < minY) return false;
    const padding = clamp(Math.round(iterations) + 2, 3, 8);
    minX = clamp(minX - padding, 0, this.resolution - 1);
    maxX = clamp(maxX + padding, 0, this.resolution - 1);
    minY = clamp(minY - padding, 0, this.resolution - 1);
    maxY = clamp(maxY + padding, 0, this.resolution - 1);
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    return this.finalizeCrater({
      minX,
      minY,
      width,
      height,
      delta: new Float32Array(width * height),
      scorch: new Uint8Array(width * height),
    }, { iterations, blend });
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
    this._resolutionSource = null;
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
    this._resolutionSource = null;
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
    this._resolutionSource = null;
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
      this._resolutionSource = null;
      return true;
    } catch {
      this.delta.fill(0);
      this.scorch.fill(0);
      this.enabled = false;
      this.revision++;
      this._uploadPending = true;
      this._resolutionSource = null;
      return false;
    }
  }

  dispose() {
    this.texture.dispose();
    this.delta = null;
    this.scorch = null;
  }
}
