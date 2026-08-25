import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../src/engine/Engine.js';
import { compileTerrainGraph } from '../src/engine/terrain/graph/GraphCompiler.js';
import { TERRAIN_OUTPUT_ID, addGraphNode, connectGraphNodes, createBlankGraph } from '../src/engine/terrain/graph/GraphDocument.js';
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
    _underwaterWarmed: false,
    _liveHeightSourceSig: null,
    _matTrash: [],
    worldMode: 'studio',
    params: { octaves: 6, waterEnabled: false },
    uniforms: {},
    terrainMaterial: liveMaterial(),
    waterMaterial: {
      ...liveMaterial(),
      defines: {},
      userData: {},
    },
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
  it('always selects the sampler-limited shader for Manual Terrain projects', () => {
    const engine = heightTransitionHarness();
    engine.projectMode = 'manual';
    engine.params.surfaceTextureMode = true;
    engine.params.surfaceTextureAmount = 1;
    engine.perf = { terrainDetailQuality: 3, terrainDetailOpacity: 1 };

    expect(engine._targetTerrainVariant()).toBe('manual');
  });

  it('uses the no-atlas specialization while a Manual surface is empty', () => {
    const engine = heightTransitionHarness();
    engine.projectMode = 'manual';
    engine.manualTerrain = {
      baseSource: 'flat',
      surfaceField: { isEmpty: () => true },
    };

    expect(engine._targetTerrainVariant()).toBe('manual-empty');
    engine._manualSurfaceShaderRequested = true;
    expect(engine._targetTerrainVariant()).toBe('manual');
  });

  it('aborts a stale shader job cleanly after engine disposal', async () => {
    const engine = heightTransitionHarness();
    engine._disposed = true;
    engine.renderer = null;

    await expect(engine._compileMaterialVariants([{}])).resolves.toMatchObject({
      ready: false,
      aborted: true,
    });
  });

  it('uses the generated terrain shader for a hybrid Manual project', () => {
    const engine = heightTransitionHarness();
    engine.projectMode = 'manual';
    engine.manualTerrain = { baseSource: 'procedural' };
    engine.params.surfaceTextureMode = false;
    engine.params.surfaceTextureAmount = 0;
    engine.perf = { terrainDetailQuality: 3, terrainDetailOpacity: 1 };

    expect(engine._manualHasGeneratedBase()).toBe(true);
    expect(engine._generationSourceForProject()).toBe('classic');
    expect(engine._targetTerrainVariant()).toBe('hybrid');
  });

  it('keeps a hybrid generated base in procedural surface mode until Manual paint covers it', () => {
    const engine = heightTransitionHarness();
    engine.projectMode = 'manual';
    engine.manualTerrain = { baseSource: 'procedural' };
    engine.params = {
      surfaceTextureSource: 'procedural',
      surfaceTextureMode: false,
      surfaceTextureAmount: 0,
    };
    engine.uniforms = {
      uSurfMode: { value: 1 },
      uSurfAmount: { value: 1 },
      uSurfTint: { value: 1 },
      uManualBaseGenerated: { value: 0 },
      uSurfPaletteInfluence: { value: 0.6 },
      uSurfScale: { value: 1 },
      uSurfBreakup: { value: 0.5 },
      uSurfBlend: { value: 0.35 },
      uSurfNormalAmt: { value: 1 },
      uSurfRoughAmt: { value: 1 },
      uSurfAOAmt: { value: 1 },
      uSurfTriplanar: { value: 1 },
    };

    engine._applySurfaceSettings();

    expect(engine.uniforms.uSurfMode.value).toBe(0);
    expect(engine.uniforms.uManualBaseGenerated.value).toBe(0);
  });

  it('keeps a Nodes graph as the generation source of a hybrid Manual project', () => {
    const engine = heightTransitionHarness();
    engine.projectMode = 'manual';
    engine.manualTerrain = { baseSource: 'nodes' };
    expect(engine._generationSourceForProject()).toBe('graph');
  });

  it('compiles only the visible canvas terrain variant when node-project water is disabled', async () => {
    const program = compileTerrainGraph(createNodeTemplateGraph('nodes-alpine')).program;
    const engine = heightTransitionHarness();
    engine.projectMode = 'nodes';
    engine.params.waterEnabled = false;
    engine._compileMaterialVariants = vi.fn(async () => ({ ready: true }));

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
    engine.terrainMaterial.userData.heightProgramSig = program.sig;
    engine._compileMaterialVariants = vi.fn(async () => ({ ready: true }));

    const result = await engine._rebuildStackMaterialsAsync(program);

    expect(result.cached).toBe(true);
    expect(engine._compileMaterialVariants).not.toHaveBeenCalled();
    expect(engine._applyUniforms).toHaveBeenCalledTimes(1);
  });

  it('does not block project creation when the compatible boot material is already visible', async () => {
    const program = generateStackGLSL(defaultLegacyStack());
    const engine = heightTransitionHarness();
    engine.projectMode = 'procedural';
    engine.params = {
      octaves: 6,
      surfaceTextureMode: true,
      surfaceTextureAmount: 1,
    };
    engine.perf = { terrainDetailQuality: 3, terrainDetailOpacity: 1 };
    engine._stackGLSL = program;
    engine._liveHeightSig = program.sig;
    engine._liveHeightSourceSig = program.heightSig || program.sig;
    engine.terrainMaterial.defines.OCTAVES = 6;
    engine.terrainMaterial.userData = {
      minimalFragment: true,
      heightProgramSig: program.sig,
    };
    engine._terrainSourcePendingToken = 'project-load';
    engine._terrainAtomicCompileTokens = new Set(['project-load']);
    engine._compiling = 1;
    engine._compileMaterialVariants = vi.fn();
    engine._scheduleTerrainQualityUpgrade = vi.fn();
    engine._markTerrainFieldDirty = vi.fn();

    const result = await engine._rebuildStackMaterialsAsync(program, {
      atomic: true,
      terrainDirtyOnSwap: true,
    });

    expect(result).toMatchObject({ cached: true, qualityPending: true, error: null });
    expect(engine._compileMaterialVariants).not.toHaveBeenCalled();
    expect(engine._terrainSourcePendingToken).toBeNull();
    expect(engine._compiling).toBe(0);
    expect(engine._markTerrainFieldDirty).toHaveBeenCalledTimes(1);
    expect(engine.terrainMaterial.userData.minimalFragment).toBe(true);
  });
  it('continues to the requested terrain quality after a Base upgrade retry succeeds', async () => {
    const program = generateStackGLSL(defaultLegacyStack());
    const engine = heightTransitionHarness();
    engine.projectMode = 'procedural';
    engine.params = {
      octaves: 6,
      surfaceTextureMode: false,
      surfaceTextureAmount: 0,
    };
    engine.perf = { terrainDetailQuality: 3, terrainDetailOpacity: 1 };
    engine._stackGLSL = program;
    engine.terrainMaterial.defines.OCTAVES = 6;
    engine.terrainMaterial.userData = {
      minimalFragment: true,
      heightProgramSig: program.sig,
    };
    engine._resolveCameraCompileTarget = vi.fn(() => ({
      renderTarget: null,
      camera: null,
      targetKey: 'canvas',
    }));
    engine._sameCameraCompileTarget = vi.fn(() => true);
    engine._compileMaterialVariants = vi.fn(async () => ({ ready: true }));
    engine._scheduleTerrainQualityUpgrade = vi.fn();
    engine._completeBootIfInteractiveReady = vi.fn();
    engine._completeBootIfQualityReady = vi.fn();

    const result = await engine._upgradeMinimalTerrain(null, 'base');

    expect(result).toMatchObject({ ready: true, swapped: true });
    expect(engine.terrainMaterial.userData.terrainVariant).toBe('base');
    expect(engine._targetTerrainVariant()).toBe('detail');
    expect(engine._scheduleTerrainQualityUpgrade).toHaveBeenCalledTimes(1);
  });
  it('does not block a procedural project on a compatible Base-quality material', async () => {
    const program = generateStackGLSL(defaultLegacyStack());
    const engine = heightTransitionHarness();
    engine.projectMode = 'procedural';
    engine.params = {
      octaves: 6,
      surfaceTextureMode: true,
      surfaceTextureAmount: 1,
    };
    engine.perf = { terrainDetailQuality: 3, terrainDetailOpacity: 1 };
    engine._liveHeightSig = program.sig;
    engine._liveHeightSourceSig = program.heightSig || program.sig;
    engine.terrainMaterial.defines.OCTAVES = 6;
    engine.terrainMaterial.userData = {
      minimalFragment: false,
      terrainVariant: 'base',
      heightProgramSig: program.sig,
    };
    engine._compileMaterialVariants = vi.fn();
    engine._scheduleTerrainQualityUpgrade = vi.fn();
    engine._markTerrainFieldDirty = vi.fn();

    const result = await engine._rebuildStackMaterialsAsync(program, {
      atomic: true,
      terrainDirtyOnSwap: true,
    });

    expect(result).toMatchObject({ cached: true, qualityPending: true, error: null });
    expect(engine._compileMaterialVariants).not.toHaveBeenCalled();
    expect(engine._scheduleTerrainQualityUpgrade).toHaveBeenCalledTimes(1);
    expect(engine._markTerrainFieldDirty).toHaveBeenCalledTimes(1);
    expect(engine._compiling).toBe(0);
  });

  it('does not rebuild water for a color-only graph shader change', async () => {
    let heightGraph = createBlankGraph('terrain');
    heightGraph = addGraphNode(heightGraph, 'mountainRange', { x: 0, y: 0 });
    heightGraph = connectGraphNodes(heightGraph, { source: heightGraph.nodes.at(-1).id, target: TERRAIN_OUTPUT_ID });
    let colorGraph = addGraphNode(heightGraph, 'terrainGradient', { x: 0, y: 180 });
    colorGraph = connectGraphNodes(colorGraph, { source: colorGraph.nodes.at(-1).id, target: TERRAIN_OUTPUT_ID, targetHandle: 'color' });
    const before = compileTerrainGraph(heightGraph).program;
    const after = compileTerrainGraph(colorGraph).program;
    const engine = heightTransitionHarness();
    engine.projectMode = 'nodes';
    engine.params.waterEnabled = true;
    engine._liveHeightSig = before.sig;
    engine._liveHeightSourceSig = before.heightSig;
    engine.terrainMaterial.defines.OCTAVES = 6;
    engine.waterMaterial.defines.OCTAVES = 6;
    engine._compileMaterialVariants = vi.fn(async () => ({ ready: true }));

    await engine._rebuildStackMaterialsAsync(after);

    expect(engine._compileMaterialVariants.mock.calls[0][0]).toHaveLength(1);
    expect(engine.waterMaterial.fragmentShader).toBe('old water source');
  });


  it('retires a superseded atomic gate without releasing a newer owner', async () => {
    const liveProgram = generateStackGLSL(defaultLegacyStack());
    const pendingProgram = compileTerrainGraph(createNodeTemplateGraph('nodes-dunes')).program;
    const latestProgram = compileTerrainGraph(createNodeTemplateGraph('nodes-alpine')).program;
    const engine = heightTransitionHarness();
    engine.projectMode = 'procedural';
    engine.params = {
      ...engine.params,
      waterEnabled: false,
      surfaceTextureMode: false,
      surfaceTextureAmount: 0,
    };
    engine.perf = { terrainDetailQuality: 0, terrainDetailOpacity: 0 };
    engine._stackGLSL = liveProgram;
    engine._liveHeightSig = liveProgram.sig;
    engine._liveHeightSourceSig = liveProgram.heightSig || liveProgram.sig;
    engine.terrainMaterial.defines.OCTAVES = 6;
    engine.terrainMaterial.userData = {
      minimalFragment: false,
      terrainVariant: 'base',
      heightProgramSig: liveProgram.sig,
    };
    engine._markTerrainFieldDirty = vi.fn();
    engine._scheduleTerrainQualityUpgrade = vi.fn();
    engine._renderInitialStudioFrame = vi.fn(() => 1);

    const compiles = [];
    engine._compileMaterialVariants = vi.fn(() => new Promise((resolve) => {
      compiles.push(resolve);
    }));

    const first = engine._rebuildStackMaterialsAsync(pendingProgram, {
      label: 'Loading pending A',
      atomic: true,
      terrainDirtyOnSwap: true,
    });
    expect(compiles).toHaveLength(1);
    expect(engine._compiling).toBe(1);
    expect(engine._terrainSourcePendingToken).not.toBeNull();

    const reverted = await engine._rebuildStackMaterialsAsync(liveProgram, {
      label: 'Restoring cached B',
      atomic: true,
      terrainDirtyOnSwap: true,
    });

    expect(reverted).toMatchObject({ cached: true, error: null });
    expect(engine._terrainSourcePendingToken).toBeNull();
    expect(engine._compiling).toBe(0);
    await expect(engine.waitForTerrainReady({ timeoutMs: 20 }))
      .resolves.toBe(true);

    engine._stackGLSL = latestProgram;
    const latest = engine._rebuildStackMaterialsAsync(latestProgram, {
      label: 'Loading newer C',
      atomic: true,
      terrainDirtyOnSwap: true,
    });
    const latestToken = engine._terrainSourcePendingToken;
    expect(compiles).toHaveLength(2);
    expect(engine._compiling).toBe(1);

    compiles[0]({ ready: true });
    const firstResult = await first;
    expect(firstResult.swapped).toBe(false);
    expect(engine._compiling).toBe(1);
    expect(engine._terrainSourcePendingToken).toBe(latestToken);
    expect(engine._applyUniforms).toHaveBeenCalledTimes(1);

    compiles[1]({ ready: true });
    const latestResult = await latest;
    expect(latestResult.swapped).toBe(true);
    expect(engine._compiling).toBe(0);
    expect(engine._terrainSourcePendingToken).toBeNull();
    expect(engine._applyUniforms).toHaveBeenCalledTimes(2);
    expect(engine.waterSystem.onStackRebuilt).toHaveBeenCalledWith(latestProgram, 6);
  });

  it('lets only the latest rapid project load own the render gate', async () => {
    const proceduralProgram = compileTerrainGraph(createNodeTemplateGraph('nodes-dunes')).program;
    const nodesProgram = compileTerrainGraph(createNodeTemplateGraph('nodes-alpine')).program;
    const engine = heightTransitionHarness();
    const compiles = [];
    engine._compileMaterialVariants = vi.fn(() => new Promise((resolve) => compiles.push(resolve)));

    const first = engine._rebuildStackMaterialsAsync(proceduralProgram, { label: 'Loading procedural', atomic: true });
    const second = engine._rebuildStackMaterialsAsync(nodesProgram, { label: 'Loading nodes', atomic: true });

    expect(engine._compiling).toBe(1);
    compiles[1]({ ready: true });
    expect((await second).swapped).toBe(true);
    expect(engine._compiling).toBe(0);
    expect(engine._applyUniforms).toHaveBeenCalledTimes(1);

    // The superseded load may finish later, but no longer owns a render gate
    // and may never overwrite the already-committed Nodes terrain.
    compiles[0]({ ready: true });
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

  it('lets a newer non-atomic edit retire an obsolete atomic project gate', async () => {
    const projectProgram = compileTerrainGraph(createNodeTemplateGraph('nodes-dunes')).program;
    const editProgram = compileTerrainGraph(createNodeTemplateGraph('nodes-alpine')).program;
    const engine = heightTransitionHarness();
    const compiles = [];
    engine._compileMaterialVariants = vi.fn(() => new Promise((resolve) => {
      compiles.push(resolve);
    }));

    const projectLoad = engine._rebuildStackMaterialsAsync(projectProgram, {
      label: 'Loading project',
      atomic: true,
    });
    expect(engine._compiling).toBe(1);

    const liveEdit = engine._rebuildStackMaterialsAsync(editProgram, {
      label: 'Applying live edit',
      atomic: false,
    });
    expect(compiles).toHaveLength(2);
    expect(engine._compiling).toBe(0);

    compiles[0]({ ready: true });
    expect((await projectLoad).swapped).toBe(false);
    expect(engine._compiling).toBe(0);

    compiles[1]({ ready: true });
    expect((await liveEdit).swapped).toBe(true);
    expect(engine._compiling).toBe(0);
    expect(engine.terrainMaterial.vertexShader).toContain('graph_template_alpine_ridges');
    expect(engine.terrainMaterial.vertexShader).not.toContain('graph_template_dunes_dunes');
  });

  it('replaces a flat Blank Nodes shader when a procedural template becomes active', async () => {
    const blankNodesProgram = compileTerrainGraph(createNodeTemplateGraph('nodes-blank')).program;
    const proceduralProgram = generateStackGLSL(defaultLegacyStack());
    const engine = heightTransitionHarness();
    engine._compileMaterialVariants = vi.fn(async () => ({ ready: true }));

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
    expect(engine.waterMaterial.fragmentShader).not.toContain('float graph_blank_height_2d');
    expect(engine.terrainMaterial.vertexShader).not.toContain('float graph_terrain_output');
    // Each published source updates CPU sampling atomically with the shader:
    // Blank Nodes first, then the restored Classic program.
    expect(engine._syncCpuHeightProgram).toHaveBeenCalledTimes(2);
  });
});
