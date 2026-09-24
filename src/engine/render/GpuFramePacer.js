// A worker has its own JS thread, but still shares the browser's GPU queue.
// Poll fences without waiting so input stays serviceable when a frame is slow.
export class GpuFramePacer {
  constructor(gl) {
    this.gl = gl;
    this.fence = null;
  }

  ready() {
    if (!this.fence) return true;
    const gl = this.gl;
    const status = gl.clientWaitSync(this.fence, 0, 0);
    if (status === gl.TIMEOUT_EXPIRED) return false;
    this.dispose();
    return true;
  }

  submitted() {
    const gl = this.gl;
    if (!gl?.fenceSync || !gl?.clientWaitSync || gl.isContextLost?.()) return;
    this.dispose();
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
  }

  dispose() {
    if (this.fence) this.gl.deleteSync(this.fence);
    this.fence = null;
  }
}
