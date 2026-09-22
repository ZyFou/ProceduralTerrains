import { putSurfaceBlob } from '../../../project/SurfaceAssetStore.js';
import { collectSurfaceTextureSets } from './SurfaceTextureImport.js';
export async function importSurfaceFiles(files) {
  const entries=[...files].map(file=>({name:file.name,blob:file}));
  const {sets,unmatched}=collectSurfaceTextureSets(entries,['diffuse','normalDX','normalGL','roughness','ao','displacement']);
  // A single image is also a valid explicitly chosen albedo; never infer normals.
  if(!sets.length&&entries.length===1)sets.push({name:entries[0].name,maps:new Map([['diffuse',entries[0]]])});
  const assets=[];
  for(const set of sets) {
    if(!set.maps.has('diffuse'))throw new Error(`${set.name}: select an albedo/color map`);
    const maps={};
    for(const [slot,entry] of set.maps){const key={diffuse:'albedo',normalDX:'normal',normalGL:'normal',roughness:'roughness',ao:'ao',displacement:'height'}[slot];maps[key]={...await putSurfaceBlob(entry.blob),name:entry.name};}
    assets.push({id:`user:${maps.albedo.hash}`,name:set.name,provider:'user',origin:'import',maps,normalConvention:set.maps.has('normalDX')?'DX':'GL',physicalSize:null});
  }
  if(!assets.length)throw new Error('No supported material maps found. Use PNG, JPEG or WebP maps.');
  return {assets,unmatched};
}
