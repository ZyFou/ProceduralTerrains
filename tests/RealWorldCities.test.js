import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { parseCityMarkers, fetchCityMarkers } from '../src/engine/terrain/RealWorldCities.js';
import { normalizeMarkers } from '../src/engine/terrain/RealWorldMarkers.js';
import { RealWorldMarkerLayer } from '../src/engine/terrain/RealWorldMarkerLayer.js';
import { Engine } from '../src/engine/Engine.js';

const bbox = { minLat: 46, maxLat: 47, minLon: 2, maxLon: 4 };
const node = (id, name, place = 'city', lat = 46.5, lon = 3) => ({ type: 'node', id, lat, lon, tags: { name, place } });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('automatic city markers', () => {
  it('prioritizes named settlements, deduplicates and rejects out-of-area nodes', () => {
    const points = parseCityMarkers({ elements: [node(1, 'Village', 'village'), node(2, 'City'), node(3, 'City'), node(4, 'Outside', 'city', 0), node(5, 'Mountain', 'peak')] }, bbox);
    expect(points.map((p) => p.name)).toEqual(['City', 'Village']);
    expect(points[0]).toMatchObject({ id: 'city/node/2', source: 'city', lat: 46.5, lon: 3 });
    expect(parseCityMarkers({ elements: Array.from({ length: 300 }, (_, id) => node(id, `City ${id}`)) }, bbox)).toHaveLength(200);
    expect(() => parseCityMarkers({ remark: 'timeout' }, bbox)).toThrow();
  });
  it('requests a bounded query and retries the second service after failure', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce({ ok: true, json: async () => ({ elements: [node(10, 'City')] }) });
    vi.stubGlobal('fetch', fetch);
    const points = await fetchCityMarkers(bbox);
    expect(points).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    const query = fetch.mock.calls[0][1].body.get('data');
    expect(query).toContain('(46,2,47,4)'); expect(query).toContain('city|town|village');
    await fetchCityMarkers(bbox); expect(fetch).toHaveBeenCalledTimes(2);
    await expect(fetchCityMarkers({ ...bbox, minLat: NaN })).rejects.toThrow('Invalid city search area');
  });
  it('preserves manual edits made while fetching and ignores a retired terrain', async () => {
    const replies = [];
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => replies.push(resolve))));
    const geo = { bbox0: { ...bbox, minLon: 2.1 } };
    const engine = Object.create(Engine.prototype);
    Object.assign(engine, { worldMode: 'studio', realWorldMarkers: normalizeMarkers({ autoCities: true }), realWorldSource: {}, importedMaps: { height: { geoRef: geo } }, tiles: [{ cx: 0, cz: 0 }], cb: {}, _rebuildRealWorldMarkers: vi.fn() });
    const pending = engine.refreshCityMarkers();
    engine.realWorldMarkers.points.push({ id: 'manual', name: 'Manual', lat: 46.5, lon: 3, visible: true });
    replies[0]({ ok: true, json: async () => ({ elements: [node(12, 'Fetched city')] }) });
    await pending;
    expect(engine.realWorldMarkers.points.map((p) => p.name)).toEqual(['Manual', 'Fetched city']);
    const oldPending = engine.refreshCityMarkers();
    // Cached response is still asynchronous; switching terrain must reject it.
    engine.importedMaps.height.geoRef = { bbox0: bbox };
    await oldPending;
    expect(engine._rebuildRealWorldMarkers).toHaveBeenCalledTimes(1);
  });
  it('reports service timeouts clearly and cancels without a fallback request', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
    vi.stubGlobal('fetch', fetch);
    const area = { ...bbox, minLon: 2.23 };
    const failure = expect(fetchCityMarkers(area)).rejects.toThrow('City service timed out');
    await vi.advanceTimersByTimeAsync(50001); await failure;
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch.mockClear();
    const controller = new AbortController();
    const cancelled = expect(fetchCityMarkers(area, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await cancelled;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('hides automatic points when disabled and raycasts visible marker targets', () => {
    const layer = new RealWorldMarkerLayer(new THREE.Scene());
    const state = normalizeMarkers({ autoCities: true, labels: false, points: parseCityMarkers({ elements: [node(21, 'City')] }, bbox) });
    const options = { state, geo: { bbox0: bbox, zoom: 12 }, cellSize: 1000, tiles: [{ cx: 0, cz: 0 }], sampleHeight: () => 0, visible: true };
    layer.rebuild(options);
    const dot = layer.pickTargets[0];
    const ray = new THREE.Raycaster(new THREE.Vector3(dot.position.x, 200, dot.position.z), new THREE.Vector3(0, -1, 0));
    expect(layer.pick(ray)).toBe('city/node/21');
    layer.select('city/node/21'); expect(dot.material.color.getHexString()).toBe('69d7ff');
    layer.rebuild({ ...options, state: { ...state, autoCities: false } });
    expect(layer.pick(ray)).toBeNull(); layer.dispose();
  });
});

describe('routes by clicking markers', () => {
  function engineForRoute() {
    const engine = Object.create(Engine.prototype);
    Object.assign(engine, { worldMode: 'studio', realWorldSource: {}, cb: {}, realWorldMarkerLayer: { select: vi.fn() }, realWorldMarkers: normalizeMarkers({ points: ['a', 'b'].map((id) => ({ id, name: id, lat: 46.5, lon: 3 })) }), _rebuildRealWorldMarkers: vi.fn() });
    return engine;
  }
  it('creates a persisted route after two selections, without duplicates or self routes', () => {
    const engine = engineForRoute();
    engine.setMarkerRoutePicking(true); engine.selectMarkerForRoute('a');
    expect(engine._markerRouteFrom).toBe('a'); expect(engine.realWorldMarkers.routes).toHaveLength(0);
    engine.selectMarkerForRoute('b');
    expect(engine.realWorldSource.markers.routes[0]).toMatchObject({ from: 'a', to: 'b' });
    expect(engine._markerRouteFrom).toBeNull();
    engine.selectMarkerForRoute('b'); engine.selectMarkerForRoute('a');
    expect(engine.realWorldMarkers.routes).toHaveLength(1);
    engine.selectMarkerForRoute('a'); engine.selectMarkerForRoute('a');
    expect(engine._markerRouteFrom).toBeNull();
    engine.setMarkerRoutePicking(false); engine.selectMarkerForRoute('a'); expect(engine._markerRouteFrom).toBeNull();
  });
  it('treats drags as camera movement and only routes on a marker click', () => {
    const engine = engineForRoute();
    Object.assign(engine, { canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) }, camera: new THREE.PerspectiveCamera(), _tileRay: new THREE.Raycaster(), _tilePointer: new THREE.Vector2() });
    engine.realWorldMarkerLayer.pick = vi.fn(() => 'a');
    engine.setMarkerRoutePicking(true);
    engine._tilePointerDown({ button: 0, clientX: 50, clientY: 50 });
    engine._tilePointerUp({ button: 0, clientX: 80, clientY: 50 });
    expect(engine.realWorldMarkerLayer.pick).not.toHaveBeenCalled();
    engine._tilePointerDown({ button: 0, clientX: 50, clientY: 50 });
    engine._tilePointerUp({ button: 0, clientX: 50, clientY: 50 });
    expect(engine._markerRouteFrom).toBe('a');
  });
});
