import { describe, expect, it, vi } from 'vitest';
import {
  FinalFrameBootPipeline,
  createBootRenderKey,
} from '../src/engine/boot/FinalFrameBootPipeline.js';

describe('FinalFrameBootPipeline', () => {
  it('runs every hidden stage in order and completes exactly once after present', async () => {
    const order = [];
    const onComplete = vi.fn();
    const hooks = Object.fromEntries(
      ['planning', 'renderer', 'resources', 'geometry', 'compile', 'present']
        .map((stage) => [stage, vi.fn(async () => {
          order.push(stage);
          return { [stage]: true };
        })]),
    );
    const pipeline = new FinalFrameBootPipeline({ hooks, onComplete });

    const result = await pipeline.start({ mode: 'full' });

    expect(order).toEqual(['planning', 'renderer', 'resources', 'geometry', 'compile', 'present']);
    expect(result.manifest).toMatchObject({
      planning: true,
      renderer: true,
      resources: true,
      geometry: true,
      compile: true,
      present: true,
    });
    expect(Object.keys(result.manifest.stageDurations)).toEqual(order);
    expect(pipeline.state).toBe('ready');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('cancels stale async work when a retry starts', async () => {
    let releaseFirst;
    const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
    const onComplete = vi.fn();
    const pipeline = new FinalFrameBootPipeline({
      hooks: {
        planning: async ({ reason }) => {
          if (reason === 'initial') await firstGate;
        },
      },
      onComplete,
    });

    const first = pipeline.start({ reason: 'initial' }).catch((error) => error.code);
    const retry = pipeline.start({ reason: 'retry', mode: 'compatibility' });
    releaseFirst();

    expect(await first).toBe('BOOT_CANCELLED');
    expect((await retry).mode).toBe('compatibility');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('keeps failures terminal and reports the failing stage without presenting ready', async () => {
    const onError = vi.fn();
    const onComplete = vi.fn();
    const pipeline = new FinalFrameBootPipeline({
      hooks: {
        compile: async () => {
          const error = new Error('shader failed');
          error.code = 'SHADER_COMPILE_FAILED';
          throw error;
        },
      },
      onError,
      onComplete,
    });

    await expect(pipeline.start()).rejects.toThrow('shader failed');
    expect(pipeline.state).toBe('failed');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'compile',
      code: 'SHADER_COMPILE_FAILED',
      retryable: true,
    }));
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('creates a deterministic deeply frozen render key', () => {
    const a = createBootRenderKey({ water: { mode: 'legacy' }, backend: 'webgl2' });
    const b = createBootRenderKey({ backend: 'webgl2', water: { mode: 'legacy' } });
    expect(a.serialized).toBe(b.serialized);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.water)).toBe(true);
  });

  it('reports monotonic normalized progress across stage-local work', async () => {
    const updates = [];
    const pipeline = new FinalFrameBootPipeline({
      hooks: {
        geometry: async (context) => {
          context.progress('Building visible terrain', 2, 4);
        },
      },
      onProgress: (update) => updates.push(update),
    });

    await pipeline.start();

    const values = updates.map((update) => update.overallProgress);
    expect(values.every((value, index) => index === 0 || value >= values[index - 1])).toBe(true);
    expect(updates.find((update) => update.label === 'Building visible terrain')).toMatchObject({
      stage: 'geometry',
      stageProgress: 0.5,
      overallProgress: (3 + 0.5) / 6,
    });
    expect(values.at(-1)).toBe(1);
  });
});
