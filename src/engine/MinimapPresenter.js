export class MinimapPresenter {
  constructor() {
    this.baseCanvas = null;
    this.overlayCanvas = null;
    this.requestFrame = null;
    this.pending = false;
  }

  setCanvases(baseCanvas, overlayCanvas) {
    this.baseCanvas = baseCanvas;
    this.overlayCanvas = overlayCanvas;
    if (baseCanvas && overlayCanvas) void this.refresh();
  }

  async refresh() {
    if (this.pending || !this.baseCanvas || !this.overlayCanvas || !this.requestFrame) return;
    this.pending = true;
    try {
      const packet = await this.requestFrame();
      if (!packet || !this.baseCanvas || !this.overlayCanvas) return;
      this._drawBase(packet);
      this._drawOverlay(packet.overlay || {}, packet.width, packet.height);
    } finally {
      this.pending = false;
    }
  }

  _drawBase(packet) {
    const context = this.baseCanvas.getContext('2d');
    if (!context) return;
    const data = packet.rgba instanceof Uint8ClampedArray
      ? packet.rgba
      : new Uint8ClampedArray(packet.rgba);
    context.putImageData(new ImageData(data, packet.width, packet.height), 0, 0);
  }

  _drawOverlay(overlay, width, height) {
    const context = this.overlayCanvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, width, height);
    if (overlay.showChunkGrid && overlay.chunkCount > 1) {
      context.strokeStyle = 'rgba(255,255,255,0.16)';
      context.lineWidth = 1;
      for (let index = 1; index < overlay.chunkCount; index += 1) {
        const position = (index / overlay.chunkCount) * width;
        context.beginPath(); context.moveTo(position, 0); context.lineTo(position, height); context.stroke();
        context.beginPath(); context.moveTo(0, position); context.lineTo(width, position); context.stroke();
      }
    }
    const focus = overlay.focus;
    if (focus) {
      const cameraX = focus.x + Math.sin(overlay.theta || 0) * 16;
      const cameraY = focus.y + Math.cos(overlay.theta || 0) * 16;
      context.strokeStyle = 'rgba(56, 189, 248, 0.55)';
      context.beginPath(); context.moveTo(cameraX, cameraY); context.lineTo(focus.x, focus.y); context.stroke();
      context.fillStyle = 'rgba(56, 189, 248, 0.92)';
      context.beginPath(); context.arc(cameraX, cameraY, 3, 0, Math.PI * 2); context.fill();
    }
    if (overlay.hover) {
      context.strokeStyle = 'rgba(255, 232, 153, 0.95)';
      context.beginPath(); context.arc(overlay.hover.x, overlay.hover.y, 5, 0, Math.PI * 2); context.stroke();
    }
  }
}
