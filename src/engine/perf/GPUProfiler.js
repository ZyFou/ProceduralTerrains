// ============================================================================
// GPUProfiler — optional, non-blocking whole-frame GPU timing.
//
// Uses WebGL2 EXT_disjoint_timer_query_webgl2 (or the WebGL1 extension if a
// WebGL1 context is ever used). Timer queries are ASYNCHRONOUS: we begin/end a
// TIME_ELAPSED query around the frame's GL work and read finished results on a
// later frame. We NEVER block waiting on a result and NEVER force a GPU sync.
//
// If the extension is unavailable the profiler reports `supported: false` and
// the overlay shows "GPU timing: unavailable on this browser/device".
// ============================================================================

const POOL_SIZE = 4;   // a few in-flight queries so we never stall the pipeline

export class GPUProfiler {
  constructor(renderer) {
    this.active = false;
    this.supported = false;
    this.gl = null;
    this.ext = null;
    this.isWebGL2 = false;

    this._pool = [];          // free query objects
    this._inflight = [];      // { query } awaiting a result
    this._open = null;        // currently-open query this frame
    this._lastMs = 0;
    this._disjoint = false;

    try {
      const gl = renderer.getContext();
      this.gl = gl;
      this.isWebGL2 = typeof WebGL2RenderingContext !== 'undefined'
        && gl instanceof WebGL2RenderingContext;
      if (this.isWebGL2) {
        this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      } else {
        this.ext = gl.getExtension('EXT_disjoint_timer_query');
      }
      this.supported = !!this.ext;
    } catch {
      this.supported = false;
    }
  }

  setActive(on) {
    this.active = !!on && this.supported;
    if (!this.active) this._cleanup();
  }

  _newQuery() {
    return this.isWebGL2 ? this.gl.createQuery() : this.ext.createQueryEXT();
  }

  _beginQuery(q) {
    const gl = this.gl;
    if (this.isWebGL2) gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    else this.ext.beginQueryEXT(this.ext.TIME_ELAPSED_EXT, q);
  }

  _endQuery() {
    const gl = this.gl;
    if (this.isWebGL2) gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    else this.ext.endQueryEXT(this.ext.TIME_ELAPSED_EXT);
  }

  _available(q) {
    const gl = this.gl;
    if (this.isWebGL2) return gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE);
    return this.ext.getQueryObjectEXT(q, this.ext.QUERY_RESULT_AVAILABLE_EXT);
  }

  _result(q) {
    const gl = this.gl;
    if (this.isWebGL2) return gl.getQueryParameter(q, gl.QUERY_RESULT);
    return this.ext.getQueryObjectEXT(q, this.ext.QUERY_RESULT_EXT);
  }

  // Call right before the frame's render work. Begins a query if one is free.
  frameBegin() {
    if (!this.active || this._open) return;
    // poll any finished queries first (cheap, non-blocking)
    this._poll();
    let q = this._pool.pop();
    if (!q) {
      if (this._inflight.length >= POOL_SIZE) return; // too many in flight; skip this frame
      q = this._newQuery();
    }
    if (!q) return;
    try { this._beginQuery(q); this._open = q; }
    catch { /* context lost / driver hiccup — drop silently */ this._open = null; }
  }

  // Call right after the frame's render work.
  frameEnd() {
    if (!this.active || !this._open) return;
    try { this._endQuery(); this._inflight.push(this._open); }
    catch { /* ignore */ }
    this._open = null;
  }

  _poll() {
    const gl = this.gl;
    // GPU_DISJOINT_EXT: if set, all in-flight timer results are unreliable.
    const disjoint = this.isWebGL2
      ? gl.getParameter(this.ext.GPU_DISJOINT_EXT)
      : gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    this._disjoint = !!disjoint;

    const still = [];
    for (const q of this._inflight) {
      let done = false;
      try { done = this._available(q); } catch { done = true; }
      if (done) {
        if (!this._disjoint) {
          try { this._lastMs = this._result(q) / 1e6; } catch { /* ignore */ }
        }
        if (this.isWebGL2) gl.deleteQuery(q); else this.ext.deleteQueryEXT(q);
      } else {
        still.push(q);
      }
    }
    this._inflight = still;
  }

  snapshot() {
    if (!this.supported) return { supported: false };
    return {
      supported: true,
      active: this.active,
      frameMs: this._lastMs,
      disjoint: this._disjoint,
    };
  }

  _cleanup() {
    const gl = this.gl;
    if (this._open) { try { this._endQuery(); } catch { /* ignore */ } this._open = null; }
    for (const q of this._inflight) {
      try { if (this.isWebGL2) gl.deleteQuery(q); else this.ext.deleteQueryEXT(q); } catch { /* ignore */ }
    }
    this._inflight = [];
    this._pool = [];
  }

  dispose() { this._cleanup(); }
}
