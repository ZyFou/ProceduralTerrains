import { blendGlslStmt, blendJs } from '../noise/blendModes.js';
import { activeLayers, migrateStack } from '../noise/NoiseStack.js';
import { evalStack2D, generateStackGLSL, packStackUniforms } from '../noise/noiseStackCodegen.js';
import { fbm2, hash12, vnoise2 } from '../noise/cpuNoise.js';
import { getNoiseType } from '../noise/noiseTypes.js';
import { seedDomainOffset } from '../noise/seedDomain.js';
import { getGraphNodeDefinition } from './GraphRegistry.js';
import { findOutputNode, inputEdge, reachableNodeIds, topologicalSort, validateGraph } from './GraphDocument.js';
import { getTerrainGradientPreset } from './TerrainGradientPresets.js';

export const GRAPH_FUNCTIONS_MARKER = '/*__TERRAIN_GRAPH_FUNCTIONS__*/';
export const GRAPH_BODY_MARKER = '/*__TERRAIN_GRAPH_BODY__*/';
export const GRAPH_COLOR_FUNCTIONS_MARKER = '/*__TERRAIN_GRAPH_COLOR_FUNCTIONS__*/';

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

const MOUNTAIN_STYLE_TUNING = {
  basic: { ridge: 0.76, valley: 0.62, detail: 0.68, strata: 0, cell: 0.88, envelope: 1, roughness: 0.48 },
  eroded: { ridge: 0.94, valley: 1.18, detail: 0.62, strata: 0, cell: 1.02, envelope: 0.92, roughness: 0.44 },
  old: { ridge: 0.56, valley: 0.76, detail: 0.38, strata: 0.012, cell: 0.8, envelope: 1.18, roughness: 0.34 },
  alpine: { ridge: 1.16, valley: 1.04, detail: 1, strata: 0, cell: 1.12, envelope: 0.78, roughness: 0.62 },
  strata: { ridge: 0.84, valley: 0.8, detail: 0.7, strata: 0.052, cell: 0.94, envelope: 0.94, roughness: 0.48 },
};

const MOUNTAIN_BULK_TUNING = {
  low: { radius: 1.02, mass: 0.88, spread: 0.62 },
  medium: { radius: 1.25, mass: 1, spread: 0.78 },
  high: { radius: 1.48, mass: 1.14, spread: 0.94 },
};

function mountainStyle(node) {
  const legacy = ({ weathered: 'old' }[node.params.formation] || node.params.formation);
  const requested = node.params.style;
  const migrated = requested || legacy || 'alpine';
  return { key: MOUNTAIN_STYLE_TUNING[migrated] ? migrated : 'alpine', ...(MOUNTAIN_STYLE_TUNING[migrated] || MOUNTAIN_STYLE_TUNING.alpine) };
}

function mountainBulk(node) {
  const key = MOUNTAIN_BULK_TUNING[node.params.bulk] ? node.params.bulk : 'medium';
  return { key, ...MOUNTAIN_BULK_TUNING[key] };
}

function mountainParams(node) {
  const style = mountainStyle(node), bulk = mountainBulk(node);
  const reduced = node.params.reduceDetails === true || num(node.params.reduceDetails) > 0.5;
  return {
    style, bulk, reduced,
    radius: Math.max(num(node.params.radius, bulk.radius), 0.001),
    sharpness: Math.max(num(node.params.sharpness, style.envelope), 0.01),
    roughness: num(node.params.roughness, style.roughness) * (reduced ? 0.24 : 1),
    ridgeStrength: num(node.params.ridgeStrength, 0.96),
    valleyDepth: num(node.params.valleyDepth, 0.78),
    foothills: num(node.params.foothills, 0.36),
    peakSpread: num(node.params.peakSpread, bulk.spread),
    persistence: num(node.params.persistence, 0.5),
    lacunarity: num(node.params.lacunarity, 2.03),
    x: num(node.params.x),
    y: num(node.params.y),
  };
}

function thermalParams(node) {
  const hasAngle = Number.isFinite(Number(node.params.talusAngle));
  return {
    duration: Math.max(num(node.params.duration, node.params.iterations ?? 12), 1),
    featureScale: Math.max(num(node.params.featureScale, node.params.radius ?? 30), 1),
    talus: Math.max(hasAngle ? num(node.params.talusAngle, 35) / 500 : num(node.params.talus, 0.07), 0.0001),
    anisotropy: Math.max(0, Math.min(1, num(node.params.anisotropy, 0.16))),
    settling: Math.max(0, Math.min(1, num(node.params.settling, node.params.deposition ?? 0.72))),
    sedimentRemoval: Math.max(0, Math.min(1, num(node.params.sedimentRemoval, 0.18))),
  };
}

function emptyPack() {
  return {
    strength: new Array(12).fill(0), scale: new Array(12).fill(1), seed: new Array(12).fill(0),
    paramsA: Array.from({ length: 12 }, vec4), paramsB: Array.from({ length: 12 }, vec4),
    maskA: Array.from({ length: 12 }, vec4), maskB: Array.from({ length: 12 }, vec4), maskC: Array.from({ length: 12 }, vec4),
    colorA: Array.from({ length: 8 }, vec4), colorB: Array.from({ length: 8 }, vec4),
    colorC: Array.from({ length: 8 }, vec4), colorD: Array.from({ length: 8 }, vec4),
    colorParams: Array.from({ length: 8 }, vec4),
  };
}

function rgb(value, fallback = '#808080') {
  const raw = typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  return [
    parseInt(raw.slice(1, 3), 16) / 255,
    parseInt(raw.slice(3, 5), 16) / 255,
    parseInt(raw.slice(5, 7), 16) / 255,
  ];
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
      const { style, bulk, reduced } = mountainParams(node);
      const cellularHelper = reduced ? '' : `void ${fn}_cellular(vec2 p, float seed, out float cellF1, out float cellF2) {
  vec2 base=floor(p), local=fract(p); cellF1=1e6; cellF2=1e6;
  for(int iy=-1;iy<=1;iy++) { for(int ix=-1;ix<=1;ix++) {
    vec2 lattice=base+vec2(float(ix),float(iy));
    vec2 jitter=vec2(hash12(lattice+vec2(seed*0.071+11.3,seed*0.037+29.1)),hash12(lattice+vec2(-seed*0.043+47.7,seed*0.059+3.9)));
    vec2 delta=vec2(float(ix),float(iy))+mix(vec2(0.5),jitter,0.82)-local;
    float distance2=dot(delta,delta);
    if(distance2<cellF1){cellF2=cellF1;cellF1=distance2;}else if(distance2<cellF2){cellF2=distance2;}
  } }
}`;
      const cellularFields = reduced
        ? `// reduced-details fast path: broad cellular character without the 3x3 Worley stencil
  vec2 reducedCellP=q/max(radius*0.68,0.001)*${glsl(style.cell)};
  float reducedCellA=vnoise(reducedCellP+vec2(seed*0.071+11.3,seed*0.037+29.1));
  float reducedCellB=vnoise(ROT2*reducedCellP*0.83+vec2(-seed*0.043+47.7,seed*0.059+3.9));
  float cellCenter=pow(max(1.0-abs(reducedCellA*2.0-1.0),0.0),0.72);
  float cellBorder=pow(max(1.0-abs(reducedCellB*2.0-1.0),0.0),1.65);`
        : `float cellF1,cellF2;
  ${fn}_cellular(q/max(radius*0.68,0.001)*${glsl(style.cell)},seed,cellF1,cellF2);
  float cellCenter=exp(-cellF1*2.35);
  float cellBorder=1.0-smoothstep(0.035,0.31,sqrt(max(cellF2,0.0))-sqrt(max(cellF1,0.0)));`;
      const detailField = reduced
        ? 'float detail=mix(structure,macro,0.38);'
        : glslFbm('detail', 'q*5.4+vec2(seed*0.191+7.1,seed*0.061+31.7)', 3, 'pb.x', 'pb.y');
      const macroOctaves = reduced ? 2 : 3;
      const structureOctaves = reduced ? 2 : 5;
      return `${cellularHelper}

float ${fn}(vec2 xz, Climate c) {
  float height=uLayerStrength[${slot}], scale=uLayerScale[${slot}], seed=uLayerSeed[${slot}];
  vec4 pa=uLayerParamsA[${slot}], pb=uLayerParamsB[${slot}], pc=uLayerMaskA[${slot}];
  vec2 p=xz*uFrequency*scale-vec2(pa.z,pa.w)*2.0;
  float radius=max(pa.x,0.001), turn=seed*0.0137+0.73;
  vec2 dir=vec2(cos(turn),sin(turn)), side=vec2(-dir.y,dir.x);
  vec2 q=vec2(dot(p,dir),dot(p,side));
  float warpA=(vnoise(q*0.61+vec2(seed*0.17,seed*0.037))-0.5)*2.0;
  float warpB=(vnoise(q*0.49+vec2(seed*0.019+17.3,-seed*0.041+8.7))-0.5)*2.0;
  q+=vec2(warpA*radius*0.31,warpB*radius*0.25);
  float irregularEdge=(vnoise(q*0.72+vec2(seed*0.11,seed*0.29+37.0))-0.5)*0.22;
  float radial=length(vec2(q.x/(radius*1.08),q.y/(radius*0.9)))+irregularEdge;
  float envelope=pow(max(1.0-smoothstep(0.68,1.24,radial),0.0),max(pc.z,0.2));
  float spread=clamp(pc.y,0.15,1.25);
  vec2 d0=vec2((q.x+radius*0.12*spread)/(radius*0.7),(q.y-radius*0.03*spread)/(radius*0.56));
  vec2 d1=vec2((q.x-radius*0.46*spread)/(radius*0.5),(q.y+radius*0.26*spread)/(radius*0.4));
  vec2 d2=vec2((q.x+radius*0.39*spread)/(radius*0.43),(q.y-radius*0.37*spread)/(radius*0.36));
  float peak0=exp(-pow(length(d0),1.46));
  float peak1=0.82*exp(-pow(length(d1),1.58));
  float peak2=0.7*exp(-pow(length(d2),1.64));
  float saddle=0.48*exp(-pow(length(vec2(q.x/(radius*0.92),(q.y+radius*0.08)/(radius*0.38))),1.72));
  ${glslFbm('macro', 'q*0.83+vec2(seed*0.073,seed*0.111+19.7)', macroOctaves, '0.55', '2.03')}
  float massif=pow(max(max(peak0,peak1),max(peak2,saddle)),0.82)*mix(0.74,1.27,macro)*${glsl(bulk.mass)};
  ${cellularFields}
  ${glslFbm('structure', 'q*1.72+vec2(seed*0.1,seed*0.17+3.1)', structureOctaves, 'pb.x', 'pb.y')}
  float fractured=pow(max(1.0-abs(structure*2.0-1.0),0.0),0.78);
  float ridgeNetwork=pow(clamp(cellCenter*0.53+fractured*0.62,0.0,1.0),1.28);
  float drainageNetwork=pow(clamp(cellBorder*(0.58+0.42*(1.0-structure)),0.0,1.0),2.15);
  float body=envelope*(0.1+0.9*massif);
  body*=0.54+ridgeNetwork*pb.z*0.72*${glsl(style.ridge)};
  body+=ridgeNetwork*pb.z*${glsl(style.ridge)}*envelope*(0.035+0.13*massif)*smoothstep(0.08,0.94,radial);
  body-=drainageNetwork*pb.w*${glsl(style.valley)}*body*smoothstep(0.12,1.02,radial)*0.36;
  float foothillGate=smoothstep(0.46,0.96,radial)*(1.0-smoothstep(1.0,1.23,radial));
  float foothillRidges=pow(max(1.0-abs(macro*2.0-1.0),0.0),1.7);
  body+=envelope*foothillGate*pc.x*(0.035+foothillRidges*0.1);
  ${detailField}
  float surfaceGate=envelope*smoothstep(0.04,0.82,max(body,0.0));
  body+=(detail-0.5)*pa.y*${glsl(style.detail)}*(0.035+0.12*fractured)*surfaceGate;
  float brokenStrata=sin((body*11.0+dot(q,vec2(0.22,-0.13))+(structure-0.5)*0.9)*6.2831853);
  body+=brokenStrata*pa.y*${glsl(style.strata)}*surfaceGate*smoothstep(0.3,0.72,macro);
  return height*max(body,0.0);
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
  float scale=uLayerScale[${slot}], eff=uLayerStrength[${slot}], seed=uLayerSeed[${slot}];
  vec4 pa=uLayerParamsA[${slot}];
  vec2 pw = xz * uFrequency + uSeedOffset + vec2(seed, seed * 1.7 + 3.1);
  vec2 WP = pw * scale;
  vec2 perturb=vec2(vnoise(WP*0.47+vec2(19.1,73.7)),vnoise(WP*0.47+vec2(91.3,7.9)))-0.5;
  WP+=perturb*pa.x;
  float wx = 0.0, wz = 0.0;
  { float amp = 0.5, norm = 0.0; vec2 q = WP + vec2(13.7, 41.3); for (int i=0;i<${oct};i++){ wx += amp*vnoise(q); norm+=amp; amp*=pa.y; q=ROT2*q*2.0; } wx/=max(norm,1e-4); }
  { float amp = 0.5, norm = 0.0; vec2 q = WP + vec2(87.2, 9.1); for (int i=0;i<${oct};i++){ wz += amp*vnoise(q); norm+=amp; amp*=pa.y; q=ROT2*q*2.0; } wz/=max(norm,1e-4); }
  vec2 warped = pw + (vec2(wx,wz)-0.5)*eff;
  vec2 warpedXZ = (warped - uSeedOffset - vec2(seed, seed * 1.7 + 3.1)) / max(uFrequency, 1e-6);
  return ${source}(warpedXZ, climateAt(warped));
}`;
    },
    shaper: () => {
      return `float ${fn}(vec2 xz, Climate c) {
  float strength=uLayerStrength[${slot}], bodyScale=max(uLayerScale[${slot}]*0.01,0.05);
  vec4 pa=uLayerParamsA[${slot}];
  float h=${source}(xz,c);
  float exponent=pa.x>=0.0?mix(1.0,0.58,pa.x):mix(1.0,1.68,-pa.x);
  float shapedBody=sign(h)*pow(max(abs(h)/bodyScale,1e-6),exponent)*bodyScale;
  float preservedDetail=mix(shapedBody,h+(shapedBody-h)*0.45,clamp(pa.y,0.0,1.0));
  return mix(h,preservedDetail,clamp(strength,0.0,1.0));
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
    stratify: () => {
      const oct = Math.max(1, Math.min(6, Math.round(num(node.params.octaves, 4))));
      return `float ${fn}(vec2 xz, Climate c) {
  float h=${source}(xz,c), intensity=uLayerStrength[${slot}], spacing=max(uLayerScale[${slot}],0.002), seed=uLayerSeed[${slot}];
  vec4 pa=uLayerParamsA[${slot}];
  vec2 p=xz*uFrequency;
  vec2 direction=vec2(cos(pa.z),sin(pa.z));
  ${glslFbm('broken', 'p*2.35+vec2(seed*0.13,seed*0.19+31.0)', oct, '0.52', '2.07')}
  float zones=vnoise(p*0.43+vec2(seed*0.031+71.0,seed*0.047+9.0));
  float phase=(h+dot(p,direction)*pa.y*0.34+(broken-0.5)*spacing*2.2)/spacing;
  float wave=sin(phase*6.2831853)+sin(phase*12.5663706+broken*2.7)*0.28;
  wave=clamp(wave/1.28,-1.0,1.0);
  float profile=sign(wave)*pow(max(abs(wave),1e-5),mix(1.72,0.42,clamp(pa.x,0.0,1.0)));
  float localZone=smoothstep(0.28,0.72,zones)*smoothstep(0.08,0.58,broken);
  float elevationGate=smoothstep(0.025,0.28,abs(h));
  float layered=h+profile*intensity*spacing*0.54*localZone*elevationGate;
  return max(layered,min(h,0.0));
}`;
    },
    geologyDetail: () => {
      const oct = Math.max(2, Math.min(7, Math.round(num(node.params.octaves, 5))));
      return `float ${fn}(vec2 xz, Climate c) {
  float h=${source}(xz,c), strength=uLayerStrength[${slot}], scale=uLayerScale[${slot}], seed=uLayerSeed[${slot}];
  vec4 pa=uLayerParamsA[${slot}], pb=uLayerParamsB[${slot}];
  vec2 p=xz*uFrequency*scale+vec2(seed,seed*1.7+3.1);
  ${glslFbm('rock', 'p', oct, 'pa.w', 'pb.x')}
  float ridge=1.0-abs(rock*2.0-1.0);
  float strata=sin((h*pa.z+(rock-0.5)*0.65)*6.2831853);
  float structure=mix(rock-0.5,ridge-0.5,clamp(pa.x,0.0,1.0));
  structure+=strata*0.18*pa.y;
  float elevationGate=smoothstep(0.04,0.38,abs(h));
  return h+structure*strength*elevationGate;
}`;
    },
    thermalErosion: () => {
      return `float ${fn}(vec2 xz, Climate c) {
  float strength=uLayerStrength[${slot}], radius=max(uLayerScale[${slot}],1.0), seed=uLayerSeed[${slot}];
  vec4 pa=uLayerParamsA[${slot}], pb=uLayerParamsB[${slot}];
  float h=${source}(xz,c);
  float talus=max(pa.x,0.0001), passGain=1.0-exp(-max(pa.y,1.0)*0.22);
  float sedimentRemoval=clamp(pa.w,0.0,1.0), anisotropy=clamp(pb.x,0.0,1.0);
  float turn=seed*0.017+0.31;
  vec2 direction=vec2(cos(turn),sin(turn)), side=vec2(-direction.y,direction.x);
  vec2 terrainP=xz*uFrequency*max(140.0/radius,0.35)+vec2(seed,seed*1.7+3.1);
  vec2 talusP=vec2(dot(terrainP,direction),dot(terrainP,side)*mix(1.0,0.42,anisotropy));
  float directionalTalus=1.0-abs(vnoise(talusP)*2.0-1.0);
  float screeField=vnoise(talusP*0.43+vec2(71.0,19.0));
  float reliefProxy=max(h,0.0)*(0.08+directionalTalus*0.16+abs(screeField-0.5)*0.08);
  float activity=smoothstep(talus*0.42,talus*2.6,reliefProxy);
  float released=max(reliefProxy-talus*0.42,0.0)*mix(0.22,0.36,sedimentRemoval);
  float midSlope=smoothstep(talus*0.5,talus*6.0,max(h,0.0))*(1.0-smoothstep(0.52,1.05,max(h,0.0)));
  float screeDeposit=(1.0-directionalTalus)*midSlope*clamp(pa.z,0.0,1.0)*(1.0-sedimentRemoval)*0.018;
  float creep=max(h,0.0)*activity*mix(0.012,0.006,sedimentRemoval);
  float relaxed=h-(released+creep)*strength*passGain+screeDeposit*strength*passGain;
  float sedimentTexture=(screeField-0.5)*(1.0-sedimentRemoval)*0.012*strength*activity;
  return max(relaxed+sedimentTexture,min(h,0.0));
}`;
    },
    naturalErosion: () => {
      return `float ${fn}(vec2 xz, Climate c) {
  float amount=uLayerStrength[${slot}], seed=uLayerSeed[${slot}];
  vec4 pa=uLayerParamsA[${slot}];
  float h=${source}(xz,c);
  float featureScale=max(pa.x/34.0,0.2);
  vec2 p=(xz*uFrequency*uLayerScale[${slot}]/featureScale)+vec2(seed,seed*1.7+3.1);
  float primary=1.0-abs(vnoise(p)*2.0-1.0);
  float tributary=1.0-abs(vnoise(p*0.47+vec2(37.1,91.7))*2.0-1.0);
  float drainage=pow(clamp(primary*0.72+tributary*0.28,0.0,1.0),5.0);
  float valley=1.0-smoothstep(0.18,0.82,clamp(h,0.0,1.0));
  float exposed=smoothstep(pa.y*0.035,pa.y*0.18+0.08,max(h,0.0));
  float weathering=amount*exposed*(0.0025+drainage*0.006);
  float channelCut=drainage*pa.z*amount*valley*0.055;
  float sediment=vnoise(p*0.29+vec2(113.0,17.0));
  float deposit=smoothstep(0.48,0.82,sediment)*(1.0-drainage)*valley*pa.w*amount*0.018;
  return h-weathering-channelCut+deposit;
}`;
    },
    terrainOutput: () => {
      const height = upstream(graph, node, 'height');
      return `float ${fn}(vec2 xz, Climate c) { return ${height ? `${height}(xz,c)` : '0.0'}; }`;
    },
  };
  return definition?.glslCompiler?.(compiler) || '';
}

function colorUpstream(graph, node, port) {
  const edge = inputEdge(graph, node.id, port);
  return edge ? safe(edge.source) : null;
}

function colorNodeFunction(graph, node, slot) {
  const fn = safe(node.id);
  const base = colorUpstream(graph, node, 'base');
  const definition = getGraphNodeDefinition(node.type);
  const compiler = {
    terrainGradient: () => `vec3 ${fn}(vec2 xz, float h01, float slope, float detail, float moisture, vec3 fallback) {
  vec4 low=uGraphColorA[${slot}], mid=uGraphColorB[${slot}], high=uGraphColorC[${slot}], summit=uGraphColorD[${slot}];
  vec4 gp=uGraphColorParams[${slot}];
  float macro=sin(xz.x*0.0017*gp.y+xz.y*0.0011*gp.y+sin(xz.y*0.00073*gp.y)*2.1)*0.5+0.5;
  float fine=fract(sin(dot(floor(xz*0.018),vec2(12.9898,78.233)))*43758.5453);
  float band=clamp(h01+(macro-0.5)*gp.x*0.16+(detail-0.5)*gp.x*0.08,0.0,1.0);
  vec3 col=mix(low.rgb,mid.rgb,smoothstep(0.0,max(low.a,0.01),band));
  col=mix(col,high.rgb,smoothstep(max(low.a,0.01),max(mid.a,low.a+0.01),band));
  col=mix(col,summit.rgb,smoothstep(max(mid.a,low.a+0.01),max(high.a,mid.a+0.01),band));
  col*=mix(1.0-gp.x*0.24,1.0+gp.x*0.18,fine*0.55+macro*0.45);
  return max(col,vec3(0.0));
}`,
    slopeTint: () => `vec3 ${fn}(vec2 xz, float h01, float slope, float detail, float moisture, vec3 fallback) {
  vec3 col=${base}(xz,h01,slope,detail,moisture,fallback);
  vec4 rock=uGraphColorA[${slot}], gp=uGraphColorParams[${slot}];
  float mineral=sin(xz.x*0.013*gp.w+xz.y*0.009*gp.w+detail*5.0)*0.5+0.5;
  vec3 rockCol=rock.rgb*mix(1.0-gp.z,1.0+gp.z*0.7,mineral);
  float exposure=smoothstep(gp.x,max(gp.y,gp.x+0.001),slope+(detail-0.5)*0.05);
  return mix(col,rockCol,exposure*rock.a);
}`,
    moistureTint: () => `vec3 ${fn}(vec2 xz, float h01, float slope, float detail, float moisture, vec3 fallback) {
  vec3 col=${base}(xz,h01,slope,detail,moisture,fallback);
  vec4 dry=uGraphColorA[${slot}], wet=uGraphColorB[${slot}];
  float wetness=smoothstep(max(dry.a-wet.a,0.0),min(dry.a+wet.a,1.0),moisture+(detail-0.5)*0.08);
  vec3 tint=mix(dry.rgb,wet.rgb,wetness);
  float climateAmount=uGraphColorParams[${slot}].x*(1.0-smoothstep(0.38,0.82,slope));
  return mix(col,col*tint*1.75,climateAmount);
}`,
    colorGrade: () => `vec3 ${fn}(vec2 xz, float h01, float slope, float detail, float moisture, vec3 fallback) {
  vec3 col=${base}(xz,h01,slope,detail,moisture,fallback);
  vec4 grade=uGraphColorParams[${slot}];
  float luma=dot(col,vec3(0.299,0.587,0.114));
  col=mix(vec3(luma),col,grade.x);
  col=(col-0.5)*grade.y+0.5;
  col*=grade.z;
  col*=vec3(1.0+grade.w*0.09,1.0+grade.w*0.015,1.0-grade.w*0.08);
  return max(col,vec3(0.0));
}`,
  };
  return definition?.glslCompiler?.(compiler) || '';
}

function graphColorSource(graph, ordered, colorSlotById) {
  const output = findOutputNode(graph);
  const colorEdge = inputEdge(graph, output.id, 'color');
  if (!colorEdge) return '';
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const functions = ordered
    .filter((id) => getGraphNodeDefinition(nodes.get(id)?.type)?.outputs?.some((port) => port.type === 'analytic-color'))
    .map((id) => colorNodeFunction(graph, nodes.get(id), colorSlotById.get(id)))
    .filter(Boolean)
    .join('\n\n');
  return `${GRAPH_COLOR_FUNCTIONS_MARKER}
#define MAX_GRAPH_COLOR_NODES 8
uniform vec4 uGraphColorA[MAX_GRAPH_COLOR_NODES];
uniform vec4 uGraphColorB[MAX_GRAPH_COLOR_NODES];
uniform vec4 uGraphColorC[MAX_GRAPH_COLOR_NODES];
uniform vec4 uGraphColorD[MAX_GRAPH_COLOR_NODES];
uniform vec4 uGraphColorParams[MAX_GRAPH_COLOR_NODES];
${functions}
vec3 applyTerrainGraphColor(vec3 fallback, vec2 xz, float h01, float slope, float detail, float moisture) {
  return ${safe(colorEdge.source)}(xz,h01,slope,detail,moisture,fallback);
}`;
}

function structuralSignature(graph, ordered, slotById, colorSlotById) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const parts = [];
  for (const id of ordered) {
    const node = nodes.get(id); const definition = getGraphNodeDefinition(node.type);
    // Mountain's Reduce Details switch selects a materially smaller shader
    // implementation, so it must invalidate the source cache even though the
    // rest of the Mountain controls remain uniform-only.
    const structuralParams = node.type === 'mountain'
      ? [...new Set([...(definition.structuralParams || []), 'reduceDetails'])]
      : (definition.structuralParams || []);
    const params = structuralParams.map((key) => key === 'stack'
      ? generateStackGLSL(migrateStack(node.params?.stack)).sig
      : `${key}=${JSON.stringify(node.params?.[key])}`).join(',');
    const links = (definition.inputs || []).map((port) => `${port.id}<-${inputEdge(graph, id, port.id)?.source || '?'}`).join(',');
    parts.push(`${node.type}@${slotById.get(id) ?? '-'}:${colorSlotById.get(id) ?? '-'}[${params}](${links})`);
  }
  return `graph-v2|${parts.join('|')}`;
}

function packUniforms(graph, ordered, slotById, colorSlotById) {
  const packed = emptyPack();
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const id of ordered) {
    const node = nodes.get(id); const slot = slotById.get(id); const colorSlot = colorSlotById.get(id); const definition = getGraphNodeDefinition(node.type);
    if (node.type === 'currentTerrain') {
      const stackPack = packStackUniforms(migrateStack(node.params?.stack));
      const count = activeLayers(migrateStack(node.params?.stack)).length;
      for (let i = 0; i < count; i++) for (const key of ['strength', 'scale', 'seed', 'paramsA', 'paramsB', 'maskA', 'maskB', 'maskC']) packed[key][slot + i] = structuredClone(stackPack[key][i]);
      continue;
    }
    if (colorSlot != null) {
      if (node.type === 'terrainGradient') {
        const preset = getTerrainGradientPreset(node.params.preset);
        const colors = preset.colors.map((value) => rgb(value));
        packed.colorA[colorSlot] = [...colors[0], num(node.params.lowPoint, preset.points[1])];
        packed.colorB[colorSlot] = [...colors[1], num(node.params.highPoint, preset.points[2])];
        packed.colorC[colorSlot] = [...colors[2], num(node.params.summitPoint, preset.points[3])];
        packed.colorD[colorSlot] = [...colors[3], 1];
        packed.colorParams[colorSlot] = [num(node.params.variation, preset.variation), num(node.params.macroScale, preset.macroScale), 0, 0];
      } else if (node.type === 'slopeTint') {
        packed.colorA[colorSlot] = [...rgb(node.params.rockColor, '#6f6b63'), num(node.params.strength, 0.72)];
        packed.colorParams[colorSlot] = [num(node.params.slopeStart, 0.2), num(node.params.slopeEnd, 0.56), num(node.params.variation, 0.12), num(node.params.scale, 0.78)];
      } else if (node.type === 'moistureTint') {
        packed.colorA[colorSlot] = [...rgb(node.params.dryColor, '#8c7458'), num(node.params.balance, 0.5)];
        packed.colorB[colorSlot] = [...rgb(node.params.wetColor, '#314a39'), num(node.params.softness, 0.18)];
        packed.colorParams[colorSlot] = [num(node.params.amount, 0.3), 0, 0, 0];
      } else if (node.type === 'colorGrade') {
        packed.colorParams[colorSlot] = [num(node.params.saturation, 0.92), num(node.params.contrast, 1.04), num(node.params.exposure, 0.96), num(node.params.warmth, 0.02)];
      }
    }
    if (slot == null) continue;
    if (getGraphNodeDefinition(node.type)?.noiseType) {
      const one = packStackUniforms({ version: 1, layers: [sourceLayer(node)] });
      for (const key of ['strength', 'scale', 'seed', 'paramsA', 'paramsB', 'maskA', 'maskB', 'maskC']) packed[key][slot] = structuredClone(one[key][0]);
    } else if (definition?.landform) {
      packed.scale[slot] = num(node.params.scale, 1);
      packed.seed[slot] = seedDomainOffset(node.params.seed);
      if (node.type === 'mountain') {
        const params = mountainParams(node);
        packed.strength[slot] = num(node.params.height, 1.25);
        packed.paramsA[slot] = [params.radius, params.roughness, params.x, params.y];
        packed.paramsB[slot] = [params.persistence, params.lacunarity, params.ridgeStrength, params.valleyDepth];
        packed.maskA[slot] = [params.foothills, params.peakSpread, params.sharpness, params.bulk.mass];
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
      packed.paramsA[slot] = [num(node.params.perturbation, 0.28), num(node.params.roughness, 0.5), 0, 0];
    } else if (node.type === 'shaper') {
      packed.strength[slot] = num(node.params.strength, 0.8);
      packed.scale[slot] = num(node.params.featureScale, 42);
      packed.paramsA[slot] = [num(node.params.shape, 0.38), num(node.params.detailPreservation, 0.82), 0, 0];
    } else if (node.type === 'combine') packed.paramsA[slot][0] = num(node.params.mix, 0.5);
    else if (node.type === 'math') packed.paramsA[slot] = [num(node.params.value, 1), num(node.params.min), num(node.params.max, 1), 0];
    else if (node.type === 'remap') packed.paramsA[slot] = [num(node.params.inMin), num(node.params.inMax, 1), num(node.params.outMin), num(node.params.outMax, 1)];
    else if (node.type === 'terrace') packed.paramsA[slot] = [num(node.params.count, 12), num(node.params.smoothness, 0.5), num(node.params.strength, 1), 0];
    else if (node.type === 'stratify') {
      packed.strength[slot] = num(node.params.intensity, 0.42);
      packed.scale[slot] = num(node.params.spacing, 0.11);
      packed.seed[slot] = seedDomainOffset(node.params.seed);
      packed.paramsA[slot] = [num(node.params.shape, 0.62), num(node.params.tilt, 0.16), num(node.params.direction, 0.7), 0];
    }
    else if (node.type === 'geologyDetail') {
      packed.strength[slot] = num(node.params.strength, 0.1);
      packed.scale[slot] = num(node.params.scale, 3.2);
      packed.seed[slot] = seedDomainOffset(node.params.seed);
      packed.paramsA[slot] = [num(node.params.roughness, 0.58), num(node.params.strata, 0.24), num(node.params.strataScale, 11), num(node.params.persistence, 0.48)];
      packed.paramsB[slot] = [num(node.params.lacunarity, 2.15), 0, 0, 0];
    } else if (node.type === 'thermalErosion') {
      const params = thermalParams(node);
      packed.strength[slot] = num(node.params.strength, 0.58);
      packed.scale[slot] = params.featureScale;
      packed.seed[slot] = seedDomainOffset(node.params.seed);
      packed.paramsA[slot] = [params.talus, params.duration, params.settling, params.sedimentRemoval];
      packed.paramsB[slot] = [params.anisotropy, 0, 0, 0];
    } else if (node.type === 'naturalErosion') {
      packed.strength[slot] = num(node.params.strength, 0.38);
      packed.scale[slot] = num(node.params.channelScale, 1.4);
      packed.seed[slot] = seedDomainOffset(node.params.seed);
      packed.paramsA[slot] = [num(node.params.radius, 34), num(node.params.talus, 0.62), num(node.params.channels, 0.28), num(node.params.deposition, 0.22)];
    }
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
        const params = mountainParams(node);
        const { style, bulk, reduced, radius, sharpness, roughness, ridgeStrength, valleyDepth, foothills } = params;
        const spread = Math.max(0.15, Math.min(1.25, params.peakSpread));
        const turn = seed * 0.0137 + 0.73, dx = Math.cos(turn), dz = Math.sin(turn);
        const shiftedX = px - params.x * 2, shiftedZ = pz - params.y * 2;
        let qx = shiftedX * dx + shiftedZ * dz, qz = shiftedX * -dz + shiftedZ * dx;
        const warpA = (vnoise2(qx * 0.61 + seed * 0.17, qz * 0.61 + seed * 0.037) - 0.5) * 2;
        const warpB = (vnoise2(qx * 0.49 + seed * 0.019 + 17.3, qz * 0.49 - seed * 0.041 + 8.7) - 0.5) * 2;
        qx += warpA * radius * 0.31;
        qz += warpB * radius * 0.25;
        const irregularEdge = (vnoise2(qx * 0.72 + seed * 0.11, qz * 0.72 + seed * 0.29 + 37) - 0.5) * 0.22;
        const radial = Math.hypot(qx / (radius * 1.08), qz / (radius * 0.9)) + irregularEdge;
        const envelope = Math.pow(Math.max(1 - smoothstep(0.68, 1.24, radial), 0), Math.max(sharpness, 0.2));
        const peak = (cx, cz, sx, sz, power) => Math.exp(-Math.pow(Math.hypot((qx - cx) / (radius * sx), (qz - cz) / (radius * sz)), power));
        const peak0 = peak(-radius * 0.12 * spread, radius * 0.03 * spread, 0.7, 0.56, 1.46);
        const peak1 = 0.82 * peak(radius * 0.46 * spread, -radius * 0.26 * spread, 0.5, 0.4, 1.58);
        const peak2 = 0.7 * peak(-radius * 0.39 * spread, radius * 0.37 * spread, 0.43, 0.36, 1.64);
        const saddle = 0.48 * peak(0, -radius * 0.08, 0.92, 0.38, 1.72);
        const macro = fractal(qx * 0.83 + seed * 0.073, qz * 0.83 + seed * 0.111 + 19.7, reduced ? 2 : 3, 0.55, 2.03);
        const massif = Math.pow(Math.max(peak0, peak1, peak2, saddle), 0.82) * (0.74 + (1.27 - 0.74) * macro) * bulk.mass;
        const cellular = (cellX, cellZ) => {
          const baseX = Math.floor(cellX), baseZ = Math.floor(cellZ), localX = cellX - baseX, localZ = cellZ - baseZ;
          let cellF1 = 1e6, cellF2 = 1e6;
          for (let iy = -1; iy <= 1; iy += 1) for (let ix = -1; ix <= 1; ix += 1) {
            const latticeX = baseX + ix, latticeZ = baseZ + iy;
            const randomX = hash12(latticeX + seed * 0.071 + 11.3, latticeZ + seed * 0.037 + 29.1);
            const randomZ = hash12(latticeX - seed * 0.043 + 47.7, latticeZ + seed * 0.059 + 3.9);
            const deltaX = ix + 0.5 + (randomX - 0.5) * 0.82 - localX;
            const deltaZ = iy + 0.5 + (randomZ - 0.5) * 0.82 - localZ;
            const distance2 = deltaX * deltaX + deltaZ * deltaZ;
            if (distance2 < cellF1) { cellF2 = cellF1; cellF1 = distance2; } else if (distance2 < cellF2) cellF2 = distance2;
          }
          return [cellF1, cellF2];
        };
        const cellX = qx / Math.max(radius * 0.68, 0.001) * style.cell;
        const cellZ = qz / Math.max(radius * 0.68, 0.001) * style.cell;
        let cellCenter, cellBorder;
        if (reduced) {
          const reducedCellA = vnoise2(cellX + seed * 0.071 + 11.3, cellZ + seed * 0.037 + 29.1);
          const rotatedCellX = (0.8 * cellX + 0.6 * cellZ) * 0.83;
          const rotatedCellZ = (-0.6 * cellX + 0.8 * cellZ) * 0.83;
          const reducedCellB = vnoise2(rotatedCellX - seed * 0.043 + 47.7, rotatedCellZ + seed * 0.059 + 3.9);
          cellCenter = Math.pow(Math.max(1 - Math.abs(reducedCellA * 2 - 1), 0), 0.72);
          cellBorder = Math.pow(Math.max(1 - Math.abs(reducedCellB * 2 - 1), 0), 1.65);
        } else {
          const [cellF1, cellF2] = cellular(cellX, cellZ);
          cellCenter = Math.exp(-cellF1 * 2.35);
          cellBorder = 1 - smoothstep(0.035, 0.31, Math.sqrt(Math.max(cellF2, 0)) - Math.sqrt(Math.max(cellF1, 0)));
        }
        const structure = fractal(qx * 1.72 + seed * 0.1, qz * 1.72 + seed * 0.17 + 3.1, reduced ? 2 : 5, params.persistence, params.lacunarity);
        const fractured = Math.pow(Math.max(1 - Math.abs(structure * 2 - 1), 0), 0.78);
        const ridgeNetwork = Math.pow(Math.max(0, Math.min(1, cellCenter * 0.53 + fractured * 0.62)), 1.28);
        const drainageNetwork = Math.pow(Math.max(0, Math.min(1, cellBorder * (0.58 + 0.42 * (1 - structure)))), 2.15);
        let body = envelope * (0.1 + 0.9 * massif);
        body *= 0.54 + ridgeNetwork * ridgeStrength * 0.72 * style.ridge;
        body += ridgeNetwork * ridgeStrength * style.ridge * envelope * (0.035 + 0.13 * massif) * smoothstep(0.08, 0.94, radial);
        body -= drainageNetwork * valleyDepth * style.valley * body * smoothstep(0.12, 1.02, radial) * 0.36;
        const foothillGate = smoothstep(0.46, 0.96, radial) * (1 - smoothstep(1, 1.23, radial));
        const foothillRidges = Math.pow(Math.max(1 - Math.abs(macro * 2 - 1), 0), 1.7);
        body += envelope * foothillGate * foothills * (0.035 + foothillRidges * 0.1);
        const detail = reduced
          ? structure + (macro - structure) * 0.38
          : fractal(qx * 5.4 + seed * 0.191 + 7.1, qz * 5.4 + seed * 0.061 + 31.7, 3, params.persistence, params.lacunarity);
        const surfaceGate = envelope * smoothstep(0.04, 0.82, Math.max(body, 0));
        body += (detail - 0.5) * roughness * style.detail * (0.035 + 0.12 * fractured) * surfaceGate;
        const brokenStrata = Math.sin((body * 11 + qx * 0.22 - qz * 0.13 + (structure - 0.5) * 0.9) * Math.PI * 2);
        body += brokenStrata * roughness * style.strata * surfaceGate * smoothstep(0.3, 0.72, macro);
        return num(node.params.height, 1.25) * Math.max(body, 0);
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
        const seed = seedDomainOffset(node.params.seedOffset), freq = u.uFrequency.value;
        const pwX = x * freq + u.uSeedOffset.value.x + seed, pwZ = z * freq + u.uSeedOffset.value.y + seed * 1.7 + 3.1;
        const scale = num(node.params.scale, 1), perturbation = num(node.params.perturbation, 0.28);
        let fieldX = pwX * scale, fieldZ = pwZ * scale;
        fieldX += (vnoise2(fieldX * 0.47 + 19.1, fieldZ * 0.47 + 73.7) - 0.5) * perturbation;
        fieldZ += (vnoise2(pwX * scale * 0.47 + 91.3, pwZ * scale * 0.47 + 7.9) - 0.5) * perturbation;
        const octaves = Math.max(1, Math.min(6, Math.round(num(node.params.octaves, 4))));
        const roughness = num(node.params.roughness, 0.5);
        const wx = fractal(fieldX + 13.7, fieldZ + 41.3, octaves, roughness, 2);
        const wz = fractal(fieldX + 87.2, fieldZ + 9.1, octaves, roughness, 2);
        const warpedX = pwX + (wx - 0.5) * num(node.params.strength, 0.7);
        const warpedZ = pwZ + (wz - 0.5) * num(node.params.strength, 0.7);
        return get('source', (warpedX - u.uSeedOffset.value.x - seed) / freq, (warpedZ - u.uSeedOffset.value.y - seed * 1.7 - 3.1) / freq);
      },
      shaper: () => {
        const h = get('source'), bodyScale = Math.max(num(node.params.featureScale, 42) * 0.01, 0.05);
        const shape = Math.max(-1, Math.min(1, num(node.params.shape, 0.38)));
        const exponent = shape >= 0 ? 1 + (0.58 - 1) * shape : 1 + (1.68 - 1) * -shape;
        const shapedBody = Math.sign(h) * Math.pow(Math.max(Math.abs(h) / bodyScale, 1e-6), exponent) * bodyScale;
        const preserve = Math.max(0, Math.min(1, num(node.params.detailPreservation, 0.82)));
        const preservedDetail = shapedBody + (h + (shapedBody - h) * 0.45 - shapedBody) * preserve;
        return h + (preservedDetail - h) * Math.max(0, Math.min(1, num(node.params.strength, 0.8)));
      },
      combine: () => { const av=get('a'), bv=get('b'); return node.params.operation === 'mix' ? av + (bv-av)*num(node.params.mix,0.5) : blendJs(node.params.operation,av,bv); },
      math: () => {
        const h=get('source'), v=num(node.params.value,1); const ops={ add:()=>h+v, subtract:()=>h-v, multiply:()=>h*v, divide:()=>h/(Math.abs(v)<1e-4?1e-4:v), power:()=>Math.sign(h)*Math.pow(Math.max(Math.abs(h),1e-6),v), absolute:()=>Math.abs(h), negate:()=>-h, invert:()=>1-h, clamp:()=>Math.min(Math.max(h,Math.min(num(node.params.min),num(node.params.max,1))),Math.max(num(node.params.min),num(node.params.max,1))) }; return (ops[node.params.operation]||ops.multiply)();
      },
      remap: () => { const h=get('source'), lo=num(node.params.inMin), hi=num(node.params.inMax,1); let t=(h-lo)/Math.max(hi-lo,1e-6); if(node.params.clamp!==false)t=Math.min(1,Math.max(0,t)); return num(node.params.outMin)+(num(node.params.outMax,1)-num(node.params.outMin))*t; },
      terrace: () => { const h=get('source'), steps=Math.max(1,num(node.params.count,12)), t=h*steps, f=t-Math.floor(t), e0=.5-num(node.params.smoothness,.5)*.5,e1=.5+num(node.params.smoothness,.5)*.5,q=Math.min(1,Math.max(0,(f-e0)/Math.max(e1-e0,1e-6))),s=q*q*(3-2*q),terr=(Math.floor(t)+s)/steps; return h+(terr-h)*num(node.params.strength,1); },
      stratify: () => {
        const h = get('source'), spacing = Math.max(num(node.params.spacing, 0.11), 0.002), seed = seedDomainOffset(node.params.seed);
        const px = x * u.uFrequency.value, pz = z * u.uFrequency.value;
        const direction = num(node.params.direction, 0.7), dirX = Math.cos(direction), dirZ = Math.sin(direction);
        const octaves = Math.max(1, Math.min(6, Math.round(num(node.params.octaves, 4))));
        const broken = fractal(px * 2.35 + seed * 0.13, pz * 2.35 + seed * 0.19 + 31, octaves, 0.52, 2.07);
        const zones = vnoise2(px * 0.43 + seed * 0.031 + 71, pz * 0.43 + seed * 0.047 + 9);
        const phase = (h + (px * dirX + pz * dirZ) * num(node.params.tilt, 0.16) * 0.34 + (broken - 0.5) * spacing * 2.2) / spacing;
        let wave = Math.sin(phase * Math.PI * 2) + Math.sin(phase * Math.PI * 4 + broken * 2.7) * 0.28;
        wave = Math.max(-1, Math.min(1, wave / 1.28));
        const exponent = 1.72 + (0.42 - 1.72) * Math.max(0, Math.min(1, num(node.params.shape, 0.62)));
        const profile = Math.sign(wave) * Math.pow(Math.max(Math.abs(wave), 1e-5), exponent);
        const localZone = smoothstep(0.28, 0.72, zones) * smoothstep(0.08, 0.58, broken);
        const layered = h + profile * num(node.params.intensity, 0.42) * spacing * 0.54 * localZone * smoothstep(0.025, 0.28, Math.abs(h));
        return Math.max(layered, Math.min(h, 0));
      },
      geologyDetail: () => {
        const h = get('source');
        const scale = num(node.params.scale, 3.2), seed = seedDomainOffset(node.params.seed);
        const rock = fractal(x * u.uFrequency.value * scale + seed, z * u.uFrequency.value * scale + seed * 1.7 + 3.1, node.params.octaves, node.params.persistence, node.params.lacunarity);
        const ridge = 1 - Math.abs(rock * 2 - 1);
        const strata = Math.sin((h * num(node.params.strataScale, 11) + (rock - 0.5) * 0.65) * Math.PI * 2);
        const structure = (rock - 0.5) + ((ridge - 0.5) - (rock - 0.5)) * num(node.params.roughness, 0.58)
          + strata * 0.18 * num(node.params.strata, 0.24);
        return h + structure * num(node.params.strength, 0.1) * smoothstep(0.04, 0.38, Math.abs(h));
      },
      thermalErosion: () => {
        const h = get('source');
        const params = thermalParams(node), radius = params.featureScale, seed = seedDomainOffset(node.params.seed);
        const turn = seed * 0.017 + 0.31;
        const talus = params.talus;
        const strength = num(node.params.strength, 0.58), passGain = 1 - Math.exp(-params.duration * 0.22);
        const directionX = Math.cos(turn), directionZ = Math.sin(turn);
        const sideX = -directionZ, sideZ = directionX;
        const sedimentScale = Math.max(140 / radius, 0.35);
        const terrainX = x * u.uFrequency.value * sedimentScale + seed;
        const terrainZ = z * u.uFrequency.value * sedimentScale + seed * 1.7 + 3.1;
        const talusX = terrainX * directionX + terrainZ * directionZ;
        const talusZ = (terrainX * sideX + terrainZ * sideZ) * (1 + (0.42 - 1) * params.anisotropy);
        const directionalTalus = 1 - Math.abs(vnoise2(talusX, talusZ) * 2 - 1);
        const screeField = vnoise2(talusX * 0.43 + 71, talusZ * 0.43 + 19);
        const reliefProxy = Math.max(h, 0) * (0.08 + directionalTalus * 0.16 + Math.abs(screeField - 0.5) * 0.08);
        const active = smoothstep(talus * 0.42, talus * 2.6, reliefProxy);
        const released = Math.max(reliefProxy - talus * 0.42, 0) * (0.22 + (0.36 - 0.22) * params.sedimentRemoval);
        const midSlope = smoothstep(talus * 0.5, talus * 6, Math.max(h, 0)) * (1 - smoothstep(0.52, 1.05, Math.max(h, 0)));
        const screeDeposit = (1 - directionalTalus) * midSlope * params.settling * (1 - params.sedimentRemoval) * 0.018;
        const creep = Math.max(h, 0) * active * (0.012 + (0.006 - 0.012) * params.sedimentRemoval);
        const relaxed = h - (released + creep) * strength * passGain + screeDeposit * strength * passGain;
        const sedimentTexture = (screeField - 0.5) * (1 - params.sedimentRemoval) * 0.012 * strength * active;
        return Math.max(relaxed + sedimentTexture, Math.min(h, 0));
      },
      naturalErosion: () => {
        const h = get('source');
        const amount = num(node.params.strength, 0.38);
        const featureScale = Math.max(num(node.params.radius, 34) / 34, 0.2);
        const scale = num(node.params.channelScale, 1.4), seed = seedDomainOffset(node.params.seed);
        const px = x * u.uFrequency.value * scale / featureScale + seed;
        const pz = z * u.uFrequency.value * scale / featureScale + seed * 1.7 + 3.1;
        const primary = 1 - Math.abs(vnoise2(px, pz) * 2 - 1);
        const tributary = 1 - Math.abs(vnoise2(px * 0.47 + 37.1, pz * 0.47 + 91.7) * 2 - 1);
        const drainage = Math.pow(Math.max(0, Math.min(1, primary * 0.72 + tributary * 0.28)), 5);
        const valley = 1 - smoothstep(0.18, 0.82, Math.max(0, Math.min(1, h)));
        const talus = num(node.params.talus, 0.62);
        const exposed = smoothstep(talus * 0.035, talus * 0.18 + 0.08, Math.max(h, 0));
        const weathering = amount * exposed * (0.0025 + drainage * 0.006);
        const channelCut = drainage * num(node.params.channels, 0.28) * amount * valley * 0.055;
        const sediment = vnoise2(px * 0.29 + 113, pz * 0.29 + 17);
        const deposit = smoothstep(0.48, 0.82, sediment) * (1 - drainage) * valley * num(node.params.deposition, 0.22) * amount * 0.018;
        return h - weathering - channelCut + deposit;
      },
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
  const colorSlotById = new Map(); let colorSlot = 0;
  const slotOrder = [
    ...ordered.filter((id) => nodes.get(id)?.type === 'currentTerrain'),
    ...ordered.filter((id) => nodes.get(id)?.type !== 'currentTerrain'),
  ];
  for (const id of slotOrder) {
    const node = nodes.get(id); const count = getGraphNodeDefinition(node.type)?.uniformSlots?.(node) || 0;
    if (count) { slotById.set(id, slot); slot += count; }
    const colorCount = getGraphNodeDefinition(node.type)?.colorUniformSlots?.(node) || 0;
    if (colorCount) { colorSlotById.set(id, colorSlot); colorSlot += colorCount; }
  }
  const output = findOutputNode(graph);
  const sig = structuralSignature(graph, ordered, slotById, colorSlotById);
  let shaderSource = shaderSourceCache.get(sig);
  if (!shaderSource) {
    const functions = ordered.filter((id) => {
      if (!reachable.has(id)) return false;
      const node = nodes.get(id); const definition = getGraphNodeDefinition(node?.type);
      return node?.type === 'terrainOutput' || definition?.outputs?.some((port) => port.type === 'analytic-height');
    }).map((id) => nodeFunction(graph, nodes.get(id), slotById.get(id))).join('\n\n');
    shaderSource = cacheShaderSource(sig, {
      body2d: `${GRAPH_FUNCTIONS_MARKER}\n${functions}\n${GRAPH_BODY_MARKER}\n  h = ${safe(output.id)}(xz, c);`,
      body3d: '',
      colorBody: graphColorSource(graph, ordered, colorSlotById),
    });
  }
  const program = {
    kind: 'graph', sig,
    body2d: shaderSource.body2d,
    body3d: shaderSource.body3d,
    colorBody: shaderSource.colorBody,
    packUniforms: () => packUniforms(graph, ordered, slotById, colorSlotById),
    evaluate2D: cpuEvaluator(graph),
    graph: structuredClone(graph), diagnostics: [], slotCount: slot, colorSlotCount: colorSlot,
  };
  return { ok: true, diagnostics: [], program };
}
