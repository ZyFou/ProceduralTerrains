const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finiteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const smoothstep = (value) => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

export const MANUAL_BLEND_MODES = Object.freeze([
  { id: 'add', name: 'Add' },
  { id: 'subtract', name: 'Subtract' },
  { id: 'max', name: 'Max' },
  { id: 'min', name: 'Min' },
  { id: 'replace', name: 'Replace' },
  { id: 'average', name: 'Average' },
]);

export const MANUAL_MASK_TYPES = Object.freeze([
  { id: 'none', name: 'None' },
  { id: 'radial', name: 'Radial' },
  { id: 'box', name: 'Box' },
  { id: 'noise', name: 'Noise' },
]);

const BLEND_MODE_IDS = new Set(MANUAL_BLEND_MODES.map((mode) => mode.id));
const MASK_TYPE_IDS = new Set(MANUAL_MASK_TYPES.map((mask) => mask.id));

export const MANUAL_SHAPE_CATALOG = Object.freeze([
  {
    id: 'mountain',
    name: 'Mountain',
    category: 'Mountains',
    description: 'A broad, ridged peak for the main terrain silhouette.',
    size: { x: 520, z: 520 },
    height: 320,
    detail: 0.42,
  },
  {
    id: 'sharp-peak',
    name: 'Sharp Peak',
    category: 'Mountains',
    description: 'A steep summit that layers well over larger massifs.',
    size: { x: 280, z: 280 },
    height: 250,
    detail: 0.3,
  },
  {
    id: 'ridge',
    name: 'Ridge',
    category: 'Mountains',
    description: 'An elongated mountain spine controlled by rotation and scale.',
    size: { x: 650, z: 180 },
    height: 210,
    detail: 0.48,
  },
  {
    id: 'valley',
    name: 'Wide Valley',
    category: 'Valleys',
    description: 'A soft negative landform for broad passes and basins.',
    size: { x: 600, z: 360 },
    height: -170,
    detail: 0.18,
  },
  {
    id: 'canyon',
    name: 'Canyon',
    category: 'Valleys',
    description: 'A narrow, deep cut with gently widening banks.',
    size: { x: 720, z: 145 },
    height: -230,
    detail: 0.34,
  },
  {
    id: 'plateau',
    name: 'Plateau',
    category: 'Plateaus',
    description: 'A flat-topped mesa with a controllable broken rim.',
    size: { x: 460, z: 390 },
    height: 190,
    detail: 0.24,
  },
  {
    id: 'crater',
    name: 'Crater',
    category: 'Features',
    description: 'A raised circular rim surrounding a carved bowl.',
    size: { x: 360, z: 360 },
    height: 180,
    detail: 0.2,
  },
]);

const CATALOG_BY_ID = new Map(MANUAL_SHAPE_CATALOG.map((entry) => [entry.id, entry]));

export const MAX_MANUAL_SHAPE_LAYERS = 8;

export const MANUAL_SHAPE_LAYER_CATALOG = Object.freeze([
  {
    id: 'detail',
    name: 'Noise Detail',
    description: 'Adds deterministic multi-scale relief inside the selected shape.',
    params: { strength: 0.22, scale: 6, roughness: 0.55 },
    controls: [
      { id: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, digits: 2 },
      { id: 'scale', label: 'Scale', min: 1, max: 24, step: 0.25, digits: 2 },
      { id: 'roughness', label: 'Roughness', min: 0, max: 1, step: 0.01, digits: 2 },
    ],
  },
  {
    id: 'ridges',
    name: 'Rock Ridges',
    description: 'Breaks the silhouette into deterministic radial rock spines.',
    params: { strength: 0.24, frequency: 7, sharpness: 2.1 },
    controls: [
      { id: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, digits: 2 },
      { id: 'frequency', label: 'Ridge Count', min: 2, max: 18, step: 1, digits: 0, integer: true },
      { id: 'sharpness', label: 'Sharpness', min: 0.5, max: 5, step: 0.05, digits: 2 },
    ],
  },
  {
    id: 'terraces',
    name: 'Terraces',
    description: 'Quantizes the current profile into shelves while preserving later detail layers.',
    params: { strength: 0.8, steps: 7, softness: 0.16 },
    controls: [
      { id: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, digits: 2 },
      { id: 'steps', label: 'Steps', min: 2, max: 24, step: 1, digits: 0, integer: true },
      { id: 'softness', label: 'Softness', min: 0, max: 1, step: 0.01, digits: 2 },
    ],
  },
  {
    id: 'weathering',
    name: 'Weathering',
    description: 'Carves broken drainage channels into exposed parts of the shape.',
    params: { strength: 0.34, scale: 4, channels: 0.58 },
    controls: [
      { id: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, digits: 2 },
      { id: 'scale', label: 'Feature Scale', min: 1, max: 14, step: 0.25, digits: 2 },
      { id: 'channels', label: 'Channels', min: 0, max: 1, step: 0.01, digits: 2 },
    ],
  },
]);

const SHAPE_LAYER_BY_ID = new Map(MANUAL_SHAPE_LAYER_CATALOG.map((entry) => [entry.id, entry]));

export function getManualShapeLayerDefinition(type) {
  return SHAPE_LAYER_BY_ID.get(type) ?? SHAPE_LAYER_BY_ID.get('detail');
}

export function normalizeManualShapeLayer(input = {}, index = 0) {
  const definition = getManualShapeLayerDefinition(input.type);
  const sourceParams = input.params && typeof input.params === 'object' ? input.params : {};
  const params = {};
  for (const control of definition.controls) {
    const fallback = definition.params[control.id];
    const value = clamp(finiteNumber(sourceParams[control.id], fallback), control.min, control.max);
    params[control.id] = control.integer ? Math.round(value) : value;
  }
  return {
    id: String(input.id || `shape-layer-${index + 1}`),
    name: String(input.name || definition.name).slice(0, 80),
    type: definition.id,
    enabled: input.enabled !== false,
    opacity: clamp(finiteNumber(input.opacity, 1), 0, 1),
    seedOffset: clamp(Math.round(finiteNumber(input.seedOffset, index * 1013)), 0, 0x7fffffff),
    params,
  };
}

export function createManualShapeLayer(type, overrides = {}) {
  const definition = getManualShapeLayerDefinition(type);
  return normalizeManualShapeLayer({
    id: overrides.id ?? globalThis.crypto?.randomUUID?.()
      ?? `shape-layer-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: overrides.name ?? definition.name,
    type: definition.id,
    enabled: overrides.enabled ?? true,
    opacity: overrides.opacity ?? 1,
    seedOffset: overrides.seedOffset ?? Math.floor(Math.random() * 1000000),
    params: { ...definition.params, ...(overrides.params || {}) },
  });
}

export function getManualShapeDefinition(type) {
  return CATALOG_BY_ID.get(type) ?? CATALOG_BY_ID.get('mountain');
}

export function createManualShape(type, position = {}, overrides = {}) {
  const definition = getManualShapeDefinition(type);
  const seed = Number.isFinite(Number(overrides.seed))
    ? Math.round(Number(overrides.seed))
    : Math.floor(Math.random() * 1000000);
  return normalizeManualShape({
    id: overrides.id ?? globalThis.crypto?.randomUUID?.()
      ?? `shape-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: overrides.name ?? definition.name,
    type: definition.id,
    position: {
      x: Number(position.x) || 0,
      z: Number(position.z) || 0,
    },
    rotation: overrides.rotation ?? 0,
    scale: overrides.scale ?? { ...definition.size },
    height: overrides.height ?? definition.height,
    detail: overrides.detail ?? definition.detail,
    enabled: overrides.enabled ?? true,
    opacity: overrides.opacity ?? 1,
    blendMode: overrides.blendMode ?? 'add',
    sharpness: overrides.sharpness ?? 1,
    terraces: overrides.terraces ?? 0,
    mask: overrides.mask ?? {
      type: 'none',
      invert: false,
      feather: 0.32,
      strength: 1,
    },
    layers: overrides.layers ?? [],
    seed,
  });
}

export function normalizeManualShape(input = {}, index = 0) {
  const definition = getManualShapeDefinition(input.type);
  const scale = input.scale && typeof input.scale === 'object' ? input.scale : {};
  const position = input.position && typeof input.position === 'object' ? input.position : {};
  const mask = input.mask && typeof input.mask === 'object' ? input.mask : {};
  const layers = Array.isArray(input.layers)
    ? input.layers.slice(0, MAX_MANUAL_SHAPE_LAYERS).map(normalizeManualShapeLayer)
    : [];
  const height = Number(input.height);
  return {
    id: String(input.id || `shape-${index + 1}`),
    name: String(input.name || definition.name).slice(0, 80),
    type: definition.id,
    position: {
      x: clamp(finiteNumber(position.x), -100000, 100000),
      z: clamp(finiteNumber(position.z), -100000, 100000),
    },
    rotation: clamp(finiteNumber(input.rotation), -Math.PI * 8, Math.PI * 8),
    scale: {
      x: clamp(Math.abs(Number(scale.x)) || definition.size.x, 8, 10000),
      z: clamp(Math.abs(Number(scale.z)) || definition.size.z, 8, 10000),
    },
    height: clamp(Number.isFinite(height) ? height : definition.height, -3000, 3000),
    detail: clamp(Number(input.detail) || 0, 0, 1),
    enabled: input.enabled !== false,
    opacity: clamp(finiteNumber(input.opacity, 1), 0, 1),
    blendMode: BLEND_MODE_IDS.has(input.blendMode) ? input.blendMode : 'add',
    sharpness: clamp(finiteNumber(input.sharpness, 1), 0.2, 4),
    terraces: clamp(Math.round(finiteNumber(input.terraces, 0)), 0, 16),
    mask: {
      type: MASK_TYPE_IDS.has(mask.type) ? mask.type : 'none',
      invert: mask.invert === true,
      feather: clamp(finiteNumber(mask.feather, 0.32), 0.02, 1),
      strength: clamp(finiteNumber(mask.strength, 1), 0, 1),
    },
    layers,
    seed: clamp(Math.round(Number(input.seed) || 0), 0, 0x7fffffff),
  };
}

export function normalizeManualTerrainDocument(input) {
  const source = input && typeof input === 'object' ? input : {};
  const baseSource = source.baseSource === 'procedural' || source.baseSource === 'nodes'
    ? source.baseSource
    : 'flat';
  const shapes = Array.isArray(source.shapes)
    ? source.shapes.slice(0, 256).map(normalizeManualShape)
    : [];
  return {
    version: 5,
    baseSource,
    shapes,
    sculpt: source.sculpt && typeof source.sculpt === 'object' ? source.sculpt : null,
    surfacePaint: source.surfacePaint && typeof source.surfacePaint === 'object' ? source.surfacePaint : null,
  };
}

function detailNoise(x, z, seed) {
  const s = seed * 0.000173;
  const a = Math.sin(x * 11.73 + z * 7.91 + s * 37.1);
  const b = Math.sin(x * -21.17 + z * 16.31 + s * 91.7);
  const c = Math.sin((x + z) * 34.13 + s * 17.3);
  return (a * 0.5 + b * 0.32 + c * 0.18);
}

function applyManualShapeLayers(profile, shape, x, z, radial, edge) {
  let current = profile;
  for (let index = 0; index < (shape.layers?.length ?? 0); index++) {
    const layer = shape.layers[index];
    if (layer.enabled === false || layer.opacity <= 0) continue;
    const params = layer.params ?? {};
    const seed = shape.seed + layer.seedOffset + index * 1619;
    let target = current;

    if (layer.type === 'detail') {
      const scale = Math.max(1, params.scale);
      const coarse = detailNoise(x * scale, z * scale, seed);
      const fine = detailNoise(x * scale * 2.07, z * scale * 2.07, seed + 4099);
      const noise = lerp(coarse, coarse * 0.62 + fine * 0.38, clamp(params.roughness, 0, 1));
      const amplitude = params.strength * (0.1 + Math.abs(current) * 0.34) * edge;
      target = current + noise * amplitude;
    } else if (layer.type === 'ridges') {
      const frequency = Math.max(2, Math.round(params.frequency));
      const bend = detailNoise(x * 2.1, z * 2.1, seed) * 0.24;
      const wave = Math.sin((Math.atan2(z, x) + bend) * frequency);
      const ridge = Math.pow(Math.max(0, 1 - Math.abs(wave)), Math.max(0.5, params.sharpness));
      const radialEnvelope = smoothstep(radial / 0.2) * edge;
      target = current * (1 + (ridge - 0.24) * params.strength * radialEnvelope);
    } else if (layer.type === 'terraces') {
      const steps = Math.max(2, Math.round(params.steps));
      const stepped = Math.round(current * steps) / steps;
      const softened = lerp(stepped, current, clamp(params.softness, 0, 1));
      target = lerp(current, softened, clamp(params.strength, 0, 1));
    } else if (layer.type === 'weathering') {
      const scale = Math.max(1, params.scale);
      const flow = detailNoise(x * scale, z * scale, seed);
      const channels = Math.pow(Math.max(0, 1 - Math.abs(flow)), lerp(3.2, 0.85, clamp(params.channels, 0, 1)));
      const exposed = smoothstep(radial / 0.16) * edge;
      const erosion = params.strength * channels * exposed * (0.08 + Math.abs(current) * 0.28);
      target = current - Math.sign(current || 1) * Math.min(Math.abs(current) * 0.78, erosion);
    }

    current = lerp(current, target, clamp(layer.opacity, 0, 1));
  }
  return current;
}

function evaluateShapeMask(shape, x, z, radial) {
  const mask = shape.mask ?? {};
  let value = 1;
  if (mask.type === 'radial') {
    value = smoothstep((1 - radial) / Math.max(0.02, mask.feather));
  } else if (mask.type === 'box') {
    value = smoothstep((1 - Math.max(Math.abs(x), Math.abs(z))) / Math.max(0.02, mask.feather));
  } else if (mask.type === 'noise') {
    const noise = detailNoise(x * 0.72, z * 0.72, shape.seed + 7919) * 0.5 + 0.5;
    const lo = 0.5 - Math.max(0.02, mask.feather) * 0.5;
    const hi = 0.5 + Math.max(0.02, mask.feather) * 0.5;
    value = smoothstep((noise - lo) / Math.max(0.001, hi - lo));
  }
  if (mask.invert) value = 1 - value;
  return lerp(1, value, clamp(finiteNumber(mask.strength, 1), 0, 1));
}

export function evaluateManualShapeSample(shape, worldX, worldZ) {
  if (shape.enabled === false) return { height: 0, influence: 0 };
  const dx = worldX - shape.position.x;
  const dz = worldZ - shape.position.z;
  const cos = Math.cos(shape.rotation);
  const sin = Math.sin(shape.rotation);
  const x = (dx * cos + dz * sin) / Math.max(1, shape.scale.x);
  const z = (-dx * sin + dz * cos) / Math.max(1, shape.scale.z);
  const radial = Math.hypot(x, z);
  if (Math.abs(x) > 1.12 || Math.abs(z) > 1.12 || radial > 1.16) return { height: 0, influence: 0 };

  const edge = smoothstep((1 - radial) / 0.18);
  const mask = evaluateShapeMask(shape, x, z, radial);
  const noise = detailNoise(x, z, shape.seed) * shape.detail;
  let profile = 0;

  switch (shape.type) {
    case 'sharp-peak':
      profile = Math.pow(Math.max(0, 1 - radial), 1.75);
      profile *= 1 + noise * 0.28;
      break;
    case 'ridge': {
      const lengthFade = smoothstep((1 - Math.abs(x)) / 0.18);
      const spine = Math.pow(Math.max(0, 1 - Math.abs(z)), 1.75);
      profile = spine * lengthFade * (1 + noise * 0.34);
      break;
    }
    case 'valley':
      profile = Math.pow(Math.max(0, 1 - radial), 1.45) * (1 + noise * 0.12);
      break;
    case 'canyon': {
      const lengthFade = smoothstep((1 - Math.abs(x)) / 0.2);
      const channel = Math.pow(Math.max(0, 1 - Math.abs(z)), 3.2);
      profile = channel * lengthFade * (1 + noise * 0.16);
      break;
    }
    case 'plateau': {
      const top = 1 - smoothstep((radial - 0.58) / 0.38);
      profile = top * edge * (1 + noise * 0.12 * smoothstep((radial - 0.4) / 0.5));
      break;
    }
    case 'crater': {
      const rim = Math.exp(-Math.pow((radial - 0.68) / 0.14, 2));
      const bowl = Math.exp(-Math.pow(radial / 0.48, 2));
      profile = (rim - bowl * 0.72) * edge * (1 + noise * 0.16);
      break;
    }
    case 'mountain':
    default: {
      const cone = Math.pow(Math.max(0, 1 - radial), 1.15);
      const ridges = 1 + Math.sin(Math.atan2(z, x) * 7 + shape.seed * 0.01) * shape.detail * 0.12 * radial;
      profile = cone * ridges * (1 + noise * 0.3);
      break;
    }
  }

  profile = applyManualShapeLayers(profile, shape, x, z, radial, edge);

  const signed = Math.sign(profile);
  let shapedProfile = Math.pow(Math.abs(profile), shape.sharpness ?? 1) * signed;
  if (shape.terraces > 0) {
    const steps = Math.max(1, shape.terraces);
    shapedProfile = Math.round(shapedProfile * steps) / steps;
  }
  return {
    height: shapedProfile * edge * mask * shape.height,
    influence: clamp(edge * mask, 0, 1),
  };
}

export function evaluateManualShape(shape, worldX, worldZ) {
  return evaluateManualShapeSample(shape, worldX, worldZ).height;
}

export function blendManualShapeHeight(current, shape, sample) {
  if (!sample?.influence || shape.enabled === false) return current;
  const opacity = clamp(finiteNumber(shape.opacity, 1), 0, 1);
  if (opacity <= 0) return current;
  const contribution = sample.height;
  switch (shape.blendMode) {
    case 'subtract':
      return current - Math.abs(contribution) * opacity;
    case 'max':
      return lerp(current, Math.max(current, contribution), opacity);
    case 'min':
      return lerp(current, Math.min(current, contribution), opacity);
    case 'replace':
      return lerp(current, contribution, opacity * sample.influence);
    case 'average':
      return lerp(current, (current + contribution) * 0.5, opacity * sample.influence);
    case 'add':
    default:
      return current + contribution * opacity;
  }
}

export function evaluateManualTerrain(shapes, worldX, worldZ) {
  let height = 0;
  for (const shape of shapes) {
    height = blendManualShapeHeight(height, shape, evaluateManualShapeSample(shape, worldX, worldZ));
  }
  return height;
}
