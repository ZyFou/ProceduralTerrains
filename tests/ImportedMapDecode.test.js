import { afterEach, describe, expect, it, vi } from 'vitest';
import { Engine } from '../src/engine/Engine.js';

afterEach(() => vi.unstubAllGlobals());

describe('imported map image decoding', () => {
  it('decodes and previews an image in a worker-style runtime', async () => {
    const close = vi.fn();
    const bitmap = { width: 8192, height: 4096, close };
    const imageData = { data: new Uint8ClampedArray(4) };
    const context = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => imageData),
    };
    const canvases = [];
    class FakeOffscreenCanvas {
      constructor(width, height) {
        this.width = width;
        this.height = height;
        canvases.push(this);
      }
      getContext() { return context; }
      async convertToBlob() { return new Blob(['preview'], { type: 'image/png' }); }
    }

    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    vi.stubGlobal('Image', undefined);
    vi.stubGlobal('document', undefined);

    const engine = Object.create(Engine.prototype);
    const decoded = await engine._decodeImportedImage(new Blob(['heightmap'], { type: 'image/png' }));

    expect(createImageBitmap).toHaveBeenCalledOnce();
    expect(canvases).toHaveLength(1);
    expect(canvases[0]).toMatchObject({ width: 4096, height: 2048 });
    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 4096, 2048);
    expect(context.getImageData).toHaveBeenCalledWith(0, 0, 4096, 2048);
    expect(decoded.width).toBe(4096);
    expect(decoded.height).toBe(2048);
    expect(decoded.originalWidth).toBe(8192);
    expect(decoded.originalHeight).toBe(4096);
    expect(decoded.imageData).toBe(imageData);
    expect(decoded.preview).toMatch(/^data:image\/png;base64,/);
    expect(close).toHaveBeenCalledOnce();
  });
});
