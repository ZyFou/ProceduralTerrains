import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  bboxDimensionsKm,
  buildingDimensions,
  fetchBboxBuildings,
  geoPointToCellWorld,
  parseOverpassBuildings,
} from '../src/engine/terrain/RealWorldBuildings.js';
import { RealWorldBuildingLayer } from '../src/engine/terrain/RealWorldBuildingLayer.js';

describe('real-world OSM buildings', () => {
  const ringFor = (id = 0) => [
    { lat: 45 + id * 1e-9, lon: 6 },
    { lat: 45 + id * 1e-9, lon: 6.001 },
    { lat: 45.001 + id * 1e-9, lon: 6.001 },
    { lat: 45 + id * 1e-9, lon: 6 },
  ];

  it('derives metric heights from explicit values and levels', () => {
    expect(buildingDimensions({ height: '12.5 m', min_height: '3 m' })).toMatchObject({
      height: 12.5,
      minHeight: 3,
    });
    expect(buildingDimensions({ 'building:levels': '4', 'building:min_level': '1' })).toMatchObject({
      height: 12,
      minHeight: 3,
      levels: 4,
    });
    expect(buildingDimensions({ height: '30 ft' }).height).toBeCloseTo(9.144, 3);
  });

  it('parses closed ways and relation outer rings', () => {
    const ring = [
      { lat: 46, lon: 7 },
      { lat: 46, lon: 7.001 },
      { lat: 46.001, lon: 7.001 },
      { lat: 46, lon: 7 },
    ];
    const buildings = parseOverpassBuildings({ elements: [
      { type: 'way', id: 10, tags: { building: 'house', 'building:levels': '2' }, geometry: ring },
      { type: 'relation', id: 20, tags: { building: 'yes', height: '15' }, members: [
        { type: 'way', ref: 21, role: 'outer', geometry: ring },
        { type: 'way', ref: 22, role: 'inner', geometry: ring },
      ] },
    ] });
    expect(buildings).toHaveLength(2);
    expect(buildings[0].ring).toHaveLength(3);
    expect(buildings[0].height).toBe(6);
    expect(buildings[1].height).toBe(15);
  });

  it('maps bbox corners to the same world-cell orientation as imagery', () => {
    const bbox = { minLat: 45, maxLat: 46, minLon: 6, maxLon: 7 };
    const northWest = geoPointToCellWorld({ lat: 46, lon: 6 }, bbox, 12, 0, 0, 2000);
    const southEast = geoPointToCellWorld({ lat: 45, lon: 7 }, bbox, 12, 0, 0, 2000);
    expect(northWest.x).toBeCloseTo(-1000, 6);
    expect(northWest.z).toBeCloseTo(-1000, 6);
    expect(southEast.x).toBeCloseTo(1000, 6);
    expect(southEast.z).toBeCloseTo(1000, 6);
  });

  it('estimates a finite physical bbox size', () => {
    const size = bboxDimensionsKm({ minLat: 45, maxLat: 45.1, minLon: 6, maxLon: 6.1 });
    expect(size.width).toBeGreaterThan(7);
    expect(size.height).toBeGreaterThan(11);
    expect(size.area).toBeGreaterThan(70);
  });

  it('fails over to another Overpass instance after a busy response', async () => {
    const originalFetch = globalThis.fetch;
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ elements: [{
          type: 'way', id: 1, tags: { building: 'yes' }, geometry: ringFor(),
        }] }),
      });
    globalThis.fetch = fetchMock;
    try {
      const pending = fetchBboxBuildings({ minLat: 45, maxLat: 45.01, minLon: 6, maxLon: 6.01 });
      await vi.advanceTimersByTimeAsync(400);
      const result = await pending;
      expect(result.buildings).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).not.toBe(fetchMock.mock.calls[1][0]);
    } finally {
      globalThis.fetch = originalFetch;
      vi.useRealTimers();
    }
  });

  it('subdivides a saturated dense-city response instead of accepting a rectangular cutoff', async () => {
    const originalFetch = globalThis.fetch;
    const saturated = Array.from({ length: 6001 }, (_, index) => ({
      type: 'way',
      id: index + 1,
      tags: { building: 'yes' },
      geometry: ringFor(index),
    }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ elements: saturated }) });
    for (let index = 0; index < 4; index++) {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ elements: [{
          type: 'way',
          id: 10000 + index,
          tags: { building: 'yes' },
          geometry: ringFor(index),
        }] }),
      });
    }
    globalThis.fetch = fetchMock;
    try {
      const result = await fetchBboxBuildings({ minLat: 45, maxLat: 45.02, minLon: 6, maxLon: 6.02 });
      expect(result.subdivided).toBe(true);
      expect(result.truncated).toBe(false);
      expect(result.buildings).toHaveLength(4);
      expect(fetchMock).toHaveBeenCalledTimes(5);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('extrudes fetched footprints into one merged scene mesh', () => {
    const scene = new THREE.Scene();
    const layer = new RealWorldBuildingLayer(scene);
    const bbox = { minLat: 45, maxLat: 45.01, minLon: 6, maxLon: 6.01 };
    const count = layer.rebuild({
      cells: { '0,0': { buildings: [{
        id: 'way/1',
        ring: [
          { lat: 45.004, lon: 6.004 },
          { lat: 45.004, lon: 6.006 },
          { lat: 45.006, lon: 6.006 },
          { lat: 45.006, lon: 6.004 },
        ],
        height: 9,
        minHeight: 0,
      }] } },
      bbox0: bbox,
      zoom: 15,
      tiles: [{ cx: 0, cz: 0 }],
      cellSize: 1000,
      heightScale: 100,
      elevationSpan: 200,
      sampleHeight: () => 42,
    });
    expect(count).toBe(1);
    expect(layer.mesh).toBeTruthy();
    expect(layer.mesh.geometry.boundingBox.min.y).toBeCloseTo(42.05, 2);
    expect(layer.mesh.geometry.boundingBox.max.y).toBeGreaterThan(42.4);
    layer.dispose();
    expect(scene.getObjectByName('real-world-buildings')).toBeUndefined();
  });

  it('renders newly expanded neighbor cells and deduplicates border buildings', () => {
    const scene = new THREE.Scene();
    const layer = new RealWorldBuildingLayer(scene);
    const bbox = { minLat: 45, maxLat: 45.01, minLon: 6, maxLon: 6.01 };
    const building = (id, lon) => ({
      id,
      ring: [
        { lat: 45.004, lon },
        { lat: 45.004, lon: lon + 0.001 },
        { lat: 45.005, lon: lon + 0.001 },
        { lat: 45.005, lon },
      ],
      height: 9,
      minHeight: 0,
    });
    const shared = building('way/shared', 6.0095);
    const count = layer.rebuild({
      cells: {
        '0,0': { buildings: [building('way/center', 6.004), shared] },
        '1,0': { buildings: [shared, building('way/neighbor', 6.014)] },
      },
      bbox0: bbox,
      zoom: 15,
      tiles: [{ cx: 0, cz: 0 }, { cx: 1, cz: 0 }],
      cellSize: 1000,
      heightScale: 100,
      elevationSpan: 200,
      sampleHeight: () => 0,
    });
    expect(count).toBe(3);
    layer.dispose();
  });
});
