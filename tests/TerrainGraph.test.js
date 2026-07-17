import { describe, expect, it } from 'vitest';
import { makeLayer, makeStack } from '../src/engine/terrain/noise/NoiseStack.js';
import {
  GraphValidationError, TERRAIN_OUTPUT_ID, addGraphNode, connectGraphNodes, createBlankGraph,
  createGraphFromStack, downstreamNodeIds, duplicateGraphSelection, graphCapacity, inputEdge,
  migrateGraphDocument, moveGraphNodes, reachableNodeIds, removeGraphNodes, topologicalSort,
  updateGraphNodeParams, validateGraph,
} from '../src/engine/terrain/graph/GraphDocument.js';
import { compileTerrainGraph } from '../src/engine/terrain/graph/GraphCompiler.js';
import { getGraphNodeDefinition, listGraphNodeDefinitions, nodeDefaults } from '../src/engine/terrain/graph/GraphRegistry.js';

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
    graph = addGraphNode(graph, 'constant', { x: 0, y: index * 100 }, { params: { value: 0.2 + index * 0.3, strength: 1 } });
    graph = connectGraphNodes(graph, { source: graph.nodes.at(-1).id, target: node.id, targetHandle: port.id });
  }
  graph = connectGraphNodes(graph, { source: node.id, target: TERRAIN_OUTPUT_ID });
  return { graph, node };
}

describe('terrain graph document', () => {
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
  it('characterizes every registry entry as plain JSON with typed analytical ports', () => {
    for (const definition of listGraphNodeDefinitions({ includeHidden: true })) {
      expect(getGraphNodeDefinition(definition.id)).toBe(definition);
      expect(structuredClone(nodeDefaults(definition.id))).toEqual(definition.defaults);
      expect(definition.executionKind).toBe('analytical');
      expect(definition.glslCompiler).toBeTypeOf('function');
      expect(definition.cpuEvaluator).toBeTypeOf('function');
      expect([...definition.inputs, ...definition.outputs].every((port) => port.type === 'analytic-height')).toBe(true);
      expect(JSON.parse(JSON.stringify(definition.defaults))).toEqual(definition.defaults);
    }
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
