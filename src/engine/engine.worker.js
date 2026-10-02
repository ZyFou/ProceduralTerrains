import { Engine } from './EnergySavingEngine.js';
import { ENGINE_METHODS } from './EngineProxy.js';
import { prepareWorkerResult } from './WorkerProtocol.js';
import { WorkerCanvasFacade, createWorkerDom } from './WorkerDom.js';

let engine = null;
let sequence = 0;
let surfaceAtlasRevision = 0;
const allowedMethods = new Set(ENGINE_METHODS);
const cancelledRequests = new Set();

function installWorkerDom(canvasFacade) {
  const { windowTarget, documentTarget } = createWorkerDom(canvasFacade);
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
    shaderBenchmark: payload.shaderBenchmark,
    bootLinkMode: payload.bootLinkMode,
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
    let engineResult;
    if (method === 'buildAndSetSurfaceAtlas') {
      const [source, customMaps, revision] = methodArgs;
      const { buildAndInstallSurfaceAtlas, surfaceAtlasSuperseded } = await import('./terrain/surface/SurfaceAtlasBridge.js');
      if (!Number.isFinite(revision) || revision < surfaceAtlasRevision) throw surfaceAtlasSuperseded();
      surfaceAtlasRevision = revision;
      const target = engine;
      engineResult = await buildAndInstallSurfaceAtlas(target, source, customMaps, {
        isCurrent: () => engine === target && revision === surfaceAtlasRevision && !cancelledRequests.has(id),
      });
    } else {
      engineResult = await engine[method](...(methodArgs || []));
    }
    const result = await prepareWorkerResult(method, engineResult);
    if (!cancelledRequests.delete(id)) postResult(id, result);
  } catch (error) {
    if (!cancelledRequests.delete(id)) self.postMessage({ type: 'error', id, error: serializeError(error) });
  }
};
