import { describe, expect, it, vi } from 'vitest';
import {
  MODE_TRANSITION_STAGES,
  ModeResourceCache,
  ModeTransitionCoordinator,
  PreparedModeBundle,
  createModeRenderKey,
} from '../src/engine/mode/ModeTransitionCoordinator.js';

describe('ModeTransitionCoordinator', () => {
  it('runs exact-frame stages in order and completes once', async () => {
    const order = [];
    const progress = [];
    const onComplete = vi.fn();
    const hooks = Object.fromEntries(MODE_TRANSITION_STAGES.map((stage) => [stage, async () => {
      order.push(stage);
      return { [stage]: true };
    }]));
    const coordinator = new ModeTransitionCoordinator({
      hooks,
      onComplete,
      onProgress: (event) => progress.push(event.overallProgress),
    });

    const result = await coordinator.start({ target: { worldMode: 'planet' } });

    expect(order).toEqual(MODE_TRANSITION_STAGES);
    expect(result.manifest.present).toBe(true);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true);
    expect(progress.at(-1)).toBe(1);
  });

  it('cancels a stale transition when a newer target starts', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const coordinator = new ModeTransitionCoordinator({
      hooks: { resources: async ({ target }) => { if (target.worldMode === 'infinite') await gate; } },
    });
    const first = coordinator.start({ target: { worldMode: 'infinite' } }).catch((error) => error.code);
    const second = coordinator.start({ target: { worldMode: 'planet' } });
    release();

    expect(await first).toBe('MODE_TRANSITION_CANCELLED');
    expect((await second).target.worldMode).toBe('planet');
  });

  it('creates deterministic deeply frozen render keys', () => {
    const a = createModeRenderKey({ water: { mode: 'legacy' }, worldMode: 'studio' });
    const b = createModeRenderKey({ worldMode: 'studio', water: { mode: 'legacy' } });
    expect(a.serialized).toBe(b.serialized);
    expect(Object.isFrozen(a.water)).toBe(true);
  });

  it('retains the active mode and only two inactive LRU entries', () => {
    const disposed = [];
    const cache = new ModeResourceCache({ maxInactive: 2 });
    const put = (key) => cache.activate(key, { key }, { dispose: (value) => disposed.push(value.key) });
    put('studio');
    put('manual');
    put('nodes');
    put('planet');

    expect(cache.size).toBe(3);
    expect(cache.has('planet')).toBe(true);
    expect(cache.has('studio')).toBe(false);
    expect(disposed).toEqual(['studio']);
  });

  it('parks, reactivates and disposes a prepared bundle exactly once', () => {
    const calls = [];
    const bundle = new PreparedModeBundle({
      key: 'infinite-key',
      worldMode: 'infinite',
      resources: { world: {} },
      activate: () => calls.push('activate'),
      park: () => calls.push('park'),
      dispose: () => calls.push('dispose'),
    });

    expect(bundle.activate()).toBe(true);
    expect(bundle.activate()).toBe(false);
    expect(bundle.park()).toBe(true);
    expect(bundle.park()).toBe(false);
    expect(bundle.activate()).toBe(true);
    expect(bundle.dispose()).toBe(true);
    expect(bundle.dispose()).toBe(false);
    expect(calls).toEqual(['activate', 'park', 'activate', 'park', 'dispose']);
  });

  it('does not double-dispose a bundle stored through cache aliases', () => {
    const dispose = vi.fn();
    const bundle = new PreparedModeBundle({
      key: 'planet-key', worldMode: 'planet', dispose,
    });
    const cache = new ModeResourceCache({ maxInactive: 3 });
    cache.set('planet-a', bundle);
    cache.set('planet-b', bundle);
    cache.clear();

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
