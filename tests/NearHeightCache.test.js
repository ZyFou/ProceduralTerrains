import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NearHeightCache } from '../src/engine/terrain/NearHeightCache.js';

function stubRenderer() {
  const calls = { render: 0 };
  return {
    calls,
    getRenderTarget: () => null,
    setRenderTarget() {},
    getViewport: (v) => v.set(0, 0, 1, 1),
    setViewport() {},
    getScissor: (v) => v.set(0, 0, 1, 1),
    setScissor() {},
    getScissorTest: () => false,
    setScissorTest() {},
    render() { calls.render++; },
  };
}

function setup() {
  const uniforms = {
    uBakeBlend: { value: new THREE.Vector2(0.3, 0.5) },
    uNearBakeTex: { value: null },
    uNearBakeOrigin: { value: new THREE.Vector2() },
    uNearBakeSpan: { value: new THREE.Vector2(1, 1) },
    uNearBakeTexelWorld: { value: 0.5 },
    uUseNearBake: { value: 0 },
  };
  const renderer = stubRenderer();
  const cache = new NearHeightCache({ renderer, uniforms, size: 64 });
  const baker = {
    texture: {},
    programKey: '7:abc',
    material: new THREE.ShaderMaterial({ uniforms: {}, defines: { OCTAVES: 7 }, vertexShader: 'void main(){}', fragmentShader: 'void main(){}' }),
  };
  const camera = new THREE.PerspectiveCamera(50, 1, 1, 1e5);
  camera.position.set(10, 60, 20);
  camera.lookAt(10, 0, -100);
  camera.updateMatrixWorld();
  const args = (extra = {}) => ({
    baker, sourceKey: 'g1', enabled: true, camera, boardTexel: 1,
    pixelWorldPerDist: 0.00115, groundY: 0, rows: 16, movingRows: 4, ...extra,
  });
  return { uniforms, renderer, cache, camera, args };
}

describe('NearHeightCache', () => {
  it('bakes once the camera settles and publishes a grid-snapped window', () => {
    const { uniforms, cache, args } = setup();
    for (let i = 0; i < 3; i++) cache.update(args());   // settling frames
    expect(cache.isBaking).toBe(false);
    for (let i = 0; i < 8 && uniforms.uUseNearBake.value === 0; i++) cache.update(args());
    expect(uniforms.uUseNearBake.value).toBe(1);
    expect(uniforms.uNearBakeTexelWorld.value).toBe(0.5);
    const snap = 0.5 * 32;
    const o = uniforms.uNearBakeOrigin.value;
    expect(Math.abs(o.x / snap - Math.round(o.x / snap))).toBeLessThan(1e-9);
    expect(Math.abs(o.y / snap - Math.round(o.y / snap))).toBeLessThan(1e-9);
    expect(uniforms.uNearBakeSpan.value.x).toBe(32);
    expect(cache.back).toBeNull();   // back buffer released after the swap
  });

  it('never starts a bake while the camera keeps moving', () => {
    const { cache, camera, renderer, args } = setup();
    for (let i = 0; i < 20; i++) {
      camera.position.x += 3;
      cache.update(args());
    }
    expect(renderer.calls.render).toBe(0);
    expect(cache.isBaking).toBe(false);
  });

  it('drops the window when the terrain changes and skips high cameras', () => {
    const { uniforms, cache, camera, args } = setup();
    for (let i = 0; i < 12; i++) cache.update(args());
    expect(uniforms.uUseNearBake.value).toBe(1);
    cache.update(args({ sourceKey: 'g2' }));
    expect(uniforms.uUseNearBake.value).toBe(0);

    camera.position.y = 5000;   // every pixel is served by the board bake
    const { renderer } = setup();
    const high = new NearHeightCache({ renderer, uniforms, size: 64 });
    for (let i = 0; i < 12; i++) high.update(args({ sourceKey: 'g2' }));
    expect(renderer.calls.render).toBe(0);
  });
});
