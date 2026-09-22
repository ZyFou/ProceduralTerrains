import React, { useEffect, useState } from 'react';
import { loadSurfaceCatalog } from '../../engine/terrain/surface/SurfaceResources.js';
export default function SurfacePackCredits() {
  const [catalog,setCatalog]=useState(null),[error,setError]=useState('');
  useEffect(()=>{let active=true;loadSurfaceCatalog().then(c=>{if(active)setCatalog(c);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
  return <details><summary>Terrain textures — Poly Haven &amp; ambientCG (CC0)</summary>
    {error && <p role="alert">{error}</p>}
    <p>Recipes are artistic adaptations. Texture files are included with this application.</p>
    <ul>{catalog?.assets.map(asset=><li key={asset.id}><a href={asset.sourceUrl} target="_blank" rel="noopener noreferrer">{asset.name}</a> — {asset.authors.join(', ')} / {asset.provider}, CC0-1.0.<small style={{display:'block'}}>{asset.transformations.join('; ')}</small></li>)}</ul>
  </details>;
}
