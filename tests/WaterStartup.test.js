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
  it('keeps Studio water baked-only and single-pass', () => {
    const uniforms = createTerrainUniforms();
    const legacy = createWaterMaterial(uniforms, 7, stackGLSL);
    const realistic = createRealisticWaterMaterial(uniforms, 7, stackGLSL);

    for (const material of [legacy, realistic]) {
      expect(material.forceSinglePass).toBe(true);
      expect(material.userData.bakedHeightOnly).toBe(true);
      expect(material.fragmentShader).toContain('return waterBakedHeightAt(xz)');
      expect(material.fragmentShader).toContain('uWaterTerrainHeightTex');
      expect(material.fragmentShader).not.toContain('texture2D(uTerrainHeightTex');
      expect(material.fragmentShader).not.toContain('float heightAt(vec2 xz)');
      expect(material.fragmentShader).not.toContain('BiomeWeights biomeWeightsAt');
    }
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

  it('publishes the fast rebuild preview to water without downgrading terrain shading', () => {
    const engine = Object.create(Engine.prototype);
    const uniforms = createTerrainUniforms();
    const heightPreview = new THREE.Texture();
    const biomePreview = new THREE.Texture();
    const baker = {
      begin: vi.fn(() => ({
        id: 1,
        heightTexture: heightPreview,
        biomeTexture: biomePreview,
      })),
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
      params: { octaves: 5 },
      uniforms,
      profiler: { setMetric: vi.fn() },
      _studioBakeLayoutKey: vi.fn(() => 'new-layout'),
      _tileBounds: vi.fn(() => ({ cols: 2, rows: 1 })),
      _activeHeightProgram: vi.fn(() => stackGLSL),
    });

    engine._ensureTerrainHeightTex();

    expect(uniforms.uWaterTerrainHeightTex.value).toBe(heightPreview);
    expect(uniforms.uWaterTerrainBiomeTex.value).toBe(biomePreview);
    expect(uniforms.uUseWaterTerrainBiomeTex.value).toBe(1);
    expect(uniforms.uUseTerrainHeightTex.value).toBe(0);
    expect(uniforms.uUseTerrainBiomeTex.value).toBe(0);
    expect(engine._needsRender).toBe(true);
  });

  it('activates Studio water from its preview before the final terrain bake is ready', async () => {
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

    await expect(engine._warmDeferredWaterImpl()).resolves.toBe(true);

    expect(uniforms.uUseTerrainHeightTex.value).toBe(0);
    expect(engine._waterDeferred).toBe(false);
    expect(waterSystem.activateInitialMaterials).toHaveBeenCalledTimes(1);
    expect(engine._completeBootIfInteractiveReady).toHaveBeenCalledTimes(1);
  });

  it('retries water startup when its dedicated preview is unavailable', async () => {
    const engine = Object.create(Engine.prototype);
    const uniforms = createTerrainUniforms();
    Object.assign(engine, {
      _bootPending: true,
      _disposed: false,
      _waterDeferred: true,
      _terrainHeightBakeDeferred: false,
      worldMode: 'studio',
      uniforms,
      waterMaterial: {},
      cb: { onStatus: vi.fn() },
      _ensureTerrainHeightTex: vi.fn(),
      _scheduleWaterWarmRetry: vi.fn(() => true),
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(engine._warmDeferredWaterImpl()).resolves.toBe(false);

    expect(engine._scheduleWaterWarmRetry).toHaveBeenCalledWith(null);
    expect(engine._waterDeferred).toBe(true);
    warn.mockRestore();
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
    expect(materials[0].userData.bakedHeightOnly).toBe(true);
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

  it('keeps boot covered after the lightweight frame and starts quality upgrades', async () => {
    const engine = Object.create(Engine.prototype);
    const sceneTarget = {};
    const order = [];
    Object.assign(engine, {
      _compiling: 0,
      _disposed: false,
      _bootPending: true,
      _bootStart: performance.now(),
      _waterDeferred: true,
      _tierNotice: null,
      params: { waterEnabled: true },
      terrainMaterial: { userData: { minimalFragment: false } },
      visualPost: { inputTarget: sceneTarget },
      cb: {
        onStatus: vi.fn(),
        onBootComplete: vi.fn(),
      },
      _prepareCameraPipeline: vi.fn(() => ({ usesSceneTarget: true })),
      _ensureTerrainHeightTex: vi.fn(),
      _withBootDeferredObjectsDetached: vi.fn(async (task) => task()),
      _compileSceneStaggered: vi.fn(async () => ({ ready: true })),
      _renderInitialStudioFrame: vi.fn(() => {
        order.push('render');
        expect(engine._waterDeferred).toBe(true);
        return 1;
      }),
      _scheduleErosionGPUWarmImport: vi.fn(),
      _schedulePostFirstPaintWarmups: vi.fn(),
    });

    await engine._warmupInitialShaders();

    expect(engine._compileSceneStaggered).toHaveBeenCalledWith(
      sceneTarget,
      expect.objectContaining({ skipMinimalTerrain: false, skipWaterMaterial: true }),
    );
    expect(order).toEqual(['render']);
    expect(engine._bootPending).toBe(true);
    expect(engine.cb.onStatus).toHaveBeenLastCalledWith('Loading terrain detail…', true);
    expect(engine.cb.onBootComplete).not.toHaveBeenCalled();
    expect(engine._schedulePostFirstPaintWarmups).toHaveBeenCalledWith(850, sceneTarget);
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
    });

    expect(engine._completeBootIfQualityReady()).toBe(false);
    engine.terrainMaterial.userData.terrainVariant = 'detail';
    expect(engine._completeBootIfQualityReady()).toBe(false);
    engine.uniforms.uUseTerrainHeightTex.value = 1;
    engine.uniforms.uUseTerrainBiomeTex.value = 1;
    expect(engine._completeBootIfQualityReady()).toBe(false);
    engine.board._lodRebuildQueue = [];
    expect(engine._completeBootIfQualityReady()).toBe(true);
    expect(engine._bootPending).toBe(false);
    expect(engine._renderInitialStudioFrame).toHaveBeenCalledTimes(1);
    expect(engine.cb.onBootComplete).toHaveBeenCalledTimes(1);
  });

  it('releases an interactive Base frame while bake, board and LOD quality work continue', () => {
    const engine = Object.create(Engine.prototype);
    Object.assign(engine, {
      _bootPending: true,
      _qualityPending: true,
      _disposed: false,
      _contextLost: false,
      _bootFallbackFrameReady: true,
      _tierNotice: null,
      _waterDeferred: true,
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
      _renderInitialStudioFrame: vi.fn(),
      _scheduleErosionGPUWarmImport: vi.fn(),
      _startQualityWatchdog: vi.fn(),
    });

    expect(engine._completeBootIfInteractiveReady()).toBe(true);

    expect(engine._bootPending).toBe(false);
    expect(engine.cb.onBootComplete).toHaveBeenCalledTimes(1);
    expect(engine.cb.onBackgroundWork).toHaveBeenLastCalledWith('Improving terrain quality…');
  });

  it('uses the requested boot variant on high tier and Base on weaker tiers', () => {
    const engine = Object.create(Engine.prototype);
    engine.perf = { terrainDetailQuality: 3, terrainDetailOpacity: 1 };
    engine.projectMode = 'procedural';
    engine.params = {};

    engine.gpuTier = 'high';
    expect(engine._bootTerrainVariant()).toBe('detail');
    engine.gpuTier = 'medium';
    expect(engine._bootTerrainVariant()).toBe('base');
    engine.gpuTier = 'low';
    expect(engine._bootTerrainVariant()).toBe('base');
  });

  it('runs the degraded watchdog only after a fallback frame exists', () => {
    vi.useFakeTimers();
    const engine = Object.create(Engine.prototype);
    Object.assign(engine, {
      _bootPending: true,
      _disposed: false,
      _bootFallbackFrameReady: false,
      _bootWatchdogTimer: null,
      gpuTier: 'low',
      cb: { onToast: vi.fn() },
      _bootReadinessSnapshot: vi.fn(() => ({})),
      _releaseBootFallback: vi.fn(() => true),
    });

    engine._startBootWatchdog();
    vi.advanceTimersByTime(8000);
    expect(engine._releaseBootFallback).not.toHaveBeenCalled();

    engine._bootFallbackFrameReady = true;
    engine._startBootWatchdog();
    vi.advanceTimersByTime(7999);
    expect(engine._releaseBootFallback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(engine._releaseBootFallback).toHaveBeenCalledWith('degraded interactive watchdog');
    expect(engine.cb.onToast).toHaveBeenCalledTimes(1);
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
});
