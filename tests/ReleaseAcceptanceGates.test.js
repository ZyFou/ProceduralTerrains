import { describe, expect, it } from 'vitest';
import { evaluateReleaseAcceptance } from '../src/engine/boot/ReleaseAcceptanceGates.js';

function completeEvidence(overrides = {}) {
  return {
    nowMs: 7000,
    boot: { presented: true, pending: false, presentedAtMs: 1000, pipelineState: 'ready' },
    shader: {
      failureCount: 0,
      lastCompileReady: true,
      canaryValidated: true,
      maxActiveFragmentSamplers: 12,
      fragmentSamplerLimit: 16,
      maxSyncCompileMs: 12,
      postRevealCompileCount: 0,
    },
    context: { lost: false, lossCount: 1, restoreCount: 1 },
    mode: { name: 'Infinite', dependenciesComplete: true },
    resources: { measuredBytes: 64 * 1048576, budgetBytes: 128 * 1048576, complete: true },
    cache: { hit: false },
    stability: { postRevealMutationCount: 0, observationComplete: true },
    ...overrides,
  };
}

describe('release acceptance gates', () => {
  it('reports ready only when every applicable gate has evidence', () => {
    const result = evaluateReleaseAcceptance(completeEvidence());

    expect(result).toMatchObject({ status: 'ready', ready: true });
    expect(result.counts.fail).toBe(0);
    expect(result.counts.pending).toBe(0);
  });

  it('keeps missing canary and partial resource accounting explicitly incomplete', () => {
    const evidence = completeEvidence();
    evidence.shader.canaryValidated = null;
    evidence.resources.complete = false;

    const result = evaluateReleaseAcceptance(evidence);

    expect(result).toMatchObject({ status: 'incomplete', ready: false });
    expect(result.pending.map((item) => item.id)).toEqual(expect.arrayContaining([
      'shader-canary',
      'resource-ledger',
    ]));
  });

  it('blocks publication evidence that exceeds sampler or main-thread budgets', () => {
    const evidence = completeEvidence();
    evidence.shader.maxActiveFragmentSamplers = 17;
    evidence.shader.maxSyncCompileMs = 83;

    const result = evaluateReleaseAcceptance(evidence);

    expect(result.status).toBe('blocked');
    expect(result.blockers.map((item) => item.id)).toEqual(expect.arrayContaining([
      'sampler-budget',
      'main-thread-task',
    ]));
  });

  it('requires a cache hit to prove identity reuse with no constructors or links', () => {
    const result = evaluateReleaseAcceptance(completeEvidence({
      cache: {
        hit: true,
        identityReused: true,
        heavyweightConstructorCount: 0,
        shaderLinkCount: 1,
      },
    }));

    expect(result.status).toBe('blocked');
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'cache-identity' }),
    ]));
  });
});
