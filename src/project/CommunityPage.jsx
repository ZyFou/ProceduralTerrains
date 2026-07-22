import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Compass, FolderDown, Globe2, KeyRound, Search, UserRound } from 'lucide-react';
import { avatarUrl } from '../auth/authApi.js';
import { projectStore } from './ProjectStore.js';
import { projectApi } from './projectApi.js';

const normalizeCode = (value) => String(value ?? '').toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 10);

export default function CommunityPage({ onBack, onOpen }) {
  const [projects, setProjects] = useState([]);
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [shareCode, setShareCode] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await projectApi.community({ query: activeQuery, page });
      setProjects(result.projects);
      setPages(result.pages);
      setTotal(result.total);
    } catch (requestError) {
      setError(requestError.message || 'Could not load community projects.');
    } finally {
      setLoading(false);
    }
  }, [activeQuery, page]);

  useEffect(() => { load(); }, [load]);

  const search = (event) => {
    event.preventDefault();
    setPage(1);
    setActiveQuery(query.trim());
  };

  const importByCode = async (code) => {
    const normalized = normalizeCode(code);
    if (normalized.length !== 10) {
      setError('Enter a complete 10-character sharing code.');
      return;
    }
    setBusy(normalized);
    setError('');
    try {
      const result = await projectApi.shared(normalized);
      const imported = await projectStore.importCopy({
        ...result.project.data,
        metadata: {
          ...result.project.data.metadata,
          name: result.project.name,
          description: result.project.description ?? result.project.data.metadata?.description,
          author: result.project.author.displayName || result.project.author.username,
        },
      }, { name: result.project.name });
      onOpen(imported);
    } catch (requestError) {
      setError(requestError.message || 'Could not open this shared project.');
    } finally {
      setBusy('');
    }
  };

  const submitCode = (event) => {
    event.preventDefault();
    importByCode(shareCode);
  };

  return (
    <section className="community-page" aria-labelledby="community-title">
      <button type="button" className="auth-back" onClick={onBack}><ArrowLeft size={14} /> Back to projects</button>
      <header className="community-heading">
        <span><Compass size={14} /> Explore</span>
        <h1 id="community-title">Community terrains</h1>
        <p>Discover public projects, or open an unlisted terrain with its sharing code.</p>
      </header>

      <div className="community-tools">
        <form className="community-search" onSubmit={search}>
          <Search size={14} />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search terrains or creators" aria-label="Search community projects" />
          <button type="submit" className="lp-secondary sm">Search</button>
        </form>
        <form className="community-code" onSubmit={submitCode}>
          <KeyRound size={14} />
          <input value={shareCode} onChange={(event) => setShareCode(normalizeCode(event.target.value))} placeholder="SHARECODE" aria-label="Project sharing code" maxLength={10} />
          <button type="submit" className="lp-primary sm" disabled={busy === shareCode}><FolderDown size={14} /> Open code</button>
        </form>
      </div>

      {error && <div className="community-error" role="alert">{error}</div>}

      <div className="community-results-head">
        <div><h2>{activeQuery ? `Results for “${activeQuery}”` : 'Recently shared'}</h2><span>{total} public project{total === 1 ? '' : 's'}</span></div>
      </div>

      {loading ? <div className="community-state"><Compass size={22} /><span>Loading community projects…</span></div> : projects.length === 0 ? (
        <div className="community-state"><Globe2 size={24} /><strong>No public terrains yet</strong><span>Public projects shared from user accounts will appear here.</span></div>
      ) : (
        <div className="community-grid">
          {projects.map((project) => (
            <article className="community-card" key={project.id}>
              <div className="community-card-art"><Globe2 size={28} /><code>{project.shareCode}</code></div>
              <div className="community-card-body">
                <h3>{project.name}</h3>
                <p>{project.description || 'A shared Procedural Terrains project.'}</p>
                <div className="community-author">
                  <span>{avatarUrl(project.author) ? <img src={avatarUrl(project.author)} alt="" /> : <UserRound size={13} />}</span>
                  <strong>{project.author.displayName || project.author.username}</strong>
                  <small>@{project.author.username}</small>
                </div>
                <button type="button" className="lp-primary sm" onClick={() => importByCode(project.shareCode)} disabled={!!busy}><FolderDown size={14} /> Import and open</button>
              </div>
            </article>
          ))}
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
