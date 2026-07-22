import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Cloud, CloudUpload, Copy, Eye, FolderOpen, Globe2, KeyRound, Lock, Pencil, Trash2 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { projectStore } from './ProjectStore.js';
import { projectApi } from './projectApi.js';
import { usePopup } from '../components/ui/PopupProvider.jsx';

const visibilityIcon = { private: Lock, unlisted: Eye, public: Globe2 };

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

export default function CloudProjectsPanel({ localProjects, onOpen, refreshToken = 0 }) {
  const { user } = useAuth();
  const { showPopup, showConfirm, showPrompt } = usePopup();
  const [projects, setProjects] = useState([]);
  const [selectedLocalId, setSelectedLocalId] = useState(localProjects[0]?.id ?? '');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');

  const refresh = useCallback(async () => {
    if (!user) {
      setProjects([]);
      return;
    }
    setLoading(true);
    try {
      const result = await projectApi.listMine();
      setProjects(result.projects);
    } catch (requestError) {
      showPopup(requestError.message || 'Could not load cloud projects.', { type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [showPopup, user]);

  useEffect(() => { refresh(); }, [refresh, refreshToken]);
  useEffect(() => {
    if (!localProjects.some((project) => project.id === selectedLocalId)) setSelectedLocalId(localProjects[0]?.id ?? '');
  }, [localProjects, selectedLocalId]);

  const selectedLocal = useMemo(
    () => localProjects.find((project) => project.id === selectedLocalId) ?? null,
    [localProjects, selectedLocalId],
  );
  const selectedCloud = projects.find((project) => project.sourceProjectId === selectedLocal?.id) ?? null;

  const sync = async () => {
    if (!selectedLocal || busy) return;
    setBusy('sync');
    try {
      if (selectedCloud) {
        await projectApi.update(selectedCloud.id, {
          project: selectedLocal,
          name: selectedLocal.metadata.name,
          description: selectedLocal.metadata.description,
        });
        showPopup(`${selectedLocal.metadata.name} updated in the cloud.`, { type: 'success' });
      } else {
        await projectApi.create({
          project: selectedLocal,
          sourceProjectId: selectedLocal.id,
          name: selectedLocal.metadata.name,
          description: selectedLocal.metadata.description,
          visibility: user.defaultProjectVisibility,
        });
        showPopup(`${selectedLocal.metadata.name} added to your cloud projects.`, { type: 'success' });
      }
      await refresh();
    } catch (requestError) {
      showPopup(requestError.message || 'Could not sync this project.', { type: 'error' });
    } finally {
      setBusy('');
    }
  };

  const openCloud = async (cloudProject) => {
    setBusy(cloudProject.id);
    try {
      const result = await projectApi.getMine(cloudProject.id);
      const imported = await projectStore.importCopy(result.project.data, { name: result.project.name });
      onOpen(imported);
    } catch (requestError) {
      showPopup(requestError.message || 'Could not open this cloud project.', { type: 'error' });
    } finally {
      setBusy('');
    }
  };

  const updateVisibility = async (cloudProject, visibility) => {
    setBusy(cloudProject.id);
    try {
      await projectApi.update(cloudProject.id, { visibility });
      await refresh();
      showPopup(`${cloudProject.name} is now ${visibility}.`, { type: 'success' });
    } catch (requestError) {
      showPopup(requestError.message || 'Could not change project visibility.', { type: 'error' });
    } finally {
      setBusy('');
    }
  };

  const rename = async (cloudProject) => {
    const name = (await showPrompt({ title: 'Rename cloud project', inputLabel: 'Project name', initialValue: cloudProject.name, confirmLabel: 'Rename', maxLength: 120 }))?.trim();
    if (!name || name === cloudProject.name) return;
    setBusy(cloudProject.id);
    try {
      await projectApi.update(cloudProject.id, { name });
      await refresh();
    } catch (requestError) {
      showPopup(requestError.message || 'Could not rename this project.', { type: 'error' });
    } finally {
      setBusy('');
    }
  };

  const rotateCode = async (cloudProject) => {
    const confirmed = await showConfirm({
      title: 'Replace sharing code?',
      message: `Existing links to “${cloudProject.name}” will stop working.`,
      confirmLabel: 'Replace code',
      danger: true,
    });
    if (!confirmed) return;
    setBusy(cloudProject.id);
    try {
      const result = await projectApi.rotateShareCode(cloudProject.id);
      await refresh();
      showPopup(`New sharing code: ${result.shareCode}`, { type: 'success' });
    } catch (requestError) {
      showPopup(requestError.message || 'Could not replace the sharing code.', { type: 'error' });
    } finally {
      setBusy('');
    }
  };

  const remove = async (cloudProject) => {
    const confirmed = await showConfirm({
      title: 'Delete cloud project?',
      message: `Delete “${cloudProject.name}” from your cloud projects? Your local copy is not affected.`,
      confirmLabel: 'Delete project',
      danger: true,
    });
    if (!confirmed) return;
    setBusy(cloudProject.id);
    try {
      await projectApi.remove(cloudProject.id);
      await refresh();
      showPopup('Cloud project deleted.', { type: 'success' });
    } catch (requestError) {
      showPopup(requestError.message || 'Could not delete this cloud project.', { type: 'error' });
    } finally {
      setBusy('');
    }
  };

  if (!user) {
    return <section className="cloud-projects-panel"><div className="cloud-projects-guest"><Cloud size={20} /><strong>Your cloud projects</strong><span>Sign in to sync terrains and share them with a code.</span></div></section>;
  }

  return (
    <section className="cloud-projects-panel" aria-label="Cloud projects">
      <div className="cloud-sync-bar">
        <select value={selectedLocalId} onChange={(event) => setSelectedLocalId(event.target.value)} disabled={!localProjects.length || !!busy} aria-label="Local project to sync">
          {!localProjects.length && <option value="">No local projects</option>}
          {localProjects.map((project) => <option key={project.id} value={project.id}>{project.metadata.name}</option>)}
        </select>
        <button type="button" className="lp-primary sm" onClick={sync} disabled={!selectedLocal || !!busy}><CloudUpload size={14} /> {selectedCloud ? 'Update cloud copy' : 'Sync to cloud'}</button>
      </div>

      {loading ? <p className="cloud-loading">Loading cloud projects…</p> : projects.length === 0 ? <div className="cloud-empty"><Cloud size={20} /><span>No cloud projects yet. Sync one of your local terrains above.</span></div> : (
        <div className="cloud-project-list">
          {projects.map((project) => {
            const VisibilityIcon = visibilityIcon[project.visibility] || Lock;
            const disabled = busy === project.id;
            return (
              <article className="cloud-project-row" key={project.id}>
                <button type="button" className="cloud-project-main" onClick={() => openCloud(project)} disabled={disabled}>
                  <span className={`cloud-visibility-icon ${project.visibility}`}><VisibilityIcon size={15} /></span>
                  <span><strong>{project.name}</strong><small>Updated {new Date(project.updatedAt).toLocaleDateString()}</small></span>
                </button>
                <select value={project.visibility} onChange={(event) => updateVisibility(project, event.target.value)} disabled={disabled} aria-label={`Visibility for ${project.name}`}>
                  <option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option>
                </select>
                <code title="Sharing code">{project.shareCode}</code>
                <div className="cloud-project-actions">
                  <button type="button" onClick={() => openCloud(project)} disabled={disabled} title="Open as a local copy" aria-label={`Open ${project.name}`}><FolderOpen size={13} /></button>
                  <button type="button" onClick={() => copyText(project.shareCode).then(() => showPopup(`Copied ${project.shareCode}.`, { type: 'success' })).catch((copyError) => showPopup(copyError.message, { type: 'error' }))} disabled={disabled || project.visibility === 'private'} title={project.visibility === 'private' ? 'Make the project unlisted or public to share it' : 'Copy sharing code'} aria-label={`Copy sharing code for ${project.name}`}><Copy size={13} /></button>
                  <button type="button" onClick={() => rotateCode(project)} disabled={disabled} title="Replace sharing code" aria-label={`Replace sharing code for ${project.name}`}><KeyRound size={13} /></button>
                  <button type="button" onClick={() => rename(project)} disabled={disabled} title="Rename" aria-label={`Rename ${project.name}`}><Pencil size={13} /></button>
                  <button type="button" className="danger" onClick={() => remove(project)} disabled={disabled} title="Delete cloud project" aria-label={`Delete ${project.name}`}><Trash2 size={13} /></button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
