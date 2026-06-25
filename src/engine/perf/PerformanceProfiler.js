// ============================================================================
// PerformanceProfiler — centralized, lightweight engine diagnostics.
//
// One shared instance (`profiler`) collects per-frame timing, renderer stats,
// arbitrary metrics and loading-task state so the Performance Overlay can read
// a single snapshot instead of scattered booleans and ad-hoc timers.
//
// Design rules (see TASK):
//  - Cheap when the overlay is CLOSED: only frame time + FPS are tracked, with
//    a couple of fixed rolling buffers (no allocations per frame, no history
//    arrays that grow). Detailed section timers and renderer.info capture only
//    run while `active` (overlay open).
//  - No console spam, no forced GPU sync (GPU timing lives in GPUProfiler and
//    is polled, never awaited).
//  - The hot-path methods (`beginFrame`/`endFrame`/`begin`/`end`) must stay
//    allocation-free; `snapshot()` (called ~5 Hz from the UI) may allocate.
// ============================================================================

const SHORT_WINDOW = 60;    // frames for the short rolling average (~1 s @60fps)
const FPS_WINDOW = 30;      // frames used to derive a smoothed FPS number

// Small fixed-size rolling statistic. Stores the last `size` samples in a ring
// and keeps current/avg/min/max without ever growing memory.
class RollingStat {
  constructor(size = SHORT_WINDOW) {
    this.size = size;
    this.buf = new Float64Array(size);
    this.i = 0;
    this.count = 0;
    this.cur = 0;
    this.last = 0;        // last value (for "current")
    this.spike = 0;       // max seen since the last snapshot read (transient)
  }

  push(v) {
    this.buf[this.i] = v;
    this.i = (this.i + 1) % this.size;
    if (this.count < this.size) this.count++;
    this.cur = v;
    if (v > this.spike) this.spike = v;
  }

  get avg() {
    if (!this.count) return 0;
    let s = 0;
    for (let k = 0; k < this.count; k++) s += this.buf[k];
    return s / this.count;
  }

  get min() {
    if (!this.count) return 0;
    let m = Infinity;
    for (let k = 0; k < this.count; k++) if (this.buf[k] < m) m = this.buf[k];
    return m;
  }

  get max() {
    if (!this.count) return 0;
    let m = -Infinity;
    for (let k = 0; k < this.count; k++) if (this.buf[k] > m) m = this.buf[k];
    return m;
  }

  reset() {
    this.buf.fill(0);
    this.i = 0;
    this.count = 0;
    this.cur = 0;
    this.spike = 0;
  }
}

class PerformanceProfiler {
  constructor() {
    // `active` = the overlay is open, so collect the detailed (slightly more
    // expensive) data. When false only the always-on frame/FPS stats run.
    this.active = false;

    this.frame = new RollingStat(SHORT_WINDOW);   // full-frame CPU time (ms)
    this.fpsBuf = new RollingStat(FPS_WINDOW);     // instantaneous fps samples

    this.sections = new Map();   // name -> { stat, _start }
    this.metrics = Object.create(null);

    this.tasks = new Map();      // id -> task object
    this._taskSeq = 0;

    this._frameStart = 0;
    this._lastNow = 0;

    // renderer.info mirror, refreshed each active frame
    this.render = {
      calls: 0, triangles: 0, points: 0, lines: 0,
      geometries: 0, textures: 0, programs: 0,
    };

    // optional GPU timer (set by the engine if supported)
    this.gpu = null;             // GPUProfiler instance or null
  }

  setActive(on) {
    this.active = !!on;
    if (this.gpu) this.gpu.setActive(this.active);
  }

  // -------------------------------------------------------------- frame timing

  beginFrame(now) {
    this._frameStart = now;
    if (this._lastNow) {
      const dtMs = now - this._lastNow;
      if (dtMs > 0 && dtMs < 1000) this.fpsBuf.push(1000 / dtMs);
    }
    this._lastNow = now;
  }

  endFrame() {
    if (!this._frameStart) return;
    const ms = performance.now() - this._frameStart;
    this.frame.push(ms);
    this._frameStart = 0;
  }

  // ------------------------------------------------------------- section timers
  // No-ops unless the overlay is open, so closed-overlay overhead is one branch.

  _section(name) {
    let s = this.sections.get(name);
    if (!s) { s = { stat: new RollingStat(SHORT_WINDOW), _start: 0 }; this.sections.set(name, s); }
    return s;
  }

  begin(name) {
    if (!this.active) return;
    this._section(name)._start = performance.now();
  }

  end(name) {
    if (!this.active) return;
    const s = this.sections.get(name);
    if (!s || !s._start) return;
    s.stat.push(performance.now() - s._start);
    s._start = 0;
  }

  measure(name, fn) {
    if (!this.active) return fn();
    this.begin(name);
    try { return fn(); } finally { this.end(name); }
  }

  // --------------------------------------------------------------- metrics

  setMetric(name, value) { this.metrics[name] = value; }
  getMetric(name) { return this.metrics[name]; }
  incrementMetric(name, by = 1) { this.metrics[name] = (this.metrics[name] || 0) + by; }

  // --------------------------------------------------------- renderer capture

  captureRenderer(renderer) {
    if (!this.active || !renderer) return;
    const info = renderer.info;
    const r = info.render;
    const m = info.memory;
    this.render.calls = r.calls;
    this.render.triangles = r.triangles;
    this.render.points = r.points;
    this.render.lines = r.lines;
    this.render.geometries = m.geometries;
    this.render.textures = m.textures;
    this.render.programs = info.programs ? info.programs.length : 0;
  }

  // ----------------------------------------------------------- loading tasks
  // A central place engine systems can report long async work so the overlay
  // can show "what is currently happening" instead of an apparent freeze.

  registerLoadingTask(task = {}) {
    const id = task.id || `task-${++this._taskSeq}`;
    this.tasks.set(id, {
      id,
      name: task.name || 'Working…',
      status: task.status || 'running',
      progress: task.progress ?? null,
      details: task.details || '',
      error: null,
      started: performance.now(),
      ended: null,
    });
    return id;
  }

  updateLoadingTask(id, progress, details) {
    const t = this.tasks.get(id);
    if (!t) return;
    if (progress != null) t.progress = progress;
    if (details != null) t.details = details;
    t.status = 'running';
  }

  finishLoadingTask(id) {
    const t = this.tasks.get(id);
    if (!t) return;
    t.status = 'done';
    t.ended = performance.now();
    // keep "done" tasks briefly so the overlay can show completion, then drop
    setTimeout(() => { const x = this.tasks.get(id); if (x && x.status === 'done') this.tasks.delete(id); }, 2500);
  }

  failLoadingTask(id, error) {
    const t = this.tasks.get(id);
    if (!t) return;
    t.status = 'failed';
    t.error = (error && error.message) || String(error || 'failed');
    t.ended = performance.now();
    setTimeout(() => { const x = this.tasks.get(id); if (x && x.status === 'failed') this.tasks.delete(id); }, 6000);
  }

  // --------------------------------------------------------------- snapshot
  // Called ~5 Hz by the UI. Builds a fresh plain object (allocations OK here).

  snapshot() {
    const now = performance.now();
    const sections = [];
    for (const [name, s] of this.sections) {
      if (!s.stat.count) continue;
      sections.push({
        name,
        cur: s.stat.cur,
        avg: s.stat.avg,
        min: s.stat.min,
        max: s.stat.max,
      });
    }
    sections.sort((a, b) => b.avg - a.avg);

    const tasks = [];
    for (const t of this.tasks.values()) {
      tasks.push({
        ...t,
        elapsed: (t.ended || now) - t.started,
      });
    }

    let gpu = null;
    if (this.gpu) gpu = this.gpu.snapshot();

    return {
      time: now,
      fps: Math.round(this.fpsBuf.avg),
      fpsAvg: Math.round(this.fpsBuf.avg),
      frame: {
        cur: this.frame.cur,
        avg: this.frame.avg,
        min: this.frame.min,
        max: this.frame.max,
      },
      sections,
      render: { ...this.render },
      gpu,
      memory: readMemory(),
      metrics: { ...this.metrics },
      tasks,
    };
  }
}

// ------------------------------------------------------- memory feature detect

function readMemory() {
  // performance.memory exists only in Chromium-based browsers. Never assume it.
  const pm = (typeof performance !== 'undefined' && performance.memory) || null;
  if (!pm) return { supported: false };
  return {
    supported: true,
    usedJSHeap: pm.usedJSHeapSize,
    totalJSHeap: pm.totalJSHeapSize,
    jsHeapLimit: pm.jsHeapSizeLimit,
  };
}

// Single shared instance for the whole engine + UI.
export const profiler = new PerformanceProfiler();
export { PerformanceProfiler };
