import { describe, expect, it } from 'vitest';
import { compileTerrainGraph } from '../src/engine/terrain/graph/GraphCompiler.js';
import {
  TERRAIN_OUTPUT_ID, addGraphNode, connectGraphNodes, createBlankGraph, graphCapacity, graphColorCapacity, inputEdge, migrateGraphDocument, reachableNodeIds, validateGraph,
} from '../src/engine/terrain/graph/GraphDocument.js';
import {
  NODE_PROJECT_TEMPLATES, createNodeTemplateGraph, expandDryCanyon, getNodeProjectTemplate,
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
    if (templateId.startsWith('nodes-pbr-') || templateId === 'nodes-dry-canyon') {
      expect(inputEdge(graph, TERRAIN_OUTPUT_ID, 'surface')?.type).toBe('surface');
      expect(inputEdge(graph, TERRAIN_OUTPUT_ID, 'color')).toBeNull();
    } else if (templateId !== 'nodes-blank') {
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

  it('rebuilds the original canyon from a blank graph, one branch at a time', () => {
    let graph = createBlankGraph();
    const add = type => { graph = addGraphNode(graph, type, { x: 0, y: 0 }, { id: type }); };
    const wire = (source, target, targetHandle) => {
      graph = connectGraphNodes(graph, { source, target, targetHandle });
    };
    const samples = [
      [0, 0, 62.469268856540175], [-0.31, 0.13, 194.81721420627989],
      [0.17, -0.42, 197.55827708011074], [0.28, 0.38, 191.85536274586497],
      [-0.1, -0.1, 165.94408613155483], [-0.4, -0.42, 211.9925794086607],
      [-0.225, 0.15, 159.7711842102647],
    ];
    const heights = doc => {
      const result = compileTerrainGraph(doc);
      expect(result.diagnostics).toEqual([]);
      const uniforms = { uBoardHalf: {value:1024}, uHeightScale: {value:250} };
      return samples.map(([x,z]) => result.program.evaluate2D(x*2048,z*2048,{uniforms}) * 250);
    };
    add('canyonDomain'); add('mainWash'); add('basinRelief');
    wire('canyonDomain','mainWash','domain');
    wire('mainWash','basinRelief','channel');
    wire('basinRelief',TERRAIN_OUTPUT_ID,'height');
    const trunk = heights(graph);
    add('tributaryChannels');
    wire('mainWash','tributaryChannels','channel');
    wire('tributaryChannels','basinRelief','channel');
    const branching = heights(graph);
    expect(branching).not.toEqual(trunk);
    add('basinHeadwall');
    wire('canyonDomain','basinHeadwall','domain');
    wire('basinHeadwall','basinRelief','headwall');
    const basin = heights(graph);
    expect(basin).not.toEqual(branching);
    basin.forEach((height, index) => expect(height).toBeCloseTo(samples[index][2], 8));
    const recipe = createNodeTemplateGraph('nodes-dry-canyon');
    expect(recipe.nodes.some(n => n.type === 'dryCanyon')).toBe(false);
    expect(heights(migrateGraphDocument(JSON.parse(JSON.stringify(recipe))))).toEqual(basin);
  });

  it('round-trips all three erosion ports and can wire each directly to gravel coverage', () => {
    const template = createNodeTemplateGraph('nodes-dry-canyon');
    const graph = migrateGraphDocument(JSON.parse(JSON.stringify(template)));
    const maps = graph.nodes.find(node => node.type === 'erosionMaps');
    const gravelBlend = graph.nodes.find(node => node.label === 'Deposit gravel');
    const { program } = compileTerrainGraph(graph);
    expect(graph.edges.filter(edge => edge.source === maps.id).map(edge => edge.sourceHandle).sort())
      .toEqual(['deposition', 'erosion', 'flow']);
    for (const [sourceHandle, channel] of [['flow', 'a'], ['erosion', 'g'], ['deposition', 'b']]) {
      const rewired = connectGraphNodes(graph, {
        source: maps.id, sourceHandle, target: gravelBlend.id, targetHandle: 'mask',
      });
      const next = compileTerrainGraph(rewired).program;
      const mapVariable = 'sg' + next.surface.nodeIds.indexOf(maps.id);
      expect(next.surface.body).toContain('clamp(' + mapVariable + '.' + channel + ',0.0,1.0)');
      expect(next.heightInputKey).toBe(program.heightInputKey);
      expect(next.sig).not.toBe(program.sig);
    }
    graph.nodes.find(node => node.type === 'canyonDomain').params.seed++;
    expect(compileTerrainGraph(graph).program.heightInputKey).not.toBe(program.heightInputKey);
  });

  it('expands an edited legacy canyon in place and preserves its outgoing height wire', () => {
    let graph = addGraphNode(createBlankGraph(), 'dryCanyon', {x: 120, y: 90}, {
      id: 'old', label: 'East fork', params: {seed: 905, scale: 1.35, height: 370, warp: 1.23, ridge: 0.43},
    });
    graph = connectGraphNodes(graph, {source: 'old', target: TERRAIN_OUTPUT_ID, targetHandle:'height'});
    const next = expandDryCanyon(graph, 'old');
    expect(next.nodes.find(n => n.id === 'old')).toMatchObject({type:'basinRelief', label:'East fork', position:{x:120,y:90}});
    expect(inputEdge(next, TERRAIN_OUTPUT_ID, 'height')).toEqual(graph.edges[0]);
    const oldHeight = compileTerrainGraph(graph).program.evaluate2D;
    const newHeight = compileTerrainGraph(next).program.evaluate2D;
    const uniforms = { uBoardHalf: {value:512}, uHeightScale: {value:560} };
    for (let z = -512; z <= 512; z += 64) for (let x = -512; x <= 512; x += 64) {
      expect(newHeight(x,z,{uniforms})).toBeCloseTo(oldHeight(x,z,{uniforms}), 10);
    }
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
