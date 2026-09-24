import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { createEditableProjectDocument, readEditableProjectDocument } from './ProjectDocument.js';
import { getSurfaceBlob, putSurfaceBlob, surfaceBlobHash } from './SurfaceAssetStore.js';

export function projectSurfaceFileRefs(project) {
  const terrain=project.terrain||project;
  return [...Object.values(terrain.surfaceImports||{}),...Object.values(terrain.params?.surfaceDocument?.assets||terrain.surfaceDocument?.assets||{}).flatMap(asset=>asset.provider==='user'?Object.values(asset.maps||{}):[])];
}
export async function encodePortableProject(project,{readBlob=getSurfaceBlob}={}) {
  const document=createEditableProjectDocument(project),files={'project.json':strToU8(JSON.stringify(document))};
  for(const ref of projectSurfaceFileRefs(document)) {
    if(!/^[a-f0-9]{64}$/.test(ref.hash))throw new Error('Invalid texture reference');
    if(files[`assets/${ref.hash}`])continue;
    const blob=await readBlob(ref.hash);
    if(!blob)throw new Error(`Missing local texture ${ref.name||ref.hash}. Reimport it before export.`);
    if(await surfaceBlobHash(blob)!==ref.hash)throw new Error(`Texture checksum mismatch: ${ref.hash}`);
    files[`assets/${ref.hash}`]=new Uint8Array(await blob.arrayBuffer());
  }
  return zipSync(files,{level:6});
}
export async function decodePortableProject(input,{writeBlob=putSurfaceBlob}={}) {
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(bytes[0]!==80||bytes[1]!==75)return readEditableProjectDocument(JSON.parse(strFromU8(bytes)),{legacy:true});
  // Never extract archive paths to disk; only declared content-addressed files are read.
  const entries=unzipSync(bytes);
  if(!entries['project.json'])throw new Error('Portable project.json missing');
  const project=readEditableProjectDocument(JSON.parse(strFromU8(entries['project.json'])));
  const validated=[];
  for(const ref of projectSurfaceFileRefs(project)) {
    if(!/^[a-f0-9]{64}$/.test(ref.hash))throw new Error('Invalid texture reference');
    const data=entries[`assets/${ref.hash}`];if(!data)throw new Error(`Missing texture ${ref.name||ref.hash}`);
    const blob=new Blob([data],{type:ref.type});
    if(await surfaceBlobHash(blob)!==ref.hash)throw new Error(`Texture checksum mismatch: ${ref.hash}`);
    validated.push(blob);
  }
  for(const blob of validated)await writeBlob(blob);
  return project;
}
export function assertCloudSurfaceSafe(input) {
  const project=input?.projectData||input?.project||input?.data||input;
  const text=JSON.stringify(project);
  const refs=projectSurfaceFileRefs(project||{});
  if(refs.length||/"(?:source|provider)"\s*:\s*"(?:local|user)"/.test(text)||text.includes('blob:'))
    throw new Error('This project uses local textures. Export a portable .ptrterrain file; personal textures are never uploaded to the cloud.');
  if(new TextEncoder().encode(text).byteLength>8*1024*1024)throw new Error('Project exceeds the 8 MiB cloud document limit. Export a portable .ptrterrain file.');
}
