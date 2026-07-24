import React, { useEffect, useRef, useState } from 'react';
import {
  Clock3,
  Boxes,
  Download,
  Eye,
  EyeOff,
  FileText,
  FolderOpen,
  HelpCircle,
  LayoutTemplate,
  Mountain,
  Dices,
  Redo2,
  RotateCcw,
  Save,
  Search,
  Settings,
  Undo2,
} from 'lucide-react';
import { APP_NAME, APP_VERSION } from '../constants/app.js';
import { EDITOR_SHORTCUTS, matchesShortcut, SEARCH_SETTINGS_SHORTCUT, shortcutText } from '../keyboardShortcuts.js';
import NotificationCenter from './ui/Toast.jsx';
import ShortcutHint from './ui/ShortcutHint.jsx';

const Icon = ({ d, viewBox = '0 0 16 16', fill }) => (
  <svg viewBox={viewBox}>
    {Array.isArray(d)
      ? d.map((p, i) => <path key={i} d={p} stroke="currentColor" fill={fill ?? 'none'} strokeWidth="1.2" />)
      : <path d={d} stroke="currentColor" fill={fill ?? 'none'} strokeWidth="1.2" />}
  </svg>
);

const Caret = () => (
  <svg className="tb-file-caret" viewBox="0 0 12 12" aria-hidden>
    <path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function TopBar({
  projectMode = 'procedural',
  shortcutsEnabled = true,
  projectName = 'Untitled terrain',
  onProjectNameChange,
  previewMode, onNew, onRandomize, onSave, onLoadJSON, onDownload,
  onTogglePreview, onToggleHelp, onResetView,
  nodeToolsVisible = true, onToggleNodeTools,
  onOpenPanel, activePanel,
  loading, onOpenSettingsSearch, settingsSearchOpen,
  onUndo, onRedo, canUndo, canRedo,
  onOpenHistory, onOpenProjects,
  onOpenUiSettings,
  recentNotifications = [],
  notificationsIgnored = false,
  onClearNotifications,
  onToggleNotificationLogging,
}) {
  const fileRef = useRef(null);
  const fileMenuRef = useRef(null);
  const editMenuRef = useRef(null);
  const viewMenuRef = useRef(null);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [editMenuOpen, setEditMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const shortcutActionsRef = useRef({});

  shortcutActionsRef.current = shortcutsEnabled ? {
    newTerrain: onNew,
    projects: onOpenProjects,
    save: onSave,
    load: () => fileRef.current?.click(),
    download: onDownload,
    settings: onOpenUiSettings,
    randomSeed: projectMode === 'procedural' ? onRandomize : null,
  } : {};

  const anyMenuOpen = fileMenuOpen || editMenuOpen || viewMenuOpen;

  const closeAllMenus = () => {
    setFileMenuOpen(false);
    setEditMenuOpen(false);
    setViewMenuOpen(false);
  };

  useEffect(() => {
    if (!anyMenuOpen) return undefined;

    const onPointerDown = (event) => {
      const t = event.target;
      if (!fileMenuRef.current?.contains(t)) setFileMenuOpen(false);
      if (!editMenuRef.current?.contains(t)) setEditMenuOpen(false);
      if (!viewMenuRef.current?.contains(t)) setViewMenuOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeAllMenus();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [anyMenuOpen]);

  useEffect(() => {
    const onShortcut = (event) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;

      const entry = Object.entries(EDITOR_SHORTCUTS).find(([actionId, shortcut]) => (
        shortcutActionsRef.current[actionId] && matchesShortcut(event, shortcut)
      ));
      if (!entry) return;

      event.preventDefault();
      setFileMenuOpen(false);
      setEditMenuOpen(false);
      setViewMenuOpen(false);
      shortcutActionsRef.current[entry[0]]?.();
    };

    document.addEventListener('keydown', onShortcut, true);
    return () => document.removeEventListener('keydown', onShortcut, true);
  }, []);

  useEffect(() => {
    if (shortcutsEnabled) return;
    setFileMenuOpen(false);
    setEditMenuOpen(false);
    setViewMenuOpen(false);
  }, [shortcutsEnabled]);

  const runMenuAction = (closeFn, action) => {
    closeFn(false);
    action?.();
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

  const openOnly = (which) => {
    setFileMenuOpen(which === 'file');
    setEditMenuOpen(which === 'edit');
    setViewMenuOpen(which === 'view');
  };

  return (
    <header id="topbar" className={anyMenuOpen ? 'file-menu-open' : ''}>
      <div className="tb-group tb-left">
        <button type="button" className="tb-group tb-brand tb-brand-button tb-btn" onClick={onOpenProjects} title="Return to main menu">
          <svg className="logo" viewBox="0 0 24 24" fill="none">
            <path d="M3 18 L9 7 L13 13 L16 9 L21 18 Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <circle cx="17.5" cy="5.5" r="1.6" fill="currentColor" />
          </svg>
          <span className="app-name">{APP_NAME}</span>
        </button>

        <div className="tb-dropdown" ref={fileMenuRef}>
          <button
            type="button"
            className={`tb-btn tb-menu-btn${fileMenuOpen ? ' active' : ''}`}
            onClick={() => openOnly(fileMenuOpen ? null : 'file')}
            title="File"
            aria-haspopup="menu"
            aria-expanded={fileMenuOpen}
          >
            <span className="tb-text">File</span>
            <Caret />
          </button>
          <div className={`tb-menu tb-menu-with-shortcuts${fileMenuOpen ? ' open' : ''}`} role="menu" aria-label="File">
            <label className="tb-project-name-field">
              <span>Project name</span>
              <input
                type="text"
                value={projectName}
                maxLength={120}
                aria-label="Project name"
                onChange={(event) => onProjectNameChange?.(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  runMenuAction(setFileMenuOpen, onSave);
                }}
              />
            </label>
            <div className="tb-menu-divider" role="separator" />
            <button type="button" role="menuitem" onClick={() => runMenuAction(setFileMenuOpen, onNew)}>
              <FileText size={14} strokeWidth={1.75} aria-hidden /> New terrain
              <ShortcutHint shortcut={EDITOR_SHORTCUTS.newTerrain} className="tb-menu-shortcut" />
            </button>
            <button type="button" role="menuitem" onClick={() => runMenuAction(setFileMenuOpen, onOpenProjects)}>
              <FolderOpen size={14} strokeWidth={1.75} aria-hidden /> Projects
              <ShortcutHint shortcut={EDITOR_SHORTCUTS.projects} className="tb-menu-shortcut" />
            </button>
            <div className="tb-menu-divider" role="separator" />
            <button type="button" role="menuitem" onClick={() => runMenuAction(setFileMenuOpen, onSave)}>
              <Save size={14} strokeWidth={1.75} aria-hidden /> Save
              <ShortcutHint shortcut={EDITOR_SHORTCUTS.save} className="tb-menu-shortcut" />
            </button>
            <button type="button" role="menuitem" onClick={() => runMenuAction(setFileMenuOpen, () => fileRef.current?.click())}>
              <Icon d={['M2 4h4l1.5 2H14v7H2z', 'M8 12V8M8 8l-1.7 1.7M8 8l1.7 1.7']} /> Load
              <ShortcutHint shortcut={EDITOR_SHORTCUTS.load} className="tb-menu-shortcut" />
            </button>
            <button type="button" role="menuitem" onClick={() => runMenuAction(setFileMenuOpen, onDownload)}>
              <Download size={14} strokeWidth={1.75} aria-hidden /> Download
              <ShortcutHint shortcut={EDITOR_SHORTCUTS.download} className="tb-menu-shortcut" />
            </button>
          </div>
        </div>

        <div className="tb-dropdown" ref={editMenuRef}>
          <button
            type="button"
            className={`tb-btn tb-menu-btn${editMenuOpen ? ' active' : ''}`}
            onClick={() => openOnly(editMenuOpen ? null : 'edit')}
            title="Edit"
            aria-haspopup="menu"
            aria-expanded={editMenuOpen}
          >
            <span className="tb-text">Edit</span>
            <Caret />
          </button>
          <div className={`tb-menu tb-menu-with-shortcuts${editMenuOpen ? ' open' : ''}`} role="menu" aria-label="Edit">
            <div className="tb-menu-section-label">Layout</div>
            <button type="button" role="menuitem" disabled title="Preset options will be added next">
              <LayoutTemplate size={14} strokeWidth={1.75} aria-hidden /> Default layout
            </button>
            <button type="button" role="menuitem" disabled title="Preset options will be added next">
              <LayoutTemplate size={14} strokeWidth={1.75} aria-hidden /> Modular layout
            </button>
            <div className="tb-menu-divider" role="separator" />
            <button
              type="button"
              role="menuitem"
              onClick={() => runMenuAction(setEditMenuOpen, () => onOpenUiSettings?.())}
            >
              <Settings size={14} strokeWidth={1.75} aria-hidden /> Settings
              <ShortcutHint shortcut={EDITOR_SHORTCUTS.settings} className="tb-menu-shortcut" />
            </button>
            {projectMode === 'procedural' ? <>
              <div className="tb-menu-divider" role="separator" />
              <button
                type="button"
                role="menuitem"
                onClick={() => runMenuAction(setEditMenuOpen, onRandomize)}
              >
                <Dices size={14} strokeWidth={1.75} aria-hidden /> Random seed
                <ShortcutHint shortcut={EDITOR_SHORTCUTS.randomSeed} className="tb-menu-shortcut" />
              </button>
            </> : null}
          </div>
        </div>

        <div className="tb-dropdown" ref={viewMenuRef}>
          <button
            type="button"
            className={`tb-btn tb-menu-btn${viewMenuOpen ? ' active' : ''}`}
            onClick={() => openOnly(viewMenuOpen ? null : 'view')}
            title="View"
            aria-haspopup="menu"
            aria-expanded={viewMenuOpen}
          >
            <span className="tb-text">View</span>
            <Caret />
          </button>
          <div className={`tb-menu${viewMenuOpen ? ' open' : ''}`} role="menu" aria-label="View">
            <button type="button" role="menuitem" onClick={() => runMenuAction(setViewMenuOpen, onResetView)}>
              <RotateCcw size={14} strokeWidth={1.75} aria-hidden /> Reset camera
            </button>
            <button type="button" role="menuitem" onClick={() => runMenuAction(setViewMenuOpen, onTogglePreview)}>
              {previewMode
                ? <><Eye size={14} strokeWidth={1.75} aria-hidden /> Show UI</>
                : <><EyeOff size={14} strokeWidth={1.75} aria-hidden /> Hide UI</>}
            </button>
            {projectMode === 'nodes' ? <>
              <div className="tb-menu-divider" role="separator" />
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={nodeToolsVisible}
                className={nodeToolsVisible ? 'active' : ''}
                title="Show water, colors, clouds, lighting, export, and other standard tools"
                onClick={() => runMenuAction(setViewMenuOpen, onToggleNodeTools)}
              >
                {nodeToolsVisible ? <Eye size={14} strokeWidth={1.75} aria-hidden /> : <EyeOff size={14} strokeWidth={1.75} aria-hidden />}
                Other tools
              </button>
            </> : null}
          </div>
        </div>

        <div className="tb-history" role="group" aria-label="History">
          <button className="tb-btn tb-icon-btn" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
            <Undo2 size={14} strokeWidth={1.75} aria-hidden />
          </button>
          <button
            className={`tb-btn tb-icon-btn${activePanel === 'history' ? ' active' : ''}`}
            onClick={onOpenHistory}
            title="Creator history"
            aria-label="Creator history"
          >
            <Clock3 size={14} strokeWidth={1.75} aria-hidden />
          </button>
          <button className="tb-btn tb-icon-btn" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Y)" aria-label="Redo">
            <Redo2 size={14} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </div>

      <div className="tb-group tb-center">
        {loading && (
          <span className="tb-loading" title={loading.detail || loading.label}>
            <svg viewBox="0 0 24 24" width="14" height="14" className="tb-spin" aria-hidden>
              <circle cx="12" cy="12" r="9" fill="none" stroke="var(--border-subtle)" strokeWidth="2.5" />
              <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <span className="tb-text">{loading.label}</span>
          </span>
        )}
        {projectMode === 'nodes' ? (
          <span className="tb-workspace-pill"><Boxes size={13} aria-hidden /> Nodes workspace</span>
        ) : projectMode === 'manual' ? (
          <span className="tb-workspace-pill"><Mountain size={13} aria-hidden /> Manual Terrain</span>
        ) : (
          <button
            type="button"
            className={`tb-btn tb-search-btn${settingsSearchOpen ? ' active' : ''}`}
            onClick={onOpenSettingsSearch}
            title={`Search settings (${shortcutText(SEARCH_SETTINGS_SHORTCUT)})`}
            aria-pressed={settingsSearchOpen}
          >
            <Search size={13} strokeWidth={1.75} aria-hidden />
            <span className="tb-text">Search settings</span>
            <ShortcutHint shortcut={SEARCH_SETTINGS_SHORTCUT} className="tb-shortcut" />
          </button>
        )}
      </div>

      <div className="tb-group tb-right">
        <NotificationCenter
          recent={recentNotifications}
          notificationsIgnored={notificationsIgnored}
          onClear={onClearNotifications}
          onToggleIgnore={onToggleNotificationLogging}
        />
        <button
          className={`tb-btn primary${activePanel === 'export' ? ' active' : ''}`}
          onClick={() => onOpenPanel('export')}
          title="Export the scene"
        >
          <Download size={14} strokeWidth={1.75} aria-hidden />
          <span className="tb-text">Export</span>
        </button>
        <button className="tb-btn tb-icon-btn" onClick={onToggleHelp} title="Show controls help" aria-label="Help">
          <HelpCircle size={14} strokeWidth={1.75} aria-hidden />
        </button>
        <span className="app-version">v{APP_VERSION}</span>
      </div>

      <input type="file" ref={fileRef} accept="application/json" hidden onChange={onFile} />
    </header>
  );
}
