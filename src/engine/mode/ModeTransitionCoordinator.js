export const MODE_TRANSITION_STAGES = Object.freeze([
  'planning',
  'resources',
  'geometry',
  'compile',
  'present',
]);

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

function cloneSerializable(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(cloneSerializable);
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, cloneSerializable(value[key])]),
  );
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  // GPU/Three payloads must never become immutable as a side effect of a
  // diagnostic manifest. Typed-array freezing also throws in current V8.
  if (ArrayBuffer.isView(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function createModeRenderKey(input = {}) {
  const snapshot = cloneSerializable(input);
  return deepFreeze({ ...snapshot, serialized: JSON.stringify(snapshot) });
}

export class ModeTransitionCancelledError extends Error {
  constructor(message = 'Mode transition was superseded') {
    super(message);
    this.name = 'ModeTransitionCancelledError';
    this.code = 'MODE_TRANSITION_CANCELLED';
  }
}

function normalizeError(error, stage, runId, target) {
  const source = error instanceof Error ? error : new Error(String(error));
  return {
    runId,
    target,
    stage,
    code: source.code || 'MODE_TRANSITION_FAILED',
    message: source.message || 'Mode transition failed',
    retryable: source.code !== 'MODE_TRANSITION_CANCELLED',
    cause: source,
  };
}

/**
 * Cancellable, one-way coordinator for exact-frame mode transitions. Hooks
 * prepare detached resources; only `present` may publish the target mode.
 */
export class ModeTransitionCoordinator {
  constructor({ hooks = {}, onProgress, onComplete, onError, now } = {}) {
    this.hooks = hooks;
    this.onProgress = onProgress;
    this.onComplete = onComplete;
    this.onError = onError;
    this.now = now || (() => performance.now());
    this.runId = 0;
    this.state = 'idle';
    this.target = null;
    this.result = null;
    this.error = null;
    this._disposed = false;
    this._activePromise = null;
  }

  get active() {
    return !['idle', 'ready', 'failed', 'disposed'].includes(this.state);
  }

  assertCurrent(runId) {
    if (this._disposed || runId !== this.runId) throw new ModeTransitionCancelledError();
  }

  cancel() {
    if (this._disposed) return;
    this.runId += 1;
    if (this.active) this.state = 'idle';
  }

  start({ target, input = {}, reason = 'user' } = {}) {
    if (this._disposed) {
      return Promise.reject(new ModeTransitionCancelledError('Mode transition coordinator is disposed'));
    }
    this.cancel();
    const runId = this.runId;
    const startedAt = this.now();
    this.target = target;
    this.result = null;
    this.error = null;

    const context = {
      runId,
      target,
      input,
      reason,
      startedAt,
      renderKey: null,
      manifest: {},
      stageDurations: {},
      assertCurrent: () => this.assertCurrent(runId),
      progress: (label, completed, total) => {
        this.assertCurrent(runId);
        const stageIndex = Math.max(0, MODE_TRANSITION_STAGES.indexOf(this.state));
        const stageProgress = total > 0 ? clamp01(completed / total) : 0;
        this.onProgress?.({
          runId,
          target,
          stage: this.state,
          label,
          completed,
          total,
          stageIndex,
          stageCount: MODE_TRANSITION_STAGES.length,
          stageProgress,
          overallProgress: clamp01((stageIndex + stageProgress) / MODE_TRANSITION_STAGES.length),
        });
      },
    };

    const execute = async () => {
      try {
        for (let index = 0; index < MODE_TRANSITION_STAGES.length; index++) {
          const stage = MODE_TRANSITION_STAGES[index];
          this.assertCurrent(runId);
          this.state = stage;
          this.onProgress?.({
            runId,
            target,
            stage,
            label: stage,
            completed: index,
            total: MODE_TRANSITION_STAGES.length,
            stageIndex: index,
            stageCount: MODE_TRANSITION_STAGES.length,
            stageProgress: 0,
            overallProgress: index / MODE_TRANSITION_STAGES.length,
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
          target,
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
          target,
          stage: 'ready',
          label: 'Ready',
          completed: MODE_TRANSITION_STAGES.length,
          total: MODE_TRANSITION_STAGES.length,
          stageIndex: MODE_TRANSITION_STAGES.length,
          stageCount: MODE_TRANSITION_STAGES.length,
          stageProgress: 1,
          overallProgress: 1,
        });
        this.onComplete?.(result);
        return result;
      } catch (error) {
        if (error?.code === 'MODE_TRANSITION_CANCELLED') throw error;
        this.assertCurrent(runId);
        const failedStage = this.state;
        this.state = 'failed';
        this.error = normalizeError(error, failedStage, runId, target);
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

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.runId += 1;
    this.state = 'disposed';
    this._activePromise = null;
  }
}

/** LRU retaining the active entry plus at most `maxInactive` parked modes. */
export class ModeResourceCache {
  constructor({ maxInactive = 2 } = {}) {
    this.maxInactive = Math.max(0, Math.floor(maxInactive));
    this.activeKey = null;
    this.entries = new Map();
  }

  get size() { return this.entries.size; }

  has(key) { return this.entries.has(key); }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key, value, { dispose } = {}) {
    const previous = this.entries.get(key);
    if (previous && previous.value !== value) previous.dispose?.(previous.value);
    this.entries.delete(key);
    this.entries.set(key, { value, dispose });
    this._evict();
    return value;
  }

  activate(key, value, options = {}) {
    if (!this.entries.has(key) || this.entries.get(key).value !== value) {
      this.set(key, value, options);
    } else {
      this.get(key);
    }
    this.activeKey = key;
    this._evict();
    return value;
  }

  delete(key) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    if (this.activeKey === key) this.activeKey = null;
    entry.dispose?.(entry.value);
    return true;
  }

  _evict() {
    const inactiveCount = () => this.entries.size - (this.activeKey && this.entries.has(this.activeKey) ? 1 : 0);
    while (inactiveCount() > this.maxInactive) {
      const key = [...this.entries.keys()].find((candidate) => candidate !== this.activeKey);
      if (key == null) break;
      this.delete(key);
    }
  }

  clear() {
    for (const entry of this.entries.values()) entry.dispose?.(entry.value);
    this.entries.clear();
    this.activeKey = null;
  }
}
