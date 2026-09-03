import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../src/engine/Engine.js';
import {
  finalTerrainShaderPendingError,
  requiresFinalTerrainShader,
} from '../src/engine/TerrainModeAvailability.js';

function createEngineGateHarness({ minimal = true } = {}) {
  const engine = Object.create(Engine.prototype);
  engine.terrainMaterial = { userData: { minimalFragment: minimal } };
  engine.cb = { onTerrainShaderReady: vi.fn() };
  engine._terrainShaderReadyLast = null;
  engine._disposed = false;
  engine.worldMode = 'studio';
  engine.projectMode = 'procedural';
  return engine;
}

describe('final terrain shader mode availability', () => {
  it.each([
    [{ worldMode: 'infinite' }, true],
    [{ worldMode: 'planet' }, true],
    [{ projectMode: 'nodes' }, true],
    [{ projectMode: 'manual' }, true],
    [{ worldMode: 'studio', projectMode: 'procedural' }, false],
    [{ worldMode: 'studio', projectMode: 'real' }, false],
  ])('classifies %o as requiring final terrain: %s', (request, expected) => {
    expect(requiresFinalTerrainShader(request)).toBe(expected);
  });

  it('uses explicit transition modes instead of stale serialized project modes', () => {
    expect(requiresFinalTerrainShader({
      worldMode: 'studio',
      projectMode: 'procedural',
      project: { worldMode: 'planet', editorMode: 'nodes' },
    })).toBe(false);
  });

  it('exposes a stable rejection code for guarded entry points', () => {
    expect(finalTerrainShaderPendingError()).toMatchObject({
      code: 'FINAL_TERRAIN_SHADER_PENDING',
    });
  });

  it('blocks restricted modes without invoking the transition coordinator', async () => {
    const engine = createEngineGateHarness();
    engine._modeTransitionCoordinator = { start: vi.fn() };

    await expect(engine.transitionMode({ worldMode: 'infinite' })).rejects.toMatchObject({
      code: 'FINAL_TERRAIN_SHADER_PENDING',
    });
    expect(engine._modeTransitionCoordinator.start).not.toHaveBeenCalled();
  });

  it('also guards direct Nodes and Manual project loads', async () => {
    const engine = createEngineGateHarness();

    await expect(engine.loadSeedJSON({
      editorMode: 'nodes',
      params: { seed: 7 },
    })).rejects.toMatchObject({ code: 'FINAL_TERRAIN_SHADER_PENDING' });
    await expect(engine.loadSeedJSON({
      editorMode: 'manual',
      params: { seed: 8 },
    })).rejects.toMatchObject({ code: 'FINAL_TERRAIN_SHADER_PENDING' });
  });

  it('unlocks immediately after the low-cost material marker is cleared', () => {
    const engine = createEngineGateHarness();

    expect(engine._emitTerrainShaderReadiness()).toBe(false);
    expect(engine.cb.onTerrainShaderReady).toHaveBeenLastCalledWith(false);
    engine.terrainMaterial.userData.minimalFragment = false;
    expect(engine._emitTerrainShaderReadiness()).toBe(true);
    expect(engine.cb.onTerrainShaderReady).toHaveBeenLastCalledWith(true);
    expect(() => engine._assertFinalTerrainShaderForMode({ projectMode: 'manual' })).not.toThrow();
  });
});
