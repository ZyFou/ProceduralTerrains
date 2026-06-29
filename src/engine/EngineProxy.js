function supportsWorkerRenderer(canvas) {
  return typeof OffscreenCanvas !== 'undefined' &&
    !!canvas?.transferControlToOffscreen &&
    typeof Worker !== 'undefined';
}

class EngineProxyHost {
  constructor(options) {
    this._options = options;
    this._engine = null;
    this._workerActive = false;
  }

  async init() {
    const { Engine } = await import('./Engine.js');
    this._engine = new Engine(this._options);
    if (this._engine.rendererConfig) {
      this._engine.rendererConfig = {
        ...this._engine.rendererConfig,
        workerSupported: supportsWorkerRenderer(this._options?.canvas),
        workerActive: this._workerActive,
      };
    }
  }

  dispose() {
    this._engine?.dispose?.();
  }

  get workerActive() {
    return this._workerActive;
  }
}

const handler = {
  get(target, prop, receiver) {
    if (prop in target) {
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    }
    const engine = target._engine;
    const value = engine?.[prop];
    return typeof value === 'function' ? value.bind(engine) : value;
  },

  set(target, prop, value, receiver) {
    if (prop in target || !target._engine) {
      return Reflect.set(target, prop, value, receiver);
    }
    target._engine[prop] = value;
    return true;
  },

  has(target, prop) {
    return prop in target || prop in (target._engine || {});
  },
};

export async function createEngineProxy(options) {
  const host = new EngineProxyHost(options);
  const proxy = new Proxy(host, handler);
  await host.init();
  return proxy;
}

export { supportsWorkerRenderer };
