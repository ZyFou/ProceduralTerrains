import { describe, expect, it, vi } from 'vitest';
import { readRenderTargetPixelsAsync } from '../src/engine/render/RendererReadback.js';

describe('renderer readback adapter', () => {
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
