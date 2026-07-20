import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../src/engine/Engine.js';
import { compileTerrainGraph } from '../src/engine/terrain/graph/GraphCompiler.js';
import { defaultLegacyStack } from '../src/engine/terrain/noise/NoiseStack.js';
import { generateStackGLSL } from '../src/engine/terrain/noise/noiseStackCodegen.js';
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
    _syncCpuHeightProgram: vi.fn(),
  });
  return engine;
}

describe('atomic terrain height transitions', () => {
  it('compiles only the visible canvas terrain variant when node-project water is disabled', async () => {
    const program = compileTerrainGraph(createNodeTemplateGraph('nodes-alpine')).program;
    const engine = heightTransitionHarness();
    engine.projectMode = 'nodes';
    engine.params.waterEnabled = false;
    engine._compileMaterialVariants = vi.fn(async () => {});

    await engine._rebuildStackMaterialsAsync(program);

    expect(engine._compileMaterialVariants).toHaveBeenCalledTimes(1);
    const [materials, options] = engine._compileMaterialVariants.mock.calls[0];
    expect(materials).toHaveLength(1);
    expect(materials[0].userData.minimalFragment).toBe(true);
    expect(options).toMatchObject({ canvasOnly: true, stagger: true });
    expect(engine._underwaterWarmed).toBe(false);
    expect(engine.terrainMaterial.userData.minimalFragment).toBe(true);
  });

  it('skips WebGL compilation when a uniform-only update keeps the live shader signature', async () => {
    const program = compileTerrainGraph(createNodeTemplateGraph('nodes-dunes')).program;
    const engine = heightTransitionHarness();
    engine._liveHeightSig = program.sig;
    engine.terrainMaterial.defines.OCTAVES = 6;
    engine._compileMaterialVariants = vi.fn(async () => {});

    const result = await engine._rebuildStackMaterialsAsync(program);

    expect(result.cached).toBe(true);
    expect(engine._compileMaterialVariants).not.toHaveBeenCalled();
    expect(engine._applyUniforms).toHaveBeenCalledTimes(1);
  });

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

  it('replaces a flat Blank Nodes shader when a procedural template becomes active', async () => {
    const blankNodesProgram = compileTerrainGraph(createNodeTemplateGraph('nodes-blank')).program;
    const proceduralProgram = generateStackGLSL(defaultLegacyStack());
    const engine = heightTransitionHarness();
    engine._compileMaterialVariants = vi.fn(async () => {});

    await engine._rebuildStackMaterialsAsync(blankNodesProgram, { atomic: true });
    expect(engine.terrainMaterial.vertexShader).toContain('float graph_terrain_output');
    expect(engine.terrainMaterial.vertexShader).toContain('return 0.0');

    engine.generationSource = 'classic';
    engine._stackGLSL = proceduralProgram;
    const result = await engine.rebuildActiveHeightProgram({ label: 'Loading procedural terrain', atomic: true });

    expect(result.swapped).toBe(true);
    expect(engine._compiling).toBe(0);
    expect(engine.terrainMaterial.vertexShader).toContain('// 0: legacy (Classic Terrain)');
    expect(engine.waterMaterial.fragmentShader).toContain('// 0: legacy (Classic Terrain)');
    expect(engine.terrainMaterial.vertexShader).not.toContain('float graph_terrain_output');
    expect(engine._syncCpuHeightProgram).toHaveBeenCalledTimes(1);
  });
});
