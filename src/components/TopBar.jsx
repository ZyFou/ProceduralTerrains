import { useEffect, useRef, useState } from 'react';
import { APP_NAME, APP_VERSION } from '../constants/app.js';

const Icon = ({ d, viewBox = '0 0 16 16', fill }) => (
  <svg viewBox={viewBox}>
    {Array.isArray(d)
      ? d.map((p, i) => <path key={i} d={p} stroke="currentColor" fill={fill ?? 'none'} strokeWidth="1.2" />)
      : <path d={d} stroke="currentColor" fill={fill ?? 'none'} strokeWidth="1.2" />}
  </svg>
);

export default function TopBar({
  previewMode, onNew, onRandomize, onSave, onLoadJSON, onDownload,
  onTogglePreview, onToggleHelp,
  paintMode, onTogglePaintMode, onOpenPanel, activePanel,
  loading, onOpenSettingsSearch, settingsSearchOpen,
  onUndo, onRedo, canUndo, canRedo,
  onOpenHistory, onOpenProjects,
  onOpenUiSettings,
}) {
  const fileRef = useRef(null);
  const fileMenuRef = useRef(null);
  const layoutMenuRef = useRef(null);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);

  useEffect(() => {
    if (!fileMenuOpen && !layoutMenuOpen) return undefined;

    const onPointerDown = (event) => {
      if (!fileMenuRef.current?.contains(event.target)) setFileMenuOpen(false);
      if (!layoutMenuRef.current?.contains(event.target)) setLayoutMenuOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setFileMenuOpen(false);
        setLayoutMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [fileMenuOpen, layoutMenuOpen]);

  const runFileAction = (action) => {
    setFileMenuOpen(false);
    action();
  };

  const runLayoutAction = (action) => {
    setLayoutMenuOpen(false);
    action();
  };

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
    <header id="topbar" className={fileMenuOpen || layoutMenuOpen ? 'file-menu-open' : ''}>
      <button type="button" className="tb-group tb-brand tb-brand-button tb-btn" onClick={onOpenProjects} title="Return to main menu">
        <svg className="logo" viewBox="0 0 24 24" fill="none">
          <path d="M3 18 L9 7 L13 13 L16 9 L21 18 Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <circle cx="17.5" cy="5.5" r="1.6" fill="currentColor" />
        </svg>
        <span className="app-name">{APP_NAME}</span>
      </button>

      <div className="tb-group tb-actions">
        <div className="tb-dropdown" ref={fileMenuRef}>
          <button
            type="button"
            className={`tb-btn tb-file-btn${fileMenuOpen ? ' active' : ''}`}
            onClick={() => setFileMenuOpen((open) => !open)}
            title="File actions"
            aria-haspopup="menu"
            aria-expanded={fileMenuOpen}
          >
            <Icon d={['M4 1.5h5.5L13 5v9.5H4z', 'M9.5 1.5V5H13']} />
            <span className="tb-text">File</span>
            <svg className="tb-file-caret" viewBox="0 0 12 12" aria-hidden>
              <path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className={`tb-menu${fileMenuOpen ? ' open' : ''}`} role="menu" aria-label="File actions">
            <button type="button" role="menuitem" onClick={() => runFileAction(onNew)}>
              <Icon d={['M4 1.5h5.5L13 5v9.5H4z', 'M9.5 1.5V5H13']} /> New
            </button>
            <button type="button" role="menuitem" onClick={() => runFileAction(onOpenProjects)}>
              <Icon d={['M2 4h4l1.5 2H14v7H2z', 'M8 8v4M6 10h4']} /> Projects
            </button>
            <div className="tb-menu-divider" role="separator" />
            <button type="button" role="menuitem" onClick={() => runFileAction(onSave)}>
              <Icon d={['M2 2h9.5L14 4.5V14H2z', 'M5 9h6v5H5z', 'M5 2v3.5h5V2']} /> Save
            </button>
            <button type="button" role="menuitem" onClick={() => runFileAction(() => fileRef.current?.click())}>
              <Icon d={['M2 4h4l1.5 2H14v7H2z', 'M8 12V8M8 8l-1.7 1.7M8 8l1.7 1.7']} /> Load
            </button>
            <button type="button" role="menuitem" onClick={() => runFileAction(onDownload)}>
              <Icon d={['M8 2v8M8 2 5.8 4.2M8 2l2.2 2.2', 'M3 9v4h10V9']} /> Download
            </button>
          </div>
        </div>
        <button className="tb-btn" onClick={onRandomize} title="Generate a random seed">
          <svg viewBox="0 0 16 16">
            <rect x="2" y="2" width="12" height="12" rx="2.5" stroke="currentColor" fill="none" strokeWidth="1.2" />
            <circle cx="5.5" cy="5.5" r="1.1" fill="currentColor" /><circle cx="10.5" cy="10.5" r="1.1" fill="currentColor" />
            <circle cx="10.5" cy="5.5" r="1.1" fill="currentColor" /><circle cx="5.5" cy="10.5" r="1.1" fill="currentColor" />
          </svg>
          <span className="tb-text tb-action-label">Randomize</span>
        </button>
        <button
          className={`tb-btn${paintMode ? ' active' : ''}`}
          onClick={onTogglePaintMode}
          title="Paint terrain height, biomes, and masks"
        >
          <svg viewBox="0 0 16 16"><path d="M3 12c2-4 5-7 10-9-2 5-5 8-9 10z" stroke="currentColor" fill="none" strokeWidth="1.2"/><path d="M4 13c-1 .5-1.5 1-2 1 0-.7.4-1.5 1-2" stroke="currentColor" fill="none" strokeWidth="1.2"/></svg>
          <span className="tb-text tb-action-label">Paint</span>
        </button>
      </div>

      <div className="tb-group tb-right">
        {loading && (
          <span className="tb-loading" title={loading.detail || loading.label}>
            <svg viewBox="0 0 24 24" width="14" height="14" className="tb-spin" aria-hidden>
              <circle cx="12" cy="12" r="9" fill="none" stroke="var(--border-subtle)" strokeWidth="2.5" />
              <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <span className="tb-text">{loading.label}</span>
          </span>
        )}
        <div className="tb-dropdown" ref={layoutMenuRef}>
          <button
            type="button"
            className={`tb-btn tb-layout-btn${layoutMenuOpen ? ' active' : ''}`}
            onClick={() => {
              setLayoutMenuOpen((open) => !open);
              setFileMenuOpen(false);
            }}
            title="Layout settings"
            aria-haspopup="menu"
            aria-expanded={layoutMenuOpen}
          >
            <Icon d={['M2.5 3.5h11v9h-11z', 'M2.5 6.5h11', 'M6 6.5v6']} />
            <span className="tb-text">Layout</span>
            <svg className="tb-file-caret" viewBox="0 0 12 12" aria-hidden>
              <path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className={`tb-menu tb-layout-menu${layoutMenuOpen ? ' open' : ''}`} role="menu" aria-label="Layout settings">
            <div className="tb-menu-section-label">Workspace Layout</div>
            <button type="button" role="menuitem" disabled title="Preset options will be added next">
              <Icon d={['M2.5 3.5h11v9h-11z', 'M2.5 6.5h11', 'M6 6.5v6']} /> Default layout
            </button>
            <button type="button" role="menuitem" disabled title="Preset options will be added next">
              <Icon d={['M2.5 3.5h11v9h-11z', 'M6 3.5v9']} /> Modular layout
            </button>
            <div className="tb-menu-divider" role="separator" />
            <button
              type="button"
              role="menuitem"
              onClick={() => runLayoutAction(() => onOpenUiSettings?.())}
            >
              <Icon d={[
                'M8 2.8l.9 1.7 1.9.4-1.3 1.4.2 1.9L8 7.4l-1.7.8.2-1.9-1.3-1.4 1.9-.4z',
                'M3 12.5h10',
              ]} />
              Settings
            </button>
          </div>
        </div>
        <button
          type="button"
          className={`tb-btn tb-search-btn${settingsSearchOpen ? ' active' : ''}`}
          onClick={onOpenSettingsSearch}
          title="Search settings (Ctrl+K)"
          aria-pressed={settingsSearchOpen}
        >
          <svg viewBox="0 0 16 16" aria-hidden>
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" fill="none" strokeWidth="1.2" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" fill="none" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <span className="tb-text">Search settings</span>
          <span className="tb-shortcut">Ctrl+K</span>
        </button>
        <button className="tb-btn tb-icon-btn tb-edit-history" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M5.5 4.5L2.5 7.5L5.5 10.5" stroke="currentColor" fill="none" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2.5 7.5H9.5a4 4 0 0 1 0 8H7" stroke="currentColor" fill="none" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          className={`tb-btn tb-icon-btn${activePanel === 'history' ? ' active' : ''}`}
          onClick={onOpenHistory}
          title="Creator history"
          aria-label="Creator history"
        >
          <svg viewBox="0 0 16 16" aria-hidden>
            <circle cx="8" cy="8" r="5.7" stroke="currentColor" fill="none" strokeWidth="1.25" />
            <path d="M8 4.6V8l2.5 1.6" stroke="currentColor" fill="none" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button className="tb-btn tb-icon-btn tb-edit-history" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Y)" aria-label="Redo">
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M10.5 4.5L13.5 7.5L10.5 10.5" stroke="currentColor" fill="none" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M13.5 7.5H6.5a4 4 0 0 0 0 8H9" stroke="currentColor" fill="none" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          className={`tb-btn primary${activePanel === 'export' ? ' active' : ''}`}
          onClick={() => onOpenPanel('export')}
          title="Export the scene"
        >
          <Icon d={['M8 2v8M8 2 5.8 4.2M8 2l2.2 2.2', 'M3 9v4h10V9']} />
          <span className="tb-text">Export</span>
        </button>
        <button className="tb-btn" onClick={onToggleHelp} title="Show controls help">
          <svg viewBox="0 0 16 16">
            <circle cx="8" cy="8" r="6.2" stroke="currentColor" fill="none" strokeWidth="1.2" />
            <path d="M6.2 6.2c0-1 .8-1.8 1.8-1.8s1.8.7 1.8 1.7c0 1.4-1.8 1.5-1.8 2.9" stroke="currentColor" fill="none" strokeWidth="1.2" />
            <circle cx="8" cy="11.4" r=".8" fill="currentColor" />
          </svg>
        </button>
        <button className={`tb-btn${previewMode ? ' active' : ''}`} onClick={onTogglePreview} title="Hide panels for a clean preview">
          <svg viewBox="0 0 16 16">
            <path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" stroke="currentColor" fill="none" strokeWidth="1.2" />
            <circle cx="8" cy="8" r="1.8" stroke="currentColor" fill="none" strokeWidth="1.2" />
          </svg>
        </button>
        <span className="app-version">v{APP_VERSION}</span>
      </div>

      <input type="file" ref={fileRef} accept="application/json" hidden onChange={onFile} />
    </header>
  );
}
