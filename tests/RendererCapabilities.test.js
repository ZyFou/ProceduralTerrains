import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectRendererCapabilities } from '../src/engine/render/RendererCapabilities.js';
import { probeWebGL } from '../src/engine/render/createWebGLRenderer.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('renderer diagnostics', () => {
  it('captures shader-relevant limits without failing on unsupported enums', () => {
    const gl = {
      MAX_TEXTURE_SIZE: 1,
      MAX_TEXTURE_IMAGE_UNITS: 2,
      MAX_COMBINED_TEXTURE_IMAGE_UNITS: 3,
      MAX_VIEWPORT_DIMS: 4,
      FRAGMENT_SHADER: 5,
      HIGH_FLOAT: 6,
      getParameter: vi.fn((token) => ({
        1: 8192,
        2: 16,
        3: 32,
        4: new Int32Array([8192, 8192]),
      })[token] ?? null),
      getExtension: vi.fn((name) => (
        name === 'KHR_parallel_shader_compile' ? {} : null
      )),
      getContextAttributes: vi.fn(() => ({ antialias: false, stencil: false })),
      getShaderPrecisionFormat: vi.fn(() => ({ precision: 23, rangeMin: 127, rangeMax: 127 })),
    };

    const capabilities = detectRendererCapabilities({ getContext: () => gl });

    expect(capabilities.limits).toMatchObject({
      maxTextureSize: 8192,
      maxFragmentTextureUnits: 16,
      maxCombinedTextureUnits: 32,
      maxViewportDimensions: [8192, 8192],
      maxSamples: null,
    });
    expect(capabilities.extensions.parallelShaderCompile).toBe(true);
    expect(capabilities.contextAttributes).toEqual({ antialias: false, stencil: false });
    expect(capabilities.precision.fragmentHighp).toEqual({
      precision: 23,
      rangeMin: 127,
      rangeMax: 127,
    });
  });

  it('releases the temporary WebGL probe context before creating the renderer', () => {
    const loseContext = vi.fn();
    const gl = {
      getExtension: vi.fn((name) => (
        name === 'WEBGL_lose_context' ? { loseContext } : null
      )),
      getParameter: vi.fn(() => ''),
    };
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        getContext: vi.fn(() => gl),
      })),
    });

    expect(probeWebGL()).toEqual({ ok: true });
    expect(loseContext).toHaveBeenCalledTimes(1);
  });
});
