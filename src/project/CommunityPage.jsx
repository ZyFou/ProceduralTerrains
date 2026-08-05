import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Boxes, Check, Compass, Copy, Eye, FolderDown, Globe2, Hand,
  Lock, Mountain, Orbit, Pencil, Route, Search, Settings2, UserRound, Waves, X,
} from 'lucide-react';
import { avatarUrl } from '../auth/authApi.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { projectStore } from './ProjectStore.js';
import { projectApi } from './projectApi.js';
import { usePopup } from '../components/ui/PopupProvider.jsx';

const normalizeCode = (value) => String(value ?? '').toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 10);
const COMMUNITY_TYPES = [
  { id: 'procedural', label: 'Procedural' },
  { id: 'nodes', label: 'Nodes' },
  { id: 'manual', label: 'Manual' },
];
const COMMUNITY_ICONS = [
  { id: 'mountain', label: 'Mountain', Icon: Mountain },
  { id: 'boxes', label: 'Nodes', Icon: Boxes },
  { id: 'hand', label: 'Manual', Icon: Hand },
  { id: 'waves', label: 'Waves', Icon: Waves },
  { id: 'orbit', label: 'Orbit', Icon: Orbit },
  { id: 'route', label: 'Route', Icon: Route },
];
const ICON_BY_ID = new Map(COMMUNITY_ICONS.map((option) => [option.id, option]));
const DEFAULT_ICON_BY_TYPE = { procedural: 'mountain', nodes: 'boxes', manual: 'hand' };

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

function shareCodeFromHash() {
  const query = window.location.hash.split('?')[1] ?? '';
  return new URLSearchParams(query).get('code') ?? '';
}

function shareLinkFor(code) {
  const url = new URL(window.location.href);
  url.hash = `/community?code=${encodeURIComponent(normalizeCode(code))}`;
  return url.toString();
}

function typeLabel(type) {
  return COMMUNITY_TYPES.find((option) => option.id === type)?.label ?? 'Terrain';
}

function iconForProject(project) {
  return ICON_BY_ID.get(project.communityIcon)
    ?? ICON_BY_ID.get(DEFAULT_ICON_BY_TYPE[project.editorMode])
    ?? COMMUNITY_ICONS[0];
}

export default function CommunityPage({ onBack, onOpen, ready = true }) {
  const { user } = useAuth();
  const { showPopup, showPrompt } = usePopup();
  const [projects, setProjects] = useState([]);
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [activeType, setActiveType] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [editingId, setEditingId] = useState('');
  const [copiedCode, setCopiedCode] = useState('');
  const pendingOpenRef = useRef(null);
  const autoOpenCodeRef = useRef('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await projectApi.community({ query: activeQuery, type: activeType, page });
      setProjects(result.projects);
      setPages(result.pages);
      setTotal(result.total);
    } catch (requestError) {
      showPopup(requestError.message || 'Could not load community projects.', { type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [activeQuery, activeType, page, showPopup]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!ready || !pendingOpenRef.current) return;
    const project = pendingOpenRef.current;
    pendingOpenRef.current = null;
    onOpen(project);
  }, [onOpen, ready]);

  const importByCode = useCallback(async (code) => {
    const normalized = normalizeCode(code);
    if (normalized.length !== 10) {
      showPopup('Search with a complete 10-character sharing code.', { type: 'error', title: 'Incomplete sharing code' });
      return;
    }
    setBusy(normalized);
    try {
      const result = await projectApi.shared(normalized);
      const imported = await projectStore.importCopy({
        ...result.project.data,
        metadata: {
          ...(result.project.data.metadata ?? {}),
          name: result.project.name,
          description: result.project.description ?? result.project.data.metadata?.description,
          author: result.project.author.displayName || result.project.author.username,
          communityIcon: result.project.communityIcon ?? result.project.data.metadata?.communityIcon,
        },
      }, { name: result.project.name });
      if (ready) onOpen(imported);
      else pendingOpenRef.current = imported;
    } catch (requestError) {
      showPopup(requestError.message || 'Could not open this shared project.', { type: 'error' });
    } finally {
      setBusy('');
    }
  }, [onOpen, ready, showPopup]);

  useEffect(() => {
    const code = normalizeCode(shareCodeFromHash());
    if (code.length !== 10 || autoOpenCodeRef.current === code) return;
    autoOpenCodeRef.current = code;
    importByCode(code);
  }, [importByCode]);

  const search = (event) => {
    event.preventDefault();
    setPage(1);
    setActiveQuery(query.trim());
  };

  const selectType = (type) => {
    setPage(1);
    setActiveType(type);
  };

  const copyShareLink = async (code) => {
    const normalized = normalizeCode(code);
    try {
      await copyText(shareLinkFor(normalized));
      setCopiedCode(normalized);
      showPopup('Opening link copied to your clipboard.', { type: 'success' });
      window.setTimeout(() => setCopiedCode((current) => current === normalized ? '' : current), 1800);
    } catch (copyError) {
      showPopup(copyError.message || 'Could not copy the opening link.', { type: 'error' });
    }
  };

  const updateOwnerProject = useCallback(async (project, input, successMessage) => {
    setBusy(project.id);
    try {
      const result = await projectApi.update(project.id, input);
      if (result.project.visibility === 'public') {
        setProjects((current) => current.map((item) => item.id === project.id ? { ...item, ...result.project } : item));
      } else {
        await load();
        setEditingId('');
      }
      showPopup(successMessage, { type: 'success' });
    } catch (requestError) {
      showPopup(requestError.message || 'Could not update this terrain.', { type: 'error' });
    } finally {
      setBusy('');
    }
  }, [load, showPopup]);

  const rename = async (project) => {
    const name = (await showPrompt({
      title: 'Rename community terrain',
      inputLabel: 'Terrain name',
      initialValue: project.name,
      confirmLabel: 'Rename',
      maxLength: 120,
    }))?.trim();
    if (!name || name === project.name) return;
    await updateOwnerProject(project, { name }, `Renamed to ${name}.`);
  };

  const ownerProjects = useMemo(() => new Set(
    projects.filter((project) => user?.id && project.author?.id === user.id).map((project) => project.id),
  ), [projects, user?.id]);

  const resultsTitle = activeQuery
    ? `Results for “${activeQuery}”`
    : activeType ? `${typeLabel(activeType)} terrains` : 'Recently shared';

  return (
    <section className="community-page" aria-labelledby="community-title">
      <button type="button" className="auth-back" onClick={onBack}><ArrowLeft size={14} /> Back to projects</button>
      <header className="community-heading">
        <span><Compass size={14} /> Explore</span>
        <h1 id="community-title">Community terrains</h1>
        <p>Discover public projects, copy an opening link, and find terrains by name, creator, or sharing code.</p>
      </header>

      <form className="community-search" onSubmit={search}>
        <Search size={14} aria-hidden />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search names, creators, or sharing codes" aria-label="Search community projects" />
        <button type="submit" className="lp-secondary sm">Search</button>
      </form>

      <div className="community-filters" role="tablist" aria-label="Filter community terrains by editor">
        <button type="button" role="tab" aria-selected={!activeType} className={!activeType ? 'active' : ''} onClick={() => selectType('')}>All terrains</button>
        {COMMUNITY_TYPES.map((option) => (
          <button type="button" role="tab" key={option.id} aria-selected={activeType === option.id} className={activeType === option.id ? 'active' : ''} onClick={() => selectType(option.id)}>{option.label}</button>
        ))}
      </div>

      <div className="community-results-head">
        <div><h2>{resultsTitle}</h2><span>{total} public project{total === 1 ? '' : 's'}</span></div>
        {activeQuery && <button type="button" className="community-clear-search" onClick={() => { setQuery(''); setActiveQuery(''); setPage(1); }}><X size={12} /> Clear search</button>}
      </div>

      {loading ? <div className="community-state"><Compass size={22} /><span>Loading community projects…</span></div> : projects.length === 0 ? (
        <div className="community-state"><Globe2 size={24} /><strong>No terrains match these filters</strong><span>Try another search or browse all public terrains.</span></div>
      ) : (
        <div className="community-grid">
          {projects.map((project) => {
            const { Icon } = iconForProject(project);
            const isOwner = ownerProjects.has(project.id);
            const disabled = !!busy;
            const selectedCommunityIcon = project.communityIcon ?? DEFAULT_ICON_BY_TYPE[project.editorMode] ?? COMMUNITY_ICONS[0].id;
            return (
              <article className={`community-card${isOwner ? ' is-owner' : ''}`} key={project.id}>
                <div className={`community-card-art ${project.editorMode || 'procedural'}`}>
                  <span className="community-card-icon"><Icon size={30} aria-hidden /></span>
                  <span className="community-card-type">{typeLabel(project.editorMode)}</span>
                  <button type="button" className="community-share-link" onClick={() => copyShareLink(project.shareCode)} title="Copy opening link" aria-label={`Copy opening link for ${project.name}`}>
                    {copiedCode === project.shareCode ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}<code>{project.shareCode}</code>
                  </button>
                </div>
                <div className="community-card-body">
                  <div className="community-card-title-row"><h3>{project.name}</h3>{isOwner && <span className="community-owner-badge">Your terrain</span>}</div>
                  <p>{project.description || `A shared ${typeLabel(project.editorMode)} Terrains project.`}</p>
                  <div className="community-author">
                    <span>{avatarUrl(project.author) ? <img src={avatarUrl(project.author)} alt="" /> : <UserRound size={13} />}</span>
                    <strong>{project.author.displayName || project.author.username}</strong>
                    <small>@{project.author.username}</small>
                  </div>
                  <div className="community-card-actions">
                    <button type="button" className="lp-primary sm" onClick={() => importByCode(project.shareCode)} disabled={disabled || !ready}><FolderDown size={14} /> Import and open</button>
                    {isOwner && <button type="button" className={`lp-secondary sm community-edit-button${editingId === project.id ? ' active' : ''}`} onClick={() => setEditingId((current) => current === project.id ? '' : project.id)} disabled={disabled}><Settings2 size={13} /> Edit</button>}
                  </div>
                  {isOwner && editingId === project.id && (
                    <div className="community-owner-panel">
                      <div className="community-owner-panel-head"><strong>Manage terrain</strong><button type="button" onClick={() => setEditingId('')} aria-label="Close terrain settings"><X size={13} /></button></div>
                      <div className="community-owner-actions">
                        <button type="button" className="lp-secondary sm" onClick={() => rename(project)} disabled={disabled}><Pencil size={13} /> Rename</button>
                        <label className="community-visibility-select"><span>Visibility</span><span className="community-select-wrap">{project.visibility === 'public' ? <Globe2 size={12} /> : project.visibility === 'unlisted' ? <Eye size={12} /> : <Lock size={12} />}<select value={project.visibility} onChange={(event) => updateOwnerProject(project, { visibility: event.target.value }, `Visibility changed to ${event.target.value}.`)} disabled={disabled} aria-label={`Visibility for ${project.name}`}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></span></label>
                      </div>
                      <div className="community-icon-picker"><span>Card icon</span><div>{COMMUNITY_ICONS.map((option) => { const OptionIcon = option.Icon; return <button type="button" key={option.id} className={selectedCommunityIcon === option.id ? 'active' : ''} onClick={() => updateOwnerProject(project, { communityIcon: option.id }, `${option.label} icon selected.`)} disabled={disabled} title={option.label} aria-label={`Use ${option.label} icon`}><OptionIcon size={14} /></button>; })}</div></div>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {pages > 1 && <nav className="community-pagination" aria-label="Community pages">
        <button type="button" className="lp-secondary sm" onClick={() => setPage((value) => value - 1)} disabled={page <= 1 || loading}><ArrowLeft size={13} /> Previous</button>
        <span>Page {page} of {pages}</span>
        <button type="button" className="lp-secondary sm" onClick={() => setPage((value) => value + 1)} disabled={page >= pages || loading}>Next <ArrowRight size={13} /></button>
      </nav>}
    </section>
  );
}
