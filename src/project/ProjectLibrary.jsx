import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, Cloud, CloudDownload, CloudUpload, Copy, EllipsisVertical, HardDrive,
  Eye, FolderOpen, Globe2, LayoutTemplate, Lock, Pencil, Plus, RefreshCw, Search, Trash2, Upload,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { usePopup } from '../components/ui/PopupProvider.jsx';
import { projectStore, projectSyncStore } from './ProjectStore.js';
import { projectApi } from './projectApi.js';
import { buildUnifiedProjectIndex, syncBindingFor } from './projectSync.js';

const visibilityIcons = { private: Lock, unlisted: Eye, public: Globe2 };

function relativeTime(value) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'unknown time';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value));
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('Copying is not supported by this browser.');
}

function projectName(entry) {
  return entry.localProject?.metadata.name ?? entry.cloudProject?.name ?? 'Untitled terrain';
}

function projectDescription(entry) {
  return entry.localProject?.metadata.description || entry.cloudProject?.description || '';
}

export default function ProjectLibrary({
  localProjects,
  bootReady,
  exiting,
  onOpen,
  onCreate,
  onImportFile,
  onRename,
  onDuplicate,
  onDelete,
  projectActionBusy,
  onSignIn,
}) {
  const { user, status: authStatus } = useAuth();
  const { showChoice, showConfirm, showPopup } = usePopup();
  const [cloudProjects, setCloudProjects] = useState([]);
  const [bindings, setBindings] = useState([]);
  const [cloudStatus, setCloudStatus] = useState('idle');
  const [query, setQuery] = useState('');
  const [menuFor, setMenuFor] = useState(null);
  const [busyId, setBusyId] = useState('');
  const fileInputRef = useRef(null);

  const loadBindings = useCallback(async () => {
    setBindings(await projectSyncStore.list());
  }, []);

  const refreshCloud = useCallback(async () => {
    if (!user) {
      setCloudProjects([]);
      setCloudStatus('idle');
      return [];
    }
    setCloudStatus('loading');
    try {
      const result = await projectApi.listMine();
      setCloudProjects(result.projects);
      setCloudStatus('ready');
      return result.projects;
    } catch (error) {
      setCloudStatus('error');
      return [];
    }
  }, [user]);

  useEffect(() => {
    loadBindings();
    window.addEventListener('terrain-project-sync:changed', loadBindings);
    return () => window.removeEventListener('terrain-project-sync:changed', loadBindings);
  }, [loadBindings]);

  useEffect(() => {
    if (user) refreshCloud();
    else {
      setCloudProjects([]);
      setCloudStatus('idle');
    }
  }, [refreshCloud, user]);

  useEffect(() => {
    if (!menuFor) return undefined;
    const close = () => setMenuFor(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuFor]);

  const entries = useMemo(
    () => buildUnifiedProjectIndex({ localProjects, cloudProjects, bindings }),
    [bindings, cloudProjects, localProjects],
  );
  const visibleEntries = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? entries.filter((entry) => `${projectName(entry)} ${projectDescription(entry)}`.toLowerCase().includes(term)) : entries;
  }, [entries, query]);

  const saveBinding = useCallback(async (localProject, cloudProject) => {
    await projectSyncStore.save(syncBindingFor(localProject, cloudProject));
  }, []);

  const download = useCallback(async (entry, { openAfter = false } = {}) => {
    const cloudProject = entry.cloudProject;
    if (!cloudProject || busyId) return null;
    setBusyId(entry.id);
    try {
      const result = await projectApi.getMine(cloudProject.id);
      const remote = result.project;
      const payload = {
        ...remote.data,
        metadata: { ...remote.data.metadata, name: remote.name },
      };
      const localProject = entry.localProject
        ? await projectStore.save({ ...payload, id: entry.localProject.id, metadata: { ...payload.metadata, created: entry.localProject.metadata.created } })
        : await projectStore.importCopy(payload, { name: remote.name });
      await saveBinding(localProject, remote);
      await refreshCloud();
      if (openAfter) onOpen(localProject);
      else showPopup(`${remote.name} downloaded from the cloud.`, { type: 'success' });
      return localProject;
    } catch (error) {
      showPopup(error.message || 'Could not download this project.', { type: 'error' });
      return null;
    } finally {
      setBusyId('');
    }
  }, [busyId, onOpen, refreshCloud, saveBinding, showPopup]);

  const upload = useCallback(async (entry) => {
    const localProject = entry.localProject;
    if (!localProject || busyId) return;
    setBusyId(entry.id);
    try {
      let cloudProject;
      if (entry.cloudProject) {
        const result = await projectApi.update(entry.cloudProject.id, {
          project: localProject,
          name: localProject.metadata.name,
          description: localProject.metadata.description,
          expectedContentRevision: entry.binding?.cloudContentRevision ?? entry.cloudProject.contentRevision,
        });
        cloudProject = result.project;
      } else {
        const result = await projectApi.create({
          project: localProject,
          sourceProjectId: localProject.id,
          name: localProject.metadata.name,
          description: localProject.metadata.description,
          visibility: user?.defaultProjectVisibility,
        });
        cloudProject = result.project;
      }
      await saveBinding(localProject, cloudProject);
      await refreshCloud();
      showPopup(`${localProject.metadata.name} synced to the cloud.`, { type: 'success' });
    } catch (error) {
      if (error.code === 'PROJECT_SYNC_CONFLICT') {
        await refreshCloud();
        showPopup('The cloud copy changed while syncing. Choose a version to continue.', { type: 'info' });
      } else {
        showPopup(error.message || 'Could not sync this project.', { type: 'error' });
      }
    } finally {
      setBusyId('');
    }
  }, [busyId, refreshCloud, saveBinding, showPopup, user?.defaultProjectVisibility]);

  const sync = useCallback(async (entry) => {
    if (!user || busyId) return;
    if (entry.state === 'cloud-only' || entry.state === 'cloud-changes') {
      await download(entry);
      return;
    }
    if (entry.state === 'conflict' || entry.state === 'needs-review') {
      const choice = await showChoice({
        title: entry.state === 'conflict' ? 'Resolve sync conflict' : 'Review cloud copy',
        message: `${projectName(entry)} has versions on this device and in the cloud. Choose the version to keep.`,
        actions: [
          { value: 'local', label: 'Keep local and upload' },
          { value: 'cloud', label: 'Keep cloud and download' },
        ],
      });
      if (choice === 'local') await upload(entry);
      if (choice === 'cloud') await download(entry);
      return;
    }
    if (entry.state === 'synced') {
      await refreshCloud();
      showPopup(`${projectName(entry)} is up to date.`, { type: 'success' });
      return;
    }
    await upload(entry);
  }, [busyId, download, refreshCloud, showChoice, showPopup, upload, user]);

  const openEntry = useCallback(async (entry) => {
    if (entry.localProject) {
      onOpen(entry.localProject);
      return;
    }
    await download(entry, { openAfter: true });
  }, [download, onOpen]);

  const changeVisibility = useCallback(async (entry, visibility) => {
    if (!entry.cloudProject || busyId) return;
    setBusyId(entry.id);
    try {
      await projectApi.update(entry.cloudProject.id, { visibility });
      await refreshCloud();
      showPopup(`${projectName(entry)} is now ${visibility}.`, { type: 'success' });
    } catch (error) {
      showPopup(error.message || 'Could not change project visibility.', { type: 'error' });
    } finally {
      setBusyId('');
      setMenuFor(null);
    }
  }, [busyId, refreshCloud, showPopup]);

  const removeCloudCopy = useCallback(async (entry) => {
    if (!entry.cloudProject || busyId) return;
    const confirmed = await showConfirm({
      title: 'Remove cloud copy?',
      message: `Remove “${projectName(entry)}” from the cloud? Your local project will remain available.`,
      confirmLabel: 'Remove cloud copy',
      danger: true,
    });
    if (!confirmed) return;
    setBusyId(entry.id);
    try {
      await projectApi.remove(entry.cloudProject.id);
      if (entry.localProject) await projectSyncStore.remove(entry.localProject.id);
      await refreshCloud();
      showPopup('Cloud copy removed. Your local project is unchanged.', { type: 'success' });
    } catch (error) {
      showPopup(error.message || 'Could not remove this cloud copy.', { type: 'error' });
    } finally {
      setBusyId('');
      setMenuFor(null);
    }
  }, [busyId, refreshCloud, showConfirm, showPopup]);

  const isCloudUsable = Boolean(user) && cloudStatus === 'ready';
  const empty = visibleEntries.length === 0;

  return (
    <section className="project-library" aria-label="Projects">
      <div className="project-library-head">
        <div className="lp-search project-library-search">
          <Search size={14} aria-hidden />
          <input type="search" placeholder="Search projects…" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search projects" />
        </div>
        <div className="lp-head-actions">
          <button type="button" className="lp-secondary sm" onClick={() => fileInputRef.current?.click()} disabled={!bootReady || exiting}><Upload size={13} /> Import</button>
          <button type="button" className="lp-primary sm" onClick={onCreate} disabled={!bootReady || exiting}><Plus size={14} /> New terrain</button>
        </div>
      </div>

      {!user && authStatus !== 'loading' && (
        <div className="project-cloud-note">
          <Cloud size={16} aria-hidden />
          <span>{authStatus === 'unavailable' ? 'Cloud sync is unavailable right now. Your local projects are safe on this device.' : 'Sign in to sync projects, download cloud copies, and manage sharing visibility.'}</span>
          {authStatus !== 'unavailable' && <button type="button" onClick={onSignIn}>Sign in</button>}
        </div>
      )}
      {user && cloudStatus === 'loading' && <div className="project-cloud-note checking"><RefreshCw size={15} className="spin" aria-hidden /><span>Checking your cloud projects…</span></div>}
      {user && cloudStatus === 'error' && <div className="project-cloud-note error"><AlertTriangle size={16} aria-hidden /><span>Cloud projects could not be checked. Local projects remain available.</span><button type="button" onClick={refreshCloud}>Try again</button></div>}

      {empty ? (
        query.trim() ? <p className="lp-no-results">No project matches “{query.trim()}”.</p> : (
          <div className="lp-empty project-library-empty">
            <FolderOpen size={24} />
            <strong>No projects yet</strong>
            <span>Create a terrain, import a project file, or download a project from the cloud.</span>
            <button type="button" className="lp-primary" onClick={onCreate} disabled={!bootReady || exiting}><Plus size={15} /> Create terrain</button>
          </div>
        )
      ) : (
        <div className="project-library-grid">
          {visibleEntries.map((entry) => {
            const localProject = entry.localProject;
            const cloudProject = entry.cloudProject;
            const VisibilityIcon = visibilityIcons[cloudProject?.visibility] || Lock;
            const isBusy = busyId === entry.id;
            const statusLabel = user && cloudStatus === 'error' && entry.state !== 'cloud-only' ? 'Cloud unavailable' : entry.label;
            const name = projectName(entry);
            const modified = localProject?.metadata.modified ?? cloudProject?.updatedAt;
            const isConflict = entry.state === 'conflict' || entry.state === 'needs-review';
            return (
              <article className={`project-library-card ${entry.state}${menuFor === entry.id ? ' menu-open' : ''}`} key={entry.id}>
                <button type="button" className="project-library-main" onClick={() => openEntry(entry)} disabled={isBusy || !bootReady || exiting || (!localProject && !isCloudUsable)}>
                  <span className="project-library-thumb">
                    {localProject?.metadata.thumbnail ? <img src={localProject.metadata.thumbnail} alt="" /> : localProject ? <LayoutTemplate size={28} /> : <Cloud size={28} />}
                  </span>
                  {localProject && <span className={`lp-template-kind-badge ${localProject.terrain.editorMode}`}>{localProject.terrain.editorMode === 'nodes' ? 'Nodes' : localProject.terrain.editorMode === 'manual' ? 'Manual' : 'Procedural'}</span>}
                  {cloudProject && <span className={`project-library-cloud-badge ${cloudProject.visibility}`} title={`In the cloud · ${cloudProject.visibility}`} aria-label={`In the cloud · ${cloudProject.visibility}`}><Cloud size={12} /><VisibilityIcon size={12} /></span>}
                  <span className="project-library-copy">
                    <strong>{name}</strong>
                    <small className="project-library-time"><Clock size={11} aria-hidden /> Updated {relativeTime(modified)}</small>
                  </span>
                </button>
                <div className="project-library-footer">
                  <span className={`project-library-status icon-only${isConflict ? ' attention' : ''}`} title={statusLabel} aria-label={statusLabel}><span className="project-library-status-icon">{isConflict ? <AlertTriangle size={14} aria-hidden /> : entry.state === 'synced' ? <CheckCircle2 size={14} aria-hidden /> : localProject && !cloudProject ? <HardDrive size={14} aria-hidden /> : <Cloud size={14} aria-hidden />}</span></span>
                  <div className="project-library-actions">
                    <button type="button" className="project-library-sync" onClick={() => sync(entry)} disabled={isBusy || !isCloudUsable} aria-label={`${entry.action} ${name}`}>
                      {isBusy ? <RefreshCw size={13} className="spin" /> : entry.state === 'cloud-only' || entry.state === 'cloud-changes' ? <CloudDownload size={13} /> : <CloudUpload size={13} />}
                      {entry.action}
                    </button>
                    <button type="button" className="project-library-menu-button" aria-label={`Actions for ${name}`} aria-expanded={menuFor === entry.id} onPointerDown={(event) => event.stopPropagation()} onClick={() => setMenuFor((current) => current === entry.id ? null : entry.id)}><EllipsisVertical size={16} /></button>
                  </div>
                </div>
                {menuFor === entry.id && (
                  <div className="project-library-menu" role="menu" onPointerDown={(event) => event.stopPropagation()}>
                    {localProject && <>
                      <button type="button" role="menuitem" onClick={() => { setMenuFor(null); openEntry(entry); }} disabled={!bootReady || exiting}><FolderOpen size={13} /> Open</button>
                      <button type="button" role="menuitem" onClick={() => { setMenuFor(null); onRename(localProject); }} disabled={projectActionBusy}><Pencil size={13} /> Rename</button>
                      <button type="button" role="menuitem" onClick={() => { setMenuFor(null); onDuplicate(localProject); }} disabled={projectActionBusy}><Copy size={13} /> Duplicate</button>
                    </>}
                    {cloudProject && <>
                      <span className="project-library-menu-label">Cloud visibility</span>
                      <div className="project-library-visibility-actions" role="group" aria-label={`Cloud visibility for ${name}`}>
                        {Object.entries(visibilityIcons).map(([visibility, Icon]) => <button key={visibility} type="button" className={cloudProject.visibility === visibility ? 'active' : ''} onClick={() => changeVisibility(entry, visibility)} disabled={isBusy} title={visibility}><Icon size={13} /><span>{visibility}</span></button>)}
                      </div>
                      {cloudProject.visibility !== 'private' && <button type="button" role="menuitem" onClick={() => copyText(cloudProject.shareCode).then(() => showPopup(`Copied ${cloudProject.shareCode}.`, { type: 'success' })).catch((error) => showPopup(error.message, { type: 'error' }))}><Copy size={13} /> Copy sharing code</button>}
                      <button type="button" role="menuitem" className="danger" onClick={() => removeCloudCopy(entry)} disabled={isBusy}><Cloud size={13} /> Remove cloud copy</button>
                    </>}
                    {localProject && <button type="button" role="menuitem" className="danger" onClick={() => { setMenuFor(null); onDelete(localProject); }} disabled={projectActionBusy}><Trash2 size={13} /> Delete local project</button>}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      <input ref={fileInputRef} type="file" accept="application/json" hidden onChange={(event) => { onImportFile(event.target.files?.[0]); event.target.value = ''; }} />
    </section>
  );
}
