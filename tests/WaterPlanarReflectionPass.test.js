import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  isPlanarReflectionMode,
  resolvePlanarReflectionCadence,
  resolveWaterPlanarReflectionSize,
  updatePlanarReflectionCamera,
  WaterPlanarReflectionPass,
} from '../src/engine/water/WaterPlanarReflectionPass.js';

function createReflectionMaterial() {
  return {
    uniforms: {
      uPlanarReflection: { value: null },
      uPlanarReflectionMatrix: { value: new THREE.Matrix4() },
      uPlanarReflectionTexelSize: { value: new THREE.Vector2(1, 1) },
      uPlanarReflectionEnabled: { value: 0 },
    },
  };
}

function createRenderer(onRender = null) {
  let target = null;
  return {
    xr: { enabled: true },
    shadowMap: { autoUpdate: true },
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

function createCamera() {
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.5, 5000);
  camera.position.set(120, 180, 260);
  camera.lookAt(0, 60, 0);
  camera.updateMatrixWorld(true);
  return camera;
}

const cinematicParams = {
  waterEnabled: true,
  seaLevel: 80,
  waterReflectionQuality: 1.4,
  waterRenderScale: 2,
  waterUpdateFrequency: 2,
};

describe('WaterPlanarReflectionPass', () => {
  it('maps only Cinematic mode to planar reflection', () => {
    expect(isPlanarReflectionMode('legacy')).toBe(false);
    expect(isPlanarReflectionMode('realistic')).toBe(false);
    expect(isPlanarReflectionMode('volumetric')).toBe(false);
    expect(isPlanarReflectionMode('cinematic')).toBe(true);
  });

  it('scales resolution from reflection quality and the shared render scale', () => {
    expect(resolveWaterPlanarReflectionSize({
      width: 1920,
      height: 1080,
      reflectionQuality: 1.5,
      renderScale: 2,
    })).toMatchObject({ width: 1920, height: 1080, scale: 1 });
    expect(resolveWaterPlanarReflectionSize({
      width: 1920,
      height: 1080,
      reflectionQuality: 1.25,
      renderScale: 1,
    })).toMatchObject({ width: 720, height: 405, scale: 0.375 });
  });

  it('normalizes reflection update cadence to supported intervals', () => {
    expect(resolvePlanarReflectionCadence(1)).toBe(1);
    expect(resolvePlanarReflectionCadence(2)).toBe(2);
    expect(resolvePlanarReflectionCadence(3)).toBe(2);
    expect(resolvePlanarReflectionCadence(4)).toBe(4);
  });

  it('mirrors the camera around sea level and installs an oblique clip plane', () => {
    const source = createCamera();
    const reflection = source.clone();
    const originalProjection = source.projectionMatrix.clone();

    updatePlanarReflectionCamera(source, reflection, 80);

    expect(reflection.position.x).toBeCloseTo(source.position.x);
    expect(reflection.position.y).toBeCloseTo(160 - source.position.y);
    expect(reflection.position.z).toBeCloseTo(source.position.z);
    expect(reflection.projectionMatrix.elements[6])
      .not.toBeCloseTo(originalProjection.elements[6]);
    expect(reflection.projectionMatrix.elements[14])
      .not.toBeCloseTo(originalProjection.elements[14]);
  });

  it('allocates lazily, hides water, and reuses captures at the selected cadence', () => {
    const water = { visible: true };
    const material = createReflectionMaterial();
    const camera = createCamera();
    const pass = new WaterPlanarReflectionPass();
    const renderer = createRenderer(({ target, camera: reflectedCamera }) => {
      expect(target).toBe(pass.target);
      expect(reflectedCamera).toBe(pass.reflectionCamera);
      expect(reflectedCamera.position.y).toBeCloseTo(-20);
      expect(water.visible).toBe(false);
      expect(material.uniforms.uPlanarReflection.value).toBeNull();
      expect(material.uniforms.uPlanarReflectionEnabled.value).toBe(0);
      expect(renderer.xr.enabled).toBe(false);
      expect(renderer.shadowMap.autoUpdate).toBe(false);
    });

    expect(pass.capture(renderer, {}, camera, {
      params: cinematicParams,
      mode: 'cinematic',
      worldMode: 'studio',
      sceneSize: { x: 1200, y: 800 },
      hiddenObjects: [water],
      materials: [material],
    })).toBe(true);

    expect(water.visible).toBe(true);
    expect(renderer.xr.enabled).toBe(true);
    expect(renderer.shadowMap.autoUpdate).toBe(true);
    expect(pass.target.width).toBe(1080);
    expect(pass.target.height).toBe(720);
    expect(material.uniforms.uPlanarReflection.value).toBe(pass.target.texture);
    expect(material.uniforms.uPlanarReflectionEnabled.value).toBe(1);
    expect(renderer.render).toHaveBeenCalledTimes(1);

    expect(pass.capture(renderer, {}, camera, {
      params: cinematicParams,
      mode: 'cinematic',
      worldMode: 'studio',
      sceneSize: { x: 1200, y: 800 },
      hiddenObjects: [water],
      materials: [material],
    })).toBe(true);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(pass.diagnostics()).toMatchObject({
      active: true,
      allocated: true,
      cadence: 2,
      updatedThisFrame: false,
      additionalSceneRenders: 0,
      captures: 1,
    });

    pass.capture(renderer, {}, camera, {
      params: cinematicParams,
      mode: 'cinematic',
      worldMode: 'studio',
      sceneSize: { x: 1200, y: 800 },
      hiddenObjects: [water],
      materials: [material],
    });
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(pass.diagnostics().updatedThisFrame).toBe(true);
    pass.dispose();
  });

  it('stays inactive outside Cinematic Tile mode and below the surface', () => {
    const pass = new WaterPlanarReflectionPass();
    const renderer = createRenderer();
    const material = createReflectionMaterial();
    const camera = createCamera();

    expect(pass.capture(renderer, {}, camera, {
      params: cinematicParams,
      mode: 'volumetric',
      worldMode: 'studio',
      materials: [material],
    })).toBe(false);
    camera.position.y = 70;
    expect(pass.capture(renderer, {}, camera, {
      params: cinematicParams,
      mode: 'cinematic',
      worldMode: 'studio',
      materials: [material],
    })).toBe(false);
    expect(pass.target).toBeNull();
    expect(renderer.render).not.toHaveBeenCalled();
    expect(material.uniforms.uPlanarReflectionEnabled.value).toBe(0);
    pass.dispose();
  });

  it('keeps a static reflection until its scene revision changes', () => {
    const pass = new WaterPlanarReflectionPass();
    const renderer = createRenderer();
    const material = createReflectionMaterial();
    const camera = createCamera();
    const params = { ...cinematicParams, waterUpdateFrequency: 1 };
    const options = {
      params,
      mode: 'cinematic',
      worldMode: 'studio',
      materials: [material],
      revision: 'camera:1|terrain:4',
    };

    pass.capture(renderer, {}, camera, options);
    pass.capture(renderer, {}, camera, options);
    pass.capture(renderer, {}, camera, options);
    expect(renderer.render).toHaveBeenCalledTimes(1);

    pass.capture(renderer, {}, camera, {
      ...options,
      revision: 'camera:2|terrain:4',
    });
    expect(renderer.render).toHaveBeenCalledTimes(2);
    pass.dispose();
  });

  it('restores renderer and object state after a reflection render error', () => {
    const previousTarget = {};
    const water = { visible: true };
    const material = createReflectionMaterial();
    const camera = createCamera();
    let target = previousTarget;
    const renderer = {
      xr: { enabled: true },
      shadowMap: { autoUpdate: true },
      getDrawingBufferSize: (value) => value.set(800, 600),
      getRenderTarget: () => target,
      setRenderTarget: (next) => { target = next; },
      render: () => { throw new Error('reflection failed'); },
    };
    const pass = new WaterPlanarReflectionPass();

    expect(() => pass.capture(renderer, {}, camera, {
      params: cinematicParams,
      mode: 'cinematic',
      worldMode: 'studio',
      hiddenObjects: [water],
      materials: [material],
    })).toThrow('reflection failed');
    expect(water.visible).toBe(true);
    expect(target).toBe(previousTarget);
    expect(renderer.xr.enabled).toBe(true);
    expect(renderer.shadowMap.autoUpdate).toBe(true);
    expect(material.uniforms.uPlanarReflectionEnabled.value).toBe(0);
    pass.dispose();
  });
});
