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
  it('waits for GPU completion using zero-timeout polls before publishing progress', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback) => queueMicrotask(callback));
    const { gl, renderer, atlas } = harness();
    Object.assign(gl, { SYNC_GPU_COMMANDS_COMPLETE: 1, TIMEOUT_EXPIRED: 2,
      fenceSync: vi.fn(() => ({})), clientWaitSync: vi.fn().mockReturnValueOnce(2).mockReturnValue(3),
      deleteSync: vi.fn(), flush: vi.fn() });
    const progress = vi.fn(() => expect(gl.deleteSync.mock.calls.length).toBe(gl.fenceSync.mock.calls.length));
    await uploadSurfaceTextures(renderer, atlas, { onProgress: progress });
    expect(progress).toHaveBeenCalled();
    expect(gl.clientWaitSync.mock.calls.every(([, flags, timeout]) => flags === 0 && timeout === 0)).toBe(true);
    expect(gl.deleteSync).toHaveBeenCalledTimes(gl.fenceSync.mock.calls.length);
  });

  it('yields when the time budget is spent even with byte budget remaining', async () => {
    let frames = 0;
    vi.stubGlobal('requestAnimationFrame', (callback) => { frames++; queueMicrotask(callback); });
    const { renderer, atlas, gl } = harness();
    await uploadSurfaceTextures(renderer, atlas, { bytesPerTask: 8 * 1024 * 1024, msPerTask: 0 });
    expect(gl.texSubImage3D).toHaveBeenCalledTimes(4);
    expect(frames).toBe(6);
  });
  it('uploads every array layer in bounded transfers before publication', async () => {
    let frames = 0;
    vi.stubGlobal('requestAnimationFrame', (callback) => { frames++; queueMicrotask(callback); });
    const { gl, renderer, atlas } = harness();
    await uploadSurfaceTextures(renderer, atlas, { bytesPerTask: 256 * 1024 });

    expect(renderer.initTexture).toHaveBeenCalledTimes(2);
    expect(gl.texSubImage3D).toHaveBeenCalledTimes(16);
    expect(frames).toBe(18); // allocations also yield instead of blocking together
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
