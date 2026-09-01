const abortError = () => Object.assign(new Error('GPU work was cancelled'), { code: 'GPU_WORK_CANCELLED' });

export class GpuWorkScheduler {
  constructor({ yieldTask = () => Promise.resolve(), maxConcurrent = 1 } = {}) {
    this.yieldTask = yieldTask;
    this.maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
    this.queue = [];
    this.inFlight = 0;
    this.jobs = new Map();
    this.disposed = false;
  }

  schedule(key, run, { signal } = {}) {
    if (this.disposed) return Promise.reject(abortError());
    if (key && this.jobs.has(key)) return this.jobs.get(key);
    const promise = new Promise((resolve, reject) => {
      const job = { key, run, signal, resolve, reject };
      if (signal?.aborted) reject(abortError());
      else {
        this.queue.push(job);
        this._drain();
      }
    }).finally(() => { if (key && this.jobs.get(key) === promise) this.jobs.delete(key); });
    if (key) this.jobs.set(key, promise);
    return promise;
  }

  async _run(job) {
    try {
      if (job.signal?.aborted || this.disposed) throw abortError();
      await this.yieldTask();
      if (job.signal?.aborted || this.disposed) throw abortError();
      job.resolve(await job.run());
    } catch (error) {
      job.reject(error);
    } finally {
      this.inFlight -= 1;
      this._drain();
    }
  }

  _drain() {
    while (!this.disposed && this.inFlight < this.maxConcurrent && this.queue.length) {
      const job = this.queue.shift();
      this.inFlight += 1;
      void this._run(job);
    }
  }

  cancelPending() {
    const jobs = this.queue.splice(0);
    jobs.forEach((job) => job.reject(abortError()));
  }

  dispose() {
    this.disposed = true;
    this.cancelPending();
    this.jobs.clear();
  }
}
