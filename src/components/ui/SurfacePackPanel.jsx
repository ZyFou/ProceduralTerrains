import { importSurfaceFiles } from '../../engine/terrain/surface/SurfaceUserImport.js';
import { SURFACE_PRESETS, applySurfacePreset } from '../../engine/terrain/surface/SurfacePresets.js';
import React, { useState } from 'react';
import { SURFACE_ASSETS, SURFACE_RECIPES, DEFAULT_SURFACE_ROLES } from '../../engine/terrain/surface/SurfaceCatalog.js';
import { createSurfaceDocument } from '../../engine/terrain/surface/SurfaceDocument.js';

export default function SurfacePackPanel({ctx}) {
  const doc=createSurfaceDocument(ctx.params.surfaceDocument);
  const [importStatus,setImportStatus]=useState('');
  const options=[...SURFACE_ASSETS,...SURFACE_RECIPES,...Object.values(doc.assets)];
  const update=(next)=>ctx.onParam('surfaceDocument',next);
  return <div className="surface-role-group">
    <p className="section-hint">{SURFACE_ASSETS.length} local PBR materials · {SURFACE_RECIPES.length} derived recipes. Only active materials enter GPU memory.</p>
    <label>Import personal maps<input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.avif" onChange={async e=>{try{setImportStatus('Importing…');const result=await importSurfaceFiles(e.target.files);update({...doc,assets:{...doc.assets,...Object.fromEntries(result.assets.map(a=>[a.id,a]))}});setImportStatus(`${result.assets.length} local materials imported. ${result.unmatched.join('; ')}`);}catch(error){setImportStatus(error.message);}}}/></label><p role="status">{importStatus}</p>
    <label>Preset <select value={doc.presetId||""} onChange={e=>update(applySurfacePreset(doc,e.target.value))}><option value="" disabled>Choose a surface preset</option>{SURFACE_PRESETS.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label>Quality <select value={doc.settings.profile} onChange={e=>update({...doc,settings:{...doc.settings,profile:e.target.value}})}>
      <option value="eco">Eco · 512</option><option value="standard">Standard · 1K</option><option value="quality">Quality · up to 2K</option>
    </select></label>
    {Object.keys(DEFAULT_SURFACE_ROLES).map(role=><label key={role} style={{display:'flex',justifyContent:'space-between',gap:8,marginTop:8}}>{role}
      <select aria-label={`${role} material`} value={doc.roles[role]} onChange={e=>update({...doc,roles:{...doc.roles,[role]:e.target.value}})}>
        {options.map(asset=><option key={asset.id} value={asset.id}>{asset.name}{asset.derived?' (recipe)':''}</option>)}
      </select></label>)}
    <details><summary>Browse all materials</summary><div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
      {SURFACE_ASSETS.map(asset=><figure key={asset.id} style={{margin:0}}><img loading="lazy" src={`/textures/terrain/pbr/${asset.sourceId}/thumbnail.webp`} alt={asset.name} style={{width:'100%'}}/><figcaption>{asset.name}<small style={{display:'block'}}>{asset.origin} · {asset.scaleClass}</small></figcaption></figure>)}
    </div></details>
  </div>;
}
