import { DEFAULT_SURFACE_ROLES, SURFACE_ASSETS, SURFACE_RECIPES, SURFACE_PROFILES } from './SurfaceCatalog.js';

export const SURFACE_DOCUMENT_VERSION = 1;
export const SURFACE_MAX_LAYERS = 32;
export function createSurfaceDocument(input = {}) {
  return {...input,version:1,packVersion:input.packVersion||'1.0.0',assets:input.assets||{},
    instances:input.instances||{},recipes:input.recipes||{},roles:input.roles||{...DEFAULT_SURFACE_ROLES},
    settings:{profile:'standard',paletteInfluence:0,...input.settings},masks:input.masks||{},layers:input.layers||[]};
}
export function resolveSurfaceReference(id, document = {}, ancestors = new Set()) {
  if(ancestors.has(id)) throw new Error(`Recursive surface reference: ${id}`);
  const next=new Set(ancestors).add(id);
  const instance=document.instances?.[id];
  if(instance) return resolveSurfaceReference(instance.recipeId||instance.assetId,document,next).map(item=>({...item,...instance,assetId:item.assetId}));
  const recipe=document.recipes?.[id]||SURFACE_RECIPES.find(r=>r.id===id);
  if(recipe) return recipe.assets.flatMap(asset=>resolveSurfaceReference(asset,document,next).map(item=>({...item,tint:recipe.tint||[1,1,1],wetness:recipe.wetness||0,recipeId:id})));
  if(id?.startsWith('legacy:'))return [{assetId:id,tint:[1,1,1],wetness:0,scale:1}];
  const asset=document.assets?.[id]||SURFACE_ASSETS.find(a=>a.id===id);
  if(!asset) throw new Error(`Unknown surface asset: ${id}`);
  return [{assetId:id,tint:[1,1,1],wetness:0,scale:1,normalStrength:1,...(asset.parameters||{})}];
}
export function collectSurfaceAssets(document, references = Object.values(document.roles||{})) {
  return [...new Set(references.flatMap(id=>resolveSurfaceReference(id,document).map(item=>item.assetId)))];
}
export function surfaceResourceBudget(assetCount, profile='standard', maskBytes=0) {
  const config=SURFACE_PROFILES[profile]||SURFACE_PROFILES.standard;
  let resolution=config.resolution;
  const bytes=()=>Math.ceil(assetCount*resolution*resolution*8*4/3)+maskBytes;
  while(bytes()>config.budgetBytes && resolution>512) resolution/=2;
  if(bytes()>config.budgetBytes) throw new Error(`Surface GPU budget exceeded (${assetCount} assets). Use fewer active materials.`);
  return {...config,resolution,bytes:bytes(),reduced:resolution!==config.resolution};
}
