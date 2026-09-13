import * as THREE from 'three';
import { readRenderTargetPixelsAsync } from './render/RendererReadback.js';

const SIZE = 256;
const SAMPLE_RES = 128;
const SAMPLE_BATCH = 256;
const SAMPLE_BUDGET_MS = 4;
const yieldTask = () => new Promise((resolve) => setTimeout(resolve, 0));
const sameView = (a, b) => !!a && !!b && a.halfSpan === b.halfSpan
  && a.centerX === b.centerX && a.centerZ === b.centerZ;

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function hexToRgb(hex) {
  return {
    r: (hex >> 16) & 255,
    g: (hex >> 8) & 255,
    b: hex & 255,
  };
}
function mixColor(a, b, t) {
  return {
    r: Math.round(lerp(a.r, b.r, t)),
    g: Math.round(lerp(a.g, b.g, t)),
    b: Math.round(lerp(a.b, b.b, t)),
  };
}

const BIOME_COLORS = {
  Desert: hexToRgb(0xd9c27e),
  Canyon: hexToRgb(0xb56742),
  Wetland: hexToRgb(0x4f8f6b),
  Mountains: hexToRgb(0x8f99a6),
  Forest: hexToRgb(0x4c8a57),
};

export class Minimap {
  constructor(renderer, scene, baseCanvas, overlayCanvas) {
    this.renderer = renderer;
    this.scene = scene;
    this.baseCanvas = null;
    this.overlayCanvas = null;
    this.baseCtx = null;
    this.overlayCtx = null;
    this.boardSize = 2048;
    this.maxHeight = 256;
    this._dirty = true;
    this._revision = 0;
    this._pendingFrame = null;
    this._baseData = null;
    this._spareData = null;
    this._disposed = false;
    this._stats = { completed: 0, discarded: 0, samples: 0, maxBatchMs: 0, errors: 0 };
    this._hover = null;
    this._lastView = null;
    this._baseImage = null;
    this.target = new THREE.WebGLRenderTarget(SIZE, SIZE);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 20000);
    this.camera.up.set(0, 0, -1);
    this._pixels = new Uint8Array(SIZE * SIZE * 4);
    this.config = {
      mode: 'color',
      zoom: 1,
      showChunkGrid: false,
    };
    this.sources = {
      controls: null,
      sampler: null,
      getPaintHeightOffset: null,
      getPaintBiomeWeights: null,
      getPropsMask: null,
      getWaterLevel: null,
      getChunkCount: null,
    };
    this.setCanvases(baseCanvas, overlayCanvas);
  }

  setCanvases(baseCanvas, overlayCanvas) {
    if (!baseCanvas || !overlayCanvas) {
      this.requestRedraw();
      this.baseCanvas = null; this.overlayCanvas = null; this.baseCtx = null; this.overlayCtx = null;
      return;
    }
    if (this.baseCanvas === baseCanvas && this.overlayCanvas === overlayCanvas) return;
    this.baseCanvas = baseCanvas;
    this.overlayCanvas = overlayCanvas;
    this.baseCtx = this.baseCanvas.getContext('2d');
    this.overlayCtx = this.overlayCanvas.getContext('2d');
    this.requestRedraw({ force: true });
  }

  setBoard(boardSize, maxHeight) {
    this.boardSize = boardSize;
    this.maxHeight = maxHeight;
    this.camera.position.set(0, maxHeight + 2000, 0);
    this.camera.lookAt(0, 0, 0);
    this.requestRedraw();
  }

  setSources(sources = {}) {
    this.sources = { ...this.sources, ...sources };
    this.requestRedraw();
  }

  setConfig(next = {}) {
    const prev = this.config;
    this.config = { ...this.config, ...next };
    if (
      prev.mode !== this.config.mode
      || prev.zoom !== this.config.zoom
    ) {
      this.requestRedraw();
    }
  }

  setHover(hover) {
    this._hover = hover;
  }

  requestRedraw() {
    this._revision += 1;
    this._dirty = true;
  }

  getDiagnostics() {
    return { ...this._stats, pending: !!this._pendingFrame, revision: this._revision,
      resolution: SIZE, sampleResolution: SAMPLE_RES, batchSamples: SAMPLE_BATCH,
      batchBudgetMs: SAMPLE_BUDGET_MS };
  }

  _viewState() {
    const boardHalf = this.boardSize / 2;
    const zoom = clamp(this.config.zoom || 1, 1, 6);
    const halfSpan = boardHalf / zoom;
    const controls = this.sources.controls;
    const target = controls?.target ?? { x: 0, z: 0 };
    const centerX = zoom > 1 ? clamp(target.x, -boardHalf + halfSpan, boardHalf - halfSpan) : 0;
    const centerZ = zoom > 1 ? clamp(target.z, -boardHalf + halfSpan, boardHalf - halfSpan) : 0;
    return { zoom, boardHalf, halfSpan, centerX, centerZ };
  }

  canvasToWorld(px, py) {
    const view = this._viewState();
    const nx = clamp(px / SIZE, 0, 1);
    const ny = clamp(py / SIZE, 0, 1);
    return {
      x: lerp(view.centerX - view.halfSpan, view.centerX + view.halfSpan, nx),
      z: lerp(view.centerZ - view.halfSpan, view.centerZ + view.halfSpan, ny),
    };
  }

  worldToCanvas(x, z) {
    const view = this._viewState();
    const nx = (x - (view.centerX - view.halfSpan)) / (view.halfSpan * 2);
    const ny = (z - (view.centerZ - view.halfSpan)) / (view.halfSpan * 2);
    return {
      x: nx * SIZE,
      y: ny * SIZE,
      visible: nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1,
    };
  }

  _sample(x, z) {
    const sampler = this.sources.sampler;
    if (!sampler) return null;
    const paintHeightOffset = this.sources.getPaintHeightOffset?.(x, z) ?? 0;
    const paintBiomeWeights = this.sources.getPaintBiomeWeights?.(x, z) ?? null;
    const propsMask = this.sources.getPropsMask?.(x, z) ?? { grass: 0, flowers: 0, mixed: 0 };
    const waterLevel = this.sources.getWaterLevel?.() ?? 0;
    const surface = sampler.sampleSurfaceInfo(x, z, {
      waterLevel,
      paintHeightOffset,
      paintBiomeWeights,
    });
    return { ...surface, propsMask };
  }

  _sampleForMode(x, z) {
    const sampler = this.sources.sampler;
    // Analytical views consume only one field. Keep _sample's full surface
    // result for hover details and samplers exposing only sampleSurfaceInfo.
    switch (this.config.mode) {
      case 'height':
      case 'water':
        if (sampler?.heightAt) {
          const height = sampler.heightAt(x, z) + (this.sources.getPaintHeightOffset?.(x, z) ?? 0);
          return { height, water: height <= (this.sources.getWaterLevel?.() ?? 0) + 0.01 };
        }
        break;
      case 'noise':
        if (sampler?.shapeAt) return { noise: sampler.shapeAt(x, z) };
        break;
      case 'biome':
        if (sampler?.biomeAt) {
          return { biome: sampler.biomeAt(x, z, this.sources.getPaintBiomeWeights?.(x, z) ?? null).label };
        }
        break;
      case 'slope':
        if (sampler?.normalAt) return { slope: clamp(1 - sampler.normalAt(x, z, 2.0).y, 0, 1) };
        break;
      case 'props':
        return { propsMask: this.sources.getPropsMask?.(x, z) ?? { grass: 0, flowers: 0, mixed: 0 } };
      default:
        break;
    }
    return this._sample(x, z);
  }

  infoAtCanvas(px, py) {
    const { x, z } = this.canvasToWorld(px, py);
    const sample = this._sample(x, z);
    if (!sample) return null;
    return {
      worldX: x,
      worldZ: z,
      height: sample.height,
      height01: clamp(sample.height / Math.max(1, this.maxHeight), 0, 1),
      biome: sample.biome,
      slope: sample.slope,
      water: sample.water,
      noise: sample.noise,
      propsMask: sample.propsMask,
    };
  }

  _colorForSample(sample) {
    if (sample.water) {
      const deep = hexToRgb(0x0d3b66);
      const shallow = hexToRgb(0x3c8dbc);
      const depthT = clamp((sample.height + 8) / Math.max(1, this.maxHeight * 0.18), 0, 1);
      return mixColor(deep, shallow, depthT);
    }

    const biome = BIOME_COLORS[sample.biome] ?? BIOME_COLORS.Forest;
    const low = hexToRgb(0x293726);
    const high = hexToRgb(0xd6d2c4);
    const h = clamp(sample.height / Math.max(1, this.maxHeight), 0, 1);
    const terrainShade = mixColor(low, high, Math.pow(h, 0.8));
    const slopeShade = 1 - sample.slope * 0.55;
    return {
      r: Math.round(clamp((terrainShade.r * 0.42 + biome.r * 0.58) * slopeShade, 0, 255)),
      g: Math.round(clamp((terrainShade.g * 0.42 + biome.g * 0.58) * slopeShade, 0, 255)),
      b: Math.round(clamp((terrainShade.b * 0.42 + biome.b * 0.58) * slopeShade, 0, 255)),
    };
  }

  _pixelForMode(sample) {
    switch (this.config.mode) {
      case 'height': {
        const v = Math.round(clamp(sample.height / Math.max(1, this.maxHeight), 0, 1) * 255);
        return { r: v, g: v, b: v };
      }
      case 'biome':
        return BIOME_COLORS[sample.biome] ?? BIOME_COLORS.Forest;
      case 'noise': {
        const v = Math.round(clamp(sample.noise / 1.35, 0, 1) * 255);
        return { r: v, g: v, b: v };
      }
      case 'water':
        return sample.water ? hexToRgb(0x4aa8ff) : hexToRgb(0x101822);
      case 'slope': {
        const v = Math.round(clamp(sample.slope, 0, 1) * 255);
        return { r: v, g: v, b: v };
      }
      case 'props': {
        const grass = Math.round(clamp(sample.propsMask.grass, 0, 1) * 255);
        const flowers = Math.round(clamp(sample.propsMask.flowers, 0, 1) * 255);
        const mixed = Math.round(clamp(sample.propsMask.mixed, 0, 1) * 255);
        return { r: flowers, g: Math.max(grass, mixed), b: mixed };
      }
      case 'color':
      default:
        return this._colorForSample(sample);
    }
  }

  renderBase() {
    if (!this.baseCtx || this._disposed || this._pendingFrame) return;
    const context = this.baseCtx;
    // Rendering/readback submission is synchronous up to the first await. The
    // engine can restore hidden sky/overlay objects immediately after this call.
    void this._requestBaseFrame().then((rgba) => {
      if (!rgba || this._disposed || this.baseCtx !== context) return;
      if (!this._baseImage) this._baseImage = context.createImageData(SIZE, SIZE);
      this._baseImage.data.set(rgba);
      context.putImageData(this._baseImage, 0, 0);
    }).catch(() => { /* Preserve the last valid image; the next dirty draw retries. */ });
  }

  _requestBaseFrame() {
    if (this._disposed) return Promise.resolve(null);
    if (this._pendingFrame) return this._pendingFrame;
    const view = this._viewState();
    if (!sameView(view, this._lastView)) this._dirty = true;
    if (!this._dirty && this._baseData) return Promise.resolve(this._baseData);
    if (!this.sources.sampler) return Promise.resolve(null);

    const revision = this._revision;
    const current = () => !this._disposed && revision === this._revision
      && sameView(view, this._viewState());
    const rgba = this._spareData || new Uint8ClampedArray(SIZE * SIZE * 4);
    this._spareData = null;
    const task = this.config.mode === 'color'
      ? this._renderSceneColor(view, rgba)
      : this._renderAnalytical(view, rgba, current);
    this._pendingFrame = task.then(() => {
      if (!current()) {
        this._stats.discarded += 1;
        this._spareData = rgba;
        return null;
      }
      this._spareData = this._baseData;
      this._baseData = rgba;
      this._lastView = view;
      this._dirty = false;
      this._stats.completed += 1;
      return rgba;
    }, (error) => {
      this._spareData = rgba;
      this._stats.errors += 1;
      throw error;
    }).finally(() => { this._pendingFrame = null; });
    return this._pendingFrame;
  }

  async _renderAnalytical(view, rgba, current) {
    const cell = SIZE / SAMPLE_RES;
    const minX = view.centerX - view.halfSpan;
    const minZ = view.centerZ - view.halfSpan;
    const spanX = (view.centerX + view.halfSpan) - minX;
    const spanZ = (view.centerZ + view.halfSpan) - minZ;
    let index = 0;
    while (index < SAMPLE_RES * SAMPLE_RES && current()) {
      const startedAt = performance.now();
      let count = 0;
      do {
        const sx = index % SAMPLE_RES;
        const sy = Math.floor(index / SAMPLE_RES);
        // Same cell centres and lerp arithmetic as canvasToWorld, evaluated
        // against one immutable view instead of rebuilding it 16,384 times.
        const x = minX + spanX * ((sx * cell + cell * 0.5) / SIZE);
        const z = minZ + spanZ * ((sy * cell + cell * 0.5) / SIZE);
        const sample = this._sampleForMode(x, z);
        const pixel = sample ? this._pixelForMode(sample) : { r: 0, g: 0, b: 0 };
        for (let oy = 0; oy < cell; oy += 1) {
          for (let ox = 0; ox < cell; ox += 1) {
            const offset = (((sy * cell + oy) * SIZE) + sx * cell + ox) * 4;
            rgba[offset] = pixel.r;
            rgba[offset + 1] = pixel.g;
            rgba[offset + 2] = pixel.b;
            rgba[offset + 3] = 255;
          }
        }
        index += 1;
        count += 1;
      } while (index < SAMPLE_RES * SAMPLE_RES && count < SAMPLE_BATCH
        && performance.now() - startedAt < SAMPLE_BUDGET_MS);
      this._stats.samples += count;
      this._stats.maxBatchMs = Math.max(this._stats.maxBatchMs, performance.now() - startedAt);
      if (index < SAMPLE_RES * SAMPLE_RES) await yieldTask();
    }
  }

  async _renderSceneColor(view, rgba) {
    this.camera.left = view.centerX - view.halfSpan;
    this.camera.right = view.centerX + view.halfSpan;
    this.camera.top = view.centerZ + view.halfSpan;
    this.camera.bottom = view.centerZ - view.halfSpan;
    this.camera.position.set(view.centerX, this.maxHeight + 2000, view.centerZ);
    this.camera.lookAt(view.centerX, 0, view.centerZ);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);

    const renderer = this.renderer;
    const previous = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace?.() ?? 0;
    const mip = renderer.getActiveMipmapLevel?.() ?? 0;
    let readback;
    try {
      renderer.setRenderTarget(this.target);
      renderer.clear();
      renderer.render(this.scene, this.camera);
      readback = readRenderTargetPixelsAsync(renderer, this.target, 0, 0, SIZE, SIZE, this._pixels);
    } finally {
      renderer.setRenderTarget(previous, face, mip);
    }
    const pixels = await readback;
    for (let y = 0; y < SIZE; y += 1) {
      const source = (SIZE - 1 - y) * SIZE * 4;
      rgba.set(pixels.subarray(source, source + SIZE * 4), y * SIZE * 4);
    }
  }

  _drawChunkGrid(ctx) {
    if (!this.config.showChunkGrid) return;
    const chunkCount = this.sources.getChunkCount?.();
    if (!chunkCount || chunkCount < 2) return;
    const chunkSize = this.boardSize / chunkCount;
    const boardHalf = this.boardSize / 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    for (let i = 1; i < chunkCount; i++) {
      const xWorld = -boardHalf + i * chunkSize;
      const zWorld = -boardHalf + i * chunkSize;
      const vx = this.worldToCanvas(xWorld, 0);
      const vz = this.worldToCanvas(0, zWorld);
      if (vx.visible || (vx.x >= 0 && vx.x <= SIZE)) {
        ctx.beginPath();
        ctx.moveTo(vx.x, 0);
        ctx.lineTo(vx.x, SIZE);
        ctx.stroke();
      }
      if (vz.visible || (vz.y >= 0 && vz.y <= SIZE)) {
        ctx.beginPath();
        ctx.moveTo(0, vz.y);
        ctx.lineTo(SIZE, vz.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawOverlay(controls) {
    const ctx = this.overlayCtx;
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    this._drawChunkGrid(ctx);

    const focus = controls?.target ? this.worldToCanvas(controls.target.x, controls.target.z) : null;
    if (focus) {
      const theta = controls.theta ?? 0;
      const camX = focus.x + Math.sin(theta) * 16;
      const camY = focus.y + Math.cos(theta) * 16;
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(camX, camY);
      ctx.lineTo(focus.x, focus.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(camX, camY, 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.92)';
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(focus.x - 5, focus.y);
      ctx.lineTo(focus.x + 5, focus.y);
      ctx.moveTo(focus.x, focus.y - 5);
      ctx.lineTo(focus.x, focus.y + 5);
      ctx.stroke();
    }

    if (this._hover) {
      ctx.strokeStyle = 'rgba(255, 232, 153, 0.95)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(this._hover.x, this._hover.y, 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    const view = this._viewState();
    if (view.zoom > 1) {
      const span = Math.round(view.halfSpan * 2);
      ctx.fillStyle = 'rgba(9, 12, 18, 0.58)';
      ctx.fillRect(6, SIZE - 20, 88, 14);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '10px sans-serif';
      ctx.fillText(`${span}u view`, 12, SIZE - 10);
    }
  }

  async createFramePacket(controls = this.sources.controls) {
    const data = await this._requestBaseFrame();
    if (!data || this._disposed) return null;
    // The worker transfers ownership. Never detach the cached image/buffers.
    const rgba = data.slice();
    const focus = controls?.target ? this.worldToCanvas(controls.target.x, controls.target.z) : null;
    const view = this._viewState();
    return {
      width: SIZE,
      height: SIZE,
      rgba,
      overlay: {
        focus,
        theta: controls?.theta ?? 0,
        hover: this._hover,
        zoom: view.zoom,
        span: Math.round(view.halfSpan * 2),
        showChunkGrid: !!this.config.showChunkGrid,
        chunkCount: this.sources.getChunkCount?.() || 0,
      },
    };
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.requestRedraw();
    // Three's async readback still owns its PBO/fence until it settles.
    const release = () => {
      this.target.dispose();
      this._baseData = null;
      this._spareData = null;
      this._baseImage = null;
    };
    if (this._pendingFrame) this._pendingFrame.then(release, release);
    else release();
  }
}
