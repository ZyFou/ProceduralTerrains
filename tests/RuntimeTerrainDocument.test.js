import { describe, expect, it } from 'vitest';
import {
  buildRuntimeTerrainDocument,
  serializeRuntimeTerrainDocument,
} from '../src/export/runtime/RuntimeTerrainDocument.js';
import {
  isSafeArtifactPath,
  validateRuntimeTerrainDocument,
} from '../src/export/runtime/RuntimeTerrainValidator.js';
import {
  encodeUnityRaw16FromPackedPixels,
  vertexGridUv,
  vertexGridWorldCoordinate,
} from '../src/export/runtime/HeightfieldEncoding.js';

const stack = {
  version: 1,
  globalSeed: 41,
  normalizeOutput: false,
  outputMin: 0,
  outputMax: 1.35,
  layers: [{
    id: 'editor-layer-id', name: 'Editor label', enabled: true,
    type: 'legacy', blendMode: 'replace', strength: 1, opacity: 1,
    seedOffset: 0, params: {}, masks: [], previewSolo: true, locked: true,
  }],
};

function payload(overrides = {}) {
  return {
    app: 'terrain-studio', version: 2, savedAt: 'never-export-this',
    editorMode: 'procedural', generationSource: 'classic', worldMode: 'studio',
    graphView: { x: 99, y: 11, zoom: 0.25 },
    historyMetadata: { undo: ['editor only'] },
    creatorTools: { splines: [], analysis: { editorOnly: true } },
    params: {
      seed: 1337, heightScale: 560, seaLevel: 100,
      noiseScale: 45, noiseStrength: 1, terrainSmoothing: 0,
      octaves: 7, persistence: 0.5, lacunarity: 2.05, ridge: 0.65,
      warp: 0.9, falloff: 0.2, edgeFalloffMode: 'island',
      terrainFormationSeaLevel: 100, moistScale: 1, moistBias: 0,
      biomeScale: 1, tempBias: 0, noiseStack: stack,
      fogDensity: 0.8, pixelRatio: 2, waterEnabled: false, propsEnabled: false,
    },
    ...overrides,
  };
}

function build(projectPayload = payload(), context = {}, options = {}) {
  return buildRuntimeTerrainDocument({
    projectPayload, boardSize: 1000, worldMode: 'studio', projectMode: 'procedural',
    tileAssemblyShape: 'square', tiles: [{ cx: 0, cz: 0 }], ...context,
  }, { heightRes: '1025', texRes: '2048', exportSplat: true, ...options });
}

describe('runtime terrain document', () => {
  it('projects deterministic procedural runtime state without editor fields', () => {
    const document = build();
    const first = serializeRuntimeTerrainDocument(document);
    const second = serializeRuntimeTerrainDocument(build());

    expect(first).toBe(second);
    expect(first).not.toContain('savedAt');
    expect(first).not.toContain('graphView');
    expect(first).not.toContain('historyMetadata');
    expect(first).not.toContain('fogDensity');
    expect(first).not.toContain('pixelRatio');
    expect(first).not.toContain('editor-layer-id');
    expect(document.project).toEqual({ mode: 'procedural', world: 'studio', tileShape: 'square', seed: 1337 });
    expect(document.tiles[0].heightfield).toMatchObject({
      path: 'heightmap.raw', resolution: 1025, byteOrder: 'little-endian',
      rowOrder: 'negative-z-to-positive-z', columnOrder: 'negative-x-to-positive-x',
    });
    expect(validateRuntimeTerrainDocument(document)).toEqual([]);
  });

  it('preserves unsigned editor seed bits in Unity signed Int32 fields', () => {
    const document = build(payload({
      params: { ...payload().params, seed: 0xffffffff },
    }));

    expect(document.project.seed).toBe(-1);
    expect(document.generation.seed).toBe(-1);
    expect(document.project.seed >>> 0).toBe(0xffffffff);
    expect(validateRuntimeTerrainDocument(document)).toEqual([]);
  });

  it('projects graph execution data while removing graph layout', () => {
    const document = build(payload({
      editorMode: 'nodes', generationSource: 'graph',
      graph: {
        version: 3, mode: 'terrain', groups: [{ id: 'layout' }],
        nodes: [
          { id: 'output', type: 'terrainOutput', label: 'Output', position: { x: 50, y: 70 }, params: { normalize: true } },
          { id: 'noise', type: 'noise', label: 'Noise', position: { x: 10, y: 20 }, params: { scale: 2 } },
        ],
        edges: [{ id: 'edge-ui-id', source: 'noise', sourceHandle: 'height', target: 'output', targetHandle: 'height', type: 'height' }],
      },
    }));

    expect(document.generation.kind).toBe('nodes');
    expect(document.generation.graph.nodes).toEqual([
      { id: 'noise', type: 'noise', params: { scale: 2 } },
      { id: 'output', type: 'terrainOutput', params: { normalize: true } },
    ]);
    const json = serializeRuntimeTerrainDocument(document);
    expect(json).not.toContain('position');
    expect(json).not.toContain('groups');
    expect(json).not.toContain('edge-ui-id');
  });

  it('projects a normalized manual document and its generated base', () => {
    const document = build(payload({
      editorMode: 'manual', generationSource: 'classic',
      manualTerrain: {
        version: 2, baseSource: 'procedural',
        shapes: [{ id: 'peak', type: 'mountain', position: { x: 20, z: -40 } }],
        sculpt: { resolution: 8, values: [1, 2] },
      },
    }));

    expect(document.generation.kind).toBe('manual');
    expect(document.generation.manualTerrain.version).toBe(5);
    expect(document.generation.manualTerrain.shapes[0]).toMatchObject({ id: 'peak', type: 'mountain' });
    expect(document.generation.base.kind).toBe('procedural');
  });

  it('sorts negative-coordinate tiles and emits relative per-tile artifacts', () => {
    const document = build(payload(), {
      tiles: [{ cx: 1, cz: 0 }, { cx: -1, cz: -2 }],
    });

    expect(document.tiles.map(({ cx, cz }) => [cx, cz])).toEqual([[-1, -2], [1, 0]]);
    expect(document.tiles[0].heightfield.path).toBe('tiles/tile_-1_-2/heightmap.raw');
    expect(document.tiles[1].splat.path).toBe('tiles/tile_1_0/splatmaps/biomes.png');
    expect(document.bounds).toMatchObject({ minX: -1500, minZ: -2500, sizeX: 3000, sizeZ: 3000 });
  });

  it('records baked-only features in a stable unsupported list', () => {
    const document = build(payload({
      paint: { revision: 1 }, erosion: { revision: 2 }, realWorldSource: { id: 'map' },
      creatorTools: { splines: [{ id: 'road' }] },
      params: { ...payload().params, waterEnabled: true, propsEnabled: true, surfaceTextureMode: true },
    }));
    expect(document.features).toMatchObject({
      paint: true, erosion: true, splines: true, importedMaps: true,
      surfaces: true, water: true, props: true,
    });
    expect(document.unsupportedFeatures).toEqual([
      'paint', 'erosion', 'splines', 'imported-maps', 'surface-materials', 'water', 'props',
    ]);
  });

  it('records manual material and prop paint independently', () => {
    const document = build(payload({
      editorMode: 'manual',
      manualTerrain: {
        version: 5, baseSource: 'flat', shapes: [],
        surfacePaint: { version: 2, materials: null, props: { version: 1, data: 'painted-props' } },
      },
    }));
    expect(document.features.surfaces).toBe(false);
    expect(document.features.props).toBe(true);
    expect(document.unsupportedFeatures).toContain('props');
  });
});

describe('runtime terrain validation', () => {
  it('rejects unsupported worlds, circular layouts, duplicates, and invalid grids', () => {
    const document = build();
    document.project.world = 'planet';
    document.project.tileShape = 'circle';
    document.tiles.push(structuredClone(document.tiles[0]));
    document.tiles[0].heightfield.resolution = 1024;
    const codes = validateRuntimeTerrainDocument(document).map(({ code }) => code);
    expect(codes).toContain('project.world');
    expect(codes).toContain('project.tileShape');
    expect(codes).toContain('tile.duplicate');
    expect(codes).toContain('heightfield.resolution');
  });

  it('rejects tile arrays that are not sorted by cz then cx', () => {
    const document = build(payload(), {
      tiles: [{ cx: 0, cz: 0 }, { cx: 1, cz: 0 }],
    });
    document.tiles.reverse();
    expect(validateRuntimeTerrainDocument(document).map(({ code }) => code)).toContain('tile.order');
  });

  it('rejects absolute, traversal, URL, and backslash artifact paths', () => {
    expect(isSafeArtifactPath('tiles/tile_-1_2/heightmap.raw')).toBe(true);
    expect(isSafeArtifactPath('../heightmap.raw')).toBe(false);
    expect(isSafeArtifactPath('C:/terrain/heightmap.raw')).toBe(false);
    expect(isSafeArtifactPath('https://example.com/heightmap.raw')).toBe(false);
    expect(isSafeArtifactPath('tiles\\heightmap.raw')).toBe(false);
  });
});

describe('Unity RAW heightfield encoding', () => {
  it('packs bottom-left RGBA rows directly as little-endian uint16 values', () => {
    const pixels = new Uint8Array([
      0, 0, 0, 255,
      255, 255, 255, 255,
      128, 0, 0, 255,
      64, 0, 0, 255,
    ]);
    const raw = encodeUnityRaw16FromPackedPixels(pixels, 2, 2);
    const view = new DataView(raw.buffer);
    expect([...raw.slice(0, 4)]).toEqual([0, 0, 255, 255]);
    expect(view.getUint16(4, true)).toBeGreaterThan(view.getUint16(6, true));
  });

  it('uses inclusive vertex UVs and identical neighboring border coordinates', () => {
    expect(vertexGridUv(0, 513)).toBe(0);
    expect(vertexGridUv(512, 513)).toBe(1);
    const leftEdge = vertexGridWorldCoordinate(0, 1000, 512, 513);
    const rightEdge = vertexGridWorldCoordinate(1000, 1000, 0, 513);
    expect(leftEdge).toBe(500);
    expect(rightEdge).toBe(leftEdge);
  });
});
