import { describe, expect, it } from 'vitest';
import { makeLayer, makeStack } from '../src/engine/terrain/noise/NoiseStack.js';
import {
  GraphValidationError, TERRAIN_OUTPUT_ID, addGraphNode, connectGraphNodes, createBlankGraph,
  createGraphFromStack, downstreamNodeIds, duplicateGraphSelection, graphCapacity, graphColorCapacity, groupGraphNodes, inputEdge,
  migrateGraphDocument, moveGraphGroup, moveGraphNodes, reachableNodeIds, removeGraphGroups, removeGraphNodes,
  setGraphMode, topologicalSort, updateGraphGroup, updateGraphNodeParams, validateGraph,
} from '../src/engine/terrain/graph/GraphDocument.js';
import { compileTerrainGraph } from '../src/engine/terrain/graph/GraphCompiler.js';
import { ANALYTIC_COLOR, ANALYTIC_HEIGHT, getGraphNodeDefinition, listGraphNodeDefinitions, nodeDefaults } from '../src/engine/terrain/graph/GraphRegistry.js';
import { SEED_DOMAIN_RADIUS, seedDomainOffset } from '../src/engine/terrain/noise/seedDomain.js';

const uniforms = {
  uFrequency: { value: 0.01 }, uSeedOffset: { value: { x: 2, y: 3 } }, uAmplitude: { value: 1 },
  uHeightScale: { value: 100 }, uPersistence: { value: 0.5 }, uLacunarity: { value: 2 },
};
const ctx = { uniforms, legacy2d: (x, z) => x * 0.01 + z * 0.02 };

function addConnected(graph, type, sourceId, targetId = TERRAIN_OUTPUT_ID, targetHandle = 'height') {
  const next = addGraphNode(graph, type, { x: 100, y: 100 });
  const node = next.nodes.at(-1);
  return { node, graph: connectGraphNodes(next, { source: sourceId || node.id, sourceHandle: 'height', target: targetId, targetHandle }) };
}

function graphForRegistryNode(type) {
  let graph = createBlankGraph();
  graph = addGraphNode(graph, type, { x: 220, y: 120 });
  const node = graph.nodes.at(-1);
  const definition = getGraphNodeDefinition(type);
  if (definition.inputs.length === 0) {
    graph = connectGraphNodes(graph, { source: node.id, target: TERRAIN_OUTPUT_ID });
    return { graph, node };
  }
  for (const [index, port] of definition.inputs.entries()) {
    const sourceType = port.type === ANALYTIC_COLOR ? 'terrainGradient' : 'constant';
    graph = addGraphNode(graph, sourceType, { x: 0, y: index * 100 }, { params: { value: 0.2 + index * 0.3, strength: 1 } });
    graph = connectGraphNodes(graph, { source: graph.nodes.at(-1).id, target: node.id, targetHandle: port.id });
  }
  graph = connectGraphNodes(graph, { source: node.id, target: TERRAIN_OUTPUT_ID });
  return { graph, node };
}

describe('terrain graph document', () => {
  it('starts in Terrain Graph mode and can switch sub-modes without changing the recipe', () => {
    const graph = createBlankGraph();
    expect(graph).toMatchObject({ version: 3, mode: 'terrain', groups: [] });
    const noise = setGraphMode(graph, 'noise');
    expect(noise.mode).toBe('noise');
    expect(noise.nodes).toEqual(graph.nodes);
    expect(setGraphMode(noise, 'unknown')).toBe(noise);
  });

  it('creates a permanent current-terrain compatibility path', () => {
    const stack = makeStack([makeLayer('legacy'), makeLayer('fbm')], { normalizeOutput: true, outputMin: -0.2, outputMax: 1.6 });
    const graph = createGraphFromStack(stack);
    expect(graph.nodes.map((node) => node.type)).toEqual(['currentTerrain', 'terrainOutput']);
    expect(graph.nodes.find((node) => node.type === 'terrainOutput').params).toMatchObject({ normalize: true, outMin: -0.2, outMax: 1.6 });
    expect(graphCapacity(graph)).toBe(2);
    expect(validateGraph(graph).ok).toBe(true);
  });

  it('migrates missing graphs without changing the classic stack', () => {
    const stack = makeStack([makeLayer('ridged')]);
    const graph = migrateGraphDocument(null, stack);
    expect(graph.nodes.find((node) => node.type === 'currentTerrain').params.stack.layers[0].type).toBe('ridged');
  });

  it('preserves unknown saved nodes so validation can report them clearly', () => {
    const graph = migrateGraphDocument({
      version: 1,
      nodes: [
        { id: 'future', type: 'futureRasterNode', position: { x: 0, y: 0 }, params: { resolution: 512 } },
        { id: 'old-output', type: 'terrainOutput', position: { x: 200, y: 0 }, params: {} },
      ],
      edges: [{ id: 'future-edge', source: 'future', sourceHandle: 'height', target: 'old-output', targetHandle: 'height', type: 'analytic-height' }],
    });
    expect(graph.nodes.find((node) => node.id === 'future').params.resolution).toBe(512);
    expect(graph.edges[0].target).toBe(TERRAIN_OUTPUT_ID);
    expect(validateGraph(graph).diagnostics.some((diagnostic) => diagnostic.code === 'unknown-node')).toBe(true);
  });

  it('replaces an existing input connection atomically', () => {
    let graph = createBlankGraph();
    graph = addGraphNode(graph, 'fbm', { x: 0, y: 0 }); const first = graph.nodes.at(-1);
    graph = connectGraphNodes(graph, { source: first.id, target: TERRAIN_OUTPUT_ID });
    graph = addGraphNode(graph, 'ridged', { x: 0, y: 100 }); const second = graph.nodes.at(-1);
    graph = connectGraphNodes(graph, { source: second.id, target: TERRAIN_OUTPUT_ID });
    expect(graph.edges).toHaveLength(1);
    expect(inputEdge(graph, TERRAIN_OUTPUT_ID, 'height').source).toBe(second.id);
  });

  it('rejects cycles, self-links, and incompatible ports', () => {
    let graph = createBlankGraph();
    graph = addGraphNode(graph, 'math', { x: 0, y: 0 }); const a = graph.nodes.at(-1);
    graph = addGraphNode(graph, 'math', { x: 100, y: 0 }); const b = graph.nodes.at(-1);
    graph = connectGraphNodes(graph, { source: a.id, target: b.id, targetHandle: 'source' });
    expect(() => connectGraphNodes(graph, { source: b.id, target: a.id, targetHandle: 'source' })).toThrow(GraphValidationError);
    expect(() => connectGraphNodes(graph, { source: a.id, target: a.id, targetHandle: 'source' })).toThrow(GraphValidationError);
    expect(() => connectGraphNodes(graph, { source: a.id, sourceHandle: 'missing', target: TERRAIN_OUTPUT_ID })).toThrow(GraphValidationError);
  });

  it('infers typed color handles, replaces color independently, and rejects height-to-color links', () => {
    let graph = createBlankGraph();
    graph = addGraphNode(graph, 'terrainGradient', { x: 0, y: 160 }); const gradient = graph.nodes.at(-1);
    graph = addGraphNode(graph, 'slopeTint', { x: 200, y: 160 }); const slope = graph.nodes.at(-1);
    graph = addGraphNode(graph, 'fbm', { x: 0, y: 0 }); const height = graph.nodes.at(-1);
    graph = connectGraphNodes(graph, { source: gradient.id, target: slope.id });
    graph = connectGraphNodes(graph, { source: slope.id, target: TERRAIN_OUTPUT_ID });
    graph = connectGraphNodes(graph, { source: height.id, target: TERRAIN_OUTPUT_ID });
    expect(inputEdge(graph, slope.id, 'base')).toMatchObject({ sourceHandle: 'color', type: ANALYTIC_COLOR });
    expect(inputEdge(graph, TERRAIN_OUTPUT_ID, 'color')).toMatchObject({ source: slope.id, type: ANALYTIC_COLOR });
    expect(inputEdge(graph, TERRAIN_OUTPUT_ID, 'height')).toMatchObject({ source: height.id, type: ANALYTIC_HEIGHT });
    expect(graphColorCapacity(graph)).toBe(2);
    expect(() => connectGraphNodes(graph, { source: height.id, target: slope.id, targetHandle: 'base' })).toThrow(GraphValidationError);
  });

  it('sorts dependencies, ignores disconnected experiments, and propagates dirtiness downstream', () => {
    let graph = createBlankGraph();
    graph = addGraphNode(graph, 'fbm', { x: 0, y: 0 }); const source = graph.nodes.at(-1);
    graph = addGraphNode(graph, 'math', { x: 100, y: 0 }); const math = graph.nodes.at(-1);
    graph = addGraphNode(graph, 'white', { x: 0, y: 200 }); const disconnected = graph.nodes.at(-1);
    graph = connectGraphNodes(graph, { source: source.id, target: math.id, targetHandle: 'source' });
    graph = connectGraphNodes(graph, { source: math.id, target: TERRAIN_OUTPUT_ID });
    expect(reachableNodeIds(graph).has(disconnected.id)).toBe(false);
    expect(topologicalSort(graph, { reachableOnly: true })).toEqual([source.id, math.id, TERRAIN_OUTPUT_ID]);
    expect([...downstreamNodeIds(graph, source.id)]).toEqual([source.id, math.id, TERRAIN_OUTPUT_ID]);
  });

  it('keeps Terrain Output permanent and immutable actions leave the source untouched', () => {
    const graph = createGraphFromStack(); const before = JSON.stringify(graph);
    const moved = moveGraphNodes(graph, { 'current-terrain': { x: 50, y: 90 } });
    const removed = removeGraphNodes(moved, ['current-terrain', TERRAIN_OUTPUT_ID]);
    expect(removed.nodes.some((node) => node.id === TERRAIN_OUTPUT_ID)).toBe(true);
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('rejects duplicate Terrain Output nodes', () => {
    const graph = createBlankGraph();
    graph.nodes.push({ ...structuredClone(graph.nodes[0]), id: 'duplicate-output' });
    expect(validateGraph(graph).diagnostics.some((diagnostic) => diagnostic.code === 'duplicate-output')).toBe(true);
  });

  it('duplicates selected nodes with fresh ids and internal edges but never output', () => {
    let graph = createBlankGraph();
    graph = addGraphNode(graph, 'fbm', { x: 0, y: 0 }); const source = graph.nodes.at(-1);
    graph = addGraphNode(graph, 'math', { x: 180, y: 0 }); const math = graph.nodes.at(-1);
    graph = connectGraphNodes(graph, { source: source.id, target: math.id, targetHandle: 'source' });
    graph = connectGraphNodes(graph, { source: math.id, target: TERRAIN_OUTPUT_ID });
    const result = duplicateGraphSelection(graph, [source.id, math.id, TERRAIN_OUTPUT_ID]);
    expect(result.nodeIds).toHaveLength(2);
    expect(result.graph.nodes.filter((node) => node.type === 'terrainOutput')).toHaveLength(1);
    expect(new Set(result.graph.nodes.map((node) => node.id)).size).toBe(result.graph.nodes.length);
    expect(result.graph.edges.filter((edge) => result.nodeIds.includes(edge.source) && result.nodeIds.includes(edge.target))).toHaveLength(1);
  });

  it('groups nodes into movable, collapsible organization frames that survive migration', () => {
    let graph = createBlankGraph();
    graph = addGraphNode(graph, 'mountain', { x: 80, y: 120 }); const mountain = graph.nodes.at(-1);
    graph = addGraphNode(graph, 'terrace', { x: 320, y: 120 }); const terrace = graph.nodes.at(-1);
    const grouped = groupGraphNodes(graph, [mountain.id, terrace.id], {
      id: 'geology', label: 'Geology', position: { x: 40, y: 60 }, width: 520, height: 240, color: 'amber',
    });
    graph = grouped.graph;
    expect(grouped.groupId).toBe('geology');
    expect(graph.groups[0]).toMatchObject({ label: 'Geology', nodeIds: [mountain.id, terrace.id], collapsed: false, color: 'amber' });
    graph = updateGraphGroup(graph, 'geology', { collapsed: true, label: 'Rock pass' });
    graph = updateGraphGroup(graph, 'geology', { width: 640, height: 310, color: '#6f4aa8' });
    graph = moveGraphGroup(graph, 'geology', { x: 70, y: 100 });
    expect(graph.nodes.find((node) => node.id === mountain.id).position).toEqual({ x: 110, y: 160 });
    const migrated = migrateGraphDocument(JSON.parse(JSON.stringify(graph)));
    expect(migrated.groups[0]).toMatchObject({ id: 'geology', label: 'Rock pass', collapsed: true, position: { x: 70, y: 100 }, width: 640, height: 310, color: '#6f4aa8' });
    expect(removeGraphGroups(migrated, ['geology']).groups).toEqual([]);
  });

  it('reports capacity overflow only for the output dependency chain', () => {
    const stack = makeStack(Array.from({ length: 12 }, () => makeLayer('fbm')));
    let graph = createGraphFromStack(stack);
    graph = addGraphNode(graph, 'terrace', { x: 200, y: 0 }); const terrace = graph.nodes.at(-1);
    graph = connectGraphNodes(graph, { source: 'current-terrain', target: terrace.id, targetHandle: 'source' });
    graph = connectGraphNodes(graph, { source: terrace.id, target: TERRAIN_OUTPUT_ID });
    expect(validateGraph(graph).diagnostics.some((diagnostic) => diagnostic.code === 'capacity')).toBe(true);
  });
});

describe('analytical terrain graph compiler', () => {
  it('compiles an unconnected Terrain Output as a valid flat slab', () => {
    const graph = createBlankGraph();
    const result = compileTerrainGraph(graph);
    expect(validateGraph(graph).ok).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.program.slotCount).toBe(0);
    expect(result.program.body2d).toContain('return 0.0');
    expect(result.program.evaluate2D(12.5, -7.25, ctx)).toBe(0);
  });

  it('characterizes every registry entry as plain JSON with typed analytical ports', () => {
    for (const definition of listGraphNodeDefinitions({ includeHidden: true })) {
      expect(getGraphNodeDefinition(definition.id)).toBe(definition);
      expect(structuredClone(nodeDefaults(definition.id))).toEqual(definition.defaults);
      expect(definition.executionKind).toBe('analytical');
      expect(definition.glslCompiler).toBeTypeOf('function');
      expect(definition.cpuEvaluator).toBeTypeOf('function');
      expect([...definition.inputs, ...definition.outputs].every((port) => [ANALYTIC_HEIGHT, ANALYTIC_COLOR].includes(port.type))).toBe(true);
      expect(JSON.parse(JSON.stringify(definition.defaults))).toEqual(definition.defaults);
    }
  });

  it('offers deterministic noise and five landforms only in the Terrain Graph palette', () => {
    const terrainIds = new Set(listGraphNodeDefinitions({ mode: 'terrain' }).map((definition) => definition.id));
    const noiseIds = new Set(listGraphNodeDefinitions({ mode: 'noise' }).map((definition) => definition.id));
    for (const type of ['deterministicNoise', 'mountain', 'mountainRange', 'ridge', 'island', 'singleCrater']) expect(terrainIds.has(type)).toBe(true);
    for (const type of ['mountain', 'mountainRange', 'ridge', 'island', 'singleCrater']) expect(noiseIds.has(type)).toBe(false);
    expect(noiseIds.has('deterministicNoise')).toBe(true);
    for (const type of ['terrainGradient', 'slopeTint', 'moistureTint', 'colorGrade']) {
      expect(terrainIds.has(type)).toBe(true);
      expect(noiseIds.has(type)).toBe(false);
    }
    for (const type of ['shaper', 'stratify', 'thermalErosion']) expect(terrainIds.has(type)).toBe(true);
    for (const type of ['shaper', 'stratify', 'thermalErosion']) expect(noiseIds.has(type)).toBe(false);
  });

  it('exposes compact geological Mountain presets and dedicated processing nodes', () => {
    const mountain = getGraphNodeDefinition('mountain');
    const fields = new Map(mountain.inspector.map((field) => [field.key, field]));
    expect([...fields.keys()]).toEqual(['style', 'bulk', 'scale', 'height', 'reduceDetails', 'seed', 'x', 'y']);
    expect(fields.get('style').options.map((option) => option.value)).toEqual(['basic', 'eroded', 'old', 'alpine', 'strata']);
    expect(fields.get('bulk').options.map((option) => option.value)).toEqual(['low', 'medium', 'high']);
    expect(nodeDefaults('mountain')).toMatchObject({ style: 'alpine', bulk: 'medium', reduceDetails: false, x: 0, y: 0 });
    expect(getGraphNodeDefinition('domainWarp').label).toBe('Organic Warp');
    expect(getGraphNodeDefinition('shaper').inputs[0]).toMatchObject({ id: 'source', type: ANALYTIC_HEIGHT });
    expect(getGraphNodeDefinition('stratify').description).toContain('non-linear');
  });

  it('builds a cellular asymmetric massif and redistributes steep material with Thermal Erosion', () => {
    let mountainGraph = createBlankGraph('terrain');
    mountainGraph = addGraphNode(mountainGraph, 'mountain', { x: 0, y: 0 });
    const mountain = mountainGraph.nodes.at(-1);
    mountainGraph = connectGraphNodes(mountainGraph, { source: mountain.id, target: TERRAIN_OUTPUT_ID });
    const mountainProgram = compileTerrainGraph(mountainGraph).program;
    const mountainAt = mountainProgram.evaluate2D;

    const ring = Array.from({ length: 16 }, (_, index) => {
      const angle = index * Math.PI / 8;
      return mountainAt(Math.cos(angle) * 90, Math.sin(angle) * 90, ctx);
    });
    expect(Math.max(...ring) - Math.min(...ring)).toBeGreaterThan(0.12);
    expect(mountainAt(260, 260, ctx)).toBe(0);
    expect(mountainProgram.body2d).toContain('peak2');
    expect(mountainProgram.body2d).toContain('cellF1');
    expect(mountainProgram.body2d).toContain('drainageNetwork');
    expect(mountainProgram.body2d).not.toContain('branchPhase');

    let thermalGraph = addGraphNode(mountainGraph, 'thermalErosion', { x: 220, y: 0 });
    const thermal = thermalGraph.nodes.at(-1);
    thermalGraph = connectGraphNodes(thermalGraph, { source: mountain.id, target: thermal.id });
    thermalGraph = connectGraphNodes(thermalGraph, { source: thermal.id, target: TERRAIN_OUTPUT_ID });
    const thermalProgram = compileTerrainGraph(thermalGraph).program;
    const thermalAt = thermalProgram.evaluate2D;
    const baseSamples = [], thermalSamples = [];
    for (let z = -180; z <= 180; z += 15) {
      for (let x = -180; x <= 180; x += 15) {
        baseSamples.push(mountainAt(x, z, ctx));
        thermalSamples.push(thermalAt(x, z, ctx));
      }
    }
    const meanChange = baseSamples.reduce((sum, value, index) => sum + Math.abs(value - thermalSamples[index]), 0) / baseSamples.length;
    expect(meanChange).toBeGreaterThan(0.005);
    expect(Math.max(...thermalSamples)).toBeLessThan(Math.max(...baseSamples));
    expect(Math.min(...thermalSamples)).toBeGreaterThanOrEqual(0);
    expect(thermalProgram.body2d).toContain('passGain');
    expect(thermalProgram.body2d).toContain('directionalTalus');
    expect(thermalProgram.body2d).toContain('screeDeposit');
    expect(thermalProgram.body2d).toContain('sedimentRemoval');
    expect(thermalProgram.packUniforms().paramsA[1]).toEqual([0.07, 12, 0.72, 0.18]);
    expect(thermalProgram.packUniforms().paramsB[1][0]).toBe(0.16);
  });

  it('uses a structurally cached low-cost Mountain shader when Reduce Details is enabled', () => {
    let graph = createBlankGraph('terrain');
    graph = addGraphNode(graph, 'mountain', { x: 0, y: 0 }, { params: { style: 'alpine', bulk: 'high', reduceDetails: false } });
    const mountain = graph.nodes.at(-1);
    graph = connectGraphNodes(graph, { source: mountain.id, target: TERRAIN_OUTPUT_ID });
    const detailed = compileTerrainGraph(graph).program;
    const reduced = compileTerrainGraph(updateGraphNodeParams(graph, mountain.id, { reduceDetails: true })).program;

    expect(reduced.sig).not.toBe(detailed.sig);
    expect(detailed.body2d).toContain(`${String(mountain.id).replace(/[^a-zA-Z0-9_]/g, '_')}_cellular`);
    expect(detailed.body2d).toContain('for(int i=0;i<5;i++)');
    expect(reduced.body2d).toContain('reduced-details fast path');
    expect(reduced.body2d).toContain('reducedCellA');
    expect(reduced.body2d).not.toContain('_cellular');
    expect(reduced.body2d).not.toContain('for(int i=0;i<5;i++)');
    expect(reduced.body2d.length).toBeLessThan(detailed.body2d.length - 400);
    expect(Number.isFinite(reduced.evaluate2D(32, -47, ctx))).toBe(true);
  });

  it('separates mass shaping and localized strata into nontrivial one-slot analytical stages', () => {
    let graph = createBlankGraph('terrain');
    graph = addGraphNode(graph, 'mountain', { x: 0, y: 0 }, { params: { style: 'eroded', bulk: 'high', seed: 4812 } });
    const mountain = graph.nodes.at(-1);
    graph = addGraphNode(graph, 'shaper', { x: 180, y: 0 }, { params: { shape: 0.52, strength: 0.9, featureScale: 36, detailPreservation: 0.86 } });
    const shaper = graph.nodes.at(-1);
    graph = addGraphNode(graph, 'stratify', { x: 360, y: 0 }, { params: { intensity: 0.58, spacing: 0.09, seed: 7711 } });
    const stratify = graph.nodes.at(-1);
    graph = connectGraphNodes(graph, { source: mountain.id, target: shaper.id });
    graph = connectGraphNodes(graph, { source: shaper.id, target: stratify.id });
    graph = connectGraphNodes(graph, { source: stratify.id, target: TERRAIN_OUTPUT_ID });

    const shapedGraph = connectGraphNodes(graph, { source: shaper.id, target: TERRAIN_OUTPUT_ID });
    const mountainGraph = connectGraphNodes(graph, { source: mountain.id, target: TERRAIN_OUTPUT_ID });
    const mountainProgram = compileTerrainGraph(mountainGraph).program;
    const shapedProgram = compileTerrainGraph(shapedGraph).program;
    const layeredProgram = compileTerrainGraph(graph).program;
    const samples = [];
    for (let z = -120; z <= 120; z += 24) for (let x = -120; x <= 120; x += 24) samples.push([x, z]);
    const meanDifference = (left, right) => samples.reduce((sum, [x, z]) => sum + Math.abs(left(x, z, ctx) - right(x, z, ctx)), 0) / samples.length;

    expect(meanDifference(mountainProgram.evaluate2D, shapedProgram.evaluate2D)).toBeGreaterThan(0.003);
    expect(meanDifference(shapedProgram.evaluate2D, layeredProgram.evaluate2D)).toBeGreaterThan(0.0002);
    expect(layeredProgram.slotCount).toBe(3);
    expect(layeredProgram.body2d).toContain('preservedDetail');
    expect(layeredProgram.body2d).toContain('localZone');
    expect(layeredProgram.packUniforms().paramsA[1]).toEqual([0.52, 0.86, 0, 0]);
    expect(layeredProgram.packUniforms().scale[2]).toBe(0.09);
  });

  it('hard-bounds Thermal to one expensive upstream terrain sample', () => {
    let graph = createBlankGraph('terrain');
    const stages = [];
    for (const type of ['mountain', 'shaper', 'domainWarp', 'stratify', 'thermalErosion', 'naturalErosion']) {
      graph = addGraphNode(graph, type, { x: stages.length * 180, y: 0 });
      const node = graph.nodes.at(-1);
      if (stages.length) graph = connectGraphNodes(graph, { source: stages.at(-1).id, target: node.id });
      stages.push(node);
    }
    graph = connectGraphNodes(graph, { source: stages.at(-1).id, target: TERRAIN_OUTPUT_ID });

    const program = compileTerrainGraph(graph).program;
    const [, , , substrate, thermal, natural] = stages;
    const symbol = (id) => `graph_${String(id).replace(/[^a-zA-Z0-9_]/g, '_')}`;
    const functionBody = (id) => program.body2d.match(new RegExp(`float ${symbol(id)}\\(vec2 xz, Climate c\\) \\{[\\s\\S]*?\\n\\}`))?.[0] || '';
    const callsTo = (body, id) => (body.match(new RegExp(`${symbol(id)}\\(`, 'g')) || []).length;
    const thermalBody = functionBody(thermal.id);
    const naturalBody = functionBody(natural.id);

    expect(callsTo(thermalBody, substrate.id)).toBe(1);
    expect(callsTo(naturalBody, thermal.id)).toBe(1);
    expect(callsTo(naturalBody, substrate.id)).toBe(0);
    expect(callsTo(naturalBody, thermal.id) * callsTo(thermalBody, substrate.id) + callsTo(naturalBody, substrate.id)).toBe(1);
    expect(thermalBody).toContain('directionalTalus');
    expect(thermalBody).toContain('screeDeposit');
    expect(naturalBody).toContain('tributary');
    expect(naturalBody).toContain('deposit');
    expect(Number.isFinite(program.evaluate2D(42.25, -19.5, ctx))).toBe(true);
  });

  it('compiles a realistic height and color graph into separate shader streams', () => {
    let graph = createBlankGraph('terrain');
    graph = addGraphNode(graph, 'mountainRange', { x: 0, y: 0 }); const range = graph.nodes.at(-1);
    graph = addGraphNode(graph, 'naturalErosion', { x: 200, y: 0 }); const erosion = graph.nodes.at(-1);
    graph = addGraphNode(graph, 'geologyDetail', { x: 400, y: 0 }); const geology = graph.nodes.at(-1);
    graph = addGraphNode(graph, 'terrainGradient', { x: 0, y: 180 }, { params: { preset: 'alpine' } }); const gradient = graph.nodes.at(-1);
    graph = addGraphNode(graph, 'slopeTint', { x: 200, y: 180 }); const slope = graph.nodes.at(-1);
    graph = addGraphNode(graph, 'colorGrade', { x: 400, y: 180 }); const grade = graph.nodes.at(-1);
    graph = connectGraphNodes(graph, { source: range.id, target: erosion.id });
    graph = connectGraphNodes(graph, { source: erosion.id, target: geology.id });
    graph = connectGraphNodes(graph, { source: geology.id, target: TERRAIN_OUTPUT_ID });
    graph = connectGraphNodes(graph, { source: gradient.id, target: slope.id });
    graph = connectGraphNodes(graph, { source: slope.id, target: grade.id });
    graph = connectGraphNodes(graph, { source: grade.id, target: TERRAIN_OUTPUT_ID });
    const result = compileTerrainGraph(graph);
    expect(result.ok).toBe(true);
    expect(result.program.slotCount).toBe(3);
    expect(result.program.colorSlotCount).toBe(3);
    expect(result.program.colorBody).toContain('applyTerrainGraphColor');
    expect(result.program.colorBody).toContain('uGraphColorA');
    expect(result.program.packUniforms().colorA).toHaveLength(8);
    expect(Number.isFinite(result.program.evaluate2D(12.5, -7.25, ctx))).toBe(true);
  });

  it('keeps the height shader signature stable for color-only graph changes', () => {
    let heightOnly = createBlankGraph('terrain');
    heightOnly = addGraphNode(heightOnly, 'mountainRange', { x: 0, y: 0 });
    heightOnly = connectGraphNodes(heightOnly, { source: heightOnly.nodes.at(-1).id, target: TERRAIN_OUTPUT_ID });
    let colored = addGraphNode(heightOnly, 'terrainGradient', { x: 0, y: 180 });
    colored = connectGraphNodes(colored, { source: colored.nodes.at(-1).id, target: TERRAIN_OUTPUT_ID, targetHandle: 'color' });
    const before = compileTerrainGraph(heightOnly).program;
    const after = compileTerrainGraph(colored).program;
    expect(after.sig).not.toBe(before.sig);
    expect(after.heightSig).toBe(before.heightSig);
  });

  it('rebuilds deterministic noise identically for the same seed and differently for another seed', () => {
    const make = (seed) => {
      let graph = createBlankGraph('terrain');
      graph = addGraphNode(graph, 'deterministicNoise', { x: 0, y: 0 }, { params: { seed, scale: 1.2, octaves: 6 } });
      graph = connectGraphNodes(graph, { source: graph.nodes.at(-1).id, target: TERRAIN_OUTPUT_ID });
      return compileTerrainGraph(graph).program.evaluate2D(42.25, -19.5, ctx);
    };
    expect(make(7842)).toBe(make(7842));
    expect(make(7843)).not.toBeCloseTo(make(7842), 8);
  });

  it('hashes large node seeds into a bounded GPU-safe noise domain', () => {
    let graph = createBlankGraph('terrain');
    graph = addGraphNode(graph, 'deterministicNoise', { x: 0, y: 0 }, { params: { seed: 999999 } });
    graph = connectGraphNodes(graph, { source: graph.nodes.at(-1).id, target: TERRAIN_OUTPUT_ID });
    const packedSeed = compileTerrainGraph(graph).program.packUniforms().seed[0];

    expect(packedSeed).toBe(seedDomainOffset(999999));
    expect(Math.abs(packedSeed)).toBeLessThanOrEqual(SEED_DOMAIN_RADIUS);
    expect(seedDomainOffset(5291)).not.toBe(seedDomainOffset(5292));
    expect(seedDomainOffset(0)).toBe(0);
  });

  it.each(listGraphNodeDefinitions().map((definition) => [definition.id]))('compiles, packs, and evaluates the %s registry node', (type) => {
    const { graph } = graphForRegistryNode(type);
    const result = compileTerrainGraph(graph);
    expect(result.ok).toBe(true);
    expect(result.program.body2d).toContain('float graph_');
    expect(result.program.packUniforms().strength).toHaveLength(12);
    expect(Number.isFinite(result.program.evaluate2D(12.5, -7.25, ctx))).toBe(true);
  });

  it.each(listGraphNodeDefinitions().filter((definition) => definition.structuralParams.length).map((definition) => [definition.id]))('changes the %s signature for its structural inspector parameter', (type) => {
    const { graph, node } = graphForRegistryNode(type);
    const definition = getGraphNodeDefinition(type);
    const key = definition.structuralParams[0];
    const field = definition.inspector.find((candidate) => candidate.key === key);
    const current = node.params[key];
    const nextValue = field.type === 'boolean' ? !current
      : field.type === 'enum' ? field.options.find((option) => option.value !== current).value
        : Math.min(field.max, Number(current) + (field.step || 1));
    const before = compileTerrainGraph(graph).program.sig;
    const after = compileTerrainGraph(updateGraphNodeParams(graph, node.id, { [key]: nextValue })).program.sig;
    expect(after).not.toBe(before);
  });

  it('compiles Current Terrain with the same structural stack and uniform slots', () => {
    const stack = makeStack([makeLayer('fbm', { params: { scale: 2, octaves: 3 } })]);
    const result = compileTerrainGraph(createGraphFromStack(stack));
    expect(result.ok).toBe(true);
    expect(result.program.body2d).toContain('__TERRAIN_GRAPH_FUNCTIONS__');
    expect(result.program.slotCount).toBe(1);
    expect(result.program.packUniforms().scale[0]).toBe(2);
  });

  it('allocates embedded Current Terrain layers before downstream analytical slots', () => {
    let graph = createGraphFromStack(makeStack([makeLayer('fbm', { params: { scale: 2 } }), makeLayer('ridged', { params: { scale: 3 } })]));
    graph = addGraphNode(graph, 'constant', { x: 180, y: 240 }, { params: { value: 0.5, strength: 0.75 } }); const constant = graph.nodes.at(-1);
    graph = addGraphNode(graph, 'combine', { x: 420, y: 150 }); const combine = graph.nodes.at(-1);
    graph = connectGraphNodes(graph, { source: 'current-terrain', target: combine.id, targetHandle: 'a' });
    graph = connectGraphNodes(graph, { source: constant.id, target: combine.id, targetHandle: 'b' });
    graph = connectGraphNodes(graph, { source: combine.id, target: TERRAIN_OUTPUT_ID });
    const result = compileTerrainGraph(graph);
    expect(result.ok).toBe(true);
    expect(result.program.packUniforms().scale.slice(0, 2)).toEqual([2, 3]);
    expect(result.program.packUniforms().strength[2]).toBe(0.75);
  });

  it('keeps the shader signature stable for continuous edits and changes it for structural edits', () => {
    let graph = createBlankGraph();
    graph = addGraphNode(graph, 'fbm', { x: 0, y: 0 }); const fbm = graph.nodes.at(-1);
    graph = connectGraphNodes(graph, { source: fbm.id, target: TERRAIN_OUTPUT_ID });
    const a = compileTerrainGraph(graph).program;
    const continuous = compileTerrainGraph(updateGraphNodeParams(graph, fbm.id, { strength: 0.2 })).program;
    const structural = compileTerrainGraph(updateGraphNodeParams(graph, fbm.id, { octaves: 7 })).program;
    expect(continuous.sig).toBe(a.sig);
    expect(continuous.packUniforms().strength[0]).toBe(0.2);
    expect(structural.sig).not.toBe(a.sig);
  });

  it('excludes labels, positions, and disconnected experiments from the structural signature', () => {
    let graph = createBlankGraph();
    graph = addGraphNode(graph, 'fbm', { x: 0, y: 0 }); const fbm = graph.nodes.at(-1);
    graph = connectGraphNodes(graph, { source: fbm.id, target: TERRAIN_OUTPUT_ID });
    const before = compileTerrainGraph(graph).program.sig;
    graph = moveGraphNodes(graph, { [fbm.id]: { x: 720, y: -240 } });
    graph.nodes = graph.nodes.map((node) => node.id === fbm.id ? { ...node, label: 'Renamed visual node' } : node);
    graph = addGraphNode(graph, 'ridged', { x: 100, y: 400 });
    expect(compileTerrainGraph(graph).program.sig).toBe(before);
  });

  it('repacks Terrain Output normalization and range without changing the shader signature', () => {
    let graph = createBlankGraph();
    graph = addGraphNode(graph, 'constant', { x: 0, y: 0 }); const constant = graph.nodes.at(-1);
    graph = connectGraphNodes(graph, { source: constant.id, target: TERRAIN_OUTPUT_ID });
    const before = compileTerrainGraph(graph).program;
    graph = updateGraphNodeParams(graph, TERRAIN_OUTPUT_ID, { normalize: true, outMin: -0.25, outMax: 1.8 });
    const after = compileTerrainGraph(graph).program;
    expect(after.sig).toBe(before.sig);
    expect(after.packUniforms()).toMatchObject({ normalize: true, outMin: -0.25, outMax: 1.8 });
  });

  it('generates and evaluates a source → math → remap → terrace pipeline', () => {
    let graph = createBlankGraph();
    graph = addGraphNode(graph, 'constant', { x: 0, y: 0 }, { params: { value: 0.25, strength: 1 } }); const constant = graph.nodes.at(-1);
    graph = addGraphNode(graph, 'math', { x: 100, y: 0 }, { params: { operation: 'multiply', value: 2 } }); const math = graph.nodes.at(-1);
    graph = addGraphNode(graph, 'remap', { x: 200, y: 0 }, { params: { inMin: 0, inMax: 1, outMin: 0, outMax: 2, clamp: true } }); const remap = graph.nodes.at(-1);
    graph = addGraphNode(graph, 'terrace', { x: 300, y: 0 }, { params: { count: 4, smoothness: 0.5, strength: 0 } }); const terrace = graph.nodes.at(-1);
    graph = connectGraphNodes(graph, { source: constant.id, target: math.id, targetHandle: 'source' });
    graph = connectGraphNodes(graph, { source: math.id, target: remap.id, targetHandle: 'source' });
    graph = connectGraphNodes(graph, { source: remap.id, target: terrace.id, targetHandle: 'source' });
    graph = connectGraphNodes(graph, { source: terrace.id, target: TERRAIN_OUTPUT_ID });
    const result = compileTerrainGraph(graph);
    expect(result.ok).toBe(true);
    expect(result.program.evaluate2D(0, 0, ctx)).toBeCloseTo(1, 5);
    expect(result.program.body2d).toContain('smoothstep');
  });

  it('returns diagnostics instead of compiling missing required inputs or unknown nodes', () => {
    let graph = createBlankGraph();
    graph = addGraphNode(graph, 'combine', { x: 0, y: 0 }); const combine = graph.nodes.at(-1);
    graph = connectGraphNodes(graph, { source: combine.id, target: TERRAIN_OUTPUT_ID });
    expect(compileTerrainGraph(graph).diagnostics.some((d) => d.code === 'missing-input')).toBe(true);
    const unknown = structuredClone(graph); unknown.nodes[0].type = 'futureRasterNode';
    expect(validateGraph(unknown).diagnostics.some((d) => d.code === 'unknown-node')).toBe(true);
  });
});
