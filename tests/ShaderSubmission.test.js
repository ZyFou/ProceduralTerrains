import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/engine/Engine.js';

function harness() {
  const engine = Object.create(Engine.prototype);
  let target = { name: 'live' };
  const jobs = [];
  Object.assign(engine, {
    camera: new THREE.Camera(), scene: new THREE.Scene(),
    _warmGeo: new THREE.BufferGeometry(),
    renderer: {
      getRenderTarget: () => target,
      setRenderTarget: (value) => { target = value; },
      compile: vi.fn(() => new Set()),
    },
    _gpuWorkScheduler: {
      schedule: (_key, run) => new Promise((resolve, reject) => {
        jobs.push(() => { try { resolve(run()); } catch (error) { reject(error); } });
      }),
    },
    _waitForMaterialsReady: vi.fn(async () => ({ ready: true, pendingCount: 0 })),
    _validateCompiledPrograms: vi.fn(async () => ({ ok: true })),
  });
  return { engine, jobs };
}

describe('scheduled shader submission', () => {
  it('preserves live render targets across queue waits and both compile passes', async () => {
    const { engine, jobs } = harness();
    const sceneTarget = { name: 'scene' };
    const underwaterTarget = { name: 'underwater' };
    engine.underwater = { _ensureTarget: vi.fn(), _rt: underwaterTarget };
    const initial = engine.renderer.getRenderTarget();
    const seen = [];
    engine.renderer.compile.mockImplementation(() => {
      seen.push(engine.renderer.getRenderTarget());
      return new Set();
    });
    const task = engine._compileMaterialVariants([new THREE.ShaderMaterial()], {
      renderTarget: sceneTarget, logCompile: false,
    });
    expect(engine.renderer.getRenderTarget()).toBe(initial);
    const nextFrameTarget = { name: 'next-frame' };
    engine.renderer.setRenderTarget(nextFrameTarget);
    jobs.shift()();
    await vi.waitFor(() => expect(jobs).toHaveLength(1));
    expect(engine.renderer.getRenderTarget()).toBe(nextFrameTarget);
    jobs.shift()();
    expect((await task).ready).toBe(true);
    expect(seen).toEqual([sceneTarget, underwaterTarget]);
    expect(engine.renderer.getRenderTarget()).toBe(nextFrameTarget);
  });

  it('does not submit obsolete queued shaders', async () => {
    const { engine, jobs } = harness();
    let current = true;
    const task = engine._compileMaterialVariants([new THREE.ShaderMaterial()], {
      canvasOnly: true, isCurrent: () => current,
    });
    current = false;
    jobs.shift()();
    expect(await task).toMatchObject({ ready: false, aborted: true });
    expect(engine.renderer.compile).not.toHaveBeenCalled();
    expect(engine._validateCompiledPrograms).not.toHaveBeenCalled();
  });

  it('restores the current target when compilation throws', async () => {
    const { engine, jobs } = harness();
    const initial = engine.renderer.getRenderTarget();
    engine.renderer.compile.mockImplementation(() => { throw new Error('compile failed'); });
    const task = engine._compileMaterialVariants([new THREE.ShaderMaterial()], {
      canvasOnly: true, renderTarget: {},
    });
    jobs.shift()();
    await expect(task).rejects.toThrow('compile failed');
    expect(engine.renderer.getRenderTarget()).toBe(initial);
  });

  it('skips validation and secondary compilation when an in-flight edit is superseded', async () => {
    const { engine, jobs } = harness();
    let current = true;
    engine._waitForMaterialsReady.mockImplementation(async () => {
      current = false;
      return { ready: true, pendingCount: 0 };
    });
    const task = engine._compileMaterialVariants([new THREE.ShaderMaterial()], {
      isCurrent: () => current,
    });
    jobs.shift()();
    expect(await task).toMatchObject({ ready: false, aborted: true });
    expect(engine._validateCompiledPrograms).not.toHaveBeenCalled();
    expect(engine.renderer.compile).toHaveBeenCalledTimes(1);
    expect(jobs).toHaveLength(0);
  });
});
