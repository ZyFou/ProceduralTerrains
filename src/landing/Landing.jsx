import { matchesTranslatedSearch } from '../i18n/language.js';
import { translateText, useLanguage } from '../i18n/LanguageContext.jsx';
import { useDialogFocus } from '../hooks/useDialogFocus.js';
import SurfacePackCredits from '../components/ui/SurfacePackCredits.jsx';
import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Box, Boxes, CircleHelp, Clock, CloudCheck, CloudOff, Copy, Earth, EllipsisVertical, Eye, EyeOff, FilePlus2, FolderOpen, Globe2, Layers3, LayoutTemplate, Lock, LogIn, LogOut, Mail, Menu, Mountain, Orbit, Palette, Pencil, Plus, RefreshCw, Route, Search, ShieldCheck, SlidersHorizontal, SquareArrowOutUpRight, Trash2, Upload, UserPlus, UserRound, Waves, X } from 'lucide-react';
import { FaDiscord, FaGithub, FaXTwitter } from 'react-icons/fa6';
import { SiKofi } from 'react-icons/si';
import { APP_NAME, APP_VERSION, AUTHOR_PORTFOLIO_URL, AUTHOR_X_URL, CURSOR_PACK_AUTHOR, CURSOR_PACK_URL, GITHUB_REPO_URL } from '../constants/app.js';
import { projectStore, projectSyncStore } from '../project/ProjectStore.js';
import { projectApi } from '../project/projectApi.js';
import { decodePortableProject } from '../project/PortableProject.js';
import { buildUnifiedProjectIndex } from '../project/projectSync.js';
import { PROJECT_TEMPLATES, projectTemplatePreviewCacheKey } from '../project/ProjectTemplates.js';
import { NODE_PROJECT_TEMPLATES, getNodeProjectTemplate, nodeTemplatePreviewCacheKey } from '../project/NodeProjectTemplates.js';
import { MINI_COMPOSITION_IDS, MINI_RECIPES } from '../engine/mini/MiniTerrainSettings.js';
import { TERRAIN_GRADIENT_OPTIONS, terrainGradientCss } from '../engine/terrain/graph/TerrainGradientPresets.js';
import { BUILDING_SOURCE, BUILDING_SOURCE_URL } from '../engine/terrain/RealWorldBuildings.js';
import { Logo } from './shared.jsx';
import AuthPage from '../auth/AuthPage.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { avatarUrl } from '../auth/authApi.js';
import ProfilePage from '../auth/ProfilePage.jsx';
import ProjectLibrary from '../project/ProjectLibrary.jsx';
import CommunityPage from '../project/CommunityPage.jsx';
import { usePopup } from '../components/ui/PopupProvider.jsx';
import AdminDashboard from '../admin/AdminDashboard.jsx';
import ConfidentialityPage from '../legal/ConfidentialityPage.jsx';
import PluginsPage from './plugins/PluginsPage.jsx';
import LanguageSwitch from '../i18n/LanguageSwitch.jsx';
import HomeView from './home/HomeView.jsx';
import { CreateProjectDialog, DeleteProjectDialog } from './home/CreateProjectDialog.jsx';
import MatrixButton from '../components/matrix/MatrixButton.jsx';
import SlidingIndicator from '../components/ui/SlidingIndicator.jsx';

const DocsPage = lazy(() => import('../docs/DocsPage.jsx'));

const NODE_TEMPLATE_ICONS = { boxes: Boxes, mountain: Mountain, layers: Layers3, waves: Waves, orbit: Orbit, route: Route };
const MINI_TEMPLATES = [
  ...PROJECT_TEMPLATES.map((template) => ({ ...template, name: template.id === 'blank' ? 'Procedural' : template.name })),
  ...MINI_COMPOSITION_IDS.map((id) => ({
    id,
    name: MINI_RECIPES[id].labelEn,
    description: {
      cove: 'A sheltered cove framed by cliffs and tropical water.',
      islet: 'A wooded island with sandy shores and shallow water.',
      lake: 'A quiet lake surrounded by mountain peaks and forest.',
    }[id],
    icon: id === 'lake' ? 'mountain' : 'waves',
  })),
];
const templateCatalog = (kind) => kind === 'mini' ? MINI_TEMPLATES : kind === 'nodes' ? NODE_PROJECT_TEMPLATES : PROJECT_TEMPLATES;
const AUTH_VIEWS = new Set(['login', 'register']);
const HASH_VIEWS = new Set(['login', 'register', 'profile', 'community', 'plugins', 'unity', 'blender', 'admin', 'confidentiality', 'docs']);
const PLUGIN_VIEWS = new Set(['plugins', 'unity', 'blender']);
const BOOT_READY_HOLD_MS = 320;
const BOOT_REVEAL_MS = 680;
const BOOT_PHASES = Object.freeze([
  ['planning', 'Plan'],
  ['renderer', 'GPU'],
  ['resources', 'Assets'],
  ['geometry', 'Terrain'],
  ['compile', 'Shaders'],
  ['present', 'Frame'],
]);

function BootTerrainProgress({ bootProgress, complete = false }) {
  useLanguage();
  const rawProgress = complete ? 1 : Number(bootProgress?.progress);
  const progress = Math.max(0, Math.min(1, Number.isFinite(rawProgress) ? rawProgress : 0));
  const percent = Math.round(progress * 100);
  const activeIndex = complete
    ? BOOT_PHASES.length
    : Math.max(0, BOOT_PHASES.findIndex(([stage]) => stage === bootProgress?.stage));
  const activePhaseLabel = complete ? 'Ready' : BOOT_PHASES[activeIndex]?.[1] ?? 'Preparing';

  return (
    <div
      className="landing-boot-progress"
      role="progressbar"
      aria-label={translateText("Final terrain boot progress")}
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={percent}
    >
      <svg className="landing-boot-terrain" viewBox="0 0 72 46" aria-hidden="true">
        <defs>
          <clipPath id="landing-terrain-progress-clip">
            <rect x="0" y="0" width={72 * progress} height="46" />
          </clipPath>
        </defs>
        <path className="landing-boot-terrain-base" d="M3 40 20 19l9 11L43 8l26 32H3Z" />
        <path className="landing-boot-terrain-line" d="m3 40 17-21 9 11L43 8l26 32" />
        <path className="landing-boot-terrain-fill" clipPath="url(#landing-terrain-progress-clip)" d="M3 40 20 19l9 11L43 8l26 32H3Z" />
      </svg>
      <span className="landing-boot-progress-step">{translateText(activePhaseLabel)}</span>
    </div>
  );
}

function viewFromHash() {
  const value = window.location.hash.replace(/^#\/?/, '').split('?')[0].toLowerCase();
  if (value.split('/')[0] === 'docs') return 'docs';
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


export default function Landing({ exiting, bootReady, bootError, bootProgress, onRetryBoot, onLaunch, onRequestEditor }) {
  useLanguage();
  const { user, status: authStatus, logout } = useAuth();
  const { showPrompt, showPopup } = usePopup();
  const copyDiscordUsername = async () => {
    try {
      await navigator.clipboard.writeText('zyfou');
      showPopup('Discord username copied: zyfou', { type: 'success' });
    } catch {
      showPopup('Could not copy. Discord username: zyfou', { type: 'error' });
    }
  };
  const [projects, setProjects] = useState([]);
  const [cloudProjects, setCloudProjects] = useState([]);
  const [syncBindings, setSyncBindings] = useState([]);
  const [cloudRefreshToken, setCloudRefreshToken] = useState(0);
  const [view, setView] = useState(() => viewFromHash() ?? 'home');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navRef = useRef(null);
  const menuToggleRef = useRef(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState('blank');
  const [templateKind, setTemplateKind] = useState('procedural');
  const [nodeColorsEnabled, setNodeColorsEnabled] = useState(false);
  const [nodeColorPreset, setNodeColorPreset] = useState('alpine');
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const creditsRef = useRef(null);
  useDialogFocus(creditsOpen, creditsRef, () => setCreditsOpen(false));
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [projectActionBusy, setProjectActionBusy] = useState(false);
  const [templateThumbs, setTemplateThumbs] = useState(initialTemplateThumbs);
  const [query, setQuery] = useState('');
  const [fileDragActive, setFileDragActive] = useState(false);
  const fileDragDepthRef = useRef(0);
  const bootReadyAtMountRef = useRef(bootReady);
  const [bootStage, setBootStage] = useState(() => bootReady ? 'ready' : 'loading');

  useEffect(() => {
    if (!bootReady) {
      setBootStage('loading');
      return undefined;
    }
    // Returning to Home remounts Landing with an already-ready engine. Only a
    // real cold boot needs the ready hold and reveal choreography.
    if (bootReadyAtMountRef.current) {
      setBootStage('ready');
      return undefined;
    }
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const holdMs = reducedMotion ? 100 : BOOT_READY_HOLD_MS;
    const revealMs = reducedMotion ? 80 : BOOT_REVEAL_MS;
    setBootStage('holding');
    const revealTimer = window.setTimeout(() => setBootStage('revealing'), holdMs);
    const readyTimer = window.setTimeout(() => setBootStage('ready'), holdMs + revealMs);
    return () => {
      window.clearTimeout(revealTimer);
      window.clearTimeout(readyTimer);
    };
  }, [bootReady]);

  const visualBootStage = HASH_VIEWS.has(view) ? 'ready' : bootStage;
  const menuReady = bootReady && visualBootStage === 'ready';

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
    let cancelled = false;
    const loadBindings = () => projectSyncStore.list()
      .then((items) => { if (!cancelled) setSyncBindings(items); })
      .catch(() => { if (!cancelled) setSyncBindings([]); });
    const refresh = () => {
      loadBindings();
      setCloudRefreshToken((current) => current + 1);
    };
    loadBindings();
    window.addEventListener('terrain-project-sync:changed', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('terrain-project-sync:changed', refresh);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (!user || view !== 'home') {
      if (!user) setCloudProjects([]);
      return () => { cancelled = true; };
    }
    projectApi.listMine()
      .then((result) => { if (!cancelled) setCloudProjects(result.projects); })
      .catch(() => { if (!cancelled) setCloudProjects([]); });
    return () => { cancelled = true; };
  }, [cloudRefreshToken, user, view]);
  useEffect(() => {
    if (!bootReady) return undefined;
    const onThumbnail = (event) => {
      const { templateId, image } = event.detail ?? {};
      if (templateId && image) setTemplateThumbs((current) => ({ ...current, [templateId]: image }));
    };
    window.addEventListener('terrain-template:thumbnail', onThumbnail);
    return () => window.removeEventListener('terrain-template:thumbnail', onThumbnail);
  }, [bootReady]);
  useEffect(() => { setQuery(''); }, [view]);
  useEffect(() => { setMobileMenuOpen(false); }, [view]);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const closeOutside = (event) => {
      if (!navRef.current?.contains(event.target)) setMobileMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Tab') {
        const controls = [...navRef.current.querySelectorAll('button:not(:disabled), a[href]')]
          .filter((element) => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
        return;
      }
      if (event.key !== 'Escape') return;
      setMobileMenuOpen(false);
      menuToggleRef.current?.focus();
    };
    const desktop = window.matchMedia('(min-width: 921px)');
    const closeOnDesktop = () => { if (desktop.matches) setMobileMenuOpen(false); };
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeOnEscape);
    desktop.addEventListener('change', closeOnDesktop);
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape);
      desktop.removeEventListener('change', closeOnDesktop);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    const syncAuthView = () => {
      const hashView = viewFromHash();
      setView((current) => hashView ?? (HASH_VIEWS.has(current) ? 'home' : current));
    };
    window.addEventListener('hashchange', syncAuthView);
    return () => window.removeEventListener('hashchange', syncAuthView);
  }, []);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const recentProjectCloudEntries = useMemo(() => new Map(
    buildUnifiedProjectIndex({ localProjects: projects, cloudProjects, bindings: syncBindings })
      .filter((entry) => entry.localProject)
      .map((entry) => [entry.localProject.id, entry]),
  ), [cloudProjects, projects, syncBindings]);

  const template = templateCatalog(templateKind).find((item) => item.id === selectedTemplateId) ?? templateCatalog(templateKind)[0];
  const dispatch = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
  const showView = (nextView) => {
    if (nextView !== 'docs') onRequestEditor?.();
    setMobileMenuOpen(false);
    if (HASH_VIEWS.has(nextView)) {
      const nextHash = `#/${nextView}`;
      if (window.location.hash !== nextHash) window.location.hash = `/${nextView}`;
      else setView(nextView);
      return;
    }
    // Hash routes may carry a share code (e.g. #/community?code=...).
    // Replace the complete URL when leaving a hash view so the code cannot
    // trigger CommunityPage's auto-open effect again after returning home.
    window.history.replaceState(null, '', window.location.pathname);
    setView(nextView);
  };
  useEffect(() => {
    if (view === 'profile' && authStatus !== 'loading' && !user) showView('login');
    if (view === 'admin' && authStatus !== 'loading' && user?.role !== 'admin') showView(user ? 'home' : 'login');
  }, [view, authStatus, user]);
  const create = (templateId, editorMode = 'procedural') => {
    if (!menuReady || exiting) return;
    setCreateOpen(false);
    dispatch('terrain-project:new', {
      templateId,
      editorMode,
      ...(editorMode === 'nodes' ? { nodeColorsEnabled, nodeColorPreset } : {}),
    });
    onLaunch();
  };
  const open = (project) => {
    if (!menuReady || exiting) return;
    dispatch('terrain-project:open', { project });
    onLaunch();
  };
  const openApp = () => projects.length ? open(projects[0]) : setCreateOpen(true);
  const goHome = () => { showView('home'); setSelectedProjectId(projects[0]?.id ?? null); };
  const selectTemplate = (id, editorMode = templateKind) => {
    const nextKind = ['nodes', 'mini'].includes(editorMode) ? editorMode : 'procedural';
    const nextTemplate = nextKind === 'nodes' ? getNodeProjectTemplate(id) : null;
    setTemplateKind(nextKind);
    setSelectedTemplateId(id);
    if (nextTemplate) {
      setNodeColorsEnabled(nextTemplate.colorsEnabled !== false);
      setNodeColorPreset(nextTemplate.colorPreset || 'alpine');
    }
    setSelectedProjectId(null);
    showView('templates');
    if (nextKind === 'nodes') import('../components/nodes/NodeWorkspace.jsx').catch(() => {});
  };
  const openTemplates = (editorMode = templateKind) => {
    const nextKind = ['nodes', 'mini'].includes(editorMode) ? editorMode : 'procedural';
    const catalog = templateCatalog(nextKind);
    const currentExists = catalog.some((item) => item.id === selectedTemplateId);
    const nextTemplateId = currentExists ? selectedTemplateId : catalog[0].id;
    setTemplateKind(nextKind);
    setSelectedTemplateId(nextTemplateId);
    if (nextKind === 'nodes') {
      const nextTemplate = getNodeProjectTemplate(nextTemplateId);
      setNodeColorsEnabled(nextTemplate.colorsEnabled !== false);
      setNodeColorPreset(nextTemplate.colorPreset || 'alpine');
    }
    setSelectedProjectId(null);
    setQuery('');
    showView('templates');
    if (nextKind === 'nodes') import('../components/nodes/NodeWorkspace.jsx').catch(() => {});
  };
  const chooseTemplateWorkflow = (editorMode) => {
    setCreateOpen(false);
    openTemplates(editorMode);
  };
  const importProjectFile = async (file, { openAfter } = {}) => {
    if (!file) return;
    try {
      const imported = await decodePortableProject(await file.arrayBuffer(), {
        legacyName: file.name.replace(/\.(?:json|ptrterrain)$/i, ''),
      });
      const project = await projectStore.save(imported);
      setSelectedProjectId(project.id);
      if (openAfter) open(project);
    } catch (error) {
      showPopup(error instanceof Error ? error.message : 'Could not parse project file.', { type: 'error' });
    }
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

  return (
    <div
      className={`landing landing-overlay lp boot-${visualBootStage}${AUTH_VIEWS.has(view) ? ' lp--auth' : ''}${view === 'profile' ? ' lp--profile' : ''}${view === 'community' ? ' lp--community' : ''}${PLUGIN_VIEWS.has(view) ? ' lp--unity' : ''}${view === 'admin' ? ' lp--admin' : ''}${view === 'confidentiality' ? ' lp--legal' : ''}${view === 'docs' ? ' lp--docs' : ''}${exiting ? ' exiting' : ''}`}
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
            <span>{translateText("Drop terrain file to add it to your projects")}</span>
          </div>
        </div>
      )}

      <header className="lp-nav" ref={navRef}>
        <button type="button" className="lp-brand" onClick={goHome} title={translateText("Return to home")}><Logo size={24} /><strong>{translateText(APP_NAME)}</strong></button>
        <button type="button" ref={menuToggleRef} className="lp-secondary sm lp-menu-toggle" aria-label={translateText(mobileMenuOpen ? 'Close menu' : 'Open menu')} aria-expanded={mobileMenuOpen} aria-controls="lp-navigation" onClick={() => setMobileMenuOpen((open) => !open)}>
          {mobileMenuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        </button>
        <div id="lp-navigation" className={`lp-nav-menu${mobileMenuOpen ? ' is-open' : ''}`} onClick={(event) => {
          if (event.target.closest('button, a')) {
            setMobileMenuOpen(false);
            if (mobileMenuOpen) menuToggleRef.current?.focus();
          }
        }} onBlur={(event) => {
          if (event.relatedTarget && !navRef.current?.contains(event.relatedTarget)) setMobileMenuOpen(false);
        }}>
        <nav className="lp-nav-links" aria-label={translateText("Main navigation")}>
          <button type="button" className={view === 'projects' ? 'active' : ''} onClick={() => showView('projects')}>{translateText("Projects")}</button>
          <button type="button" className={view === 'templates' ? 'active' : ''} onClick={() => openTemplates()}>{translateText("Templates")}</button>
          <button type="button" className={view === 'community' ? 'active' : ''} onClick={() => showView('community')}>{translateText("Community")}</button>
          <button type="button" className={PLUGIN_VIEWS.has(view) ? 'active' : ''} onClick={() => showView('plugins')}>{translateText("Plugins")}</button>
          <a href="#/docs/overview" className={view === 'docs' ? 'active' : ''} aria-current={view === 'docs' ? 'page' : undefined}>{translateText("Docs")}</a>
          <a href="https://procedural-planets.com" target="_blank" rel="noopener noreferrer">Procedural Planets</a>
        </nav>
        <div className="lp-nav-actions">
          <button type="button" className="lp-nav-credits" onClick={() => setCreditsOpen(true)} aria-label={translateText("Open credits and links")} title={translateText("Credits and links")}><CircleHelp size={17} /></button>
          {user ? <>
            {user.role === 'admin' && <button type="button" className={`lp-admin-chip${view === 'admin' ? ' active' : ''}`} title={translateText("Open administration")} onClick={() => showView('admin')}><ShieldCheck size={14} /><span>{translateText("Admin")}</span></button>}
            <button type="button" className={`lp-account-chip${view === 'profile' ? ' active' : ''}`} title={translateText("Open your profile")} onClick={() => showView('profile')}>
              {avatarUrl(user) ? <img src={avatarUrl(user)} alt="" /> : <UserRound size={14} />}
              <span>{user.username}</span>
            </button>
            <button type="button" className="lp-secondary sm lp-auth-logout" onClick={async () => { await logout(); goHome(); }}><LogOut size={13} /> <span>{translateText("Logout")}</span></button>
          </> : <>
            <button type="button" className="lp-secondary sm lp-auth-login" onClick={() => showView('login')} disabled={authStatus === 'loading'}><LogIn size={13} /> <span>{translateText("Sign in")}</span></button>
            <button type="button" className="lp-primary sm lp-auth-register" onClick={() => showView('register')} disabled={authStatus === 'loading'}><UserPlus size={13} /> <span>{translateText("Create account")}</span></button>
          </>}
          <LanguageSwitch className="lp-secondary sm lp-language-switch" />

          {/* <button type="button" className="lp-secondary sm" onClick={openApp} disabled={!bootReady || exiting}><SquareArrowOutUpRight size={14} /> Open App</button> */}
        </div>
        </div>
      </header>

      <div className="lp-scroll" inert={mobileMenuOpen ? '' : undefined}>
        <main className="lp-content">
          <div key={view} className={`lp-content-scroll${view === 'docs' ? ' lp-docs-scroll' : ''}`}>
          {view === 'docs' && <Suspense fallback={<p role="status">{translateText("Loading documentation…")}</p>}><DocsPage /></Suspense>}
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
          {view === 'community' && <CommunityPage onBack={() => showView('projects')} onOpen={open} ready={menuReady && !exiting} />}
          {PLUGIN_VIEWS.has(view) && (
            <PluginsPage
              activePlugin={view === 'blender' ? 'blender' : 'unity'}
              onSelectPlugin={showView}
              onOpenEditor={goHome}
            />
          )}
          {view === 'admin' && user?.role === 'admin' && <AdminDashboard user={user} onBack={goHome} />}
          {view === 'confidentiality' && <ConfidentialityPage onBack={goHome} />}
          {view === 'home' && (
            <HomeView
              projects={projects}
              cloudEntries={recentProjectCloudEntries}
              ready={menuReady}
              booting={!menuReady}
              exiting={exiting}
              busy={projectActionBusy}
              onCreate={() => setCreateOpen(true)}
              onBrowseTemplates={() => openTemplates()}
              onViewAll={() => showView('projects')}
              onOpen={open}
              onRename={renameProject}
              onDuplicate={duplicateProject}
              onDelete={setDeleteTarget}
            />
          )}

          {view === 'projects' && (
            <section className="lp-section lp-view">
              <div className="lp-section-head"><h2>{translateText("Projects")}</h2></div>
              <ProjectLibrary
                localProjects={projects}
                bootReady={menuReady}
                exiting={exiting}
                onOpen={open}
                onCreate={() => setCreateOpen(true)}
                onImportFile={(file) => importProjectFile(file, { openAfter: true })}
                onRename={renameProject}
                onDuplicate={duplicateProject}
                onDelete={setDeleteTarget}
                projectActionBusy={projectActionBusy}
                onSignIn={() => showView('login')}
              />
            </section>
          )}

          {view === 'templates' && (() => {
            const q = query.trim().toLowerCase();
            const catalog = templateCatalog(templateKind);
            const filtered = catalog.filter((item) => matchesTranslatedSearch(q, item.name, item.description));
            return (
            <section className="lp-section lp-view">
              <div className="lp-section-head lp-template-section-head">
                <div><h2>{translateText(templateKind === 'mini' ? 'Mini Terrain templates' : 'Terrain templates')}</h2><p>{translateText(templateKind === 'mini' ? 'Choose a procedural base or a composed scene for your diorama.' : 'Choose one authoring workflow. Procedural selections preview live; Nodes opens straight into the editor.')}</p></div>
                <div className="lp-template-kind-switch has-slider" role="tablist" aria-label={translateText("Template type")}>
                  <SlidingIndicator />
                  <button type="button" role="tab" aria-selected={templateKind === 'procedural'} className={templateKind === 'procedural' ? 'active' : ''} onClick={() => openTemplates('procedural')}><SlidersHorizontal size={13} />{translateText(" Procedural")}</button>
                  <button type="button" role="tab" aria-selected={templateKind === 'nodes'} className={templateKind === 'nodes' ? 'active' : ''} onClick={() => openTemplates('nodes')}><Boxes size={13} />{translateText(" Nodes")}</button>
                  <button type="button" role="tab" aria-selected={templateKind === 'mini'} className={templateKind === 'mini' ? 'active' : ''} onClick={() => openTemplates('mini')}><Box size={13} />{translateText("Mini Terrain")}</button>
                </div>
              </div>
              <div className="lp-search">
                <Search size={14} aria-hidden />
                <input type="search" placeholder={translateText(templateKind === 'mini' ? 'Search Mini Terrain templates…' : `Search ${templateKind === 'nodes' ? 'Nodes' : 'procedural'} templates…`)} value={query} onChange={(event) => setQuery(event.target.value)} aria-label={translateText("Search templates")} />
              </div>
              {filtered.length === 0 && <p className="lp-no-results">{translateText("No template matches “")}{query.trim()}&rdquo;.</p>}
              <div className="lp-card-grid">
                {filtered.map((item) => (
                  <article className={`lp-card${item.id === selectedTemplateId ? ' selected' : ''}`} key={item.id}>
                    <button type="button" className="lp-card-main" onClick={() => selectTemplate(item.id, templateKind)} onDoubleClick={() => create(item.id, templateKind)}>
                      <span className={`lp-card-thumb ${templateKind}`}>{templateKind !== 'mini' && templateThumbs[item.id] ? <img src={templateThumbs[item.id]} alt="" /> : (() => { const Icon = NODE_TEMPLATE_ICONS[item.icon] || (templateKind === 'mini' ? Box : LayoutTemplate); return <Icon size={22} />; })()}</span>
                      <span className="lp-card-info">
                        <strong>{translateText(item.name)}</strong>
                        <small>{translateText(item.description)}</small>
                      </span>
                      <span className={`lp-template-kind-badge ${templateKind}`}>{translateText(templateKind === 'mini' ? 'Mini Terrain' : templateKind === 'nodes' ? 'Nodes' : 'Procedural')}</span>
                    </button>
                  </article>
                ))}
              </div>
              {templateKind === 'nodes' ? (
                <section className={`lp-node-color-options${nodeColorsEnabled ? ' enabled' : ''}`} aria-label={translateText("Node template color options")}>
                  <div className="lp-node-color-copy">
                    <span className="lp-node-color-icon"><Palette size={16} aria-hidden /></span>
                    <span><strong>{translateText("Node Colors")}</strong><small>{translateText("Apply a terrain color graph when this template opens.")}</small></span>
                  </div>
                  <button
                    type="button"
                    className="lp-node-color-toggle"
                    role="switch"
                    aria-checked={nodeColorsEnabled}
                    onClick={() => setNodeColorsEnabled((enabled) => !enabled)}
                  >
                    {nodeColorsEnabled ? <Eye size={13} aria-hidden /> : <EyeOff size={13} aria-hidden />}
                    {translateText(nodeColorsEnabled ? 'Applied' : 'Project palette')}
                  </button>
                  <label className="lp-node-color-preset">
                    <span>{translateText("Color preset")}</span>
                    <span className="lp-node-color-select">
                      <i style={{ background: terrainGradientCss(nodeColorPreset) }} aria-hidden />
                      <select value={nodeColorPreset} onChange={(event) => { setNodeColorPreset(event.target.value); setNodeColorsEnabled(true); }} aria-label={translateText("Template color preset")}>
                        {TERRAIN_GRADIENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{translateText(option.label)}</option>)}
                      </select>
                    </span>
                  </label>
                </section>
              ) : null}
              <p className="lp-template-hint">{translateText(templateKind === 'mini' ? 'Select a template, then create your Mini Terrain diorama.' : templateKind === 'nodes' ? 'Node templates load instantly; open the 2D preview when you need it.' : 'Selecting a template previews it live in the background.')}</p>
              <MatrixButton
                theme="light"
                size="sm"
                className="lp-template-create"
                style={{ '--mb-radius': '10px' }}
                loading={!menuReady || exiting}
                loadingLabel={translateText(exiting ? 'Opening editor' : 'Loading shaders')}
                onClick={() => create(template.id, templateKind)}
              >
                {translateText('Create ')}{translateText(template.name)}
              </MatrixButton>
            </section>
            );
          })()}

          </div>

          <footer className="lp-footer">
            <div className="lp-footer-socials">
              <a className="lp-footer-donation" href="https://ko-fi.com/zyfod" target="_blank" rel="noopener noreferrer" aria-label={translateText("Donate on Ko-fi")} title={translateText("Donate on Ko-fi")}><SiKofi size={15} aria-hidden="true" /><span>{translateText("Donation")}</span></a>
              <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer" aria-label={translateText("Open GitHub repository")} title={translateText("GitHub")}><FaGithub size={17} /></a>
              <a href={AUTHOR_X_URL} target="_blank" rel="noopener noreferrer" aria-label={translateText("Open X profile")} title={translateText("X")}><FaXTwitter size={15} /></a>
              <a href={AUTHOR_PORTFOLIO_URL} target="_blank" rel="noopener noreferrer" aria-label={translateText("Open portfolio")} title={translateText("Portfolio")}><Globe2 size={16} /></a>
              <a href="mailto:zyfodexe@gmail.com" aria-label={translateText("Email zyfodexe@gmail.com")} title={translateText("Email zyfodexe@gmail.com")}><Mail size={16} /></a>
              <button type="button" onClick={copyDiscordUsername} aria-label={translateText("Copy Discord username: zyfou")} title={translateText("Copy Discord username: zyfou")}><FaDiscord size={17} aria-hidden="true" /></button>
            </div>
            <div className="lp-footer-meta">
              <span>© {translateText(new Date().getFullYear())} {translateText(APP_NAME)}.</span>
              <button type="button" className="lp-link" onClick={() => showView('confidentiality')}>{translateText("Confidentiality")}</button>
            </div>
          </footer>
        </main>
      </div>

      {visualBootStage !== 'ready' && (
        <div
          className={`landing-preview-loader is-${bootError ? 'error' : visualBootStage}`}
          role={bootError ? 'alert' : 'status'}
          aria-live="polite"
        >
          <div className="landing-preview-loader-content">
            <strong>{translateText(bootError ? 'Final scene could not be prepared' : visualBootStage === 'loading' ? 'Starting terrain editor' : 'Terrain ready')}</strong>
            <small>{translateText(bootError?.message || (visualBootStage === 'loading' ? 'The first visible frame will be the finished scene.' : 'Bringing your workspace into view…'))}</small>
            {!bootError && (
              <BootTerrainProgress
                bootProgress={bootProgress}
                complete={visualBootStage !== 'loading'}
              />
            )}
            {bootError && (
              <div className="landing-preview-error-actions">
                {bootError.retryable !== false && (
                  <button type="button" onClick={() => onRetryBoot?.()}>{translateText("Retry exact scene")}</button>
                )}
                <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('terrain-boot:diagnostics'))}>{translateText("Export diagnostics")}</button>
              </div>
            )}
          </div>
        </div>
      )}
      <CreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        disabled={!menuReady || exiting}
        onChoose={(workflow) => {
          if (workflow === 'manual') create('manual-blank', 'manual');
          else if (workflow === 'real') create('blank', 'real');
          else chooseTemplateWorkflow(workflow);
        }}
      />
      {creditsOpen && <div className="landing-credits-backdrop" role="presentation" onMouseDown={() => setCreditsOpen(false)}><section ref={creditsRef} tabIndex={-1} className="landing-credits-dialog" role="dialog" aria-modal="true" aria-labelledby="credits-title" onMouseDown={(event) => event.stopPropagation()}><div><span>{translateText("Credits")}</span><h2 id="credits-title">{translateText("Sources & credits")}</h2></div><p>{translateText("The editor cursor set is based on the Windows 11 Light Theme cursor pack by ")}<strong>{translateText(CURSOR_PACK_AUTHOR)}</strong>.</p><a href={CURSOR_PACK_URL} target="_blank" rel="noopener noreferrer">{translateText("View cursor pack")}</a><p>{translateText("Real-world 3D building data: ")}<a href={BUILDING_SOURCE_URL} target="_blank" rel="noopener noreferrer">{translateText(BUILDING_SOURCE)}</a>.</p><SurfacePackCredits /><div className="landing-credits-socials"><a href={AUTHOR_X_URL} target="_blank" rel="noopener noreferrer"><FaXTwitter size={14} />{translateText(" X / Twitter")}</a><a href={AUTHOR_PORTFOLIO_URL} target="_blank" rel="noopener noreferrer"><Globe2 size={14} />{translateText(" Portfolio")}</a></div><button type="button" data-dialog-close onClick={() => setCreditsOpen(false)}>{translateText("Close")}</button></section></div>}
      <DeleteProjectDialog
        project={deleteTarget}
        busy={projectActionBusy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDeleteProject}
      />
    </div>
  );
}
