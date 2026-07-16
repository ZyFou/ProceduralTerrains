import { useEffect, useRef, useState } from 'react';
import { CircleHelp, Copy, FilePlus2, FolderOpen, Globe2, LayoutTemplate, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { FaGithub, FaXTwitter } from 'react-icons/fa6';
import { APP_NAME, APP_VERSION, AUTHOR_PORTFOLIO_URL, AUTHOR_X_URL, CURSOR_PACK_AUTHOR, CURSOR_PACK_URL, GITHUB_REPO_URL } from '../constants/app.js';
import { projectStats, projectStore, normalizeProject } from '../project/ProjectStore.js';
import { PROJECT_TEMPLATES, getProjectTemplate } from '../project/ProjectTemplates.js';
import { Logo } from './shared.jsx';

const dateLabel = (value) => value ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)) : 'Not saved';

export default function Landing({ exiting, bootReady, onLaunch }) {
  const [projects, setProjects] = useState([]);
  const [view, setView] = useState('projects');
  const [selectedTemplateId, setSelectedTemplateId] = useState('blank');
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [projectActionBusy, setProjectActionBusy] = useState(false);
  const [templatePreviewsReady, setTemplatePreviewsReady] = useState(false);
  const [templateThumbs, setTemplateThumbs] = useState(() => Object.fromEntries(PROJECT_TEMPLATES.map((template) => [template.id, sessionStorage.getItem(`terrain-template-preview:${template.id}`)]).filter(([, image]) => image)));
  const [previewProgress, setPreviewProgress] = useState(() => ({ completed: 0, total: PROJECT_TEMPLATES.length }));
  const [fileDragActive, setFileDragActive] = useState(false);
  const fileDragDepthRef = useRef(0);
  const fileRef = useRef(null);

  useEffect(() => {
    const load = () => projectStore.list().then((items) => {
      setProjects(items);
      setSelectedProjectId((current) => current && items.some((project) => project.id === current) ? current : (items[0]?.id ?? null));
    }).catch(() => setProjects([]));
    load();
    window.addEventListener('terrain-projects:changed', load);
    return () => window.removeEventListener('terrain-projects:changed', load);
  }, []);
  useEffect(() => {
    if (!bootReady) return undefined;
    const onThumbnail = (event) => {
      const { templateId, image } = event.detail ?? {};
      if (templateId && image) setTemplateThumbs((current) => ({ ...current, [templateId]: image }));
    };
    const onPreviewProgress = (event) => setPreviewProgress(event.detail ?? { completed: 0, total: PROJECT_TEMPLATES.length });
    const onPreviewComplete = () => setTemplatePreviewsReady(true);
    window.addEventListener('terrain-template:thumbnail', onThumbnail);
    window.addEventListener('terrain-template:progress', onPreviewProgress);
    window.addEventListener('terrain-template:preload-complete', onPreviewComplete);
    const preloadTimer = window.setTimeout(() => window.dispatchEvent(new Event('terrain-template:preload')), 100);
    return () => { window.removeEventListener('terrain-template:thumbnail', onThumbnail); window.removeEventListener('terrain-template:progress', onPreviewProgress); window.removeEventListener('terrain-template:preload-complete', onPreviewComplete); window.clearTimeout(preloadTimer); };
  }, [bootReady]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  useEffect(() => {
    if (!bootReady || !templatePreviewsReady || view !== 'projects' || !selectedProject) return;
    window.dispatchEvent(new CustomEvent('terrain-project:preview', { detail: { project: selectedProject } }));
  }, [bootReady, selectedProject, templatePreviewsReady, view]);

  const template = getProjectTemplate(selectedTemplateId);
  const inspector = selectedProject ? {
    type: 'project', name: selectedProject.metadata.name, description: selectedProject.metadata.description || 'Local terrain project.', stats: projectStats(selectedProject),
  } : { type: 'template', name: template.name, description: template.description, template };
  const dispatch = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
  const create = (templateId) => {
    if (!bootReady || exiting) return;
    dispatch('terrain-project:new', { templateId });
    onLaunch();
  };
  const open = (project) => {
    if (!bootReady || exiting) return;
    dispatch('terrain-project:open', { project });
    onLaunch();
  };
  const selectTemplate = (id) => { setSelectedTemplateId(id); setSelectedProjectId(null); setView('templates'); dispatch('terrain-template:preview', { templateId: id }); };
  const openTemplates = () => selectTemplate(PROJECT_TEMPLATES[0].id);
  const selectProject = (project) => { setSelectedProjectId(project.id); setView('projects'); };
  const importProjectFile = (file, { openAfter } = {}) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const raw = JSON.parse(reader.result);
        const project = await projectStore.save(normalizeProject(raw.terrain ? raw : { terrain: raw, metadata: { name: file.name.replace(/\.json$/i, '') } }));
        setSelectedProjectId(project.id); setView('projects');
        if (openAfter) open(project);
      } catch { /* invalid files leave the workspace untouched */ }
    };
    reader.readAsText(file);
  };
  const onImport = (event) => {
    const file = event.target.files?.[0];
    importProjectFile(file, { openAfter: true });
    event.target.value = '';
  };
  const hasFileDrag = (e) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const onFileDragEnter = (e) => {
    if (!hasFileDrag(e)) return;
    e.preventDefault();
    fileDragDepthRef.current += 1;
    setFileDragActive(true);
  };
  const onFileDragOver = (e) => {
    if (!hasFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onFileDragLeave = (e) => {
    if (!hasFileDrag(e)) return;
    e.preventDefault();
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
    if (fileDragDepthRef.current === 0) setFileDragActive(false);
  };
  const onFileDrop = (e) => {
    if (!hasFileDrag(e)) return;
    e.preventDefault();
    fileDragDepthRef.current = 0;
    setFileDragActive(false);
    const file = e.dataTransfer.files?.[0];
    importProjectFile(file, { openAfter: false });
  };
  const renameSelectedProject = async () => {
    if (!selectedProject || projectActionBusy) return;
    const nextName = window.prompt('Rename project', selectedProject.metadata.name)?.trim();
    if (!nextName || nextName === selectedProject.metadata.name) return;
    setProjectActionBusy(true);
    try { await projectStore.rename(selectedProject, nextName); } catch { /* the project remains selected */ }
    finally { setProjectActionBusy(false); }
  };
  const duplicateSelectedProject = async () => {
    if (!selectedProject || projectActionBusy) return;
    setProjectActionBusy(true);
    try {
      const copy = await projectStore.duplicate(selectedProject);
      setView('projects');
      setSelectedProjectId(copy.id);
    } catch { /* the original project remains available */ }
    finally { setProjectActionBusy(false); }
  };
  const requestDeleteSelectedProject = () => {
    if (!selectedProject || projectActionBusy) return;
    setDeleteTarget(selectedProject);
  };
  const confirmDeleteProject = async () => {
    if (!deleteTarget || projectActionBusy) return;
    setProjectActionBusy(true);
    try {
      await projectStore.remove(deleteTarget.id);
      setSelectedProjectId(null);
    } catch { /* the project remains available */ }
    finally { setProjectActionBusy(false); setDeleteTarget(null); }
  };

  return (
    <div
      className={`landing landing-overlay landing-workspace${view === 'templates' || selectedProject ? ' has-live-terrain' : ''}${exiting ? ' exiting' : ''}`}
      onDragEnter={onFileDragEnter}
      onDragOver={onFileDragOver}
      onDragLeave={onFileDragLeave}
      onDrop={onFileDrop}
    >
      {fileDragActive && (
        <div className="file-drop-overlay" role="presentation">
          <div className="file-drop-card">
            <Upload size={28} aria-hidden />
            <span>Drop terrain file to add it to your projects</span>
          </div>
        </div>
      )}
      <header className="landing-workspace-topbar">
        <button type="button" className="landing-workspace-brand" onClick={() => { setView('projects'); setSelectedProjectId(projects[0]?.id ?? null); }} title="Return to main menu"><Logo size={23} /><strong>{APP_NAME}</strong></button>
        <nav className="landing-workspace-tabs" aria-label="Project workspace">
          <button type="button" className={view === 'projects' ? 'active' : ''} onClick={() => { setView('projects'); setSelectedProjectId(projects[0]?.id ?? null); }}>Projects</button>
          <button type="button" className={view === 'templates' ? 'active' : ''} onClick={openTemplates}>Templates</button>
        </nav>
        <div className="landing-workspace-top-actions"><button type="button" onClick={() => fileRef.current?.click()} disabled={!bootReady || exiting}><Upload size={15} /> Import</button><button type="button" className="landing-mobile-credits-trigger" onClick={() => setCreditsOpen(true)} aria-label="Open credits and links" title="Credits and links"><CircleHelp size={18} /></button><span>v{APP_VERSION}</span><a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer" title="Open GitHub repository" aria-label="Open GitHub repository"><FaGithub size={16} /></a></div>
      </header>

      <div className="landing-workspace-body">
        <aside className="landing-workspace-sidebar">
          <div className="landing-sidebar-section">
            <span className="landing-sidebar-label">Create</span>
            <button type="button" className="landing-create-button" onClick={() => create('blank')} disabled={!bootReady || exiting}><Plus size={17} /> New terrain</button>
          </div>
          <div className="landing-sidebar-section landing-sidebar-templates">
            <span className="landing-sidebar-label">Templates</span>
            {PROJECT_TEMPLATES.map((item) => <button type="button" className={selectedTemplateId === item.id && !selectedProject ? 'selected' : ''} key={item.id} onClick={() => selectTemplate(item.id)}>{templateThumbs[item.id] ? <img src={templateThumbs[item.id]} alt="" /> : <LayoutTemplate size={15} />}<span><strong>{item.name}</strong><small>{item.description}</small></span></button>)}
          </div>
          <div className="landing-sidebar-footer"><button type="button" onClick={() => { setView('projects'); setSelectedProjectId(projects[0]?.id ?? null); }}><FolderOpen size={16} /> Open project</button><button type="button" onClick={() => fileRef.current?.click()}><Upload size={16} /> Import JSON</button></div>
          <div className="landing-sidebar-credits">
            <button type="button" onClick={() => setCreditsOpen(true)}>Credits</button>
            <div className="landing-sidebar-socials"><a href={AUTHOR_X_URL} target="_blank" rel="noopener noreferrer" aria-label="Open X profile" title="X"><FaXTwitter size={14} /></a><a href={AUTHOR_PORTFOLIO_URL} target="_blank" rel="noopener noreferrer" aria-label="Open portfolio" title="Portfolio"><Globe2 size={15} /></a></div>
          </div>
        </aside>

        <main className={`landing-workspace-main${view === 'templates' ? ' landing-workspace-templates' : ''}`}>
          {view === 'projects' ? <>
            <div className="landing-main-heading"><div><span>Workspace</span><h1>Recent projects</h1></div><button type="button" onClick={() => create('blank')} disabled={!bootReady || exiting}><FilePlus2 size={16} /> New terrain</button></div>
            {projects.length ? <div className="landing-project-table" role="list">
              <div className="landing-project-table-head"><span>Name</span><span>Template</span><span>Last modified</span></div>
              {projects.map((project) => { const stats = projectStats(project); return <button type="button" role="listitem" className={project.id === selectedProjectId ? 'selected' : ''} key={project.id} onClick={() => selectProject(project)} onDoubleClick={() => open(project)}><span className="landing-project-name">{project.metadata.thumbnail ? <img src={project.metadata.thumbnail} alt="" /> : <FolderOpen size={19} />}<strong>{project.metadata.name}</strong></span><span>{project.metadata.tags[0] ?? 'Terrain'}</span><span>{dateLabel(project.metadata.modified)}</span></button>; })}
            </div> : <div className="landing-empty-workspace"><FolderOpen size={30} /><strong>No projects yet</strong><span>Create a terrain from a template or import an existing project.</span><button type="button" onClick={() => create('blank')} disabled={!bootReady || exiting}>Create terrain</button></div>}
          </> : <>
            <div className="landing-main-heading"><div><span>Workspace</span><h1>Terrain templates</h1></div></div>
            <div className="landing-template-grid">{PROJECT_TEMPLATES.map((item) => <button type="button" key={item.id} className={item.id === selectedTemplateId ? 'selected' : ''} onClick={() => selectTemplate(item.id)}>{templateThumbs[item.id] ? <img src={templateThumbs[item.id]} alt="" /> : <LayoutTemplate size={20} />}<strong>{item.name}</strong><span>{item.description}</span></button>)}</div>
            <button type="button" className="landing-mobile-template-start" onClick={() => create(template.id)} disabled={!bootReady || exiting}><FilePlus2 size={16} /> Create {template.name} terrain</button>
            </>}
          <footer className="landing-mobile-credits">
            <button type="button" onClick={() => setCreditsOpen(true)}>Credits</button>
            <div className="landing-sidebar-socials"><a href={AUTHOR_X_URL} target="_blank" rel="noopener noreferrer" aria-label="Open X profile" title="X"><FaXTwitter size={14} /></a><a href={AUTHOR_PORTFOLIO_URL} target="_blank" rel="noopener noreferrer" aria-label="Open portfolio" title="Portfolio"><Globe2 size={15} /></a></div>
          </footer>
        </main>

        <aside className="landing-workspace-inspector">
          <div className="landing-inspector-heading"><span>Inspector</span><h2>{inspector.name}</h2></div>
          <div className="landing-inspector-icon">{inspector.type === 'template' && templateThumbs[inspector.template.id] ? <img src={templateThumbs[inspector.template.id]} alt="" /> : (inspector.type === 'project' && selectedProject.metadata.thumbnail ? <img src={selectedProject.metadata.thumbnail} alt="" /> : (inspector.type === 'project' ? <FolderOpen size={30} /> : <LayoutTemplate size={30} />))}</div>
          <dl className="landing-inspector-details">
            <div><dt>{inspector.type === 'project' ? 'Project' : 'Template'}</dt><dd>{inspector.type === 'project' ? (inspector.stats.seed != null ? `Seed ${inspector.stats.seed}` : 'Terrain project') : inspector.template.name}</dd></div>
            <div><dt>Description</dt><dd>{inspector.description}</dd></div>
            {inspector.type === 'project' && <><div><dt>World size</dt><dd>{inspector.stats.worldSize ? `${Math.round(inspector.stats.worldSize / 1000)} km` : '—'}</dd></div><div><dt>Last modified</dt><dd>{dateLabel(selectedProject.metadata.modified)}</dd></div></>}
          </dl>
          <div className="landing-inspector-actions">
            <button type="button" className="landing-inspector-action" onClick={() => inspector.type === 'project' ? open(selectedProject) : create(inspector.template.id)} disabled={!bootReady || exiting}>{inspector.type === 'project' ? 'Open project' : 'Start project'}</button>
            {inspector.type === 'project' && <div className="landing-inspector-manage-actions">
              <button type="button" className="landing-inspector-tool-action" onClick={renameSelectedProject} disabled={projectActionBusy} title="Rename project"><Pencil size={14} /> Rename</button>
              <button type="button" className="landing-inspector-tool-action" onClick={duplicateSelectedProject} disabled={projectActionBusy} title="Duplicate project"><Copy size={14} /> Duplicate</button>
              <button type="button" className="landing-inspector-tool-action danger" onClick={requestDeleteSelectedProject} disabled={projectActionBusy} title="Delete project"><Trash2 size={14} /> Delete</button>
            </div>}
          </div>
        </aside>
      </div>
      {(!bootReady || previewProgress.completed < previewProgress.total) && <div className="landing-preview-loader" role="status"><span className="landing-preview-spinner" aria-hidden="true" /><strong>{bootReady ? 'Rendering terrain previews' : 'Starting terrain editor'}</strong><small>{bootReady ? `${previewProgress.completed} of ${previewProgress.total} real previews ready` : 'Preparing your random terrain workspace…'}</small></div>}
      {creditsOpen && <div className="landing-credits-backdrop" role="presentation" onMouseDown={() => setCreditsOpen(false)}><section className="landing-credits-dialog" role="dialog" aria-modal="true" aria-labelledby="credits-title" onMouseDown={(event) => event.stopPropagation()}><div><span>Credits</span><h2 id="credits-title">Cursor theme</h2></div><p>The editor cursor set is based on the Windows 11 Light Theme cursor pack by <strong>{CURSOR_PACK_AUTHOR}</strong>.</p><a href={CURSOR_PACK_URL} target="_blank" rel="noopener noreferrer">View cursor pack</a><div className="landing-credits-socials"><a href={AUTHOR_X_URL} target="_blank" rel="noopener noreferrer"><FaXTwitter size={14} /> X / Twitter</a><a href={AUTHOR_PORTFOLIO_URL} target="_blank" rel="noopener noreferrer"><Globe2 size={14} /> Portfolio</a></div><button type="button" onClick={() => setCreditsOpen(false)}>Close</button></section></div>}
      {deleteTarget && <div className="landing-credits-backdrop" role="presentation" onMouseDown={() => !projectActionBusy && setDeleteTarget(null)}>
        <section className="landing-credits-dialog landing-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-project-title" onMouseDown={(event) => event.stopPropagation()}>
          <div><span>Delete project</span><h2 id="delete-project-title">Delete &ldquo;{deleteTarget.metadata.name}&rdquo;?</h2></div>
          <p>This cannot be undone.</p>
          <div className="landing-confirm-actions">
            <button type="button" onClick={() => setDeleteTarget(null)} disabled={projectActionBusy}>Cancel</button>
            <button type="button" className="danger" onClick={confirmDeleteProject} disabled={projectActionBusy}><Trash2 size={14} /> Delete</button>
          </div>
        </section>
      </div>}
      <nav className="landing-mobile-nav" aria-label="Mobile workspace navigation">
        <button type="button" className={view === 'projects' ? 'active' : ''} onClick={() => { setView('projects'); setSelectedProjectId(projects[0]?.id ?? null); }}><FolderOpen size={19} /><span>Projects</span></button>
        <button type="button" className="landing-mobile-nav-create" onClick={() => create(view === 'templates' ? template.id : 'blank')} disabled={!bootReady || exiting}><span><Plus size={22} /></span><b>{view === 'templates' ? 'Use template' : 'Create'}</b></button>
        <button type="button" className={view === 'templates' ? 'active' : ''} onClick={openTemplates}><LayoutTemplate size={19} /><span>Templates</span></button>
      </nav>
      <input ref={fileRef} type="file" accept="application/json" hidden onChange={onImport} />
    </div>
  );
}
