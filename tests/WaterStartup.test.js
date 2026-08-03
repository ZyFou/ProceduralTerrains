import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/engine/Engine.js';
import { createTerrainUniforms } from '../src/engine/terrain/TerrainMaterial.js';
import {
  createInfiniteWaterMaterial,
  createWaterMaterial,
} from '../src/engine/terrain/WaterMaterial.js';
import { applyWaterMaterialSettings } from '../src/engine/water/WaterMaterialFactory.js';
import {
  createInfiniteRealisticWaterMaterial,
  createRealisticWaterMaterial,
} from '../src/engine/water/RealisticWaterMaterial.js';
import { WaterSystem } from '../src/engine/water/WaterSystem.js';
import { generateStackGLSL } from '../src/engine/terrain/noise/noiseStackCodegen.js';
import { defaultLegacyStack } from '../src/engine/terrain/noise/NoiseStack.js';

const stackGLSL = generateStackGLSL(defaultLegacyStack());

describe('water startup shaders', () => {
  it('keeps Studio water single-pass with an exact live-terrain fallback', () => {
    const uniforms = createTerrainUniforms();
    const legacy = createWaterMaterial(uniforms, 7, stackGLSL);
    const realistic = createRealisticWaterMaterial(uniforms, 7, stackGLSL);

    for (const material of [legacy, realistic]) {
      expect(material.forceSinglePass).toBe(true);
      expect(material.userData.bakedHeightOnly).not.toBe(true);
      expect(material.fragmentShader).toContain('if (uUseWaterTerrainBiomeTex > 0.5)');
      expect(material.fragmentShader).toContain('return waterBakedHeightAt(xz)');
      expect(material.fragmentShader).toContain('return heightAt(xz)');
      expect(material.fragmentShader).toContain('uWaterTerrainHeightTex');
      expect(material.fragmentShader).not.toContain('texture2D(uTerrainHeightTex');
      expect(material.fragmentShader).toContain('float heightAt(vec2 xz)');
      expect(material.fragmentShader).toContain('BiomeWeights biomeWeightsAt');
    }
  });

  it('keeps the Tile correctness path on one live terrain field', async () => {
    const engine = Object.create(Engine.prototype);
    const uniforms = createTerrainUniforms();
    uniforms.uUseTerrainHeightTex.value = 1;
    uniforms.uUseTerrainBiomeTex.value = 1;
    uniforms.uUseWaterTerrainBiomeTex.value = 1;
    const baker = {
      begin: vi.fn(),
      prepareProgram: vi.fn(),
    };
    Object.assign(engine, {
      _disposed: false,
      _studioLiveHeightField: true,
      _debug: { disableHeightBake: false },
      worldMode: 'studio',
      params: { octaves: 7 },
      uniforms,
      terrainHeightBaker: baker,
    });

    engine._ensureTerrainHeightTex();

    expect(uniforms.uUseTerrainHeightTex.value).toBe(0);
    expect(uniforms.uUseTerrainBiomeTex.value).toBe(0);
    expect(uniforms.uUseWaterTerrainBiomeTex.value).toBe(0);
    expect(engine._isStudioWaterBakeReady()).toBe(true);
    await expect(engine._prepareStudioHeightCacheAsync()).resolves.toBe(true);
    expect(baker.begin).not.toHaveBeenCalled();
    expect(baker.prepareProgram).not.toHaveBeenCalled();
  });

  it('retains procedural terrain height only for Infinite water', () => {
    const uniforms = createTerrainUniforms();
    const legacy = createInfiniteWaterMaterial(uniforms, 7, stackGLSL);
    const realistic = createInfiniteRealisticWaterMaterial(uniforms, 7, stackGLSL);

    for (const material of [legacy, realistic]) {
      expect(material.forceSinglePass).toBe(true);
      expect(material.userData.bakedHeightOnly).not.toBe(true);
      expect(material.fragmentShader).toContain('float heightAt(vec2 xz)');
      expect(material.fragmentShader).toContain('return terrainCachedHeightAt(xz)');
    }
  });

  it('never rewrites an owned realistic Infinite material with legacy source', () => {
    const uniforms = createTerrainUniforms();
    const realistic = createInfiniteRealisticWaterMaterial(
      uniforms,
      7,
      stackGLSL,
    );
    const engine = {
      uniforms,
      params: { octaves: 7 },
      _infiniteWaterMat: realistic,
    };
    const waterSystem = new WaterSystem(engine);
    waterSystem._realisticInfinite = realistic;
    waterSystem._usingRealistic = true;
    waterSystem._effectiveMode = 'realistic';

    waterSystem.onStackRebuilt(stackGLSL, 7);

    expect(realistic.fragmentShader).toContain('uniform float uWaterTier');
    expect(realistic.fragmentShader).toContain('uSceneColor');
    waterSystem.dispose();
  });

  it('warms a mode-matching realistic Infinite shader clone', () => {
    const uniforms = createTerrainUniforms();
    const realistic = createInfiniteRealisticWaterMaterial(
      uniforms,
      7,
      stackGLSL,
    );
    const engine = {
      uniforms,
      params: { octaves: 7 },
      proceduralSky: null,
    };
    const waterSystem = new WaterSystem(engine);
    waterSystem._realisticInfinite = realistic;
    waterSystem._usingRealistic = true;
    waterSystem._effectiveMode = 'cinematic';

    const warm = waterSystem.createInfiniteStackWarmMaterial(stackGLSL, 8);

    expect(warm).not.toBe(realistic);
    expect(warm.defines.OCTAVES).toBe(8);
    expect(warm.fragmentShader).toContain('uniform float uWaterTier');
    warm.dispose();
    waterSystem.dispose();
  });

  it('keeps an in-progress final bake private while live water stays visible', () => {
    const engine = Object.create(Engine.prototype);
    const uniforms = createTerrainUniforms();
    const baker = {
      begin: vi.fn(() => 1),
      step: vi.fn(() => ({ complete: false, progress: 0.1 })),
    };
    Object.assign(engine, {
      worldMode: 'studio',
      _terrainHeightBakeDeferred: false,
      _debug: { disableHeightBake: false },
      paintState: { enabled: false },
      _paintWasEnabled: false,
      terrainHeightBaker: baker,
      _bakedStudioGen: 1,
      _bakedStudioLayout: 'old-layout',
      _terrainGen: 2,
      _terrainBakeJobKey: null,
      _terrainBakeElapsedMs: 0,
      gpuTier: 'medium',
      params: { octaves: 5, waterEnabled: true },
      waterMaterial: {},
      water: { visible: true },
      _waterDeferred: false,
      uniforms,
      profiler: { setMetric: vi.fn() },
      _studioBakeLayoutKey: vi.fn(() => 'new-layout'),
      _tileBounds: vi.fn(() => ({ cols: 2, rows: 1 })),
      _activeHeightProgram: vi.fn(() => stackGLSL),
    });

    engine._ensureTerrainHeightTex();

    expect(uniforms.uWaterTerrainHeightTex.value).toBeNull();
    expect(uniforms.uWaterTerrainBiomeTex.value).toBeNull();
    expect(uniforms.uUseWaterTerrainBiomeTex.value).toBe(0);
    expect(engine._waterDeferred).toBe(false);
    expect(engine.water.visible).toBe(true);
    expect(uniforms.uUseTerrainHeightTex.value).toBe(0);
    expect(uniforms.uUseTerrainBiomeTex.value).toBe(0);
    expect(engine._needsRender).toBe(true);
  });

  it('invalidates terrain caches without hiding active Studio water', () => {
    const engine = Object.create(Engine.prototype);
    const uniforms = createTerrainUniforms();
    uniforms.uUseTerrainHeightTex.value = 1;
    uniforms.uUseTerrainBiomeTex.value = 1;
    uniforms.uUseWaterTerrainBiomeTex.value = 1;
    Object.assign(engine, {
      worldMode: 'studio',
      _terrainGen: 4,
      _bakedStudioGen: 4,
      _bakedTerrainGen: 4,
      _waterDeferred: false,
      water: { visible: true },
      uniforms,
      heightSampler: { invalidate: vi.fn() },
      propSurfaceField: { invalidate: vi.fn() },
    });

    engine._markTerrainFieldDirty();

    expect(engine._terrainGen).toBe(5);
    expect(engine._bakedStudioGen).toBe(-1);
    expect(uniforms.uUseTerrainHeightTex.value).toBe(0);
    expect(uniforms.uUseTerrainBiomeTex.value).toBe(0);
    expect(uniforms.uUseWaterTerrainBiomeTex.value).toBe(0);
    expect(engine._waterDeferred).toBe(false);
    expect(engine.water.visible).toBe(true);
  });

  it('keeps Studio water deferred until a generation-matched final bake is ready', async () => {
    const engine = Object.create(Engine.prototype);
    const uniforms = createTerrainUniforms();
    uniforms.uUseTerrainHeightTex.value = 0;
    uniforms.uUseTerrainBiomeTex.value = 0;
    uniforms.uWaterTerrainHeightTex.value = new THREE.Texture();
    uniforms.uWaterTerrainBiomeTex.value = new THREE.Texture();
    uniforms.uUseWaterTerrainBiomeTex.value = 1;
    const waterMaterial = {};
    const waterSystem = {
      prepareInitialMaterials: vi.fn(() => [waterMaterial]),
      activateInitialMaterials: vi.fn(),
    };
    Object.assign(engine, {
      _bootPending: true,
      _disposed: false,
      _waterDeferred: true,
      _waterMaterialWarmed: false,
      _terrainHeightBakeDeferred: false,
      _waterWarmRetryCount: 0,
      _terrainGen: 3,
      _bakedStudioGen: 2,
      _bakedStudioLayout: '2x2',
      terrainHeightBaker: { isBaking: true },
      _studioBakeLayoutKey: vi.fn(() => '2x2'),
      worldMode: 'studio',
      params: { waterEnabled: true },
      uniforms,
      waterMaterial,
      waterSystem,
      cb: { onStatus: vi.fn() },
      _ensureTerrainHeightTex: vi.fn(),
      _compileMaterialVariants: vi.fn(async () => ({ ready: true })),
      _recordWaterShaderCompile: vi.fn(),
      _completeBootIfInteractiveReady: vi.fn(),
      _completeBootIfQualityReady: vi.fn(),
    });

    await expect(engine._warmDeferredWaterImpl()).resolves.toBe(false);
    expect(engine._compileMaterialVariants).not.toHaveBeenCalled();
    expect(waterSystem.activateInitialMaterials).not.toHaveBeenCalled();
    expect(engine._waterDeferred).toBe(true);

    engine._bakedStudioGen = 3;
    engine.terrainHeightBaker.isBaking = false;

    await expect(engine._warmDeferredWaterImpl()).resolves.toBe(true);

    expect(uniforms.uUseTerrainHeightTex.value).toBe(0);
    expect(engine._waterDeferred).toBe(false);
    expect(waterSystem.activateInitialMaterials).toHaveBeenCalledTimes(1);
    expect(engine._completeBootIfInteractiveReady).toHaveBeenCalledTimes(1);
  });
  it('restarts water safely when terrain changes during shader linking', async () => {
    let resolveCompile;
    const compileResult = new Promise((resolve) => {
      resolveCompile = resolve;
    });
    const uniforms = createTerrainUniforms();
    uniforms.uWaterTerrainHeightTex.value = new THREE.Texture();
    uniforms.uWaterTerrainBiomeTex.value = new THREE.Texture();
    uniforms.uUseWaterTerrainBiomeTex.value = 1;
    const waterMaterial = {};
    const waterSystem = {
      prepareInitialMaterials: vi.fn(() => [waterMaterial]),
      activateInitialMaterials: vi.fn(),
    };
    const engine = Object.create(Engine.prototype);
    Object.assign(engine, {
      _bootPending: false,
      _disposed: false,
      _waterDeferred: true,
      _waterMaterialWarmed: false,
      _waterWarmPromise: null,
      _waterWarmRestartPending: false,
      _terrainHeightBakeDeferred: false,
      _waterWarmRetryCount: 0,
      _terrainGen: 3,
      _bakedStudioGen: 3,
      _bakedStudioLayout: '2x2',
      terrainHeightBaker: { isBaking: false },
      _studioBakeLayoutKey: vi.fn(() => '2x2'),
      worldMode: 'studio',
      params: { waterEnabled: true },
      uniforms,
      water: { visible: false },
      waterMaterial,
      waterSystem,
      cb: { onStatus: vi.fn() },
      _ensureTerrainHeightTex: vi.fn(),
      _compileMaterialVariants: vi.fn(() => compileResult),
      _recordWaterShaderCompile: vi.fn(),
      _completeBootIfInteractiveReady: vi.fn(),
      _completeBootIfQualityReady: vi.fn(),
    });

    const firstWarm = engine._warmDeferredWater();
    await vi.waitFor(() => {
      expect(engine._compileMaterialVariants).toHaveBeenCalledTimes(1);
    });

    // A replacement generation finishes while the old material promise is
    // still linking. The old promise must not publish water for generation 3.
    engine._terrainGen = 4;
    engine._bakedStudioGen = 4;
    resolveCompile({ ready: true });
    await expect(firstWarm).resolves.toBe(false);
    for (let i = 0; i < 6; i++) await Promise.resolve();

    expect(engine._compileMaterialVariants).toHaveBeenCalledTimes(1);
    expect(waterSystem.activateInitialMaterials).toHaveBeenCalledTimes(1);
    expect(engine._waterDeferred).toBe(false);
    expect(engine.water.visible).toBe(false);
  });

  it('does not publish a pending Studio water compile after switching to Infinite', async () => {
    let resolveCompile;
    const compileResult = new Promise((resolve) => {
      resolveCompile = resolve;
    });
    const uniforms = createTerrainUniforms();
    uniforms.uWaterTerrainHeightTex.value = new THREE.Texture();
    uniforms.uWaterTerrainBiomeTex.value = new THREE.Texture();
    uniforms.uUseWaterTerrainBiomeTex.value = 1;

    const studioMaterial = { version: 0 };
    const infiniteMaterial = { version: 0 };
    const activateInitialMaterials = vi.fn();
    const waterSystem = {
      prepareInitialMaterials: vi.fn((_params, worldMode) => {
        return worldMode === 'infinite' ? [infiniteMaterial] : [studioMaterial];
      }),
      activateInitialMaterials,
      getEffectiveMode: vi.fn(() => 'realistic'),
      getStudioMaterial: vi.fn(() => studioMaterial),
      getInfiniteMaterial: vi.fn(() => infiniteMaterial),
    };
    const infinitePlane = {
      material: infiniteMaterial,
      visible: true,
    };
    const engine = Object.create(Engine.prototype);
    Object.assign(engine, {
      _bootPending: false,
      _disposed: false,
      _waterDeferred: true,
      _waterMaterialWarmed: false,
      _waterWarmPromise: null,
      _waterWarmRestartPending: false,
      _terrainHeightBakeDeferred: false,
      _waterWarmRetryCount: 0,
      _terrainGen: 3,
      _bakedStudioGen: 3,
      _bakedStudioLayout: '2x2',
      terrainHeightBaker: { isBaking: false },
      _studioBakeLayoutKey: vi.fn(() => '2x2'),
      worldMode: 'studio',
      params: { waterEnabled: true, waterMode: 'realistic' },
      uniforms,
      water: { material: studioMaterial, visible: false },
      waterMaterial: studioMaterial,
      waterSystem,
      cb: { onStatus: vi.fn() },
      _ensureTerrainHeightTex: vi.fn(),
      _compileMaterialVariants: vi.fn(() => compileResult),
      _recordWaterShaderCompile: vi.fn(),
      _completeBootIfInteractiveReady: vi.fn(),
      _completeBootIfQualityReady: vi.fn(),
    });

    const studioWarm = engine._warmDeferredWater();
    await vi.waitFor(() => {
      expect(engine._compileMaterialVariants).toHaveBeenCalledTimes(1);
    });
    expect(engine._compileMaterialVariants).toHaveBeenCalledWith(
      [studioMaterial],
      expect.objectContaining({ canvasOnly: true }),
    );

    // setWorldMode releases the Studio-only water gate before Infinite sync.
    engine._waterDeferred = false;
    engine.worldMode = 'infinite';
    engine._infiniteWaterMat = infiniteMaterial;
    engine.infiniteWorld = { waterPlane: infinitePlane };
    resolveCompile({ ready: true });

    await expect(studioWarm).resolves.toBe(false);
    for (let i = 0; i < 6; i++) await Promise.resolve();

    expect(activateInitialMaterials).not.toHaveBeenCalled();
    expect(engine._waterMaterialWarmed).toBe(false);
    expect(engine._waterDeferred).toBe(false);
    expect(engine._waterWarmPromise).toBeNull();
    expect(engine._waterWarmRestartPending).toBe(false);
    expect(engine._compileMaterialVariants).toHaveBeenCalledTimes(1);
    expect(infinitePlane.material).toBe(infiniteMaterial);
    expect(infinitePlane.visible).toBe(true);
  });

  it('waits for the final bake instead of polling water startup', async () => {
    const engine = Object.create(Engine.prototype);
    const uniforms = createTerrainUniforms();
    Object.assign(engine, {
      _bootPending: true,
      _disposed: false,
      _waterDeferred: true,
      _terrainHeightBakeDeferred: false,
      _terrainGen: 1,
      _bakedStudioGen: -1,
      worldMode: 'studio',
      uniforms,
      waterMaterial: {},
      cb: { onStatus: vi.fn() },
      _ensureTerrainHeightTex: vi.fn(),
      _scheduleWaterWarmRetry: vi.fn(() => true),
    });
    await expect(engine._warmDeferredWaterImpl()).resolves.toBe(false);

    expect(engine._scheduleWaterWarmRetry).not.toHaveBeenCalled();
    expect(engine._waterDeferred).toBe(true);
  });

  it('applies the shore distance to legacy water without recompiling', () => {
    const material = createWaterMaterial(createTerrainUniforms(), 7, stackGLSL);
    const fragmentShader = material.fragmentShader;

    expect(material.uniforms.uFoamWidth.value).toBe(3.2);
    expect(fragmentShader).toContain('float shoreDistance = max(uFoamWidth, 0.5)');
    expect(fragmentShader).toContain('shoreDistance + shoreSoft * 1.8');

    applyWaterMaterialSettings(material, {
      waterFoamWidth: 1.4,
    }, 'legacy');

    expect(material.uniforms.uFoamWidth.value).toBe(1.4);
    expect(material.fragmentShader).toBe(fragmentShader);
    material.dispose();
  });

  it('prepares only the requested effective startup material', () => {
    const uniforms = createTerrainUniforms();
    const legacy = createWaterMaterial(uniforms, 7, stackGLSL);
    const engine = {
      params: {
        octaves: 7,
        seaLevel: 100,
        waterEnabled: true,
        waterMode: 'realistic',
        waterAutoDowngradeInfinite: true,
      },
      worldMode: 'studio',
      uniforms,
      _stackGLSL: stackGLSL,
      waterMaterial: legacy,
    };
    const waterSystem = new WaterSystem(engine);

    const materials = waterSystem.prepareInitialMaterials(engine.params, 'studio');

    expect(materials).toHaveLength(1);
    expect(materials[0]).not.toBe(legacy);
    expect(materials[0].userData.bakedHeightOnly).not.toBe(true);
    expect(materials[0].fragmentShader).toContain('return heightAt(xz)');
    expect(waterSystem.getEffectiveMode()).toBe('realistic');
    waterSystem.dispose();
  });

  it('reports readiness and timeout as distinct outcomes', async () => {
    const engine = Object.create(Engine.prototype);
    const readyMaterial = {};
    engine.renderer = {
      properties: {
        get: (material) => material === readyMaterial
          ? { currentProgram: { isReady: () => true } }
          : {},
      },
    };

    await expect(engine._waitForMaterialsReady(new Set([readyMaterial]), { timeoutMs: 10 }))
      .resolves.toMatchObject({ ready: true, timedOut: false, pendingCount: 0 });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(engine._waitForMaterialsReady(new Set([{}]), { timeoutMs: 0 }))
      .resolves.toMatchObject({ ready: false, timedOut: true, pendingCount: 1 });
    warn.mockRestore();
  });

  it('compiles a one-pass warmup for the requested render target', async () => {
    const engine = Object.create(Engine.prototype);
    const previousTarget = {};
    const sceneTarget = {};
    const material = new THREE.ShaderMaterial();
    let activeTarget = previousTarget;

    Object.assign(engine, {
      _warmGeo: new THREE.PlaneGeometry(1, 1),
      camera: new THREE.PerspectiveCamera(),
      scene: new THREE.Scene(),
      renderer: {
        getRenderTarget: vi.fn(() => activeTarget),
        setRenderTarget: vi.fn((target) => { activeTarget = target; }),
        compile: vi.fn(() => {
          expect(activeTarget).toBe(sceneTarget);
          return new Set([material]);
        }),
        properties: {
          get: () => ({ currentProgram: { isReady: () => true } }),
        },
        getContext: () => ({ getExtension: () => null }),
      },
    });

    await expect(engine._compileMaterialVariants([material], {
      canvasOnly: true,
      renderTarget: sceneTarget,
    })).resolves.toMatchObject({ ready: true });
    expect(engine.renderer.setRenderTarget.mock.calls).toEqual([[sceneTarget], [previousTarget]]);

    material.dispose();
    engine._warmGeo.dispose();
  });

  it('keeps the safe frame behind the overlay until the final terrain shader is ready', async () => {
    const engine = Object.create(Engine.prototype);
    const sceneTarget = {};
    const order = [];
    Object.assign(engine, {
      _compiling: 0,
      _disposed: false,
      _bootPending: true,
      _bootStart: performance.now(),
      _qualityPending: true,
      _contextLost: false,
      _bgWork: new Map(),
      _waterDeferred: true,
      _tierNotice: null,
      params: { waterEnabled: true },
      terrainMaterial: { userData: { minimalFragment: true } },
      visualPost: { inputTarget: sceneTarget },
      cb: {
        onStatus: vi.fn(),
        onBootComplete: vi.fn(),
      },
      _prepareCameraPipeline: vi.fn(() => ({ usesSceneTarget: true })),
      _ensureTerrainHeightTex: vi.fn(),
      _withBootDeferredObjectsDetached: vi.fn(async (task) => task()),
      _compileSceneStaggered: vi.fn(async () => ({ ready: true })),
      _renderBootPlaceholderFrame: vi.fn(() => {
        order.push('placeholder');
        expect(engine._waterDeferred).toBe(true);
        return 1;
      }),
      _resumeInitialShaderWarmup: vi.fn(),
      _scheduleErosionGPUWarmImport: vi.fn(),
      _schedulePostFirstPaintWarmups: vi.fn(),
      _startQualityWatchdog: vi.fn(),
      _startBootWatchdog: vi.fn(),
      _releaseBootFallback: vi.fn(() => {
        engine._bootPending = false;
        engine.cb.onBootComplete();
        return true;
      }),
    });

    await engine._warmupInitialShaders();

    expect(engine._compileSceneStaggered).not.toHaveBeenCalled();
    expect(engine._resumeInitialShaderWarmup).toHaveBeenCalledWith();
    expect(order).toEqual(['placeholder']);
    expect(engine._bootPending).toBe(true);
    expect(engine.cb.onStatus).toHaveBeenLastCalledWith('Loading terrain detail…', true);
    expect(engine.cb.onBootComplete).not.toHaveBeenCalled();
    expect(engine._schedulePostFirstPaintWarmups).not.toHaveBeenCalled();
  });

  it('releases boot only after terrain, water and board are ready', () => {
    const engine = Object.create(Engine.prototype);
    Object.assign(engine, {
      _bootPending: true,
      _disposed: false,
      _contextLost: false,
      _bootStart: performance.now(),
      _tierNotice: null,
      _waterDeferred: false,
      _terrainSourcePendingToken: null,
      _compiling: 0,
      _terrainGen: 7,
      _bakedStudioGen: 7,
      _bakedStudioLayout: '2x2',
      projectMode: 'procedural',
      params: { waterEnabled: true },
      perf: { terrainDetailQuality: 3, terrainDetailOpacity: 1 },
      uniforms: {
        uUseTerrainHeightTex: { value: 0 },
        uUseTerrainBiomeTex: { value: 0 },
      },
      terrainHeightBaker: { isBaking: false },
      terrainMaterial: {
        userData: {
          minimalFragment: false,
          terrainVariant: 'base',
        },
      },
      waterMaterial: {},
      board: { isBuilding: false, _lodRebuildQueue: [2] },
      cb: {
        onStatus: vi.fn(),
        onBootComplete: vi.fn(),
      },
      _renderInitialStudioFrame: vi.fn(() => 2),
      _releaseBootFallback: Engine.prototype._releaseBootFallback,
      _scheduleErosionGPUWarmImport: vi.fn(),
      _studioBakeLayoutKey: vi.fn(() => '2x2'),
    });

    expect(engine._completeBootIfQualityReady()).toBe(false);
    engine.terrainMaterial.userData.terrainVariant = 'detail';
    expect(engine._completeBootIfQualityReady()).toBe(false);
    engine.uniforms.uUseTerrainHeightTex.value = 1;
    engine.uniforms.uUseTerrainBiomeTex.value = 1;
    expect(engine._completeBootIfQualityReady()).toBe(false);
    engine.board._lodRebuildQueue = [];
    engine._bakedStudioGen = 6;
    expect(engine._completeBootIfQualityReady()).toBe(false);
    engine._bakedStudioGen = 7;
    engine._terrainSourcePendingToken = 'terrain-source';
    expect(engine._completeBootIfQualityReady()).toBe(false);
    engine._terrainSourcePendingToken = null;
    expect(engine._completeBootIfQualityReady()).toBe(true);
    expect(engine._bootPending).toBe(false);
    expect(engine._renderInitialStudioFrame).toHaveBeenCalledTimes(1);
    expect(engine.cb.onBootComplete).toHaveBeenCalledTimes(1);
  });

  it('releases boot from an interactive Base frame while quality continues', () => {
    const engine = Object.create(Engine.prototype);
    Object.assign(engine, {
      _bootPending: true,
      _qualityPending: true,
      _disposed: false,
      _contextLost: false,
      _bootFallbackFrameReady: true,
      _tierNotice: null,
      _waterDeferred: true,
      _landingShowcase: false,
      projectMode: 'procedural',
      params: { waterEnabled: true },
      terrainMaterial: {
        userData: {
          minimalFragment: false,
          terrainVariant: 'base',
        },
      },
      waterMaterial: {},
      water: { visible: false },
      board: {
        activeChunkCount: 1,
        targetChunkCount: 64,
        isBuilding: true,
        _lodRebuildQueue: [3, 2, 1],
      },
      cb: {
        onStatus: vi.fn(),
        onBootComplete: vi.fn(),
        onBackgroundWork: vi.fn(),
      },
      _bgWork: new Map(),
      _renderInitialStudioFrame: vi.fn(() => 1),
      _scheduleErosionGPUWarmImport: vi.fn(),
      _startQualityWatchdog: vi.fn(),
    });

    expect(engine._completeBootIfInteractiveReady()).toBe(true);

    expect(engine._bootInteractiveReady).toBe(true);
    expect(engine._bootPending).toBe(false);
    expect(engine.cb.onBootComplete).toHaveBeenCalledTimes(1);
    expect(engine.cb.onBackgroundWork).toHaveBeenCalledTimes(1);
    expect(engine._startQualityWatchdog).toHaveBeenCalledTimes(1);
  });

  it('keeps the landing loading mask until water is active in a rendered frame', () => {
    const engine = Object.create(Engine.prototype);
    Object.assign(engine, {
      _bootPending: true,
      _qualityPending: true,
      _disposed: false,
      _contextLost: false,
      _bootFallbackFrameReady: true,
      _tierNotice: null,
      _waterDeferred: true,
      _landingShowcase: true,
      worldMode: 'studio',
      projectMode: 'procedural',
      params: { waterEnabled: true, waterMode: 'legacy', seaLevel: 100 },
      terrainMaterial: { userData: { minimalFragment: false, terrainVariant: 'base' } },
      waterMaterial: {},
      water: { visible: false },
      board: { activeChunkCount: 1 },
      cb: {
        onStatus: vi.fn(),
        onBootComplete: vi.fn(),
        onBackgroundWork: vi.fn(),
      },
      _bgWork: new Map(),
      _logBootGate: vi.fn(),
      _renderInitialStudioFrame: vi.fn(() => 1),
      _scheduleErosionGPUWarmImport: vi.fn(),
      _startQualityWatchdog: vi.fn(),
    });

    expect(engine._completeBootIfInteractiveReady()).toBe(false);
    expect(engine._bootPending).toBe(true);
    expect(engine._renderInitialStudioFrame).not.toHaveBeenCalled();
    expect(engine.cb.onBootComplete).not.toHaveBeenCalled();

    engine._waterDeferred = false;
    engine.water.visible = true;
    expect(engine._completeBootIfInteractiveReady()).toBe(true);
    expect(engine._renderInitialStudioFrame).toHaveBeenCalledTimes(1);
    expect(engine.cb.onBootComplete).toHaveBeenCalledTimes(1);
  });

  it('uses Base as the interactive boot variant on every GPU tier', () => {
    const engine = Object.create(Engine.prototype);
    engine.perf = { terrainDetailQuality: 3, terrainDetailOpacity: 1 };
    engine.projectMode = 'procedural';
    engine.params = {};

    engine.gpuTier = 'high';
    expect(engine._bootTerrainVariant()).toBe('base');
    engine.gpuTier = 'medium';
    expect(engine._bootTerrainVariant()).toBe('base');
    engine.gpuTier = 'low';
    expect(engine._bootTerrainVariant()).toBe('base');
  });

  it('keeps the watchdog safety frame behind the overlay until final terrain is ready', () => {
    vi.useFakeTimers();
    const engine = Object.create(Engine.prototype);
    Object.assign(engine, {
      _bootPending: true,
      _disposed: false,
      _bootFallbackFrameReady: false,
      _bootWatchdogTimer: null,
      gpuTier: 'low',
      cb: { onToast: vi.fn(), onStatus: vi.fn() },
      _bootReadinessSnapshot: vi.fn(() => ({})),
      _releaseBootFallback: vi.fn(() => true),
      _completeBootIfInteractiveReady: vi.fn(() => false),
    });

    engine._startBootWatchdog();
    vi.advanceTimersByTime(8000);
    expect(engine._releaseBootFallback).not.toHaveBeenCalled();

    engine._bootFallbackFrameReady = true;
    engine._startBootWatchdog();
    vi.advanceTimersByTime(7999);
    expect(engine._releaseBootFallback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(engine._releaseBootFallback).not.toHaveBeenCalled();
    expect(engine._completeBootIfInteractiveReady).toHaveBeenCalledTimes(1);
    expect(engine._bootWatchdogTimer).not.toBeNull();
    expect(engine.cb.onStatus).toHaveBeenCalledWith(
      'Still preparing full-quality terrain and water…',
      true,
    );
    expect(engine.cb.onToast).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('makes boot fallback release idempotent', () => {
    const engine = Object.create(Engine.prototype);
    Object.assign(engine, {
      _bootPending: true,
      _disposed: false,
      _contextLost: false,
      _tierNotice: null,
      cb: {
        onStatus: vi.fn(),
        onBootComplete: vi.fn(),
      },
      _renderInitialStudioFrame: vi.fn(),
      _scheduleErosionGPUWarmImport: vi.fn(),
    });

    expect(engine._releaseBootFallback('test')).toBe(true);
    expect(engine._releaseBootFallback('duplicate')).toBe(false);
    expect(engine._renderInitialStudioFrame).toHaveBeenCalledTimes(1);
    expect(engine.cb.onBootComplete).toHaveBeenCalledTimes(1);
  });
  it('preserves the height-bake retry count across failed restarted jobs', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const uniforms = createTerrainUniforms();
      const baker = {
        begin: vi.fn(() => 1),
        step: vi.fn(() => {
          throw new Error('bake failed');
        }),
        cancel: vi.fn(),
      };
      const engine = Object.create(Engine.prototype);
      Object.assign(engine, {
        _disposed: false,
        worldMode: 'studio',
        gpuTier: 'medium',
        params: { octaves: 5, waterEnabled: true },
        _debug: { disableHeightBake: false },
        paintState: { enabled: false },
        _paintWasEnabled: false,
        _terrainSourcePendingToken: null,
        _terrainHeightBakeDeferred: false,
        _terrainHeightBakeFailed: false,
        _terrainHeightBakeRetryTimer: null,
        _terrainHeightBakeRetryCount: 0,
        _terrainGen: 7,
        _bakedStudioGen: -1,
        _bakedStudioLayout: null,
        _terrainBakeJobKey: null,
        _terrainBakeElapsedMs: 0,
        terrainHeightBaker: baker,
        waterMaterial: {},
        water: { visible: true },
        uniforms,
        profiler: { setMetric: vi.fn() },
        _studioBakeLayoutKey: vi.fn(() => '1x1'),
        _tileBounds: vi.fn(() => ({ cols: 1, rows: 1 })),
        _activeHeightProgram: vi.fn(() => stackGLSL),
        _completeBootIfInteractiveReady: vi.fn(),
      });

      expect(engine._ensureTerrainHeightTexSafely()).toBe(false);
      expect(baker.begin).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(4000);

      expect(baker.begin).toHaveBeenCalledTimes(4);
      expect(engine._terrainHeightBakeRetryCount).toBe(3);
      expect(engine._terrainHeightBakeFailed).toBe(true);
      expect(vi.getTimerCount()).toBe(0);

      vi.advanceTimersByTime(60000);
      expect(baker.begin).toHaveBeenCalledTimes(4);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });


  it('stops optional startup retry loops after three attempts', () => {
    vi.useFakeTimers();
    const engine = Object.create(Engine.prototype);
    Object.assign(engine, {
      _disposed: false,
      _waterDeferred: true,
      _waterWarmRetryTimer: null,
      _waterWarmRetryCount: 3,
      _terrainHeightBakeRetryTimer: null,
      _terrainHeightBakeRetryCount: 3,
      _terrainVariantRetryTimer: null,
      _terrainVariantRetryCount: 3,
    });

    expect(engine._scheduleWaterWarmRetry()).toBe(false);
    expect(engine._waterWarmFailed).toBe(true);
    expect(engine._scheduleTerrainHeightBakeRetry()).toBe(false);
    expect(engine._terrainHeightBakeFailed).toBe(true);
    expect(engine._scheduleTerrainVariantRetry()).toBe(false);
    expect(engine._terrainVariantFailed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('stops realistic-water compile retries after three failures', async () => {
    vi.useFakeTimers();
    try {
      const params = {
        octaves: 5,
        seaLevel: 40,
        waterEnabled: true,
        waterMode: 'realistic',
      };
      const material = { version: 0 };
      const engine = {
        params,
        worldMode: 'studio',
        water: null,
        waterMaterial: null,
        perf: {},
        compileWaterMaterialsAsync: vi.fn(() => Promise.resolve(false)),
      };
      const waterSystem = Object.create(WaterSystem.prototype);
      Object.assign(waterSystem, {
        engine,
        _disposed: false,
        _effectiveMode: 'realistic',
        _usingRealistic: true,
        _realisticStudio: material,
        _realisticInfinite: null,
        _realisticAttached: false,
        _waterCompileGen: 0,
        _waterCompilePending: false,
        _waterCompileRetryTimer: null,
        _waterCompileRetryCount: 0,
        _waterCompileFailed: false,
        _ensureRealisticStudio: vi.fn(),
        _applyVisibility: vi.fn(),
        _updateBoundsHelper: vi.fn(),
      });
      const flushPromises = async () => {
        await Promise.resolve();
        await Promise.resolve();
      };

      waterSystem._swapMaterials(params, 'studio');
      await flushPromises();
      expect(engine.compileWaterMaterialsAsync).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(3000);
      await flushPromises();
      expect(engine.compileWaterMaterialsAsync).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(6000);
      await flushPromises();
      expect(engine.compileWaterMaterialsAsync).toHaveBeenCalledTimes(3);
      expect(waterSystem._waterCompileRetryCount).toBe(3);
      expect(waterSystem._waterCompileFailed).toBe(true);
      expect(waterSystem.isRequestedMaterialReady()).toBe(true);
      expect(vi.getTimerCount()).toBe(0);

      await vi.advanceTimersByTimeAsync(60000);
      expect(engine.compileWaterMaterialsAsync).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });


  it('does not let unrelated background compiles block a ready project transition', async () => {
    const engine = Object.create(Engine.prototype);
    Object.assign(engine, {
      worldMode: 'studio',
      _disposed: false,
      _contextLost: false,
      projectMode: 'procedural',
      terrainMaterial: {
        userData: { minimalFragment: true },
      },
      params: { waterEnabled: false },
      board: {
        activeChunkCount: 1,
      },
      _terrainSourcePendingToken: null,
      _compiling: 5,
      _renderInitialStudioFrame: vi.fn(() => 1),
    });

    await expect(engine.waitForTerrainReady({ timeoutMs: 20 }))
      .resolves.toBe(true);
    expect(engine._renderInitialStudioFrame).toHaveBeenCalledTimes(1);
  });

  it('prepares the matched height cache and water before the optional terrain fragment', async () => {
    vi.useFakeTimers();
    try {
      const order = [];
      const engine = Object.create(Engine.prototype);
      Object.assign(engine, {
        _disposed: false,
        _landingShowcase: false,
        _postFirstPaintWarmupsStarted: false,
        _postFirstPaintWarmTimer: null,
        _postFirstPaintWaterTimer: null,
        _lastUserActivityAt: -Infinity,
        _compiling: 0,
        projectMode: 'procedural',
        params: { waterEnabled: true },
        _waterDeferred: true,
        terrainMaterial: { userData: { minimalFragment: true, terrainVariant: null } },
        _prepareStudioHeightCacheAsync: vi.fn(async () => {
          order.push('cache');
          return true;
        }),
        _warmDeferredWater: vi.fn(async () => {
          order.push('water');
          return true;
        }),
        _upgradeMinimalTerrain: vi.fn(async () => {
          order.push('terrain');
          return { swapped: true };
        }),
        _bootTerrainVariant: vi.fn(() => 'base'),
        _targetTerrainVariant: vi.fn(() => 'detail'),
        _scheduleTerrainQualityUpgrade: vi.fn(),
        _scheduleTerrainHeightBakeRetry: vi.fn(),
        _handleTerrainHeightBakeFailure: vi.fn(),
        _completeBootIfInteractiveReady: vi.fn(),
        _completeBootIfQualityReady: vi.fn(),
      });

      engine._schedulePostFirstPaintWarmups(0);
      await vi.runAllTimersAsync();
      await Promise.resolve();

      expect(order).toEqual(['cache', 'water']);
      expect(engine._scheduleTerrainQualityUpgrade).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('keeps the first full terrain translation behind the extended reload-safe idle window', async () => {
    vi.useFakeTimers();
    try {
      const engine = Object.create(Engine.prototype);
      Object.assign(engine, {
        _disposed: false,
        _terrainQualityTimer: null,
        _terrainVariantCompiling: false,
        _lastUserActivityAt: performance.now(),
        terrainMaterial: { userData: { minimalFragment: true } },
        _upgradeMinimalTerrain: vi.fn(async () => ({ swapped: true })),
        _bootTerrainVariant: vi.fn(() => 'base'),
        _ensureTerrainShaderVariantAsync: vi.fn(),
      });

      engine._scheduleTerrainQualityUpgrade(null, 0);
      await vi.advanceTimersByTimeAsync(14999);
      expect(engine._upgradeMinimalTerrain).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(engine._upgradeMinimalTerrain).toHaveBeenCalledTimes(1);
      expect(engine._upgradeMinimalTerrain).toHaveBeenCalledWith(null, 'base');
      expect(engine._ensureTerrainShaderVariantAsync).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('warms visible landing water while deferring editor-only quality work', async () => {
    vi.useFakeTimers();
    try {
      const engine = Object.create(Engine.prototype);
      Object.assign(engine, {
        _disposed: false,
        _landingShowcase: true,
        _postFirstPaintWarmupsStarted: false,
        _postFirstPaintWarmTimer: null,
        _waterDeferred: true,
        waterMaterial: {},
        params: { waterEnabled: true },
        projectMode: 'nodes',
        _warmDeferredWater: vi.fn(async () => true),
        _prepareStudioHeightCacheAsync: vi.fn(),
        _scheduleTerrainQualityUpgrade: vi.fn(),
        _completeBootIfInteractiveReady: vi.fn(),
        _completeBootIfQualityReady: vi.fn(),
      });

      engine._schedulePostFirstPaintWarmups(0);
      await vi.runAllTimersAsync();
      await Promise.resolve();
      expect(engine._warmDeferredWater).toHaveBeenCalledTimes(1);
      expect(engine._prepareStudioHeightCacheAsync).not.toHaveBeenCalled();
      expect(engine._scheduleTerrainQualityUpgrade).not.toHaveBeenCalled();
      expect(engine._postFirstPaintWarmupsStarted).toBe(false);
      expect(engine._completeBootIfQualityReady).not.toHaveBeenCalled();

      engine._landingShowcase = false;
      engine._schedulePostFirstPaintWarmups(0);
      await vi.runAllTimersAsync();
      expect(engine._completeBootIfInteractiveReady).toHaveBeenCalledTimes(1);
      expect(engine._completeBootIfQualityReady).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
