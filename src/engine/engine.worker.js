import { Engine } from './Engine.js';
import { ENGINE_METHODS } from './EngineProxy.js';

class TerrainEventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatchTerrainEvent(type, payload = {}) {
    const event = {
      type,
      preventDefault() {},
      stopPropagation() {},
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
      target: this,
      currentTarget: this,
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
}

class WorkerCanvasFacade extends TerrainEventTarget {
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

let engine = null;
let sequence = 0;
const allowedMethods = new Set(ENGINE_METHODS);
const cancelledRequests = new Set();

function installWorkerDom(canvasFacade) {
  const windowTarget = new TerrainEventTarget();
  const documentTarget = new TerrainEventTarget();
  documentTarget.visibilityState = 'visible';
  documentTarget.pointerLockElement = null;
  documentTarget.exitPointerLock = () => { documentTarget.pointerLockElement = null; };
  documentTarget.createElement = (tag) => {
    if (tag === 'canvas') return new OffscreenCanvas(1, 1);
    return new TerrainEventTarget();
  };
  globalThis.window = Object.assign(windowTarget, {
    location: globalThis.location,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
    requestAnimationFrame: globalThis.requestAnimationFrame?.bind(globalThis)
      || ((callback) => globalThis.setTimeout(() => callback(performance.now()), 16)),
    cancelAnimationFrame: globalThis.cancelAnimationFrame?.bind(globalThis)
      || ((id) => globalThis.clearTimeout(id)),
    devicePixelRatio: 1,
    innerWidth: canvasFacade.clientWidth,
    innerHeight: canvasFacade.clientHeight,
  });
  documentTarget.defaultView = globalThis.window;
  documentTarget.body = new TerrainEventTarget();
  globalThis.document = documentTarget;
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() {}
    disconnect() {}
  };
  globalThis.__terrainSaveBlob = async (blob, filename, { mime } = {}) => {
    self.postMessage({
      type: 'event',
      event: 'onArtifact',
      args: [{ blob, filename, mime: mime || blob?.type }],
      seq: ++sequence,
      snapshot: engine?.getClientSnapshot?.() || null,
    });
    return { canceled: false, path: null };
  };
  canvasFacade.ownerDocument = documentTarget;
}

const serializeError = (error) => ({
  name: error?.name || 'Error',
  message: error?.message || String(error),
  code: error?.code,
  stack: error?.stack,
});

function collectTransferables(value, output = new Set(), seen = new Set()) {
  if (value == null || typeof value !== 'object' || seen.has(value)) return output;
  seen.add(value);
  if (value instanceof ArrayBuffer) output.add(value);
  else if (ArrayBuffer.isView(value)) output.add(value.buffer);
  else if (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap) output.add(value);
  else if (!(value instanceof Blob)) {
    for (const child of Object.values(value)) collectTransferables(child, output, seen);
  }
  return output;
}

function postResult(id, result) {
  const transfer = [...collectTransferables(result)];
  self.postMessage({ type: 'result', id, result }, transfer);
}

function decodeCallbacks(value, seen = new WeakMap()) {
  if (!value || typeof value !== 'object') return value;
  if (value.__terrainCallback) {
    const callbackId = value.__terrainCallback;
    return (...args) => self.postMessage({ type: 'callback', callbackId, args });
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value) || value instanceof Blob) return value;
  if (seen.has(value)) return seen.get(value);
  const output = Array.isArray(value) ? [] : {};
  seen.set(value, output);
  for (const [key, child] of Object.entries(value)) output[key] = decodeCallbacks(child, seen);
  return output;
}

async function initialize(payload) {
  const canvas = new WorkerCanvasFacade(payload.canvas, payload.viewport);
  installWorkerDom(canvas);
  const callbacks = new Proxy({}, {
    get: (_target, event) => (...args) => {
      self.postMessage({
        type: 'event',
        event,
        args,
        seq: ++sequence,
        snapshot: engine?.getClientSnapshot?.() || null,
      });
    },
  });
  engine = new Engine({
    canvas,
    minimapBase: null,
    minimapOverlay: null,
    callbacks,
    initialParams: payload.initialParams,
    initialPerf: payload.initialPerf,
    perfSettingsStored: payload.perfSettingsStored,
    renderWorker: true,
    coldShaderRun: payload.coldShaderRun,
    initialView: payload.initialView,
    initialBootMode: payload.initialBootMode,
  });
  engine.rendererConfig = {
    ...(engine.rendererConfig || {}),
    workerSupported: true,
    workerRequested: true,
    workerActive: true,
    transport: 'worker',
    workerFallbackReason: '',
  };
  engine.setViewport(payload.viewport);
  return engine.getClientSnapshot();
}

self.onmessage = async ({ data }) => {
  const { type, id, args = [] } = data || {};
  try {
    if (type === 'cancel') {
      cancelledRequests.add(id);
      return;
    }
    if (type === 'initialize') {
      const result = await initialize(args[0]);
      postResult(id, result);
      return;
    }
    if (type === 'dispose') {
      engine?.dispose?.();
      engine = null;
      postResult(id, null);
      return;
    }
    if (type !== 'invoke') throw new Error(`Unknown worker request: ${type}`);
    const [method, encodedMethodArgs] = args;
    const methodArgs = decodeCallbacks(encodedMethodArgs);
    if (!allowedMethods.has(method) || typeof engine?.[method] !== 'function') {
      throw new Error(`Unknown engine method: ${method}`);
    }
    const result = await engine[method](...(methodArgs || []));
    if (!cancelledRequests.delete(id)) postResult(id, result);
  } catch (error) {
    if (!cancelledRequests.delete(id)) self.postMessage({ type: 'error', id, error: serializeError(error) });
  }
};
