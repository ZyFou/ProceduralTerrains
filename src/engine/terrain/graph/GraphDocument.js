import { cloneStack, defaultLegacyStack, migrateStack } from '../noise/NoiseStack.js';
import {
  ANALYTIC_HEIGHT, GRAPH_CAPACITY, GRAPH_COLOR_CAPACITY, getGraphNodeDefinition, nodeDefaults,
} from './GraphRegistry.js';

export const GRAPH_DOCUMENT_VERSION = 3;
export const TERRAIN_OUTPUT_ID = 'terrain-output';
export const DEFAULT_GRAPH_VIEW = Object.freeze({ x: 0, y: 0, zoom: 1 });
export const GRAPH_MODES = Object.freeze(['noise', 'terrain']);

const clone = (value) => structuredClone(value);
const uid = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
const graphMode = (mode, fallback = 'terrain') => GRAPH_MODES.includes(mode) ? mode : fallback;

export class GraphValidationError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'GraphValidationError'; this.code = code; this.details = details; }
}

export function makeGraphNode(type, position = { x: 0, y: 0 }, overrides = {}) {
  const definition = getGraphNodeDefinition(type);
  if (!definition) throw new GraphValidationError('unknown-node', `Unknown terrain node type “${type}”.`);
  const id = overrides.id || (type === 'terrainOutput' ? TERRAIN_OUTPUT_ID : uid('node'));
  return {
    id, type,
    label: overrides.label || definition.label,
    position: { x: Number(position.x) || 0, y: Number(position.y) || 0 },
    params: { ...nodeDefaults(type), ...(overrides.params || {}) },
  };
}

export function createBlankGraph(mode = 'terrain') {
  return {
    version: GRAPH_DOCUMENT_VERSION,
    mode: graphMode(mode),
    nodes: [makeGraphNode('terrainOutput', { x: 520, y: 90 })],
    edges: [],
    groups: [],
  };
}

export function createGraphFromStack(stack = defaultLegacyStack()) {
  const migratedStack = migrateStack(stack);
  const current = makeGraphNode('currentTerrain', { x: 220, y: 90 }, {
    id: 'current-terrain', params: { stack: cloneStack(migratedStack) },
  });
  const output = makeGraphNode('terrainOutput', { x: 560, y: 90 }, {
    params: {
      normalize: migratedStack.normalizeOutput === true,
      outMin: Number.isFinite(Number(migratedStack.outputMin)) ? Number(migratedStack.outputMin) : 0,
      outMax: Number.isFinite(Number(migratedStack.outputMax)) ? Number(migratedStack.outputMax) : 1.35,
    },
  });
  return {
    version: GRAPH_DOCUMENT_VERSION,
    mode: 'noise',
    nodes: [current, output],
    edges: [{ id: uid('edge'), source: current.id, sourceHandle: 'height', target: output.id, targetHandle: 'height', type: ANALYTIC_HEIGHT }],
    groups: [],
  };
}

export function migrateGraphDocument(raw, fallbackStack = defaultLegacyStack()) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    return createGraphFromStack(fallbackStack);
  }
  const nodes = raw.nodes
    .filter((node) => node && typeof node.id === 'string' && typeof node.type === 'string')
    .map((node) => getGraphNodeDefinition(node.type)
      ? makeGraphNode(node.type, node.position, {
        ...node,
        params: node.type === 'currentTerrain'
          ? { stack: cloneStack(migrateStack(node.params?.stack || fallbackStack)) }
          : { ...nodeDefaults(node.type), ...(node.params || {}) },
      })
      : {
        id: node.id, type: node.type, label: node.label || `Unknown: ${node.type}`,
        position: { x: Number(node.position?.x) || 0, y: Number(node.position?.y) || 0 },
        params: clone(node.params || {}),
      });
  let output = nodes.find((node) => node.type === 'terrainOutput');
  const oldOutputId = output?.id;
  const normalizedNodes = [...nodes];
  if (!output) { output = makeGraphNode('terrainOutput', { x: 520, y: 90 }); normalizedNodes.push(output); }
  output.id = TERRAIN_OUTPUT_ID;
  const idSet = new Set(normalizedNodes.map((node) => node.id));
  const edges = raw.edges
    .filter((edge) => edge && idSet.has(edge.source) && (idSet.has(edge.target) || edge.target === oldOutputId))
    .map((edge) => {
      const target = edge.target === oldOutputId ? TERRAIN_OUTPUT_ID : edge.target;
      const sourceNode = normalizedNodes.find((node) => node.id === edge.source);
      const targetNode = normalizedNodes.find((node) => node.id === target);
      const sourceDef = getGraphNodeDefinition(sourceNode?.type);
      const targetDef = getGraphNodeDefinition(targetNode?.type);
      const requestedType = edge.type || null;
      const sourcePort = sourceDef?.outputs.find((port) => port.id === edge.sourceHandle)
        || sourceDef?.outputs.find((port) => !requestedType || port.type === requestedType)
        || sourceDef?.outputs[0];
      const targetPort = targetDef?.inputs.find((port) => port.id === edge.targetHandle)
        || targetDef?.inputs.find((port) => port.type === (sourcePort?.type || requestedType))
        || targetDef?.inputs[0];
      return {
        id: edge.id || uid('edge'), source: edge.source, sourceHandle: sourcePort?.id || edge.sourceHandle || 'height',
        target, targetHandle: targetPort?.id || edge.targetHandle || 'height',
        type: sourcePort?.type || targetPort?.type || requestedType || ANALYTIC_HEIGHT,
      };
    });
  const claimedNodes = new Set();
  const groupIds = new Set();
  const groups = (Array.isArray(raw.groups) ? raw.groups : [])
    .filter((group) => group && typeof group.id === 'string' && !groupIds.has(group.id) && groupIds.add(group.id))
    .map((group, index) => {
      const nodeIds = [...new Set(Array.isArray(group.nodeIds) ? group.nodeIds : [])]
        .filter((nodeId) => idSet.has(nodeId) && !claimedNodes.has(nodeId) && claimedNodes.add(nodeId));
      return {
        id: group.id,
        label: String(group.label || `Group ${index + 1}`),
        position: { x: Number(group.position?.x) || 0, y: Number(group.position?.y) || 0 },
        width: Math.max(220, Number(group.width) || 420),
        height: Math.max(100, Number(group.height) || 240),
        nodeIds,
        collapsed: group.collapsed === true,
        color: ['slate', 'green', 'cyan', 'amber', 'violet'].includes(group.color) ? group.color : 'slate',
      };
    })
    .filter((group) => group.nodeIds.length > 0);
  const inferredMode = raw.mode ?? (Number(raw.version) < 2 ? 'noise' : 'terrain');
  return { version: GRAPH_DOCUMENT_VERSION, mode: graphMode(inferredMode), nodes: normalizedNodes, edges, groups };
}

export function findOutputNode(graph) { return graph.nodes.find((node) => node.type === 'terrainOutput') || null; }

export function inputEdge(graph, nodeId, handleId) {
  return graph.edges.find((edge) => edge.target === nodeId && edge.targetHandle === handleId) || null;
}

export function reachableNodeIds(graph) {
  const output = findOutputNode(graph);
  if (!output) return new Set();
  const incoming = new Map();
  for (const edge of graph.edges) {
    if (!incoming.has(edge.target)) incoming.set(edge.target, []);
    incoming.get(edge.target).push(edge.source);
  }
  const seen = new Set();
  const visit = (id) => { if (seen.has(id)) return; seen.add(id); for (const source of incoming.get(id) || []) visit(source); };
  visit(output.id);
  return seen;
}

export function topologicalSort(graph, { reachableOnly = false } = {}) {
  const allowed = reachableOnly ? reachableNodeIds(graph) : new Set(graph.nodes.map((node) => node.id));
  const indegree = new Map([...allowed].map((id) => [id, 0]));
  const outgoing = new Map([...allowed].map((id) => [id, []]));
  for (const edge of graph.edges) {
    if (!allowed.has(edge.source) || !allowed.has(edge.target)) continue;
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
    outgoing.get(edge.source).push(edge.target);
  }
  const queue = graph.nodes.filter((node) => allowed.has(node.id) && indegree.get(node.id) === 0).map((node) => node.id);
  const sorted = [];
  while (queue.length) {
    const id = queue.shift(); sorted.push(id);
    for (const target of outgoing.get(id) || []) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  if (sorted.length !== allowed.size) throw new GraphValidationError('cycle', 'Terrain graphs cannot contain cycles.');
  return sorted;
}

export function downstreamNodeIds(graph, changedIds) {
  const queue = Array.isArray(changedIds) ? [...changedIds] : [changedIds];
  const dirty = new Set(queue);
  while (queue.length) {
    const id = queue.shift();
    for (const edge of graph.edges) if (edge.source === id && !dirty.has(edge.target)) { dirty.add(edge.target); queue.push(edge.target); }
  }
  return dirty;
}

export function graphCapacity(graph) {
  const reachable = reachableNodeIds(graph);
  return graph.nodes.reduce((sum, node) => {
    if (!reachable.has(node.id)) return sum;
    return sum + (getGraphNodeDefinition(node.type)?.uniformSlots?.(node) || 0);
  }, 0);
}

export function graphColorCapacity(graph) {
  const reachable = reachableNodeIds(graph);
  return graph.nodes.reduce((sum, node) => {
    if (!reachable.has(node.id)) return sum;
    return sum + (getGraphNodeDefinition(node.type)?.colorUniformSlots?.(node) || 0);
  }, 0);
}

export function validateGraph(graph, { requireInputs = true, enforceCapacity = true } = {}) {
  const diagnostics = [];
  const nodes = new Map();
  let outputCount = 0;
  for (const node of graph?.nodes || []) {
    const definition = getGraphNodeDefinition(node.type);
    if (!definition) diagnostics.push({ code: 'unknown-node', nodeId: node.id, message: `Unknown node “${node.type}”.` });
    if (nodes.has(node.id)) diagnostics.push({ code: 'duplicate-node-id', nodeId: node.id, message: `Duplicate node id “${node.id}”.` });
    nodes.set(node.id, node);
    if (node.type === 'terrainOutput') outputCount++;
  }
  if (outputCount !== 1) diagnostics.push({ code: 'duplicate-output', message: 'A graph must contain exactly one Terrain Output.' });
  const incoming = new Set();
  for (const edge of graph?.edges || []) {
    const source = nodes.get(edge.source), target = nodes.get(edge.target);
    if (!source || !target) { diagnostics.push({ code: 'dangling-edge', edgeId: edge.id, message: 'A connection references a missing node.' }); continue; }
    if (source.id === target.id) diagnostics.push({ code: 'self-link', edgeId: edge.id, message: 'A node cannot connect to itself.' });
    const sourcePort = getGraphNodeDefinition(source.type)?.outputs.find((port) => port.id === edge.sourceHandle);
    const targetPort = getGraphNodeDefinition(target.type)?.inputs.find((port) => port.id === edge.targetHandle);
    if (!sourcePort || !targetPort || sourcePort.type !== targetPort.type || edge.type !== targetPort.type) {
      diagnostics.push({ code: 'incompatible-port', edgeId: edge.id, message: 'These ports are not compatible.' });
    }
    const inputKey = `${edge.target}:${edge.targetHandle}`;
    if (incoming.has(inputKey)) diagnostics.push({ code: 'multiple-input', edgeId: edge.id, message: 'An input accepts only one connection.' });
    incoming.add(inputKey);
  }
  try { topologicalSort(graph); } catch (error) { diagnostics.push({ code: 'cycle', message: error.message }); }
  if (requireInputs) {
    const reachable = reachableNodeIds(graph);
    for (const node of graph?.nodes || []) {
      if (!reachable.has(node.id)) continue;
      for (const port of getGraphNodeDefinition(node.type)?.inputs || []) {
        if (port.required && !inputEdge(graph, node.id, port.id)) diagnostics.push({ code: 'missing-input', nodeId: node.id, portId: port.id, message: `${node.label || node.type} requires ${port.label}.` });
      }
    }
  }
  if (enforceCapacity) {
    const capacity = graphCapacity(graph);
    if (capacity > GRAPH_CAPACITY) diagnostics.push({ code: 'capacity', message: `This graph needs ${capacity} parameter slots; the realtime limit is ${GRAPH_CAPACITY}.` });
    const colorCapacity = graphColorCapacity(graph);
    if (colorCapacity > GRAPH_COLOR_CAPACITY) diagnostics.push({ code: 'color-capacity', message: `This graph needs ${colorCapacity} color slots; the realtime limit is ${GRAPH_COLOR_CAPACITY}.` });
  }
  return { ok: diagnostics.length === 0, diagnostics };
}

export function addGraphNode(graph, type, position, overrides = {}) {
  const definition = getGraphNodeDefinition(type);
  if (definition?.singleton && graph.nodes.some((node) => node.type === type)) return graph;
  return { ...graph, nodes: [...graph.nodes, makeGraphNode(type, position, overrides)] };
}

export function updateGraphNode(graph, nodeId, patch) {
  return { ...graph, nodes: graph.nodes.map((node) => node.id === nodeId ? { ...node, ...clone(patch), id: node.id, type: node.type } : node) };
}

export function updateGraphNodeParams(graph, nodeId, patch) {
  return { ...graph, nodes: graph.nodes.map((node) => node.id === nodeId ? { ...node, params: { ...node.params, ...clone(patch) } } : node) };
}

export function moveGraphNodes(graph, positions) {
  return { ...graph, nodes: graph.nodes.map((node) => positions[node.id] ? { ...node, position: { ...positions[node.id] } } : node) };
}

export function setGraphMode(graph, mode) {
  const nextMode = graphMode(mode, graphMode(graph.mode));
  return nextMode === graph.mode ? graph : { ...graph, mode: nextMode };
}

export function groupGraphNodes(graph, nodeIds, options = {}) {
  const existing = new Set(graph.nodes.map((node) => node.id));
  const members = [...new Set(nodeIds)].filter((nodeId) => existing.has(nodeId));
  if (!members.length) return { graph, groupId: null };
  const memberSet = new Set(members);
  const groups = (graph.groups || [])
    .map((group) => ({ ...group, nodeIds: group.nodeIds.filter((nodeId) => !memberSet.has(nodeId)) }))
    .filter((group) => group.nodeIds.length > 0);
  const id = options.id || uid('group');
  const group = {
    id,
    label: String(options.label || `Group ${groups.length + 1}`),
    position: { x: Number(options.position?.x) || 0, y: Number(options.position?.y) || 0 },
    width: Math.max(220, Number(options.width) || 420),
    height: Math.max(100, Number(options.height) || 240),
    nodeIds: members,
    collapsed: options.collapsed === true,
    color: ['slate', 'green', 'cyan', 'amber', 'violet'].includes(options.color) ? options.color : 'slate',
  };
  return { graph: { ...graph, groups: [...groups, group] }, groupId: id };
}

export function updateGraphGroup(graph, groupId, patch) {
  return {
    ...graph,
    groups: (graph.groups || []).map((group) => group.id === groupId
      ? { ...group, ...clone(patch), id: group.id, nodeIds: [...group.nodeIds] }
      : group),
  };
}

export function moveGraphGroup(graph, groupId, position) {
  const group = (graph.groups || []).find((candidate) => candidate.id === groupId);
  if (!group) return graph;
  const nextPosition = { x: Number(position?.x) || 0, y: Number(position?.y) || 0 };
  const dx = nextPosition.x - group.position.x, dy = nextPosition.y - group.position.y;
  const members = new Set(group.nodeIds);
  return {
    ...graph,
    groups: graph.groups.map((candidate) => candidate.id === groupId ? { ...candidate, position: nextPosition } : candidate),
    nodes: graph.nodes.map((node) => members.has(node.id)
      ? { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } }
      : node),
  };
}

export function removeGraphGroups(graph, groupIds) {
  const ids = new Set(groupIds);
  return { ...graph, groups: (graph.groups || []).filter((group) => !ids.has(group.id)) };
}

export function removeGraphNodes(graph, nodeIds) {
  const ids = new Set(nodeIds);
  for (const node of graph.nodes) if (ids.has(node.id) && getGraphNodeDefinition(node.type)?.permanent) ids.delete(node.id);
  const groups = (graph.groups || [])
    .map((group) => ({ ...group, nodeIds: group.nodeIds.filter((nodeId) => !ids.has(nodeId)) }))
    .filter((group) => group.nodeIds.length > 0);
  return { ...graph, nodes: graph.nodes.filter((node) => !ids.has(node.id)), edges: graph.edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)), groups };
}

export function resolveGraphConnection(graph, connection) {
  const sourceNode = graph.nodes.find((node) => node.id === connection?.source);
  const targetNode = graph.nodes.find((node) => node.id === connection?.target);
  if (!sourceNode || !targetNode) throw new GraphValidationError('dangling-edge', 'Choose an existing source and target node.');
  if (sourceNode.id === targetNode.id) throw new GraphValidationError('self-link', 'A node cannot connect to itself.');

  const sourceDef = getGraphNodeDefinition(sourceNode.type);
  const targetDef = getGraphNodeDefinition(targetNode.type);
  const requestedSource = connection.sourceHandle
    ? sourceDef?.outputs.find((port) => port.id === connection.sourceHandle)
    : null;
  const requestedTarget = connection.targetHandle
    ? targetDef?.inputs.find((port) => port.id === connection.targetHandle)
    : null;
  if (connection.sourceHandle && !requestedSource) {
    throw new GraphValidationError('incompatible-port', `${sourceNode.label || sourceNode.type} has no “${connection.sourceHandle}” output.`);
  }
  if (connection.targetHandle && !requestedTarget) {
    throw new GraphValidationError('incompatible-port', `${targetNode.label || targetNode.type} has no “${connection.targetHandle}” input.`);
  }

  const sourceCandidates = requestedSource ? [requestedSource] : (sourceDef?.outputs || []);
  const targetCandidates = requestedTarget ? [requestedTarget] : (targetDef?.inputs || []);
  let pair = null;
  for (const sourcePort of sourceCandidates) {
    const targetPort = targetCandidates.find((port) => port.type === sourcePort.type
      && (!connection.type || connection.type === port.type));
    if (targetPort) { pair = { sourcePort, targetPort }; break; }
  }
  if (!pair) {
    const sourceLabel = requestedSource?.label || 'this output';
    const targetLabel = requestedTarget?.label || 'this input';
    throw new GraphValidationError('incompatible-port', `${sourceLabel} cannot connect to ${targetLabel}. Height and Color cables cannot be mixed.`);
  }

  return {
    id: connection.id || uid('edge'), source: sourceNode.id, sourceHandle: pair.sourcePort.id,
    target: targetNode.id, targetHandle: pair.targetPort.id, type: pair.sourcePort.type,
  };
}

export function canConnectGraphNodes(graph, connection) {
  try {
    const candidate = resolveGraphConnection(graph, connection);
    const next = {
      ...graph,
      edges: [...graph.edges.filter((edge) => !(edge.target === candidate.target && edge.targetHandle === candidate.targetHandle)), candidate],
    };
    return validateGraph(next, { requireInputs: false, enforceCapacity: false }).ok;
  } catch {
    return false;
  }
}

export function connectGraphNodes(graph, connection) {
  const candidate = resolveGraphConnection(graph, connection);
  const next = {
    ...graph,
    edges: [...graph.edges.filter((edge) => !(edge.target === candidate.target && edge.targetHandle === candidate.targetHandle)), candidate],
  };
  const validation = validateGraph(next, { requireInputs: false, enforceCapacity: false });
  if (!validation.ok) {
    const diagnostic = validation.diagnostics[0];
    throw new GraphValidationError(diagnostic.code, diagnostic.message, diagnostic);
  }
  return next;
}

export function removeGraphEdges(graph, edgeIds) {
  const ids = new Set(edgeIds);
  return { ...graph, edges: graph.edges.filter((edge) => !ids.has(edge.id)) };
}

export function duplicateGraphSelection(graph, nodeIds, offset = { x: 36, y: 36 }) {
  const selected = new Set(nodeIds);
  const idMap = new Map();
  const copies = [];
  for (const node of graph.nodes) {
    if (!selected.has(node.id) || node.type === 'terrainOutput') continue;
    const copy = clone(node); copy.id = uid('node'); copy.label = `${node.label} copy`;
    copy.position = { x: node.position.x + offset.x, y: node.position.y + offset.y };
    idMap.set(node.id, copy.id); copies.push(copy);
  }
  const edges = graph.edges.filter((edge) => idMap.has(edge.source) && idMap.has(edge.target)).map((edge) => ({
    ...edge, id: uid('edge'), source: idMap.get(edge.source), target: idMap.get(edge.target),
  }));
  return { graph: { ...graph, nodes: [...graph.nodes, ...copies], edges: [...graph.edges, ...edges] }, nodeIds: [...idMap.values()] };
}
