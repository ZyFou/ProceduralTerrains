import * as THREE from 'three';

// ============================================================================
// Minimap: renders the board top-down into a render target whenever the
// terrain parameters change (NOT every frame), copies the pixels to a 2D
// canvas, and draws a live camera marker on an overlay canvas each frame.
// ============================================================================

const SIZE = 256;

export class Minimap {
  constructor(renderer, scene, baseCanvas, overlayCanvas) {
    this.renderer = renderer;
    this.scene = scene;

    this.baseCanvas = null;
    this.overlayCanvas = null;
    this.baseCtx = null;
    this.overlayCtx = null;
    this.setCanvases(baseCanvas, overlayCanvas);

    this.target = new THREE.WebGLRenderTarget(SIZE, SIZE);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 20000);
    this.camera.up.set(0, 0, -1);
    this.boardSize = 2048;
    this._pixels = new Uint8Array(SIZE * SIZE * 4);
    this._dirty = true;
    this._timer = 0;
  }

  setCanvases(baseCanvas, overlayCanvas) {
    if (!baseCanvas || !overlayCanvas) return;
    if (this.baseCanvas === baseCanvas && this.overlayCanvas === overlayCanvas) return;
    this.baseCanvas = baseCanvas;
    this.overlayCanvas = overlayCanvas;
    this.baseCtx = this.baseCanvas.getContext('2d');
    this.overlayCtx = this.overlayCanvas.getContext('2d');
    this.requestRedraw({ force: true });
  }

  setBoard(boardSize, maxHeight) {
    this.boardSize = boardSize;
    const half = boardSize / 2;
    this.camera.left = -half;
    this.camera.right = half;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.position.set(0, maxHeight + 2000, 0);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.requestRedraw();
  }

  requestRedraw() { this._dirty = true; }

  // Re-render the base map (debounced by the caller via requestRedraw).
  renderBase() {
    if (!this._dirty || !this.baseCtx) return;
    this._dirty = false;

    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.setClearColor(0x0b0e14, 1);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.readRenderTargetPixels(this.target, 0, 0, SIZE, SIZE, this._pixels);
    this.renderer.setRenderTarget(prevTarget);

    let contentPixels = 0;
    for (let i = 0; i < this._pixels.length; i += 4) {
      if (Math.abs(this._pixels[i] - 11) > 4 || Math.abs(this._pixels[i + 1] - 14) > 4 || Math.abs(this._pixels[i + 2] - 20) > 4) {
        contentPixels++;
        if (contentPixels >= 64) break;
      }
    }
    if (contentPixels < 64) {
      this._dirty = true;
      return;
    }

    // flip Y while copying into ImageData
    const img = this.baseCtx.createImageData(SIZE, SIZE);
    for (let y = 0; y < SIZE; y++) {
      const src = (SIZE - 1 - y) * SIZE * 4;
      img.data.set(this._pixels.subarray(src, src + SIZE * 4), y * SIZE * 4);
    }
    this.baseCtx.putImageData(img, 0, 0);
  }

  // Camera marker: target cross + view direction wedge. Cheap, every frame.
  drawOverlay(controls) {
    const ctx = this.overlayCtx;
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);

    const half = this.boardSize / 2;
    const px = (controls.target.x + half) / this.boardSize * SIZE;
    const py = (controls.target.z + half) / this.boardSize * SIZE;

    // view wedge (direction camera looks FROM, projected)
    const theta = controls.theta;
    const camX = px + Math.sin(theta) * 16;
    const camY = py + Math.cos(theta) * 16;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(camX, camY);
    ctx.lineTo(px, py);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(camX, camY, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.9)';
    ctx.fill();

    // focus target cross
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(px - 5, py); ctx.lineTo(px + 5, py);
    ctx.moveTo(px, py - 5); ctx.lineTo(px, py + 5);
    ctx.stroke();
  }

  dispose() { this.target.dispose(); }
}
