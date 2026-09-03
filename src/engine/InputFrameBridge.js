const pointerPayload = (event) => ({
  type: event.type,
  pointerId: event.pointerId,
  pointerType: event.pointerType,
  button: event.button,
  buttons: event.buttons,
  clientX: event.clientX,
  clientY: event.clientY,
  movementX: event.movementX,
  movementY: event.movementY,
  ctrlKey: event.ctrlKey,
  shiftKey: event.shiftKey,
  altKey: event.altKey,
  metaKey: event.metaKey,
});

const keyPayload = (event) => ({
  type: event.type,
  key: event.key,
  code: event.code,
  repeat: event.repeat,
  ctrlKey: event.ctrlKey,
  shiftKey: event.shiftKey,
  altKey: event.altKey,
  metaKey: event.metaKey,
});

export class InputFrameBridge {
  constructor({ canvas, send }) {
    this.canvas = canvas;
    this.send = send;
    this.pointerEvents = [];
    this.keyEvents = [];
    this.wheel = null;
    this.frame = 0;
    this.disposed = false;
    this.listeners = [];
    this.suppressContextMenuUntil = 0;
    this._bind();
  }

  _listen(target, type, handler, options) {
    target?.addEventListener?.(type, handler, options);
    this.listeners.push(() => target?.removeEventListener?.(type, handler, options));
  }

  _bind() {
    // Camera controls live inside the render worker, so their contextmenu
    // handler runs against the worker DOM shim and cannot cancel the browser's
    // native menu. Cancel it on the real canvas before forwarding input. The
    // document listener also covers a right-drag released over landing/editor
    // UI after it started on the canvas.
    const onContextMenu = (event) => {
      const path = event.composedPath?.() || [];
      const fromCanvas = event.target === this.canvas || path.includes(this.canvas);
      const followsCanvasRightPress = performance.now() <= this.suppressContextMenuUntil;
      if (!fromCanvas && !followsCanvasRightPress) return;
      event.preventDefault();
      this.suppressContextMenuUntil = 0;
    };
    this._listen(this.canvas, 'contextmenu', onContextMenu);
    this._listen(document, 'contextmenu', onContextMenu, true);
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave']) {
      this._listen(this.canvas, type, (event) => {
        if (type === 'pointerdown') {
          // Worker-side setPointerCapture() is necessarily a no-op. Mirror it
          // on the actual canvas so camera drags continue across UI overlays.
          try { this.canvas.setPointerCapture?.(event.pointerId); } catch { /* unsupported pointer */ }
          if (event.button === 2) {
            this.suppressContextMenuUntil = performance.now() + 1500;
            event.preventDefault();
          }
        } else if (type === 'pointerup' || type === 'pointercancel') {
          try { this.canvas.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
        }
        this.pointerEvents.push(pointerPayload(event));
        this._schedule();
      }, { passive: type === 'pointermove' });
    }
    this._listen(this.canvas, 'wheel', (event) => {
      event.preventDefault();
      const current = this.wheel || { type: 'wheel', deltaX: 0, deltaY: 0, deltaMode: event.deltaMode };
      current.deltaX += event.deltaX;
      current.deltaY += event.deltaY;
      current.clientX = event.clientX;
      current.clientY = event.clientY;
      this.wheel = current;
      this._schedule();
    }, { passive: false });
    for (const type of ['keydown', 'keyup']) {
      this._listen(document, type, (event) => {
        this.keyEvents.push(keyPayload(event));
        this._schedule();
      }, true);
    }
    this._listen(document, 'visibilitychange', () => {
      void this.send('setViewport', [{ visible: document.visibilityState === 'visible' }]);
    });
    this.resizeObserver = new ResizeObserver(() => this.sendViewport());
    this.resizeObserver.observe(this.canvas.parentElement || this.canvas);
  }

  sendViewport() {
    const rect = this.canvas.parentElement?.getBoundingClientRect?.() || this.canvas.getBoundingClientRect();
    return this.send('setViewport', [{
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
      pixelRatio: globalThis.devicePixelRatio || 1,
      visible: document.visibilityState === 'visible',
    }]);
  }

  _schedule() {
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const payload = {
        pointerEvents: this.pointerEvents.splice(0),
        keyEvents: this.keyEvents.splice(0),
        wheel: this.wheel,
        visible: document.visibilityState === 'visible',
      };
      this.wheel = null;
      void this.send('applyInputFrame', [payload]);
    });
  }

  dispose() {
    this.disposed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.suppressContextMenuUntil = 0;
    this.resizeObserver?.disconnect?.();
    this.listeners.splice(0).forEach((dispose) => dispose());
  }
}
