import { hasStoredPerfSettings, loadPerfSettings } from './render/PerformanceSettings.js';
import { InputFrameBridge } from './InputFrameBridge.js';
import { MinimapPresenter } from './MinimapPresenter.js';
import { saveBlob } from '../platform/DesktopBridge.js';
import { parseShaderBenchmarkOptions } from './render/ShaderBenchmark.js';

const DEVELOPMENT_WORKER_OVERRIDE = import.meta.env.DEV && typeof location !== 'undefined'
  ? new URLSearchParams(location.search).get('workerRenderer')
  : null;

export function supportsWorkerRenderer(canvas) {
  return typeof OffscreenCanvas !== 'undefined'
    && typeof canvas?.transferControlToOffscreen === 'function'
    && typeof Worker !== 'undefined';
}

export const ENGINE_METHODS = Object.freeze([
  'addManualShapeLayer', 'applyErosionPreset', 'applyNoisePresetByKey',
  'buildAndSetSurfaceAtlas',
  'applyNoiseStackPresetByKey', 'applyPalettePresetByKey', 'applyPlanetPresetByKey',
  'applyPresetByKey', 'applyWaterBaselineScene', 'bakeErosion', 'beginManualShapeDrag',
  'cancelSplineCreation', 'capturePreviewThumbnail', 'captureWaterBaseline',
  'clearErosion', 'clearExplosions', 'clearManualPropPaint', 'clearManualSculpt',
  'clearManualTexturePaint', 'clearPaintLayers', 'confirmSplineCreation',
  'createProjectPayload', 'createSnapshot', 'createSpline', 'deleteManualShape',
  'deleteManualShapeLayer', 'deleteSnapshot', 'deleteSpline', 'duplicateManualShape',
  'duplicateManualShapeLayer', 'duplicateSpline', 'endManualShapeDrag',
  'export3DTerrain', 'exportHeightmap', 'exportPlanetStyle', 'exportScreenshot',
  'exportWaterMasks', 'focusCenter', 'generatePalette', 'getCachedSurfaceAtlas',
  'getClientSnapshot', 'getMinimapInfoAt', 'getPerfDiagnostics', 'getTargetTerrainVariant',
  'getGraphicsDiagnostics',
  'hasErosionResult', 'importPlanetStyleJSON', 'importTileMap', 'installCachedSurfaceAtlas',
  'getMinimapFrame',
  'loadRealWorldCustom', 'loadRealWorldLocation', 'loadSeedJSON', 'moveManualShape',
  'moveManualShapeLayer', 'newProject', 'randomizePlanetPreset', 'randomizeSeed',
  'regenerate', 'removeTile', 'renameSnapshot', 'resetPanelSettings', 'resetPerfSettings',
  'resetView', 'restoreSnapshot', 'restoreState', 'retryBoot', 'selectManualShape',
  'selectSpline', 'serializeErosion', 'serializeManualSculpt', 'serializeManualSurface',
  'serializePaint', 'serializeState', 'setAnalysisMode', 'setAnalysisSettings',
  'setAutoRotate', 'setBehindCameraCulling', 'setCameraMode', 'setCameraView',
  'setClientState', 'setCloudQuality', 'setCullingEnabled', 'setDebugFlag',
  'setExplodeSetting', 'setExplodeToolEnabled', 'setExploreMode', 'setFov',
  'setGraphView', 'setLandingShowcase', 'setManualPlacementType',
  'setManualSculptEnabled', 'setManualSculptSetting', 'setManualTexturePaintEnabled',
  'setManualTexturePaintSetting', 'setManualTransformMode', 'setManualWorkspaceActive',
  'setPerformanceProfilerActive',
  'setMinimapCanvases', 'setMinimapConfig', 'setMinimapHover', 'setNoiseStack',
  'setPaintBaseMode', 'setPaintMode', 'setPaintSetting', 'setParam', 'setPerfPreset',
  'setPerfSetting', 'setPlanetStyleColor', 'setPlanetStyleTuning', 'setQuality',
  'setRealWorldBuildingsVisible', 'setRealWorldImageryStyle', 'setSoloLayer',
  'setSplineEditingEnabled', 'setSurfaceAtlas', 'setTerrainGraph', 'setTileAssemblyShape',
  'setTileDebug', 'setTileMapSetting', 'setTimeOfDay', 'setTouchInput', 'setViewport',
  'smoothExplosionEdges', 'startEmptyTerrain', 'transitionMode', 'updateManualShape',
  'updateManualShapeLayer', 'updateSpline', 'applyInputFrame',
]);

const cloneError = (payload) => {
  const error = new Error(payload?.message || 'Engine command failed');
  error.name = payload?.name || 'Error';
  error.code = payload?.code;
  error.stack = payload?.stack || error.stack;
  return error;
};

export class MainThreadEngineTransport {
  constructor() { this.engine = null; }
  async initialize(options) {
    const { Engine } = await import('./Engine.js');
    this.engine = new Engine(options);
    return this.engine.getClientSnapshot();
  }
  invoke(method, args = [], { signal } = {}) {
    const fn = this.engine?.[method];
    if (typeof fn !== 'function') throw new Error(`Unknown engine method: ${method}`);
    const result = fn.apply(this.engine, args);
    if (!signal || !result?.then) return result;
    return Promise.race([
      result,
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(
        Object.assign(new Error('Engine command cancelled'), { code: 'ENGINE_COMMAND_CANCELLED' }),
      ), { once: true })),
    ]);
  }
  snapshot() { return this.engine?.getClientSnapshot?.() || null; }
  async dispose() { this.engine?.dispose?.(); this.engine = null; }
}

export class WorkerEngineTransport {
  constructor() {
    this.worker = null;
    this.failure = null;
    this.disposed = false;
    this.pending = new Map();
    this.nextId = 1;
    this.nextCallbackId = 1;
    this.remoteCallbacks = new Map();
    this.onEvent = null;
    this.inputBridge = null;
    this.minimapPresenter = new MinimapPresenter();
    this.minimapPresenter.requestFrame = () => this._request('invoke', ['getMinimapFrame', []]);
  }

  initialize(options) {
    const canvas = options.canvas;
    const offscreen = canvas.transferControlToOffscreen();
    const rect = canvas.parentElement?.getBoundingClientRect?.() || canvas.getBoundingClientRect();
    this.worker = new Worker(new URL('./engine.worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => this._message(data);
    this.worker.onerror = (event) => this._handleFailure(
      Object.assign(new Error(event.message || 'Render worker failed'), { code: 'ENGINE_WORKER_FAILED' }),
    );
    this.worker.onmessageerror = () => this._handleFailure(
      Object.assign(new Error('Render worker message could not be decoded'), { code: 'ENGINE_WORKER_FAILED' }),
    );
    const initialized = this._request('initialize', [{
      canvas: offscreen,
      initialParams: options.initialParams,
      initialPerf: options.initialPerf,
      perfSettingsStored: options.perfSettingsStored,
      initialView: options.initialView,
      initialBootMode: options.initialBootMode,
      coldShaderRun: options.coldShaderRun,
      shaderBenchmark: options.shaderBenchmark,
      viewport: {
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
        pixelRatio: globalThis.devicePixelRatio || 1,
      },
    }], [offscreen]);
    this.inputBridge = new InputFrameBridge({
      canvas,
      send: (method, args) => this.invoke(method, args),
    });
    return initialized;
  }

  invoke(method, args = [], { transfer = [], signal } = {}) {
    if (method === 'setMinimapCanvases') {
      this.minimapPresenter.setCanvases(args[0], args[1]);
      return null;
    }
    const callbackIds = [];
    const encodedArgs = this._encodeCallbacks(args, callbackIds);
    const result = this._request('invoke', [method, encodedArgs], transfer, signal);
    if (method === 'setMinimapConfig' || method === 'setMinimapHover') {
      Promise.resolve(result).finally(() => this.minimapPresenter.refresh());
    }
    return Promise.resolve(result).finally(() => {
      callbackIds.forEach((id) => this.remoteCallbacks.delete(id));
    });
  }

  _encodeCallbacks(value, callbackIds, seen = new WeakMap()) {
    if (typeof value === 'function') {
      const id = this.nextCallbackId++;
      callbackIds.push(id);
      this.remoteCallbacks.set(id, value);
      return { __terrainCallback: id };
    }
    if (!value || typeof value !== 'object' || value instanceof Blob
        || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value;
    if (seen.has(value)) return seen.get(value);
    const output = Array.isArray(value) ? [] : {};
    seen.set(value, output);
    for (const [key, child] of Object.entries(value)) {
      output[key] = this._encodeCallbacks(child, callbackIds, seen);
    }
    return output;
  }

  _request(type, args, transfer = [], signal = null) {
    if (this.disposed) {
      return Promise.reject(Object.assign(new Error('Engine client disposed'), { code: 'ENGINE_DISPOSED' }));
    }
    if (this.failure) return Promise.reject(this.failure);
    if (!this.worker) {
      return Promise.reject(Object.assign(new Error('Render worker is unavailable'), { code: 'ENGINE_WORKER_FAILED' }));
    }
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      const abort = () => {
        if (!this.pending.delete(id)) return;
        this.worker?.postMessage?.({ type: 'cancel', id });
        reject(Object.assign(new Error('Engine command cancelled'), { code: 'ENGINE_COMMAND_CANCELLED' }));
      };
      this.pending.set(id, { resolve, reject, signal, abort });
      signal?.addEventListener?.('abort', abort, { once: true });
    });
    this.worker.postMessage({ type, id, args }, transfer);
    return promise;
  }

  _message(data) {
    if (data?.type === 'callback') {
      this.remoteCallbacks.get(data.callbackId)?.(...(data.args || []));
      return;
    }
    if (data?.type === 'event') {
      this.onEvent?.(data.event, data.args || [], data.snapshot || null, data.seq);
      if (data.event === 'onCamera' || data.event === 'onParams' || data.event === 'onTiles') {
        void this.minimapPresenter.refresh();
      }
      return;
    }
    const pending = this.pending.get(data?.id);
    if (!pending) return;
    this.pending.delete(data.id);
    pending.signal?.removeEventListener?.('abort', pending.abort);
    if (data.type === 'error') pending.reject(cloneError(data.error));
    else pending.resolve(data.result);
  }

  _failAll(error) {
    for (const pending of this.pending.values()) {
      pending.signal?.removeEventListener?.('abort', pending.abort);
      pending.reject(error);
    }
    this.pending.clear();
  }

  _handleFailure(error) {
    if (this.failure || this.disposed) return;
    this.failure = error;
    this.inputBridge?.dispose?.();
    this.inputBridge = null;
    this.minimapPresenter.setCanvases(null, null);
    this.worker?.terminate?.();
    this.worker = null;
    this.remoteCallbacks.clear();
    this._failAll(error);
  }

  async dispose() {
    if (this.disposed) return;
    this.inputBridge?.dispose?.();
    this.inputBridge = null;
    this.minimapPresenter.setCanvases(null, null);
    const worker = this.worker;
    if (worker && !this.failure) {
      try { await this._request('dispose', []); } catch { /* worker may already be gone */ }
    }
    this.disposed = true;
    worker?.terminate?.();
    this.worker = null;
    this.remoteCallbacks.clear();
    this._failAll(Object.assign(new Error('Engine client disposed'), { code: 'ENGINE_DISPOSED' }));
  }
}

export class EngineClient {
  constructor(options, transport) {
    this.options = options;
    this.transport = transport;
    this.snapshot = Object.freeze({});
    this.listeners = new Set();
    this.disposed = false;
    this.workerActive = transport instanceof WorkerEngineTransport;
    this.lastEventSequence = 0;
  }

  async initialize() {
    const callbacks = this.options.callbacks || {};
    const wrappedCallbacks = Object.fromEntries(Object.entries(callbacks).map(([name, callback]) => [
      name,
      (...args) => {
        this._applyEvent(name, args);
        callback?.(...args);
      },
    ]));
    if (this.transport instanceof WorkerEngineTransport) {
      this.transport.onEvent = (name, args, snapshot, seq) => {
        if (!this._acceptEventSequence(seq)) return;
        if (snapshot) this._setSnapshot(snapshot);
        this._applyEvent(name, args, seq);
        if (name === 'onArtifact') {
          const artifact = args[0];
          void saveBlob(artifact.blob, artifact.filename, { mime: artifact.mime });
          return;
        }
        callbacks[name]?.(...args);
      };
    }
    const snapshot = await this.transport.initialize({
      ...this.options,
      callbacks: wrappedCallbacks,
    });
    this._setSnapshot(snapshot);
    return snapshot;
  }

  command(method, args = [], options = {}) {
    if (this.disposed) throw Object.assign(new Error('Engine client disposed'), { code: 'ENGINE_DISPOSED' });
    if (options.signal?.aborted) throw Object.assign(new Error('Engine command cancelled'), { code: 'ENGINE_COMMAND_CANCELLED' });
    const result = this.transport.invoke(method, args, options);
    if (result && typeof result.then === 'function') return result.finally(() => this._refreshSnapshot());
    this._refreshSnapshot();
    return result;
  }

  query(method, args = [], options = {}) { return this.command(method, args, options); }
  getSnapshot() { return this.snapshot; }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  _refreshSnapshot() {
    const next = this.transport.snapshot?.();
    if (next) this._setSnapshot(next);
  }

  _setSnapshot(next) {
    this.snapshot = Object.freeze({ ...(next || {}) });
    for (const listener of this.listeners) listener(this.snapshot);
  }

  _applyEvent(name, args, seq = null) {
    const patch = { lastEvent: { name, seq, at: performance.now() } };
    if (name === 'onParams') patch.params = args[0];
    if (name === 'onPerfChange') patch.perf = args[0];
    if (name === 'onProjectMode') patch.projectMode = args[0];
    if (name === 'onTimeOfDayChange') patch.timeOfDay = args[0];
    this._setSnapshot({ ...this.snapshot, ...patch });
  }

  _acceptEventSequence(seq) {
    if (!Number.isFinite(seq)) return true;
    if (seq <= this.lastEventSequence) return false;
    this.lastEventSequence = seq;
    return true;
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    await this.transport.dispose();
    this.listeners.clear();
    this._setSnapshot({ ...this.snapshot, disposed: true });
  }
}

for (const method of ENGINE_METHODS) {
  if (method in EngineClient.prototype) continue;
  Object.defineProperty(EngineClient.prototype, method, {
    value(...args) { return this.command(method, args); },
  });
}

const snapshotGetters = {
  params: 'params', perf: 'perf', gpuName: 'gpuName', rendererConfig: 'rendererConfig',
  rendererCapabilities: 'rendererCapabilities', worldMode: 'worldMode',
  projectMode: 'projectMode', realWorldSource: 'realWorldSource', timeOfDay: 'timeOfDay',
  _soloLayerId: 'soloLayerId', _disposed: 'disposed',
};
for (const [property, snapshotKey] of Object.entries(snapshotGetters)) {
  Object.defineProperty(EngineClient.prototype, property, {
    get() { return this.snapshot[snapshotKey]; },
  });
}
Object.defineProperty(EngineClient.prototype, 'workspacePreset', {
  get() { return this.snapshot.workspacePreset; },
  set(value) { void this.command('setClientState', [{ workspacePreset: value }]); },
});
Object.defineProperty(EngineClient.prototype, 'erosionField', {
  get() { return { hasResult: () => !!this.snapshot.erosionHasResult }; },
});
Object.defineProperty(EngineClient.prototype, '_targetTerrainVariant', {
  get() { return () => this.snapshot.targetTerrainVariant; },
});

export async function createEngineProxy(options) {
  const loadedPerf = options.initialPerf || loadPerfSettings();
  const perf = DEVELOPMENT_WORKER_OVERRIDE === '1'
    ? { ...loadedPerf, useWorker: true }
    : DEVELOPMENT_WORKER_OVERRIDE === '0'
      ? { ...loadedPerf, useWorker: false }
      : loadedPerf;
  const workerSupported = supportsWorkerRenderer(options.canvas);
  const workerRequested = DEVELOPMENT_WORKER_OVERRIDE === '1'
    || (DEVELOPMENT_WORKER_OVERRIDE !== '0' && !!perf.useWorker);
  const useWorker = workerRequested && workerSupported;
  const coldShaderRun = typeof location !== 'undefined'
    ? new URLSearchParams(location.search).get('coldShaderRun')
    : null;
  const shaderBenchmark = typeof location !== 'undefined'
    ? parseShaderBenchmarkOptions(location.search)
    : null;
  const transport = useWorker ? new WorkerEngineTransport() : new MainThreadEngineTransport();
  const client = new EngineClient({
    ...options,
    initialPerf: perf,
    perfSettingsStored: DEVELOPMENT_WORKER_OVERRIDE != null || hasStoredPerfSettings(),
    renderWorker: useWorker,
    coldShaderRun: shaderBenchmark ? null : coldShaderRun,
    shaderBenchmark,
  }, transport);
  await client.initialize();
  const rendererConfig = {
    ...(client.snapshot.rendererConfig || {}),
    workerSupported,
    workerRequested,
    workerActive: useWorker,
    transport: useWorker ? 'worker' : 'main-thread',
    workerFallbackReason: workerRequested && !workerSupported ? 'OffscreenCanvas renderer unavailable' : '',
  };
  client._setSnapshot({ ...client.snapshot, rendererConfig });
  if (!useWorker && transport.engine?.rendererConfig) transport.engine.rendererConfig = rendererConfig;
  return client;
}
