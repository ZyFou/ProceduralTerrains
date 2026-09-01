import { describe, expect, it, vi } from 'vitest';
import { PreparedModeBundle, SharedResourceRegistry } from '../src/engine/mode/PreparedModeBundle.js';

describe('PreparedModeBundle', () => {
  it('publishes only after validation and disposes owned resources exactly once', () => {
    const dispose = vi.fn();
    const resource = { dispose };
    const bundle = new PreparedModeBundle({ key: 'studio:1', worldMode: 'studio' });
    bundle.own('terrain', resource);
    expect(() => bundle.publish()).toThrow(/validated/i);
    bundle.validate({ ok: true }).publish();
    expect(bundle.state).toBe('active');
    bundle.dispose();
    bundle.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('reference-counts shared resources across parked bundles', () => {
    const dispose = vi.fn();
    const shared = {};
    const registry = new SharedResourceRegistry();
    const first = new PreparedModeBundle({ key: 'a', registry });
    const second = new PreparedModeBundle({ key: 'b', registry });
    first.own('modules', shared, { shared: true, dispose });
    second.own('modules', shared, { shared: true, dispose });
    expect(registry.refCount(shared)).toBe(2);
    first.dispose();
    expect(dispose).not.toHaveBeenCalled();
    second.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('rejects invalid bundles before publication', () => {
    const bundle = new PreparedModeBundle({ key: 'invalid' });
    expect(() => bundle.validate({ ok: false })).toThrow(/validation failed/i);
    expect(bundle.state).toBe('preparing');
  });
});
