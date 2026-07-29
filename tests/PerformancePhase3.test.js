import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  createTerrainMaterial,
  createTerrainUniforms,
} from '../src/engine/terrain/TerrainMaterial.js';
import { InfiniteTerrainClipmap } from '../src/engine/terrain/InfiniteTerrainClipmap.js';
import { TerrainHeightBaker } from '../src/engine/terrain/TerrainHeightBaker.js';
import { CloudOccupancyPass } from '../src/engine/sky/CloudOccupancyPass.js';
import { createCloudSlabMaterial } from '../src/engine/sky/CloudSlabShader.js';

function renderTargetRenderer() {
  let target = null;
  let viewport = new THREE.Vector4(0, 0, 1280, 720);
  let scissor = new THREE.Vector4(0, 0, 1280, 720);
  let scissorTest = false;
  return {
    getRenderTarget: vi.fn(() => target),
    setRenderTarget: vi.fn((next) => { target = next; }),
    getViewport: vi.fn((out) => out.copy(viewport)),
    setViewport: vi.fn((...args) => {
      viewport = args[0]?.isVector4
        ? args[0].clone()
        : new THREE.Vector4(...args);
    }),
    getScissor: vi.fn((out) => out.copy(scissor)),
    setScissor: vi.fn((...args) => {
      scissor = args[0]?.isVector4
        ? args[0].clone()
        : new THREE.Vector4(...args);
    }),
    getScissorTest: vi.fn(() => scissorTest),
    setScissorTest: vi.fn((value) => { scissorTest = value; }),
    render: vi.fn(),
  };
}

describe('performance phase 3', () => {
  it('refreshes one Infinite field-cache level per frame and shares readiness', () => {
    const renderer = renderTargetRenderer();
    const uniforms = createTerrainUniforms();
    const cache = new InfiniteTerrainClipmap({
      renderer,
      uniforms,
      chunkSize: 128,
      viewRadius: 12,
      octaves: 5,
      resolutions: [64, 64, 64],
    });
    const center = new THREE.Vector3(0, 0, 0);

    expect(cache.update(center, 1)).toBe(true);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(uniforms.uInfiniteFieldReady.value.toArray()).toEqual([1, 0, 0]);

    cache.update(center, 1);
    cache.update(center, 1);
    expect(renderer.render).toHaveBeenCalledTimes(3);
    expect(uniforms.uInfiniteFieldReady.value.toArray()).toEqual([1, 1, 1]);
    expect(uniforms.uInfiniteFieldTex0.value).toBe(cache.levels[0].target.texture);

    cache.dispose();
    expect(uniforms.uUseInfiniteFieldCache.value).toBe(0);
  });

  it('compiles only the terrain features selected by the shader variant', () => {
    const uniforms = createTerrainUniforms();
    const base = createTerrainMaterial(uniforms, 5, undefined, { variant: 'base' });
    const detail = createTerrainMaterial(uniforms, 5, undefined, { variant: 'detail' });
    const surface = createTerrainMaterial(uniforms, 5, undefined, { variant: 'surface' });

    expect(base.userData.terrainVariant).toBe('base');
    expect(base.fragmentShader).not.toContain('uniform float uTerrainDetailFar');
    expect(base.fragmentShader).not.toContain('uniform sampler2D uSurfDiffuse');
    expect(detail.fragmentShader).toContain('uniform float uTerrainDetailFar');
    expect(detail.fragmentShader).not.toContain('uniform sampler2D uSurfDiffuse');
    expect(surface.fragmentShader).not.toContain('uniform float uTerrainDetailFar');
    expect(surface.fragmentShader).toContain('uniform sampler2D uSurfDiffuse');
    expect(base.fragmentShader).toContain('dFdx(vWorldPos)');

    base.dispose();
    detail.dispose();
    surface.dispose();
  });

  it('splits the Studio height and climate bake into bounded stripes', () => {
    const renderer = renderTargetRenderer();
    const baker = new TerrainHeightBaker({
      renderer,
      uniforms: createTerrainUniforms(),
      size: 64,
      maxSize: 64,
    });

    const preview = baker.begin(5);
    expect(preview.heightTexture).toBe(baker.previewTexture);
    expect(preview.biomeTexture).toBe(baker.previewBiomeTexture);
    expect(renderer.render).toHaveBeenCalledTimes(2);

    const first = baker.step(16);
    expect(first.complete).toBe(false);
    expect(renderer.render).toHaveBeenCalledTimes(3);
    expect(renderer.setViewport).toHaveBeenCalledWith(0, 0, 64, 16);

    let result = first;
    let guard = 0;
    while (!result.complete && guard++ < 64) result = baker.step(16);
    expect(result.complete).toBe(true);
    // 2 immediate preview passes + 4 height stripes + 32 climate stripes.
    expect(renderer.render).toHaveBeenCalledTimes(38);
    baker.dispose();
  });

  it('fits the immediate Studio water preview to expanded board bounds', () => {
    const renderer = renderTargetRenderer();
    const baker = new TerrainHeightBaker({
      renderer,
      uniforms: createTerrainUniforms(),
      size: 64,
      maxSize: 128,
      previewSize: 128,
    });

    const preview = baker.begin(5, undefined, 2, 1);

    expect(baker.previewTarget.width).toBe(128);
    expect(baker.previewTarget.height).toBe(64);
    expect(preview.heightTexture).toBe(baker.previewTarget.texture);
    expect(renderer.setViewport).toHaveBeenCalledWith(0, 0, 128, 64);
    baker.dispose();
  });

  it('keeps published Studio water textures stable until the bake completes', () => {
    const renderer = renderTargetRenderer();
    const baker = new TerrainHeightBaker({
      renderer,
      uniforms: createTerrainUniforms(),
      size: 64,
      maxSize: 64,
    });
    const publishedHeight = baker.texture;
    const publishedBiome = baker.biomeTexture;

    baker.begin(5);
    const first = baker.step(16);

    expect(first.complete).toBe(false);
    expect(baker.texture).toBe(publishedHeight);
    expect(baker.biomeTexture).toBe(publishedBiome);
    expect(renderer.setRenderTarget).toHaveBeenCalledWith(baker._writeTarget);

    let result = first;
    let guard = 0;
    while (!result.complete && guard++ < 64) result = baker.step(16);

    expect(result.complete).toBe(true);
    expect(baker.texture).not.toBe(publishedHeight);
    expect(baker.biomeTexture).not.toBe(publishedBiome);

    const committedHeight = baker.texture;
    baker.begin(5);
    baker.step(16);
    expect(baker.texture).toBe(committedHeight);
    baker.dispose();
  });

  it('builds and dilates cloud occupancy entirely in GPU render targets', () => {
    const renderer = renderTargetRenderer();
    const cloud = createCloudSlabMaterial(8, 1, 2, 0, false, 1);
    const pass = new CloudOccupancyPass(renderer, cloud.uniforms, {
      size: 32,
      planet: false,
    });

    pass.render();

    expect(renderer.render).toHaveBeenCalledTimes(3);
    expect(pass.texture).toBe(pass.targets[0].texture);
    expect(pass.texture).toBeInstanceOf(THREE.Texture);
    expect(pass.texture).not.toBeInstanceOf(THREE.DataTexture);
    pass.dispose();
    cloud.dispose();
  });
});
