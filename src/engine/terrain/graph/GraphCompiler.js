import { blendGlslStmt, blendJs } from '../noise/blendModes.js';
import { activeLayers, migrateStack } from '../noise/NoiseStack.js';
import { evalStack2D, generateStackGLSL, packStackUniforms } from '../noise/noiseStackCodegen.js';
import { fbm2, vnoise2 } from '../noise/cpuNoise.js';
import { getNoiseType } from '../noise/noiseTypes.js';
import { seedDomainOffset } from '../noise/seedDomain.js';
import { getGraphNodeDefinition } from './GraphRegistry.js';
import { findOutputNode, inputEdge, reachableNodeIds, topologicalSort, validateGraph } from './GraphDocument.js';

export const GRAPH_FUNCTIONS_MARKER = '/*__TERRAIN_GRAPH_FUNCTIONS__*/';
export const GRAPH_BODY_MARKER = '/*__TERRAIN_GRAPH_BODY__*/';

// Continuous inspector edits only change packed uniforms. Cache the generated
// GLSL by structural signature so dragging a slider does not rebuild the same
// large shader string on every pointer event. Keep the cache small because old
// structural variants are also retained by the WebGL program cache.
const SHADER_SOURCE_CACHE_LIMIT = 32;
const shaderSourceCache = new Map();

function cacheShaderSource(sig, source) {
  if (shaderSourceCache.has(sig)) shaderSourceCache.delete(sig);
  shaderSourceCache.set(sig, source);
  if (shaderSourceCache.size > SHADER_SOURCE_CACHE_LIMIT) {
    shaderSourceCache.delete(shaderSourceCache.keys().next().value);
  }
  return source;
}

const vec4 = () => [0, 0, 0, 0];
const safe = (id) => `graph_${String(id).replace(/[^a-zA-Z0-9_]/g, '_')}`;
const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const glsl = (value) => `${num(value).toFixed(6)}`;

function emptyPack() {
  return {
    strength: new Array(12).fill(0), scale: new Array(12).fill(1), seed: new Array(12).fill(0),
    paramsA: Array.from({ length: 12 }, vec4), paramsB: Array.from({ length: 12 }, vec4),
    maskA: Array.from({ length: 12 }, vec4), maskB: Array.from({ length: 12 }, vec4), maskC: Array.from({ length: 12 }, vec4),
  };
}

function sourceLayer(node) {
  const definition = getGraphNodeDefinition(node.type);
  const seedKey = definition?.seedParam || 'seedOffset';
  return {
    id: node.id, type: definition.noiseType, enabled: true, name: node.label,
    blendMode: 'replace', strength: num(node.params.strength, 1), opacity: 1,
    seedOffset: num(node.params[seedKey]), params: { ...node.params }, masks: [],
  };
}

function glslFbm(name, expression, octaves, persistence = '0.5', lacunarity = '2.0') {
  return `float ${name}=0.0;
  { float amp=0.5, norm=0.0; vec2 q=${expression};
    for(int i=0;i<${octaves};i++){ ${name}+=amp*vnoise(q); norm+=amp; amp*=${persistence}; q=ROT2*q*${lacunarity}; }
    ${name}/=max(norm,1e-4); }`;
}

function sourceFunction(node, slot) {
  const layer = sourceLayer(node);
  const def = getNoiseType(layer.type);
  return `float ${safe(node.id)}(vec2 xz, Climate c) {
  float scale = uLayerScale[${slot}];
  float eff = uLayerStrength[${slot}];
  float seed = uLayerSeed[${slot}];
  vec4 pa = uLayerParamsA[${slot}];
  vec4 pb = uLayerParamsB[${slot}];
  vec2 P = (xz * uFrequency + uSeedOffset) * scale + vec2(seed, seed * 1.7 + 3.1);
  float val = 0.0;
  ${def.body2d(layer)}
  return val * eff;
}`;
}

function currentTerrainFunction(node) {
  const stack = migrateStack(node.params?.stack);
  const generated = generateStackGLSL(stack);
  return `float ${safe(node.id)}(vec2 xz, Climate c) {
  vec2 pw = xz * uFrequency + uSeedOffset;
  float h = 0.0;
  ${generated.body2d}
  return h;
}`;
}

function upstream(graph, node, port) {
  const edge = inputEdge(graph, node.id, port);
  return edge ? safe(edge.source) : null;
}

function nodeFunction(graph, node, slot) {
  const fn = safe(node.id);
  const a = upstream(graph, node, 'a');
  const b = upstream(graph, node, 'b');
  const source = upstream(graph, node, 'source');
  const definition = getGraphNodeDefinition(node.type);
  const compiler = {
    currentTerrain: () => currentTerrainFunction(node),
    classicTerrain: () => `float ${fn}(vec2 xz, Climate c) { return legacyShape2D(xz, c); }`,
    source: () => sourceFunction(node, slot),
    mountain: () => {
      const oct = Math.max(1, Math.min(8, Math.round(num(node.params.octaves, 5))));
      return `float ${fn}(vec2 xz, Climate c) {
  float height=uLayerStrength[${slot}], scale=uLayerScale[${slot}], seed=uLayerSeed[${slot}];
  vec4 pa=uLayerParamsA[${slot}], pb=uLayerParamsB[${slot}];
  vec2 p=xz*uFrequency*scale;
  ${glslFbm('detail', 'p*2.6+vec2(seed,seed*1.7+3.1)', oct, 'pb.x', 'pb.y')}
  float ridge=1.0-abs(detail*2.0-1.0);
  float silhouette=pow(max(1.0-length(p)/max(pa.x,0.001),0.0),max(pa.y,0.01));
  return height*silhouette*mix(1.0,ridge,clamp(pa.z,0.0,1.0));
}`;
    },
    mountainRange: () => {
      const oct = Math.max(1, Math.min(8, Math.round(num(node.params.octaves, 6))));
      return `float ${fn}(vec2 xz, Climate c) {
  float height=uLayerStrength[${slot}], scale=uLayerScale[${slot}], seed=uLayerSeed[${slot}];
  vec4 pa=uLayerParamsA[${slot}], pb=uLayerParamsB[${slot}];
  vec2 p=xz*uFrequency*scale;
  vec2 dir=vec2(cos(pa.x),sin(pa.x)), side=vec2(-dir.y,dir.x);
  float along=dot(p,dir), across=dot(p,side);
  across+=(vnoise(vec2(along*1.25+seed,seed*0.37))-0.5)*pb.x;
  float envelope=exp(-pow(abs(across)/max(pa.y,0.01),2.0))*exp(-pow(abs(along)/max(pa.z,0.01),4.0));
  ${glslFbm('detail', 'vec2(along*0.75,across*3.2)+vec2(seed,seed*1.7+3.1)', oct, 'pb.y', 'pb.z')}
  float ridge=pow(max(1.0-abs(detail*2.0-1.0),0.0),max(pa.w,0.01));
  return height*envelope*mix(0.42,1.18,ridge);
}`;
    },
    ridge: () => {
      const oct = Math.max(1, Math.min(8, Math.round(num(node.params.octaves, 5))));
      return `float ${fn}(vec2 xz, Climate c) {
  float height=uLayerStrength[${slot}], scale=uLayerScale[${slot}], seed=uLayerSeed[${slot}];
  vec4 pa=uLayerParamsA[${slot}], pb=uLayerParamsB[${slot}];
  vec2 p=xz*uFrequency*scale;
  vec2 dir=vec2(cos(pa.x),sin(pa.x)), side=vec2(-dir.y,dir.x);
  float along=dot(p,dir), across=dot(p,side);
  float bend=(vnoise(vec2(along*max(pa.w,0.01)+seed,seed*0.41))-0.5)*pb.x;
  float crest=exp(-pow(abs(across+bend)/max(pa.y,0.01),max(pa.z,0.5)));
  ${glslFbm('detail', 'p*3.0+vec2(seed,seed*1.7+3.1)', oct, 'pb.y', 'pb.z')}
  return height*crest*mix(0.62,1.18,detail);
}`;
    },
    island: () => {
      const oct = Math.max(1, Math.min(8, Math.round(num(node.params.octaves, 6))));
      return `float ${fn}(vec2 xz, Climate c) {
  float height=uLayerStrength[${slot}], scale=uLayerScale[${slot}], seed=uLayerSeed[${slot}];
  vec4 pa=uLayerParamsA[${slot}], pb=uLayerParamsB[${slot}];
  vec2 p=xz*uFrequency*scale;
  float radius=max(pa.x,0.01), coast=clamp(pa.y,0.01,0.95);
  float mask=1.0-smoothstep(radius*(1.0-coast),radius,length(p));
  ${glslFbm('detail', 'p*1.85+vec2(seed,seed*1.7+3.1)', oct, 'pb.x', 'pb.y')}
  float interior=mix(1.0,pa.z+(1.0-pa.z)*detail,clamp(pa.w,0.0,1.0));
  return height*mask*max(interior,0.0);
}`;
    },
    singleCrater: () => {
      const oct = Math.max(1, Math.min(8, Math.round(num(node.params.octaves, 4))));
      return `float ${fn}(vec2 xz, Climate c) {
  float depth=uLayerStrength[${slot}], scale=uLayerScale[${slot}], seed=uLayerSeed[${slot}];
  vec4 pa=uLayerParamsA[${slot}];
  vec2 p=xz*uFrequency*scale;
  float r=length(p)/max(pa.x,0.01);
  float bowl=-pow(max(1.0-r,0.0),1.65);
  float rim=pa.y*exp(-pow((r-1.0)/max(pa.z,0.01),2.0));
  ${glslFbm('damage', 'p*4.0+vec2(seed,seed*1.7+3.1)', oct)}
  float breakup=(damage-0.5)*pa.w*(1.0-smoothstep(1.0,1.4,r));
  return depth*(bowl+rim+breakup);
}`;
    },
    domainWarp: () => {
      const oct = Math.max(1, Math.min(6, Math.round(num(node.params.octaves, 4))));
      return `float ${fn}(vec2 xz, Climate c) {
  float scale = uLayerScale[${slot}]; float eff = uLayerStrength[${slot}]; float seed = uLayerSeed[${slot}];
  vec2 pw = xz * uFrequency + uSeedOffset + vec2(seed, seed * 1.7 + 3.1);
  vec2 WP = pw * scale;
  float wx = 0.0, wz = 0.0;
  { float amp = 0.5, norm = 0.0; vec2 q = WP + vec2(13.7, 41.3); for (int i=0;i<${oct};i++){ wx += amp*vnoise(q); norm+=amp; amp*=uPersistence; q=ROT2*q*uLacunarity; } wx/=max(norm,1e-4); }
  { float amp = 0.5, norm = 0.0; vec2 q = WP + vec2(87.2, 9.1); for (int i=0;i<${oct};i++){ wz += amp*vnoise(q); norm+=amp; amp*=uPersistence; q=ROT2*q*uLacunarity; } wz/=max(norm,1e-4); }
  vec2 warped = pw + (vec2(wx,wz)-0.5)*eff;
  vec2 warpedXZ = (warped - uSeedOffset - vec2(seed, seed * 1.7 + 3.1)) / max(uFrequency, 1e-6);
  return ${source}(warpedXZ, climateAt(warped));
}`;
    },
    combine: () => {
      const operation = node.params.operation || 'add';
      const statement = operation === 'mix'
        ? `h = mix(h, rhs, clamp(uLayerParamsA[${slot}].x, 0.0, 1.0));`
        : blendGlslStmt(operation, 'h', 'rhs');
      return `float ${fn}(vec2 xz, Climate c) { float h=${a}(xz,c); float rhs=${b}(xz,c); ${statement} return h; }`;
    },
    math: () => {
      const p = `uLayerParamsA[${slot}]`;
      const expressions = {
        add: `h + ${p}.x`, subtract: `h - ${p}.x`, multiply: `h * ${p}.x`, divide: `h / (abs(${p}.x)<1e-4?1e-4:${p}.x)`,
        power: `pow(max(abs(h),1e-6), ${p}.x) * sign(h)`, absolute: 'abs(h)', negate: '-h', invert: '1.0-h', clamp: `clamp(h, min(${p}.y,${p}.z), max(${p}.y,${p}.z))`,
      };
      return `float ${fn}(vec2 xz, Climate c) { float h=${source}(xz,c); return ${expressions[node.params.operation] || expressions.multiply}; }`;
    },
    remap: () => {
      const p = `uLayerParamsA[${slot}]`; const t = `(h-${p}.x)/max(${p}.y-${p}.x,1e-6)`;
      return `float ${fn}(vec2 xz, Climate c) { float h=${source}(xz,c); float t=${node.params.clamp === false ? t : `clamp(${t},0.0,1.0)`}; return mix(${p}.z,${p}.w,t); }`;
    },
    terrace: () => {
      const p = `uLayerParamsA[${slot}]`;
      return `float ${fn}(vec2 xz, Climate c) { float h=${source}(xz,c); float steps=max(${p}.x,1.0); float t=h*steps; float s=smoothstep(0.5-${p}.y*0.5,0.5+${p}.y*0.5,fract(t)); float terr=(floor(t)+s)/steps; return mix(h,terr,clamp(${p}.z,0.0,1.0)); }`;
    },
    terrainOutput: () => {
      const height = upstream(graph, node, 'height');
      return `float ${fn}(vec2 xz, Climate c) { return ${height ? `${height}(xz,c)` : '0.0'}; }`;
    },
  };
  return definition?.glslCompiler?.(compiler) || '';
}

function structuralSignature(graph, ordered, slotById) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const parts = [];
  for (const id of ordered) {
    const node = nodes.get(id); const definition = getGraphNodeDefinition(node.type);
    const params = (definition.structuralParams || []).map((key) => key === 'stack'
      ? generateStackGLSL(migrateStack(node.params?.stack)).sig
      : `${key}=${JSON.stringify(node.params?.[key])}`).join(',');
    const links = (definition.inputs || []).map((port) => `${port.id}<-${inputEdge(graph, id, port.id)?.source || '?'}`).join(',');
    parts.push(`${node.type}@${slotById.get(id) ?? '-'}[${params}](${links})`);
  }
  return `graph-v1|${parts.join('|')}`;
}

function packUniforms(graph, ordered, slotById) {
  const packed = emptyPack();
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const id of ordered) {
    const node = nodes.get(id); const slot = slotById.get(id); const definition = getGraphNodeDefinition(node.type);
    if (node.type === 'currentTerrain') {
      const stackPack = packStackUniforms(migrateStack(node.params?.stack));
      const count = activeLayers(migrateStack(node.params?.stack)).length;
      for (let i = 0; i < count; i++) for (const key of ['strength', 'scale', 'seed', 'paramsA', 'paramsB', 'maskA', 'maskB', 'maskC']) packed[key][slot + i] = structuredClone(stackPack[key][i]);
      continue;
    }
    if (slot == null) continue;
    if (getGraphNodeDefinition(node.type)?.noiseType) {
      const one = packStackUniforms({ version: 1, layers: [sourceLayer(node)] });
      for (const key of ['strength', 'scale', 'seed', 'paramsA', 'paramsB', 'maskA', 'maskB', 'maskC']) packed[key][slot] = structuredClone(one[key][0]);
    } else if (definition?.landform) {
      packed.scale[slot] = num(node.params.scale, 1);
      packed.seed[slot] = seedDomainOffset(node.params.seed);
      if (node.type === 'mountain') {
        packed.strength[slot] = num(node.params.height, 1.15);
        packed.paramsA[slot] = [num(node.params.radius, 1.25), num(node.params.sharpness, 1.65), num(node.params.roughness, 0.55), 0];
        packed.paramsB[slot] = [num(node.params.persistence, 0.5), num(node.params.lacunarity, 2), 0, 0];
      } else if (node.type === 'mountainRange') {
        packed.strength[slot] = num(node.params.height, 1.2);
        packed.paramsA[slot] = [num(node.params.direction, 0.7), num(node.params.width, 0.42), num(node.params.length, 2.4), num(node.params.sharpness, 1.8)];
        packed.paramsB[slot] = [num(node.params.roughness, 0.65), num(node.params.persistence, 0.5), num(node.params.lacunarity, 2.1), 0];
      } else if (node.type === 'ridge') {
        packed.strength[slot] = num(node.params.height, 0.95);
        packed.paramsA[slot] = [num(node.params.direction, 1.15), num(node.params.width, 0.28), num(node.params.sharpness, 2.2), num(node.params.breakup, 1.3)];
        packed.paramsB[slot] = [num(node.params.roughness, 0.45), num(node.params.persistence, 0.48), num(node.params.lacunarity, 2.05), 0];
      } else if (node.type === 'island') {
        packed.strength[slot] = num(node.params.height, 1.05);
        packed.paramsA[slot] = [num(node.params.radius, 1.35), num(node.params.coast, 0.28), num(node.params.plateau, 0.32), num(node.params.roughness, 0.72)];
        packed.paramsB[slot] = [num(node.params.persistence, 0.5), num(node.params.lacunarity, 2), 0, 0];
      } else if (node.type === 'singleCrater') {
        packed.strength[slot] = num(node.params.depth, 0.75);
        packed.paramsA[slot] = [num(node.params.radius, 0.9), num(node.params.rimHeight, 0.42), num(node.params.rimWidth, 0.18), num(node.params.roughness, 0.2)];
      }
    } else if (node.type === 'domainWarp') {
      packed.strength[slot] = num(node.params.strength, 0.7); packed.scale[slot] = num(node.params.scale, 1); packed.seed[slot] = seedDomainOffset(node.params.seedOffset);
    } else if (node.type === 'combine') packed.paramsA[slot][0] = num(node.params.mix, 0.5);
    else if (node.type === 'math') packed.paramsA[slot] = [num(node.params.value, 1), num(node.params.min), num(node.params.max, 1), 0];
    else if (node.type === 'remap') packed.paramsA[slot] = [num(node.params.inMin), num(node.params.inMax, 1), num(node.params.outMin), num(node.params.outMax, 1)];
    else if (node.type === 'terrace') packed.paramsA[slot] = [num(node.params.count, 12), num(node.params.smoothness, 0.5), num(node.params.strength, 1), 0];
  }
  const output = findOutputNode(graph);
  return { ...packed, normalize: output?.params?.normalize === true, outMin: num(output?.params?.outMin), outMax: num(output?.params?.outMax, 1.35) };
}

function cpuEvaluator(graph) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const output = findOutputNode(graph);
  const evalNode = (id, x, z, ctx) => {
    const node = nodes.get(id); const get = (port, px = x, pz = z) => {
      const edge = inputEdge(graph, id, port);
      return edge ? evalNode(edge.source, px, pz, ctx) : 0;
    };
    const definition = getGraphNodeDefinition(node.type);
    const u = ctx.uniforms;
    const point = () => {
      const scale = num(node.params.scale, 1);
      return {
        px: x * u.uFrequency.value * scale,
        pz: z * u.uFrequency.value * scale,
        seed: seedDomainOffset(node.params.seed),
      };
    };
    const fractal = (px, pz, octaves = node.params.octaves, persistence = node.params.persistence, lacunarity = node.params.lacunarity) => fbm2(px, pz, octaves, num(persistence, 0.5), num(lacunarity, 2));
    const smoothstep = (edge0, edge1, value) => {
      const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(edge1 - edge0, 1e-6)));
      return t * t * (3 - 2 * t);
    };
    const evaluator = {
      currentTerrain: () => evalStack2D(migrateStack(node.params?.stack), x, z, { ...ctx, uniforms: { ...ctx.uniforms, uAmplitude: { value: 1 } } }),
      classicTerrain: () => ctx.legacy2d?.(x, z) || 0,
      source: () => {
        const def = getNoiseType(definition.noiseType), layer = sourceLayer(node);
        const sx = u.uSeedOffset.value.x, sz = u.uSeedOffset.value.y, freq = u.uFrequency.value;
        const seed = seedDomainOffset(node.params[definition.seedParam || 'seedOffset']), scale = def.scaleKey ? num(node.params[def.scaleKey], 1) : 1;
        return (def.eval2d?.((x * freq + sx) * scale + seed, (z * freq + sz) * scale + seed * 1.7 + 3.1, layer, ctx) || 0) * num(node.params.strength, 1);
      },
      mountain: () => {
        const { px, pz, seed } = point();
        const radius = Math.max(num(node.params.radius, 1.25), 0.001);
        const silhouette = Math.pow(Math.max(1 - Math.hypot(px, pz) / radius, 0), Math.max(num(node.params.sharpness, 1.65), 0.01));
        const detail = fractal(px * 2.6 + seed, pz * 2.6 + seed * 1.7 + 3.1);
        const ridge = 1 - Math.abs(detail * 2 - 1);
        return num(node.params.height, 1.15) * silhouette * (1 + (ridge - 1) * num(node.params.roughness, 0.55));
      },
      mountainRange: () => {
        const { px, pz, seed } = point(), direction = num(node.params.direction, 0.7);
        const dx = Math.cos(direction), dz = Math.sin(direction);
        const along = px * dx + pz * dz;
        let across = px * -dz + pz * dx;
        across += (vnoise2(along * 1.25 + seed, seed * 0.37) - 0.5) * num(node.params.roughness, 0.65);
        const envelope = Math.exp(-Math.pow(Math.abs(across) / Math.max(num(node.params.width, 0.42), 0.01), 2))
          * Math.exp(-Math.pow(Math.abs(along) / Math.max(num(node.params.length, 2.4), 0.01), 4));
        const detail = fractal(along * 0.75 + seed, across * 3.2 + seed * 1.7 + 3.1);
        const ridge = Math.pow(Math.max(1 - Math.abs(detail * 2 - 1), 0), Math.max(num(node.params.sharpness, 1.8), 0.01));
        return num(node.params.height, 1.2) * envelope * (0.42 + (1.18 - 0.42) * ridge);
      },
      ridge: () => {
        const { px, pz, seed } = point(), direction = num(node.params.direction, 1.15);
        const dx = Math.cos(direction), dz = Math.sin(direction);
        const along = px * dx + pz * dz;
        const across = px * -dz + pz * dx;
        const bend = (vnoise2(along * Math.max(num(node.params.breakup, 1.3), 0.01) + seed, seed * 0.41) - 0.5) * num(node.params.roughness, 0.45);
        const crest = Math.exp(-Math.pow(Math.abs(across + bend) / Math.max(num(node.params.width, 0.28), 0.01), Math.max(num(node.params.sharpness, 2.2), 0.5)));
        const detail = fractal(px * 3 + seed, pz * 3 + seed * 1.7 + 3.1);
        return num(node.params.height, 0.95) * crest * (0.62 + (1.18 - 0.62) * detail);
      },
      island: () => {
        const { px, pz, seed } = point();
        const radius = Math.max(num(node.params.radius, 1.35), 0.01), coast = Math.max(0.01, Math.min(0.95, num(node.params.coast, 0.28)));
        const mask = 1 - smoothstep(radius * (1 - coast), radius, Math.hypot(px, pz));
        const detail = fractal(px * 1.85 + seed, pz * 1.85 + seed * 1.7 + 3.1);
        const shaped = num(node.params.plateau, 0.32) + (1 - num(node.params.plateau, 0.32)) * detail;
        const interior = 1 + (shaped - 1) * num(node.params.roughness, 0.72);
        return num(node.params.height, 1.05) * mask * Math.max(interior, 0);
      },
      singleCrater: () => {
        const { px, pz, seed } = point();
        const radius = Math.max(num(node.params.radius, 0.9), 0.01), r = Math.hypot(px, pz) / radius;
        const bowl = -Math.pow(Math.max(1 - r, 0), 1.65);
        const rim = num(node.params.rimHeight, 0.42) * Math.exp(-Math.pow((r - 1) / Math.max(num(node.params.rimWidth, 0.18), 0.01), 2));
        const damage = fractal(px * 4 + seed, pz * 4 + seed * 1.7 + 3.1, node.params.octaves, 0.5, 2);
        const breakup = (damage - 0.5) * num(node.params.roughness, 0.2) * (1 - smoothstep(1, 1.4, r));
        return num(node.params.depth, 0.75) * (bowl + rim + breakup);
      },
      domainWarp: () => {
        const def = getNoiseType('domainWarp'), u = ctx.uniforms, seed = seedDomainOffset(node.params.seedOffset);
        const state = { px: x * u.uFrequency.value + u.uSeedOffset.value.x + seed, pz: z * u.uFrequency.value + u.uSeedOffset.value.y + seed * 1.7 + 3.1 };
        def.modJs2(state, { params: node.params }, num(node.params.strength, 0.7));
        return get('source', (state.px - u.uSeedOffset.value.x - seed) / u.uFrequency.value, (state.pz - u.uSeedOffset.value.y - seed * 1.7 - 3.1) / u.uFrequency.value);
      },
      combine: () => { const av=get('a'), bv=get('b'); return node.params.operation === 'mix' ? av + (bv-av)*num(node.params.mix,0.5) : blendJs(node.params.operation,av,bv); },
      math: () => {
        const h=get('source'), v=num(node.params.value,1); const ops={ add:()=>h+v, subtract:()=>h-v, multiply:()=>h*v, divide:()=>h/(Math.abs(v)<1e-4?1e-4:v), power:()=>Math.sign(h)*Math.pow(Math.max(Math.abs(h),1e-6),v), absolute:()=>Math.abs(h), negate:()=>-h, invert:()=>1-h, clamp:()=>Math.min(Math.max(h,Math.min(num(node.params.min),num(node.params.max,1))),Math.max(num(node.params.min),num(node.params.max,1))) }; return (ops[node.params.operation]||ops.multiply)();
      },
      remap: () => { const h=get('source'), lo=num(node.params.inMin), hi=num(node.params.inMax,1); let t=(h-lo)/Math.max(hi-lo,1e-6); if(node.params.clamp!==false)t=Math.min(1,Math.max(0,t)); return num(node.params.outMin)+(num(node.params.outMax,1)-num(node.params.outMin))*t; },
      terrace: () => { const h=get('source'), steps=Math.max(1,num(node.params.count,12)), t=h*steps, f=t-Math.floor(t), e0=.5-num(node.params.smoothness,.5)*.5,e1=.5+num(node.params.smoothness,.5)*.5,q=Math.min(1,Math.max(0,(f-e0)/Math.max(e1-e0,1e-6))),s=q*q*(3-2*q),terr=(Math.floor(t)+s)/steps; return h+(terr-h)*num(node.params.strength,1); },
      terrainOutput: () => get('height'),
    };
    return definition?.cpuEvaluator?.(evaluator) ?? 0;
  };
  return (x, z, ctx) => evalNode(output.id, x, z, ctx) * (ctx.uniforms.uAmplitude?.value ?? 1);
}

export function compileTerrainGraph(graph) {
  const validation = validateGraph(graph);
  if (!validation.ok) return { ok: false, diagnostics: validation.diagnostics, program: null };
  const ordered = topologicalSort(graph, { reachableOnly: true });
  const reachable = reachableNodeIds(graph);
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const slotById = new Map(); let slot = 0;
  const slotOrder = [
    ...ordered.filter((id) => nodes.get(id)?.type === 'currentTerrain'),
    ...ordered.filter((id) => nodes.get(id)?.type !== 'currentTerrain'),
  ];
  for (const id of slotOrder) {
    const node = nodes.get(id); const count = getGraphNodeDefinition(node.type)?.uniformSlots?.(node) || 0;
    if (count) { slotById.set(id, slot); slot += count; }
  }
  const output = findOutputNode(graph);
  const sig = structuralSignature(graph, ordered, slotById);
  let shaderSource = shaderSourceCache.get(sig);
  if (!shaderSource) {
    const functions = ordered.filter((id) => reachable.has(id)).map((id) => nodeFunction(graph, nodes.get(id), slotById.get(id))).join('\n\n');
    shaderSource = cacheShaderSource(sig, {
      body2d: `${GRAPH_FUNCTIONS_MARKER}\n${functions}\n${GRAPH_BODY_MARKER}\n  h = ${safe(output.id)}(xz, c);`,
      body3d: '',
    });
  }
  const program = {
    kind: 'graph', sig,
    body2d: shaderSource.body2d,
    body3d: shaderSource.body3d,
    packUniforms: () => packUniforms(graph, ordered, slotById),
    evaluate2D: cpuEvaluator(graph),
    graph: structuredClone(graph), diagnostics: [], slotCount: slot,
  };
  return { ok: true, diagnostics: [], program };
}
