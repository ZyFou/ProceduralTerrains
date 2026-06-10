import { useEffect, useRef, useState } from 'react';

const Icon = ({ d, viewBox = '0 0 16 16', fill }) => (
  <svg viewBox={viewBox}>
    {Array.isArray(d)
      ? d.map((p, i) => <path key={i} d={p} stroke="currentColor" fill={fill ?? 'none'} strokeWidth="1.2" />)
      : <path d={d} stroke="currentColor" fill={fill ?? 'none'} strokeWidth="1.2" />}
  </svg>
);

export default function TopBar({
  previewMode, worldMode, onNew, onRandomize, onSave, onLoadJSON,
  onExportScreenshot, onExportHeightmap, onTogglePreview,
  onResetView, onToggleHelp, onOpenSettings, onToggleWorldMode,
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    const close = () => setExportOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const onFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { onLoadJSON(JSON.parse(reader.result)); }
      catch { onLoadJSON(null); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <header id="topbar">
      <div className="tb-group tb-brand">
        <svg className="logo" viewBox="0 0 24 24" fill="none">
          <path d="M3 18 L9 7 L13 13 L16 9 L21 18 Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <circle cx="17.5" cy="5.5" r="1.6" fill="currentColor" />
        </svg>
        <span className="app-name">TERRAIN STUDIO</span>
        <span className="app-version">v0.1</span>
      </div>

      <div className="tb-group tb-actions">
        <button className="tb-btn" onClick={onNew} title="Reset to default project">
          <Icon d={['M4 1.5h5.5L13 5v9.5H4z', 'M9.5 1.5V5H13']} /> New
        </button>
        <button className="tb-btn" onClick={onRandomize} title="Generate a random seed">
          <svg viewBox="0 0 16 16">
            <rect x="2" y="2" width="12" height="12" rx="2.5" stroke="currentColor" fill="none" strokeWidth="1.2" />
            <circle cx="5.5" cy="5.5" r="1.1" fill="currentColor" /><circle cx="10.5" cy="10.5" r="1.1" fill="currentColor" />
            <circle cx="10.5" cy="5.5" r="1.1" fill="currentColor" /><circle cx="5.5" cy="10.5" r="1.1" fill="currentColor" />
          </svg>
          Randomize
        </button>
        <button className="tb-btn" onClick={onSave} title="Save seed + parameters as JSON">
          <svg viewBox="0 0 16 16">
            <path d="M2 2h9.5L14 4.5V14H2z" stroke="currentColor" fill="none" strokeWidth="1.2" />
            <rect x="5" y="9" width="6" height="5" stroke="currentColor" fill="none" strokeWidth="1.2" />
            <rect x="5" y="2" width="5" height="3.5" stroke="currentColor" fill="none" strokeWidth="1.2" />
          </svg>
          Save Seed
        </button>
        <button className="tb-btn" onClick={() => fileRef.current.click()} title="Load seed + parameters from JSON">
          <Icon d={['M2 4h4l1.5 2H14v7H2z', 'M8 12V8M8 8l-1.7 1.7M8 8l1.7 1.7']} /> Load Seed
        </button>
        <div className="tb-dropdown">
          <button
            className="tb-btn"
            title="Export image"
            onClick={(e) => { e.stopPropagation(); setExportOpen(!exportOpen); }}
          >
            <Icon d={['M8 2v8M8 2 5.8 4.2M8 2l2.2 2.2', 'M3 9v4h10V9']} />
            Export
            <svg className="caret" viewBox="0 0 8 8"><path d="M1.5 3 4 5.5 6.5 3" stroke="currentColor" fill="none" strokeWidth="1.2" /></svg>
          </button>
          <div className={`tb-menu${exportOpen ? ' open' : ''}`}>
            <button onClick={onExportScreenshot}>Screenshot (PNG)</button>
            <button onClick={onExportHeightmap}>Heightmap (PNG)</button>
          </div>
        </div>
        <button
          className={`tb-btn${worldMode === 'infinite' ? ' active' : ''}`}
          onClick={onToggleWorldMode}
          title={worldMode === 'infinite' ? 'Return to Terrain Studio' : 'Explore as infinite world'}
        >
          {worldMode === 'infinite' ? (
            <svg viewBox="0 0 16 16">
              <path d="M3 12 L6 5 L9 9 L11 6 L13 12 Z" stroke="currentColor" fill="none" strokeWidth="1.2" strokeLinejoin="round" />
              <circle cx="12" cy="3.5" r="1.2" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="5.8" stroke="currentColor" fill="none" strokeWidth="1.2" />
              <ellipse cx="8" cy="8" rx="2.8" ry="5.8" stroke="currentColor" fill="none" strokeWidth="0.9" />
              <line x1="2.2" y1="6" x2="13.8" y2="6" stroke="currentColor" strokeWidth="0.9" />
              <line x1="2.2" y1="10" x2="13.8" y2="10" stroke="currentColor" strokeWidth="0.9" />
            </svg>
          )}
          {worldMode === 'infinite' ? 'Studio' : 'Explore World'}
        </button>
        <button className={`tb-btn${previewMode ? ' active' : ''}`} onClick={onTogglePreview} title="Hide panels for a clean preview">
          <svg viewBox="0 0 16 16">
            <path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" stroke="currentColor" fill="none" strokeWidth="1.2" />
            <circle cx="8" cy="8" r="1.8" stroke="currentColor" fill="none" strokeWidth="1.2" />
          </svg>
          Preview
        </button>
      </div>

      <div className="tb-group tb-right">
        <button className="tb-btn" onClick={onToggleHelp} title="Show controls help">
          <svg viewBox="0 0 16 16">
            <circle cx="8" cy="8" r="6.2" stroke="currentColor" fill="none" strokeWidth="1.2" />
            <path d="M6.2 6.2c0-1 .8-1.8 1.8-1.8s1.8.7 1.8 1.7c0 1.4-1.8 1.5-1.8 2.9" stroke="currentColor" fill="none" strokeWidth="1.2" />
            <circle cx="8" cy="11.4" r=".8" fill="currentColor" />
          </svg>
        </button>
        <button className="tb-btn" onClick={onResetView} title="Reset camera view">
          <Icon d={['M13.5 8a5.5 5.5 0 1 1-1.6-3.9', 'M13.7 1.8v2.8h-2.8']} /> Reset View
        </button>
        <button className="tb-btn" onClick={onOpenSettings} title="Project settings">
          <svg viewBox="0 0 16 16">
            <circle cx="8" cy="8" r="2.2" stroke="currentColor" fill="none" strokeWidth="1.2" />
            <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6 11 5M5 11l-1.4 1.4" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          Project Settings
        </button>
      </div>

      <input type="file" ref={fileRef} accept="application/json" hidden onChange={onFile} />
    </header>
  );
}
