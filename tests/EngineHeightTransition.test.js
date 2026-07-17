import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../src/engine/Engine.js';
import { compileTerrainGraph } from '../src/engine/terrain/graph/GraphCompiler.js';
import { createNodeTemplateGraph } from '../src/project/NodeProjectTemplates.js';

function liveMaterial(octaves = 3) {
  return {
    defines: { OCTAVES: octaves },
    userData: {},
    vertexShader: 'old terrain source',
    fragmentShader: 'old water source',
    needsUpdate: false,
  };
}

function heightTransitionHarness() {
  const engine = Object.create(Engine.prototype);
  Object.assign(engine, {
    _octToken: 0,
    _compiling: 0,
    _disposed: false,
    _needsRender: false,
    _matTrash: [],
    worldMode: 'studio',
    params: { octaves: 6 },
    uniforms: {},
    terrainMaterial: liveMaterial(),
    waterMaterial: liveMaterial(),
    _infiniteTerrainMat: null,
    _infiniteWaterMat: null,
    waterSystem: { onStackRebuilt: vi.fn() },
    heightSampler: { invalidate: vi.fn() },
    propSurfaceField: { invalidate: vi.fn() },
    minimap: { requestRedraw: vi.fn() },
    cb: { onStatus: vi.fn(), onCompileProgress: vi.fn() },
    _applyUniforms: vi.fn(),
  });
  return engine;
}

describe('atomic terrain height transitions', () => {
  it('keeps rendering gated until the latest rapid project load commits terrain and water together', async () => {
    const proceduralProgram = compileTerrainGraph(createNodeTemplateGraph('nodes-dunes')).program;
    const nodesProgram = compileTerrainGraph(createNodeTemplateGraph('nodes-alpine')).program;
    const engine = heightTransitionHarness();
    const compiles = [];
    engine._compileMaterialVariants = vi.fn(() => new Promise((resolve) => compiles.push(resolve)));

    const first = engine._rebuildStackMaterialsAsync(proceduralProgram, { label: 'Loading procedural', atomic: true });
    const second = engine._rebuildStackMaterialsAsync(nodesProgram, { label: 'Loading nodes', atomic: true });

    expect(engine._compiling).toBe(2);
    compiles[1]();
    expect((await second).swapped).toBe(true);
    expect(engine._compiling).toBe(1);
    expect(engine._applyUniforms).toHaveBeenCalledTimes(1);

    // The superseded load may finish later. It must only release the remaining
    // render gate; it may never overwrite the already-committed Nodes terrain.
    compiles[0]();
    expect((await first).swapped).toBe(false);
    expect(engine._compiling).toBe(0);
    expect(engine._applyUniforms).toHaveBeenCalledTimes(1);
    expect(engine.terrainMaterial.defines.OCTAVES).toBe(6);
    expect(engine.waterMaterial.defines.OCTAVES).toBe(6);
    expect(engine.terrainMaterial.vertexShader).toContain('graph_template_alpine_ridges');
    expect(engine.waterMaterial.fragmentShader).toContain('graph_template_alpine_ridges');
    expect(engine.terrainMaterial.vertexShader).not.toContain('graph_template_dunes_dunes');
    expect(engine.waterSystem.onStackRebuilt).toHaveBeenCalledWith(nodesProgram, 6);
  });
});
