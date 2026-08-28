import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/engine/Engine.js';

function transitionContext() {
  return {
    assertCurrent: vi.fn(),
    progress: vi.fn(),
    targetBundle: { resources: {} },
  };
}

describe('mode launch readiness', () => {
  it('never promotes an interrupted target bundle into the mode LRU', async () => {
    const engine = Object.create(Engine.prototype);
    const stableInfinite = { metadata: { validated: true } };
    const interruptedPlanet = {
      metadata: { validated: false, rollbackBundle: stableInfinite },
    };
    const target = { metadata: { validated: false } };
    const cache = { get: vi.fn(() => null), set: vi.fn() };
    Object.assign(engine, {
      worldMode: 'planet',
      projectMode: 'procedural',
      paintMode: null,
      splineState: { enabled: false },
      _activePreparedModeBundle: interruptedPlanet,
      _modeResourceCache: cache,
      setExploreMode: vi.fn(),
      _parkActivePreparedModeBundle: vi.fn(() => interruptedPlanet),
      _capturePreparedModeBundle: vi.fn(() => target),
    });
    const context = {
      input: { project: null },
      targetWorldMode: 'planet',
      targetProjectMode: 'procedural',
      cachedBundle: null,
      renderKey: { serialized: 'planet-target' },
      progress: vi.fn(),
      assertCurrent: vi.fn(),
    };

    await engine._buildModeTransitionGeometry(context);

    expect(cache.set).not.toHaveBeenCalled();
    expect(context.rollbackBundle).toBe(stableInfinite);
    expect(engine._capturePreparedModeBundle).toHaveBeenCalledWith(
      context.renderKey,
      'planet',
      { validated: false, rollbackBundle: stableInfinite },
    );
  });

  it('does not reuse a stale Planet cache preparation after a rapid mode round-trip', async () => {
    const engine = Object.create(Engine.prototype);
    const bakerA = {};
    const bakerB = {};
    const pending = [];
    Object.assign(engine, {
      _disposed: false,
      worldMode: 'planet',
      params: { octaves: 6 },
      _stackGLSL: { sig: 'planet-cache' },
      planetHeightBaker: bakerA,
      _planetPrepareEpoch: 1,
      _planetHeightPreparePromise: null,
      _planetHeightPrepareIdentity: null,
      _prepareHeightCacheProgram: vi.fn(() => new Promise((resolve) => pending.push(resolve))),
      _publishHeightCachePreparation: vi.fn(() => true),
      _discardHeightCachePreparation: vi.fn(),
    });

    const first = engine._preparePlanetHeightCacheAsync();
    engine._planetPrepareEpoch = 2;
    engine.planetHeightBaker = bakerB;
    const second = engine._preparePlanetHeightCacheAsync();

    expect(engine._prepareHeightCacheProgram).toHaveBeenCalledTimes(2);
    pending[0]({ cache: bakerA, handle: {}, result: { ready: true } });
    pending[1]({ cache: bakerB, handle: {}, result: { ready: true } });

    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(engine._publishHeightCachePreparation).toHaveBeenCalledTimes(1);
  });

  it('accepts the height baker created during a cold Planet preparation', async () => {
    const engine = Object.create(Engine.prototype);
    const coldBaker = {};
    Object.assign(engine, {
      _disposed: false,
      worldMode: 'planet',
      params: { octaves: 6 },
      _stackGLSL: { sig: 'planet-cold-cache' },
      planetHeightBaker: null,
      _planetPrepareEpoch: 1,
      _planetHeightPreparePromise: null,
      _planetHeightPrepareIdentity: null,
      _prepareHeightCacheProgram: vi.fn(async function prepare() {
        this.planetHeightBaker = coldBaker;
        return { cache: coldBaker, handle: {}, result: { ready: true } };
      }),
      _publishHeightCachePreparation: vi.fn(() => true),
      _discardHeightCachePreparation: vi.fn(),
    });

    await expect(engine._preparePlanetHeightCacheAsync()).resolves.toBe(true);
    expect(engine._publishHeightCachePreparation).toHaveBeenCalledTimes(1);
  });

  it('finishes every Infinite clipmap level and visible chunk before returning', async () => {
    const engine = Object.create(Engine.prototype);
    const levels = [{ ready: false }, { ready: false }, { ready: false }];
    const clipmap = {
      levels,
      queue: [0, 1, 2],
      update: vi.fn(() => {
        const index = clipmap.queue.shift();
        if (index != null) levels[index].ready = true;
      }),
    };
    const world = {
      pendingChunkCount: 2,
      _lodRebuildQueue: [1],
      update: vi.fn(() => {
        world.pendingChunkCount = Math.max(0, world.pendingChunkCount - 1);
        if (!world.pendingChunkCount) world._lodRebuildQueue.length = 0;
      }),
    };
    Object.assign(engine, {
      camera: { position: new THREE.Vector3() },
      _terrainGen: 4,
      infiniteTerrainClipmap: clipmap,
      infiniteWorld: world,
    });
    const context = transitionContext();

    await engine._completeInfiniteLaunchDependencies(context);

    expect(levels.every((level) => level.ready)).toBe(true);
    expect(clipmap.queue).toHaveLength(0);
    expect(world.pendingChunkCount).toBe(0);
    expect(world._lodRebuildQueue).toHaveLength(0);
    expect(context.assertCurrent).toHaveBeenCalled();
  });

  it('publishes only the completed full Planet cubemap generation', async () => {
    const engine = Object.create(Engine.prototype);
    const texture = {};
    const baker = {
      phase: 'idle',
      complete: false,
      texture: null,
      begin: vi.fn(function begin() { this.phase = 'preview'; }),
      step: vi.fn(function step() {
        this.steps = (this.steps || 0) + 1;
        if (this.steps === 12) {
          this.complete = true;
          this.phase = 'complete';
          this.texture = texture;
        }
      }),
    };
    const planetWorld = { update: vi.fn() };
    Object.assign(engine, {
      planetHeightBaker: baker,
      planetWorld,
      camera: {},
      params: { octaves: 6 },
      _stackGLSL: { sig: 'planet-test' },
      _terrainGen: 9,
      _planetBakeRequestedGen: -1,
      _bakedTerrainGen: -1,
      _debug: {},
      uniforms: {
        uPlanetHeightTex: { value: null },
        uUsePlanetHeightTex: { value: 0 },
      },
    });
    const context = transitionContext();

    await engine._completePlanetLaunchDependencies(context);

    expect(baker.step).toHaveBeenCalledTimes(12);
    expect(engine.uniforms.uPlanetHeightTex.value).toBe(texture);
    expect(engine.uniforms.uUsePlanetHeightTex.value).toBe(1);
    expect(engine._bakedTerrainGen).toBe(9);
    expect(context.targetBundle.resources.heightTexture).toBe(texture);
    expect(planetWorld.update).toHaveBeenCalledTimes(1);
  });
});
