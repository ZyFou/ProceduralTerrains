import { describe, expect, it } from 'vitest';
import {
  createManualProjectCopy,
  importTerrainIntoManualProject,
  normalizeProject,
  projectStats,
} from '../src/project/ProjectStore.js';

describe('project document migration', () => {
  it('wraps legacy terrain JSON in a versioned project document', () => {
    const project = normalizeProject({ params: { seed: 42, chunkCount: 16, chunkSize: 128 } });
    expect(project.schemaVersion).toBe(2);
    expect(project.metadata.name).toBe('Untitled terrain');
    expect(project.terrain.params.seed).toBe(42);
    expect(project.terrain.editorMode).toBe('procedural');
    expect(project.terrain.generationSource).toBe('classic');
    expect(project.terrain.graph).toBeNull();
  });

  it('preserves graph projects and JSON-compatible viewport state', () => {
    const graph = { version: 1, nodes: [], edges: [] };
    const project = normalizeProject({ terrain: { params: { seed: 9 }, generationSource: 'graph', graph, graphView: { x: 14, y: -8, zoom: 1.4 } } });
    expect(project.terrain.generationSource).toBe('graph');
    expect(project.terrain.editorMode).toBe('nodes');
    expect(project.terrain.graph).toEqual(graph);
    expect(project.terrain.graphView).toEqual({ x: 14, y: -8, zoom: 1.4 });
    expect(normalizeProject(JSON.parse(JSON.stringify(project))).terrain).toEqual(project.terrain);
  });

  it('keeps project authoring modes mutually exclusive', () => {
    const procedural = normalizeProject({ terrain: { editorMode: 'procedural', generationSource: 'graph', params: { seed: 3 } } });
    const nodes = normalizeProject({ terrain: { editorMode: 'nodes', generationSource: 'classic', params: { seed: 4 } } });
    expect(procedural.terrain).toMatchObject({ editorMode: 'procedural', generationSource: 'classic' });
    expect(nodes.terrain).toMatchObject({ editorMode: 'nodes', generationSource: 'graph' });
  });

  it('preserves Manual Terrain as a third editor mode', () => {
    const project = normalizeProject({
      terrain: {
        editorMode: 'manual',
        generationSource: 'graph',
        params: { seed: 12 },
        manualTerrain: { version: 1, shapes: [] },
      },
    });
    expect(project.terrain).toMatchObject({
      editorMode: 'manual',
      generationSource: 'classic',
      manualTerrain: { version: 5, baseSource: 'flat', shapes: [] },
    });
  });

  it('preserves a generated Manual base and derives its generation source', () => {
    const project = normalizeProject({ terrain: {
      editorMode: 'manual',
      params: { seed: 12 },
      graph: { version: 3, nodes: [], edges: [] },
      manualTerrain: { version: 5, baseSource: 'nodes', shapes: [] },
    } });
    expect(project.terrain).toMatchObject({
      editorMode: 'manual', generationSource: 'graph',
      manualTerrain: { version: 5, baseSource: 'nodes' },
    });
  });

  it('creates an independent faithful Manual copy', () => {
    const source = normalizeProject({
      id: 'source-project',
      metadata: { name: 'Highlands', tags: ['alpine'] },
      terrain: {
        editorMode: 'nodes', generationSource: 'graph', params: { seed: 77 },
        graph: { version: 3, nodes: [{ id: 'source' }], edges: [] },
        tiles: [{ cx: 0, cz: 0 }, { cx: 1, cz: 0 }],
        paint: { version: 1, marker: 'paint' },
        erosion: { version: 1, marker: 'erosion' },
        creatorTools: { splines: [{ id: 'road' }] },
      },
    });
    const before = structuredClone(source);
    const copy = createManualProjectCopy(source, source.terrain, 'nodes');

    expect(copy.id).not.toBe(source.id);
    expect(copy.metadata.name).toBe('Highlands (Manual)');
    expect(copy.terrain).toMatchObject({
      editorMode: 'manual', generationSource: 'graph', worldMode: 'studio',
      manualTerrain: { version: 5, baseSource: 'nodes', shapes: [] },
      tiles: [{ cx: 0, cz: 0 }, { cx: 1, cz: 0 }],
      paint: { marker: 'paint' }, erosion: { marker: 'erosion' },
      creatorTools: { splines: [{ id: 'road' }] },
    });
    expect(copy.terrain.graph).toEqual(source.terrain.graph);
    expect(source).toEqual(before);
  });

  it('imports a Tile source into the current Manual project without losing local Manual layers', () => {
    const manual = normalizeProject({
      id: 'manual-project',
      metadata: { name: 'My sculpt', tags: ['manual', 'base-procedural'] },
      terrain: {
        editorMode: 'manual', params: { seed: 1 },
        manualTerrain: {
          version: 5, baseSource: 'flat',
          shapes: [{ id: 'peak', type: 'mountain' }],
          sculpt: { version: 1, marker: 'sculpt' },
          surfacePaint: { version: 1, marker: 'surface' },
        },
      },
    });
    const source = normalizeProject({
      id: 'nodes-source',
      metadata: { name: 'Node valley' },
      terrain: {
        editorMode: 'nodes', worldMode: 'studio', params: { seed: 91 },
        graph: { version: 3, nodes: [{ id: 'source' }], edges: [] },
        graphView: { x: 20, y: -10, zoom: 1.2 },
        tiles: [{ cx: 0, cz: 0 }, { cx: -1, cz: 0 }],
        paint: { version: 1, marker: 'source-paint' },
        creatorTools: { splines: [{ id: 'river' }] },
      },
    });
    const sourceBefore = structuredClone(source);

    const imported = importTerrainIntoManualProject(manual, manual.terrain, source);

    expect(imported.id).toBe(manual.id);
    expect(imported.metadata.name).toBe('My sculpt');
    expect(imported.metadata.tags).toContain('base-nodes');
    expect(imported.metadata.tags).not.toContain('base-procedural');
    expect(imported.terrain).toMatchObject({
      editorMode: 'manual', generationSource: 'graph', worldMode: 'studio',
      params: { seed: 91 },
      graph: source.terrain.graph,
      tiles: [{ cx: 0, cz: 0 }, { cx: -1, cz: 0 }],
      paint: { marker: 'source-paint' },
      creatorTools: { splines: [{ id: 'river' }] },
      manualTerrain: {
        version: 5, baseSource: 'nodes',
        shapes: [{ id: 'peak', type: 'mountain' }],
        sculpt: { marker: 'sculpt' },
        surfacePaint: { marker: 'surface' },
      },
    });
    expect(source).toEqual(sourceBefore);
  });

  it('rejects Manual, Infinite, Planet and Real Terrain import sources', () => {
    const manual = normalizeProject({ terrain: {
      editorMode: 'manual', manualTerrain: { version: 5, baseSource: 'flat', shapes: [] },
    } });
    const invalidSources = [
      normalizeProject({ terrain: { editorMode: 'manual' } }),
      normalizeProject({ terrain: { editorMode: 'procedural', worldMode: 'infinite' } }),
      normalizeProject({ terrain: { editorMode: 'nodes', worldMode: 'planet' } }),
      normalizeProject({ terrain: { editorMode: 'procedural', worldMode: 'studio', workspacePreset: 'real-terrain' } }),
    ];

    invalidSources.forEach((source) => {
      expect(() => importTerrainIntoManualProject(manual, manual.terrain, source)).toThrow(/Tile mode/);
    });
  });

  it('preserves supplied metadata and reports terrain size', () => {
    const project = normalizeProject({ metadata: { name: 'Ridge', tags: ['alpine'], thumbnail: 'data:image/webp;base64,thumb' }, terrain: { params: { seed: 7, chunkCount: 32, chunkSize: 128 }, tiles: [{}, {}] } });
    expect(project.metadata.name).toBe('Ridge');
    expect(project.metadata.thumbnail).toBe('data:image/webp;base64,thumb');
    expect(projectStats(project)).toMatchObject({ seed: 7, tiles: 2, worldSize: 4096 });
  });

  it('preserves the geographic source descriptor through project normalization', () => {
    const realWorldSource = {
      version: 1,
      id: 'custom',
      name: 'Custom Alps area',
      bbox: { minLat: 45.8, maxLat: 46, minLon: 6.7, maxLon: 7 },
      zoom: 12,
      imageryStyle: 'opentopo',
      heightSettings: { mode: 'blend', blend: 0.5, invert: false, normalize: true, heightStrength: 1.2, heightOffset: 20 },
      imagerySettings: { mode: 'replace', blend: 0.8 },
    };
    const project = normalizeProject({ terrain: { params: { seed: 12 }, realWorldSource } });

    expect(project.terrain.realWorldSource).toEqual(realWorldSource);
    expect(normalizeProject(JSON.parse(JSON.stringify(project))).terrain.realWorldSource).toEqual(realWorldSource);
  });

  it('preserves the Real terrain workspace preset without changing the engine authoring mode', () => {
    const project = normalizeProject({
      terrain: {
        editorMode: 'procedural',
        workspacePreset: 'real-terrain',
        params: { seed: 21 },
      },
    });

    expect(project.terrain).toMatchObject({
      editorMode: 'procedural',
      generationSource: 'classic',
      workspacePreset: 'real-terrain',
    });
    expect(normalizeProject(JSON.parse(JSON.stringify(project))).terrain.workspacePreset).toBe('real-terrain');
  });
});
