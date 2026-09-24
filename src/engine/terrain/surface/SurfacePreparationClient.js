import { materializePreparedSurface } from './SurfacePreparationWire.js';

let worker;
let nextId = 1;
const pending = new Map();

export function cancelSurfacePreparations() {
  if (pending.size === 0) return;
  for (const job of pending.values()) {
    job.signal?.removeEventListener('abort', job.abort);
    job.reject(Object.assign(new Error('Surface build superseded'), {
      code: 'SURFACE_ATLAS_SUPERSEDED',
    }));
  }
  pending.clear();
  worker?.terminate();
  worker = null;
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./SurfacePreparationWorker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const job = pending.get(data.id);
    if (!job) {
      data.result?.textures?.color?.close?.();
      data.result?.textures?.properties?.close?.();
      return;
    }
    pending.delete(data.id);
    job.signal?.removeEventListener('abort', job.abort);
    if (data.error) {
      const error = new Error(data.error.message);
      error.name = data.error.name;
      error.stack = data.error.stack;
      job.reject(error);
    } else job.resolve(data.result);
  };
  worker.onerror = (event) => {
    for (const job of pending.values()) job.reject(new Error(event.message || 'Surface preparation worker failed'));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

export async function prepareSurfaceInBackground(options, { signal } = {}) {
  signal?.throwIfAborted();
  const id = nextId++;
  const prepared = await new Promise((resolve, reject) => {
    const abort = () => {
      cancelSurfacePreparations();
      reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    };
    pending.set(id, { resolve, reject, signal, abort });
    signal?.addEventListener('abort', abort, { once: true });
    getWorker().postMessage({ id, options });
  });
  if (signal?.aborted) {
    prepared.textures?.color?.close?.();
    prepared.textures?.properties?.close?.();
    signal.throwIfAborted();
  }
  return materializePreparedSurface(prepared);
}
