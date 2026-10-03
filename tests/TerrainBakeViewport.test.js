import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TerrainHeightBaker } from '../src/engine/terrain/TerrainHeightBaker.js';
import { NearHeightCache } from '../src/engine/terrain/NearHeightCache.js';
import { createTerrainUniforms } from '../src/engine/terrain/TerrainMaterial.js';

// Model Three's distinction between canvas setters (logical pixels scaled by
// DPR) and setRenderTarget (the target's viewport/scissor in physical texels).
function rendererAt(pixelRatio) {
  const previous = new THREE.WebGLRenderTarget(300, 200);
  previous.viewport.set(7, 11, 120, 80);
  previous.scissor.set(9, 13, 100, 60);
  previous.scissorTest = true;
  let target = previous;
  let viewport = previous.viewport.clone();
  let scissor = previous.scissor.clone();
  let scissorTest = previous.scissorTest;
  const draws = [];
  const logicalViewport = new THREE.Vector4(0, 0, 800, 600);
  const logicalScissor = logicalViewport.clone();
  return {
    previous, draws,
    getRenderTarget: () => target,
    getPixelRatio: () => pixelRatio,
    getViewport: (v) => v.copy(logicalViewport),
    getScissor: (v) => v.copy(logicalScissor),
    getScissorTest: () => scissorTest,
    setRenderTarget(next) {
      target = next;
      viewport.copy(next?.viewport ?? logicalViewport);
      scissor.copy(next?.scissor ?? logicalScissor);
      scissorTest = next?.scissorTest ?? false;
    },
    setViewport(...args) {
      logicalViewport.copy(args[0]?.isVector4 ? args[0] : new THREE.Vector4(...args));
      viewport.copy(logicalViewport).multiplyScalar(pixelRatio).round();
    },
    setScissor(...args) {
      logicalScissor.copy(args[0]?.isVector4 ? args[0] : new THREE.Vector4(...args));
      scissor.copy(logicalScissor).multiplyScalar(pixelRatio).round();
    },
    setScissorTest(value) { scissorTest = value; },
    render(scene) {
      draws.push({
        target, viewport: viewport.toArray(), scissor: scissor.toArray(), scissorTest,
        uv: scene.children[0].material.uniforms.uBakeUvTransform.value.toArray(),
      });
      if (this.fail) throw new Error('draw failed');
    },
    current: () => ({ viewport: viewport.toArray(), scissor: scissor.toArray(), scissorTest }),
  };
}

function expectRestored(renderer) {
  expect(renderer.getRenderTarget()).toBe(renderer.previous);
  expect(renderer.current()).toEqual({
    viewport: [7, 11, 120, 80], scissor: [9, 13, 100, 60], scissorTest: true,
  });
  expect(renderer.getViewport(new THREE.Vector4()).toArray()).toEqual([0, 0, 800, 600]);
}

describe('terrain bake texel coordinates', () => {
  it.each([0.75, 1, 1.5, 2])('writes the complete height/climate pair at DPR %s', (ratio) => {
    const renderer = rendererAt(ratio);
    const baker = new TerrainHeightBaker({ renderer, uniforms: createTerrainUniforms(), size: 64 });
    baker.begin(3);
    while (baker.isBaking) baker.step(17);
    const textures = [baker.target, baker.biomeTarget];
    for (const target of textures) {
      const draws = renderer.draws.filter((draw) => draw.target === target);
      let row = 0;
      for (const draw of draws) {
        const rows = Math.min(17, target.height - row);
        expect(draw.viewport).toEqual([0, row, target.width, rows]);
        expect(draw.scissor).toEqual(draw.viewport);
        expect(draw.scissorTest).toBe(true);
        expect(draw.uv).toEqual([0, row / target.height, 1, rows / target.height]);
        row += rows;
      }
      expect(row).toBe(target.height);
    }
    expectRestored(renderer);
    baker.dispose();
    renderer.previous.dispose();
  });

  it.each([0.75, 1.5, 2])('writes a moving fine-cache window at DPR %s', (ratio) => {
    const renderer = rendererAt(ratio);
    const cache = new NearHeightCache({ renderer, uniforms: createTerrainUniforms(), size: 64 });
    const baker = new TerrainHeightBaker({ renderer, uniforms: createTerrainUniforms(), size: 64 });
    baker.begin(3);
    cache._syncMaterial(baker);
    cache._job = { ox: -16, oz: 32, texel: 0.5, span: 32, sourceKey: 'terrain-1', row: 0 };
    while (cache.isBaking) cache._step(17);
    expect(renderer.draws.map((draw) => draw.viewport)).toEqual([
      [0, 0, 64, 17], [0, 17, 64, 17], [0, 34, 64, 17], [0, 51, 64, 13],
    ]);
    for (const draw of renderer.draws) {
      expect(draw.scissor).toEqual(draw.viewport);
      expect(draw.scissorTest).toBe(true);
    }
    expect(cache.active).toBe(true);
    expectRestored(renderer);
    cache.dispose();
    baker.dispose();
    renderer.previous.dispose();
  });

  it('restores the previous target if a bake draw fails', () => {
    const renderer = rendererAt(1.5);
    renderer.fail = true;
    const baker = new TerrainHeightBaker({ renderer, uniforms: createTerrainUniforms(), size: 64 });
    baker.begin(3);
    expect(() => baker.step(17)).toThrow('draw failed');
    expectRestored(renderer);
    expect(baker.mesh.material).toBe(baker.material);
    baker.dispose();
    renderer.previous.dispose();
  });
});
