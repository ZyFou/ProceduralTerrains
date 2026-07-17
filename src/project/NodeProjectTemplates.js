import {
  GRAPH_DOCUMENT_VERSION, TERRAIN_OUTPUT_ID, createBlankGraph, makeGraphNode,
} from '../engine/terrain/graph/GraphDocument.js';
import { ANALYTIC_HEIGHT } from '../engine/terrain/graph/GraphRegistry.js';

export const NODE_PROJECT_TEMPLATES = Object.freeze([
  { id: 'nodes-blank', name: 'Blank graph', description: 'A flat slab with only Terrain Output.', icon: 'boxes' },
  { id: 'nodes-alpine', name: 'Alpine ridges', description: 'Warped sharp ridges with subtle natural terraces.', icon: 'mountain' },
  { id: 'nodes-highlands', name: 'Layered highlands', description: 'Broad FBM landforms reinforced by mountain chains.', icon: 'layers' },
  { id: 'nodes-dunes', name: 'Wind dunes', description: 'Directional dunes with broad wind-shaped variation.', icon: 'waves' },
  { id: 'nodes-craters', name: 'Crater basin', description: 'Rolling ground broken by impact bowls and raised rims.', icon: 'orbit' },
  { id: 'nodes-rivers', name: 'River valleys', description: 'Meandering channels carved through rolling highlands.', icon: 'route' },
]);

export function nodeTemplatePreviewCacheKey(id) {
  return `terrain-template-preview:nodes-v1:${id}`;
}

const templateById = new Map(NODE_PROJECT_TEMPLATES.map((template) => [template.id, template]));

function buildGraph(templateId, nodeSpecs, connectionSpecs, outputParams = {}) {
  const ids = new Map();
  const nodes = nodeSpecs.map(({ key, type, position, params, label }) => {
    const id = `template-${templateId}-${key}`;
    ids.set(key, id);
    return makeGraphNode(type, position, { id, params, label });
  });
  const output = makeGraphNode('terrainOutput', { x: 760, y: 110 }, {
    id: TERRAIN_OUTPUT_ID,
    params: { normalize: false, outMin: 0, outMax: 1.25, ...outputParams },
  });
  ids.set('output', output.id);
  const edges = connectionSpecs.map(([source, target, targetHandle, sourceHandle = 'height'], index) => ({
    id: `template-${templateId}-edge-${index + 1}`,
    source: ids.get(source),
    sourceHandle,
    target: ids.get(target),
    targetHandle,
    type: ANALYTIC_HEIGHT,
  }));
  return { version: GRAPH_DOCUMENT_VERSION, nodes: [...nodes, output], edges };
}

const factories = {
  'nodes-blank': () => createBlankGraph(),
  'nodes-alpine': () => buildGraph('alpine', [
    { key: 'ridges', type: 'ridged', position: { x: 60, y: 110 }, params: { strength: 1.08, scale: 0.82, octaves: 6, persistence: 0.48, lacunarity: 2.12, sharpness: 2.85, erosion: 0.2, warp: 0.12, seedOffset: 0 } },
    { key: 'warp', type: 'domainWarp', position: { x: 290, y: 110 }, params: { strength: 0.52, scale: 0.78, octaves: 3, seedOffset: 7 } },
    { key: 'terrace', type: 'terrace', position: { x: 525, y: 110 }, params: { count: 18, smoothness: 0.62, strength: 0.26 } },
  ], [
    ['ridges', 'warp', 'source'], ['warp', 'terrace', 'source'], ['terrace', 'output', 'height'],
  ], { normalize: true, outMax: 2.35 }),
  'nodes-highlands': () => buildGraph('highlands', [
    { key: 'landforms', type: 'fbm', position: { x: 40, y: 40 }, params: { strength: 0.92, scale: 0.62, octaves: 6, persistence: 0.52, lacunarity: 2.02, erosion: 0.16, warp: 0.1, seedOffset: 0 } },
    { key: 'chains', type: 'ridged', position: { x: 40, y: 205 }, params: { strength: 0.48, scale: 1.36, octaves: 5, persistence: 0.47, lacunarity: 2.16, sharpness: 2.35, erosion: 0.12, warp: 0.08, seedOffset: 19 } },
    { key: 'combine', type: 'combine', position: { x: 300, y: 115 }, params: { operation: 'add', mix: 0.5 } },
    { key: 'remap', type: 'remap', position: { x: 535, y: 115 }, params: { inMin: 0.08, inMax: 1.28, outMin: 0, outMax: 1.12, clamp: true } },
  ], [
    ['landforms', 'combine', 'a'], ['chains', 'combine', 'b'], ['combine', 'remap', 'source'], ['remap', 'output', 'height'],
  ], { normalize: true, outMax: 1.95 }),
  'nodes-dunes': () => buildGraph('dunes', [
    { key: 'dunes', type: 'dune', position: { x: 35, y: 45 }, params: { strength: 0.88, scale: 1.18, windDir: 0.72, sharpness: 1.75, rippleScale: 5.4, rippleStrength: 0.18, seedOffset: 0 } },
    { key: 'swell', type: 'fbm', position: { x: 35, y: 205 }, params: { strength: 0.24, scale: 0.38, octaves: 4, persistence: 0.5, lacunarity: 2, erosion: 0, warp: 0, seedOffset: 31 } },
    { key: 'combine', type: 'combine', position: { x: 290, y: 115 }, params: { operation: 'add', mix: 0.5 } },
    { key: 'warp', type: 'domainWarp', position: { x: 525, y: 115 }, params: { strength: 0.3, scale: 0.66, octaves: 3, seedOffset: 13 } },
  ], [
    ['dunes', 'combine', 'a'], ['swell', 'combine', 'b'], ['combine', 'warp', 'source'], ['warp', 'output', 'height'],
  ], { normalize: true, outMax: 2.1 }),
  'nodes-craters': () => buildGraph('craters', [
    { key: 'ground', type: 'fbm', position: { x: 35, y: 45 }, params: { strength: 0.62, scale: 0.72, octaves: 5, persistence: 0.5, lacunarity: 2.08, erosion: 0.08, warp: 0.06, seedOffset: 0 } },
    { key: 'impacts', type: 'crater', position: { x: 35, y: 205 }, params: { strength: 0.58, scale: 1.42, density: 0.5, depth: 0.72, rim: 0.34, rimWidth: 0.32, seedOffset: 43 } },
    { key: 'combine', type: 'combine', position: { x: 300, y: 115 }, params: { operation: 'add', mix: 0.5 } },
    { key: 'remap', type: 'remap', position: { x: 535, y: 115 }, params: { inMin: -0.34, inMax: 1.05, outMin: 0, outMax: 1.05, clamp: true } },
  ], [
    ['ground', 'combine', 'a'], ['impacts', 'combine', 'b'], ['combine', 'remap', 'source'], ['remap', 'output', 'height'],
  ], { normalize: true, outMax: 1.9 }),
  'nodes-rivers': () => buildGraph('rivers', [
    { key: 'highlands', type: 'fbm', position: { x: 35, y: 45 }, params: { strength: 0.9, scale: 0.58, octaves: 6, persistence: 0.52, lacunarity: 2.05, erosion: 0.14, warp: 0.08, seedOffset: 0 } },
    { key: 'channels', type: 'flow', position: { x: 35, y: 205 }, params: { strength: 0.48, scale: 0.92, flowDir: 1.16, width: 0.24, meander: 1.65, meanderScale: 0.54, seedOffset: 23 } },
    { key: 'carve', type: 'combine', position: { x: 300, y: 115 }, params: { operation: 'subtract', mix: 0.5 } },
    { key: 'terrace', type: 'terrace', position: { x: 535, y: 115 }, params: { count: 22, smoothness: 0.78, strength: 0.12 } },
  ], [
    ['highlands', 'carve', 'a'], ['channels', 'carve', 'b'], ['carve', 'terrace', 'source'], ['terrace', 'output', 'height'],
  ], { normalize: true, outMin: -0.12, outMax: 1.72 }),
};

export function getNodeProjectTemplate(id) {
  return templateById.get(id) || NODE_PROJECT_TEMPLATES[0];
}

export function createNodeTemplateGraph(id) {
  return (factories[getNodeProjectTemplate(id).id] || factories['nodes-blank'])();
}

export function isNodeProjectTemplate(id) {
  return templateById.has(id);
}
