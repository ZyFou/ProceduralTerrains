import { useSyncExternalStore } from 'react';

const EMPTY_METRICS = Object.freeze({
  stats: Object.freeze({ fps: 0, triangles: 0, drawCalls: 0 }),
  lodCounts: Object.freeze([0, 0, 0, 0]),
  chunkCount: 1,
  visibleChunks: 1,
  culledChunks: 0,
  camInfo: Object.freeze({ angle: '–', distance: '–' }),
  infiniteStats: null,
  playerState: null,
});

export function createLiveMetricsStore(initial = {}) {
  let snapshot = { ...EMPTY_METRICS, ...initial };
  const listeners = new Set();
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(patch) {
      snapshot = { ...snapshot, ...patch };
      for (const listener of listeners) listener();
    },
  };
}

export function useLiveMetrics(store) {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
}
