import { describe, it, expect, vi } from 'vitest';
import { createMinimapScale, drawMinimapScale, formatMapDistance } from '../src/engine/MinimapScale.js';
import { Minimap } from '../src/engine/Minimap.js';
import { MinimapPresenter } from '../src/engine/MinimapPresenter.js';

const view = { halfSpan: 1024, centerZ: 0 };
const reference = { bbox: { minLat: 45, maxLat: 46, minLon: 3, maxLon: 4 }, cellSize: 2048 };

describe('minimap distance scale', () => {
  it('uses geographic ground distance rather than the scaled 3D board dimensions', () => {
    const scale = createMinimapScale(view, reference);
    expect(scale.unit).toBe('m');
    expect(scale.label).toBe('20 km');
    expect(scale.spanLabel).toMatch(/^78\./);
    expect(scale.pixels).toBeGreaterThan(60);
    expect(scale.pixels).toBeLessThan(108);
    expect(formatMapDistance(500)).toBe('500 m');
    expect(formatMapDistance(1500)).toBe('1.5 km');
  });
  it('updates with zoom and latitude and includes expanded terrain coverage', () => {
    const full = createMinimapScale(view, reference);
    const zoomed = createMinimapScale({ ...view, halfSpan: 256 }, reference);
    expect(zoomed.distance).toBeLessThan(full.distance);
    const expanded = createMinimapScale({ ...view, halfSpan: 3072 }, reference);
    expect(expanded.distance).toBeGreaterThan(full.distance);
    const north = createMinimapScale(view, { ...reference, bbox: { ...reference.bbox, minLat: 60, maxLat: 61 } });
    expect(north.pixels / north.distance).toBeGreaterThan(full.pixels / full.distance);
  });
  it('uses world units for procedural terrain and rejects invalid spans', () => {
    expect(createMinimapScale(view, null).label).toBe('500 u');
    expect(createMinimapScale({ halfSpan: 0 }, null)).toBeNull();
    expect(createMinimapScale({ halfSpan: NaN }, null)).toBeNull();
  });
  it('draws the same ruler locally and through the worker presenter', () => {
    const context = Object.fromEntries(['save', 'restore', 'clearRect', 'fillRect', 'fillText', 'beginPath', 'moveTo', 'lineTo', 'stroke'].map((name) => [name, vi.fn()]));
    const scale = createMinimapScale(view, reference);
    drawMinimapScale(context, scale);
    expect(context.fillText).toHaveBeenCalledWith('20 km', expect.any(Number), 232);
    const presenter = new MinimapPresenter();
    presenter.overlayCanvas = { getContext: () => context };
    presenter._drawOverlay({ distanceScale: scale }, 256, 256);
    expect(context.fillText.mock.calls.filter(([text]) => text === '20 km')).toHaveLength(2);
    const map = new Minimap({}, {}, null, null);
    map.overlayCtx = context; map.setBoard(2048, 256); map.setSources({ getScaleReference: () => reference });
    map.drawOverlay(null);
    expect(context.fillText.mock.calls.filter(([text]) => text === '20 km')).toHaveLength(3);
    map.setConfig({ showDistanceScale: false }); map.drawOverlay(null);
    expect(context.fillText.mock.calls.filter(([text]) => text === '20 km')).toHaveLength(3);
    map.dispose();
  });
});
