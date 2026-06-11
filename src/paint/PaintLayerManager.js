import * as THREE from 'three';

const NEUTRAL_HEIGHT = 128;

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function smoothstep(t) { return t * t * (3 - 2 * t); }

export const PAINT_BIOME_CHANNELS = {
  desert: 0,
  canyon: 1,
  wetland: 2,
  mountains: 3,
};

export class PaintLayerManager {
  constructor({ uniforms, boardSize, resolution = 512, heightRange = 180 }) {
    this.uniforms = uniforms;
    this.resolution = resolution;
    this.boardSize = boardSize;
    this.heightRange = heightRange;
    this.heightData = new Uint8Array(resolution * resolution * 4);
    this.biomeData = new Uint8Array(resolution * resolution * 4);
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

  stamp({ x, z, radius, strength, falloff, tool, targetHeight = 0, biome = 'desert', baseHeightAt }) {
    const center = this.worldToPixel(x, z);
    const pixelRadius = Math.max(1, radius / this.boardSize * this.resolution);
    const minX = clamp(Math.floor(center.px - pixelRadius), 0, this.resolution - 1);
    const maxX = clamp(Math.ceil(center.px + pixelRadius), 0, this.resolution - 1);
    const minY = clamp(Math.floor(center.py - pixelRadius), 0, this.resolution - 1);
    const maxY = clamp(Math.ceil(center.py + pixelRadius), 0, this.resolution - 1);
    const delta = strength * 18;
    const channel = PAINT_BIOME_CHANNELS[biome] ?? 0;

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const dx = px - center.px;
        const dy = py - center.py;
        const dist = Math.hypot(dx, dy);
        if (dist > pixelRadius) continue;
        const radial = 1 - dist / pixelRadius;
        const soft = falloff <= 0 ? 1 : smoothstep(clamp(radial / Math.max(falloff, 0.001), 0, 1));
        const alpha = clamp(soft * strength, 0, 1);
        const i = (py * this.resolution + px) * 4;

        if (tool === 'biome') {
          this.biomeData[i + channel] = Math.round(clamp(this.biomeData[i + channel] + alpha * 255, 0, 255));
          continue;
        }

        if (tool === 'erase') {
          this.heightData[i] = Math.round(this.heightData[i] + (NEUTRAL_HEIGHT - this.heightData[i]) * alpha);
          for (let c = 0; c < 4; c++) this.biomeData[i + c] = Math.round(this.biomeData[i + c] * (1 - alpha));
          continue;
        }

        const currentOffset = (this.heightData[i] / 255 - 0.5) * 2 * this.heightRange;
        let nextOffset = currentOffset;
        if (tool === 'raise') nextOffset = currentOffset + delta * soft;
        else if (tool === 'lower') nextOffset = currentOffset - delta * soft;
        else if (tool === 'setHeight' || tool === 'flatten') {
          const wx = (px / (this.resolution - 1) - 0.5) * this.boardSize;
          const wz = (py / (this.resolution - 1) - 0.5) * this.boardSize;
          const base = baseHeightAt ? baseHeightAt(wx, wz) : 0;
          const desiredOffset = targetHeight - base;
          nextOffset = currentOffset + (desiredOffset - currentOffset) * alpha;
        } else if (tool === 'smooth') {
          let sum = 0;
          let count = 0;
          for (let oy = -2; oy <= 2; oy++) {
            for (let ox = -2; ox <= 2; ox++) {
              const sx = clamp(px + ox, 0, this.resolution - 1);
              const sy = clamp(py + oy, 0, this.resolution - 1);
              const ni = (sy * this.resolution + sx) * 4;
              const nOffset = (this.heightData[ni] / 255 - 0.5) * 2 * this.heightRange;
              const wx = (sx / (this.resolution - 1) - 0.5) * this.boardSize;
              const wz = (sy / (this.resolution - 1) - 0.5) * this.boardSize;
              sum += (baseHeightAt ? baseHeightAt(wx, wz) : 0) + nOffset;
              count++;
            }
          }
          const wx = (px / (this.resolution - 1) - 0.5) * this.boardSize;
          const wz = (py / (this.resolution - 1) - 0.5) * this.boardSize;
          const base = baseHeightAt ? baseHeightAt(wx, wz) : 0;
          const desiredOffset = sum / count - base;
          nextOffset = currentOffset + (desiredOffset - currentOffset) * alpha;
        }
        const encoded = clamp((nextOffset / this.heightRange / 2 + 0.5) * 255, 0, 255);
        this.heightData[i] = Math.round(encoded);
      }
    }
    this.heightTexture.needsUpdate = true;
    this.biomeTexture.needsUpdate = true;
  }

  clear() {
    this.heightData.fill(NEUTRAL_HEIGHT);
    for (let i = 3; i < this.heightData.length; i += 4) this.heightData[i] = 255;
    this.biomeData.fill(0);
    this.heightTexture.needsUpdate = true;
    this.biomeTexture.needsUpdate = true;
  }

  serialize() {
    return {
      version: 1,
      resolution: this.resolution,
      boardSize: this.boardSize,
      heightRange: this.heightRange,
      height: Array.from(this.heightData),
      biome: Array.from(this.biomeData),
    };
  }

  load(data) {
    if (!data || data.resolution !== this.resolution) return false;
    if (data.height?.length === this.heightData.length) this.heightData.set(data.height);
    if (data.biome?.length === this.biomeData.length) this.biomeData.set(data.biome);
    this.heightRange = data.heightRange ?? this.heightRange;
    this.boardSize = data.boardSize ?? this.boardSize;
    this.uniforms.uPaintHeightRange.value = this.heightRange;
    this.heightTexture.needsUpdate = true;
    this.biomeTexture.needsUpdate = true;
    return true;
  }

  dispose() {
    this.heightTexture.dispose();
    this.biomeTexture.dispose();
  }
}
