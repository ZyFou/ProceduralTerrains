import { describe,it,expect } from 'vitest';
import { SURFACE_ASSETS,SURFACE_RECIPES } from '../src/engine/terrain/surface/SurfaceCatalog.js';
import { createSurfaceDocument,resolveSurfaceReference,collectSurfaceAssets,surfaceResourceBudget } from '../src/engine/terrain/surface/SurfaceDocument.js';
import { SurfacePaintLayers } from '../src/manual/SurfacePaintLayers.js';
import { makeGraphNode,createBlankGraph,connectGraphNodes,updateGraphNodeParams,migrateGraphDocument } from '../src/engine/terrain/graph/GraphDocument.js';
import { compileTerrainGraph } from '../src/engine/terrain/graph/GraphCompiler.js';
import { encodePortableProject,decodePortableProject,assertCloudSurfaceSafe } from '../src/project/PortableProject.js';
import { surfaceBlobHash } from '../src/project/SurfaceAssetStore.js';
import { zlibSync } from 'fflate';
import { decodeSurfaceMipChain,createMipArray } from '../src/engine/terrain/surface/SurfaceResources.js';

describe('shared PBR resources',()=>{
  it('has 22 distinct sources, eight nonduplicated recipes and excludes tracks from natural fill',()=>{
    expect(new Set(SURFACE_ASSETS.map(a=>a.id)).size).toBe(22);expect(SURFACE_RECIPES).toHaveLength(8);
    for(const recipe of SURFACE_RECIPES)for(const asset of recipe.assets)expect(SURFACE_ASSETS.some(a=>a.id===asset)).toBe(true);
    for(const name of ['snow_01','sand_02','red_sand','grass_path_2'])expect(SURFACE_ASSETS.find(a=>a.sourceId===name).naturalFill).toBe(false);
  });
  it('resolves recipes, deduplicates assets and refuses recursive instances',()=>{
    const doc=createSurfaceDocument();expect(collectSurfaceAssets(doc).length).toBeLessThan(22);
    expect(resolveSurfaceReference('pt:wet-mud',doc)).toHaveLength(2);
    doc.instances.a={assetId:'b'};doc.instances.b={assetId:'a'};expect(()=>resolveSurfaceReference('a',doc)).toThrow(/Recursive/);
  });
  it('reduces working resolution without changing the requested profile',()=>{
    const doc=createSurfaceDocument({settings:{profile:'quality'}});const budget=surfaceResourceBudget(22,doc.settings.profile);
    expect(budget.resolution).toBe(1024);expect(budget.reduced).toBe(true);expect(doc.settings.profile).toBe('quality');
    expect(()=>surfaceResourceBudget(100,'eco')).toThrow(/budget/);
  });
  it('validates exact mip lengths and creates arrays with explicit mipmaps',()=>{
    const bytes=new Uint8Array(2*2*8+8);const levels=decodeSurfaceMipChain(zlibSync(bytes),2);
    const texture=createMipArray([levels,levels],'props');expect(texture.image.depth).toBe(2);expect(texture.mipmaps).toHaveLength(2);expect(texture.mipmaps[0].data).toHaveLength(32);expect(texture.generateMipmaps).toBe(false);texture.dispose();
    expect(()=>decodeSurfaceMipChain(zlibSync(bytes.subarray(1)),2)).toThrow(/mip/);
  });
});
describe('surface graph branches',()=>{
  function graph(){const g=createBlankGraph();g.nodes.push(makeGraphNode('pbrMaterial',{x:0,y:0},{id:'material'}));return connectGraphNodes(g,{source:'material',sourceHandle:'surface',target:'terrain-output',targetHandle:'surface'});}
  it('compiles surface without changing height generation when uniforms change',()=>{
    const g=graph(),before=compileTerrainGraph(g),after=compileTerrainGraph(updateGraphNodeParams(g,'material',{scale:3,normal:0.2}));
    expect(before.ok).toBe(true);expect(after.ok).toBe(true);expect(after.program.heightSig).toBe(before.program.heightSig);expect(after.program.sig).toBe(before.program.sig);
    expect(after.program.surface.body).toBe(before.program.surface.body);expect(after.program.surface.values).not.toEqual(before.program.surface.values);
    expect(after.program.surface.assets).toEqual(['polyhaven:rock_boulder_dry']);
  });
  it('rejects a material connected to height',()=>{const g=graph();expect(()=>connectGraphNodes(g,{source:'material',sourceHandle:'surface',target:'terrain-output',targetHandle:'height'})).toThrow();});
  it('preserves unresolved ports and metadata during migration',()=>{const raw={...graph(),version:3,extra:{keep:true}};raw.nodes.push({id:'future',type:'future',params:{value:3},extra:'keep'});raw.edges.push({id:'future-edge',source:'future',sourceHandle:'unknown',target:'terrain-output',targetHandle:'future',type:'future'});const migrated=migrateGraphDocument(raw);expect(migrated.extra).toEqual(raw.extra);expect(migrated.edges.at(-1).targetHandle).toBe('future');expect(migrated.nodes.at(-1).extra).toBe('keep');expect(migrateGraphDocument(migrated)).toEqual(migrated);});
});
describe('author paint layers',()=>{
  const create=()=>new SurfacePaintLayers({origin:{x:0,z:0},span:{x:100,z:100}});
  it('retains four overlapping contributions and partial coverage after saving',()=>{
    const f=create();for(let i=0;i<4;i++){const l=f.addLayer(SURFACE_ASSETS[i].id);f.stamp({x:50,z:50,radius:2,strength:0.1,layerId:l.id});}
    const saved=f.serialize(),loaded=SurfacePaintLayers.load(saved);
    for(let i=0;i<4;i++)expect(loaded.sample(50,50,i)).toBeCloseTo(0.1,1);
    expect(loaded.sample(-1,50,0)).toBe(0);expect(loaded.serialize()).toEqual(saved);
  });
  it('allows 32 independent layers including repeated materials and refuses a 33rd',()=>{const f=create();for(let i=0;i<32;i++)f.addLayer('polyhaven:brown_mud');expect(new Set(f.layers.map(l=>l.id)).size).toBe(32);expect(()=>f.addLayer('x')).toThrow(/32/);});
  it('undoes and redoes a whole stroke, erases only the selected layer and replaces material without changing weights',()=>{
    const f=create(),a=f.addLayer(SURFACE_ASSETS[0].id),b=f.addLayer(SURFACE_ASSETS[1].id);
    f.beginStroke();f.stamp({x:50,z:50,radius:2,strength:0.5,layerId:a.id});f.stamp({x:52,z:50,radius:2,strength:0.5,layerId:b.id});f.endStroke();const original=f.serialize();
    f.undo();expect(f.isEmpty()).toBe(true);f.redo();expect(f.serialize()).toEqual(original);
    const weight=f.sample(50,50,a.slot);f.updateLayer(a.id,{materialInstanceId:SURFACE_ASSETS[2].id});expect(f.sample(50,50,a.slot)).toBe(weight);
    f.stamp({x:50,z:50,radius:3,strength:1,tool:'erase',layerId:a.id});expect(f.sample(50,50,a.slot)).toBe(0);expect(f.sample(52,50,b.slot)).toBeGreaterThan(0);
  });
});
describe('portable personal textures',()=>{
  it('round trips actual file bytes and preserves unknown metadata',async()=>{
    const blob=new Blob([new Uint8Array([1,2,3,4])],{type:'image/png'}),hash=await surfaceBlobHash(blob),written=[];
    const project={metadata:{name:'Textures',extra:'keep'},terrain:{params:{},surfaceImports:{one:{hash,type:blob.type,name:'test.png'}}}};
    const bytes=await encodePortableProject(project,{readBlob:async()=>blob});const loaded=await decodePortableProject(bytes,{writeBlob:async b=>written.push(b)});
    expect(loaded.metadata.extra).toBe('keep');expect(loaded.terrain.surfaceImports.one.hash).toBe(hash);expect(new Uint8Array(await written[0].arrayBuffer())).toEqual(new Uint8Array([1,2,3,4]));
  });
  it('blocks cloud upload with personal files but permits built-in references',()=>{
    expect(()=>assertCloudSurfaceSafe({projectData:{terrain:{surfaceImports:{one:{hash:'x'}}}}})).toThrow(/never uploaded/);
    expect(()=>assertCloudSurfaceSafe({terrain:{params:{surfaceDocument:createSurfaceDocument()}}})).not.toThrow();
  });
});
