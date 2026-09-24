import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadSurfaceTextures } from '../src/engine/terrain/surface/SurfaceUploadQueue.js';

const makeTexture = () => ({
  source: { dataReady: true },
  image: { depth: 2 },
  mipmaps: [{ width: 512, height: 512, data: new Uint8Array(512 * 512 * 4 * 2) }],
});

function harness() {
  const gl = {
    TEXTURE_2D_ARRAY: 0x8c1a, TEXTURE0: 0x84c0,
    UNPACK_ALIGNMENT: 0xcf5, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
    texSubImage3D: vi.fn(),
  };
  const renderer = {
    getContext: () => gl,
    initTexture: vi.fn(),
    properties: { get: () => ({ __webglTexture: {} }) },
    state: { bindTexture: vi.fn(), pixelStorei: vi.fn() },
  };
  return { gl, renderer, atlas: { backend: 'array', diffuse: makeTexture(), props: makeTexture() } };
}

afterEach(() => vi.unstubAllGlobals());

describe('surface upload queue', () => {
  it('uploads every array layer in bounded transfers before publication', async () => {
    let frames = 0;
    vi.stubGlobal('requestAnimationFrame', (callback) => { frames++; queueMicrotask(callback); });
    const { gl, renderer, atlas } = harness();
    await uploadSurfaceTextures(renderer, atlas, { bytesPerTask: 256 * 1024 });

    expect(renderer.initTexture).toHaveBeenCalledTimes(2);
    expect(gl.texSubImage3D).toHaveBeenCalledTimes(16);
    expect(frames).toBe(16);
    for (const call of gl.texSubImage3D.mock.calls) {
      expect(call.at(-1).byteLength).toBeLessThanOrEqual(256 * 1024);
    }
    expect(atlas.diffuse.source.dataReady).toBe(false);
    expect(atlas.props.source.dataReady).toBe(false);
  });

  it('stops uploading when the source is superseded', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback) => queueMicrotask(callback));
    const { gl, renderer, atlas } = harness();
    let current = true;
    await expect(uploadSurfaceTextures(renderer, atlas, {
      bytesPerTask: 256 * 1024,
      isCurrent: () => current,
      onProgress: () => { current = false; },
    })).rejects.toMatchObject({ code: 'SURFACE_ATLAS_SUPERSEDED' });
    expect(gl.texSubImage3D).toHaveBeenCalledTimes(1);
  });
});
