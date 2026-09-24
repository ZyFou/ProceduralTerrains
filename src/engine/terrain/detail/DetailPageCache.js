import * as THREE from 'three';
import { DETAIL_PAGE_SIZE, DETAIL_PAGE_SPAN, DETAIL_PAGE_CACHE_LIMIT } from './DetailPageBake.js';

const GPU_PAGES = 16;
const modulo = (value, n) => ((value % n) + n) % n;
const keyFor = ({ generation, axis, x, y, scale, seedX, seedY }) =>
  `${generation}:${axis}:${x}:${y}:${scale}:${seedX}:${seedY}`;

export class DetailPageCache {
  constructor({ renderer, uniforms, onReady, onError }) {
    this.renderer = renderer;
    this.uniforms = uniforms;
    this.onReady = onReady;
    this.onError = onError;
    this.cpu = new Map();
    this.pending = new Map();
    this.readyQueue = [];
    this.pageCoords = Array.from({ length: GPU_PAGES }, () => new THREE.Vector3(1e9, 1e9, 0));
    this.uniforms.uDetailPageCoords.value = this.pageCoords;
    this.texture = new THREE.DataArrayTexture(
      new Uint8Array(DETAIL_PAGE_SIZE * DETAIL_PAGE_SIZE * 4 * GPU_PAGES),
      DETAIL_PAGE_SIZE, DETAIL_PAGE_SIZE, GPU_PAGES,
    );
    this.texture.format = THREE.RGBAFormat;
    this.texture.type = THREE.UnsignedByteType;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.magFilter = this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.source.dataReady = false;
    this.texture.needsUpdate = true;
    this.uniforms.uDetailPageArray.value = this.texture;
    this.hasReadyPage = false;
    this.globalBlend = 0;
    this.axis = 0;
    this.signature = '';
    this.disposed = false;
  }

  _worker() {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('./DetailPageWorker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      const request = this.pending.get(data.id);
      if (!request) return;
      this.pending.delete(data.id);
      if (request.signature !== this.signature || this.disposed) return;
      if (data.error) { this.onError?.(new Error(data.error)); return; }
      const { key, x, y, axis } = request;
      this.cpu.delete(key);
      this.cpu.set(key, data.bytes);
      while (this.cpu.size > DETAIL_PAGE_CACHE_LIMIT) this.cpu.delete(this.cpu.keys().next().value);
      if (this.wanted?.has(key)) this.readyQueue.push({ key, x, y, axis, bytes: data.bytes });
    };
    this.worker.onerror = (event) => {
      this.onError?.(new Error(event.message || 'Detail preparation worker failed'));
      this.worker?.terminate();
      this.worker = null;
      this.pending.clear();
    };
    return this.worker;
  }

  _reset(signature, axis) {
    this.signature = signature;
    this.axis = axis;
    this.hasReadyPage = false;
    this.globalBlend = 0;
    this.readyQueue.length = 0;
    this.wanted = new Set();
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    for (const value of this.pageCoords) value.set(1e9, 1e9, 0);
    this.uniforms.uDetailPageBasis.value = axis;
    this.uniforms.uDetailGlobalBlend.value = 0;
  }

  invalidate() { this._reset('', this.axis); }

  onContextRestored() {
    this.invalidate();
    this.texture.userData.allocated = false;
    this.texture.source.dataReady = false;
    this.texture.needsUpdate = true;
  }

  update({ camera, mode, generation, scale, seedX, seedY, active, allowUpload = true, dt }) {
    if (this.disposed || !camera) return;
    const position = camera.position;
    const axis = mode === 'planet'
      ? Math.abs(position.x) > Math.abs(position.y) && Math.abs(position.x) > Math.abs(position.z) ? 1
        : Math.abs(position.z) > Math.abs(position.y) ? 2 : 0
      : 0;
    const signature = `${generation}:${axis}:${scale}:${seedX}:${seedY}`;
    if (signature !== this.signature) this._reset(signature, axis);
    const cx = axis === 1 ? position.y : position.x;
    const cy = axis === 2 ? position.y : position.z;
    const tx = Math.floor(cx / DETAIL_PAGE_SPAN);
    const ty = Math.floor(cy / DETAIL_PAGE_SPAN);
    const candidates = [];
    for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) {
      const x = tx + dx;
      const y = ty + dy;
      candidates.push({ generation, axis, x, y, scale, seedX, seedY, distance: dx * dx + dy * dy });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    this.wanted = new Set(candidates.map(keyFor));
    if (this.pending.size && ![...this.pending.values()].some((request) => this.wanted.has(request.key))) {
      this.worker?.terminate();
      this.worker = null;
      this.pending.clear();
    }
    this.readyQueue = this.readyQueue.filter((item) => this.wanted.has(item.key));
    for (const candidate of candidates) {
      const key = keyFor(candidate);
      const slot = modulo(candidate.x, 4) + modulo(candidate.y, 4) * 4;
      const page = this.pageCoords[slot];
      if (page.x === candidate.x && page.y === candidate.y) continue;
      if (this.readyQueue.some((item) => item.key === key)) continue;
      if (this.cpu.has(key)) {
        this.readyQueue.push({ ...candidate, key, bytes: this.cpu.get(key) });
      } else if (this.pending.size < 2 && ![...this.pending.values()].some((item) => item.key === key)) {
        const id = `${Date.now()}:${Math.random()}`;
        this.pending.set(id, { ...candidate, key, signature });
        this._worker().postMessage({ id, options: candidate });
      }
    }
    if (allowUpload && this.readyQueue.length) this._uploadOne();
    if (active && this.hasReadyPage) {
      this.globalBlend = Math.min(1, this.globalBlend + Math.max(0, dt) / 0.25);
      this.uniforms.uDetailGlobalBlend.value = this.globalBlend;
      if (this.globalBlend < 1) this.onReady?.(false);
    }
  }

  _uploadOne() {
    const item = this.readyQueue.shift();
    if (!item || item.axis !== this.axis || !this.wanted.has(item.key)) return;
    const slot = modulo(item.x, 4) + modulo(item.y, 4) * 4;
    const offset = slot * DETAIL_PAGE_SIZE * DETAIL_PAGE_SIZE * 4;
    if (!this.texture.userData.allocated) {
      this.renderer.initTexture(this.texture);
      this.texture.userData.allocated = true;
    }
    this.texture.image.data.set(item.bytes, offset);
    this.texture.source.dataReady = true;
    this.texture.addLayerUpdate(slot);
    this.texture.needsUpdate = true;
    this.renderer.initTexture(this.texture);
    this.pageCoords[slot].set(item.x, item.y, 1);
    if (!this.hasReadyPage) {
      this.hasReadyPage = true;
      this.onReady?.(true);
    }
  }

  dispose() {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
    this.readyQueue.length = 0;
    this.cpu.clear();
    this.texture.dispose();
  }
}
