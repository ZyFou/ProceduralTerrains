import React, { useState } from 'react';
import { SURFACE_ASSETS, SURFACE_RECIPES } from '../../engine/terrain/surface/SurfaceCatalog.js';
export default function SurfaceLayerPanel({state,onSetting}) {
  const [material,setMaterial]=useState(SURFACE_ASSETS[0].id);
  const layers=state.layers||[],options=[...SURFACE_ASSETS,...SURFACE_RECIPES,...(state.localAssets||[])];
  return <section className="manual-inspector-section"><h3>PBR material layers ({layers.length}/32)</h3>
    <select aria-label="New layer material" value={material} onChange={e=>setMaterial(e.target.value)}>{options.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>
    <button type="button" disabled={layers.length>=32} onClick={()=>onSetting('addLayer',material)}>Add material layer</button>
    <div role="listbox" aria-label="Paint layers">{layers.map(layer=><div key={layer.id} style={{display:'grid',gap:5,marginTop:8}}>
      <button type="button" role="option" aria-selected={state.layerId===layer.id} onClick={()=>onSetting('layerId',layer.id)}>{layer.name}</button>
      <input aria-label="Layer name" value={layer.name} onChange={e=>onSetting('layerUpdate',{id:layer.id,patch:{name:e.target.value}})}/>
      <select aria-label="Replace layer material" value={layer.materialInstanceId} onChange={e=>onSetting('layerUpdate',{id:layer.id,patch:{materialInstanceId:e.target.value}})}>{layer.materialInstanceId.startsWith('legacy:')&&<option value={layer.materialInstanceId}>{layer.name} (legacy)</option>}{options.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>
      <label><input type="checkbox" checked={layer.visible} onChange={e=>onSetting('layerUpdate',{id:layer.id,patch:{visible:e.target.checked}})}/>Visible</label>
      <label><input type="checkbox" checked={layer.locked} onChange={e=>onSetting('layerUpdate',{id:layer.id,patch:{locked:e.target.checked}})}/>Locked</label>
      <label>Opacity<input type="range" min="0" max="1" step="0.01" value={layer.opacity} onChange={e=>onSetting('layerUpdate',{id:layer.id,patch:{opacity:Number(e.target.value)}})}/></label>
    </div>)}</div>
    {layers.length>0&&<details><summary>Brush filters</summary>{[['minHeight','Minimum height',-3000],['maxHeight','Maximum height',3000],['minSlope','Minimum slope',0],['maxSlope','Maximum slope',1]].map(([key,label,fallback])=><label key={key} style={{display:'block'}}>{label}<input type="number" step="0.01" value={state[key]??fallback} onChange={e=>onSetting(key,Number(e.target.value))}/></label>)}</details>}
    {layers.length>0&&<><button type="button" onClick={()=>onSetting('undoSurface',true)}>Undo stroke</button><button type="button" onClick={()=>onSetting('redoSurface',true)}>Redo stroke</button><button type="button" onClick={()=>onSetting('tool','eraseAll')}>Erase all layers</button><p className="section-hint">Layer order does not affect coverage. Masks stay anchored when the terrain is resized. Quality profiles may approximate complex overlaps.</p></>}
  </section>;
}
