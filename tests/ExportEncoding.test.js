import { afterEach, describe, expect, it, vi } from 'vitest';
import { canvasPngBytes, serializeGlb } from '../src/export/ExportEncoding.js';
import { maskToPngBytes } from '../src/engine/water/WaterMasks.js';

afterEach(() => vi.unstubAllGlobals());
describe('export encoders', () => {
  it('rejects failed/empty GLB serialization instead of silently omitting the model', async () => {
    await expect(serializeGlb({}, { parseAsync: () => Promise.reject(undefined) })).rejects.toThrow('GLB serialization failed');
    await expect(serializeGlb({}, { parseAsync: async () => new ArrayBuffer(0) })).rejects.toThrow('empty');
    expect(await serializeGlb({}, { parseAsync: async () => new ArrayBuffer(12) })).toHaveLength(12);
  });
  it('encodes HTML and offscreen canvases and rejects null PNGs', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    expect(await canvasPngBytes({ toBlob: (done) => done(blob) })).toEqual(new Uint8Array([1, 2, 3]));
    expect(await canvasPngBytes({ convertToBlob: async () => blob })).toEqual(new Uint8Array([1, 2, 3]));
    await expect(canvasPngBytes({ toBlob: (done) => done(null) })).rejects.toThrow('no image data');
  });
  it('exports water masks in workers without toDataURL', async () => {
    const convertToBlob = vi.fn(async () => new Blob([new Uint8Array([9])]));
    vi.stubGlobal('document', { createElement: () => ({ convertToBlob,
      getContext: () => ({ createImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData() {} }),
    }) });
    expect(await maskToPngBytes(new Float32Array([0.5]), 1)).toEqual(new Uint8Array([9]));
    expect(convertToBlob).toHaveBeenCalledWith({ type: 'image/png' });
  });
});
