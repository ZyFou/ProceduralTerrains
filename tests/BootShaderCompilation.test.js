import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../src/engine/Engine.js';

function engineHarness() {
  const engine = Object.create(Engine.prototype);
  engine._disposed = false;
  engine.camera = {};
  engine.scene = {};
  return engine;
}

describe('boot shader compilation', () => {
  it('forces a distinct shader source key only when a cold-run token is active', () => {
    const engine = engineHarness();
    const material = { defines: { EXISTING_DEFINE: 1 }, needsUpdate: false };
    engine._shaderColdRun = { token: 'benchmark-1', defineValue: 123456 };
    engine._shaderColdRunLogged = true;

    expect(engine._applyShaderColdRun([material, material])).toBe(true);
    expect(material.defines).toEqual({
      EXISTING_DEFINE: 1,
      TERRAIN_COLD_SHADER_RUN: 123456,
    });
    expect(material.needsUpdate).toBe(true);

    material.needsUpdate = false;
    expect(engine._applyShaderColdRun([material])).toBe(false);
    expect(material.needsUpdate).toBe(false);

    engine._shaderColdRun = null;
    expect(engine._applyShaderColdRun([material])).toBe(false);
  });

  it('collects only materials whose complete parent chain is visible', () => {
    const engine = engineHarness();
    const visibleMaterial = { id: 'visible' };
    const hiddenMaterial = { id: 'hidden-child' };
    const hiddenParent = { visible: false, parent: null };
    const objects = [
      { material: visibleMaterial, visible: true, parent: null },
      { material: hiddenMaterial, visible: true, parent: hiddenParent },
    ];
    engine.scene = { traverse: (visit) => objects.forEach(visit) };
    engine.visualPost = {
      _lookMaterial: { id: 'look' },
      _cameraMaterial: { id: 'camera' },
    };
    engine.underwater = { active: false, _material: { id: 'underwater' } };

    const materials = engine._finalBootMaterials([], {
      lookEnabled: true,
      needsFinalPass: false,
    });

    expect(materials).toContain(visibleMaterial);
    expect(materials).toContain(engine.visualPost._lookMaterial);
    expect(materials).not.toContain(hiddenMaterial);
    expect(materials).not.toContain(engine.visualPost._cameraMaterial);
    expect(materials).not.toContain(engine.underwater._material);
  });

  it.each([
    [false, true],
    [true, false],
  ])('stagger=%s is selected for renderWorker=%s', async (renderWorker, stagger) => {
    const engine = engineHarness();
    Object.assign(engine, {
      _renderWorker: renderWorker,
      _applyCompatibilityBootProfile: vi.fn(),
      _prepareCameraPipeline: vi.fn(),
      _prepareStudioHeightCacheAsync: vi.fn(async () => true),
      params: { waterEnabled: false, cloudsEnabled: false, seaLevel: 0 },
      worldMode: 'studio',
      visualPost: { _plan: {} },
      _resolveCameraCompileTarget: () => ({ renderTarget: null }),
      _finalBootMaterials: () => [{ id: 1 }],
      _compileMaterialVariants: vi.fn(async () => ({ ready: true })),
    });
    const context = {
      mode: 'full',
      runId: 1,
      assertCurrent: vi.fn(),
    };

    await engine._prepareFinalBootResources(context);

    expect(engine._compileMaterialVariants).toHaveBeenCalledWith(
      [{ id: 1 }],
      expect.objectContaining({ stagger }),
    );
  });

  it('finishes an isolated benchmark before submitting the production plan', async () => {
    const engine = engineHarness();
    const order = [];
    Object.assign(engine, {
      _renderWorker: true,
      _shaderBenchmarkOptions: { enabled: true, requestedFamily: 'terrain' },
      _applyCompatibilityBootProfile: vi.fn(),
      _prepareCameraPipeline: vi.fn(),
      _prepareStudioHeightCacheAsync: vi.fn(async () => true),
      _runInitialShaderBenchmark: vi.fn(async () => {
        order.push('benchmark');
        return { status: 'passed' };
      }),
      _compileMaterialVariants: vi.fn(async () => {
        order.push('production');
        return { ready: true };
      }),
      params: { waterEnabled: false, cloudsEnabled: false, seaLevel: 0 },
      worldMode: 'studio',
      visualPost: { _plan: {} },
      _resolveCameraCompileTarget: () => ({ renderTarget: null }),
      _finalBootMaterials: () => [{ id: 1 }],
    });
    const context = {
      mode: 'full',
      runId: 1,
      assertCurrent: vi.fn(),
    };

    await engine._prepareFinalBootResources(context);

    expect(order).toEqual(['benchmark', 'production']);
    expect(context.compilePlan.materials).toEqual([{ id: 1 }]);
  });

  it('builds deterministic family candidates and deduplicates matching topology variants', () => {
    const engine = engineHarness();
    const terrain = { id: 1, userData: { terrainVariant: 'studio' } };
    const cloud = { id: 2, userData: {} };
    const prop = { id: 3, type: 'MeshStandardMaterial', userData: {} };
    engine.terrainMaterial = terrain;
    engine.studioCloud = { material: cloud };
    const geometry = { attributes: { position: {}, normal: {}, uv: {} } };
    const objects = [
      { material: terrain, geometry, visible: true, parent: null },
      { material: terrain, geometry: { attributes: { ...geometry.attributes } }, visible: true, parent: null },
      { material: cloud, geometry, visible: true, parent: null },
      { material: prop, geometry, visible: true, parent: null },
    ];
    engine.scene = { traverse: (visit) => objects.forEach(visit) };

    const plan = engine._buildFinalBootCompilePlan([terrain, cloud, prop], null);

    expect(plan.candidates.map(({ family }) => family)).toEqual(['terrain', 'cloud', 'scene']);
    expect(plan.candidates.filter(({ material }) => material === terrain)).toHaveLength(1);
  });

  it('publishes the validated benchmark define to the live material and disposes the clone once', async () => {
    const engine = engineHarness();
    const dispose = vi.fn();
    const clone = {
      id: 22,
      name: 'terrain',
      type: 'ShaderMaterial',
      userData: {},
      defines: { EXISTING: 1 },
      vertexShader: 'void main(){}',
      fragmentShader: 'void main(){}',
      dispose,
    };
    const live = {
      id: 21,
      name: 'terrain',
      type: 'ShaderMaterial',
      userData: {},
      defines: { EXISTING: 1 },
      vertexShader: 'void main(){}',
      fragmentShader: 'void main(){}',
      clone: () => clone,
    };
    engine._compileMaterialVariants = vi.fn(async () => ({
      ready: true,
      syncCompileMs: 7,
      rendererCompileMs: 5,
      asyncWaitMs: 11,
      validationMs: 2,
      health: {
        ok: true,
        glErrors: [],
        diagnostics: [{ linked: true, activeSamplers: 3, activeUniforms: 8 }],
      },
    }));

    const result = await engine._compileShaderBenchmarkCandidate({
      material: live,
      role: 'terrain:base',
      topology: 'mesh',
      targetKey: 'canvas',
    }, { defineValue: 987 });

    expect(result).toMatchObject({
      status: 'passed',
      submitMs: 5,
      queueWaitMs: 2,
      driverWaitMs: 11,
      validationMs: 2,
      linked: true,
      canaryPassed: true,
    });
    expect(live.defines.TERRAIN_BENCHMARK_RUN).toBe(987);
    expect(engine._compileMaterialVariants).toHaveBeenCalledTimes(2);
    expect(engine._compileMaterialVariants).toHaveBeenLastCalledWith(
      [live],
      expect.anything(),
    );
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('void main');
  });

  it('restores the live defines when cache publication fails', async () => {
    const engine = engineHarness();
    const dispose = vi.fn();
    const originalDefines = { EXISTING: 1 };
    const clone = {
      id: 32, userData: {}, defines: { ...originalDefines }, dispose,
      clone: vi.fn(),
    };
    const live = {
      id: 31, userData: {}, defines: originalDefines, clone: () => clone,
    };
    engine._compileMaterialVariants = vi.fn()
      .mockResolvedValueOnce({ ready: true, health: { ok: true, diagnostics: [{}] } })
      .mockResolvedValueOnce({
        ready: false,
        health: { ok: false, code: 'PROGRAM_LINK_FAILED' },
      });

    const result = await engine._compileShaderBenchmarkCandidate({
      material: live, role: 'scene:test', topology: 'mesh', targetKey: 'canvas',
    }, { defineValue: 44 });

    expect(result).toMatchObject({ status: 'failed', code: 'PROGRAM_LINK_FAILED' });
    expect(live.defines).toBe(originalDefines);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
