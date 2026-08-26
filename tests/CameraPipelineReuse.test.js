import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../src/engine/Engine.js';
import { VisualPostProcess } from '../src/engine/render/VisualPostProcess.js';

describe('camera pipeline reuse', () => {
  it('presents a retained final target without re-rendering the scene', () => {
    const post = Object.create(VisualPostProcess.prototype);
    post._plan = { usesSceneTarget: true };
    post._sceneRT = { texture: {} };
    post.finish = vi.fn();
    const renderer = {};

    expect(post.presentCached(renderer)).toBe(true);
    expect(post.finish).toHaveBeenCalledExactlyOnceWith(renderer);

    post._sceneRT = null;
    expect(post.presentCached(renderer)).toBe(false);
    expect(post.finish).toHaveBeenCalledTimes(1);
  });

  it('completes a shared opaque frame with only excluded overlay layers', () => {
    const engine = Object.create(Engine.prototype);
    const scene = new THREE.Scene();
    const terrain = new THREE.Object3D();
    const water = new THREE.Object3D();
    const cloud = new THREE.Object3D();
    scene.add(terrain, water, cloud);
    const camera = new THREE.PerspectiveCamera();
    const target = { texture: {} };
    const render = vi.fn((_scene, activeCamera) => {
      expect(activeCamera.layers.test(terrain.layers)).toBe(false);
      expect(activeCamera.layers.test(water.layers)).toBe(true);
      expect(activeCamera.layers.test(cloud.layers)).toBe(true);
    });
    const renderer = {
      autoClear: true,
      info: { render: { triangles: 12, calls: 2 } },
      getRenderTarget: vi.fn(() => null),
      setRenderTarget: vi.fn(),
      render,
    };
    Object.assign(engine, {
      scene,
      camera,
      renderer,
      water,
      studioCloud: { mesh: cloud },
      infiniteCloud: null,
      planetCloudLayer: null,
      planetCloudChunks: null,
      waterSystem: null,
      _lastSharedOpaqueStats: { triangles: 100, drawCalls: 7 },
      _sharedOpaqueRevision: 'old',
      _sharedOpaqueTarget: target,
      _captureOverlayRoots: () => [],
    });
    const cameraMask = camera.layers.mask;
    const waterMask = water.layers.mask;

    expect(engine._renderSharedOpaqueOverlays(target)).toEqual({
      triangles: 112,
      drawCalls: 9,
    });
    expect(render).toHaveBeenCalledOnce();
    expect(renderer.autoClear).toBe(true);
    expect(camera.layers.mask).toBe(cameraMask);
    expect(water.layers.mask).toBe(waterMask);
    expect(engine._sharedOpaqueRevision).toBeNull();
    expect(engine._sharedOpaqueTarget).toBeNull();
  });

  it('paces passive medium-tier rendering but never active exploration', () => {
    const engine = Object.create(Engine.prototype);
    Object.assign(engine, {
      _debug: { forceRender: false },
      exploreMode: 'none',
      _landingShowcase: false,
      gpuTier: 'medium',
      _lastUserActivityAt: 0,
      _lastRenderAt: 1000,
    });

    expect(engine._continuousRenderInterval(2000)).toBeCloseTo(1000 / 30);
    expect(engine._renderCadenceDue(1020)).toBe(false);
    expect(engine._renderCadenceDue(1034)).toBe(true);

    engine.exploreMode = 'walk';
    expect(engine._continuousRenderInterval(2000)).toBe(0);
    expect(engine._renderCadenceDue(1001)).toBe(true);
  });
});
