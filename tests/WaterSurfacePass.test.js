import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  isSceneRefractionMode,
  resolveWaterSurfacePassSize,
  WaterSurfacePass,
} from '../src/engine/water/WaterSurfacePass.js';

function createCaptureMaterial() {
  return {
    uniforms: {
      uSceneColor: { value: null },
      uSceneDepth: { value: null },
      uSceneTexelSize: { value: new THREE.Vector2(1, 1) },
      uSceneNear: { value: 0 },
      uSceneFar: { value: 0 },
      uSceneRefractionEnabled: { value: 0 },
    },
  };
}

function createRenderer(onRender = null) {
  let target = null;
  return {
    getDrawingBufferSize: vi.fn((value) => value.set(1600, 900)),
    getRenderTarget: vi.fn(() => target),
    setRenderTarget: vi.fn((next) => { target = next; }),
    render: vi.fn((scene, camera) => onRender?.({
      scene,
      camera,
      target,
    })),
  };
}

const activeParams = {
  waterEnabled: true,
  seaLevel: 80,
  waterRefractionQuality: 0.75,
  waterRenderScale: 1,
};

describe('WaterSurfacePass', () => {
  it('maps only Volumetric and Cinematic modes to scene refraction', () => {
    expect(isSceneRefractionMode('legacy')).toBe(false);
    expect(isSceneRefractionMode('realistic')).toBe(false);
    expect(isSceneRefractionMode('volumetric')).toBe(true);
    expect(isSceneRefractionMode('cinematic')).toBe(true);
  });

  it('uses half-resolution at 1x and full resolution at 2x', () => {
    expect(resolveWaterSurfacePassSize({
      width: 1920,
      height: 1080,
      renderScale: 1,
    })).toMatchObject({ width: 960, height: 540, scale: 0.5 });
    expect(resolveWaterSurfacePassSize({
      width: 1920,
      height: 1080,
      renderScale: 2,
    })).toMatchObject({ width: 1920, height: 1080, scale: 1 });
  });

  it('allocates lazily and stays inactive for Realistic mode', () => {
    const pass = new WaterSurfacePass();
    const renderer = createRenderer();
    const material = createCaptureMaterial();

    expect(pass.target).toBeNull();
    expect(pass.capture(renderer, {}, { near: 1, far: 1000 }, {
      params: activeParams,
      mode: 'realistic',
      worldMode: 'studio',
      materials: [material],
    })).toBe(false);
    expect(pass.target).toBeNull();
    expect(renderer.render).not.toHaveBeenCalled();
    expect(material.uniforms.uSceneRefractionEnabled.value).toBe(0);
    pass.dispose();
  });

  it('hides water and unbinds samplers while writing the capture target', () => {
    const water = { visible: true };
    const material = createCaptureMaterial();
    const scene = {};
    const camera = { near: 1, far: 50000 };
    const pass = new WaterSurfacePass();
    const renderer = createRenderer(({ target }) => {
      expect(target).toBe(pass.target);
      expect(water.visible).toBe(false);
      expect(material.uniforms.uSceneColor.value).toBeNull();
      expect(material.uniforms.uSceneDepth.value).toBeNull();
      expect(material.uniforms.uSceneRefractionEnabled.value).toBe(0);
    });

    expect(pass.capture(renderer, scene, camera, {
      params: activeParams,
      mode: 'volumetric',
      worldMode: 'studio',
      sceneSize: { x: 1200, y: 800 },
      hiddenObjects: [water],
      materials: [material],
    })).toBe(true);

    expect(water.visible).toBe(true);
    expect(pass.target.width).toBe(600);
    expect(pass.target.height).toBe(400);
    expect(material.uniforms.uSceneColor.value).toBe(pass.target.texture);
    expect(material.uniforms.uSceneDepth.value).toBe(pass.target.depthTexture);
    expect(material.uniforms.uSceneRefractionEnabled.value).toBe(1);
    expect(renderer.setRenderTarget.mock.calls.at(-1)[0]).toBeNull();
    expect(pass.diagnostics()).toMatchObject({
      active: true,
      allocated: true,
      resolution: { width: 600, height: 400 },
      additionalSceneRenders: 1,
    });

    expect(pass.capture(renderer, scene, camera, {
      params: activeParams,
      mode: 'realistic',
      worldMode: 'studio',
      hiddenObjects: [water],
      materials: [material],
    })).toBe(false);
    expect(pass.target).toBeNull();
    expect(material.uniforms.uSceneRefractionEnabled.value).toBe(0);
    pass.dispose();
  });

  it('restores visibility and the previous render target after a capture error', () => {
    const previousTarget = {};
    const water = { visible: true };
    const material = createCaptureMaterial();
    let target = previousTarget;
    const renderer = {
      getDrawingBufferSize: (value) => value.set(800, 600),
      getRenderTarget: () => target,
      setRenderTarget: (next) => { target = next; },
      render: () => { throw new Error('capture failed'); },
    };
    const pass = new WaterSurfacePass();

    expect(() => pass.capture(renderer, {}, { near: 1, far: 1000 }, {
      params: activeParams,
      mode: 'cinematic',
      worldMode: 'studio',
      hiddenObjects: [water],
      materials: [material],
    })).toThrow('capture failed');
    expect(water.visible).toBe(true);
    expect(target).toBe(previousTarget);
    expect(material.uniforms.uSceneRefractionEnabled.value).toBe(0);
    pass.dispose();
  });
});
