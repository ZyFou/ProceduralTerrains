import { describe, expect, it, vi } from 'vitest';
import { ManualTerrainModeManager } from '../src/manual/ManualTerrainModeManager.js';

function createManager(mode) {
  return Object.assign(Object.create(ManualTerrainModeManager.prototype), {
    enabled: true,
    workspaceActive: true,
    sculpt: { enabled: mode === 'sculpt', tool: 'raise' },
    texturePaint: { enabled: mode === 'surface', mode: 'surface', tool: 'paint' },
    transform: { axis: null },
    _sculpting: false,
    _surfacePainting: false,
    _surfaceRevision: 0,
    picker: { pickEvent: () => ({ x: 10, z: 20 }) },
    _updateSculptHit: vi.fn(),
    _updateSurfaceHit: vi.fn(),
    _stampSculpt: vi.fn(),
    _stampSurface: vi.fn(),
    _emit: vi.fn(),
    onStableAction: vi.fn(),
  });
}

describe.each(['sculpt', 'surface'])('Manual %s pointer interaction', (mode) => {
  it('only applies the selected brush during a left-button stroke', () => {
    const manager = createManager(mode);
    const stamp = mode === 'sculpt' ? manager._stampSculpt : manager._stampSurface;
    manager._handlePointerMove({ buttons: 0 });
    expect(stamp).not.toHaveBeenCalled();
    manager._handlePointerDown({ button: 0, preventDefault() {}, stopPropagation() {} });
    manager._handlePointerMove({ buttons: 1 });
    expect(stamp).toHaveBeenCalledTimes(2);
    manager._handlePointerUp();
    manager._handlePointerMove({ buttons: 0 });
    expect(stamp).toHaveBeenCalledTimes(2);
    expect(manager.onStableAction).toHaveBeenCalledTimes(1);
  });

  it.each([0, 2])('ends a missed release before moving with buttons=%s', (buttons) => {
    const manager = createManager(mode);
    const stamp = mode === 'sculpt' ? manager._stampSculpt : manager._stampSurface;
    manager._handlePointerDown({ button: 0, preventDefault() {}, stopPropagation() {} });
    manager._handlePointerMove({ buttons });
    manager._handlePointerMove({ buttons: 1 });
    expect(stamp).toHaveBeenCalledTimes(1);
    expect(manager._sculpting).toBe(false);
    expect(manager._surfacePainting).toBe(false);
    expect(manager.onStableAction).toHaveBeenCalledTimes(1);
  });
});
