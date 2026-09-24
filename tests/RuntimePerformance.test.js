import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/engine/Engine.js';
import { PerformanceProfiler } from '../src/engine/perf/PerformanceProfiler.js';
import { UnderwaterEffect } from '../src/engine/render/UnderwaterEffect.js';

afterEach(() => vi.restoreAllMocks());

describe('rendered frame diagnostics', () => {
  it('reports the same scene FPS and counts as the HUD despite skipped callbacks and post passes', () => {
    const engine = Object.create(Engine.prototype);
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const profiler = new PerformanceProfiler();
    profiler.setActive(true);
    Object.assign(engine, {
      profiler, _frames: 0, _fpsTime: null, _fps: 0,
      renderer: { info: {
        render: { calls: 1, triangles: 1, points: 0, lines: 0 }, // final fullscreen pass
        memory: { geometries: 8, textures: 12 }, programs: [{}, {}],
      } },
    });
    for (let callback = 0; callback < 90; callback++) {
      now = callback * 1000 / 60;
      profiler.beginFrame(now);
      if (callback % 2 === 0) {
        engine._recordRenderedFrame(now, { triangles: 56000, drawCalls: 104, lines: 12 });
        now += 8;
      } else now += 0.1;
      profiler.endFrame();
    }
    const snapshot = structuredClone(profiler.snapshot()); // worker transport
    expect(snapshot.fps).toBe(engine._fps);
    expect(snapshot.fps).toBe(30);
    expect(snapshot.fpsAvg).toBe(30);
    expect(snapshot.render).toMatchObject({
      triangles: engine._lastTris, calls: engine._lastDraws,
      lines: 12, geometries: 8, textures: 12, programs: 2,
    });
    expect(snapshot.render.calls).toBe(104);
    expect(profiler.frame.count).toBe(45);
    expect(snapshot.frame.avg).toBeCloseTo(8);
  });

  it('keeps long stalls in rendered FPS and normalizes the HUD sampling window', () => {
    const engine = Object.create(Engine.prototype);
    Object.assign(engine, {
      profiler: new PerformanceProfiler(), _frames: 0, _fpsTime: null, _fps: 0,
      renderer: { info: { render: {} } },
    });
    for (const now of [1000, 1016, 3032]) {
      engine._recordRenderedFrame(now, { triangles: 10, drawCalls: 2 });
    }
    expect(engine.profiler.snapshot()).toMatchObject({ fps: 1, fpsAvg: 1 });
    expect(engine.profiler.render.calls).toBe(2); // kept with overlay closed too
  });
});

describe('worker interaction cadence', () => {
  it.each(['low', 'medium'])('leaves %s-tier idle pacing while zooming and throughout a long drag', (gpuTier) => {
    const engine = Object.create(Engine.prototype);
    let now = 2000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    Object.assign(engine, {
      _lastUserActivityAt: 0, gpuTier, exploreMode: 'none',
      canvas: { dispatchTerrainEvent: vi.fn() }, controls: {},
    });
    const idleInterval = engine._continuousRenderInterval(now);
    expect(idleInterval).toBeGreaterThan(30);
    engine.applyInputFrame({ wheel: { deltaY: 10 } });
    expect(engine._continuousRenderInterval(now)).toBe(0);
    expect(engine.canvas.dispatchTerrainEvent).toHaveBeenCalledWith('wheel', { deltaY: 10 });
    for (let second = 0; second < 4; second++) {
      now += 1000;
      engine.applyInputFrame({ pointerEvents: [{ type: 'pointermove', buttons: 2 }] });
      expect(engine._continuousRenderInterval(now)).toBe(0);
    }
    now += 1000;
    engine.applyInputFrame({ pointerEvents: [{ type: 'pointermove', buttons: 0 }] });
    expect(engine._continuousRenderInterval(now)).toBe(idleInterval);
    engine.controls.isSettling = true;
    expect(engine._continuousRenderInterval(now)).toBe(0);
  });
});

function underwaterHarness() {
  const engine = Object.create(Engine.prototype);
  const underwater = new UnderwaterEffect();
  const cloud = new THREE.Mesh();
  const scene = new THREE.Scene();
  scene.add(cloud);
  Object.assign(engine, {
    underwater, scene, studioCloud: { mesh: cloud },
    worldMode: 'studio', camera: { position: { y: 100 } },
    renderer: { getDrawingBufferSize: (size) => size.set(640, 360) },
    _waterLevel: () => 20, profiler: new PerformanceProfiler(),
    _compileSceneStaggered: vi.fn(), _compileMaterialVariants: vi.fn(),
  });
  return { engine, underwater, cloud, scene };
}

describe('underwater approach warmup', () => {
  it('waits for the underwater composite under the final boot cover', async () => {
    const engine = Object.create(Engine.prototype);
    let finish;
    const target = { width: 640, height: 360 };
    Object.assign(engine, {
      params: {}, worldMode: 'studio', underwater: { enabled: true },
      waterSystem: { activateInitialMaterials: vi.fn() },
      _warmUnderwaterShaders: vi.fn(() => new Promise((resolve) => { finish = resolve; })),
    });
    const context = {
      assertCurrent: vi.fn(), progress: vi.fn(), waterRequired: true,
      bootParams: {}, compilePlan: {}, compileMaterials: [],
      compileTarget: { renderTarget: target, usesSceneTarget: true },
      compilePromise: Promise.resolve({ ready: true }),
    };
    let completed = false;
    const run = engine._compileFinalBootGraph(context).then(() => { completed = true; });
    await vi.waitFor(() => expect(engine._warmUnderwaterShaders).toHaveBeenCalledWith(target));
    expect(completed).toBe(false);
    finish(true);
    await run;
    expect(completed).toBe(true);
  });

  it('warms only the composite, yields before submission and leaves clouds attached', async () => {
    const { engine, underwater, cloud, scene } = underwaterHarness();
    let finish;
    engine._compileExactPass = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const source = { width: 640, height: 360 };
    const promise = engine._warmUnderwaterShaders(source);
    expect(engine._compileExactPass).not.toHaveBeenCalled();
    expect(engine._warmUnderwaterShaders(source)).toBe(promise);
    await vi.waitFor(() => expect(engine._compileExactPass).toHaveBeenCalledOnce());
    for (let frame = 0; frame < 5; frame++) engine._maybeWarmUnderwater(source);
    expect(engine._compileExactPass).toHaveBeenCalledOnce();
    expect(engine._compileExactPass).toHaveBeenCalledWith(expect.objectContaining({
      material: underwater._material, scene: underwater._quadScene, renderTarget: underwater._rt,
    }), expect.anything());
    expect(engine._compileSceneStaggered).not.toHaveBeenCalled();
    expect(engine._compileMaterialVariants).not.toHaveBeenCalled();
    expect(cloud.parent).toBe(scene);
    finish({ ready: true, syncCompileMs: 2 });
    expect(await promise).toBe(true);
    expect(engine._underwaterWarmed).toBe(true);
    const traverse = vi.spyOn(scene, 'traverse');
    for (let frame = 0; frame < 5; frame++) engine._maybeWarmUnderwater(source);
    expect(engine._compileExactPass).toHaveBeenCalledOnce();
    expect(traverse).not.toHaveBeenCalled();
    underwater.dispose(); cloud.geometry.dispose(); cloud.material.dispose();
  });

  it.each(['resize', 'dispose', 'program'])('does not publish readiness after %s during compilation', async (change) => {
    const { engine, underwater, cloud } = underwaterHarness();
    let finish;
    engine._compileExactPass = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const promise = engine._warmUnderwaterShaders();
    await vi.waitFor(() => expect(engine._compileExactPass).toHaveBeenCalledOnce());
    if (change === 'resize') underwater._ensureTarget(engine.renderer, 800, 600);
    if (change === 'dispose') engine._disposed = true;
    if (change === 'program') underwater._material.needsUpdate = true;
    finish({ ready: true });
    expect(await promise).toBe(false);
    expect(engine._underwaterWarmed).toBe(false);
    expect(engine._underwaterWarmPromise).toBeNull();
    underwater.dispose(); cloud.geometry.dispose(); cloud.material.dispose();
  });
});
