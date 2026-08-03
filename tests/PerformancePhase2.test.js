import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { TerrainHeightBaker } from '../src/engine/terrain/TerrainHeightBaker.js';
import { PlanetHeightBaker } from '../src/engine/terrain/PlanetHeightBaker.js';
import { WaterSurfacePass } from '../src/engine/water/WaterSurfacePass.js';
import { VisualPostProcess } from '../src/engine/render/VisualPostProcess.js';

function progressiveRenderer() {
  let target = null;
  return {
    coordinateSystem: THREE.WebGLCoordinateSystem,
    xr: { enabled: true },
    getRenderTarget: vi.fn(() => target),
    getActiveCubeFace: vi.fn(() => 0),
    getActiveMipmapLevel: vi.fn(() => 0),
    setRenderTarget: vi.fn((next) => { target = next; }),
    render: vi.fn(),
  };
}

function refractionMaterial() {
  return {
    uniforms: {
      uSceneColor: { value: null },
      uSceneDepth: { value: null },
      uSceneTexelSize: { value: new THREE.Vector2() },
      uSceneNear: { value: 0 },
      uSceneFar: { value: 0 },
      uSceneRefractionEnabled: { value: 0 },
    },
  };
}

describe('performance phase 2', () => {
  it('stores Studio height and exact normals in a packed half-float target', () => {
    const baker = new TerrainHeightBaker({
      renderer: progressiveRenderer(),
      uniforms: {},
      size: 64,
      maxSize: 64,
    });

    expect(baker.target.texture.format).toBe(THREE.RGBAFormat);
    expect(baker.target.texture.type).toBe(THREE.HalfFloatType);
    expect(baker.material).toBeNull();
    baker.begin(3);
    expect(baker.material.fragmentShader).toContain('uniform float uEps;');
    expect(baker.material.fragmentShader).toContain(
      'gl_FragColor = vec4(nGeo * 0.5 + 0.5, h01);',
    );
    baker.dispose();
  });

  it('bakes one Planet face per step and exposes preview before full quality', () => {
    const renderer = progressiveRenderer();
    const baker = new PlanetHeightBaker({
      renderer,
      uniforms: {},
      size: 64,
      previewSize: 16,
    });

    expect(baker.target.texture.format).toBe(THREE.RGBAFormat);
    expect(baker.previewTarget.texture.format).toBe(THREE.RGBAFormat);
    baker.begin(3);
    expect(baker.material.fragmentShader).toContain(
      'gl_FragColor = vec4(nGeo * 0.5 + 0.5, h01);',
    );

    for (let face = 0; face < 5; face++) {
      expect(baker.step()).toMatchObject({ updated: true, ready: false });
      expect(renderer.render).toHaveBeenCalledTimes(face + 1);
    }
    const preview = baker.step();
    expect(preview.ready).toBe(true);
    expect(preview.complete).toBe(false);
    expect(preview.texture).toBe(baker.previewTarget.texture);
    expect(baker.phase).toBe('full');

    for (let face = 0; face < 6; face++) baker.step();
    expect(baker.complete).toBe(true);
    expect(baker.texture).toBe(baker.target.texture);
    expect(renderer.render).toHaveBeenCalledTimes(12);
    baker.dispose();
  });

  it('binds shared opaque color/depth to water without another scene render', () => {
    const pass = new WaterSurfacePass();
    const renderer = progressiveRenderer();
    const material = refractionMaterial();
    const sourceTarget = {
      width: 1280,
      height: 720,
      texture: {},
      depthTexture: {},
    };

    expect(pass.capture(renderer, {}, { near: 0.5, far: 5000 }, {
      params: {
        waterEnabled: true,
        seaLevel: 80,
        waterRefractionQuality: 1,
      },
      mode: 'cinematic',
      worldMode: 'studio',
      materials: [material],
      sourceTarget,
    })).toBe(true);

    expect(renderer.render).not.toHaveBeenCalled();
    expect(material.uniforms.uSceneColor.value).toBe(sourceTarget.texture);
    expect(material.uniforms.uSceneDepth.value).toBe(sourceTarget.depthTexture);
    expect(pass.diagnostics()).toMatchObject({
      shared: true,
      memoryBytes: 0,
      additionalSceneRenders: 0,
    });
    pass.dispose();
  });

  it('allocates distinct shared opaque and final scene targets on demand', () => {
    const post = new VisualPostProcess();
    const renderer = {
      getDrawingBufferSize: (value) => value.set(1280, 720),
    };
    const plan = post.prepare(renderer, {
      params: { visualsPostEnabled: false },
      perf: {},
      worldMode: 'infinite',
      requireSharedOpaque: true,
    });

    expect(plan.usesSceneTarget).toBe(true);
    expect(post.opaqueTarget).not.toBeNull();
    expect(post.opaqueTarget).not.toBe(post.inputTarget);
    expect(post.opaqueTarget.depthTexture).not.toBeNull();

    post.prepare(renderer, {
      params: { visualsPostEnabled: false },
      perf: {},
      worldMode: 'infinite',
      requireSharedOpaque: false,
    });
    expect(post.opaqueTarget).toBeNull();
    post.dispose();
  });
});
