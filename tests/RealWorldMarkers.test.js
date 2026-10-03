import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { normalizeMarkers } from '../src/engine/terrain/RealWorldMarkers.js';
import { RealWorldMarkerLayer } from '../src/engine/terrain/RealWorldMarkerLayer.js';
import { normalizeRealWorldSource } from '../src/engine/terrain/RealWorldSource.js';
import { Engine } from '../src/engine/Engine.js';
import { ENGINE_METHODS } from '../src/engine/EngineProxy.js';
import { parseCoordinateInput, formatCoordinateDisplay } from '../src/engine/terrain/RealWorldHeightmap.js';

describe('coordinate formats', () => {
  it('converts the Lambert 93 false origin using the IGN definition', () => {
    const point = parseCoordinateInput('700000, 6600000', 'lambert93');
    expect(point.lat).toBeCloseTo(46.5, 6);
    expect(point.lon).toBeCloseTo(3, 8);
    expect(formatCoordinateDisplay(point, 'lambert93')).toBe('700000.00, 6600000.00');
  });
  it('round trips Paris and rejects invalid projected inputs', () => {
    const paris = { lat: 48.8566, lon: 2.3522 };
    for (const format of ['lambert93', 'mercator', 'dms']) {
      const parsed = parseCoordinateInput(formatCoordinateDisplay(paris, format), format);
      expect(parsed.lat).toBeCloseTo(paris.lat, 5);
      expect(parsed.lon).toBeCloseTo(paris.lon, 5);
    }
    expect(parseCoordinateInput('700000, junk', 'lambert93')).toBeNull();
    expect(parseCoordinateInput('0, 0', 'lambert93')).toBeNull();
    expect(parseCoordinateInput('9999999999, 0', 'mercator')).toBeNull();
  });
});

describe('geographic markers', () => {
  const points = [{ id: 'a', name: 'A', lat: 46.5, lon: 3 }, { id: 'b', name: 'B', lat: 46.6, lon: 3.1 }];
  it('persists markers and valid routes through the geographic source', () => {
    const markers = normalizeMarkers({ points, markerSize: 150, labelSize: 75, routes: [{ id: 'r', from: 'a', to: 'b' }, { id: 'bad', from: 'a', to: 'missing' }] });
    const source = normalizeRealWorldSource({ bbox: { minLat: 46, maxLat: 47, minLon: 2, maxLon: 4 }, zoom: 12, markers });
    expect(normalizeRealWorldSource(JSON.parse(JSON.stringify(source))).markers).toEqual(markers);
    expect(markers.routes).toHaveLength(1);
    expect(normalizeMarkers(null).points).toEqual([]);
    expect(normalizeMarkers()).toMatchObject({ markerSize: 100, labelSize: 100 });
    expect(normalizeMarkers({ markerSize: -1, labelSize: 999 })).toMatchObject({ markerSize: 25, labelSize: 300 });
    expect(ENGINE_METHODS).toContain('setRealWorldMarkers');
  });
  it('anchors points above the terrain and routes to sampled heights', () => {
    const scene = new THREE.Scene(), layer = new RealWorldMarkerLayer(scene);
    const state = normalizeMarkers({ points, labels: false, lift: 40, routes: [{ id: 'r', from: 'a', to: 'b' }] });
    const options = { state, geo: { bbox0: { minLat: 46, maxLat: 47, minLon: 2, maxLon: 4 }, zoom: 12 }, cellSize: 1000, tiles: [{ cx: 0, cz: 0 }], sampleHeight: () => 123, visible: true };
    layer.rebuild(options);
    expect(layer.group.children.filter((c) => c.isMesh)).toHaveLength(2);
    expect(layer.group.children[0].position.y).toBe(163);
    const route = layer.group.children.at(-1);
    expect(route.geometry.attributes.position.count).toBe(257);
    expect(route.geometry.attributes.position.getY(0)).toBeCloseTo(127.8, 4);
    layer.rebuild({ ...options, state: { ...state, points: [...state.points, { id: 'off', name: 'Outside', lat: 0, lon: 0, visible: true }] } });
    expect(layer.group.children.filter((c) => c.isMesh)).toHaveLength(2);
    layer.dispose(); expect(scene.children).toHaveLength(0);
  });
  it('updates source metadata when editing markers', () => {
    const engine = Object.create(Engine.prototype);
    engine.cb = {}; engine.realWorldSource = {}; engine._rebuildRealWorldMarkers = () => {};
    engine.setRealWorldMarkers({ points });
    expect(engine.realWorldSource.markers.points).toHaveLength(2);
  });
  it('fits readable labels to names and keeps their screen size and color stable', () => {
    const context = { measureText: (name) => ({ width: name.length * 15 }), scale: vi.fn(), clearRect: vi.fn(),
      beginPath: vi.fn(), roundRect: vi.fn(), fill: vi.fn(), stroke: vi.fn(), fillText: vi.fn() };
    vi.stubGlobal('OffscreenCanvas', class { getContext() { return context; } });
    const layer = new RealWorldMarkerLayer(new THREE.Scene());
    try {
      layer.rebuild({ state: normalizeMarkers({ points: [points[0], { ...points[1], name: 'Saint-Martin-de-Belleville' }] }),
        geo: { bbox0: { minLat: 46, maxLat: 47, minLon: 2, maxLon: 4 }, zoom: 12 },
        cellSize: 1000, tiles: [{ cx: 0, cz: 0 }], sampleHeight: () => 123, visible: true });
      const labels = layer.pickTargets.filter((object) => object.isSprite);
      expect(labels[0].scale.x).toBeLessThan(labels[1].scale.x);
      expect(labels[0].scale.y).toBe(labels[1].scale.y);
      expect(labels[0].material.sizeAttenuation).toBe(false);
      expect(labels[0].material.toneMapped).toBe(false);
      expect(labels[0].material.depthWrite).toBe(false);
      expect(context.roundRect).toHaveBeenCalledTimes(2);
      layer.select('a'); expect(labels[0].material.color.getHexString()).toBe('69d7ff');
      layer.select(null); expect(labels[0].material.color.getHexString()).toBe('ffffff');
      const originalRadius = layer.pickTargets[0].geometry.parameters.radius;
      const originalLabelHeight = labels[0].scale.y;
      layer.rebuild({ state: normalizeMarkers({ points: [points[0]], markerSize: 200, labelSize: 150 }),
        geo: { bbox0: { minLat: 46, maxLat: 47, minLon: 2, maxLon: 4 }, zoom: 12 },
        cellSize: 1000, tiles: [{ cx: 0, cz: 0 }], sampleHeight: () => 123, visible: true });
      expect(layer.pickTargets[0].geometry.parameters.radius).toBeCloseTo(originalRadius * 2);
      expect(layer.pickTargets[1].scale.y).toBeCloseTo(originalLabelHeight * 1.5);
    } finally { layer.dispose(); vi.unstubAllGlobals(); }
  });
});
