import { blendGlslStmt, blendJs } from '../noise/blendModes.js';
import { activeLayers, migrateStack } from '../noise/NoiseStack.js';
import { evalStack2D, generateStackGLSL, packStackUniforms } from '../noise/noiseStackCodegen.js';
import { fbm2, vnoise2 } from '../noise/cpuNoise.js';
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
      const oct = Math.max(1, Math.min(8, Math.round(num(node.params.octaves, 5))));
      const macroOct = Math.max(2, Math.min(4, oct));
      const detailOct = Math.max(2, oct - 2);
      const formation = node.params.formation || 'alpine';
      const formationTuning = {
        alpine: { ridge: 1, valley: 1, detail: 1, strata: 0 },
        strata: { ridge: 0.82, valley: 0.86, detail: 0.78, strata: 0.045 },
        weathered: { ridge: 0.58, valley: 0.68, detail: 0.52, strata: 0.018 },
      }[formation] || { ridge: 1, valley: 1, detail: 1, strata: 0 };
      return `float ${fn}(vec2 xz, Climate c) {
  float height=uLayerStrength[${slot}], scale=uLayerScale[${slot}], seed=uLayerSeed[${slot}];
  vec4 pa=uLayerParamsA[${slot}], pb=uLayerParamsB[${slot}], pc=uLayerMaskA[${slot}];
  vec2 p=xz*uFrequency*scale;
  float radius=max(pa.x,0.001), turn=seed*0.0137+0.73;
  vec2 dir=vec2(cos(turn),sin(turn)), side=vec2(-dir.y,dir.x);
  vec2 q=vec2(dot(p,dir),dot(p,side));
  float warpA=(vnoise(q*0.58+vec2(seed,seed*0.37))-0.5)*2.0;
  float warpB=(vnoise(q*0.47+vec2(seed*0.19+17.3,-seed*0.41+8.7))-0.5)*2.0;
  q+=vec2(warpA*radius*0.34,warpB*radius*0.27)*clamp(pa.w,0.0,1.0);
  float radial=length(vec2(q.x/(radius*1.04),q.y/(radius*0.92)));
  float envelope=pow(max(1.0-smoothstep(0.72,1.18,radial),0.0),max(pa.y*0.56,0.28));
  float spread=clamp(pc.y,0.15,1.25);
  vec2 d0=vec2((q.x+radius*0.10*spread)/(radius*0.68),(q.y-radius*0.04*spread)/(radius*0.58));
  vec2 d1=vec2((q.x-radius*0.43*spread)/(radius*0.48),(q.y+radius*0.23*spread)/(radius*0.39));
  vec2 d2=vec2((q.x+radius*0.36*spread)/(radius*0.42),(q.y-radius*0.34*spread)/(radius*0.35));
  float peak0=exp(-pow(length(d0),1.62));
  float peak1=0.78*exp(-pow(length(d1),1.72));
  float peak2=0.64*exp(-pow(length(d2),1.78));
  ${glslFbm('macro', 'q*0.78+vec2(seed*0.73,seed*1.11+19.7)', macroOct, '0.55', '2.03')}
  float massif=pow(max(peak0,max(peak1,peak2)),0.88)*mix(0.78,1.22,macro);
  ${glslFbm('structure', 'q*1.38+vec2(seed,seed*1.7+3.1)', oct, 'pb.x', 'pb.y')}
  float fractured=pow(max(1.0-abs(structure*2.0-1.0),0.0),0.82);
  float theta=atan(q.y,q.x);
  float branchWarp=(vnoise(q*0.92+vec2(seed*1.23,-seed*0.31))-0.5)*3.2;
  float branchPhase=theta*4.0+radial*3.35+branchWarp;
  float branches=pow(max(1.0-abs(sin(branchPhase)),0.0),2.7);
  float channels=pow(max(1.0-abs(sin(branchPhase+1.5707963)),0.0),5.0);
  float body=envelope*(0.07+0.93*massif);
  body*=0.62+fractured*pb.z*0.68*${glsl(formationTuning.ridge)};
  body+=branches*pb.z*${glsl(formationTuning.ridge)}*envelope*(0.055+0.16*massif)*smoothstep(0.08,0.92,radial);
  body-=channels*pb.w*${glsl(formationTuning.valley)}*body*smoothstep(0.15,0.98,radial)*0.32;
  float foothillGate=smoothstep(0.38,0.96,radial)*(1.0-smoothstep(0.98,1.18,radial));
  body+=envelope*foothillGate*pc.x*(0.05+macro*0.09);
  ${glslFbm('detail', 'q*5.2+vec2(seed*1.91+7.1,seed*0.61+31.7)', detailOct, 'pb.x', 'pb.y')}
  float surfaceGate=envelope*smoothstep(0.04,0.82,max(body,0.0));
  body+=(detail-0.5)*pa.z*${glsl(formationTuning.detail)}*(0.04+0.13*fractured)*surfaceGate;
  body+=sin((body*13.0+(structure-0.5)*0.7)*6.2831853)*pa.z*${glsl(formationTuning.strata)}*surfaceGate;
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
  float turn=seed*0.017+0.31;
  vec2 axis=vec2(cos(turn),sin(turn))*radius, side=vec2(-axis.y,axis.x);
  float h0=${source}(xz-axis,c), h1=${source}(xz+axis,c);
  float h2=${source}(xz-side,c), h3=${source}(xz+side,c);
  float avg=(h0+h1+h2+h3)*0.25;
  float talus=max(pa.x,0.0001);
  float drop0=max(h-h0-talus,0.0), drop1=max(h-h1-talus,0.0);
  float drop2=max(h-h2-talus,0.0), drop3=max(h-h3-talus,0.0);
  float rise0=max(h0-h-talus,0.0), rise1=max(h1-h-talus,0.0);
  float rise2=max(h2-h-talus,0.0), rise3=max(h3-h-talus,0.0);
  float outgoing=max(max(drop0,drop1),max(drop2,drop3));
  float incoming=(rise0+rise1+rise2+rise3)*0.25;
  float relief=max(max(abs(h-h0),abs(h-h1)),max(abs(h-h2),abs(h-h3)));
  float activity=smoothstep(talus*0.65,talus*2.8,relief);
  float passGain=1.0-exp(-max(pa.y,1.0)*0.22);
  float creep=(avg-h)*activity*0.18;
  float relaxed=h-outgoing*0.34*strength*passGain+incoming*pa.z*0.24*strength*passGain+creep*strength*passGain;
  vec2 sp=xz*uFrequency*max(pb.x,0.1)+vec2(seed,seed*1.7+3.1);
  float scree=(vnoise(sp)-0.5)*pa.w*0.045*strength*activity;
  return max(relaxed+scree,min(h,0.0));
}`;
    },
    naturalErosion: () => {
      return `float ${fn}(vec2 xz, Climate c) {
  float amount=uLayerStrength[${slot}], seed=uLayerSeed[${slot}];
  vec4 pa=uLayerParamsA[${slot}];
  float e=max(pa.x,1.0);
  float h=${source}(xz,c);
  float hx0=${source}(xz+vec2(-e,0.0),c), hx1=${source}(xz+vec2(e,0.0),c);
  float hz0=${source}(xz+vec2(0.0,-e),c), hz1=${source}(xz+vec2(0.0,e),c);
  float avg=(hx0+hx1+hz0+hz1)*0.25;
  float relief=max(max(abs(h-hx0),abs(h-hx1)),max(abs(h-hz0),abs(h-hz1)));
  float unstable=smoothstep(0.015,0.22,max(relief-pa.y*0.12,0.0));
  float weathered=mix(h,avg,amount*(0.14+0.42*unstable));
  vec2 p=(xz*uFrequency*uLayerScale[${slot}])+vec2(seed,seed*1.7+3.1);
  float drainage=1.0-abs(vnoise(p)*2.0-1.0);
  drainage=pow(clamp(drainage,0.0,1.0),5.0)*pa.z*amount;
  float valley=1.0-smoothstep(0.18,0.82,clamp(h,0.0,1.0));
  float deposit=max(avg-h,0.0)*pa.w*amount;
  return weathered-drainage*valley*0.055+deposit;
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
    const params = (definition.structuralParams || []).map((key) => key === 'stack'
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
        packed.strength[slot] = num(node.params.height, 1.15);
        packed.paramsA[slot] = [num(node.params.radius, 1.25), num(node.params.sharpness, 1.45), num(node.params.roughness, 0.55), num(node.params.asymmetry, 0.72)];
        packed.paramsB[slot] = [num(node.params.persistence, 0.5), num(node.params.lacunarity, 2), num(node.params.ridgeStrength, 0.88), num(node.params.valleyDepth, 0.62)];
        packed.maskA[slot] = [num(node.params.foothills, 0.48), num(node.params.peakSpread, 0.62), 0, 0];
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
    else if (node.type === 'geologyDetail') {
      packed.strength[slot] = num(node.params.strength, 0.1);
      packed.scale[slot] = num(node.params.scale, 3.2);
      packed.seed[slot] = seedDomainOffset(node.params.seed);
      packed.paramsA[slot] = [num(node.params.roughness, 0.58), num(node.params.strata, 0.24), num(node.params.strataScale, 11), num(node.params.persistence, 0.48)];
      packed.paramsB[slot] = [num(node.params.lacunarity, 2.15), 0, 0, 0];
    } else if (node.type === 'thermalErosion') {
      packed.strength[slot] = num(node.params.strength, 0.58);
      packed.scale[slot] = num(node.params.radius, 30);
      packed.seed[slot] = seedDomainOffset(node.params.seed);
      packed.paramsA[slot] = [num(node.params.talus, 0.07), num(node.params.iterations, 7), num(node.params.deposition, 0.72), num(node.params.scree, 0.2)];
      packed.paramsB[slot] = [num(node.params.screeScale, 4.8), 0, 0, 0];
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
        const radius = Math.max(num(node.params.radius, 1.25), 0.001);
        const sharpness = Math.max(num(node.params.sharpness, 1.65), 0.01);
        const roughness = num(node.params.roughness, 0.55);
        const asymmetry = Math.max(0, Math.min(1, num(node.params.asymmetry, 0.72)));
        const ridgeStrength = num(node.params.ridgeStrength, 0.98);
        const valleyDepth = num(node.params.valleyDepth, 0.72);
        const foothills = num(node.params.foothills, 0.32);
        const spread = Math.max(0.15, Math.min(1.25, num(node.params.peakSpread, 0.78)));
        const formation = node.params.formation || 'alpine';
        const tuning = {
          alpine: { ridge: 1, valley: 1, detail: 1, strata: 0 },
          strata: { ridge: 0.82, valley: 0.86, detail: 0.78, strata: 0.045 },
          weathered: { ridge: 0.58, valley: 0.68, detail: 0.52, strata: 0.018 },
        }[formation] || { ridge: 1, valley: 1, detail: 1, strata: 0 };
        const turn = seed * 0.0137 + 0.73, dx = Math.cos(turn), dz = Math.sin(turn);
        let qx = px * dx + pz * dz, qz = px * -dz + pz * dx;
        const warpA = (vnoise2(qx * 0.58 + seed, qz * 0.58 + seed * 0.37) - 0.5) * 2;
        const warpB = (vnoise2(qx * 0.47 + seed * 0.19 + 17.3, qz * 0.47 - seed * 0.41 + 8.7) - 0.5) * 2;
        qx += warpA * radius * 0.34 * asymmetry;
        qz += warpB * radius * 0.27 * asymmetry;
        const radial = Math.hypot(qx / (radius * 1.04), qz / (radius * 0.92));
        const envelope = Math.pow(Math.max(1 - smoothstep(0.72, 1.18, radial), 0), Math.max(sharpness * 0.56, 0.28));
        const peak = (cx, cz, sx, sz, power) => Math.exp(-Math.pow(Math.hypot((qx - cx) / (radius * sx), (qz - cz) / (radius * sz)), power));
        const peak0 = peak(-radius * 0.1 * spread, radius * 0.04 * spread, 0.68, 0.58, 1.62);
        const peak1 = 0.78 * peak(radius * 0.43 * spread, -radius * 0.23 * spread, 0.48, 0.39, 1.72);
        const peak2 = 0.64 * peak(-radius * 0.36 * spread, radius * 0.34 * spread, 0.42, 0.35, 1.78);
        const macro = fractal(qx * 0.78 + seed * 0.73, qz * 0.78 + seed * 1.11 + 19.7, Math.max(2, Math.min(4, num(node.params.octaves, 5))), 0.55, 2.03);
        const massif = Math.pow(Math.max(peak0, peak1, peak2), 0.88) * (0.78 + (1.22 - 0.78) * macro);
        const structure = fractal(qx * 1.38 + seed, qz * 1.38 + seed * 1.7 + 3.1);
        const fractured = Math.pow(Math.max(1 - Math.abs(structure * 2 - 1), 0), 0.82);
        const theta = Math.atan2(qz, qx);
        const branchWarp = (vnoise2(qx * 0.92 + seed * 1.23, qz * 0.92 - seed * 0.31) - 0.5) * 3.2;
        const branchPhase = theta * 4 + radial * 3.35 + branchWarp;
        const branches = Math.pow(Math.max(1 - Math.abs(Math.sin(branchPhase)), 0), 2.7);
        const channels = Math.pow(Math.max(1 - Math.abs(Math.sin(branchPhase + Math.PI / 2)), 0), 5);
        let body = envelope * (0.07 + 0.93 * massif);
        body *= 0.62 + fractured * ridgeStrength * 0.68 * tuning.ridge;
        body += branches * ridgeStrength * tuning.ridge * envelope * (0.055 + 0.16 * massif) * smoothstep(0.08, 0.92, radial);
        body -= channels * valleyDepth * tuning.valley * body * smoothstep(0.15, 0.98, radial) * 0.32;
        const foothillGate = smoothstep(0.38, 0.96, radial) * (1 - smoothstep(0.98, 1.18, radial));
        body += envelope * foothillGate * foothills * (0.05 + macro * 0.09);
        const detail = fractal(qx * 5.2 + seed * 1.91 + 7.1, qz * 5.2 + seed * 0.61 + 31.7, Math.max(2, num(node.params.octaves, 5) - 2));
        const surfaceGate = envelope * smoothstep(0.04, 0.82, Math.max(body, 0));
        body += (detail - 0.5) * roughness * tuning.detail * (0.04 + 0.13 * fractured) * surfaceGate;
        body += Math.sin((body * 13 + (structure - 0.5) * 0.7) * Math.PI * 2) * roughness * tuning.strata * surfaceGate;
        return num(node.params.height, 1.15) * Math.max(body, 0);
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
        const radius = Math.max(num(node.params.radius, 30), 1), seed = seedDomainOffset(node.params.seed);
        const turn = seed * 0.017 + 0.31, dx = Math.cos(turn) * radius, dz = Math.sin(turn) * radius;
        const h0 = get('source', x - dx, z - dz), h1 = get('source', x + dx, z + dz);
        const h2 = get('source', x + dz, z - dx), h3 = get('source', x - dz, z + dx);
        const avg = (h0 + h1 + h2 + h3) * 0.25;
        const talus = Math.max(num(node.params.talus, 0.07), 0.0001);
        const drops = [h - h0, h - h1, h - h2, h - h3].map((value) => Math.max(value - talus, 0));
        const rises = [h0 - h, h1 - h, h2 - h, h3 - h].map((value) => Math.max(value - talus, 0));
        const outgoing = Math.max(...drops), incoming = rises.reduce((sum, value) => sum + value, 0) * 0.25;
        const relief = Math.max(Math.abs(h - h0), Math.abs(h - h1), Math.abs(h - h2), Math.abs(h - h3));
        const active = smoothstep(talus * 0.65, talus * 2.8, relief);
        const strength = num(node.params.strength, 0.58), passGain = 1 - Math.exp(-Math.max(num(node.params.iterations, 7), 1) * 0.22);
        const creep = (avg - h) * active * 0.18;
        const relaxed = h - outgoing * 0.34 * strength * passGain
          + incoming * num(node.params.deposition, 0.72) * 0.24 * strength * passGain
          + creep * strength * passGain;
        const scree = (vnoise2(x * u.uFrequency.value * num(node.params.screeScale, 4.8) + seed, z * u.uFrequency.value * num(node.params.screeScale, 4.8) + seed * 1.7 + 3.1) - 0.5)
          * num(node.params.scree, 0.2) * 0.045 * strength * active;
        return Math.max(relaxed + scree, Math.min(h, 0));
      },
      naturalErosion: () => {
        const e = Math.max(num(node.params.radius, 34), 1);
        const h = get('source'), hx0 = get('source', x - e, z), hx1 = get('source', x + e, z), hz0 = get('source', x, z - e), hz1 = get('source', x, z + e);
        const avg = (hx0 + hx1 + hz0 + hz1) * 0.25;
        const relief = Math.max(Math.abs(h - hx0), Math.abs(h - hx1), Math.abs(h - hz0), Math.abs(h - hz1));
        const amount = num(node.params.strength, 0.38);
        const unstable = smoothstep(0.015, 0.22, Math.max(relief - num(node.params.talus, 0.62) * 0.12, 0));
        const weathered = h + (avg - h) * amount * (0.14 + 0.42 * unstable);
        const scale = num(node.params.channelScale, 1.4), seed = seedDomainOffset(node.params.seed);
        let drainage = 1 - Math.abs(vnoise2(x * u.uFrequency.value * scale + seed, z * u.uFrequency.value * scale + seed * 1.7 + 3.1) * 2 - 1);
        drainage = Math.pow(Math.max(0, Math.min(1, drainage)), 5) * num(node.params.channels, 0.28) * amount;
        const valley = 1 - smoothstep(0.18, 0.82, Math.max(0, Math.min(1, h)));
        const deposit = Math.max(avg - h, 0) * num(node.params.deposition, 0.22) * amount;
        return weathered - drainage * valley * 0.055 + deposit;
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
