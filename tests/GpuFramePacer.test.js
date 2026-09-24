import { describe, expect, it, vi } from 'vitest';
import { GpuFramePacer } from '../src/engine/render/GpuFramePacer.js';
import { Engine } from '../src/engine/Engine.js';

describe('GPU frame pacing', () => {
  it('keeps camera controls moving without submitting GPU work under backpressure', () => {
    const engine = Object.create(Engine.prototype);
    Object.assign(engine, {
      _clock: { getDelta: () => 0.016 },
      profiler: { beginFrame: vi.fn(), setMetric: vi.fn(), endFrame: vi.fn() },
      _gpuFramePacer: { ready: () => false },
      controls: { update: vi.fn() },
      renderer: { render: vi.fn() },
    });
    engine._tickBody();
    expect(engine.controls.update).toHaveBeenCalledWith(0.016);
    expect(engine.renderer.render).not.toHaveBeenCalled();
    expect(engine._needsRender).toBe(true);
    expect(engine.profiler.endFrame).toHaveBeenCalled();
  });
  it('polls without blocking and permits another frame only after the fence signals', () => {
    const fence = {};
    const gl = { SYNC_GPU_COMMANDS_COMPLETE: 1, TIMEOUT_EXPIRED: 2,
      fenceSync: vi.fn(() => fence), clientWaitSync: vi.fn(() => 2), deleteSync: vi.fn(), flush: vi.fn() };
    const pacer = new GpuFramePacer(gl);
    expect(pacer.ready()).toBe(true);
    pacer.submitted();
    expect(pacer.ready()).toBe(false);
    expect(gl.clientWaitSync).toHaveBeenCalledWith(fence, 0, 0);
    expect(gl.deleteSync).not.toHaveBeenCalled();
    gl.clientWaitSync.mockReturnValue(3);
    expect(pacer.ready()).toBe(true);
    expect(gl.deleteSync).toHaveBeenCalledTimes(1);
    pacer.dispose();
    expect(gl.deleteSync).toHaveBeenCalledTimes(1);
  });
});
