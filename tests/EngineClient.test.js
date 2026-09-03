import { describe, expect, it, vi } from 'vitest';
import {
  ENGINE_METHODS,
  EngineClient,
  WorkerEngineTransport,
} from '../src/engine/EngineProxy.js';

class FakeTransport {
  constructor() {
    this.state = { params: { seed: 1 }, worldMode: 'studio', disposed: false };
    this.calls = [];
  }
  async initialize(options) { this.options = options; return this.state; }
  invoke(method, args) {
    this.calls.push({ method, args });
    if (method === 'setParam') {
      this.state = { ...this.state, params: { ...this.state.params, [args[0]]: args[1] } };
    }
    if (method === 'serializeState') return { ...this.state.params };
    return true;
  }
  snapshot() { return this.state; }
  async dispose() { this.state = { ...this.state, disposed: true }; }
}

describe('EngineClient', () => {
  it('exposes the explicit contract and locally mirrored snapshots', async () => {
    const transport = new FakeTransport();
    const client = new EngineClient({ callbacks: {} }, transport);
    await client.initialize();
    expect(client.getSnapshot()).toMatchObject({ worldMode: 'studio', params: { seed: 1 } });
    expect(client.worldMode).toBe('studio');
    expect(ENGINE_METHODS).toContain('serializeState');
    client.setParam('seed', 2);
    expect(client.params.seed).toBe(2);
    expect(client.serializeState()).toEqual({ seed: 2 });
  });

  it('publishes ordered callback changes without exposing the engine object', async () => {
    const onParams = vi.fn();
    const listener = vi.fn();
    const transport = new FakeTransport();
    const client = new EngineClient({ callbacks: { onParams } }, transport);
    await client.initialize();
    const unsubscribe = client.subscribe(listener);
    transport.options.callbacks.onParams({ seed: 42 });
    expect(client.params).toEqual({ seed: 42 });
    expect(onParams).toHaveBeenCalledWith({ seed: 42 });
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it('mirrors final terrain shader readiness from engine events', async () => {
    const onTerrainShaderReady = vi.fn();
    const transport = new FakeTransport();
    const client = new EngineClient({ callbacks: { onTerrainShaderReady } }, transport);
    await client.initialize();

    transport.options.callbacks.onTerrainShaderReady(false);
    expect(client.terrainShaderReady).toBe(false);
    transport.options.callbacks.onTerrainShaderReady(true);
    expect(client.terrainShaderReady).toBe(true);
    expect(onTerrainShaderReady).toHaveBeenLastCalledWith(true);
  });

  it('rejects commands deterministically after disposal', async () => {
    const client = new EngineClient({ callbacks: {} }, new FakeTransport());
    await client.initialize();
    await client.dispose();
    expect(() => client.setParam('seed', 3)).toThrowError(/disposed/i);
    expect(client.getSnapshot().disposed).toBe(true);
  });

  it('drops stale worker events by sequence number', async () => {
    class MockWorkerTransport extends WorkerEngineTransport {
      async initialize() { return { params: { seed: 1 } }; }
      invoke() { return true; }
      async dispose() {}
    }
    const onParams = vi.fn();
    const transport = new MockWorkerTransport();
    const client = new EngineClient({ callbacks: { onParams } }, transport);
    await client.initialize();
    transport.onEvent('onParams', [{ seed: 2 }], { params: { seed: 2 } }, 2);
    transport.onEvent('onParams', [{ seed: 1 }], { params: { seed: 1 } }, 1);
    expect(client.params.seed).toBe(2);
    expect(onParams).toHaveBeenCalledTimes(1);
  });
});

describe('WorkerEngineTransport', () => {
  const fakeWorker = () => ({ postMessage: vi.fn(), terminate: vi.fn() });

  it('cancels a pending request once and forwards cancellation to the worker', async () => {
    const transport = new WorkerEngineTransport();
    transport.worker = fakeWorker();
    const controller = new AbortController();
    const pending = transport._request('invoke', ['regenerate', []], [], controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'ENGINE_COMMAND_CANCELLED' });
    expect(transport.worker.postMessage).toHaveBeenLastCalledWith({ type: 'cancel', id: 1 });
    transport._message({ type: 'result', id: 1, result: true });
    expect(transport.pending.size).toBe(0);
  });

  it('transfers buffers without cloning them', async () => {
    const transport = new WorkerEngineTransport();
    transport.worker = fakeWorker();
    const buffer = new ArrayBuffer(16);
    const pending = transport._request('invoke', ['restoreState', [buffer]], [buffer]);
    expect(transport.worker.postMessage).toHaveBeenCalledWith(
      { type: 'invoke', id: 1, args: ['restoreState', [buffer]] },
      [buffer],
    );
    transport._message({ type: 'result', id: 1, result: true });
    await expect(pending).resolves.toBe(true);
  });

  it('rejects current and future calls deterministically after a worker crash', async () => {
    const transport = new WorkerEngineTransport();
    const worker = fakeWorker();
    transport.worker = worker;
    const pending = transport._request('invoke', ['serializeState', []]);
    const failure = Object.assign(new Error('worker crashed'), { code: 'ENGINE_WORKER_FAILED' });
    transport._handleFailure(failure);
    await expect(pending).rejects.toBe(failure);
    await expect(transport._request('invoke', ['serializeState', []])).rejects.toBe(failure);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
