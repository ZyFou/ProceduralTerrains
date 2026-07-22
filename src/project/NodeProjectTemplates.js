import {
  GRAPH_DOCUMENT_VERSION, TERRAIN_OUTPUT_ID, connectGraphNodes, createBlankGraph, makeGraphNode,
} from '../engine/terrain/graph/GraphDocument.js';

export const NODE_PROJECT_TEMPLATES = Object.freeze([
  { id: 'nodes-blank', name: 'Blank graph', description: 'A flat slab with only Terrain Output.', icon: 'boxes' },
  { id: 'nodes-alpine', name: 'Alpine ridges', description: 'A staged massif with shaped body, broken strata, scree, drainage, and alpine surface color.', icon: 'mountain' },
  { id: 'nodes-highlands', name: 'Layered highlands', description: 'Broad combined landforms with mass shaping, strata, thermal weathering, and temperate color.', icon: 'layers' },
  { id: 'nodes-dunes', name: 'Wind dunes', description: 'Asymmetric dune seas with slip faces, macro undulation, sand ripples, and warm desert grading.', icon: 'waves' },
  { id: 'nodes-canyon', name: 'River canyon', description: 'A drainage-led canyon with a meandering slot, branching gullies, eroded strata, and sandstone color.', icon: 'route' },
  { id: 'nodes-craters', name: 'Crater basin', description: 'Eroded impact terrain with basalt, scoria, and ash coloration.', icon: 'orbit' },
  { id: 'nodes-rivers', name: 'River valleys', description: 'A continuous river trunk, converging tributaries, floodplain shaping, and damp valley color.', icon: 'route' },
]);

export function nodeTemplatePreviewCacheKey(id) {
  return `terrain-template-preview:nodes-v6:${id}`;
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
    { key: 'ridges', type: 'mountain', position: { x: 40, y: 70 }, section: 'Height synthesis', sectionColor: 'amber', params: { style: 'alpine', bulk: 'high', scale: 0.55, height: 1.45, reduceDetails: true, seed: 1201, x: 0, y: 0 } },
    { key: 'shaper', type: 'shaper', position: { x: 245, y: 70 }, section: 'Height synthesis', sectionColor: 'amber', params: { shape: 0.46, strength: 0.86, featureScale: 48, detailPreservation: 0.86 } },
    { key: 'warp', type: 'domainWarp', position: { x: 450, y: 70 }, section: 'Height synthesis', sectionColor: 'amber', params: { scale: 0.9, strength: 0.38, perturbation: 0.28, octaves: 3, roughness: 0.48, seedOffset: 7 } },
    { key: 'strata', type: 'stratify', position: { x: 655, y: 70 }, section: 'Height synthesis', sectionColor: 'amber', params: { spacing: 0.095, intensity: 0.28, shape: 0.68, tilt: 0.14, direction: 0.8, octaves: 4, seed: 1279 } },
    { key: 'thermal', type: 'thermalErosion', position: { x: 860, y: 70 }, section: 'Height synthesis', sectionColor: 'amber', params: { duration: 16, strength: 0.56, featureScale: 24, talusAngle: 38, anisotropy: 0.16, settling: 0.68, sedimentRemoval: 0.16, seed: 1319 } },
    { key: 'erosion', type: 'naturalErosion', position: { x: 1065, y: 70 }, section: 'Height synthesis', sectionColor: 'amber', params: { strength: 0.32, radius: 26, talus: 0.68, channels: 0.24, channelScale: 1.6, deposition: 0.18, seed: 1361 } },
    { key: 'geology', type: 'geologyDetail', position: { x: 1270, y: 70 }, section: 'Height synthesis', sectionColor: 'amber', params: { strength: 0.055, scale: 4.3, roughness: 0.58, strata: 0.1, strataScale: 14, octaves: 4, persistence: 0.44, lacunarity: 2.18, seed: 1409 } },
    { key: 'gradient', type: 'terrainGradient', position: { x: 40, y: 285 }, section: 'Surface color', sectionColor: 'violet', params: { preset: 'alpine', lowPoint: 0.25, highPoint: 0.58, summitPoint: 0.84, variation: 0.18, macroScale: 0.46 } },
    { key: 'rock', type: 'slopeTint', position: { x: 245, y: 285 }, section: 'Surface color', sectionColor: 'violet', params: { rockColor: '#716d66', slopeStart: 0.16, slopeEnd: 0.5, strength: 0.8, variation: 0.14, scale: 0.9 } },
    { key: 'moisture', type: 'moistureTint', position: { x: 450, y: 285 }, section: 'Surface color', sectionColor: 'violet', params: { dryColor: '#80705d', wetColor: '#2e4938', amount: 0.22, balance: 0.46, softness: 0.2 } },
    { key: 'grade', type: 'colorGrade', position: { x: 655, y: 285 }, section: 'Surface color', sectionColor: 'violet', params: { saturation: 0.86, contrast: 1.07, exposure: 0.95, warmth: -0.04 } },
  ], [
    ['ridges', 'shaper', 'source'], ['shaper', 'warp', 'source'], ['warp', 'strata', 'source'], ['strata', 'thermal', 'source'],
    ['thermal', 'erosion', 'source'], ['erosion', 'geology', 'source'], ['geology', 'output', 'height'],
    ['gradient', 'rock', 'base'], ['rock', 'moisture', 'base'], ['moisture', 'grade', 'base'], ['grade', 'output', 'color'],
  ], { normalize: true, outMax: 2.35 }),
  'nodes-highlands': () => buildGraph('highlands', [
    { key: 'landforms', type: 'mountain', position: { x: 35, y: 35 }, section: 'Height synthesis', sectionColor: 'green', params: { style: 'old', bulk: 'high', height: 1.12, scale: 0.62, reduceDetails: true, seed: 1701, x: -0.12, y: 0.04 } },
    { key: 'chains', type: 'ridge', position: { x: 35, y: 175 }, section: 'Height synthesis', sectionColor: 'green', params: { height: 0.5, scale: 0.88, direction: 1.15, width: 0.34, sharpness: 2.4, breakup: 1.6, roughness: 0.35, octaves: 5, persistence: 0.47, lacunarity: 2.16, seed: 1901 } },
    { key: 'combine', type: 'combine', position: { x: 245, y: 95 }, section: 'Height synthesis', sectionColor: 'green', params: { operation: 'add', mix: 0.5 } },
    { key: 'shaper', type: 'shaper', position: { x: 450, y: 95 }, section: 'Height synthesis', sectionColor: 'green', params: { shape: 0.3, strength: 0.72, featureScale: 58, detailPreservation: 0.8 } },
    { key: 'strata', type: 'stratify', position: { x: 655, y: 95 }, section: 'Height synthesis', sectionColor: 'green', params: { spacing: 0.14, intensity: 0.22, shape: 0.54, tilt: 0.2, direction: 1.1, octaves: 3, seed: 1949 } },
    { key: 'thermal', type: 'thermalErosion', position: { x: 860, y: 95 }, section: 'Height synthesis', sectionColor: 'green', params: { duration: 13, strength: 0.48, featureScale: 38, talusAngle: 34, anisotropy: 0.2, settling: 0.76, sedimentRemoval: 0.12, seed: 1987 } },
    { key: 'erosion', type: 'naturalErosion', position: { x: 1065, y: 95 }, section: 'Height synthesis', sectionColor: 'green', params: { strength: 0.38, radius: 46, talus: 0.58, channels: 0.32, channelScale: 1.18, deposition: 0.28, seed: 2029 } },
    { key: 'geology', type: 'geologyDetail', position: { x: 1270, y: 95 }, section: 'Height synthesis', sectionColor: 'green', params: { strength: 0.045, scale: 3, roughness: 0.5, strata: 0.1, strataScale: 9, octaves: 4, persistence: 0.5, lacunarity: 2.08, seed: 2053 } },
    { key: 'gradient', type: 'terrainGradient', position: { x: 35, y: 340 }, section: 'Surface color', sectionColor: 'violet', params: { preset: 'temperate', lowPoint: 0.26, highPoint: 0.6, summitPoint: 0.9, variation: 0.22, macroScale: 0.34 } },
    { key: 'moisture', type: 'moistureTint', position: { x: 245, y: 340 }, section: 'Surface color', sectionColor: 'violet', params: { dryColor: '#78684f', wetColor: '#294536', amount: 0.36, balance: 0.48, softness: 0.2 } },
    { key: 'rock', type: 'slopeTint', position: { x: 450, y: 340 }, section: 'Surface color', sectionColor: 'violet', params: { rockColor: '#6e6b62', slopeStart: 0.2, slopeEnd: 0.58, strength: 0.68, variation: 0.12, scale: 0.7 } },
    { key: 'grade', type: 'colorGrade', position: { x: 655, y: 340 }, section: 'Surface color', sectionColor: 'violet', params: { saturation: 0.9, contrast: 1.04, exposure: 0.96, warmth: 0.03 } },
  ], [
    ['landforms', 'combine', 'a'], ['chains', 'combine', 'b'], ['combine', 'shaper', 'source'], ['shaper', 'strata', 'source'],
    ['strata', 'thermal', 'source'], ['thermal', 'erosion', 'source'], ['erosion', 'geology', 'source'], ['geology', 'output', 'height'],
    ['gradient', 'moisture', 'base'], ['moisture', 'rock', 'base'], ['rock', 'grade', 'base'], ['grade', 'output', 'color'],
  ], { normalize: true, outMax: 1.95 }),
  'nodes-dunes': () => buildGraph('dunes', [
    { key: 'dunes', type: 'duneSea', position: { x: 35, y: 80 }, section: 'Height synthesis', sectionColor: 'amber', params: { duneType: 'barchan', chaos: 'low', undulation: 'low', scale: 0.82, direction: 0.72, height: 0.72, softness: 0.68, sharpness: 1.35, seed: 3001 } },
    { key: 'warp', type: 'domainWarp', position: { x: 245, y: 80 }, section: 'Height synthesis', sectionColor: 'amber', params: { strength: 0.1, scale: 0.44, perturbation: 0.1, octaves: 2, roughness: 0.4, seedOffset: 13 } },
    { key: 'shape', type: 'shaper', position: { x: 450, y: 80 }, section: 'Height synthesis', sectionColor: 'amber', params: { shape: -0.08, strength: 0.26, featureScale: 62, detailPreservation: 0.98 } },
    { key: 'sand', type: 'geologyDetail', position: { x: 655, y: 80 }, section: 'Height synthesis', sectionColor: 'amber', params: { strength: 0.01, scale: 10.4, roughness: 0.12, strata: 0.008, strataScale: 22, octaves: 3, persistence: 0.36, lacunarity: 2.16, seed: 3019 } },
    { key: 'gradient', type: 'terrainGradient', position: { x: 35, y: 300 }, section: 'Surface color', sectionColor: 'violet', params: { preset: 'dunes', lowPoint: 0.24, highPoint: 0.62, summitPoint: 0.88, variation: 0.16, macroScale: 0.56 } },
    { key: 'rock', type: 'slopeTint', position: { x: 245, y: 300 }, section: 'Surface color', sectionColor: 'violet', params: { rockColor: '#8a6544', slopeStart: 0.22, slopeEnd: 0.62, strength: 0.32, variation: 0.12, scale: 1.14 } },
    { key: 'grade', type: 'colorGrade', position: { x: 450, y: 300 }, section: 'Surface color', sectionColor: 'violet', params: { saturation: 0.94, contrast: 1.05, exposure: 1.03, warmth: 0.1 } },
  ], [
    ['dunes', 'warp', 'source'], ['warp', 'shape', 'source'], ['shape', 'sand', 'source'], ['sand', 'output', 'height'],
    ['gradient', 'rock', 'base'], ['rock', 'grade', 'base'], ['grade', 'output', 'color'],
  ], { normalize: true, outMax: 3.2 }),
  'nodes-canyon': () => buildGraph('canyon', [
    { key: 'canyon', type: 'canyon', position: { x: 35, y: 75 }, section: 'Height synthesis', sectionColor: 'amber', params: { style: 'both', scale: 0.68, slot: 0.2, valley: 2.45, surrounding: 0.82, depth: 0.98, structuralWarp: 0.74, formation: 0.8, detailWarp: 0.38, alternateStyle: 0.28, seed: 3607 } },
    { key: 'strata', type: 'stratify', position: { x: 245, y: 75 }, section: 'Height synthesis', sectionColor: 'amber', params: { spacing: 0.14, intensity: 0.17, shape: 0.6, tilt: 0.2, direction: 0.74, octaves: 3, seed: 3659 } },
    { key: 'thermal', type: 'thermalErosion', position: { x: 450, y: 75 }, section: 'Height synthesis', sectionColor: 'amber', params: { duration: 10, strength: 0.34, featureScale: 34, talusAngle: 38, anisotropy: 0.18, settling: 0.62, sedimentRemoval: 0.2, seed: 3697 } },
    { key: 'erosion', type: 'naturalErosion', position: { x: 655, y: 75 }, section: 'Height synthesis', sectionColor: 'amber', params: { strength: 0.24, radius: 32, talus: 0.64, channels: 0.16, channelScale: 1.35, deposition: 0.18, seed: 3733 } },
    { key: 'geology', type: 'geologyDetail', position: { x: 860, y: 75 }, section: 'Height synthesis', sectionColor: 'amber', params: { strength: 0.04, scale: 4.2, roughness: 0.48, strata: 0.18, strataScale: 12, octaves: 4, persistence: 0.46, lacunarity: 2.12, seed: 3769 } },
    { key: 'gradient', type: 'terrainGradient', position: { x: 35, y: 300 }, section: 'Surface color', sectionColor: 'violet', params: { preset: 'canyon', lowPoint: 0.24, highPoint: 0.64, summitPoint: 0.9, variation: 0.22, macroScale: 0.48 } },
    { key: 'rock', type: 'slopeTint', position: { x: 245, y: 300 }, section: 'Surface color', sectionColor: 'violet', params: { rockColor: '#704733', slopeStart: 0.16, slopeEnd: 0.52, strength: 0.7, variation: 0.18, scale: 0.92 } },
    { key: 'grade', type: 'colorGrade', position: { x: 450, y: 300 }, section: 'Surface color', sectionColor: 'violet', params: { saturation: 0.9, contrast: 1.09, exposure: 0.98, warmth: 0.08 } },
  ], [
    ['canyon', 'strata', 'source'], ['strata', 'thermal', 'source'], ['thermal', 'erosion', 'source'], ['erosion', 'geology', 'source'], ['geology', 'output', 'height'],
    ['gradient', 'rock', 'base'], ['rock', 'grade', 'base'], ['grade', 'output', 'color'],
  ], { normalize: true, outMin: -0.25, outMax: 1.9 }),
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
    { key: 'highlands', type: 'mountain', position: { x: 35, y: 75 }, section: 'Height synthesis', sectionColor: 'cyan', params: { style: 'old', bulk: 'medium', scale: 0.56, height: 0.96, reduceDetails: true, seed: 5101, x: -0.08, y: 0.04 } },
    { key: 'shape', type: 'shaper', position: { x: 245, y: 75 }, section: 'Height synthesis', sectionColor: 'cyan', params: { shape: -0.18, strength: 0.46, featureScale: 72, detailPreservation: 0.86 } },
    { key: 'river', type: 'riverCarve', position: { x: 450, y: 75 }, section: 'Height synthesis', sectionColor: 'cyan', params: { water: 0.92, width: 0.14, depth: 0.32, downcutting: 0.68, valleyWidth: 2.6, headwaters: 5, direction: 1.06, meander: 0.78, seed: 5147 } },
    { key: 'thermal', type: 'thermalErosion', position: { x: 655, y: 75 }, section: 'Height synthesis', sectionColor: 'cyan', params: { duration: 7, strength: 0.22, featureScale: 46, talusAngle: 34, anisotropy: 0.12, settling: 0.74, sedimentRemoval: 0.12, seed: 5179 } },
    { key: 'erosion', type: 'naturalErosion', position: { x: 860, y: 75 }, section: 'Height synthesis', sectionColor: 'cyan', params: { strength: 0.22, radius: 54, talus: 0.6, channels: 0.18, channelScale: 0.9, deposition: 0.3, seed: 5209 } },
    { key: 'geology', type: 'geologyDetail', position: { x: 1065, y: 75 }, section: 'Height synthesis', sectionColor: 'cyan', params: { strength: 0.022, scale: 3.1, roughness: 0.3, strata: 0.018, strataScale: 9, octaves: 3, persistence: 0.44, lacunarity: 2.04, seed: 5227 } },
    { key: 'gradient', type: 'terrainGradient', position: { x: 35, y: 300 }, section: 'Surface color', sectionColor: 'violet', params: { preset: 'river', lowPoint: 0.22, highPoint: 0.58, summitPoint: 0.88, variation: 0.2, macroScale: 0.34 } },
    { key: 'moisture', type: 'moistureTint', position: { x: 245, y: 300 }, section: 'Surface color', sectionColor: 'violet', params: { dryColor: '#756b57', wetColor: '#1d463b', amount: 0.5, balance: 0.4, softness: 0.24 } },
    { key: 'rock', type: 'slopeTint', position: { x: 450, y: 300 }, section: 'Surface color', sectionColor: 'violet', params: { rockColor: '#6b706c', slopeStart: 0.22, slopeEnd: 0.62, strength: 0.52, variation: 0.12, scale: 0.68 } },
    { key: 'grade', type: 'colorGrade', position: { x: 655, y: 300 }, section: 'Surface color', sectionColor: 'violet', params: { saturation: 0.92, contrast: 1.03, exposure: 0.96, warmth: -0.04 } },
  ], [
    ['highlands', 'shape', 'source'], ['shape', 'river', 'source'], ['river', 'thermal', 'source'], ['thermal', 'erosion', 'source'], ['erosion', 'geology', 'source'], ['geology', 'output', 'height'],
    ['gradient', 'moisture', 'base'], ['moisture', 'rock', 'base'], ['rock', 'grade', 'base'], ['grade', 'output', 'color'],
  ], { normalize: true, outMin: -0.24, outMax: 1.42 }),
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
