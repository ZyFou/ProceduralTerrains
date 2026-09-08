import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/engine/Engine.js';
import { GpuWorkScheduler } from '../src/engine/render/GpuWorkScheduler.js';
import { GpuResourceLedger } from '../src/engine/render/GpuResourceLedger.js';
import { VisualPostProcess } from '../src/engine/render/VisualPostProcess.js';
import { CloudLowResPass } from '../src/engine/sky/CloudLowResPass.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
function compileHarness() {
  const engine = Object.create(Engine.prototype);
  let target = { name: 'previous' };
  const renderer = {
    getRenderTarget: () => target,
    getActiveCubeFace: () => 3,
    getActiveMipmapLevel: () => 2,
    setRenderTarget: vi.fn((value) => { target = value; }),
    compile: vi.fn((group) => new Set(group.children.map((child) => child.material))),
  };
  Object.assign(engine, {
    renderer, _warmGeo: new THREE.PlaneGeometry(1, 1),
    camera: new THREE.PerspectiveCamera(), scene: new THREE.Scene(),
    _gpuWorkScheduler: new GpuWorkScheduler(),
    _validateCompiledPrograms: vi.fn(async () => ({ ok: true })),
  });
  return engine;
}

describe('audit compilation scheduling', () => {
  it('submits the second staggered program before the first finishes linking', async () => {
    const engine = compileHarness();
    const link = deferred();
    engine._waitForMaterialsReady = vi.fn(() => link.promise);
    const materials = [new THREE.ShaderMaterial(), new THREE.ShaderMaterial()];
    const original = engine.renderer.getRenderTarget();
    const target = { name: 'scene' };
    const run = engine._compileMaterialVariants(materials, { canvasOnly: true, stagger: true, renderTarget: target });
    expect(engine.renderer.getRenderTarget()).toBe(original);
    await flush();
    expect(engine.renderer.compile).toHaveBeenCalledTimes(2);
    expect(engine._waitForMaterialsReady).toHaveBeenCalledTimes(2);
    expect(engine.renderer.getRenderTarget()).toBe(original);
    expect(engine._validateCompiledPrograms).not.toHaveBeenCalled();
    link.resolve({ ready: true, pendingCount: 0, waitMs: 0 });
    expect(await run).toMatchObject({ ready: true, materialCount: 2 });
    engine._warmGeo.dispose(); materials.forEach((m) => m.dispose());
  });

  it('restores target, cube face and mip even when submission fails', async () => {
    const engine = compileHarness();
    const original = engine.renderer.getRenderTarget();
    engine.renderer.compile.mockImplementation(() => { throw new Error('driver failure'); });
    const material = new THREE.ShaderMaterial();
    await expect(engine._compileMaterialVariants([material], { canvasOnly: true })).rejects.toThrow('driver failure');
    expect(engine.renderer.setRenderTarget).toHaveBeenLastCalledWith(original, 3, 2);
    engine._warmGeo.dispose(); material.dispose();
  });

  it.each([true, false])('overlaps cloud readiness and geometry, but requires cloud success=%s before activation', async (ready) => {
    const engine = Object.create(Engine.prototype);
    const cloud = deferred();
    const water = { id: 2 };
    const terrain = { id: 1 };
    const cloudMaterial = { id: 3 };
    const context = { runId: 1, assertCurrent: vi.fn(), progress: vi.fn() };
    Object.assign(engine, {
      _bootPipeline: { runId: 1 }, _renderWorker: true,
      _applyCompatibilityBootProfile: vi.fn(), _prepareCameraPipeline: vi.fn(),
      _prepareStudioHeightCacheAsync: vi.fn(async () => true),
      params: { cloudsEnabled: true, waterEnabled: true, seaLevel: 20, waterMode: 'realistic' },
      worldMode: 'studio', visualPost: { _plan: {} },
      studioCloud: { waitUntilReady: () => cloud.promise, ready: false },
      waterSystem: { prepareInitialMaterials: () => [water], activateInitialMaterials: vi.fn() },
      _resolveCameraCompileTarget: () => ({ renderTarget: null }),
      _finalBootMaterials: () => engine.studioCloud.ready ? [terrain, water, cloudMaterial] : [terrain, water],
      _buildFinalBootCompilePlan: (materials, renderTarget) => ({ materials, renderTarget }),
      _compileMaterialVariants: vi.fn(async () => ({ ready: true })),
    });
    await engine._prepareFinalBootResources(context);
    expect(engine._compileMaterialVariants).toHaveBeenCalledOnce();
    const compile = engine._compileFinalBootGraph(context);
    expect(engine.waterSystem.activateInitialMaterials).not.toHaveBeenCalled();
    engine.studioCloud.ready = ready;
    cloud.resolve(ready);
    if (ready) {
      await compile;
      expect(engine._compileMaterialVariants).toHaveBeenLastCalledWith([cloudMaterial], expect.anything());
      expect(engine.waterSystem.activateInitialMaterials).toHaveBeenCalledOnce();
    } else {
      await expect(compile).rejects.toThrow('Final cloud material');
      expect(engine.waterSystem.activateInitialMaterials).not.toHaveBeenCalled();
    }
  });
});

describe('inactive render resource lifetime', () => {
  it('releases disabled post targets and recreates the same requested configuration', () => {
    const post = new VisualPostProcess();
    const renderer = { getDrawingBufferSize: (size) => size.set(640, 480) };
    const request = { params: { visualsPostEnabled: true, visualsCrtEnabled: true }, perf: {}, worldMode: 'studio', requireSharedOpaque: true };
    const firstPlan = post.prepare(renderer, request);
    const targets = [post._sceneRT, post._opaqueRT, post._lookRT];
    expect(targets.every(Boolean)).toBe(true);
    const dispose = targets.map((target) => vi.spyOn(target, 'dispose'));
    post.prepare(renderer, { params: { visualsPostEnabled: false }, perf: {}, worldMode: 'studio' });
    expect([post._sceneRT, post._opaqueRT, post._lookRT]).toEqual([null, null, null]);
    dispose.forEach((fn) => expect(fn).toHaveBeenCalledOnce());
    expect(post.prepare(renderer, request)).toEqual(firstPlan);
    expect(post._sceneRT).not.toBe(targets[0]);
    expect(post._sceneRT.width).toBe(640);
    post.dispose();
  });

  it('releases a disabled low-resolution cloud target without disposing its material', () => {
    const pass = new CloudLowResPass();
    pass.rt = new THREE.WebGLRenderTarget(64, 64);
    const dispose = vi.spyOn(pass.rt, 'dispose');
    const materialDispose = vi.spyOn(pass._composite, 'dispose');
    const mesh = new THREE.Mesh();
    pass.setMeshLayer(mesh, false);
    expect(dispose).toHaveBeenCalledOnce();
    expect(materialDispose).not.toHaveBeenCalled();
    expect(pass.rt).toBeNull();
    expect(mesh.layers.mask).toBe(1);
    pass.dispose();
  });

  it('accounts replacements, releases and peak estimates without admitting rejected bytes', () => {
    const ledger = new GpuResourceLedger({ budgetBytes: 100 });
    ledger.reserve('a', { bytes: 60 });
    ledger.reserve('a', { bytes: 30 });
    ledger.reserve('b', { bytes: 50 });
    expect(ledger.totalBytes).toBe(80);
    expect(() => ledger.reserve('a', { bytes: 70 })).toThrow();
    expect(ledger.totalBytes).toBe(80);
    ledger.release('b');
    expect(ledger.totalBytes).toBe(30);
    expect(ledger.snapshot().peakBytes).toBe(80);
    ledger.clear();
    expect(ledger.totalBytes).toBe(0);
  });
});

describe('on-demand resource inventory', () => {
  it('counts shared targets/textures and interleaved attributes once, including CPU copies', async () => {
    const { inspectRenderResources } = await import('../src/engine/render/ResourceInventory.js');
    const scene = new THREE.Scene();
    const target = new THREE.WebGLRenderTarget(16, 16, { depthBuffer: false });
    const texture = new THREE.DataTexture(new Uint8Array(8 * 8 * 4), 8, 8);
    texture.generateMipmaps = false;
    const data = new THREE.InterleavedBuffer(new Float32Array(6 * 6), 6);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(data, 3, 0));
    geometry.setAttribute('normal', new THREE.InterleavedBufferAttribute(data, 3, 3));
    const material = new THREE.ShaderMaterial({ uniforms: {
      atlas: { value: texture }, duplicate: { value: texture }, sceneColor: { value: target.texture },
    } });
    scene.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
    const result = inspectRenderResources({ scene, targets: { a: target, b: target }, materials: [material] });
    expect(result.estimatedBytes).toBe(16 * 16 * 4 + 8 * 8 * 4 + 6 * 6 * 4);
    expect(result.cpuBackingBufferBytes).toBe(8 * 8 * 4 + 6 * 6 * 4);
    expect(result.entries).toHaveLength(3);
    expect(result.unknownTextures).toBe(0);
    geometry.dispose(); material.dispose(); texture.dispose(); target.dispose();
  });
});
