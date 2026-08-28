import { describe, expect, it, vi } from 'vitest';
import {
  detectGpuTierForRenderer,
  detectGpuTierFromName,
} from '../src/engine/render/GpuTier.js';

describe('GPU tier backend probes', () => {
  it('classifies native WebGPU from adapter diagnostics without reading WebGL APIs', () => {
    const getContext = vi.fn(() => { throw new Error('GPUCanvasContext is not WebGL'); });
    const renderer = {
      isWebGPURenderer: true,
      backend: { isWebGPUBackend: true },
      getContext,
    };

    expect(detectGpuTierForRenderer(renderer, 'NVIDIA GeForce RTX 5060 Ti')).toBe('high');
    expect(getContext).not.toHaveBeenCalled();
  });

  it('keeps unknown WebGPU adapters on the conservative balanced tier', () => {
    expect(detectGpuTierFromName('Generic discrete GPU')).toBe('medium');
  });
});
