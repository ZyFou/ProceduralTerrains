import { describe, expect, it, vi } from 'vitest';
import {
  GpuResourceLedger,
  estimateRenderTargetBytes,
  rendererAdmission,
} from '../src/engine/render/GpuResourceLedger.js';
import { GpuWorkScheduler } from '../src/engine/render/GpuWorkScheduler.js';
import { inspectProgram, validatePrograms } from '../src/engine/render/ProgramHealthGate.js';

function fakeGl({ linked = true, error = 0 } = {}) {
  let nextError = error;
  return {
    NO_ERROR: 0,
    LINK_STATUS: 1,
    ACTIVE_UNIFORMS: 2,
    SAMPLER_2D: 100,
    getProgramParameter: vi.fn((_program, key) => key === 1 ? linked : 2),
    getProgramInfoLog: vi.fn(() => linked ? '' : 'link failed'),
    getActiveUniform: vi.fn((_program, index) => (
      index === 0 ? { name: 'uMap', size: 1, type: 100 } : { name: 'uValue', size: 1, type: 200 }
    )),
    getError: vi.fn(() => {
      const value = nextError;
      nextError = 0;
      return value;
    }),
    isContextLost: vi.fn(() => false),
  };
}

describe('GPU safety infrastructure', () => {
  it('accounts for render-target samples and rejects over-budget reservations', () => {
    expect(estimateRenderTargetBytes({ width: 10, height: 10, samples: 4 })).toBe(3200);
    const ledger = new GpuResourceLedger({ budgetBytes: 4000 });
    ledger.reserve('main', { width: 10, height: 10, samples: 4 });
    expect(() => ledger.reserve('extra', { bytes: 1000 })).toThrowError(/budget exceeded/i);
    expect(ledger.snapshot().totalBytes).toBe(3200);
  });

  it('rejects render graphs above the device fragment-sampler limit', () => {
    expect(rendererAdmission({ webgl2: true, limits: { maxTextureImageUnits: 16 } }, {
      requiredFragmentSamplers: 17,
    })).toMatchObject({ ok: false, code: 'FRAGMENT_SAMPLER_LIMIT' });
  });

  it('distinguishes driver completion from failed link status', () => {
    const gl = fakeGl({ linked: false });
    const result = inspectProgram(gl, { program: {}, getUniforms: vi.fn() }, { role: 'terrain' });
    expect(result).toMatchObject({ ok: false, code: 'PROGRAM_LINK_FAILED', activeSamplers: 1 });
  });

  it('hashes linked benchmark and normalized production sources without exporting source text', () => {
    const gl = fakeGl();
    const vertex = { type: 10 };
    const fragment = { type: 11 };
    Object.assign(gl, {
      VERTEX_SHADER: 10,
      FRAGMENT_SHADER: 11,
      SHADER_TYPE: 12,
      getAttachedShaders: () => [vertex, fragment],
      getShaderParameter: (shader) => shader.type,
      getShaderSource: (shader) => shader === vertex
        ? '#define TERRAIN_BENCHMARK_RUN 9\nvoid main(){}'
        : 'void main(){}',
    });

    const result = inspectProgram(gl, { program: {} }, { role: 'terrain' });

    expect(result.linkedSourceHash).not.toBe(result.productionLinkedSourceHash);
    expect(result.productionLinkedVertexChars).toBeLessThan(result.linkedVertexChars);
    expect(JSON.stringify(result)).not.toContain('void main');
  });

  it('fails a linked program when the exact canary reports a GL error', async () => {
    const gl = fakeGl();
    const material = { id: 1, name: 'terrain' };
    let canaryRan = false;
    const renderer = {
      getContext: () => gl,
      properties: { get: () => ({ currentProgram: { program: {}, getUniforms: vi.fn() } }) },
    };
    const result = await validatePrograms({
      renderer,
      materials: [material],
      canary: () => {
        canaryRan = true;
        gl.getError.mockImplementationOnce(() => 1282);
      },
    });
    expect(canaryRan).toBe(true);
    expect(result).toMatchObject({ ok: false, code: 'PROGRAM_CANARY_FAILED', glErrors: [1282] });
  });

  it('deduplicates keyed GPU work and serializes heavyweight submissions', async () => {
    const release = [];
    const scheduler = new GpuWorkScheduler({ yieldTask: () => Promise.resolve(), maxConcurrent: 1 });
    const run = vi.fn(() => new Promise((resolve) => release.push(resolve)));
    const first = scheduler.schedule('terrain', run);
    const duplicate = scheduler.schedule('terrain', run);
    const second = scheduler.schedule('water', run);
    await Promise.resolve();
    await Promise.resolve();
    expect(first).toBe(duplicate);
    expect(run).toHaveBeenCalledTimes(1);
    release.shift()('terrain');
    await first;
    await Promise.resolve();
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(2);
    release.shift()('water');
    await expect(second).resolves.toBe('water');
  });
});
