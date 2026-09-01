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
});
