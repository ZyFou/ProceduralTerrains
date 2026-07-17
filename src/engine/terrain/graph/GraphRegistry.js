import { BLEND_LABELS } from '../noise/blendModes.js';
import { activeLayers } from '../noise/NoiseStack.js';
import { getNoiseType } from '../noise/noiseTypes.js';

export const ANALYTIC_HEIGHT = 'analytic-height';
export const GRAPH_CAPACITY = 12;

const input = (id, label, required = true) => ({ id, label, type: ANALYTIC_HEIGHT, required });
const output = (id = 'height', label = 'Height') => ({ id, label, type: ANALYTIC_HEIGHT });
const number = (key, label, min, max, step, value, extra = {}) => ({
  key, label, type: 'number', min, max, step, default: value, ...extra,
});
const select = (key, label, options, value, extra = {}) => ({
  key, label, type: 'enum', options, default: value, structural: true, ...extra,
});
const execute = (kind) => (context) => context[kind]();

const SOURCE_TYPES = ['fbm', 'ridged', 'billow', 'value', 'white', 'constant', 'voronoi', 'crater', 'dune', 'flow'];

function sourceDefinition(type) {
  const noise = getNoiseType(type);
  const inspector = [
    number('strength', 'Strength', -2, 2, 0.01, noise.defaultStrength ?? 1),
    number('seedOffset', 'Seed Offset', -999, 999, 1, 0),
    ...(noise.params || []).map((param) => ({ type: param.type || 'number', ...param })),
  ];
  return {
    id: type,
    label: type === 'crater' ? 'Crater Field' : noise.label,
    description: noise.desc,
    category: 'Noise',
    executionKind: 'analytical',
    inputs: [], outputs: [output()],
    inspector,
    defaults: Object.fromEntries(inspector.map((field) => [field.key, field.default])),
    structuralParams: inspector.filter((field) => field.structural).map((field) => field.key),
    uniformSlots: () => 1,
    glslCompiler: execute('source'), cpuEvaluator: execute('source'),
    noiseType: type,
    color: type === 'ridged' || type === 'crater' ? 'amber' : 'green',
  };
}

function deterministicNoiseDefinition() {
  const inspector = [
    number('strength', 'Amplitude', 0, 2, 0.01, 0.8, { section: 'Output' }),
    number('seed', 'Seed', 0, 999999, 1, 1337, { section: 'Variation' }),
    number('scale', 'Scale', 0.1, 20, 0.05, 1, { section: 'Fractal' }),
    number('octaves', 'Octaves', 1, 8, 1, 6, { structural: true, section: 'Fractal' }),
    number('persistence', 'Persistence', 0.15, 0.85, 0.01, 0.5, { section: 'Fractal' }),
    number('lacunarity', 'Lacunarity', 1.5, 3.5, 0.01, 2, { section: 'Fractal' }),
    number('erosion', 'Erosion', 0, 1, 0.01, 0.08, { section: 'Character' }),
    number('warp', 'Self Warp', 0, 1.5, 0.01, 0.12, { section: 'Character' }),
  ];
  return {
    id: 'deterministicNoise', label: 'Deterministic Noise', category: 'Base', color: 'green',
    description: 'A seeded fractal source that produces the same terrain for the same seed on every build.',
    executionKind: 'analytical', inputs: [], outputs: [output()], inspector,
    defaults: Object.fromEntries(inspector.map((field) => [field.key, field.default])),
    structuralParams: ['octaves'], uniformSlots: () => 1,
    glslCompiler: execute('source'), cpuEvaluator: execute('source'),
    noiseType: 'fbm', seedParam: 'seed',
  };
}

const terrainNode = ({ id, label, description, color = 'green', inspector }) => ({
  id, label, description, category: 'Landforms', color,
  executionKind: 'analytical', inputs: [], outputs: [output()], inspector,
  defaults: Object.fromEntries(inspector.map((field) => [field.key, field.default])),
  structuralParams: inspector.filter((field) => field.structural).map((field) => field.key),
  uniformSlots: () => 1, glslCompiler: execute(id), cpuEvaluator: execute(id),
  terrainOnly: true, workspaceModes: ['terrain'], landform: true,
});

const LANDFORM_DEFINITIONS = [
  terrainNode({
    id: 'mountain', label: 'Mountain',
    description: 'Creates a single seeded mountain with a controllable silhouette and fractal rock detail.',
    inspector: [
      number('height', 'Height', 0, 2.5, 0.01, 1.15, { section: 'Form' }),
      number('scale', 'Scale', 0.1, 4, 0.01, 0.75, { section: 'Form' }),
      number('radius', 'Radius', 0.2, 3, 0.01, 1.25, { section: 'Form' }),
      number('sharpness', 'Peak Sharpness', 0.5, 5, 0.01, 1.65, { section: 'Form' }),
      number('roughness', 'Roughness', 0, 1, 0.01, 0.55, { section: 'Surface' }),
      number('octaves', 'Detail Octaves', 1, 8, 1, 5, { structural: true, section: 'Surface' }),
      number('persistence', 'Persistence', 0.15, 0.85, 0.01, 0.5, { section: 'Surface' }),
      number('lacunarity', 'Lacunarity', 1.5, 3.5, 0.01, 2, { section: 'Surface' }),
      number('seed', 'Seed', 0, 999999, 1, 1201, { section: 'Variation' }),
    ],
  }),
  terrainNode({
    id: 'mountainRange', label: 'Mountain Range',
    description: 'Builds a connected mountain chain with direction, span, ridge width, and seeded variation.',
    inspector: [
      number('height', 'Height', 0, 2.5, 0.01, 1.2, { section: 'Form' }),
      number('scale', 'Scale', 0.1, 4, 0.01, 0.65, { section: 'Form' }),
      number('direction', 'Direction', 0, 6.283, 0.01, 0.7, { section: 'Form' }),
      number('width', 'Range Width', 0.1, 2, 0.01, 0.42, { section: 'Form' }),
      number('length', 'Range Length', 0.4, 5, 0.01, 2.4, { section: 'Form' }),
      number('sharpness', 'Ridge Sharpness', 0.5, 4, 0.01, 1.8, { section: 'Surface' }),
      number('roughness', 'Breakup', 0, 1.5, 0.01, 0.65, { section: 'Surface' }),
      number('octaves', 'Detail Octaves', 1, 8, 1, 6, { structural: true, section: 'Surface' }),
      number('persistence', 'Persistence', 0.15, 0.85, 0.01, 0.5, { section: 'Surface' }),
      number('lacunarity', 'Lacunarity', 1.5, 3.5, 0.01, 2.1, { section: 'Surface' }),
      number('seed', 'Seed', 0, 999999, 1, 2201, { section: 'Variation' }),
    ],
  }),
  terrainNode({
    id: 'ridge', label: 'Ridge', color: 'amber',
    description: 'Creates a long directional ridge with adjustable width, crest sharpness, and natural breakup.',
    inspector: [
      number('height', 'Height', 0, 2.5, 0.01, 0.95, { section: 'Form' }),
      number('scale', 'Scale', 0.1, 4, 0.01, 0.8, { section: 'Form' }),
      number('direction', 'Direction', 0, 6.283, 0.01, 1.15, { section: 'Form' }),
      number('width', 'Width', 0.05, 1.5, 0.01, 0.28, { section: 'Form' }),
      number('sharpness', 'Crest Sharpness', 0.5, 6, 0.01, 2.2, { section: 'Form' }),
      number('breakup', 'Crest Breakup', 0, 4, 0.01, 1.3, { section: 'Surface' }),
      number('roughness', 'Roughness', 0, 1, 0.01, 0.45, { section: 'Surface' }),
      number('octaves', 'Detail Octaves', 1, 8, 1, 5, { structural: true, section: 'Surface' }),
      number('persistence', 'Persistence', 0.15, 0.85, 0.01, 0.48, { section: 'Surface' }),
      number('lacunarity', 'Lacunarity', 1.5, 3.5, 0.01, 2.05, { section: 'Surface' }),
      number('seed', 'Seed', 0, 999999, 1, 3301, { section: 'Variation' }),
    ],
  }),
  terrainNode({
    id: 'island', label: 'Island', color: 'cyan',
    description: 'Generates a finite island with a seeded interior, plateau control, and a softened coastline.',
    inspector: [
      number('height', 'Height', 0, 2.5, 0.01, 1.05, { section: 'Form' }),
      number('scale', 'Scale', 0.1, 4, 0.01, 0.7, { section: 'Form' }),
      number('radius', 'Island Radius', 0.2, 4, 0.01, 1.35, { section: 'Form' }),
      number('coast', 'Coast Falloff', 0.02, 0.8, 0.01, 0.28, { section: 'Form' }),
      number('plateau', 'Plateau', 0, 1, 0.01, 0.32, { section: 'Surface' }),
      number('roughness', 'Interior Roughness', 0, 1, 0.01, 0.72, { section: 'Surface' }),
      number('octaves', 'Detail Octaves', 1, 8, 1, 6, { structural: true, section: 'Surface' }),
      number('persistence', 'Persistence', 0.15, 0.85, 0.01, 0.5, { section: 'Surface' }),
      number('lacunarity', 'Lacunarity', 1.5, 3.5, 0.01, 2, { section: 'Surface' }),
      number('seed', 'Seed', 0, 999999, 1, 4401, { section: 'Variation' }),
    ],
  }),
  terrainNode({
    id: 'singleCrater', label: 'Crater', color: 'amber',
    description: 'Cuts one impact bowl with a raised rim and seeded surface damage for combining into a base terrain.',
    inspector: [
      number('depth', 'Depth', 0, 2, 0.01, 0.75, { section: 'Impact' }),
      number('scale', 'Scale', 0.1, 4, 0.01, 0.85, { section: 'Impact' }),
      number('radius', 'Radius', 0.2, 2, 0.01, 0.9, { section: 'Impact' }),
      number('rimHeight', 'Rim Height', 0, 1, 0.01, 0.42, { section: 'Rim' }),
      number('rimWidth', 'Rim Width', 0.03, 0.6, 0.01, 0.18, { section: 'Rim' }),
      number('roughness', 'Damage', 0, 1, 0.01, 0.2, { section: 'Surface' }),
      number('octaves', 'Detail Octaves', 1, 8, 1, 4, { structural: true, section: 'Surface' }),
      number('seed', 'Seed', 0, 999999, 1, 5501, { section: 'Variation' }),
    ],
  }),
];

const BLEND_OPTIONS = [
  ...Object.entries(BLEND_LABELS).map(([value, label]) => ({ value, label })),
  { value: 'mix', label: 'Mix' },
];

const MATH_OPTIONS = [
  ['add', 'Add'], ['subtract', 'Subtract'], ['multiply', 'Multiply'], ['divide', 'Divide'],
  ['power', 'Power'], ['absolute', 'Absolute'], ['negate', 'Negate'], ['invert', 'Invert'], ['clamp', 'Clamp'],
].map(([value, label]) => ({ value, label }));

const definitions = [
  {
    id: 'currentTerrain', label: 'Current Terrain', category: 'Sources', color: 'green',
    description: 'A frozen compatibility snapshot of the Noise Stack that was active when Nodes was opened.',
    executionKind: 'analytical', inputs: [], outputs: [output()], inspector: [], defaults: {},
    structuralParams: ['stack'], uniformSlots: (node) => activeLayers(node?.params?.stack || { layers: [] }).length,
    glslCompiler: execute('currentTerrain'), cpuEvaluator: execute('currentTerrain'),
    hiddenFromPalette: true, singleton: true,
  },
  {
    id: 'classicTerrain', label: 'Classic Terrain', category: 'Sources', color: 'green',
    description: 'The original biome-aware terrain generator, driven by the global Terrain controls.',
    executionKind: 'analytical', inputs: [], outputs: [output()], inspector: [], defaults: {},
    structuralParams: [], uniformSlots: () => 0,
    glslCompiler: execute('classicTerrain'), cpuEvaluator: execute('classicTerrain'), hiddenFromPalette: true,
  },
  deterministicNoiseDefinition(),
  ...SOURCE_TYPES.map(sourceDefinition),
  ...LANDFORM_DEFINITIONS,
  {
    id: 'domainWarp', label: 'Domain Warp', category: 'Transform', color: 'cyan',
    description: 'Distorts the source coordinates before evaluating the connected terrain.',
    executionKind: 'analytical', inputs: [input('source', 'Source')], outputs: [output()],
    inspector: [
      number('strength', 'Strength', 0, 4, 0.01, 0.7),
      number('scale', 'Scale', 0.1, 8, 0.05, 1),
      number('octaves', 'Octaves', 1, 6, 1, 4, { structural: true }),
      number('seedOffset', 'Seed Offset', -999, 999, 1, 0),
    ],
    defaults: { strength: 0.7, scale: 1, octaves: 4, seedOffset: 0 },
    structuralParams: ['octaves'], uniformSlots: () => 1,
    glslCompiler: execute('domainWarp'), cpuEvaluator: execute('domainWarp'),
  },
  {
    id: 'combine', label: 'Combine', category: 'Combine', color: 'blue',
    description: 'Combines two terrain signals using the Noise Stack blend operations or Mix.',
    executionKind: 'analytical', inputs: [input('a', 'A'), input('b', 'B')], outputs: [output()],
    inspector: [select('operation', 'Operation', BLEND_OPTIONS, 'add'), number('mix', 'Mix', 0, 1, 0.01, 0.5)],
    defaults: { operation: 'add', mix: 0.5 }, structuralParams: ['operation'], uniformSlots: () => 1,
    glslCompiler: execute('combine'), cpuEvaluator: execute('combine'),
  },
  {
    id: 'math', label: 'Math', category: 'Adjust', color: 'violet',
    description: 'Applies a scalar math operation to a terrain signal.',
    executionKind: 'analytical', inputs: [input('source', 'Source')], outputs: [output()],
    inspector: [
      select('operation', 'Operation', MATH_OPTIONS, 'multiply'),
      number('value', 'Value', -8, 8, 0.01, 1),
      number('min', 'Minimum', -4, 4, 0.01, 0),
      number('max', 'Maximum', -4, 4, 0.01, 1),
    ],
    defaults: { operation: 'multiply', value: 1, min: 0, max: 1 }, structuralParams: ['operation'], uniformSlots: () => 1,
    glslCompiler: execute('math'), cpuEvaluator: execute('math'),
  },
  {
    id: 'remap', label: 'Remap', category: 'Adjust', color: 'violet',
    description: 'Maps an input range to a new output range.',
    executionKind: 'analytical', inputs: [input('source', 'Source')], outputs: [output()],
    inspector: [
      number('inMin', 'Input Min', -4, 4, 0.01, 0), number('inMax', 'Input Max', -4, 4, 0.01, 1),
      number('outMin', 'Output Min', -4, 4, 0.01, 0), number('outMax', 'Output Max', -4, 4, 0.01, 1),
      { key: 'clamp', label: 'Clamp', type: 'boolean', default: true, structural: true },
    ],
    defaults: { inMin: 0, inMax: 1, outMin: 0, outMax: 1, clamp: true }, structuralParams: ['clamp'], uniformSlots: () => 1,
    glslCompiler: execute('remap'), cpuEvaluator: execute('remap'),
  },
  {
    id: 'terrace', label: 'Terrace', category: 'Adjust', color: 'amber',
    description: 'Quantizes terrain into controllable stepped plateaus.',
    executionKind: 'analytical', inputs: [input('source', 'Source')], outputs: [output()],
    inspector: [
      number('count', 'Terrace Count', 2, 40, 1, 12),
      number('smoothness', 'Smoothness', 0.02, 1, 0.01, 0.5),
      number('strength', 'Strength', 0, 1, 0.01, 1),
    ],
    defaults: { count: 12, smoothness: 0.5, strength: 1 }, structuralParams: [], uniformSlots: () => 1,
    glslCompiler: execute('terrace'), cpuEvaluator: execute('terrace'),
  },
  {
    id: 'terrainOutput', label: 'Terrain Output', category: 'Output', color: 'output',
    description: 'Connect the graph height here. Unconnected stays flat.',
    executionKind: 'analytical', inputs: [input('height', 'Height', false)], outputs: [],
    inspector: [
      { key: 'normalize', label: 'Normalize Output', type: 'boolean', default: false },
      number('outMin', 'Output Min', -4, 4, 0.01, 0),
      number('outMax', 'Output Max', -4, 4, 0.01, 1.35),
    ],
    defaults: { normalize: false, outMin: 0, outMax: 1.35 }, structuralParams: [], uniformSlots: () => 0,
    glslCompiler: execute('terrainOutput'), cpuEvaluator: execute('terrainOutput'),
    hiddenFromPalette: true, singleton: true, permanent: true,
  },
];

const registry = new Map(definitions.map((definition) => [definition.id, Object.freeze(definition)]));

export function getGraphNodeDefinition(type) { return registry.get(type) || null; }
export function listGraphNodeDefinitions({ includeHidden = false, mode = null } = {}) {
  return definitions.filter((definition) => (includeHidden || !definition.hiddenFromPalette)
    && (!mode || !definition.workspaceModes || definition.workspaceModes.includes(mode)));
}
export function nodeDefaults(type) {
  const definition = getGraphNodeDefinition(type);
  return definition ? structuredClone(definition.defaults) : {};
}
