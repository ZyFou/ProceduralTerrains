import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputFrameBridge } from '../src/engine/InputFrameBridge.js';

class FakeCanvas extends EventTarget {
  constructor() {
    super();
    this.setPointerCapture = vi.fn();
    this.releasePointerCapture = vi.fn();
    this.parentElement = {
      getBoundingClientRect: () => ({ width: 800, height: 600 }),
    };
  }
}

afterEach(() => vi.unstubAllGlobals());

function installBrowserGlobals() {
  const fakeDocument = new EventTarget();
  fakeDocument.visibilityState = 'visible';
  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  return fakeDocument;
}

function pointerEvent(type, properties) {
  return Object.assign(new Event(type, { cancelable: true }), properties);
}

describe('InputFrameBridge', () => {
  it('prevents the native context menu on the worker-backed viewport', () => {
    const canvas = new FakeCanvas();
    installBrowserGlobals();

    const bridge = new InputFrameBridge({ canvas, send: vi.fn() });
    const contextMenu = new Event('contextmenu', { cancelable: true });

    expect(canvas.dispatchEvent(contextMenu)).toBe(false);
    expect(contextMenu.defaultPrevented).toBe(true);

    bridge.dispose();
    const afterDispose = new Event('contextmenu', { cancelable: true });
    expect(canvas.dispatchEvent(afterDispose)).toBe(true);
    expect(afterDispose.defaultPrevented).toBe(false);
  });

  it('keeps a right-drag captured and suppresses its menu over an overlay', () => {
    const canvas = new FakeCanvas();
    const fakeDocument = installBrowserGlobals();
    const bridge = new InputFrameBridge({ canvas, send: vi.fn() });

    const down = pointerEvent('pointerdown', {
      button: 2,
      buttons: 2,
      pointerId: 7,
      pointerType: 'mouse',
      clientX: 500,
      clientY: 300,
    });
    canvas.dispatchEvent(down);
    canvas.dispatchEvent(pointerEvent('pointerup', {
      button: 2,
      buttons: 0,
      pointerId: 7,
      pointerType: 'mouse',
      clientX: 650,
      clientY: 420,
    }));

    expect(down.defaultPrevented).toBe(true);
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(7);
    expect(canvas.releasePointerCapture).toHaveBeenCalledWith(7);

    const overlayContextMenu = new Event('contextmenu', { cancelable: true });
    expect(fakeDocument.dispatchEvent(overlayContextMenu)).toBe(false);
    expect(overlayContextMenu.defaultPrevented).toBe(true);

    bridge.dispose();
  });
});
