// Minimal DOM stand-ins for the render worker. Input arrives from the main
// thread (InputFrameBridge) and is dispatched on the canvas facade (pointer,
// wheel, drag) or the document (keys). Like a real browser these events then
// propagate: capture listeners on window → document → target, then bubble
// back target → document → window. Tools that end a stroke on a window
// `pointerup` (manual sculpt/texture paint, Paint Mode, spline editing) rely
// on that bubbling.

const NON_BUBBLING_EVENTS = new Set([
  'pointerenter',
  'pointerleave',
  'mouseenter',
  'mouseleave',
  'focus',
  'blur',
  'load',
  'webglcontextlost',
  'webglcontextrestored',
]);

const captureFlag = (options) => (typeof options === 'boolean' ? options : !!options?.capture);

export class TerrainEventTarget {
  constructor() {
    this.listeners = new Map();
    // Next target up the propagation path (canvas → document → window).
    this.eventParent = null;
  }

  addEventListener(type, listener, options) {
    if (!listener) return;
    const capture = captureFlag(options);
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    const entries = this.listeners.get(type);
    if (entries.some((entry) => entry.listener === listener && entry.capture === capture)) return;
    entries.push({ listener, capture });
  }

  removeEventListener(type, listener, options) {
    const entries = this.listeners.get(type);
    if (!entries) return;
    const capture = captureFlag(options);
    const index = entries.findIndex((entry) => entry.listener === listener && entry.capture === capture);
    if (index >= 0) entries.splice(index, 1);
  }

  _invoke(event, phase) {
    const entries = this.listeners.get(event.type);
    if (!entries?.length) return;
    event.currentTarget = this;
    event.eventPhase = phase;
    // Snapshot: a listener may add/remove listeners while running.
    for (const entry of entries.slice()) {
      if (event._immediateStopped) return;
      if (phase === 1 && !entry.capture) continue;
      if (phase === 3 && entry.capture) continue;
      if (!entries.includes(entry)) continue;
      const { listener } = entry;
      if (typeof listener === 'function') listener.call(this, event);
      else listener?.handleEvent?.(event);
    }
  }

  dispatchTerrainEvent(type, payload = {}) {
    const bubbles = !NON_BUBBLING_EVENTS.has(type);
    const event = {
      type,
      bubbles,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      button: 0,
      buttons: 0,
      pointerType: 'mouse',
      clientX: 0,
      clientY: 0,
      deltaX: 0,
      deltaY: 0,
      deltaMode: 0,
      key: '',
      code: '',
      repeat: false,
      ...payload,
      target: payload.target ?? this,
      currentTarget: this,
      eventPhase: 2,
      _stopped: false,
      _immediateStopped: false,
      stopPropagation() { this._stopped = true; },
      stopImmediatePropagation() { this._stopped = true; this._immediateStopped = true; },
      composedPath: () => path.slice(),
    };
    const path = [this];
    if (bubbles) {
      for (let node = this.eventParent; node && !path.includes(node); node = node.eventParent) path.push(node);
    }
    // Capture: outermost ancestor down to (not including) the target.
    for (let i = path.length - 1; i >= 1; i--) {
      path[i]._invoke(event, 1);
      if (event._stopped) return event;
    }
    // At target: every listener, capture or not, in registration order.
    path[0]._invoke(event, 2);
    if (!bubbles || event._stopped) return event;
    for (let i = 1; i < path.length; i++) {
      path[i]._invoke(event, 3);
      if (event._stopped) return event;
    }
    return event;
  }
}

export class WorkerCanvasFacade extends TerrainEventTarget {
  constructor(canvas, viewport) {
    super();
    this.canvas = canvas;
    this.viewport = { ...viewport };
    this.style = {};
    this.parentElement = this;
    this.tabIndex = 0;
    for (const type of ['webglcontextlost', 'webglcontextrestored']) {
      canvas.addEventListener?.(type, (event) => {
        this.dispatchTerrainEvent(type, {
          statusMessage: event?.statusMessage || '',
          preventDefault: () => event?.preventDefault?.(),
        });
      });
    }
  }
  get width() { return this.canvas.width; }
  set width(value) { this.canvas.width = value; }
  get height() { return this.canvas.height; }
  set height(value) { this.canvas.height = value; }
  get clientWidth() { return this.viewport.width; }
  get clientHeight() { return this.viewport.height; }
  getContext(...args) { return this.canvas.getContext(...args); }
  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      right: this.viewport.width,
      bottom: this.viewport.height,
      width: this.viewport.width,
      height: this.viewport.height,
    };
  }
  setTerrainViewport(width, height) { this.viewport = { ...this.viewport, width, height }; }
  setPointerCapture() {}
  releasePointerCapture() {}
  requestPointerLock() { document.pointerLockElement = this; }
  focus() {}
}

/**
 * Builds the worker's window/document stand-ins and links the propagation
 * path canvas → document → window. Returns them without installing globals.
 */
export function createWorkerDom(canvasFacade) {
  const windowTarget = new TerrainEventTarget();
  const documentTarget = new TerrainEventTarget();
  documentTarget.eventParent = windowTarget;
  documentTarget.visibilityState = 'visible';
  documentTarget.pointerLockElement = null;
  documentTarget.exitPointerLock = () => { documentTarget.pointerLockElement = null; };
  documentTarget.createElement = (tag) => {
    if (tag === 'canvas') return new OffscreenCanvas(1, 1);
    return new TerrainEventTarget();
  };
  documentTarget.defaultView = windowTarget;
  documentTarget.body = new TerrainEventTarget();
  documentTarget.body.eventParent = documentTarget;
  if (canvasFacade) {
    canvasFacade.eventParent = documentTarget;
    canvasFacade.ownerDocument = documentTarget;
  }
  return { windowTarget, documentTarget };
}
