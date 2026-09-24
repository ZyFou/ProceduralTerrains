import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import sharp from 'sharp';
import { SURFACE_ASSETS, SURFACE_RECIPES } from '../src/engine/terrain/surface/SurfaceCatalog.js';

const root = path.resolve(import.meta.dirname, '..');
const cache = path.join(root,'.cache/materials');
const output = path.resolve(root, process.argv.find(a=>a.startsWith('--root='))?.slice(7) || 'public/textures/terrain/pbr');
const hash = (data,algorithm='sha256') => createHash(algorithm).update(data).digest('hex');
const json = async file => JSON.parse(await fs.readFile(file,'utf8'));
const writeJSON = (file,value) => fs.writeFile(file,JSON.stringify(value,null,2)+'\n');
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function download(url, file, expected) {
  try { const bytes=await fs.readFile(file); if(!expected || hash(bytes,'md5')===expected) return bytes; } catch {}
  for(let attempt=0;attempt<4;attempt++) {
    try {
      const response=await fetch(url,{headers:{'User-Agent':'ProceduralTerrains/1.8.4 materials-preparation'},signal:AbortSignal.timeout(120000)});
      if(!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes=Buffer.from(await response.arrayBuffer());
      if(expected && hash(bytes,'md5')!==expected) throw new Error('provider checksum mismatch');
      await fs.writeFile(file+'.part',bytes); await fs.rename(file+'.part',file); return bytes;
    } catch(error) { if(attempt===3) throw new Error(`${url}: ${error.message}`); await sleep(1000*2**attempt); }
  }
}
async function fetchAsset(asset) {
  const dir=path.join(cache,asset.sourceId); await fs.mkdir(dir,{recursive:true});
  const maps={}; let authors=[],physicalSize=null;
  if(asset.provider==='polyhaven') {
    const files=JSON.parse(await download(`https://api.polyhaven.com/files/${asset.sourceId}`,path.join(dir,'files.json')));
    const info=JSON.parse(await download(`https://api.polyhaven.com/info/${asset.sourceId}`,path.join(dir,'info.json')));
    authors=Object.keys(info.authors||{});
    physicalSize=info.dimensions?.slice(0,2).map(n=>n/1000) || null;
    for(const [slot,keys] of Object.entries({albedo:['Diffuse','diff'],normal:['nor_gl'],roughness:['rough'],height:['Displacement','disp'],ao:['AO','ao']})) {
      const group=keys.map(k=>files[k]?.['2k']).find(Boolean);
      const entry=slot==='height' ? group?.png || group?.jpg : group?.jpg || group?.png;
      if(!entry) { if(slot==='albedo') throw new Error(`${asset.id}: missing albedo`); continue; }
      const name=path.basename(new URL(entry.url).pathname);
      const bytes=await download(entry.url,path.join(dir,name),entry.md5);
      maps[slot]={file:name,url:entry.url,sha256:hash(bytes)};
    }
  } else {
    const metadata=JSON.parse(await download(`https://ambientcg.com/api/v2/full_json?include=downloadData&id=${asset.sourceId}`,path.join(dir,'info.json')));
    const info=metadata.foundAssets?.[0];
    const downloads=info?.downloadFolders?.default?.downloadFiletypeCategories?.zip?.downloads || [];
    const entry=downloads.find(d=>d.attribute==='2K-PNG');
    if(!entry) throw new Error(`${asset.id}: 2K PNG archive unavailable`);
    const archive=await download(entry.downloadLink,path.join(dir,entry.fileName));
    const files=unzipSync(archive);
    for(const [slot,suffix] of Object.entries({albedo:'Color',normal:'NormalGL',roughness:'Roughness',height:'Displacement',ao:'AmbientOcclusion'})) {
      const match=Object.keys(files).find(name=>name.endsWith(`_${suffix}.png`));
      if(!match) { if(slot==='albedo') throw new Error(`${asset.id}: missing albedo`); continue; }
      const name=path.basename(match); await fs.writeFile(path.join(dir,name),files[match]);
      maps[slot]={file:name,url:entry.downloadLink,sha256:hash(files[match])};
    }
    authors=['Lennart Demes']; physicalSize=info.dimensionX && info.dimensionY ? [info.dimensionX/100,info.dimensionY/100] : null;
  }
  await writeJSON(path.join(dir,'resolved.json'),{...asset,authors,physicalSize,maps});
  console.log(`Fetched ${asset.id}`);
}
const linear = v => { v/=255; return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4; };
const srgb = v => Math.round(255*(v<=0.0031308?12.92*v:1.055*v**(1/2.4)-0.055));
function downsample(color,props,size) {
  const next=size/2,c=Buffer.alloc(next*next*4),p=Buffer.alloc(c.length);
  for(let y=0;y<next;y++) for(let x=0;x<next;x++) {
    const out=(y*next+x)*4,indices=[((y*2)*size+x*2)*4,((y*2)*size+x*2+1)*4,((y*2+1)*size+x*2)*4,((y*2+1)*size+x*2+1)*4];
    for(let k=0;k<3;k++) c[out+k]=srgb(indices.reduce((s,i)=>s+linear(color[i+k]),0)/4);
    c[out+3]=Math.round(indices.reduce((s,i)=>s+color[i+3],0)/4);
    let nx=0,ny=0,nz=0;
    for(const i of indices) {const a=props[i]/127.5-1,b=props[i+1]/127.5-1;nx+=a;ny+=b;nz+=Math.sqrt(Math.max(0,1-a*a-b*b));}
    const length=Math.hypot(nx,ny,nz)||1;
    p[out]=Math.round((nx/length+1)*127.5);p[out+1]=Math.round((ny/length+1)*127.5);
    for(let k=2;k<4;k++) p[out+k]=Math.round(indices.reduce((s,i)=>s+props[i+k],0)/4);
  }
  return [c,p];
}
async function buildAsset(asset) {
  const dir=path.join(cache,asset.sourceId),source=await json(path.join(dir,'resolved.json'));
  const dest=path.join(output,asset.sourceId); await fs.mkdir(dest,{recursive:true});
  const pixels={};
  for(const [slot,map] of Object.entries(source.maps)) {
    const bytes=await fs.readFile(path.join(dir,map.file));
    if(hash(bytes)!==map.sha256) throw new Error(`${asset.id}: source hash mismatch ${slot}`);
    pixels[slot]=await sharp(bytes).resize(2048,2048,{fit:'fill'}).removeAlpha().toColourspace('srgb').raw().toBuffer();
  }
  let color=Buffer.alloc(2048**2*4),props=Buffer.alloc(color.length);
  for(let i=0;i<2048**2;i++) {
    for(let k=0;k<3;k++) color[i*4+k]=pixels.albedo[i*3+k];
    color[i*4+3]=pixels.height?.[i*3] ?? 128;
    props[i*4]=pixels.normal?.[i*3] ?? 128; props[i*4+1]=pixels.normal?.[i*3+1] ?? 128;
    props[i*4+2]=pixels.roughness?.[i*3] ?? 230; props[i*4+3]=pixels.ao?.[i*3] ?? 255;
  }
  const levels=[];
  for(let size=2048;size>=1;size/=2) { levels.push({size,color,props}); if(size>1) [color,props]=downsample(color,props,size); }
  const files=[];
  async function record(name,bytes,extra={}) {
    await fs.writeFile(path.join(dest,name),bytes);
    const entry={path:`${asset.sourceId}/${name}`,bytes:bytes.length,sha256:hash(bytes),...extra}; files.push(entry);return entry;
  }
  const resolutions={};
  for(const size of [512,1024,2048]) {
    const chain=levels.filter(l=>l.size<=size);
    const bytes=deflateSync(Buffer.concat(chain.flatMap(l=>[l.color,l.props])),{level:6});
    resolutions[size]=await record(`${size}.pbr`,bytes,{resolution:size,levels:chain.length,encoding:'deflate-rgba8-mips-v1'});
  }
  const thumbnail=await record('thumbnail.webp',await sharp(path.join(dir,source.maps.albedo.file)).resize(160,160).webp({quality:80}).toBuffer());
  let heightSource=null;
  if(source.maps.height) heightSource=await record(`height-source${path.extname(source.maps.height.file)}`,await fs.readFile(path.join(dir,source.maps.height.file)));
  console.log(`Prepared ${asset.id}`);
  return {...source,maps:Object.fromEntries(Object.entries(source.maps).map(([k,v])=>[k,{sourceUrl:v.url,sha256:v.sha256}])),
    normalConvention:'GL',resolutions,thumbnail,heightSource,files,
    missingOptional:['normal','roughness','height','ao'].filter(s=>!source.maps[s]),
    transformations:['2K normalization','linear-light color mipmaps','renormalized normal mipmaps','RGBA8 color/height and normal/roughness/AO packing']};
}
async function verify() {
  const manifest=await json(path.join(output,'catalog.json'));
  if(manifest.assets.length!==SURFACE_ASSETS.length) throw new Error('Pack must contain all 22 assets');
  if(JSON.stringify(manifest.recipes)!==JSON.stringify(SURFACE_RECIPES)) throw new Error('Recipe manifest is out of date; run npm run materials:build');
  const ids=new Set();
  for(const asset of manifest.assets) {
    if(ids.has(asset.id)||!SURFACE_ASSETS.some(a=>a.id===asset.id)) throw new Error(`Invalid asset ${asset.id}`); ids.add(asset.id);
    for(const file of asset.files) {
      const resolved=path.resolve(output,file.path); if(!resolved.startsWith(output+path.sep)) throw new Error('Invalid pack path');
      const bytes=await fs.readFile(resolved);
      if(bytes.length!==file.bytes || hash(bytes)!==file.sha256) throw new Error(`Corrupt ${file.path}`);
      if(file.encoding) {const raw=inflateSync(bytes);let expected=0;for(let n=file.resolution;n>=1;n/=2)expected+=n*n*8;if(raw.length!==expected)throw new Error(`Invalid mip chain ${file.path}`);}
      else await sharp(bytes).metadata();
    }
    for(const n of [512,1024,2048]) if(!asset.resolutions[n]) throw new Error(`Missing ${n}: ${asset.id}`);
  }
  await fs.access(path.join(output,'ATTRIBUTION.md'));
  console.log(`Verified ${ids.size} local PBR materials and ${manifest.recipes.length} recipes.`);
}
try {
  const command=process.argv[2];
  if(command==='fetch') {
    const queue=[...SURFACE_ASSETS]; await Promise.all(Array.from({length:2},async()=>{while(queue.length) await fetchAsset(queue.shift());}));
  } else if(command==='build') {
    await fs.mkdir(output,{recursive:true});const assets=[];
    for(const asset of SURFACE_ASSETS) assets.push(await buildAsset(asset));
    await writeJSON(path.join(output,'catalog.json'),{version:1,packVersion:'1.0.0',assets,recipes:SURFACE_RECIPES});
    await fs.writeFile(path.join(output,'ATTRIBUTION.md'),'# Terrain textures\n\nAssets licensed CC0-1.0. Recipes are artistic adaptations.\n\n'+assets.map(a=>`- **${a.name}** — ${a.authors.join(', ')} / ${a.provider}: ${a.sourceUrl}\n  ${a.transformations.join('; ')}.`).join('\n')+'\n\n## Derived recipes\n\n'+SURFACE_RECIPES.map(r=>`- **${r.name}** — ${r.assets.join(' + ')}; linear albedo multiplier ${r.tint.join(', ')}${r.wetness?`; wetness ${r.wetness}`:''}.`).join('\n')+'\n');
  } else if(command==='verify') await verify();
  else throw new Error('Usage: node tools/materials.mjs fetch|build|verify [--root=path/to/pbr]');
} catch(error) { console.error(`${error.message}\nRepair: npm run materials:fetch && npm run materials:build`); process.exitCode=1; }
