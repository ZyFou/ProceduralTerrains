import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Boxes, CircleHelp, Clock, Copy, EllipsisVertical, FilePlus2, FolderOpen, Globe2, Layers3, LayoutTemplate, LogIn, LogOut, Mail, Mountain, Orbit, Pencil, Plus, RefreshCw, Route, Search, SlidersHorizontal, SquareArrowOutUpRight, Trash2, Upload, UserPlus, UserRound, Waves, X } from 'lucide-react';
import { FaGithub, FaXTwitter } from 'react-icons/fa6';
import { APP_NAME, APP_VERSION, AUTHOR_PORTFOLIO_URL, AUTHOR_X_URL, CURSOR_PACK_AUTHOR, CURSOR_PACK_URL, GITHUB_REPO_URL } from '../constants/app.js';
import { projectStore, normalizeProject } from '../project/ProjectStore.js';
import { PROJECT_TEMPLATES, getProjectTemplate, projectTemplatePreviewCacheKey } from '../project/ProjectTemplates.js';
import { NODE_PROJECT_TEMPLATES, getNodeProjectTemplate, nodeTemplatePreviewCacheKey } from '../project/NodeProjectTemplates.js';
import { Logo } from './shared.jsx';
import AuthPage from '../auth/AuthPage.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { avatarUrl } from '../auth/authApi.js';
import ProfilePage from '../auth/ProfilePage.jsx';
import CloudProjectsPanel from '../project/CloudProjectsPanel.jsx';
import CommunityPage from '../project/CommunityPage.jsx';
import { usePopup } from '../components/ui/PopupProvider.jsx';

const NODE_TEMPLATE_ICONS = { boxes: Boxes, mountain: Mountain, layers: Layers3, waves: Waves, orbit: Orbit, route: Route };
const AUTH_VIEWS = new Set(['login', 'register']);
const HASH_VIEWS = new Set(['login', 'register', 'profile', 'community']);

function viewFromHash() {
  const value = window.location.hash.replace(/^#\/?/, '').toLowerCase();
  return HASH_VIEWS.has(value) ? value : null;
}

function initialTemplateThumbs() {
  const entries = [];
  for (const template of PROJECT_TEMPLATES) {
    const image = sessionStorage.getItem(projectTemplatePreviewCacheKey(template.id));
    if (image) entries.push([template.id, image]);
  }
  for (const template of NODE_PROJECT_TEMPLATES) {
    const image = sessionStorage.getItem(nodeTemplatePreviewCacheKey(template.id));
    if (image) entries.push([template.id, image]);
  }
  return Object.fromEntries(entries);
}

const relTime = (value) => {
  if (!value) return 'Not saved';
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  if (seconds < 2629800) return `${Math.floor(seconds / 604800)}w ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
};

export default function Landing({ exiting, bootReady, onLaunch }) {
  const { user, status: authStatus, logout } = useAuth();
  const { showPrompt } = usePopup();
  const [projects, setProjects] = useState([]);
  const [view, setView] = useState(() => viewFromHash() ?? 'home');
  const [selectedTemplateId, setSelectedTemplateId] = useState('blank');
  const [templateKind, setTemplateKind] = useState('procedural');
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [projectActionBusy, setProjectActionBusy] = useState(false);
  const [templateThumbs, setTemplateThumbs] = useState(initialTemplateThumbs);
  const [menuFor, setMenuFor] = useState(null);
  const [query, setQuery] = useState('');
  const [projectsTab, setProjectsTab] = useState('local');
  const [cloudRefreshToken, setCloudRefreshToken] = useState(0);
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
    window.addEventListener('terrain-template:thumbnail', onThumbnail);
    return () => window.removeEventListener('terrain-template:thumbnail', onThumbnail);
  }, [bootReady]);
  useEffect(() => {
    if (!menuFor) return undefined;
    const close = () => setMenuFor(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuFor]);

  useEffect(() => { setQuery(''); }, [view]);

  useEffect(() => {
    const syncAuthView = () => {
      const hashView = viewFromHash();
      setView((current) => hashView ?? (HASH_VIEWS.has(current) ? 'home' : current));
    };
    window.addEventListener('hashchange', syncAuthView);
    return () => window.removeEventListener('hashchange', syncAuthView);
  }, []);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;

  const template = templateKind === 'nodes' ? getNodeProjectTemplate(selectedTemplateId) : getProjectTemplate(selectedTemplateId);
  const dispatch = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
  const showView = (nextView) => {
    if (HASH_VIEWS.has(nextView)) {
      const nextHash = `#/${nextView}`;
      if (window.location.hash !== nextHash) window.location.hash = `/${nextView}`;
      else setView(nextView);
      return;
    }
    if (viewFromHash()) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    setView(nextView);
  };
  useEffect(() => {
    if (view === 'profile' && authStatus !== 'loading' && !user) showView('login');
  }, [view, authStatus, user]);
  const create = (templateId, editorMode = 'procedural') => {
    if (!bootReady || exiting) return;
    setCreateOpen(false);
    dispatch('terrain-project:new', { templateId, editorMode });
    onLaunch();
  };
  const open = (project) => {
    if (!bootReady || exiting) return;
    dispatch('terrain-project:open', { project });
    onLaunch();
  };
  const openApp = () => projects.length ? open(projects[0]) : setCreateOpen(true);
  const goHome = () => { showView('home'); setSelectedProjectId(projects[0]?.id ?? null); };
  const selectTemplate = (id, editorMode = templateKind) => {
    const nextKind = editorMode === 'nodes' ? 'nodes' : 'procedural';
    setTemplateKind(nextKind);
    setSelectedTemplateId(id);
    setSelectedProjectId(null);
    showView('templates');
    if (nextKind === 'nodes') import('../components/nodes/NodeWorkspace.jsx').catch(() => {});
    else dispatch('terrain-template:preview', { templateId: id, editorMode: nextKind });
  };
  const openTemplates = (editorMode = templateKind) => {
    const nextKind = editorMode === 'nodes' ? 'nodes' : 'procedural';
    const catalog = nextKind === 'nodes' ? NODE_PROJECT_TEMPLATES : PROJECT_TEMPLATES;
    const currentExists = catalog.some((item) => item.id === selectedTemplateId);
    setTemplateKind(nextKind);
    setSelectedTemplateId(currentExists ? selectedTemplateId : catalog[0].id);
    setSelectedProjectId(null);
    showView('templates');
    if (nextKind === 'nodes') import('../components/nodes/NodeWorkspace.jsx').catch(() => {});
  };
  const importProjectFile = (file, { openAfter } = {}) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const raw = JSON.parse(reader.result);
        const project = await projectStore.save(normalizeProject(raw.terrain ? raw : { terrain: raw, metadata: { name: file.name.replace(/\.json$/i, '') } }));
        setSelectedProjectId(project.id);
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
  const renameProject = async (project) => {
    if (!project || projectActionBusy) return;
    const nextName = (await showPrompt({ title: 'Rename project', inputLabel: 'Project name', initialValue: project.metadata.name, confirmLabel: 'Rename', maxLength: 120 }))?.trim();
    if (!nextName || nextName === project.metadata.name) return;
    setProjectActionBusy(true);
    try { await projectStore.rename(project, nextName); } catch { /* the project remains selected */ }
    finally { setProjectActionBusy(false); }
  };
  const duplicateProject = async (project) => {
    if (!project || projectActionBusy) return;
    setProjectActionBusy(true);
    try {
      const copy = await projectStore.duplicate(project);
      setSelectedProjectId(copy.id);
    } catch { /* the original project remains available */ }
    finally { setProjectActionBusy(false); }
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

  const renderProjectCard = (project) => (
    <article className={`lp-card${menuFor === project.id ? ' menu-open' : ''}`} key={project.id}>
      <button type="button" className="lp-card-main" onClick={() => open(project)} disabled={!bootReady || exiting}>
        <span className="lp-card-thumb">{project.metadata.thumbnail ? <img src={project.metadata.thumbnail} alt="" /> : <LayoutTemplate size={22} />}</span>
        <span className={`lp-template-kind-badge ${project.terrain.editorMode}`}>
          {project.terrain.editorMode === 'nodes' ? 'Nodes' : 'Procedural'}
        </span>
        <span className="lp-card-info">
          <strong>{project.metadata.name}</strong>
          <small><Clock size={11} aria-hidden /> {relTime(project.metadata.modified)}</small>
        </span>
      </button>
      <button
        type="button"
        className="lp-card-menu-btn"
        aria-label={`Actions for ${project.metadata.name}`}
        aria-expanded={menuFor === project.id}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setMenuFor((current) => current === project.id ? null : project.id)}
      ><EllipsisVertical size={15} /></button>
      {menuFor === project.id && (
        <div className="lp-card-menu" role="menu" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => { setMenuFor(null); open(project); }} disabled={!bootReady || exiting}><FolderOpen size={13} /> Open</button>
          <button type="button" role="menuitem" onClick={() => { setMenuFor(null); renameProject(project); }} disabled={projectActionBusy}><Pencil size={13} /> Rename</button>
          <button type="button" role="menuitem" onClick={() => { setMenuFor(null); duplicateProject(project); }} disabled={projectActionBusy}><Copy size={13} /> Duplicate</button>
          <button type="button" role="menuitem" className="danger" onClick={() => { setMenuFor(null); setDeleteTarget(project); }} disabled={projectActionBusy}><Trash2 size={13} /> Delete</button>
        </div>
      )}
    </article>
  );

  const emptyProjects = (
    <div className="lp-empty">
      <FolderOpen size={24} />
      <strong>No projects yet</strong>
      <span>Create a terrain from a template or drop a project file anywhere on this page.</span>
      <button type="button" className="lp-primary" onClick={() => setCreateOpen(true)} disabled={!bootReady || exiting}><Plus size={15} /> Create terrain</button>
    </div>
  );

  return (
    <div
      className={`landing landing-overlay lp${AUTH_VIEWS.has(view) ? ' lp--auth' : ''}${view === 'profile' ? ' lp--profile' : ''}${view === 'community' ? ' lp--community' : ''}${exiting ? ' exiting' : ''}`}
      onDragEnter={onFileDragEnter}
      onDragOver={onFileDragOver}
      onDragLeave={onFileDragLeave}
      onDrop={onFileDrop}
    >
      <div className="lp-bg" aria-hidden="true" />
      {fileDragActive && (
        <div className="file-drop-overlay" role="presentation">
          <div className="file-drop-card">
            <Upload size={28} aria-hidden />
            <span>Drop terrain file to add it to your projects</span>
          </div>
        </div>
      )}

      <header className="lp-nav">
        <button type="button" className="lp-brand" onClick={goHome} title="Return to home"><Logo size={24} /><strong>{APP_NAME}</strong></button>
        <nav className="lp-nav-links" aria-label="Main navigation">
          <button type="button" className={view === 'projects' ? 'active' : ''} onClick={() => showView('projects')}>Projects</button>
          <button type="button" className={view === 'templates' ? 'active' : ''} onClick={() => openTemplates()}>Templates</button>
          <button type="button" className={view === 'community' ? 'active' : ''} onClick={() => showView('community')}>Community</button>
          <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">Docs</a>
        </nav>
        <div className="lp-nav-actions">
          <button type="button" className="lp-nav-credits" onClick={() => setCreditsOpen(true)} aria-label="Open credits and links" title="Credits and links"><CircleHelp size={17} /></button>
          {user ? <>
            <button type="button" className={`lp-account-chip${view === 'profile' ? ' active' : ''}`} title="Open your profile" onClick={() => showView('profile')}>
              {avatarUrl(user) ? <img src={avatarUrl(user)} alt="" /> : <UserRound size={14} />}
              <span>{user.username}</span>
            </button>
            <button type="button" className="lp-secondary sm lp-auth-logout" onClick={async () => { await logout(); goHome(); }}><LogOut size={13} /> <span>Logout</span></button>
          </> : <>
            <button type="button" className="lp-secondary sm lp-auth-login" onClick={() => showView('login')} disabled={authStatus === 'loading'}><LogIn size={13} /> <span>Sign in</span></button>
            <button type="button" className="lp-primary sm lp-auth-register" onClick={() => showView('register')} disabled={authStatus === 'loading'}><UserPlus size={13} /> <span>Create account</span></button>
          </>}
          <button type="button" className="lp-secondary sm" onClick={openApp} disabled={!bootReady || exiting}><SquareArrowOutUpRight size={14} /> Open App</button>
        </div>
      </header>

      <div className="lp-scroll">
        <main className="lp-content">
          <div key={view} className="lp-content-scroll">
          {AUTH_VIEWS.has(view) && (
            <AuthPage
              key={view}
              mode={view}
              onBack={goHome}
              onSwitch={showView}
              onSuccess={goHome}
            />
          )}
          {view === 'profile' && user && <ProfilePage onBack={goHome} />}
          {view === 'community' && <CommunityPage onBack={() => showView('projects')} onOpen={open} />}
          {view === 'home' && <>
            <section className="lp-hero">
              <div className="lp-version-pill">v{APP_VERSION}</div>
              <h1>Craft <em>stunning worlds</em> with procedural power</h1>
              <p>{APP_NAME} helps you generate, shape, and texture terrain for your projects.</p>
              <div className="lp-hero-actions">
                <button type="button" className="lp-primary" onClick={() => setCreateOpen(true)} disabled={!bootReady || exiting}><Plus size={15} /> Create terrain</button>
                <button type="button" className="lp-secondary" onClick={() => openTemplates()}><LayoutTemplate size={14} /> Browse templates</button>
              </div>
            </section>

            <section className="lp-section">
              <div className="lp-section-head">
                <h2>Recent projects</h2>
                {projects.length > 0 && <button type="button" className="lp-link" onClick={() => showView('projects')}>View all projects <ArrowRight size={12} aria-hidden /></button>}
              </div>
              {projects.length ? <div className="lp-card-grid">{projects.slice(0, 8).map(renderProjectCard)}</div> : emptyProjects}
            </section>

          </>}

          {view === 'projects' && (() => {
            const filtered = projects.filter((project) => project.metadata.name.toLowerCase().includes(query.trim().toLowerCase()));
            return (
              <section className="lp-section lp-view">
                <div className="lp-section-head">
                  <h2>Projects</h2>
                  {projectsTab === 'local' && (
                    <div className="lp-head-actions">
                      <button type="button" className="lp-secondary sm" onClick={() => fileRef.current?.click()} disabled={!bootReady || exiting}><Upload size={13} /> Import</button>
                      <button type="button" className="lp-primary sm" onClick={() => setCreateOpen(true)} disabled={!bootReady || exiting}><Plus size={14} /> New terrain</button>
                    </div>
                  )}
                  {projectsTab === 'cloud' && user && (
                    <div className="lp-head-actions">
                      <button type="button" className="lp-secondary sm" onClick={() => setCloudRefreshToken((current) => current + 1)}><RefreshCw size={13} /> Refresh</button>
                    </div>
                  )}
                </div>
                <div className="lp-project-tabs" role="tablist" aria-label="Project storage">
                  <button type="button" role="tab" aria-selected={projectsTab === 'local'} aria-controls="local-projects-panel" className={projectsTab === 'local' ? 'active' : ''} onClick={() => setProjectsTab('local')}>Local Projects</button>
                  <button type="button" role="tab" aria-selected={projectsTab === 'cloud'} aria-controls="cloud-projects-panel" className={projectsTab === 'cloud' ? 'active' : ''} onClick={() => setProjectsTab('cloud')}>Cloud Projects</button>
                </div>
                {projectsTab === 'local' ? (
                  <div key="local-projects" id="local-projects-panel" className="lp-project-tab-panel" role="tabpanel">
                    <div className="lp-search">
                      <Search size={14} aria-hidden />
                      <input type="search" placeholder="Search projects…" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search local projects" />
                    </div>
                    {projects.length === 0 ? emptyProjects
                      : filtered.length === 0 ? <p className="lp-no-results">No project matches &ldquo;{query.trim()}&rdquo;.</p>
                      : <div className="lp-card-grid">{filtered.slice(0, 8).map(renderProjectCard)}</div>}
                  </div>
                ) : (
                  <div key="cloud-projects" id="cloud-projects-panel" className="lp-project-tab-panel" role="tabpanel">
                    <CloudProjectsPanel localProjects={projects} onOpen={open} refreshToken={cloudRefreshToken} />
                  </div>
                )}
              </section>
            );
          })()}

          {view === 'templates' && (() => {
            const q = query.trim().toLowerCase();
            const catalog = templateKind === 'nodes' ? NODE_PROJECT_TEMPLATES : PROJECT_TEMPLATES;
            const filtered = catalog.filter((item) => item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q));
            return (
            <section className="lp-section lp-view">
              <div className="lp-section-head lp-template-section-head">
                <div><h2>Terrain templates</h2><p>Choose one authoring workflow. Procedural selections preview live; Nodes opens straight into the editor.</p></div>
                <div className="lp-template-kind-switch" role="tablist" aria-label="Template type">
                  <button type="button" role="tab" aria-selected={templateKind === 'procedural'} className={templateKind === 'procedural' ? 'active' : ''} onClick={() => openTemplates('procedural')}><SlidersHorizontal size={13} /> Procedural</button>
                  <button type="button" role="tab" aria-selected={templateKind === 'nodes'} className={templateKind === 'nodes' ? 'active' : ''} onClick={() => openTemplates('nodes')}><Boxes size={13} /> Nodes</button>
                </div>
              </div>
              <div className="lp-search">
                <Search size={14} aria-hidden />
                <input type="search" placeholder={`Search ${templateKind === 'nodes' ? 'Nodes' : 'procedural'} templates…`} value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search templates" />
              </div>
              {filtered.length === 0 && <p className="lp-no-results">No template matches &ldquo;{query.trim()}&rdquo;.</p>}
              <div className="lp-card-grid">
                {filtered.map((item) => (
                  <article className={`lp-card${item.id === selectedTemplateId ? ' selected' : ''}`} key={item.id}>
                    <button type="button" className="lp-card-main" onClick={() => selectTemplate(item.id, templateKind)} onDoubleClick={() => create(item.id, templateKind)}>
                      <span className={`lp-card-thumb${templateKind === 'nodes' ? ' nodes' : ''}`}>{templateThumbs[item.id] ? <img src={templateThumbs[item.id]} alt="" /> : (() => { const Icon = NODE_TEMPLATE_ICONS[item.icon] || LayoutTemplate; return <Icon size={22} />; })()}</span>
                      <span className="lp-card-info">
                        <strong>{item.name}</strong>
                        <small>{item.description}</small>
                      </span>
                      <span className={`lp-template-kind-badge ${templateKind}`}>{templateKind === 'nodes' ? 'Nodes' : 'Procedural'}</span>
                    </button>
                  </article>
                ))}
              </div>
              <p className="lp-template-hint">{templateKind === 'nodes' ? 'Node templates load instantly; open the 2D preview when you need it.' : 'Selecting a template previews it live in the background.'}</p>
              <button type="button" className="lp-primary lp-template-create" onClick={() => create(template.id, templateKind)} disabled={!bootReady || exiting}><FilePlus2 size={15} /> Create {template.name}</button>
            </section>
            );
          })()}

          </div>

          <footer className="lp-footer">
            <div className="lp-footer-socials">
              <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer" aria-label="Open GitHub repository" title="GitHub"><FaGithub size={17} /></a>
              <a href={AUTHOR_X_URL} target="_blank" rel="noopener noreferrer" aria-label="Open X profile" title="X"><FaXTwitter size={15} /></a>
              <a href={AUTHOR_PORTFOLIO_URL} target="_blank" rel="noopener noreferrer" aria-label="Open portfolio" title="Portfolio"><Globe2 size={16} /></a>
              <a href="mailto:zyfodexe@gmail.com" aria-label="Email zyfodexe@gmail.com" title="Email zyfodexe@gmail.com"><Mail size={16} /></a>
            </div>
            <div className="lp-footer-meta">
              <span>© {new Date().getFullYear()} {APP_NAME}. Open source software.</span>
              <button type="button" className="lp-link" onClick={() => setCreditsOpen(true)}>Credits</button>
            </div>
          </footer>
        </main>
      </div>

      {!bootReady && !HASH_VIEWS.has(view) && <div className="landing-preview-loader" role="status"><span className="landing-preview-spinner" aria-hidden="true" /><strong>Starting terrain editor</strong><small>Preparing your random terrain workspace…</small></div>}
      {createOpen && <div className="landing-credits-backdrop landing-create-backdrop" role="presentation" onMouseDown={() => setCreateOpen(false)}>
        <section className="landing-create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-terrain-title" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div><span>New project</span><h2 id="create-terrain-title">Choose how to build your terrain</h2><p>Each project uses one authoring workflow. You can export from either.</p></div>
            <button type="button" onClick={() => setCreateOpen(false)} aria-label="Close"><X size={16} /></button>
          </header>
          <div className="landing-create-options">
            <button type="button" onClick={() => create('blank', 'procedural')} disabled={!bootReady || exiting}>
              <span className="landing-create-icon"><SlidersHorizontal size={22} /></span>
              <strong>Procedural</strong>
              <small>The current Tile, Infinite World, and Planet workflow with direct controls and Noise Layers.</small>
              <span className="landing-create-action">Create procedural terrain <ArrowRight size={13} /></span>
            </button>
            <button type="button" onClick={() => create('nodes-blank', 'nodes')} disabled={!bootReady || exiting}>
              <span className="landing-create-icon nodes"><Boxes size={22} /></span>
              <strong>Nodes</strong>
              <small>A dedicated analytical graph workspace starting from a clean, flat slab. Desktop first.</small>
              <span className="landing-create-action">Create Nodes terrain <ArrowRight size={13} /></span>
            </button>
          </div>
          <footer>
            <button type="button" className="lp-link" onClick={() => { setCreateOpen(false); openTemplates('procedural'); }}><SlidersHorizontal size={13} /> Procedural templates</button>
            <button type="button" className="lp-link" onClick={() => { setCreateOpen(false); openTemplates('nodes'); }}><Boxes size={13} /> Nodes templates</button>
          </footer>
        </section>
      </div>}
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
      <input ref={fileRef} type="file" accept="application/json" hidden onChange={onImport} />
    </div>
  );
}
