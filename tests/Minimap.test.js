import { describe, expect, it, vi } from 'vitest';
import { Minimap } from '../src/engine/Minimap.js';

function makeCanvas() {
  const context = {
    createImageData: vi.fn((width, height) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    })),
    putImageData: vi.fn(),
  };
  return {
    canvas: { getContext: vi.fn(() => context) },
    context,
  };
}

describe('Minimap WebGPU rendering', () => {
  it('uses its terrain sampler instead of rendering legacy scene materials', () => {
    const base = makeCanvas();
    const overlay = makeCanvas();
    const renderer = {
      backend: { isWebGPUBackend: true },
      render: vi.fn(),
      getRenderTarget: vi.fn(),
      setRenderTarget: vi.fn(),
      clear: vi.fn(),
    };
    const minimap = new Minimap(renderer, {}, base.canvas, overlay.canvas);
    minimap.setSources({
      sampler: {
        sampleSurfaceInfo: vi.fn(() => ({
          height: 24,
          biome: 'Forest',
          slope: 0.1,
          water: false,
          noise: 0.5,
        })),
      },
    });

    minimap.renderBase();

    expect(base.context.putImageData).toHaveBeenCalledOnce();
    expect(renderer.render).not.toHaveBeenCalled();
    expect(renderer.setRenderTarget).not.toHaveBeenCalled();
    minimap.dispose();
  });
});
