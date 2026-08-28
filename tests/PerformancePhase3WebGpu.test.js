import { describe, expect, it, vi } from 'vitest';
import {
  WEBGPU_RENDERER_STATUS,
  WEBGPU_PRODUCTION_MATERIALS,
  WEBGPU_SHADER_FAMILIES,
  getMissingWebGpuMaterialFamilies,
  getMissingWebGpuProductionMaterials,
} from '../src/engine/render/RendererBackendStatus.js';
import {
  createTslRenderVariant,
  TSL_MODE_RESOURCE_BUDGETS,
} from '../src/engine/render/tsl/SharedTerrainNodes.js';
import {
  compareBackendImages,
  imageRmse,
  imageSsim,
} from '../src/engine/render/BackendImageParity.js';
import { getWebGpuSupport } from '../src/engine/render/RendererCapabilities.js';
import {
  validateWebGpuProductionMaterials,
  validateWebGpuRuntime,
} from '../src/engine/render/WebGpuRuntimeValidation.js';

describe('phase 3 TSL/WebGPU architecture', () => {
  it('builds structurally different exact variants instead of one universal graph', () => {
    const compatibility = createTslRenderVariant({
      mode: 'compatibility',
      heightOctaves: 3,
      detailOctaves: 1,
      water: false,
      clouds: false,
    });
    const planet = createTslRenderVariant({
      mode: 'planet',
      heightOctaves: 7,
      detailOctaves: 3,
      water: true,
      waves: 4,
      clouds: true,
      cloudOctaves: 4,
    });

    expect(compatibility.nodes.water).toBeNull();
    expect(compatibility.nodes.cloud).toBeNull();
    expect(planet.nodes.water?.isNode).toBe(true);
    expect(planet.nodes.cloud?.isNode).toBe(true);
    expect(planet.nodes.height?.isNode).toBe(true);
    expect(planet.key).not.toBe(compatibility.key);
    expect(TSL_MODE_RESOURCE_BUDGETS.compatibility.maxTextures)
      .toBeLessThan(TSL_MODE_RESOURCE_BUDGETS.planet.maxTextures);
  });

  it('rejects a topology that exceeds its mode resource budget', () => {
    expect(() => createTslRenderVariant({
      mode: 'compatibility',
      heightOctaves: 7,
      detailOctaves: 1,
    })).toThrow(/height octave budget exceeded/);
    expect(() => createTslRenderVariant({
      mode: 'infinite',
      heightOctaves: 5,
      detailOctaves: 2,
      clouds: true,
      cloudOctaves: 4,
    })).toThrow(/cloud octave budget exceeded/);
  });

  it('distinguishes browser WebGPU support from application material parity', () => {
    vi.stubGlobal('navigator', { gpu: {} });
    const support = getWebGpuSupport();
    expect(support.browserSupported).toBe(true);
    expect(support.supported).toBe(true);
    expect(support.applicationReady).toBe(false);
    expect(support.selectable).toBe(false);
    expect(support.reason).toMatch(/TSL migration in progress/);
    expect(getMissingWebGpuMaterialFamilies(WEBGPU_RENDERER_STATUS))
      .toEqual(WEBGPU_SHADER_FAMILIES);
    expect(WEBGPU_RENDERER_STATUS.portedProductionMaterials)
      .toEqual([
        'sky-procedural',
        'post-look',
        'post-camera',
        'underwater',
        'cloud-composite',
        'cloud-occupancy',
        'terrain-manual',
      ]);
    expect(getMissingWebGpuProductionMaterials(WEBGPU_RENDERER_STATUS))
      .toEqual(WEBGPU_PRODUCTION_MATERIALS);
    vi.unstubAllGlobals();
  });

  it('does not mistake a missing WebGPU API for a validated backend', async () => {
    vi.stubGlobal('navigator', {});
    await expect(validateWebGpuRuntime()).resolves.toEqual({
      ok: false,
      backend: null,
      reason: 'WebGPU API unavailable',
    });
    await expect(validateWebGpuProductionMaterials()).resolves.toEqual({
      ok: false,
      backend: null,
      reason: 'WebGPU API unavailable',
      materials: [],
    });
    vi.unstubAllGlobals();
  });
});

describe('cross-backend golden metrics', () => {
  it('accepts matching WebGL2 and WebGPU buffers', () => {
    const webgl2 = new Uint8Array([25, 80, 160, 255, 30, 90, 170, 255]);
    const webgpu = new Uint8Array(webgl2);
    expect(imageRmse(webgl2, webgpu)).toBe(0);
    expect(imageSsim(webgl2, webgpu)).toBe(1);
    expect(compareBackendImages(webgl2, webgpu).pass).toBe(true);
  });

  it('rejects a visually divergent backend frame', () => {
    const webgl2 = new Uint8Array(64).fill(0);
    const webgpu = new Uint8Array(64).fill(255);
    const result = compareBackendImages(webgl2, webgpu);
    expect(result.pass).toBe(false);
    expect(result.rmse).toBe(1);
    expect(result.ssim).toBeLessThan(0.1);
  });
});
