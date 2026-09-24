import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DetailPageCache } from '../src/engine/terrain/detail/DetailPageCache.js';
import { DETAIL_PAGE_SIZE } from '../src/engine/terrain/detail/DetailPageBake.js';
import { createTerrainUniforms } from '../src/engine/terrain/TerrainMaterial.js';

class FakeWorker {
  static instances = [];
  constructor() { this.messages = []; this.terminate = vi.fn(); FakeWorker.instances.push(this); }
  postMessage(message) { this.messages.push(message); }
  reply(message) { this.onmessage({ data: { id: message.id,
    bytes: new Uint8Array(DETAIL_PAGE_SIZE * DETAIL_PAGE_SIZE * 4) } }); }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.instances.length = 0;
});

describe('detail page cache', () => {
  it('shows base terrain until a page arrives and discards an old generation', () => {
    vi.stubGlobal('Worker', FakeWorker);
    const uniforms = createTerrainUniforms();
    const renderer = { initTexture: vi.fn() };
    const cache = new DetailPageCache({ renderer, uniforms });
    const camera = { position: new THREE.Vector3(0, 10, 0) };
    const update = (generation) => cache.update({ camera, mode: 'studio', generation,
      scale: 0.16, seedX: 0, seedY: 0, active: true, dt: 0.016 });

    update(1);
    expect(cache.hasReadyPage).toBe(false);
    expect(uniforms.uDetailGlobalBlend.value).toBe(0);
    expect(renderer.initTexture).not.toHaveBeenCalled();

    const firstWorker = FakeWorker.instances[0];
    firstWorker.reply(firstWorker.messages[0]);
    update(1);
    expect(cache.hasReadyPage).toBe(true);
    expect(renderer.initTexture).toHaveBeenCalledTimes(2);
    expect(uniforms.uDetailGlobalBlend.value).toBeGreaterThan(0);

    camera.position.x = 512;
    update(1);
    expect(firstWorker.terminate).toHaveBeenCalledTimes(1);
    expect(FakeWorker.instances).toHaveLength(2);
    update(2);
    expect(FakeWorker.instances[1].terminate).toHaveBeenCalledTimes(1);
    expect(cache.hasReadyPage).toBe(false);
    expect(uniforms.uDetailGlobalBlend.value).toBe(0);
    firstWorker.reply(firstWorker.messages[0]);
    expect(cache.hasReadyPage).toBe(false);
    cache.dispose();
  });
});
