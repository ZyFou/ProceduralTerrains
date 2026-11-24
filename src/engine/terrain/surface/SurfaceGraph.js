import { SURFACE_ASSETS, SURFACE_RECIPES } from './SurfaceCatalog.js';
import { createSurfaceDocument, resolveSurfaceReference } from './SurfaceDocument.js';
import { CANYON_MATERIAL_FUNCTIONS } from '../dryCanyon.js';
const port=(id,type,required=false)=>({id,label:id[0].toUpperCase()+id.slice(1),type,required});
const number=(key,label,value,min=0,max=1)=>({key,label,type:'number',default:value,min,max,step:0.01});
const material={key:'material',label:'Material',type:'enum',structural:true,default:'polyhaven:rock_boulder_dry',options:[...SURFACE_ASSETS,...SURFACE_RECIPES].map(a=>({value:a.id,label:a.name}))};
const def=(id,label,inputs,outputs,inspector=[])=>({id,label,category:'Textures & Materials',color:'cyan',workspaceModes:['terrain'],executionKind:'surface',inputs,outputs,inspector,defaults:Object.fromEntries(inspector.map(f=>[f.key,f.default])),structuralParams:inspector.filter(f=>f.structural).map(f=>f.key),uniformSlots:()=>0});
const maskThresholds=[number('low','Start',0.3),number('high','End',0.7)];
export const SURFACE_NODE_DEFINITIONS=[
  { ...def('erosionMaps','Erosion Maps',[],['flow','erosion','deposition'].map(id=>port(id,'mask'))),
    description: 'Reads the Tile erosion bake. Flow follows water paths, Erosion measures removed rock, and Deposition measures settled sediment. Connect any output to a blend mask.' },
  def('rockExposure','Rock Exposure',[port('erosion','mask')],[port('mask','mask')],[
    number('amount','Exposure strength',1,0,2),
    {...number('relief','Reference relief (m)',250,10,1000),step:1},
  ]),
  def('washCoverage','Wash Coverage',[port('flow','mask'),port('deposition','mask')],[port('mask','mask')],[number('amount','Wash coverage',1,0,2)]),
  def('canyonMaterial','Canyon Material',[port('wash','mask')],[port('surface','surface')],[
    {key:'layer',label:'Ground type',type:'enum',structural:true,default:'soil',options:[
      {value:'soil',label:'Scrub soil'},{value:'rock',label:'Bedded rock'},{value:'gravel',label:'Wash gravel'}]},
    number('brightness','Brightness',1,0,2),number('roughness','Roughness',0.85),
  ]),
  def('pbrMaterial','PBR Material',[port('mapping','mapping')],[port('surface','surface')],[material,number('scale','Scale',1,0.01,100),number('normal','Normal strength',1,0,2)]),
  def('imageTexture','Image Texture',[port('mapping','mapping')],[port('color','color-texture'),port('scalar','scalar-texture'),port('normal','normal-texture')],[{...material,type:'text',label:'Asset ID (built-in or user import)'},{key:'channel',label:'Map',type:'enum',structural:true,default:'albedo',options:['albedo','height','roughness','ao','normal'].map(value=>({value,label:value}))}]),
  def('pbrAssemble','PBR Assemble',[port('albedo','color-texture'),port('normal','normal-texture'),port('roughness','scalar-texture'),port('ao','scalar-texture'),port('height','scalar-texture')],[port('surface','surface')],[number('roughness','Default roughness',0.8)]),
  ...['mapping','triplanar'].map(id=>def(id,id==='mapping'?'Mapping':'Triplanar',[],[port('mapping','mapping')],[number('scale','Scale',1,0.01,100),number('rotation','Rotation',0,-180,180),number('offsetX','Offset X',0,-10000,10000),number('offsetY','Offset Z',0,-10000,10000)])),
  ...['slope','height','moisture','biome','noise'].map(kind=>def(`${kind}Mask`,`${kind[0].toUpperCase()+kind.slice(1)} Mask`,[],[port('mask','mask')],[...maskThresholds,number('scale','Noise scale',0.01,0.001,1),{key:'biome',label:'Biome',type:'enum',structural:true,default:'desert',options:['desert','canyon','wetland'].map(value=>({value,label:value}))}])),
  def('paintMask','Paint Mask',[],[port('mask','mask')],[{key:'layerId',label:'Named paint layer ID',type:'text',default:''},number('layer','Fallback layer slot',0,0,31)]),
  def('maskRemap','Remap',[port('mask','mask',true)],[port('mask','mask')],maskThresholds),
  def('maskInvert','Invert',[port('mask','mask',true)],[port('mask','mask')]),
  def('maskBlend','Mask Blend',[port('a','mask',true),port('b','mask',true)],[port('mask','mask')],[number('amount','Amount',0.5)]),
  ...['materialBlend','heightBlend'].map(id=>def(id,id==='heightBlend'?'Height Blend':'Material Blend',[port('a','surface',true),port('b','surface',true),port('mask','mask')],[port('surface','surface')],[number('amount','Amount',0.5),number('contrast','Height contrast',0.2,0.01,1)])),
  def('wetness','Wetness',[port('surface','surface',true),port('mask','mask')],[port('surface','surface')],[number('amount','Wetness',0.4)]),
  def('surfaceAdjust','Surface Adjust',[port('surface','surface',true)],[port('surface','surface')],[number('brightness','Brightness',1,0,2),number('roughness','Roughness multiplier',1,0,2),number('normal','Normal strength',1,0,2)]),
  def('surfacePreview','Surface Preview',[port('surface','surface',true)],[port('surface','surface')]),
];
export function compileSurfaceGraph(graph,documentInput,slots={}) {
  const edge=graph?.edges?.find(e=>e.target==='terrain-output'&&e.targetHandle==='surface');
  if(!edge)return null;
  const document=createSurfaceDocument(documentInput),byId=new Map(graph.nodes.map(n=>[n.id,n])),ordered=[],visiting=new Set(),seen=new Set();
  function visit(id){if(visiting.has(id))throw new Error(`Surface graph cycle at ${id}`);if(seen.has(id))return;const n=byId.get(id);if(!n)throw new Error(`Unknown surface node ${id}`);visiting.add(id);for(const e of graph.edges.filter(e=>e.target===id))visit(e.source);visiting.delete(id);seen.add(id);ordered.push(n);}
  visit(edge.source);if(ordered.length>64)throw new Error('Surface graph exceeds 64 active nodes');
  const refs=[],values=[],lines=[],names=new Map(ordered.map((n,i)=>[n.id,`sg${i}`]));
  const suffix={color:'C',scalar:'D',normal:'N',flow:'.a',erosion:'.g',deposition:'.b'};
  const input=(node,port,fallback)=>{const e=graph.edges.find(e=>e.target===node.id&&e.targetHandle===port);return e?names.get(e.source)+(suffix[e.sourceHandle]||''):fallback;};
  const usesErosion = ordered.some(node => node.type === 'erosionMaps');
  const canyonMaterials = ordered.some(node => ['rockExposure','washCoverage','canyonMaterial'].includes(node.type));
  for(const [i,n] of ordered.entries()) {
    const name=names.get(n.id),p=n.params||{},u=`uSurfaceGraphParams[${i*2}]`,v=`uSurfaceGraphParams[${i*2+1}]`;
    let a=[p.low??p.amount??p.scale??p.brightness??0,p.high??p.roughness??1,p.scale??p.normal??1,p.contrast??0.2],b=[0,0,0,0];
    const surface=(body)=>lines.push(`SurfMaterialSample ${name};${body}`);
    if (n.type === 'erosionMaps') {
      lines.push(`#ifdef TERRAIN_HAS_EROSION_FIELD\nvec4 ${name} = erosionSampleAt(wpos.xz);\n#else\nvec4 ${name} = vec4(0.0);\n#endif`);
    } else if (n.type === 'rockExposure') {
      a[1] = p.relief ?? 250;
      lines.push(`float ${name} = clamp(${u}.x * canyonRockExposure(wpos.y/max(${u}.y,1.0),slope,${input(n,'erosion','0.0')},canyonGrain(wpos.xz+uSeedOffset,wpos.y).y),0.0,1.0);`);
    } else if (n.type === 'washCoverage') {
      lines.push(`float ${name} = clamp(${u}.x * canyonWashCoverage(slope,${input(n,'flow','0.0')},${input(n,'deposition','0.0')}),0.0,1.0);`);
    } else if (n.type === 'canyonMaterial') {
      const point = 'wpos.xz+uSeedOffset';
      const grain = `canyonGrain(${point},wpos.y)`;
      const color = p.layer === 'rock' ? `canyonBeddedRock(${point},wpos.y,${grain})`
        : p.layer === 'gravel' ? `canyonWashGravel(${grain})`
        : `canyonScrubSoil(${point},slope,${input(n,'wash','0.0')},${grain})`;
      surface(`${name}=SurfMaterialSample(${color}*${u}.x,nGeo,1.0,${u}.y,0.0,0.5);`);
    } else if(n.type==='pbrMaterial'||n.type==='imageTexture') {
      if(p.material?.startsWith('user:')&&!document.assets[p.material])document.assets={...document.assets,[p.material]:{id:p.material,provider:'user'}};
      const items=resolveSurfaceReference(p.material||material.default,document);refs.push(...items.map(item=>item.assetId));
      const first=items[0],index=slots[first.assetId]??refs.indexOf(first.assetId);
      a=[index,p.scale??1,p.normal??1,first.wetness||0];b=[...first.tint,0];
      const mapping=input(n,'mapping','vec4(1.0,0.0,0.0,0.0)');
      surface(`${name}=pbrAsset(int(${u}.x),pbrMapped(wpos,${mapping}),triBlend,nGeo,${u}.y*${mapping}.x);${name}.albedo*=${v}.rgb;${name}.rough*=1.0-${u}.w;${name}.normal=normalize(nGeo+(${name}.normal-nGeo)*${u}.z);`);
      if(items[1]) {const second=items[1];const index2=slots[second.assetId]??refs.indexOf(second.assetId);b[3]=index2;lines.push(`${name}=surfMixSamples(${name},pbrAsset(int(${v}.w),wpos,triBlend,nGeo,${u}.y),smoothstep(0.3,0.7,vnoise(wpos.xz*0.05)));`);}
      if(n.type==='imageTexture')lines.push(`vec3 ${name}C=${name}.albedo;float ${name}D=${p.channel==='height'?`${name}.height`:p.channel==='ao'?`${name}.ao`:`${name}.rough`};vec3 ${name}N=${name}.normal;`);
    } else if(n.type==='mapping'||n.type==='triplanar') {a=[p.scale??1,(p.rotation||0)*Math.PI/180,p.offsetX||0,p.offsetY||0];lines.push(`vec4 ${name}=${u};`);}
    else if(n.type==='pbrAssemble')surface(`${name}.albedo=${input(n,'albedo','vec3(0.5)')};${name}.normal=${input(n,'normal','nGeo')};${name}.rough=${input(n,'roughness',`${u}.y`)};${name}.ao=${input(n,'ao','1.0')};${name}.height=${input(n,'height','0.5')};${name}.missing=0.0;`);
    else if(['slopeMask','heightMask','moistureMask','biomeMask','noiseMask'].includes(n.type)) {
      const expression={slopeMask:'slope',heightMask:'h01',moistureMask:'cl.moist',biomeMask:`bw.${['desert','canyon','wetland'].includes(p.biome)?p.biome:'desert'}`,noiseMask:`vnoise(wpos.xz*${u}.z)`}[n.type];
      lines.push(`float ${name}=smoothstep(${u}.x,max(${u}.x+0.0001,${u}.y),${expression});`);
    }else if(n.type==='paintMask'){a[0]=document.layers?.find(l=>l.id===p.layerId||l.name===p.layerId)?.slot??p.layer??0;lines.push(`float ${name}=pbrPaintWeight(wpos.xz,int(${u}.x));`);}
    else if(n.type==='maskRemap')lines.push(`float ${name}=smoothstep(${u}.x,max(${u}.y,${u}.x+0.0001),${input(n,'mask','0.0')});`);
    else if(n.type==='maskInvert')lines.push(`float ${name}=1.0-${input(n,'mask','0.0')};`);
    else if(n.type==='maskBlend')lines.push(`float ${name}=mix(${input(n,'a','0.0')},${input(n,'b','0.0')},${u}.x);`);
    else if(n.type==='materialBlend'||n.type==='heightBlend') {
      const left=input(n,'a'),right=input(n,'b');if(!left||!right)throw new Error(`${n.id}: both surfaces are required`);
      const weight=input(n,'mask',`${u}.x`);
      surface(`${name}=${n.type==='heightBlend'?'pbrHeightMix':'surfMixSamples'}(${left},${right},clamp(${weight},0.0,1.0)${n.type==='heightBlend'?`,${u}.w`:''});`);
    } else if(['wetness','surfaceAdjust','surfacePreview'].includes(n.type)) {
      const source=input(n,'surface');if(!source)throw new Error(`${n.id}: surface input required`);
      surface(`${name}=${source};`);
      if(n.type==='wetness')lines.push(`${name}.albedo*=1.0-clamp(${input(n,'mask','1.0')}*${u}.x,0.0,1.0)*0.35;${name}.rough=max(0.08,${name}.rough*(1.0-clamp(${input(n,'mask','1.0')}*${u}.x,0.0,1.0)));`);
      if(n.type==='surfaceAdjust')lines.push(`${name}.albedo*=${u}.x;${name}.rough=clamp(${name}.rough*${u}.y,0.0,1.0);${name}.normal=normalize(nGeo+(${name}.normal-nGeo)*${u}.z);`);
    } else throw new Error(`${n.id}: incompatible surface node ${n.type}`);
    values.push(a,b);
  }
  const assets=[...new Set(refs)];if(assets.length>32)throw new Error('Surface graph exceeds 32 source assets');
  const body=`${canyonMaterials ? CANYON_MATERIAL_FUNCTIONS : ''}SurfMaterialSample evaluateSurfaceGraph(vec3 wpos,vec3 nGeo,vec3 triBlend,Climate cl,BiomeWeights bw,float slope,float h01){\n${lines.join('\n')}\nreturn ${names.get(edge.source)};}`;
  const procedural = assets.length === 0 && !ordered.some(node => node.type === 'paintMask');
  return {assets,values,body,nodeIds:ordered.map(n=>n.id),signature:body,usesErosion,procedural};
}
