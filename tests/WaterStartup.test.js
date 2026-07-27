import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/engine/Engine.js';
import { createTerrainUniforms } from '../src/engine/terrain/TerrainMaterial.js';
import {
  createInfiniteWaterMaterial,
  createWaterMaterial,
} from '../src/engine/terrain/WaterMaterial.js';
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
      expect(material.fragmentShader).toContain('return bakedHeightAt(xz)');
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
      expect(material.fragmentShader).toContain('return heightAt(xz)');
    }
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
      terrainMaterial: { userData: { minimalFragment: false } },
      waterMaterial: {},
      board: { isBuilding: false },
      cb: {
        onStatus: vi.fn(),
        onBootComplete: vi.fn(),
      },
      _renderInitialStudioFrame: vi.fn(() => 2),
      _releaseBootFallback: Engine.prototype._releaseBootFallback,
      _scheduleErosionGPUWarmImport: vi.fn(),
    });

    expect(engine._completeBootIfQualityReady()).toBe(true);
    expect(engine._bootPending).toBe(false);
    expect(engine._renderInitialStudioFrame).toHaveBeenCalledTimes(1);
    expect(engine.cb.onBootComplete).toHaveBeenCalledTimes(1);
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
