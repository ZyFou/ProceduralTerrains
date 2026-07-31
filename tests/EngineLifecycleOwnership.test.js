import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/engine/Engine.js';
import { createTerrainUniforms } from '../src/engine/terrain/TerrainMaterial.js';

function shaderWarmupHarness() {
  const engine = Object.create(Engine.prototype);
  const planetTerrain = { dispose: vi.fn() };
  const planetWater = { dispose: vi.fn() };
  Object.assign(engine, {
    _compiling: 0,
    _disposed: false,
    _matTrash: [],
    _mainRenderSerial: 0,
    _compiledKeys: new Set(),
    _planetMatMinimal: false,
    _stackGLSL: { sig: 'test-stack' },
    worldMode: 'infinite',
    params: { waterEnabled: true, cloudsEnabled: false, octaves: 6 },
    _infiniteWaterMat: { dispose: vi.fn() },
    infiniteWorld: { batches: { meshes: [{ geometry: {} }] } },
    _prepareCameraPipeline: vi.fn(() => ({ usesSceneTarget: false })),
    _compileInstancedMaterialVariant: vi.fn(async () => ({ ready: true })),
    uniforms: createTerrainUniforms(),
    cb: { onStatus: vi.fn() },
    _queueWarmMaterials: vi.fn(),
    _compileSceneStaggered: vi.fn(async () => ({ ready: true })),
    _withStudioCloudDetached: vi.fn((task) => task()),
    _loadPlanetModules: vi.fn(async () => ({
      createPlanetMaterial: () => planetTerrain,
      createPlanetWaterMaterial: () => planetWater,
    })),
    _ensurePlanetHeightTex: vi.fn(),
    _upgradePlanetMaterials: vi.fn(),
  });
  engine._compileCameraTargetMaterials = vi.fn((materials) => (
    engine._compileMaterialVariants(materials)
  ));
  return { engine, planetTerrain, planetWater };
}

describe('engine lifecycle ownership', () => {
  it('does not let a retired Infinite warmup release a newer Planet gate', async () => {
    const { engine, planetTerrain, planetWater } = shaderWarmupHarness();
    const pending = [];
    engine._compileMaterialVariants = vi.fn((materials) => new Promise((resolve) => {
      pending.push({ materials, resolve });
    }));

    const infinite = engine._warmupInfiniteShaders(6);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(engine._compiling).toBe(1);

    // A world transition has retired Infinite's gate before its asynchronous
    // compile settles. Planet is now the sole owner of the aggregate gate.
    expect(engine._retireWorldCompile()).toBe(true);
    expect(engine._compiling).toBe(0);
    engine.worldMode = 'planet';
    const planet = engine._warmupPlanetShaders(6);
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(engine._compiling).toBe(1);

    pending[0].resolve({ ready: true });
    await infinite;
    const afterRetiredInfinite = engine._compiling;

    pending[1].resolve({ ready: true });
    await planet;
    const afterPlanet = engine._compiling;

    for (const material of pending.flatMap((entry) => entry.materials)) {
      material.dispose?.();
    }
    expect(planetTerrain.dispose).toHaveBeenCalledTimes(1);
    expect(planetWater.dispose).toHaveBeenCalledTimes(1);
    expect(afterRetiredInfinite).toBe(1);
    expect(afterPlanet).toBe(0);
  });

  it('releases Studio-only water and obsolete compile gates before Infinite entry', async () => {
    vi.useFakeTimers();
    try {
      const engine = Object.create(Engine.prototype);
      const retryTimer = setTimeout(() => {}, 10000);
      Object.assign(engine, {
        _disposed: false,
        _worldModeToken: 0,
        _octToken: 3,
        _terrainSourcePendingToken: 3,
        _terrainAtomicCompileTokens: new Set([3]),
        _worldCompileGate: { token: 1, mode: 'studio' },
        _compiling: 2,
        _waterDeferred: true,
        _waterMaterialWarmed: true,
        _waterMaterialWarmIdentity: { worldMode: 'studio' },
        _waterWarmRestartPending: true,
        _waterWarmRetryCount: 2,
        _waterWarmFailed: true,
        _waterWarmRetryTimer: retryTimer,
        worldMode: 'studio',
        projectMode: 'procedural',
        params: {},
        tileDebug: { view: 'off' },
        uniforms: {
          uInfiniteMode: { value: 0 },
          uTileDebugView: { value: 0 },
        },
        cb: { onCompileProgress: vi.fn(), onToast: vi.fn() },
        setExploreMode: vi.fn(),
        _markTerrainFieldDirty: vi.fn(),
        _enterInfiniteMode: vi.fn(),
      });

      await engine.setWorldMode('infinite');

      expect(engine.worldMode).toBe('infinite');
      expect(engine._octToken).toBe(4);
      expect(engine._terrainSourcePendingToken).toBeNull();
      expect(engine._terrainAtomicCompileTokens.size).toBe(0);
      expect(engine._worldCompileGate).toBeNull();
      expect(engine._compiling).toBe(0);
      expect(engine._waterDeferred).toBe(false);
      expect(engine._waterMaterialWarmed).toBe(false);
      expect(engine._waterMaterialWarmIdentity).toBeNull();
      expect(engine._waterWarmRestartPending).toBe(false);
      expect(engine._waterWarmRetryCount).toBe(0);
      expect(engine._waterWarmFailed).toBe(false);
      expect(engine._waterWarmRetryTimer).toBeNull();
      expect(engine._enterInfiniteMode).toHaveBeenCalledTimes(1);
      expect(engine.cb.onCompileProgress).toHaveBeenCalledWith(null);
    } finally {
      vi.useRealTimers();
    }
  });

  it('disposes queued warm materials immediately after Engine disposal', () => {
    const engine = Object.create(Engine.prototype);
    const material = { dispose: vi.fn() };
    Object.assign(engine, {
      _disposed: true,
      _matTrash: [],
      _mainRenderSerial: 4,
    });

    engine._queueWarmMaterials([material]);

    expect(material.dispose).toHaveBeenCalledTimes(1);
    expect(engine._matTrash).toEqual([]);
  });

  it('warms InstancedMesh scene materials with an exact instanced probe', async () => {
    const engine = Object.create(Engine.prototype);
    const scene = new THREE.Scene();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial();
    scene.add(new THREE.InstancedMesh(geometry, material, 2));
    let compiledProbe = null;
    const target = {};
    Object.assign(engine, {
      _disposed: false,
      scene,
      camera: new THREE.PerspectiveCamera(),
      _warmGeo: new THREE.PlaneGeometry(1, 1),
      renderer: {
        getRenderTarget: vi.fn(() => null),
        setRenderTarget: vi.fn(),
        compile: vi.fn((group) => {
          [compiledProbe] = group.children;
          return [];
        }),
      },
      _waitForMaterialsReady: vi.fn(async () => ({ ready: true })),
    });

    const result = await engine._compileSceneStaggered(target);

    expect(result.ready).toBe(true);
    expect(compiledProbe?.isInstancedMesh).toBe(true);
    expect(compiledProbe?.geometry).toBe(geometry);
    expect(engine.renderer.setRenderTarget).toHaveBeenCalledWith(target);

    engine._warmGeo.dispose();
    geometry.dispose();
    material.dispose();
  });

  it('skips underwater compositing when a material version or target changes', () => {
    const engine = Object.create(Engine.prototype);
    const scene = new THREE.Scene();
    const material = new THREE.MeshBasicMaterial();
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material));
    const underwaterTarget = {};
    const sourceA = { width: 640, height: 360, texture: {} };
    const sourceB = { width: 640, height: 360, texture: {} };
    const composite = vi.fn(() => underwaterTarget);
    Object.assign(engine, {
      worldMode: 'studio',
      scene,
      renderer: {},
      camera: {},
      underwater: {
        active: true,
        _rt: underwaterTarget,
        _material: new THREE.MeshBasicMaterial(),
        _ensureTarget: vi.fn(),
        compositeFromTarget: composite,
      },
      visualPost: { setInputTexture: vi.fn() },
      _warmUnderwaterShaders: vi.fn(async () => true),
      _underwaterWarmed: true,
    });
    engine._underwaterWarmIdentity = engine._captureUnderwaterWarmIdentity(sourceA);

    expect(engine._applyUnderwaterFromSharedTarget(sourceA)).toBe(underwaterTarget);
    expect(composite).toHaveBeenCalledTimes(1);

    material.needsUpdate = true;
    expect(engine._applyUnderwaterFromSharedTarget(sourceA)).toBe(sourceA);
    expect(composite).toHaveBeenCalledTimes(1);
    expect(engine._warmUnderwaterShaders).toHaveBeenCalledWith(sourceA);

    engine._underwaterWarmed = true;
    engine._underwaterWarmIdentity = engine._captureUnderwaterWarmIdentity(sourceA);
    engine._warmUnderwaterShaders.mockClear();
    expect(engine._applyUnderwaterFromSharedTarget(sourceB)).toBe(sourceB);
    expect(composite).toHaveBeenCalledTimes(1);
    expect(engine._warmUnderwaterShaders).toHaveBeenCalledWith(sourceB);

    scene.children[0].geometry.dispose();
    material.dispose();
    engine.underwater._material.dispose();
  });
});
