import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Minimap } from '../src/engine/Minimap.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
function harness() {
  let target = { name: 'main' };
  const initialTarget = target;
  const read = deferred();
  const renderer = {
    isWebGLRenderer: true,
    getRenderTarget: () => target,
    getActiveCubeFace: () => 2,
    getActiveMipmapLevel: () => 1,
    setRenderTarget: vi.fn((next) => { target = next; }),
    clear: vi.fn(), render: vi.fn(),
    readRenderTargetPixels: vi.fn(),
    readRenderTargetPixelsAsync: vi.fn((_rt, _x, _y, _w, _h, buffer) => {
      for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) buffer.set([x, y, 19, 255], (y * 256 + x) * 4);
      }
      return read.promise;
    }),
  };
  const map = new Minimap(renderer, {}, null, null);
  const sampler = { sampleSurfaceInfo: vi.fn((x, z) => ({
    height: 128, noise: 0.675, slope: 0.5, biome: 'Forest', water: x < 0,
  })) };
  const controls = { target: { x: 0, z: 0 }, theta: 0.3 };
  map.setSources({ sampler, controls, getPropsMask: () => ({ grass: 0.5, flowers: 1, mixed: 0 }) });
  return { map, renderer, read, sampler, controls, initialTarget };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('asynchronous minimap', () => {
  it('submits one readback, restores the target immediately, flips rows and caches an owned image', async () => {
    const { map, renderer, read, initialTarget } = harness();
    const a = map.createFramePacket();
    const b = map.createFramePacket();
    expect(renderer.getRenderTarget()).toBe(initialTarget);
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(initialTarget, 2, 1);
    expect(renderer.readRenderTargetPixelsAsync).toHaveBeenCalledOnce();
    expect(renderer.readRenderTargetPixels).not.toHaveBeenCalled();
    read.resolve();
    const [one, two] = await Promise.all([a, b]);
    expect([...one.rgba.slice(0, 4)]).toEqual([0, 255, 19, 255]);
    expect([...one.rgba.slice(-4)]).toEqual([255, 0, 19, 255]);
    expect(one.rgba).toEqual(two.rgba);
    structuredClone(one.rgba, { transfer: [one.rgba.buffer] });
    const cached = await map.createFramePacket();
    expect(cached.rgba.byteLength).toBe(256 * 256 * 4);
    expect(renderer.render).toHaveBeenCalledOnce();
    map.dispose();
  });

  it.each(['edit', 'zoom', 'pan', 'dispose'])('discards a readback superseded by %s', async (change) => {
    const { map, read, controls } = harness();
    map.setConfig({ zoom: 2 });
    const dispose = vi.spyOn(map.target, 'dispose');
    const packet = map.createFramePacket();
    if (change === 'edit') map.requestRedraw();
    if (change === 'zoom') map.setConfig({ zoom: 3 });
    if (change === 'pan') controls.target.x = 100;
    if (change === 'dispose') map.dispose();
    expect(dispose).not.toHaveBeenCalled();
    read.resolve();
    expect(await packet).toBeNull();
    if (change === 'dispose') expect(dispose).toHaveBeenCalledOnce();
    else map.dispose();
  });

  it('retains a valid image on failure and allows a later retry', async () => {
    const { map, renderer, read } = harness();
    const initial = map.createFramePacket();
    read.resolve();
    await initial;
    const prior = map._baseData;
    map.requestRedraw();
    renderer.readRenderTargetPixelsAsync.mockRejectedValueOnce(new Error('context lost'));
    await expect(map.createFramePacket()).rejects.toThrow('context lost');
    expect(map._baseData).toBe(prior);
    expect(map.getDiagnostics()).toMatchObject({ errors: 1, pending: false });
    expect(await map.createFramePacket()).not.toBeNull();
    map.dispose();
  });

  it.each([
    ['height', [128, 128, 128, 255]], ['noise', [128, 128, 128, 255]],
    ['slope', [128, 128, 128, 255]], ['biome', [76, 138, 87, 255]],
    ['water', [74, 168, 255, 255]], ['props', [255, 128, 0, 255]],
  ])('keeps exact %s map samples and pixels while yielding bounded batches', async (mode, expected) => {
    const { map, sampler, renderer } = harness();
    map.setConfig({ mode });
    const pending = map.createFramePacket();
    if (mode !== 'props') expect(sampler.sampleSurfaceInfo.mock.calls.length).toBeGreaterThan(0);
    expect(sampler.sampleSurfaceInfo.mock.calls.length).toBeLessThanOrEqual(256);
    await vi.runAllTimersAsync();
    const packet = await pending;
    expect(sampler.sampleSurfaceInfo).toHaveBeenCalledTimes(mode === 'props' ? 0 : 16384);
    if (mode !== 'props') {
      expect(sampler.sampleSurfaceInfo.mock.calls[0].slice(0, 2)).toEqual([-1016, -1016]);
      expect(sampler.sampleSurfaceInfo.mock.calls.at(-1).slice(0, 2)).toEqual([1016, 1016]);
    }
    expect([...packet.rgba.slice(0, 4)]).toEqual(expected);
    expect([...packet.rgba.slice(4, 8)]).toEqual(expected);
    expect([...packet.rgba.slice(256 * 4, 256 * 4 + 4)]).toEqual(expected);
    expect(renderer.render).not.toHaveBeenCalled();
    await map.createFramePacket();
    expect(sampler.sampleSurfaceInfo).toHaveBeenCalledTimes(mode === 'props' ? 0 : 16384);
    map.dispose();
  });

  it('cancels analytical sampling between batches after a terrain edit', async () => {
    const { map, sampler } = harness();
    map.setConfig({ mode: 'height' });
    const pending = map.createFramePacket();
    const before = sampler.sampleSurfaceInfo.mock.calls.length;
    map.requestRedraw();
    await vi.runAllTimersAsync();
    expect(await pending).toBeNull();
    expect(sampler.sampleSurfaceInfo).toHaveBeenCalledTimes(before);
    const latest = map.createFramePacket();
    await vi.runAllTimersAsync();
    expect(await latest).not.toBeNull();
    map.dispose();
  });
});


describe('analytical field reuse', () => {
  it('matches full surface sampling at varied coordinates with authored offsets and masks', async () => {
    const { TerrainHeightSampler } = await import('../src/engine/terrain/TerrainHeightSampler.js');
    const { createTerrainUniforms } = await import('../src/engine/terrain/TerrainMaterial.js');
    const uniforms = createTerrainUniforms();
    uniforms.uSeedOffset.value.set(171.73, -95.17);
    const sampler = new TerrainHeightSampler(uniforms, () => ({ octaves: 5, infinite: false }));
    const { map } = harness();
    map.setSources({ sampler, getWaterLevel: () => 140,
      getPaintHeightOffset: (x, z) => Math.sin(x) * 12 + Math.cos(z) * 7,
      getPaintBiomeWeights: (x) => ({ desert: x < 0 ? 1 : 0, wetland: x > 0 ? 1 : 0 }),
    });
    for (const mode of ['height', 'water', 'noise', 'biome', 'slope', 'props']) {
      map.setConfig({ mode });
      for (let index = 0; index < 32; index++) {
        const x = Math.sin(index * 3.17) * 1000;
        const z = Math.cos(index * 1.19) * 1000;
        expect(map._pixelForMode(map._sampleForMode(x, z))).toEqual(map._pixelForMode(map._sample(x, z)));
      }
    }
    map.dispose();
  });
});

describe('worker minimap presentation', () => {
  it('coalesces refreshes during an in-flight frame and ignores detached canvases', async () => {
    const { MinimapPresenter } = await import('../src/engine/MinimapPresenter.js');
    const presenter = new MinimapPresenter();
    const first = deferred();
    presenter.requestFrame = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce({ width: 256, height: 256, overlay: {} });
    presenter._drawBase = vi.fn();
    presenter._drawOverlay = vi.fn();
    presenter.setCanvases({}, {});
    presenter.setCanvases({}, {});
    await presenter.refresh();
    expect(presenter.requestFrame).toHaveBeenCalledOnce();
    first.resolve({ width: 256, height: 256 });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(presenter.requestFrame).toHaveBeenCalledTimes(2);
    expect(presenter._drawBase).toHaveBeenCalledOnce();
    presenter.setCanvases(null, null);
  });
});
