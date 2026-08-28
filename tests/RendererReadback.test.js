import { describe, expect, it, vi } from 'vitest';
import { readRenderTargetPixelsAsync } from '../src/engine/render/RendererReadback.js';
import * as THREE from 'three';

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

  it('uses a WebGL2 pixel-pack buffer and fence instead of synchronous readPixels', async () => {
    const output = new Uint8Array(16);
    const pbo = {};
    const fence = {};
    const gl = {
      PIXEL_PACK_BUFFER: 1,
      PIXEL_PACK_BUFFER_BINDING: 2,
      STREAM_READ: 3,
      RGBA: 4,
      UNSIGNED_BYTE: 5,
      SYNC_GPU_COMMANDS_COMPLETE: 6,
      CONDITION_SATISFIED: 7,
      ALREADY_SIGNALED: 8,
      WAIT_FAILED: 9,
      createBuffer: vi.fn(() => pbo),
      bindBuffer: vi.fn(),
      bufferData: vi.fn(),
      readPixels: vi.fn(),
      fenceSync: vi.fn(() => fence),
      flush: vi.fn(),
      clientWaitSync: vi.fn(() => 7),
      getBufferSubData: vi.fn((target, offset, targetBuffer) => targetBuffer.fill(23)),
      deleteSync: vi.fn(),
      deleteBuffer: vi.fn(),
      getParameter: vi.fn(() => null),
    };
    const renderer = {
      isWebGLRenderer: true,
      getContext: () => gl,
      getRenderTarget: vi.fn(() => null),
      getActiveCubeFace: vi.fn(() => 0),
      getActiveMipmapLevel: vi.fn(() => 0),
      setRenderTarget: vi.fn(),
      readRenderTargetPixels: vi.fn(),
    };
    const renderTarget = {
      texture: { format: THREE.RGBAFormat, type: THREE.UnsignedByteType },
    };

    await expect(readRenderTargetPixelsAsync(
      renderer,
      renderTarget,
      0,
      0,
      2,
      2,
      output,
    )).resolves.toBe(output);
    expect(gl.readPixels).toHaveBeenCalledWith(0, 0, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    expect(gl.getBufferSubData).toHaveBeenCalled();
    expect(renderer.readRenderTargetPixels).not.toHaveBeenCalled();
    expect([...output]).toEqual(new Array(16).fill(23));
  });
});
