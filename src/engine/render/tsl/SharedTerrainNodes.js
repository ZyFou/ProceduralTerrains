import {
  Fn,
  clamp,
  dot,
  float,
  floor,
  fract,
  mix,
  sin,
  smoothstep,
  vec2,
  vec3,
} from 'three/tsl';

// Shared, backend-neutral TSL building blocks. Feature counts are JavaScript
// constants so an inactive octave/wave/pass is absent from the generated graph
// instead of hidden behind a runtime branch.

export const hash2Node = Fn(([point]) => (
  fract(sin(dot(point, vec2(127.1, 311.7))).mul(43758.5453123))
));

export const valueNoise2Node = Fn(([point]) => {
  const cell = floor(point);
  const local = fract(point);
  const fade = local.mul(local).mul(float(3).sub(local.mul(2)));
  const a = hash2Node(cell);
  const b = hash2Node(cell.add(vec2(1, 0)));
  const c = hash2Node(cell.add(vec2(0, 1)));
  const d = hash2Node(cell.add(vec2(1, 1)));
  return mix(mix(a, b, fade.x), mix(c, d, fade.x), fade.y);
});

function boundedCount(value, min, max, label) {
  const count = Math.trunc(Number(value));
  if (!Number.isFinite(count) || count < min || count > max) {
    throw new RangeError(`${label} must be between ${min} and ${max}`);
  }
  return count;
}

function createFbmNode(octaves, { lacunarity = 2, gain = 0.5 } = {}) {
  const count = boundedCount(octaves, 1, 8, 'octaves');
  return Fn(([point, seed]) => {
    let total = float(0);
    let amplitude = 1;
    let frequency = 1;
    let normalization = 0;
    for (let octave = 0; octave < count; octave++) {
      const offset = vec2(seed, seed.mul(0.61803398875)).add(octave * 19.19);
      total = total.add(valueNoise2Node(point.mul(frequency).add(offset)).mul(amplitude));
      normalization += amplitude;
      frequency *= lacunarity;
      amplitude *= gain;
    }
    return total.div(normalization);
  });
}

export function createHeightNodeVariant({ octaves = 5, ridged = false } = {}) {
  const fbm = createFbmNode(octaves, { lacunarity: 2.03, gain: 0.5 });
  return Fn(([worldXZ, seed, heightScale]) => {
    const base = fbm(worldXZ.mul(0.0018), seed);
    const shaped = ridged
      ? float(1).sub(base.mul(2).sub(1).abs())
      : base;
    return shaped.mul(heightScale);
  });
}

export function createClimateNodeVariant({ octaves = 3 } = {}) {
  const climate = createFbmNode(octaves, { lacunarity: 2.11, gain: 0.54 });
  return Fn(([worldXZ, seed, latitude]) => {
    const temperatureNoise = climate(worldXZ.mul(0.00072), seed.add(31.7));
    const moisture = climate(worldXZ.mul(0.00091), seed.add(73.1));
    const latitudeCooling = clamp(latitude.abs(), 0, 1).mul(0.62);
    return vec2(clamp(temperatureNoise.sub(latitudeCooling), 0, 1), moisture);
  });
}

export function createBiomeNodeVariant() {
  return Fn(([height01, climate]) => {
    const cold = smoothstep(0.48, 0.82, float(1).sub(climate.x).add(height01.mul(0.35)));
    const dry = smoothstep(0.38, 0.8, float(1).sub(climate.y));
    const forest = clamp(float(1).sub(cold).mul(float(1).sub(dry)), 0, 1);
    const sum = cold.add(dry).add(forest).max(0.0001);
    return vec3(dry, forest, cold).div(sum);
  });
}

export function createDetailNodeVariant({ octaves = 2 } = {}) {
  const detail = createFbmNode(octaves, { lacunarity: 2.37, gain: 0.43 });
  return Fn(([worldXZ, seed, strength]) => (
    detail(worldXZ.mul(0.026), seed.add(113.5)).sub(0.5).mul(strength)
  ));
}

export function createWaterNodeVariant({ waves = 3 } = {}) {
  const count = boundedCount(waves, 1, 6, 'waves');
  return Fn(([worldXZ, time, amplitude]) => {
    let height = float(0);
    let normalization = 0;
    for (let wave = 0; wave < count; wave++) {
      const frequency = 0.012 * (wave + 1);
      const weight = 1 / (wave + 1);
      const direction = vec2(0.73 + wave * 0.19, 0.41 - wave * 0.13);
      height = height.add(sin(dot(worldXZ, direction).mul(frequency).add(time.mul(0.45 + wave * 0.11))).mul(weight));
      normalization += weight;
    }
    return height.div(normalization).mul(amplitude);
  });
}

export function createCloudNodeVariant({ octaves = 3 } = {}) {
  const cloud = createFbmNode(octaves, { lacunarity: 2.05, gain: 0.51 });
  return Fn(([worldXZ, seed, coverage]) => (
    smoothstep(coverage, coverage.add(0.18), cloud(worldXZ.mul(0.00045), seed))
  ));
}

export function createPostNodeVariant({ toneMap = true } = {}) {
  return Fn(([linearColor, exposure, saturation]) => {
    const exposed = linearColor.mul(exposure);
    const mapped = toneMap ? exposed.div(exposed.add(1)) : exposed;
    const luminance = dot(mapped, vec3(0.2126, 0.7152, 0.0722));
    return mix(vec3(luminance), mapped, saturation);
  });
}

const MODE_BUDGETS = Object.freeze({
  compatibility: Object.freeze({ maxTextures: 8, maxHeightOctaves: 3, maxDetailOctaves: 1, maxWaves: 1, maxCloudOctaves: 0 }),
  studio: Object.freeze({ maxTextures: 14, maxHeightOctaves: 6, maxDetailOctaves: 3, maxWaves: 4, maxCloudOctaves: 4 }),
  infinite: Object.freeze({ maxTextures: 12, maxHeightOctaves: 6, maxDetailOctaves: 2, maxWaves: 3, maxCloudOctaves: 3 }),
  planet: Object.freeze({ maxTextures: 14, maxHeightOctaves: 7, maxDetailOctaves: 3, maxWaves: 4, maxCloudOctaves: 4 }),
});

/** Build one exact graph topology. Disabled systems are not instantiated. */
export function createTslRenderVariant({
  mode = 'studio',
  heightOctaves = 5,
  detailOctaves = 2,
  water = false,
  waves = 3,
  clouds = false,
  cloudOctaves = 3,
  ridged = false,
  toneMap = true,
} = {}) {
  const budget = MODE_BUDGETS[mode];
  if (!budget) throw new Error(`Unknown TSL render mode: ${mode}`);
  if (heightOctaves > budget.maxHeightOctaves) throw new Error(`${mode} height octave budget exceeded`);
  if (detailOctaves > budget.maxDetailOctaves) throw new Error(`${mode} detail octave budget exceeded`);
  if (water && waves > budget.maxWaves) throw new Error(`${mode} water wave budget exceeded`);
  if (clouds && cloudOctaves > budget.maxCloudOctaves) throw new Error(`${mode} cloud octave budget exceeded`);

  const descriptor = {
    mode,
    heightOctaves,
    detailOctaves,
    water: !!water,
    waves: water ? waves : 0,
    clouds: !!clouds,
    cloudOctaves: clouds ? cloudOctaves : 0,
    ridged: !!ridged,
    toneMap: !!toneMap,
  };
  const key = Object.entries(descriptor).map(([name, value]) => `${name}=${value}`).join(';');
  return Object.freeze({
    backend: 'webgpu',
    key,
    budget,
    descriptor: Object.freeze(descriptor),
    nodes: Object.freeze({
      height: createHeightNodeVariant({ octaves: heightOctaves, ridged }),
      climate: createClimateNodeVariant({ octaves: Math.min(3, heightOctaves) }),
      biome: createBiomeNodeVariant(),
      detail: createDetailNodeVariant({ octaves: detailOctaves }),
      water: water ? createWaterNodeVariant({ waves }) : null,
      cloud: clouds ? createCloudNodeVariant({ octaves: cloudOctaves }) : null,
      post: createPostNodeVariant({ toneMap }),
    }),
  });
}

export { MODE_BUDGETS as TSL_MODE_RESOURCE_BUDGETS };

