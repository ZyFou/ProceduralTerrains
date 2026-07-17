import { describe, expect, it } from 'vitest';
import { normalizeProject, projectStats } from '../src/project/ProjectStore.js';

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

  it('preserves supplied metadata and reports terrain size', () => {
    const project = normalizeProject({ metadata: { name: 'Ridge', tags: ['alpine'], thumbnail: 'data:image/webp;base64,thumb' }, terrain: { params: { seed: 7, chunkCount: 32, chunkSize: 128 }, tiles: [{}, {}] } });
    expect(project.metadata.name).toBe('Ridge');
    expect(project.metadata.thumbnail).toBe('data:image/webp;base64,thumb');
    expect(projectStats(project)).toMatchObject({ seed: 7, tiles: 2, worldSize: 4096 });
  });
});
