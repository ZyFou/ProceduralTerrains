import { describe, expect, it } from 'vitest';
import { prepareWorkerResult } from '../src/engine/WorkerProtocol.js';

describe('prepareWorkerResult', () => {
  it('turns terrain graph compilation results into cloneable public data', async () => {
    const result = await prepareWorkerResult('setTerrainGraph', {
      ok: true,
      reused: true,
      program: {
        kind: 'graph',
        sig: 'graph-signature',
        heightSig: 'height-signature',
        slotCount: 3,
        colorSlotCount: 2,
        packUniforms: () => ({}),
        evaluate2D: () => 0,
      },
      ready: Promise.resolve({ swapped: true, error: null }),
    });

    expect(result).toEqual({
      ok: true,
      reused: true,
      program: {
        kind: 'graph',
        sig: 'graph-signature',
        heightSig: 'height-signature',
        slotCount: 3,
        colorSlotCount: 2,
      },
      ready: { swapped: true, error: null },
    });
    expect(() => structuredClone(result)).not.toThrow();
  });

  it('leaves ordinary engine results unchanged', async () => {
    const result = { ok: true };
    await expect(prepareWorkerResult('regenerate', result)).resolves.toBe(result);
  });
});
