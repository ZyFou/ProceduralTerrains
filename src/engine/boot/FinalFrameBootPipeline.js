const BOOT_STAGES = Object.freeze([
  'planning',
  'renderer',
  'resources',
  'geometry',
  'compile',
  'present',
]);

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export class BootPipelineCancelledError extends Error {
  constructor(message = 'Boot pipeline was superseded') {
    super(message);
    this.name = 'BootPipelineCancelledError';
    this.code = 'BOOT_CANCELLED';
  }
}

function cloneSerializable(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(cloneSerializable);
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, cloneSerializable(value[key])]),
  );
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function createBootRenderKey(input = {}) {
  const snapshot = cloneSerializable(input);
  const serialized = JSON.stringify(snapshot);
  return deepFreeze({
    ...snapshot,
    serialized,
  });
}

function normalizeBootError(error, stage, runId) {
  const source = error instanceof Error ? error : new Error(String(error));
  return {
    runId,
    stage,
    code: source.code || 'BOOT_FAILED',
    message: source.message || 'Graphics initialization failed',
    retryable: source.code !== 'BOOT_CANCELLED',
    cause: source,
  };
}

/**
 * Owns the one-way first-frame lifecycle. Stages may allocate and compile, but
 * only the `present` hook may draw to the user canvas. A generation token makes
 * late async completions harmless after retry, resize, context loss or dispose.
 */
export class FinalFrameBootPipeline {
  constructor({ hooks = {}, onProgress, onError, onComplete, now } = {}) {
    this.hooks = hooks;
    this.onProgress = onProgress;
    this.onError = onError;
    this.onComplete = onComplete;
    this.now = now || (() => performance.now());
    this.runId = 0;
    this.state = 'idle';
    this.mode = 'full';
    this.error = null;
    this.result = null;
    this._disposed = false;
    this._activePromise = null;
  }

  get active() {
    return !['idle', 'ready', 'failed', 'disposed'].includes(this.state);
  }

  assertCurrent(runId) {
    if (this._disposed || runId !== this.runId) throw new BootPipelineCancelledError();
  }

  cancel() {
    if (this._disposed) return;
    this.runId += 1;
    if (this.active) this.state = 'idle';
  }

  start({ mode = 'full', reason = 'initial', input = {} } = {}) {
    if (this._disposed) return Promise.reject(new BootPipelineCancelledError('Boot pipeline is disposed'));
    this.cancel();
    const runId = this.runId;
    const startedAt = this.now();
    this.mode = mode === 'compatibility' ? 'compatibility' : 'full';
    this.error = null;
    this.result = null;

    const context = {
      runId,
      mode: this.mode,
      reason,
      input,
      startedAt,
      manifest: {},
      stageDurations: {},
      renderKey: null,
      assertCurrent: () => this.assertCurrent(runId),
      progress: (label, completed, total) => {
        this.assertCurrent(runId);
        const stageIndex = Math.max(0, BOOT_STAGES.indexOf(this.state));
        const stageProgress = total > 0 ? clamp01(completed / total) : 0;
        this.onProgress?.({
          runId,
          stage: this.state,
          label,
          completed,
          total,
          stageIndex,
          stageCount: BOOT_STAGES.length,
          stageProgress,
          overallProgress: clamp01((stageIndex + stageProgress) / BOOT_STAGES.length),
        });
      },
    };

    const execute = async () => {
      try {
        for (let index = 0; index < BOOT_STAGES.length; index++) {
          const stage = BOOT_STAGES[index];
          this.assertCurrent(runId);
          this.state = stage;
          this.onProgress?.({
            runId,
            stage,
            label: stage,
            completed: index,
            total: BOOT_STAGES.length,
            stageIndex: index,
            stageCount: BOOT_STAGES.length,
            stageProgress: 0,
            overallProgress: index / BOOT_STAGES.length,
          });
          const stageStartedAt = this.now();
          const value = await this.hooks[stage]?.(context);
          context.stageDurations[stage] = this.now() - stageStartedAt;
          if (value && typeof value === 'object') Object.assign(context.manifest, value);
          this.assertCurrent(runId);
        }

        this.state = 'ready';
        const result = Object.freeze({
          runId,
          mode: this.mode,
          duration: this.now() - startedAt,
          renderKey: context.renderKey,
          manifest: deepFreeze({
            ...context.manifest,
            stageDurations: { ...context.stageDurations },
          }),
        });
        this.result = result;
        this.onProgress?.({
          runId,
          stage: 'ready',
          label: 'Ready',
          completed: BOOT_STAGES.length,
          total: BOOT_STAGES.length,
          stageIndex: BOOT_STAGES.length,
          stageCount: BOOT_STAGES.length,
          stageProgress: 1,
          overallProgress: 1,
        });
        this.onComplete?.(result);
        return result;
      } catch (error) {
        if (error?.code === 'BOOT_CANCELLED') throw error;
        this.assertCurrent(runId);
        const failedStage = this.state;
        this.state = 'failed';
        this.error = normalizeBootError(error, failedStage, runId);
        this.onError?.(this.error);
        throw error;
      }
    };

    const promise = execute();
    this._activePromise = promise;
    promise.catch(() => {}).finally(() => {
      if (this._activePromise === promise) this._activePromise = null;
    });
    return promise;
  }

  retry(mode = this.mode) {
    return this.start({ mode, reason: 'retry' });
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.runId += 1;
    this.state = 'disposed';
    this._activePromise = null;
  }
}

export { BOOT_STAGES };
