import React, { useRef, useState } from 'react';
import { ImageUp } from 'lucide-react';
import { importSurfaceFiles } from '../../engine/terrain/surface/SurfaceUserImport.js';
import { SURFACE_PRESETS, applySurfacePreset } from '../../engine/terrain/surface/SurfacePresets.js';
import { SURFACE_ASSETS, SURFACE_RECIPES, DEFAULT_SURFACE_ROLES } from '../../engine/terrain/surface/SurfaceCatalog.js';
import { createSurfaceDocument } from '../../engine/terrain/surface/SurfaceDocument.js';

export default function SurfacePackPanel({ ctx }) {
  const doc = createSurfaceDocument(ctx.params.surfaceDocument);
  const fileInput = useRef(null);
  const [importStatus, setImportStatus] = useState('');
  const options = [...SURFACE_ASSETS, ...SURFACE_RECIPES, ...Object.values(doc.assets)];
  const update = (next) => ctx.onParam('surfaceDocument', next);

  const importFiles = async (event) => {
    const files = event.target.files;
    if (!files?.length) return;
    try {
      setImportStatus('Importing…');
      const result = await importSurfaceFiles(files);
      update({ ...doc, assets: { ...doc.assets, ...Object.fromEntries(result.assets.map((asset) => [asset.id, asset])) } });
      setImportStatus(`${result.assets.length} local materials imported.${result.unmatched.length ? ` Skipped: ${result.unmatched.join('; ')}` : ''}`);
    } catch (error) {
      setImportStatus(error.message);
    } finally {
      event.target.value = '';
    }
  };

  return <div className="surface-role-group surface-pack">
    <p className="section-hint">{SURFACE_ASSETS.length} local PBR materials · {SURFACE_RECIPES.length} derived recipes. Only active materials enter GPU memory.</p>

    <div className="surface-pack-field">
      <span className="surface-pack-label">Import personal maps</span>
      <div className="file-picker surface-pack-picker">
        <button type="button" className="file-picker-btn" onClick={() => fileInput.current?.click()}>
          <ImageUp size={14} strokeWidth={1.75} aria-hidden /> Choose image files
        </button>
        <input ref={fileInput} type="file" className="file-picker-input" aria-label="Import personal maps"
          multiple accept=".png,.jpg,.jpeg,.webp,.avif" onChange={importFiles} />
      </div>
      {importStatus && <p className="surface-pack-status" role="status">{importStatus}</p>}
    </div>

    <label className="surface-pack-field">
      <span className="surface-pack-label">Preset</span>
      <select value={doc.presetId || ''} onChange={(event) => update(applySurfacePreset(doc, event.target.value))}>
        <option value="" disabled>Choose a surface preset</option>
        {SURFACE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
      </select>
    </label>

    <label className="surface-pack-field">
      <span className="surface-pack-label">Quality</span>
      <select value={doc.settings.profile} onChange={(event) => update({ ...doc, settings: { ...doc.settings, profile: event.target.value } })}>
        <option value="eco">Eco · 512</option>
        <option value="standard">Standard · 1K</option>
        <option value="quality">Quality · up to 2K</option>
      </select>
    </label>

    <div className="surface-pack-heading">Biome materials</div>
    {Object.keys(DEFAULT_SURFACE_ROLES).map((role) => <label className="surface-pack-role" key={role}>
      <span>{role}</span>
      <select aria-label={`${role} material`} value={doc.roles[role]}
        onChange={(event) => update({ ...doc, roles: { ...doc.roles, [role]: event.target.value } })}>
        {options.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}{asset.derived ? ' (recipe)' : ''}</option>)}
      </select>
    </label>)}

    <details className="surface-pack-gallery">
      <summary>Browse all materials</summary>
      <div className="surface-pack-gallery-grid">
        {SURFACE_ASSETS.map((asset) => <figure key={asset.id}>
          <img loading="lazy" src={`/textures/terrain/pbr/${asset.sourceId}/thumbnail.webp`} alt="" />
          <figcaption>{asset.name}<small>{asset.origin} · {asset.scaleClass}</small></figcaption>
        </figure>)}
      </div>
    </details>
  </div>;
}
