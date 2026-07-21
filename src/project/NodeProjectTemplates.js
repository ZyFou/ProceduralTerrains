import {
  GRAPH_DOCUMENT_VERSION, TERRAIN_OUTPUT_ID, connectGraphNodes, createBlankGraph, makeGraphNode,
} from '../engine/terrain/graph/GraphDocument.js';

export const NODE_PROJECT_TEMPLATES = Object.freeze([
  { id: 'nodes-blank', name: 'Blank graph', description: 'A flat slab with only Terrain Output.', icon: 'boxes' },
  { id: 'nodes-alpine', name: 'Alpine ridges', description: 'Weathered branching ridges with satellite-style alpine color.', icon: 'mountain' },
  { id: 'nodes-highlands', name: 'Layered highlands', description: 'Broad landforms, eroded rock structure, and temperate vegetation bands.', icon: 'layers' },
  { id: 'nodes-dunes', name: 'Wind dunes', description: 'Wind-shaped dune fields with mineral-rich arid grading.', icon: 'waves' },
  { id: 'nodes-craters', name: 'Crater basin', description: 'Eroded impact terrain with basalt, scoria, and ash coloration.', icon: 'orbit' },
  { id: 'nodes-rivers', name: 'River valleys', description: 'Carved drainage through damp coastal highlands.', icon: 'route' },
]);

export function nodeTemplatePreviewCacheKey(id) {
  return `terrain-template-preview:nodes-v3:${id}`;
}

const templateById = new Map(NODE_PROJECT_TEMPLATES.map((template) => [template.id, template]));

function buildGraph(templateId, nodeSpecs, connectionSpecs, outputParams = {}) {
  const ids = new Map();
  const sections = new Map();
  const nodes = nodeSpecs.map(({ key, type, position, params, label, section = 'Terrain recipe', sectionColor = 'slate' }) => {
    const id = `template-${templateId}-${key}`;
    ids.set(key, id);
    const node = makeGraphNode(type, position, { id, params, label });
    const bucket = sections.get(section) || { label: section, color: sectionColor, nodes: [] };
    bucket.nodes.push(node); sections.set(section, bucket);
    return node;
  });
  const maxX = Math.max(...nodes.map((node) => node.position.x), 520);
  const output = makeGraphNode('terrainOutput', { x: maxX + 245, y: 150 }, {
    id: TERRAIN_OUTPUT_ID,
    params: { normalize: false, outMin: 0, outMax: 1.25, ...outputParams },
  });
  ids.set('output', output.id);
  let graph = {
    version: GRAPH_DOCUMENT_VERSION,
    mode: 'terrain',
    nodes: [...nodes, output],
    edges: [],
    groups: [...sections.values()].map((section, index) => {
      const minX = Math.min(...section.nodes.map((node) => node.position.x));
      const maxSectionX = Math.max(...section.nodes.map((node) => node.position.x));
      const minY = Math.min(...section.nodes.map((node) => node.position.y));
      const maxY = Math.max(...section.nodes.map((node) => node.position.y));
      return {
        id: `template-${templateId}-group-${index + 1}`, label: section.label,
        position: { x: minX - 24, y: minY - 42 }, width: maxSectionX - minX + 224, height: maxY - minY + 154,
        nodeIds: section.nodes.map((node) => node.id), collapsed: false, color: section.color,
      };
    }),
  };
  connectionSpecs.forEach(([source, target, targetHandle, sourceHandle], index) => {
    graph = connectGraphNodes(graph, {
      id: `template-${templateId}-edge-${index + 1}`,
      source: ids.get(source), sourceHandle,
      target: ids.get(target), targetHandle,
    });
  });
  return graph;
}

const factories = {
  'nodes-blank': () => createBlankGraph('terrain'),
  'nodes-alpine': () => buildGraph('alpine', [
    { key: 'ridges', type: 'mountainRange', position: { x: 40, y: 70 }, section: 'Height synthesis', sectionColor: 'amber', params: { height: 1.3, scale: 0.72, direction: 0.7, width: 0.44, length: 2.7, sharpness: 2.1, roughness: 0.7, octaves: 6, persistence: 0.48, lacunarity: 2.12, seed: 1201 } },
    { key: 'warp', type: 'domainWarp', position: { x: 245, y: 70 }, section: 'Height synthesis', sectionColor: 'amber', params: { strength: 0.52, scale: 0.78, octaves: 3, seedOffset: 7 } },
    { key: 'erosion', type: 'naturalErosion', position: { x: 450, y: 70 }, section: 'Height synthesis', sectionColor: 'amber', params: { strength: 0.42, radius: 30, talus: 0.68, channels: 0.24, channelScale: 1.6, deposition: 0.2, seed: 1249 } },
    { key: 'geology', type: 'geologyDetail', position: { x: 655, y: 70 }, section: 'Height synthesis', sectionColor: 'amber', params: { strength: 0.085, scale: 4.1, roughness: 0.64, strata: 0.18, strataScale: 13, octaves: 5, persistence: 0.46, lacunarity: 2.2, seed: 1297 } },
    { key: 'gradient', type: 'terrainGradient', position: { x: 40, y: 285 }, section: 'Surface color', sectionColor: 'violet', params: { preset: 'alpine', lowPoint: 0.25, highPoint: 0.58, summitPoint: 0.84, variation: 0.18, macroScale: 0.46 } },
    { key: 'rock', type: 'slopeTint', position: { x: 245, y: 285 }, section: 'Surface color', sectionColor: 'violet', params: { rockColor: '#716d66', slopeStart: 0.16, slopeEnd: 0.5, strength: 0.8, variation: 0.14, scale: 0.9 } },
    { key: 'moisture', type: 'moistureTint', position: { x: 450, y: 285 }, section: 'Surface color', sectionColor: 'violet', params: { dryColor: '#80705d', wetColor: '#2e4938', amount: 0.22, balance: 0.46, softness: 0.2 } },
    { key: 'grade', type: 'colorGrade', position: { x: 655, y: 285 }, section: 'Surface color', sectionColor: 'violet', params: { saturation: 0.86, contrast: 1.07, exposure: 0.95, warmth: -0.04 } },
  ], [
    ['ridges', 'warp', 'source'], ['warp', 'erosion', 'source'], ['erosion', 'geology', 'source'], ['geology', 'output', 'height'],
    ['gradient', 'rock', 'base'], ['rock', 'moisture', 'base'], ['moisture', 'grade', 'base'], ['grade', 'output', 'color'],
  ], { normalize: true, outMax: 2.35 }),
  'nodes-highlands': () => buildGraph('highlands', [
    { key: 'landforms', type: 'mountain', position: { x: 35, y: 35 }, section: 'Height synthesis', sectionColor: 'green', params: { height: 1.05, scale: 0.58, radius: 1.5, sharpness: 1.25, roughness: 0.5, octaves: 6, persistence: 0.52, lacunarity: 2.02, seed: 1701 } },
    { key: 'chains', type: 'ridge', position: { x: 35, y: 175 }, section: 'Height synthesis', sectionColor: 'green', params: { height: 0.5, scale: 0.88, direction: 1.15, width: 0.34, sharpness: 2.4, breakup: 1.6, roughness: 0.35, octaves: 5, persistence: 0.47, lacunarity: 2.16, seed: 1901 } },
    { key: 'combine', type: 'combine', position: { x: 245, y: 95 }, section: 'Height synthesis', sectionColor: 'green', params: { operation: 'add', mix: 0.5 } },
    { key: 'erosion', type: 'naturalErosion', position: { x: 450, y: 95 }, section: 'Height synthesis', sectionColor: 'green', params: { strength: 0.46, radius: 46, talus: 0.58, channels: 0.32, channelScale: 1.18, deposition: 0.28, seed: 1987 } },
    { key: 'geology', type: 'geologyDetail', position: { x: 655, y: 95 }, section: 'Height synthesis', sectionColor: 'green', params: { strength: 0.07, scale: 3, roughness: 0.5, strata: 0.28, strataScale: 9, octaves: 5, persistence: 0.5, lacunarity: 2.08, seed: 2029 } },
    { key: 'gradient', type: 'terrainGradient', position: { x: 35, y: 340 }, section: 'Surface color', sectionColor: 'violet', params: { preset: 'temperate', lowPoint: 0.26, highPoint: 0.6, summitPoint: 0.9, variation: 0.22, macroScale: 0.34 } },
    { key: 'moisture', type: 'moistureTint', position: { x: 245, y: 340 }, section: 'Surface color', sectionColor: 'violet', params: { dryColor: '#78684f', wetColor: '#294536', amount: 0.36, balance: 0.48, softness: 0.2 } },
    { key: 'rock', type: 'slopeTint', position: { x: 450, y: 340 }, section: 'Surface color', sectionColor: 'violet', params: { rockColor: '#6e6b62', slopeStart: 0.2, slopeEnd: 0.58, strength: 0.68, variation: 0.12, scale: 0.7 } },
    { key: 'grade', type: 'colorGrade', position: { x: 655, y: 340 }, section: 'Surface color', sectionColor: 'violet', params: { saturation: 0.9, contrast: 1.04, exposure: 0.96, warmth: 0.03 } },
  ], [
    ['landforms', 'combine', 'a'], ['chains', 'combine', 'b'], ['combine', 'erosion', 'source'], ['erosion', 'geology', 'source'], ['geology', 'output', 'height'],
    ['gradient', 'moisture', 'base'], ['moisture', 'rock', 'base'], ['rock', 'grade', 'base'], ['grade', 'output', 'color'],
  ], { normalize: true, outMax: 1.95 }),
  'nodes-dunes': () => buildGraph('dunes', [
    { key: 'dunes', type: 'dune', position: { x: 35, y: 35 }, section: 'Height synthesis', sectionColor: 'amber', params: { strength: 0.88, scale: 1.18, windDir: 0.72, sharpness: 1.75, rippleScale: 5.4, rippleStrength: 0.18, seedOffset: 0 } },
    { key: 'swell', type: 'fbm', position: { x: 35, y: 175 }, section: 'Height synthesis', sectionColor: 'amber', params: { strength: 0.24, scale: 0.38, octaves: 4, persistence: 0.5, lacunarity: 2, erosion: 0, warp: 0, seedOffset: 31 } },
    { key: 'combine', type: 'combine', position: { x: 245, y: 95 }, section: 'Height synthesis', sectionColor: 'amber', params: { operation: 'add', mix: 0.5 } },
    { key: 'warp', type: 'domainWarp', position: { x: 450, y: 95 }, section: 'Height synthesis', sectionColor: 'amber', params: { strength: 0.3, scale: 0.66, octaves: 3, seedOffset: 13 } },
    { key: 'geology', type: 'geologyDetail', position: { x: 655, y: 95 }, section: 'Height synthesis', sectionColor: 'amber', params: { strength: 0.035, scale: 5.5, roughness: 0.28, strata: 0.2, strataScale: 17, octaves: 4, persistence: 0.44, lacunarity: 2.2, seed: 3019 } },
    { key: 'gradient', type: 'terrainGradient', position: { x: 35, y: 330 }, section: 'Surface color', sectionColor: 'violet', params: { preset: 'arid', lowPoint: 0.3, highPoint: 0.64, summitPoint: 0.92, variation: 0.2, macroScale: 0.58 } },
    { key: 'rock', type: 'slopeTint', position: { x: 245, y: 330 }, section: 'Surface color', sectionColor: 'violet', params: { rockColor: '#765643', slopeStart: 0.24, slopeEnd: 0.68, strength: 0.44, variation: 0.16, scale: 1.2 } },
    { key: 'grade', type: 'colorGrade', position: { x: 450, y: 330 }, section: 'Surface color', sectionColor: 'violet', params: { saturation: 0.84, contrast: 1.06, exposure: 1.02, warmth: 0.12 } },
  ], [
    ['dunes', 'combine', 'a'], ['swell', 'combine', 'b'], ['combine', 'warp', 'source'], ['warp', 'geology', 'source'], ['geology', 'output', 'height'],
    ['gradient', 'rock', 'base'], ['rock', 'grade', 'base'], ['grade', 'output', 'color'],
  ], { normalize: true, outMax: 2.1 }),
  'nodes-craters': () => buildGraph('craters', [
    { key: 'ground', type: 'deterministicNoise', position: { x: 35, y: 35 }, section: 'Height synthesis', sectionColor: 'amber', params: { strength: 0.62, scale: 0.72, octaves: 5, persistence: 0.5, lacunarity: 2.08, erosion: 0.08, warp: 0.06, seed: 4301 } },
    { key: 'impacts', type: 'singleCrater', position: { x: 35, y: 175 }, section: 'Height synthesis', sectionColor: 'amber', params: { depth: 0.72, scale: 0.82, radius: 0.9, rimHeight: 0.4, rimWidth: 0.2, roughness: 0.18, octaves: 4, seed: 4403 } },
    { key: 'combine', type: 'combine', position: { x: 245, y: 95 }, section: 'Height synthesis', sectionColor: 'amber', params: { operation: 'add', mix: 0.5 } },
    { key: 'erosion', type: 'naturalErosion', position: { x: 450, y: 95 }, section: 'Height synthesis', sectionColor: 'amber', params: { strength: 0.32, radius: 28, talus: 0.74, channels: 0.12, channelScale: 1.8, deposition: 0.16, seed: 4451 } },
    { key: 'geology', type: 'geologyDetail', position: { x: 655, y: 95 }, section: 'Height synthesis', sectionColor: 'amber', params: { strength: 0.09, scale: 4.8, roughness: 0.7, strata: 0.12, strataScale: 14, octaves: 5, persistence: 0.5, lacunarity: 2.22, seed: 4493 } },
    { key: 'gradient', type: 'terrainGradient', position: { x: 35, y: 330 }, section: 'Surface color', sectionColor: 'violet', params: { preset: 'volcanic', lowPoint: 0.3, highPoint: 0.62, summitPoint: 0.9, variation: 0.24, macroScale: 0.62 } },
    { key: 'rock', type: 'slopeTint', position: { x: 245, y: 330 }, section: 'Surface color', sectionColor: 'violet', params: { rockColor: '#49433d', slopeStart: 0.18, slopeEnd: 0.52, strength: 0.74, variation: 0.2, scale: 1.1 } },
    { key: 'grade', type: 'colorGrade', position: { x: 450, y: 330 }, section: 'Surface color', sectionColor: 'violet', params: { saturation: 0.72, contrast: 1.12, exposure: 0.88, warmth: 0.03 } },
  ], [
    ['ground', 'combine', 'a'], ['impacts', 'combine', 'b'], ['combine', 'erosion', 'source'], ['erosion', 'geology', 'source'], ['geology', 'output', 'height'],
    ['gradient', 'rock', 'base'], ['rock', 'grade', 'base'], ['grade', 'output', 'color'],
  ], { normalize: true, outMax: 1.9 }),
  'nodes-rivers': () => buildGraph('rivers', [
    { key: 'highlands', type: 'mountainRange', position: { x: 35, y: 35 }, section: 'Height synthesis', sectionColor: 'cyan', params: { height: 1.05, scale: 0.58, direction: 0.85, width: 0.6, length: 3.2, sharpness: 1.45, roughness: 0.75, octaves: 6, persistence: 0.52, lacunarity: 2.05, seed: 5101 } },
    { key: 'channels', type: 'flow', position: { x: 35, y: 175 }, section: 'Height synthesis', sectionColor: 'cyan', params: { strength: 0.48, scale: 0.92, flowDir: 1.16, width: 0.24, meander: 1.65, meanderScale: 0.54, seedOffset: 23 } },
    { key: 'carve', type: 'combine', position: { x: 245, y: 95 }, section: 'Height synthesis', sectionColor: 'cyan', params: { operation: 'subtract', mix: 0.5 } },
    { key: 'erosion', type: 'naturalErosion', position: { x: 450, y: 95 }, section: 'Height synthesis', sectionColor: 'cyan', params: { strength: 0.5, radius: 42, talus: 0.55, channels: 0.44, channelScale: 1.08, deposition: 0.34, seed: 5179 } },
    { key: 'geology', type: 'geologyDetail', position: { x: 655, y: 95 }, section: 'Height synthesis', sectionColor: 'cyan', params: { strength: 0.055, scale: 3.4, roughness: 0.46, strata: 0.2, strataScale: 10, octaves: 5, persistence: 0.52, lacunarity: 2.05, seed: 5227 } },
    { key: 'gradient', type: 'terrainGradient', position: { x: 35, y: 330 }, section: 'Surface color', sectionColor: 'violet', params: { preset: 'coastal', lowPoint: 0.26, highPoint: 0.58, summitPoint: 0.86, variation: 0.2, macroScale: 0.4 } },
    { key: 'moisture', type: 'moistureTint', position: { x: 245, y: 330 }, section: 'Surface color', sectionColor: 'violet', params: { dryColor: '#746955', wetColor: '#27483a', amount: 0.44, balance: 0.43, softness: 0.22 } },
    { key: 'rock', type: 'slopeTint', position: { x: 450, y: 330 }, section: 'Surface color', sectionColor: 'violet', params: { rockColor: '#6c716c', slopeStart: 0.2, slopeEnd: 0.6, strength: 0.62, variation: 0.14, scale: 0.74 } },
    { key: 'grade', type: 'colorGrade', position: { x: 655, y: 330 }, section: 'Surface color', sectionColor: 'violet', params: { saturation: 0.9, contrast: 1.04, exposure: 0.94, warmth: -0.05 } },
  ], [
    ['highlands', 'carve', 'a'], ['channels', 'carve', 'b'], ['carve', 'erosion', 'source'], ['erosion', 'geology', 'source'], ['geology', 'output', 'height'],
    ['gradient', 'moisture', 'base'], ['moisture', 'rock', 'base'], ['rock', 'grade', 'base'], ['grade', 'output', 'color'],
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
