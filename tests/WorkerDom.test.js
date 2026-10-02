import { describe, expect, it, vi } from 'vitest';
import { WorkerCanvasFacade, createWorkerDom } from '../src/engine/WorkerDom.js';

function workerDom() {
  const canvas = new WorkerCanvasFacade({ width: 800, height: 600 }, { width: 800, height: 600 });
  const { windowTarget, documentTarget } = createWorkerDom(canvas);
  return { canvas, windowTarget, documentTarget };
}

describe('render worker DOM stand-ins', () => {
  it('bubbles a canvas pointerup to window so paint strokes can end', () => {
    // ManualTerrainModeManager / PaintModeManager end strokes on a window
    // pointerup; in the worker the bridge dispatches it on the canvas only.
    const { canvas, windowTarget } = workerDom();
    const onUp = vi.fn();
    windowTarget.addEventListener('pointerup', onUp);
    canvas.dispatchTerrainEvent('pointerup', { button: 0, pointerId: 1 });
    expect(onUp).toHaveBeenCalledTimes(1);
    expect(onUp.mock.calls[0][0].target).toBe(canvas);
    expect(onUp.mock.calls[0][0].currentTarget).toBe(windowTarget);
  });

  it('runs capture listeners outside-in, then target, then bubble inside-out', () => {
    const { canvas, windowTarget, documentTarget } = workerDom();
    const order = [];
    windowTarget.addEventListener('pointerdown', () => order.push('window-capture'), true);
    documentTarget.addEventListener('pointerdown', () => order.push('document-capture'), { capture: true });
    canvas.addEventListener('pointerdown', () => order.push('canvas'));
    documentTarget.addEventListener('pointerdown', () => order.push('document-bubble'));
    windowTarget.addEventListener('pointerdown', () => order.push('window-bubble'));
    canvas.dispatchTerrainEvent('pointerdown');
    expect(order).toEqual(['window-capture', 'document-capture', 'canvas', 'document-bubble', 'window-bubble']);
  });

  it('honours stopPropagation and does not bubble pointerleave', () => {
    const { canvas, windowTarget } = workerDom();
    const onWindow = vi.fn();
    const sibling = vi.fn();
    windowTarget.addEventListener('pointerdown', onWindow);
    windowTarget.addEventListener('pointerleave', onWindow);
    canvas.addEventListener('pointerdown', (event) => event.stopPropagation());
    canvas.addEventListener('pointerdown', sibling);
    canvas.dispatchTerrainEvent('pointerdown');
    canvas.dispatchTerrainEvent('pointerleave');
    expect(sibling).toHaveBeenCalledTimes(1);
    expect(onWindow).not.toHaveBeenCalled();
  });

  it('removes listeners by capture flag and keeps a forwarded key target', () => {
    const { documentTarget, windowTarget } = workerDom();
    const onKey = vi.fn();
    windowTarget.addEventListener('keydown', onKey, true);
    windowTarget.removeEventListener('keydown', onKey);
    documentTarget.dispatchTerrainEvent('keydown', { key: 'Delete', target: { tagName: 'INPUT' } });
    expect(onKey).toHaveBeenCalledTimes(1);
    expect(onKey.mock.calls[0][0].target.tagName).toBe('INPUT');
    windowTarget.removeEventListener('keydown', onKey, true);
    documentTarget.dispatchTerrainEvent('keydown', { key: 'Delete' });
    expect(onKey).toHaveBeenCalledTimes(1);
  });
});
