import * as THREE from 'three';

const NEUTRAL_HEIGHT = 128;

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function smoothstep(t) { return t * t * (3 - 2 * t); }
function lerp(a, b, t) { return a + (b - a) * t; }
function hash2(x, y) {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  n = (n ^ (n >>> 13)) | 0;
  return ((Math.imul(n, 1274126177) ^ n) >>> 0) / 4294967295;
}

export const PAINT_BIOME_CHANNELS = {
  desert: 0,
  canyon: 1,
  wetland: 2,
  mountains: 3,
};

export const PAINT_PROP_CHANNELS = {
  grass: 0,
  flowers: 1,
  mixed: 2,
};

export class PaintLayerManager {
  constructor({ uniforms, boardSize, resolution = 512, heightRange = 180 }) {
    this.uniforms = uniforms;
    this.resolution = resolution;
    this.boardSize = boardSize;
    this.heightRange = heightRange;
    this.heightData = new Uint8Array(resolution * resolution * 4);
    this.biomeData = new Uint8Array(resolution * resolution * 4);
    this.propsData = new Uint8Array(resolution * resolution * 4);
    this.revision = 0;
    this.heightData.fill(NEUTRAL_HEIGHT);
    for (let i = 3; i < this.heightData.length; i += 4) this.heightData[i] = 255;

    this.heightTexture = new THREE.DataTexture(this.heightData, resolution, resolution, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.heightTexture.colorSpace = THREE.NoColorSpace;
    this.heightTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.heightTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.heightTexture.minFilter = THREE.LinearFilter;
    this.heightTexture.magFilter = THREE.LinearFilter;
    this.heightTexture.needsUpdate = true;

    this.biomeTexture = new THREE.DataTexture(this.biomeData, resolution, resolution, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.biomeTexture.colorSpace = THREE.NoColorSpace;
    this.biomeTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.biomeTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.biomeTexture.minFilter = THREE.LinearFilter;
    this.biomeTexture.magFilter = THREE.LinearFilter;
    this.biomeTexture.needsUpdate = true;

    this._bindUniforms();
  }

  _bindUniforms() {
    this.uniforms.uPaintHeightTexture.value = this.heightTexture;
    this.uniforms.uPaintBiomeTexture.value = this.biomeTexture;
    this.uniforms.uPaintResolution.value = this.resolution;
    this.uniforms.uPaintHeightRange.value = this.heightRange;
    this.uniforms.uPaintEnabled.value = 1;
  }

  setBoardSize(boardSize) {
    this.boardSize = boardSize;
  }

  worldToPixel(x, z) {
    const u = (x / this.boardSize) + 0.5;
    const v = (z / this.boardSize) + 0.5;
    return {
      px: u * (this.resolution - 1),
      py: v * (this.resolution - 1),
      u,
      v,
    };
  }

  sampleHeightOffset(x, z) {
    const { px, py } = this.worldToPixel(x, z);
    const ix = clamp(Math.round(px), 0, this.resolution - 1);
    const iy = clamp(Math.round(py), 0, this.resolution - 1);
    const value = this.heightData[(iy * this.resolution + ix) * 4] / 255;
    return (value - 0.5) * 2 * this.heightRange;
  }

  samplePropsMask(x, z) {
    const { px, py } = this.worldToPixel(x, z);
    const ix = clamp(Math.round(px), 0, this.resolution - 1);
    const iy = clamp(Math.round(py), 0, this.resolution - 1);
    const i = (iy * this.resolution + ix) * 4;
    return {
      grass: this.propsData[i] / 255,
      flowers: this.propsData[i + 1] / 255,
      mixed: this.propsData[i + 2] / 255,
    };
  }

  sampleBiomeMask(x, z) {
    const { px, py } = this.worldToPixel(x, z);
    const ix = clamp(Math.round(px), 0, this.resolution - 1);
    const iy = clamp(Math.round(py), 0, this.resolution - 1);
    const i = (iy * this.resolution + ix) * 4;
    return {
      desert: this.biomeData[i] / 255,
      canyon: this.biomeData[i + 1] / 255,
      wetland: this.biomeData[i + 2] / 255,
      mountains: this.biomeData[i + 3] / 255,
    };
  }

  _heightOffsetFrom(data, px, py) {
    const ix = clamp(Math.round(px), 0, this.resolution - 1);
    const iy = clamp(Math.round(py), 0, this.resolution - 1);
    return (data[(iy * this.resolution + ix) * 4] / 255 - 0.5) * 2 * this.heightRange;
  }

  _brushAlpha({ px, py, center, pixelRadius, falloff, strength, shape, rotation, scatter }) {
    let dx = px - center.px;
    let dy = py - center.py;
    const c = Math.cos(rotation);
    const s = Math.sin(rotation);
    const rx = dx * c - dy * s;
    const ry = dx * s + dy * c;

    let dist = Math.hypot(rx, ry);
    if (shape === 'ellipse') {
      dist = Math.hypot(rx / 1.65, ry * 1.2);
    } else if (shape === 'ribbon') {
      dist = Math.max(Math.abs(rx) / 2.4, Math.abs(ry) * 1.35);
    } else if (shape === 'organic') {
      const angle = Math.atan2(ry, rx);
      const wobble = 0.82
        + Math.sin(angle * 3.0 + center.px * 0.031) * 0.10
        + Math.sin(angle * 7.0 + center.py * 0.017) * 0.08;
      dist /= clamp(wobble, 0.62, 1.12);
    } else if (shape === 'scatter') {
      const cell = Math.max(2, Math.round(pixelRadius * 0.12));
      const sx = Math.floor(px / cell);
      const sy = Math.floor(py / cell);
      const keep = hash2(sx, sy);
      if (keep > clamp(scatter, 0.05, 1)) return 0;
      dist *= lerp(0.75, 1.2, keep);
    }

    if (dist > pixelRadius) return 0;
    const radial = 1 - dist / pixelRadius;
    const soft = falloff <= 0 ? 1 : smoothstep(clamp(radial / Math.max(falloff, 0.001), 0, 1));
    return clamp(soft * strength, 0, 1);
  }

  stamp({
    x, z, radius, strength, falloff, tool, targetHeight = 0, biome = 'desert',
    baseHeightAt, brushShape = 'round', brushRotation = 0, brushScatter = 0.55,
    propType = 'mixed', riverDepth = 28, riverBankSoftness = 0.65,
  }) {
    const center = this.worldToPixel(x, z);
    const pixelRadius = Math.max(1, radius / this.boardSize * this.resolution);
    const minX = clamp(Math.floor(center.px - pixelRadius), 0, this.resolution - 1);
    const maxX = clamp(Math.ceil(center.px + pixelRadius), 0, this.resolution - 1);
    const minY = clamp(Math.floor(center.py - pixelRadius), 0, this.resolution - 1);
    const maxY = clamp(Math.ceil(center.py + pixelRadius), 0, this.resolution - 1);
    const channel = PAINT_BIOME_CHANNELS[biome] ?? 0;
    const propChannel = PAINT_PROP_CHANNELS[propType] ?? PAINT_PROP_CHANNELS.mixed;
    const sourceHeight = tool === 'smooth' ? this.heightData.slice() : this.heightData;

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const alpha = this._brushAlpha({
          px, py, center, pixelRadius, falloff, strength,
          shape: brushShape, rotation: brushRotation, scatter: brushScatter,
        });
        if (alpha <= 0) continue;
        const i = (py * this.resolution + px) * 4;

        if (tool === 'biome') {
          this.biomeData[i + channel] = Math.round(clamp(this.biomeData[i + channel] + alpha * 255, 0, 255));
          continue;
        }

        if (tool === 'propsPaint') {
          if (propType === 'eraseProps') {
            for (let c = 0; c < 4; c++) this.propsData[i + c] = Math.round(this.propsData[i + c] * (1 - alpha));
          } else {
            this.propsData[i + propChannel] = Math.round(clamp(this.propsData[i + propChannel] + alpha * 255, 0, 255));
          }
          continue;
        }

        if (tool === 'erase') {
          this.heightData[i] = Math.round(this.heightData[i] + (NEUTRAL_HEIGHT - this.heightData[i]) * alpha);
          for (let c = 0; c < 4; c++) this.biomeData[i + c] = Math.round(this.biomeData[i + c] * (1 - alpha));
          for (let c = 0; c < 4; c++) this.propsData[i + c] = Math.round(this.propsData[i + c] * (1 - alpha));
          continue;
        }

        const currentOffset = (this.heightData[i] / 255 - 0.5) * 2 * this.heightRange;
        let nextOffset = currentOffset;
        if (tool === 'raise') nextOffset = currentOffset + 18 * alpha;
        else if (tool === 'lower') nextOffset = currentOffset - 18 * alpha;
        else if (tool === 'setHeight' || tool === 'flatten') {
          const wx = (px / (this.resolution - 1) - 0.5) * this.boardSize;
          const wz = (py / (this.resolution - 1) - 0.5) * this.boardSize;
          const base = baseHeightAt ? baseHeightAt(wx, wz) : 0;
          const desiredOffset = targetHeight - base;
          nextOffset = currentOffset + (desiredOffset - currentOffset) * alpha;
        } else if (tool === 'smooth') {
          const k = Math.max(1, Math.round(pixelRadius * 0.08));
          let sum = 0;
          let count = 0;
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              const sx = clamp(px + ox * k, 0, this.resolution - 1);
              const sy = clamp(py + oy * k, 0, this.resolution - 1);
              const wx = (sx / (this.resolution - 1) - 0.5) * this.boardSize;
              const wz = (sy / (this.resolution - 1) - 0.5) * this.boardSize;
              sum += (baseHeightAt ? baseHeightAt(wx, wz) : 0) + this._heightOffsetFrom(sourceHeight, sx, sy);
              count++;
            }
          }
          const wx = (px / (this.resolution - 1) - 0.5) * this.boardSize;
          const wz = (py / (this.resolution - 1) - 0.5) * this.boardSize;
          const desiredOffset = (sum / count) - (baseHeightAt ? baseHeightAt(wx, wz) : 0);
          nextOffset = currentOffset + (desiredOffset - currentOffset) * alpha;
        } else if (tool === 'riverCarve') {
          const wx = (px / (this.resolution - 1) - 0.5) * this.boardSize;
          const wz = (py / (this.resolution - 1) - 0.5) * this.boardSize;
          const base = baseHeightAt ? baseHeightAt(wx, wz) : 0;
          const dx = px - center.px;
          const dy = py - center.py;
          const dist01 = Math.min(1, Math.hypot(dx, dy) / pixelRadius);
          const bank = clamp(riverBankSoftness, 0.05, 1);
          const bed = 1 - smoothstep(clamp((dist01 - (1 - bank)) / bank, 0, 1));
          const desiredOffset = base - riverDepth * bed - base;
          nextOffset = currentOffset + (Math.min(currentOffset, desiredOffset) - currentOffset) * alpha;
        }
        const encoded = clamp((nextOffset / this.heightRange / 2 + 0.5) * 255, 0, 255);
        this.heightData[i] = Math.round(encoded);
      }
    }
    this.heightTexture.needsUpdate = true;
    this.biomeTexture.needsUpdate = true;
    this.revision++;
  }

  clear() {
    this.heightData.fill(NEUTRAL_HEIGHT);
    for (let i = 3; i < this.heightData.length; i += 4) this.heightData[i] = 255;
    this.biomeData.fill(0);
    this.propsData.fill(0);
    this.heightTexture.needsUpdate = true;
    this.biomeTexture.needsUpdate = true;
    this.revision++;
  }

  // True when nothing has been painted: the height layer is uniformly neutral
  // (with opaque alpha) and the biome/props layers are fully zero. Lets callers
  // skip serializing the (multi-megabyte) pixel arrays for an untouched canvas.
  isEmpty() {
    const h = this.heightData;
    for (let i = 0; i < h.length; i += 4) {
      if (h[i] !== NEUTRAL_HEIGHT || h[i + 1] !== NEUTRAL_HEIGHT
        || h[i + 2] !== NEUTRAL_HEIGHT || h[i + 3] !== 255) return false;
    }
    const b = this.biomeData;
    for (let i = 0; i < b.length; i++) if (b[i] !== 0) return false;
    const p = this.propsData;
    for (let i = 0; i < p.length; i++) if (p[i] !== 0) return false;
    return true;
  }

  // Returns null for an untouched canvas so save files don't carry ~3M numbers
  // of neutral pixel data when no painting was done.
  serialize() {
    if (this.isEmpty()) return null;
    return {
      version: 1,
      resolution: this.resolution,
      boardSize: this.boardSize,
      heightRange: this.heightRange,
      height: Array.from(this.heightData),
      biome: Array.from(this.biomeData),
      props: Array.from(this.propsData),
    };
  }

  load(data) {
    if (!data || data.resolution !== this.resolution) return false;
    if (data.height?.length === this.heightData.length) this.heightData.set(data.height);
    if (data.biome?.length === this.biomeData.length) this.biomeData.set(data.biome);
    if (data.props?.length === this.propsData.length) this.propsData.set(data.props);
    this.heightRange = data.heightRange ?? this.heightRange;
    this.boardSize = data.boardSize ?? this.boardSize;
    this.uniforms.uPaintHeightRange.value = this.heightRange;
    this.heightTexture.needsUpdate = true;
    this.biomeTexture.needsUpdate = true;
    this.revision++;
    return true;
  }

  dispose() {
    this.heightTexture.dispose();
    this.biomeTexture.dispose();
  }
}
