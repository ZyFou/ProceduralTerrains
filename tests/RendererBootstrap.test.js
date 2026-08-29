import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRendererForCanvasAsync } from '../src/engine/render/createWebGLRenderer.js';

afterEach(() => vi.unstubAllGlobals());

function readyStatus(applicationReady) {
  return { applicationReady };
}

describe('renderer backend bootstrap', () => {
  it('keeps Auto on stable WebGL while production parity is still in progress', async () => {
    vi.stubGlobal('navigator', { gpu: {} });
    const webgl = {};
    const loadWebGpuModule = vi.fn();
    const createWebGlRenderer = vi.fn(() => webgl);

    await expect(createRendererForCanvasAsync({}, {
      rendererBackend: 'auto',
      gpuPreference: 'default',
    }, {
      webgpuStatus: readyStatus(false),
      loadWebGpuModule,
      createWebGlRenderer,
    })).resolves.toEqual({
      renderer: webgl,
      requestedBackend: 'auto',
      activeBackend: 'webgl2',
      fallbackReason: '',
    });
    expect(loadWebGpuModule).not.toHaveBeenCalled();
    expect(createWebGlRenderer).toHaveBeenCalledOnce();
  });

  it('initializes a native WebGPU renderer before returning it to Engine', async () => {
    vi.stubGlobal('navigator', { gpu: {} });
    const init = vi.fn(async () => {});
    const instance = { init, backend: { isWebGPUBackend: true }, userData: {} };
    const WebGPURenderer = vi.fn(() => instance);
    const createWebGlRenderer = vi.fn();

    const result = await createRendererForCanvasAsync({ id: 'canvas' }, {
      rendererBackend: 'webgpu',
      gpuPreference: 'high-performance',
    }, {
      webgpuStatus: readyStatus(true),
      loadWebGpuModule: async () => ({ WebGPURenderer }),
      createWebGlRenderer,
    });

    expect(result).toMatchObject({
      renderer: instance,
      requestedBackend: 'webgpu',
      activeBackend: 'webgpu',
      fallbackReason: '',
    });
    expect(init).toHaveBeenCalledOnce();
    expect(WebGPURenderer).toHaveBeenCalledWith(expect.objectContaining({
      antialias: false,
      forceWebGL: false,
      powerPreference: 'high-performance',
    }));
    expect(createWebGlRenderer).not.toHaveBeenCalled();
  });

  it('omits the WebGPU power preference when the user selected Default', async () => {
    vi.stubGlobal('navigator', { gpu: {} });
    const instance = {
      init: vi.fn(async () => {}),
      backend: { isWebGPUBackend: true },
      userData: {},
    };
    const WebGPURenderer = vi.fn(() => instance);

    await createRendererForCanvasAsync({}, {
      rendererBackend: 'webgpu',
      gpuPreference: 'default',
    }, {
      webgpuStatus: readyStatus(true),
      loadWebGpuModule: async () => ({ WebGPURenderer }),
      createWebGlRenderer: vi.fn(),
    });

    expect(WebGPURenderer).toHaveBeenCalledWith(expect.not.objectContaining({
      powerPreference: expect.anything(),
    }));
    expect(instance.userData.terrainRendererOptions.powerPreference).toBe('default');
  });

  it('falls back atomically to a fresh WebGL2 renderer when WebGPU init fails', async () => {
    vi.stubGlobal('navigator', { gpu: {} });
    const dispose = vi.fn();
    const instance = {
      init: vi.fn(async () => { throw new Error('adapter rejected'); }),
      dispose,
    };
    const webgl = {};
    const createWebGlRenderer = vi.fn(() => webgl);

    const result = await createRendererForCanvasAsync({}, {
      rendererBackend: 'webgpu',
    }, {
      webgpuStatus: readyStatus(true),
      loadWebGpuModule: async () => ({ WebGPURenderer: vi.fn(() => instance) }),
      createWebGlRenderer,
    });

    expect(result).toEqual({
      renderer: webgl,
      requestedBackend: 'webgpu',
      activeBackend: 'webgl2',
      fallbackReason: 'adapter rejected',
    });
    expect(dispose).toHaveBeenCalledOnce();
    expect(createWebGlRenderer).toHaveBeenCalledOnce();
  });
});
