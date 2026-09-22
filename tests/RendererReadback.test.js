import { describe, expect, it, vi } from 'vitest';
import { readRenderTargetPixelsAsync, withExportRenderTarget } from '../src/engine/render/RendererReadback.js';

describe('renderer readback adapter', () => {
  it('normalizes message-less GPU failures and rejects an already lost context', async () => {
    const renderer = { isWebGLRenderer: true, readRenderTargetPixelsAsync: vi.fn(() => Promise.reject(undefined)) };
    await expect(readRenderTargetPixelsAsync(renderer, {}, 0, 0, 1, 1)).rejects.toMatchObject({ code: 'GPU_READBACK_FAILED' });
    renderer.getContext = () => ({ isContextLost: () => true });
    await expect(readRenderTargetPixelsAsync(renderer, {}, 0, 0, 1, 1)).rejects.toThrow('context is lost');
    expect(renderer.readRenderTargetPixelsAsync).toHaveBeenCalledTimes(1);
  });
  it('restores the original target and disposes temporary GPU resources after failure', async () => {
    const original = {};
    const renderer = { getRenderTarget: () => original, setRenderTarget: vi.fn() };
    const target = { dispose: vi.fn() };
    await expect(withExportRenderTarget(renderer, target, () => Promise.reject(new Error('GPU failed')))).rejects.toThrow('GPU failed');
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(original);
    expect(target.dispose).toHaveBeenCalledOnce();
  });
  it('uses the caller-owned buffer for WebGL2 asynchronous readback', async () => {
    const renderer = {
      isWebGLRenderer: true,
      readRenderTargetPixelsAsync: vi.fn(async (...args) => {
        args[5].fill(7);
      }),
    };
    const buffer = new Uint8Array(16);
    const output = await readRenderTargetPixelsAsync(renderer, {}, 0, 0, 2, 2, buffer);
    expect(output).toBe(buffer);
    expect([...buffer]).toEqual(new Array(16).fill(7));
  });

  it('normalizes the universal renderer returned buffer', async () => {
    const returned = new Uint8Array([1, 2, 3, 4]);
    const renderer = {
      readRenderTargetPixelsAsync: vi.fn(async () => returned),
    };
    await expect(readRenderTargetPixelsAsync(renderer, {}, 0, 0, 1, 1)).resolves.toBe(returned);
    expect(renderer.readRenderTargetPixelsAsync).toHaveBeenCalledWith({}, 0, 0, 1, 1, 0, 0);
  });
});
