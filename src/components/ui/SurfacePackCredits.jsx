import { translateText, useLanguage } from '../../i18n/LanguageContext.jsx';
import React, { useEffect, useState } from 'react';
import { loadSurfaceCatalog } from '../../engine/terrain/surface/SurfaceResources.js';
export default function SurfacePackCredits() {
  useLanguage();
  const [catalog,setCatalog]=useState(null),[error,setError]=useState('');
  useEffect(()=>{let active=true;loadSurfaceCatalog().then(c=>{if(active)setCatalog(c);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
  return <details><summary>{translateText("Terrain textures — Poly Haven & ambientCG (CC0)")}</summary>
    {error && <p role="alert">{translateText(error)}</p>}
    <p>{translateText("Recipes are artistic adaptations. Texture files are included with this application.")}</p>
    <p>{catalog?.recipes.map(recipe=>`${recipe.name}: ${recipe.assets.join(' + ')}, albedo multiplier ${recipe.tint.join(', ')}`).join('; ')}</p>
    <ul>{catalog?.assets.map(asset=><li key={asset.id}><a href={asset.sourceUrl} target="_blank" rel="noopener noreferrer">{translateText(asset.name)}</a> — {translateText(asset.authors.join(', '))} / {translateText(asset.provider)}{translateText(", CC0-1.0.")}<small style={{display:'block'}}>{asset.transformations.map((item) => translateText(item)).join('; ')}</small></li>)}</ul>
  </details>;
}
