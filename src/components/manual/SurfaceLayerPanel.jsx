import { translateText, useLanguage } from '../../i18n/LanguageContext.jsx';
import React, { useState } from 'react';
import { SURFACE_ASSETS, SURFACE_RECIPES } from '../../engine/terrain/surface/SurfaceCatalog.js';
export default function SurfaceLayerPanel({state,onSetting}) {
  useLanguage();
  const [material,setMaterial]=useState(SURFACE_ASSETS[0].id);
  const layers=state.layers||[],options=[...SURFACE_ASSETS,...SURFACE_RECIPES,...(state.localAssets||[])];
  return <section className="manual-inspector-section"><h3>{translateText("PBR material layers (")}{translateText(layers.length)}/32)</h3>
    <select aria-label={translateText("New layer material")} value={material} onChange={e=>setMaterial(e.target.value)}>{options.map(a=><option key={a.id} value={a.id}>{translateText(a.name)}</option>)}</select>
    <button type="button" disabled={layers.length>=32} onClick={()=>onSetting('addLayer',material)}>{translateText("Add material layer")}</button>
    <div role="listbox" aria-label={translateText("Paint layers")}>{layers.map(layer=><div key={layer.id} style={{display:'grid',gap:5,marginTop:8}}>
      <button type="button" role="option" aria-selected={state.layerId===layer.id} onClick={()=>onSetting('layerId',layer.id)}>{layer.name}</button>
      <input aria-label={translateText("Layer name")} value={layer.name} onChange={e=>onSetting('layerUpdate',{id:layer.id,patch:{name:e.target.value}})}/>
      <select aria-label={translateText("Replace layer material")} value={layer.materialInstanceId} onChange={e=>onSetting('layerUpdate',{id:layer.id,patch:{materialInstanceId:e.target.value}})}>{layer.materialInstanceId.startsWith('legacy:')&&<option value={layer.materialInstanceId}>{layer.name}{translateText(" (legacy)")}</option>}{options.map(a=><option key={a.id} value={a.id}>{translateText(a.name)}</option>)}</select>
      <label><input type="checkbox" checked={layer.visible} onChange={e=>onSetting('layerUpdate',{id:layer.id,patch:{visible:e.target.checked}})}/>{translateText("Visible")}</label>
      <label><input type="checkbox" checked={layer.locked} onChange={e=>onSetting('layerUpdate',{id:layer.id,patch:{locked:e.target.checked}})}/>{translateText("Locked")}</label>
      <label>{translateText("Opacity")}<input type="range" min="0" max="1" step="0.01" value={layer.opacity} onChange={e=>onSetting('layerUpdate',{id:layer.id,patch:{opacity:Number(e.target.value)}})}/></label>
    </div>)}</div>
    {layers.length>0&&<details><summary>{translateText("Brush filters")}</summary>{[['minHeight','Minimum height',-3000],['maxHeight','Maximum height',3000],['minSlope','Minimum slope',0],['maxSlope','Maximum slope',1]].map(([key,label,fallback])=><label key={key} style={{display:'block'}}>{translateText(label)}<input type="number" step="0.01" value={state[key]??fallback} onChange={e=>onSetting(key,Number(e.target.value))}/></label>)}</details>}
    {layers.length>0&&<><button type="button" onClick={()=>onSetting('undoSurface',true)}>{translateText("Undo stroke")}</button><button type="button" onClick={()=>onSetting('redoSurface',true)}>{translateText("Redo stroke")}</button><button type="button" onClick={()=>onSetting('tool','eraseAll')}>{translateText("Erase all layers")}</button><p className="section-hint">{translateText("Layer order does not affect coverage. Masks stay anchored when the terrain is resized. Quality profiles may approximate complex overlaps.")}</p></>}
  </section>;
}
