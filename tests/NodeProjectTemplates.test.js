import { describe, expect, it } from 'vitest';
import { compileTerrainGraph } from '../src/engine/terrain/graph/GraphCompiler.js';
import {
  TERRAIN_OUTPUT_ID, graphCapacity, graphColorCapacity, inputEdge, reachableNodeIds, validateGraph,
} from '../src/engine/terrain/graph/GraphDocument.js';
import {
  NODE_PROJECT_TEMPLATES, createNodeTemplateGraph, getNodeProjectTemplate,
} from '../src/project/NodeProjectTemplates.js';

describe('Nodes project templates', () => {
  it('provides a blank graph plus several authored terrain starting points', () => {
    expect(NODE_PROJECT_TEMPLATES[0]).toMatchObject({ id: 'nodes-blank', name: 'Blank graph' });
    expect(NODE_PROJECT_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    expect(new Set(NODE_PROJECT_TEMPLATES.map((template) => template.id)).size).toBe(NODE_PROJECT_TEMPLATES.length);
  });

  it('declares the default color behavior shown by the template picker', () => {
    expect(getNodeProjectTemplate('nodes-blank')).toMatchObject({ colorsEnabled: false, colorPreset: 'alpine' });
    expect(getNodeProjectTemplate('nodes-geological-hybrid')).toMatchObject({ colorsEnabled: true, colorPreset: 'alpine' });
    expect(getNodeProjectTemplate('nodes-highlands')).toMatchObject({ colorsEnabled: true, colorPreset: 'temperate' });
    expect(getNodeProjectTemplate('nodes-craters')).toMatchObject({ colorsEnabled: true, colorPreset: 'volcanic' });
  });

  it.each(NODE_PROJECT_TEMPLATES.map((template) => [template.id]))('%s is valid, reachable, and realtime-safe', (templateId) => {
    const graph = createNodeTemplateGraph(templateId);
    const validation = validateGraph(graph);
    const compiled = compileTerrainGraph(graph);
    expect(validation).toEqual({ ok: true, diagnostics: [] });
    expect(compiled.ok).toBe(true);
    expect(graph.nodes.filter((node) => node.id === TERRAIN_OUTPUT_ID)).toHaveLength(1);
    expect(reachableNodeIds(graph).size).toBe(graph.nodes.length);
    expect(graphCapacity(graph)).toBeLessThanOrEqual(12);
    expect(graphColorCapacity(graph)).toBeLessThanOrEqual(8);
    if (templateId !== 'nodes-blank') {
      expect(inputEdge(graph, TERRAIN_OUTPUT_ID, 'color')?.type).toBe('analytic-color');
      expect(compiled.program.colorBody).toContain('applyTerrainGraphColor');
    }
  });

  it('returns fresh documents and safely falls back to Blank graph', () => {
    const first = createNodeTemplateGraph('nodes-alpine');
    const second = createNodeTemplateGraph('nodes-alpine');
    first.nodes[0].position.x = 999;
    expect(second.nodes[0].position.x).not.toBe(999);
    expect(getNodeProjectTemplate('missing').id).toBe('nodes-blank');
    expect(createNodeTemplateGraph('missing').edges).toEqual([]);
  });

  it('authors the Alpine template as a connected staged weathering pipeline', () => {
    const graph = createNodeTemplateGraph('nodes-alpine');
    const types = graph.nodes.map((node) => node.type);
    expect(types).toEqual(expect.arrayContaining([
      'mountain', 'shaper', 'domainWarp', 'stratify', 'thermalErosion', 'naturalErosion', 'terrainOutput',
    ]));
    const typeById = new Map(graph.nodes.map((node) => [node.id, node.type]));
    const heightLinks = graph.edges
      .filter((edge) => typeById.get(edge.source) !== 'terrainGradient' && edge.targetHandle !== 'color')
      .map((edge) => [typeById.get(edge.source), typeById.get(edge.target)]);
    expect(heightLinks).toEqual(expect.arrayContaining([
      ['mountain', 'shaper'], ['shaper', 'domainWarp'], ['domainWarp', 'stratify'],
      ['stratify', 'thermalErosion'], ['thermalErosion', 'naturalErosion'], ['geologyDetail', 'terrainOutput'],
    ]));
  });

  it('authors Geological Hybrid from the new editable noise sources', () => {
    const graph = createNodeTemplateGraph('nodes-geological-hybrid');
    const byType = (type) => graph.nodes.filter((node) => node.type === type);
    const massif = byType('fbm').find((node) => node.params.seedOffset === 271);
    const weathering = byType('fbm').find((node) => node.params.seedOffset === 809);
    const ridges = byType('ridged')[0];

    expect(byType('fbm')).toHaveLength(3);
    expect(byType('combine')).toHaveLength(3);
    expect(byType('domainWarp')).toHaveLength(1);
    expect(byType('terrace')).toHaveLength(1);
    expect(byType('naturalErosion')).toHaveLength(1);
    expect(byType('geologyDetail')).toHaveLength(1);
    expect(massif.params).toMatchObject({ erosion: 0.12, warp: 0.18, octaves: 6 });
    expect(weathering.params).toMatchObject({ erosion: 0.62, warp: 0.25, octaves: 6 });
    expect(ridges.params).toMatchObject({ sharpness: 2.25, erosion: 0.28, warp: 0.2 });
    expect(graph.nodes.find((node) => node.id === TERRAIN_OUTPUT_ID)?.params).toMatchObject({
      normalize: true, outMin: 0.05, outMax: 0.92,
    });
  });

  it('uses dedicated coherent landforms for River, Canyon, and Dunes', () => {
    const riverTypes = createNodeTemplateGraph('nodes-rivers').nodes.map((node) => node.type);
    expect(riverTypes).toEqual(expect.arrayContaining(['mountain', 'shaper', 'riverCarve', 'thermalErosion', 'naturalErosion']));
    expect(riverTypes).not.toContain('flow');
    expect(riverTypes).not.toContain('combine');

    const canyonTypes = createNodeTemplateGraph('nodes-canyon').nodes.map((node) => node.type);
    expect(canyonTypes).toEqual(expect.arrayContaining(['canyon', 'stratify', 'thermalErosion', 'naturalErosion']));

    const duneTypes = createNodeTemplateGraph('nodes-dunes').nodes.map((node) => node.type);
    expect(duneTypes).toEqual(expect.arrayContaining(['duneSea', 'domainWarp', 'shaper']));
    expect(duneTypes).not.toContain('dune');
  });
});
