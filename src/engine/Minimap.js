import * as THREE from 'three';

const SIZE = 256;
const SAMPLE_RES = 128;

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
      || prev.showChunkGrid !== this.config.showChunkGrid
    ) {
      this.requestRedraw();
    }
  }

  setHover(hover) {
    this._hover = hover;
  }

  requestRedraw() {
    this._dirty = true;
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
    if (!this._dirty || !this.baseCtx) return;
    this._dirty = false;

    const sampler = this.sources.sampler;
    if (!sampler) return;

    if (this.config.mode === 'color') {
      this._renderSceneColor();
      this._lastView = this._viewState();
      return;
    }

    const img = this.baseCtx.createImageData(SIZE, SIZE);
    const cell = SIZE / SAMPLE_RES;
    for (let sy = 0; sy < SAMPLE_RES; sy++) {
      for (let sx = 0; sx < SAMPLE_RES; sx++) {
        const px = sx * cell + cell * 0.5;
        const py = sy * cell + cell * 0.5;
        const world = this.canvasToWorld(px, py);
        const sample = this._sample(world.x, world.z);
        const pixel = sample ? this._pixelForMode(sample) : { r: 0, g: 0, b: 0 };
        for (let oy = 0; oy < cell; oy++) {
          for (let ox = 0; ox < cell; ox++) {
            const x = sx * cell + ox;
            const y = sy * cell + oy;
            const idx = (y * SIZE + x) * 4;
            img.data[idx] = pixel.r;
            img.data[idx + 1] = pixel.g;
            img.data[idx + 2] = pixel.b;
            img.data[idx + 3] = 255;
          }
        }
      }
    }
    this.baseCtx.putImageData(img, 0, 0);
    this._baseImage = img;
    this._lastView = this._viewState();
  }

  _renderSceneColor() {
    const view = this._viewState();
    this.camera.left = view.centerX - view.halfSpan;
    this.camera.right = view.centerX + view.halfSpan;
    this.camera.top = view.centerZ + view.halfSpan;
    this.camera.bottom = view.centerZ - view.halfSpan;
    this.camera.position.set(view.centerX, this.maxHeight + 2000, view.centerZ);
    this.camera.lookAt(view.centerX, 0, view.centerZ);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);

    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.readRenderTargetPixels(this.target, 0, 0, SIZE, SIZE, this._pixels);
    this.renderer.setRenderTarget(prevTarget);

    const img = this.baseCtx.createImageData(SIZE, SIZE);
    for (let y = 0; y < SIZE; y++) {
      const src = (SIZE - 1 - y) * SIZE * 4;
      img.data.set(this._pixels.subarray(src, src + SIZE * 4), y * SIZE * 4);
    }
    this.baseCtx.putImageData(img, 0, 0);
    this._baseImage = img;
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

  dispose() {
    this.target.dispose();
  }
}
