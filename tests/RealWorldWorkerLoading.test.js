import { afterEach, describe, expect, it, vi } from 'vitest';
import { Engine } from '../src/engine/Engine.js';
import { fetchBboxElevation, fetchBboxImagery, compositeCellPatches, compositeCellImagery } from '../src/engine/terrain/RealWorldHeightmap.js';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function workerRuntime() {
  const bitmaps = [];
  vi.stubGlobal('Image', undefined);
  vi.stubGlobal('document', undefined);
  vi.stubGlobal('createImageBitmap', vi.fn(async () => {
    const bitmap = { close: vi.fn() };
    bitmaps.push(bitmap);
    return bitmap;
  }));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['tile']) })));
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() {
      return {
        drawImage() {}, fillRect() {}, putImageData() {},
        createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
        getImageData: (x, y, width, height) => {
          const data = new Uint8ClampedArray(width * height * 4);
          for (let i = 0; i < data.length; i += 4) data.set([128, 10, 128, 255], i);
          return { data, width, height };
        },
      };
    }
    async convertToBlob() { return new Blob(['png'], { type: 'image/png' }); }
  });
  return bitmaps;
}
const bbox = { minLat: 43.44, maxLat: 43.45, minLon: 3.27, maxLon: 3.28 };

describe('real terrain loading without DOM image APIs', () => {
  it('decodes elevation and imagery and encodes both composite previews', async () => {
    const bitmaps = workerRuntime();
    const elevation = await fetchBboxElevation(bbox, 10);
    const imagery = await fetchBboxImagery(bbox, 10);
    expect(elevation.elev[0]).toBe(10.5);
    expect([...imagery.rgba.slice(0, 4)]).toEqual([128, 10, 128, 255]);
    const tiles = [{ cx: 0, cz: 0 }];
    const height = await compositeCellPatches({ '0,0': elevation }, tiles);
    const color = await compositeCellImagery({ '0,0': imagery }, tiles);
    expect(height.preview).toBe('data:image/png;base64,cG5n');
    expect(color.preview).toBe(height.preview);
    expect(bitmaps.length).toBeGreaterThan(0);
    for (const bitmap of bitmaps) expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('propagates cancellation during the final tile and closes its bitmap', async () => {
    const bitmaps = workerRuntime();
    const controller = new AbortController();
    createImageBitmap.mockImplementationOnce(async () => {
      const bitmap = { close: vi.fn() }; bitmaps.push(bitmap);
      controller.abort();
      return bitmap;
    });
    await expect(fetchBboxElevation(bbox, 10, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(bitmaps[0].close).toHaveBeenCalledOnce();
  });

  it.each([false, true])('resumes rendering after a load (network failure: %s)', async (fail) => {
    workerRuntime();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    if (fail) fetch.mockResolvedValue({ ok: false });
    const engine = Object.assign(Object.create(Engine.prototype), {
      worldMode: 'studio', importedMaps: {}, tiles: [{ cx: 0, cz: 0 }],
      cb: { onToast: vi.fn() }, _setImportState: vi.fn(),
      _syncRealWorldNeighborTiles: vi.fn(async () => {}), _tickBody: vi.fn(),
    });
    const pending = engine._loadRealWorldHeightmap({ id: 'custom', name: 'Coulobres', bbox, zoom: 10 });
    engine._tick();
    expect(engine._tickBody).not.toHaveBeenCalled();
    expect(await pending).toBe(!fail);
    engine._tick();
    expect(engine._tickBody).toHaveBeenCalledOnce();
    expect(engine._realWorldLoadsInFlight).toBe(0);
    expect(engine._needsRender).toBe(true);
  });
});
