import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/engine/Engine.js';
import {
  createTerrainMaterial,
  createTerrainUniforms,
} from '../src/engine/terrain/TerrainMaterial.js';
import {
  defaultLegacyStack,
  makeLayer,
} from '../src/engine/terrain/noise/NoiseStack.js';
import { generateStackGLSL } from '../src/engine/terrain/noise/noiseStackCodegen.js';
import {
  buildCircularPlinthGeometry,
  buildDiskWallGeometry,
  resolveDiskBoundarySegments,
} from '../src/engine/terrain/BoardPlinth.js';

function createParamEngine() {
  const engine = Object.create(Engine.prototype);
  Object.assign(engine, {
    params: {
      autoUpdate: true,
      seed: 10,
      seaLevel: 40,
      waterOpacity: 0.8,
    },
    noiseStack: {
      layers: [{ type: 'legacy', enabled: true }],
    },
    _terrainGen: 7,
    _bakedStudioGen: 7,
    _bakedTerrainGen: 7,
    cb: {
      onParams: vi.fn(),
      onStatus: vi.fn(),
    },
    minimap: {
      requestRedraw: vi.fn(),
    },
    _applyUniforms: vi.fn(),
  });
  return engine;
}

describe('terrain state stability', () => {
  it('invalidates terrain for sea-level interpretation changes but not water styling', () => {
    const engine = createParamEngine();

    engine.setParam('waterOpacity', 0.65);
    expect(engine._terrainGen).toBe(7);
    expect(engine._bakedStudioGen).toBe(7);
    engine.setParam('seaLevel', 55);
    expect(engine._terrainGen).toBe(8);
    expect(engine._bakedStudioGen).toBe(-1);

    engine.setParam('seed', 11);
    expect(engine._terrainGen).toBe(9);
    expect(engine._bakedStudioGen).toBe(-1);

    engine.setParam('seed', 11);
    expect(engine._terrainGen).toBe(9);
    expect(engine.cb.onParams).toHaveBeenCalledTimes(3);
  });

  it('applies sea level immediately even when terrain Auto Update is off', () => {
    const engine = createParamEngine();
    engine.params.autoUpdate = false;

    engine.setParam('seaLevel', 72);

    expect(engine.params.seaLevel).toBe(72);
    expect(engine._applyUniforms).toHaveBeenCalledTimes(1);
    expect(engine.cb.onStatus).not.toHaveBeenCalledWith(
      expect.stringContaining('Pending'),
      true,
    );
    expect(engine._terrainGen).toBe(8);
    expect(engine._bakedStudioGen).toBe(-1);
  });

  it('keeps deferred terrain params staged while live water settings update', () => {
    const engine = createParamEngine();
    engine.params.autoUpdate = false;

    engine.setParam('seed', 22);
    engine.setParam('waterOpacity', 0.45);

    expect(engine.params.seed).toBe(10);
    expect(engine._pendingTerrainParams.seed).toBe(22);
    expect(engine.params.waterOpacity).toBe(0.45);
    expect(engine._terrainGen).toBe(7);
    expect(engine._applyUniforms).toHaveBeenCalledTimes(1);
  });

  it('applies staged classic controls to a modern noise stack on commit', () => {
    const engine = createParamEngine();
    const modernStack = defaultLegacyStack();
    modernStack.layers = [makeLayer('fbm')];
    engine.params = {
      ...engine.params,
      autoUpdate: false,
      persistence: 0.5,
      noiseStack: modernStack,
    };
    engine.noiseStack = modernStack;
    engine.setNoiseStack = vi.fn();
    engine.applyAll = vi.fn();

    engine.setParam('persistence', 0.82);
    engine.setParam('autoUpdate', true);

    expect(engine.params.persistence).toBe(0.82);
    expect(engine.setNoiseStack).toHaveBeenCalledTimes(1);
    expect(engine.setNoiseStack.mock.calls[0][0].layers[0].params.persistence)
      .toBe(0.82);
    expect(engine.applyAll).not.toHaveBeenCalled();
  });

  it('serializes the effective staged controls and rendering state', () => {
    const engine = Object.create(Engine.prototype);
    const modernStack = defaultLegacyStack();
    modernStack.layers = [makeLayer('fbm')];
    Object.assign(engine, {
      params: {
        autoUpdate: false,
        seed: 10,
        persistence: 0.5,
        noiseStack: modernStack,
      },
      _pendingTerrainParams: { seed: 22, persistence: 0.78 },
      _pendingNoiseStack: null,
      tiles: [{ cx: 0, cz: 0 }],
      tileAssemblyShape: 'square',
      circleRadiusCells: 0,
      projectMode: 'procedural',
      generationSource: 'classic',
      worldMode: 'studio',
      terrainGraph: null,
      graphView: { x: 0, y: 0, zoom: 1 },
      timeOfDay: 0.71,
      paintMode: {
        state: { baseMode: 'flat', layerOpacity: 0.4 },
        serialize: () => null,
      },
      erosionField: { serialize: () => null },
      projectHistory: { serializeMetadata: () => null },
      _serializeCreatorTools: () => ({ splines: [], analysis: {} }),
      _syncPlanetStyleToParams: vi.fn(),
    });

    const payload = engine.createProjectPayload();

    expect(payload.params.seed).toBe(22);
    expect(payload.params.noiseStack.layers[0].params.persistence).toBe(0.78);
    expect(payload.paintState).toEqual({ baseMode: 'flat', layerOpacity: 0.4 });
    expect(payload.timeOfDay).toBe(0.71);
    expect(payload.worldMode).toBe('studio');
  });

  it('does not publish a terrain variant compiled for a stale height program', async () => {
    const uniforms = createTerrainUniforms();
    const stackA = defaultLegacyStack();
    const stackB = defaultLegacyStack();
    stackB.layers.push(makeLayer('ridged'));
    const programA = generateStackGLSL(stackA);
    const programB = generateStackGLSL(stackB);
    const live = createTerrainMaterial(uniforms, 5, programA, { variant: 'base' });
    let currentProgram = programA;
    let finishCompile;
    const compileResult = new Promise((resolve) => { finishCompile = resolve; });
    const engine = Object.create(Engine.prototype);
    Object.assign(engine, {
      _disposed: false,
      worldMode: 'studio',
      projectMode: 'procedural',
      params: {
        octaves: 5,
        surfaceTextureMode: false,
        surfaceTextureAmount: 0,
      },
      perf: {
        terrainDetailQuality: 3,
        terrainDetailOpacity: 1,
      },
      uniforms,
      terrainMaterial: live,
      _terrainVariantToken: 0,
      _terrainVariantRetryCount: 0,
      _terrainVariantRetryTimer: null,
      _matTrash: [],
      _bgWork: new Map(),
      cb: {},
      _activeHeightProgram: vi.fn(() => currentProgram),
      _compileMaterialVariants: vi.fn(() => compileResult),
      _scheduleTerrainVariantRetry: vi.fn(),
    });

    const pending = engine._ensureTerrainShaderVariantAsync();
    await vi.waitFor(() => {
      expect(engine._compileMaterialVariants).toHaveBeenCalledTimes(1);
    });
    currentProgram = programB;
    finishCompile({ ready: true });

    await expect(pending).resolves.toBe(false);
    expect(live.userData.terrainVariant).toBe('base');
    expect(engine._scheduleTerrainVariantRetry).toHaveBeenCalledWith(null, 0);

    for (const entry of engine._matTrash) {
      for (const material of entry.mats) material.dispose();
    }
    live.dispose();
  });

  it('changes the opaque-scene revision as progressive terrain becomes renderable', () => {
    const engine = Object.create(Engine.prototype);
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 1000);
    camera.position.set(10, 20, 30);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const heightTexture = new THREE.Texture();
    Object.assign(engine, {
      worldMode: 'studio',
      camera,
      params: { seed: 1, cloudsEnabled: false },
      _terrainGen: 4,
      _bakedStudioGen: -1,
      _bakedStudioLayout: '',
      terrainMaterial: { version: 2 },
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0.2, 0.9, 0.1) },
        uTime: { value: 0 },
        uUseTerrainHeightTex: { value: 0 },
        uUseTerrainBiomeTex: { value: 0 },
        uTerrainHeightTex: { value: heightTexture },
      },
      board: {
        activeChunkCount: 1,
        targetChunkCount: 16,
        isBuilding: true,
        _lodRebuildQueue: [3, 2, 1, 0],
        lodCounts: [0, 0, 0, 1],
        mergedGroupCount: 0,
        visibleChunkCount: 1,
      },
    });

    const first = engine._sceneRevisionKey({ x: 1200, y: 800 });
    engine.board.activeChunkCount = 2;
    const afterChunk = engine._sceneRevisionKey({ x: 1200, y: 800 });
    expect(afterChunk).not.toBe(first);

    engine._bakedStudioGen = 4;
    engine.uniforms.uUseTerrainHeightTex.value = 1;
    engine.uniforms.uUseTerrainBiomeTex.value = 1;
    const afterBake = engine._sceneRevisionKey({ x: 1200, y: 800 });
    expect(afterBake).not.toBe(afterChunk);
    expect(engine._sceneRevisionKey({ x: 1200, y: 800 })).toBe(afterBake);

    heightTexture.dispose();
  });

  it('refreshes shared opaque refraction while terrain caustics animate', () => {
    const engine = Object.create(Engine.prototype);
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 1000);
    camera.updateMatrixWorld(true);
    Object.assign(engine, {
      worldMode: 'studio',
      camera,
      params: { waterAnim: true },
      _terrainGen: 1,
      importedMaps: {},
      uniforms: {
        uTime: { value: 1 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uCausticBlend: { value: 1 },
        uCausticStrength: { value: 0.5 },
        uCausticWaterAnim: { value: 1 },
      },
      waterSystem: { needsSceneRefraction: () => true },
    });

    const first = engine._sceneRevisionKey({ x: 800, y: 600 }, false);
    engine.uniforms.uTime.value = 1.26;
    const animated = engine._sceneRevisionKey({ x: 800, y: 600 }, false);
    expect(animated).not.toBe(first);

    engine.waterSystem.needsSceneRefraction = () => false;
    const cached = engine._sceneRevisionKey({ x: 800, y: 600 }, false);
    engine.uniforms.uTime.value = 2;
    expect(engine._sceneRevisionKey({ x: 800, y: 600 }, false)).toBe(cached);
  });

  it('keeps warm materials alive until a live scene render acquires the program', () => {
    vi.useFakeTimers();
    const engine = Object.create(Engine.prototype);
    Object.assign(engine, {
      _mainRenderSerial: 0,
      _matTrash: [],
    });
    const material = { dispose: vi.fn() };
    engine._queueWarmMaterials([material]);
    vi.advanceTimersByTime(5000);
    engine._releaseWarmMaterialsAfterRender();
    expect(material.dispose).not.toHaveBeenCalled();
    engine._noteMainRender();
    engine._releaseWarmMaterialsAfterRender();
    expect(material.dispose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('uses the rendered Infinite water plane as the caustics source of truth', () => {
    const engine = Object.create(Engine.prototype);
    Object.assign(engine, {
      worldMode: 'infinite',
      _waterDeferred: false,
      waterSystem: { isEnabled: () => true },
      infiniteWorld: { waterPlane: { visible: true } },
    });

    expect(engine._isRenderedWaterActive()).toBe(true);
  });


  it('disables terrain caustics whenever the water mesh is hidden', () => {
    const engine = Object.create(Engine.prototype);
    const controller = {
      update: vi.fn(),
      causticsEnabled: true,
    };
    const uniforms = {
      uCausticStrength: { value: 1 },
      uCausticBlend: { value: 1 },
      uCausticScale: { value: 1 },
      uCausticSpeed: { value: 1 },
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    };
    Object.assign(engine, {
      _waterDeferred: false,
      worldMode: 'studio',
      water: { visible: false },
      params: { seaLevel: 40, waterUnderwaterMode: 'high' },
      perf: { underwaterEffect: true },
      waterSystem: {
        isEnabled: () => true,
        getEffectiveMode: () => 'legacy',
      },
      underwater: { _depthSupported: true, update: vi.fn() },
      underwaterController: controller,
      uniforms,
      camera: { position: new THREE.Vector3() },
      _underwaterSunScreen: vi.fn(() => ({ visible: true })),
      _syncCausticWaveUniforms: vi.fn(),
    });

    engine._updateUnderwater(0.016);

    expect(controller.update).toHaveBeenCalledWith(
      0.016,
      expect.objectContaining({ waterActive: false }),
    );
    expect(uniforms.uCausticStrength.value).toBe(0);
    expect(uniforms.uCausticBlend.value).toBe(0);
  });
});

describe('circular terrain boundary stability', () => {
  it('resolves disk boundary segments to a bounded multiple of four', () => {
    const cases = [
      [1, 1000],
      [512, 32],
      [8192, 0.1],
      [2048, 17],
    ];

    for (const [radius, targetEdge] of cases) {
      const segments = resolveDiskBoundarySegments(radius, targetEdge);
      expect(segments).toBeGreaterThanOrEqual(96);
      expect(segments).toBeLessThanOrEqual(8192);
      expect(segments % 4).toBe(0);
    }
    expect(resolveDiskBoundarySegments(8192, 0.1)).toBe(8192);
  });

  it('uses the same requested segment outline for the disk cap and wall', () => {
    const radius = 123;
    const segments = 100;
    const cap = buildCircularPlinthGeometry(radius, 40, segments);
    const wall = buildDiskWallGeometry(radius, segments);

    expect(cap.index.count / 3).toBe(segments);
    expect(wall.index.count / 6).toBe(segments);
    expect(cap.getAttribute('position').count - 2).toBe(segments);
    expect(wall.getAttribute('position').count / 2 - 1).toBe(segments);

    const capPositions = cap.getAttribute('position');
    const wallPositions = wall.getAttribute('position');
    for (let i = 0; i <= segments; i++) {
      const capIndex = segments - i + 1;
      const wallIndex = i * 2;
      expect(wallPositions.getX(wallIndex)).toBeCloseTo(capPositions.getX(capIndex), 5);
      expect(wallPositions.getZ(wallIndex)).toBeCloseTo(capPositions.getZ(capIndex), 5);
    }

    cap.dispose();
    wall.dispose();
  });
});
