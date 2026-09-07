const DEFAULT_BUDGETS = Object.freeze({
  low: 256 * 1024 * 1024,
  medium: 512 * 1024 * 1024,
  high: 1024 * 1024 * 1024,
});

const bytesPerType = (type) => ({
  unsigned_byte: 1,
  byte: 1,
  unsigned_short: 2,
  short: 2,
  half_float: 2,
  unsigned_int: 4,
  int: 4,
  float: 4,
  1009: 1, // THREE.UnsignedByteType
  1010: 1, // THREE.ByteType
  1011: 2, // THREE.ShortType
  1012: 2, // THREE.UnsignedShortType
  1013: 4, // THREE.IntType
  1014: 4, // THREE.UnsignedIntType
  1015: 4, // THREE.FloatType
  1016: 2, // THREE.HalfFloatType
})[String(type || 'unsigned_byte').toLowerCase()] || 1;

export function estimateRenderTargetBytes({
  width,
  height,
  channels = 4,
  type = 'unsigned_byte',
  depthBytes = 4,
  samples = 1,
  mipmaps = false,
} = {}) {
  const pixels = Math.max(1, Math.floor(width || 1)) * Math.max(1, Math.floor(height || 1));
  const sampleCount = Math.max(1, Math.floor(samples || 1));
  const colorBytes = pixels * Math.max(1, channels) * bytesPerType(type) * sampleCount;
  const total = colorBytes + pixels * Math.max(0, depthBytes) * sampleCount;
  return Math.ceil(total * (mipmaps ? 4 / 3 : 1));
}

export class GpuResourceLedger {
  constructor({ tier = 'medium', budgetBytes } = {}) {
    this.tier = tier in DEFAULT_BUDGETS ? tier : 'medium';
    this.budgetBytes = Math.max(1, budgetBytes || DEFAULT_BUDGETS[this.tier]);
    this.entries = new Map();
    this._totalBytes = 0;
    this.peakBytes = 0;
  }

  reserve(id, descriptor = {}) {
    if (!id) throw new Error('GPU resource reservations require an id');
    const bytes = Number.isFinite(descriptor.bytes)
      ? Math.max(0, Math.ceil(descriptor.bytes))
      : estimateRenderTargetBytes(descriptor);
    const previous = this.entries.get(id);
    const attemptedTotalBytes = this._totalBytes - (previous?.bytes || 0) + bytes;
    if (attemptedTotalBytes > this.budgetBytes) {
      const error = new Error(
        `GPU resource budget exceeded: ${attemptedTotalBytes} bytes requested, ${this.budgetBytes} available`,
      );
      error.code = 'GPU_RESOURCE_BUDGET_EXCEEDED';
      error.requestedBytes = bytes;
      error.attemptedTotalBytes = attemptedTotalBytes;
      error.budgetBytes = this.budgetBytes;
      throw error;
    }
    this.entries.set(id, { ...descriptor, id, bytes });
    this._totalBytes = attemptedTotalBytes;
    this.peakBytes = Math.max(this.peakBytes, this._totalBytes);
    return this.entries.get(id);
  }

  release(id) {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this._totalBytes -= entry.bytes;
    return this.entries.delete(id);
  }
  clear() { this.entries.clear(); this._totalBytes = 0; }
  get totalBytes() { return this._totalBytes; }
  snapshot() {
    return Object.freeze({
      tier: this.tier,
      budgetBytes: this.budgetBytes,
      totalBytes: this.totalBytes,
      peakBytes: this.peakBytes,
      scope: 'registered render targets; estimates, not measured VRAM',
      entries: [...this.entries.values()].map((entry) => ({ ...entry })),
    });
  }
}

export function rendererAdmission(capabilities, { requiredFragmentSamplers = 0 } = {}) {
  if (!capabilities?.webgl2) {
    return { ok: false, code: 'WEBGL2_REQUIRED', reason: 'WebGL 2 is required.' };
  }
  const limit = capabilities.limits?.maxTextureImageUnits || 0;
  if (requiredFragmentSamplers > 0 && limit > 0 && requiredFragmentSamplers > limit) {
    return {
      ok: false,
      code: 'FRAGMENT_SAMPLER_LIMIT',
      reason: `This render graph needs ${requiredFragmentSamplers} fragment samplers; the device exposes ${limit}.`,
      requiredFragmentSamplers,
      availableFragmentSamplers: limit,
    };
  }
  return { ok: true };
}
