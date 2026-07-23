import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowLeft, BarChart3, CheckCircle2, ChevronLeft, ChevronRight, CircleUserRound,
  Clock3, Eye, FileClock, FolderKanban, KeyRound, Laptop, LockKeyhole, RefreshCw, Search,
  ShieldAlert, ShieldCheck, Smartphone, Tablet, UserCheck, UserCog, UsersRound, UserX,
} from 'lucide-react';
import { adminApi } from './adminApi.js';
import { usePopup } from '../components/ui/PopupProvider.jsx';

const TABS = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'users', label: 'Users', icon: UsersRound },
  { id: 'visits', label: 'Visits', icon: Eye },
  { id: 'terrains', label: 'Terrains', icon: FolderKanban },
  { id: 'audit', label: 'Audit log', icon: FileClock },
  { id: 'security', label: 'Security', icon: ShieldCheck },
];

const number = new Intl.NumberFormat();
const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const dateTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const formatDate = (value, fallback = 'Never') => value ? dateTime.format(new Date(value)) : fallback;
const actionLabel = (value = '') => value.split('.').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' · ');
const localDayKey = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

function LoadingState() {
  return <div className="admin-loading" role="status"><span /><strong>Loading secure data</strong><small>Retrieving the latest administration records…</small></div>;
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="admin-error" role="alert">
      <ShieldAlert size={22} />
      <strong>Couldn&apos;t load this view</strong>
      <span>{message || 'The administration service did not respond.'}</span>
      <button type="button" onClick={onRetry}><RefreshCw size={13} /> Try again</button>
    </div>
  );
}

function Pagination({ page, pages, onPage }) {
  if (pages <= 1) return null;
  return (
    <nav className="admin-pagination" aria-label="Results pages">
      <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1}><ChevronLeft size={14} /> Previous</button>
      <span>Page <strong>{page}</strong> of {pages}</span>
      <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages}>Next <ChevronRight size={14} /></button>
    </nav>
  );
}

function TrendChart({ data = [], valueKey = 'visits' }) {
  const points = useMemo(() => {
    const byDay = new Map(data.map((item) => [localDayKey(item.day), item]));
    return Array.from({ length: 14 }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (13 - index));
      const key = localDayKey(date);
      return { day: date, value: Number(byDay.get(key)?.[valueKey] ?? 0) };
    });
  }, [data, valueKey]);
  const max = Math.max(1, ...points.map((item) => item.value));
  return (
    <div className="admin-chart" role="img" aria-label={`Daily ${valueKey.replace(/([A-Z])/g, ' $1').toLowerCase()} over the last 14 days`}>
      <div className="admin-chart-grid" aria-hidden="true"><i /><i /><i /></div>
      <div className="admin-chart-bars">
        {points.map((item, index) => (
          <span className="admin-chart-column" key={item.day.toISOString()} title={`${shortDate.format(item.day)}: ${number.format(item.value)}`}>
            <i style={{ height: `${Math.max(item.value ? 6 : 2, (item.value / max) * 100)}%` }} />
            {(index === 0 || index === 6 || index === 13) && <small>{shortDate.format(item.day)}</small>}
          </span>
        ))}
      </div>
    </div>
  );
}

function Overview({ data, onNavigate }) {
  const stats = [
    { label: 'Total users', value: data.counts.users, meta: `${number.format(data.counts.activeUsers)} active`, icon: UsersRound, tone: 'blue' },
    { label: 'Visits today', value: data.counts.visitsToday, meta: `${number.format(data.counts.uniqueToday)} unique`, icon: Activity, tone: 'green' },
    { label: 'Terrains', value: data.counts.terrains, meta: 'Across all users', icon: FolderKanban, tone: 'violet' },
    { label: 'Open sessions', value: data.counts.openSessions, meta: 'Unexpired sessions', icon: KeyRound, tone: 'amber' },
  ];
  return (
    <div className="admin-overview">
      <section className="admin-stat-grid" aria-label="Service overview">
        {stats.map(({ label, value, meta, icon: Icon, tone }) => (
          <article className={`admin-stat ${tone}`} key={label}>
            <span className="admin-stat-icon"><Icon size={18} /></span>
            <span><small>{label}</small><strong>{number.format(value)}</strong><em>{meta}</em></span>
          </article>
        ))}
      </section>

      <section className="admin-panel admin-trend-panel">
        <header>
          <div><span className="admin-eyebrow">Traffic</span><h2>Visits over the last 14 days</h2></div>
          <button type="button" className="admin-text-button" onClick={() => onNavigate('visits')}>View visit log <ChevronRight size={13} /></button>
        </header>
        <TrendChart data={data.visitTrend} />
        <div className="admin-chart-legend"><span><i className="blue" /> Page visits</span><span><i className="muted" /> UTC day</span></div>
      </section>

      <div className="admin-overview-columns">
        <section className="admin-panel">
          <header><div><span className="admin-eyebrow">Latest work</span><h2>Recent terrains</h2></div><button type="button" className="admin-icon-button" onClick={() => onNavigate('terrains')} aria-label="View all terrains"><ChevronRight size={15} /></button></header>
          <div className="admin-compact-list">
            {data.recentTerrains.length === 0 && <p className="admin-empty">No cloud terrains yet.</p>}
            {data.recentTerrains.map((terrain) => (
              <div key={terrain.id}>
                <span className="admin-list-icon"><FolderKanban size={14} /></span>
                <span><strong>{terrain.name}</strong><small>@{terrain.username} · {formatDate(terrain.updatedAt)}</small></span>
                <span className={`admin-badge ${terrain.visibility}`}>{terrain.visibility}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="admin-panel">
          <header><div><span className="admin-eyebrow">Accountability</span><h2>Administrator activity</h2></div><button type="button" className="admin-icon-button" onClick={() => onNavigate('audit')} aria-label="View audit log"><ChevronRight size={15} /></button></header>
          <div className="admin-compact-list audit">
            {data.recentAudit.length === 0 && <p className="admin-empty">No administrator changes recorded yet.</p>}
            {data.recentAudit.map((event) => (
              <div key={event.id}>
                <span className="admin-list-icon"><FileClock size={14} /></span>
                <span><strong>{actionLabel(event.action)}</strong><small>{event.actor} · {formatDate(event.createdAt)}</small></span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function UsersPanel({ currentUser }) {
  const { showPopup, showConfirm } = usePopup();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setData(await adminApi.users({ page, q: query, status, role })); }
    catch (nextError) { setError(nextError.message); }
  }, [page, query, status, role]);
  useEffect(() => { load(); }, [load]);

  const update = async (target, patch) => {
    const isSuspend = patch.status === 'suspended';
    const isDemote = patch.role === 'user';
    const confirmed = await showConfirm({
      title: isSuspend ? 'Suspend this account?' : isDemote ? 'Remove administrator access?' : 'Confirm account change',
      message: isSuspend
        ? `${target.username} will be signed out everywhere and unable to sign in until reactivated.`
        : isDemote ? `${target.username} will immediately lose access to administration data.`
          : `Apply this change to ${target.username}?`,
      confirmLabel: isSuspend ? 'Suspend account' : 'Apply change',
      danger: isSuspend || isDemote,
    });
    if (!confirmed) return;
    setBusy(target.id);
    try {
      const result = await adminApi.updateUser(target.id, patch);
      setData((current) => ({ ...current, users: current.users.map((user) => user.id === target.id ? result.user : user) }));
      showPopup('The account was updated and the action was added to the audit log.', { type: 'success', title: 'User updated' });
    } catch (nextError) {
      showPopup(nextError.message, { type: 'error', title: 'Update blocked' });
    } finally { setBusy(''); }
  };

  const revoke = async (target) => {
    const confirmed = await showConfirm({
      title: 'Revoke all sessions?',
      message: `${target.username} will be signed out on every device. Their password will not change.`,
      confirmLabel: 'Revoke sessions',
      danger: true,
    });
    if (!confirmed) return;
    setBusy(target.id);
    try {
      const result = await adminApi.revokeSessions(target.id);
      setData((current) => ({ ...current, users: current.users.map((user) => user.id === target.id ? { ...user, activeSessions: 0 } : user) }));
      showPopup(`${result.revoked} session${result.revoked === 1 ? '' : 's'} revoked.`, { type: 'success', title: 'Sessions closed' });
    } catch (nextError) {
      showPopup(nextError.message, { type: 'error', title: 'Could not revoke sessions' });
    } finally { setBusy(''); }
  };

  return (
    <section className="admin-panel admin-data-panel">
      <header className="admin-data-head">
        <div><span className="admin-eyebrow">Accounts</span><h2>User management</h2><p>Review access, roles, account status, and sessions.</p></div>
        <button type="button" className="admin-refresh" onClick={load}><RefreshCw size={13} /> Refresh</button>
      </header>
      <form className="admin-filters" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(search); }}>
        <label className="admin-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, username, or email" aria-label="Search users" /></label>
        <select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }} aria-label="Filter user status">
          <option value="">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option>
        </select>
        <select value={role} onChange={(event) => { setPage(1); setRole(event.target.value); }} aria-label="Filter user role">
          <option value="">All roles</option><option value="admin">Administrators</option><option value="user">Members</option>
        </select>
        <button type="submit">Search</button>
      </form>
      {!data && !error && <LoadingState />}
      {error && <ErrorState message={error} onRetry={load} />}
      {data && (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>User</th><th>Status</th><th>Role</th><th>Terrains</th><th>Sessions</th><th>Last seen</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.users.map((user) => (
                  <tr key={user.id}>
                    <td><span className="admin-user-cell"><span className="admin-user-avatar">{(user.displayName || user.username).slice(0, 2).toUpperCase()}</span><span><strong>{user.displayName || user.username}{user.id === currentUser.id && <em>You</em>}</strong><small>@{user.username} · {user.email}</small></span></span></td>
                    <td><span className={`admin-status ${user.status}`}><i />{user.status}</span></td>
                    <td><span className={`admin-role ${user.role}`}><ShieldCheck size={12} /> {user.role}</span></td>
                    <td>{number.format(user.projectCount)}</td>
                    <td>{number.format(user.activeSessions)}</td>
                    <td><span className="admin-muted">{formatDate(user.lastSeenAt)}</span></td>
                    <td>
                      <div className="admin-row-actions">
                        {user.status === 'active'
                          ? <button type="button" className="danger" disabled={busy === user.id || user.id === currentUser.id} onClick={() => update(user, { status: 'suspended' })}><UserX size={13} /> Suspend</button>
                          : <button type="button" disabled={busy === user.id} onClick={() => update(user, { status: 'active' })}><UserCheck size={13} /> Activate</button>}
                        {user.role === 'admin'
                          ? <button type="button" disabled={busy === user.id || user.id === currentUser.id} onClick={() => update(user, { role: 'user' })}><CircleUserRound size={13} /> Make member</button>
                          : <button type="button" disabled={busy === user.id} onClick={() => update(user, { role: 'admin' })}><UserCog size={13} /> Make admin</button>}
                        <button type="button" disabled={busy === user.id || user.id === currentUser.id || user.activeSessions === 0} onClick={() => revoke(user)}><KeyRound size={13} /> Revoke sessions</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.users.length === 0 && <p className="admin-empty">No users match these filters.</p>}
          </div>
          <footer className="admin-results-footer"><span>{number.format(data.total)} user{data.total === 1 ? '' : 's'}</span><Pagination page={data.page} pages={data.pages} onPage={setPage} /></footer>
        </>
      )}
    </section>
  );
}

function VisitsPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [days, setDays] = useState(30);
  const load = useCallback(async () => {
    setError('');
    try { setData(await adminApi.visits({ page, days })); }
    catch (nextError) { setError(nextError.message); }
  }, [page, days]);
  useEffect(() => { load(); }, [load]);
  const DeviceIcon = ({ device }) => device === 'Mobile' ? <Smartphone size={13} /> : device === 'Tablet' ? <Tablet size={13} /> : <Laptop size={13} />;
  return (
    <div className="admin-stack">
      {data && <section className="admin-panel admin-trend-panel"><header><div><span className="admin-eyebrow">Audience</span><h2>Visits and unique visitors</h2></div><select value={days} onChange={(event) => { setPage(1); setDays(Number(event.target.value)); }} aria-label="Visit reporting period"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></header><TrendChart data={data.trend} /><div className="admin-chart-legend"><span><i className="blue" /> Page visits</span><span><i className="green" /> Unique visitors are privacy-safe estimates</span></div></section>}
      <section className="admin-panel admin-data-panel">
        <header className="admin-data-head"><div><span className="admin-eyebrow">Recent traffic</span><h2>Visit log</h2><p>Raw network addresses are never shown or stored.</p></div><button type="button" className="admin-refresh" onClick={load}><RefreshCw size={13} /> Refresh</button></header>
        {!data && !error && <LoadingState />}{error && <ErrorState message={error} onRetry={load} />}
        {data && <><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Time</th><th>Path</th><th>Visitor</th><th>Device</th><th>Referrer</th></tr></thead><tbody>{data.visits.map((visit) => <tr key={visit.id}><td><span className="admin-muted">{formatDate(visit.createdAt)}</span></td><td><code>{visit.path}</code></td><td>{visit.username ? `@${visit.username}` : <span className="admin-muted">Anonymous</span>}</td><td><span className="admin-device"><DeviceIcon device={visit.device} />{visit.device}</span></td><td><span className="admin-muted">{visit.referrerHost || 'Direct'}</span></td></tr>)}</tbody></table>{data.visits.length === 0 && <p className="admin-empty">No visits in this period.</p>}</div><footer className="admin-results-footer"><span>{number.format(data.total)} visits</span><Pagination page={data.page} pages={data.pages} onPage={setPage} /></footer></>}
      </section>
    </div>
  );
}

function TerrainsPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [visibility, setVisibility] = useState('');
  const load = useCallback(async () => {
    setError('');
    try { setData(await adminApi.terrains({ page, q: query, visibility })); }
    catch (nextError) { setError(nextError.message); }
  }, [page, query, visibility]);
  useEffect(() => { load(); }, [load]);
  return (
    <section className="admin-panel admin-data-panel">
      <header className="admin-data-head"><div><span className="admin-eyebrow">Cloud library</span><h2>Recent terrains</h2><p>Metadata only; private terrain content is not exposed here.</p></div><button type="button" className="admin-refresh" onClick={load}><RefreshCw size={13} /> Refresh</button></header>
      <form className="admin-filters" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(search); }}><label className="admin-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search terrain or owner" aria-label="Search terrains" /></label><select value={visibility} onChange={(event) => { setPage(1); setVisibility(event.target.value); }} aria-label="Filter terrain visibility"><option value="">All visibility</option><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select><button type="submit">Search</button></form>
      {!data && !error && <LoadingState />}{error && <ErrorState message={error} onRetry={load} />}
      {data && <><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Terrain</th><th>Owner</th><th>Visibility</th><th>Revision</th><th>Created</th><th>Last updated</th></tr></thead><tbody>{data.terrains.map((terrain) => <tr key={terrain.id}><td><span className="admin-terrain-cell"><span className="admin-list-icon"><FolderKanban size={14} /></span><span><strong>{terrain.name}</strong><small>{terrain.description || 'No description'}</small></span></span></td><td>@{terrain.owner.username}</td><td><span className={`admin-badge ${terrain.visibility}`}>{terrain.visibility}</span></td><td>v{terrain.contentRevision}</td><td><span className="admin-muted">{formatDate(terrain.createdAt)}</span></td><td><span className="admin-muted">{formatDate(terrain.updatedAt)}</span></td></tr>)}</tbody></table>{data.terrains.length === 0 && <p className="admin-empty">No terrains match these filters.</p>}</div><footer className="admin-results-footer"><span>{number.format(data.total)} terrains</span><Pagination page={data.page} pages={data.pages} onPage={setPage} /></footer></>}
    </section>
  );
}

function AuditPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const load = useCallback(async () => {
    setError('');
    try { setData(await adminApi.audit({ page, q: query })); }
    catch (nextError) { setError(nextError.message); }
  }, [page, query]);
  useEffect(() => { load(); }, [load]);
  return (
    <section className="admin-panel admin-data-panel">
      <header className="admin-data-head"><div><span className="admin-eyebrow">Accountability</span><h2>Administrator audit log</h2><p>Security-sensitive administrator actions are recorded with their actor and target.</p></div><button type="button" className="admin-refresh" onClick={load}><RefreshCw size={13} /> Refresh</button></header>
      <form className="admin-filters compact" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(search); }}><label className="admin-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search action, actor, or target ID" aria-label="Search audit log" /></label><button type="submit">Search</button></form>
      {!data && !error && <LoadingState />}{error && <ErrorState message={error} onRetry={load} />}
      {data && <><div className="admin-audit-list">{data.events.map((event) => <article key={event.id}><span className="admin-audit-mark"><FileClock size={14} /></span><div><header><strong>{actionLabel(event.action)}</strong><span>{formatDate(event.createdAt)}</span></header><p><b>{event.actor}</b> changed {event.targetType}{event.targetId ? ` ${event.targetId}` : ''}.</p>{event.metadata?.changes && <div className="admin-change-chips">{Object.entries(event.metadata.changes).map(([key, value]) => <span key={key}>{key}: <strong>{String(value)}</strong></span>)}</div>}</div></article>)}{data.events.length === 0 && <p className="admin-empty">No audit events match this search.</p>}</div><footer className="admin-results-footer"><span>{number.format(data.total)} audit events</span><Pagination page={data.page} pages={data.pages} onPage={setPage} /></footer></>}
    </section>
  );
}

function SecurityPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try { setData(await adminApi.security()); }
    catch (nextError) { setError(nextError.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!data && !error) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  const stats = [
    { label: 'Failed sign-ins · 24h', value: data.summary.failedLogins, icon: ShieldAlert, danger: data.summary.failedLogins > 10 },
    { label: 'Open sessions', value: data.summary.openSessions, icon: KeyRound },
    { label: 'Suspended users', value: data.summary.suspendedUsers, icon: UserX },
    { label: 'Active administrators', value: data.summary.admins, icon: ShieldCheck },
  ];
  return (
    <div className="admin-stack">
      <section className="admin-security-grid">{stats.map(({ label, value, icon: Icon, danger }) => <article className={danger ? 'danger' : ''} key={label}><Icon size={18} /><span><strong>{number.format(value)}</strong><small>{label}</small></span></article>)}</section>
      <section className="admin-panel admin-security-note"><LockKeyhole size={19} /><div><strong>Security controls are active</strong><p>Server-side role checks, exact-origin enforcement, HTTP-only cookies, rate limits, privacy-safe identifiers, password hashing, and administrator audit events protect this area.</p></div></section>
      <section className="admin-panel admin-data-panel"><header className="admin-data-head"><div><span className="admin-eyebrow">Authentication</span><h2>Recent security events</h2><p>Identifiers and network addresses are not exposed.</p></div><button type="button" className="admin-refresh" onClick={load}><RefreshCw size={13} /> Refresh</button></header><div className="admin-security-events">{data.events.map((event) => <div key={event.id}><span className={`admin-event-icon ${event.outcome}`}>{event.outcome === 'success' ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}</span><span><strong>{actionLabel(event.type)}</strong><small>{event.username ? `@${event.username}` : 'Unknown account'} · {formatDate(event.createdAt)}</small></span><span className={`admin-status ${event.outcome}`}><i />{event.outcome}</span></div>)}{data.events.length === 0 && <p className="admin-empty">No security events recorded yet.</p>}</div></section>
    </div>
  );
}

export default function AdminDashboard({ user, onBack }) {
  const [tab, setTab] = useState('overview');
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
  const loadOverview = useCallback(async () => {
    setError('');
    try { setOverview(await adminApi.overview()); }
    catch (nextError) { setError(nextError.message); }
  }, []);
  useEffect(() => { loadOverview(); }, [loadOverview]);
  const title = TABS.find((item) => item.id === tab)?.label ?? 'Overview';

  return (
    <section className="admin-dashboard" aria-labelledby="admin-title">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-heading"><span className="admin-shield"><ShieldCheck size={18} /></span><span><strong>Admin console</strong><small>Three Terrain</small></span></div>
        <nav aria-label="Administration">
          {TABS.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={15} /><span>{label}</span></button>)}
        </nav>
        <div className="admin-sidebar-account"><span>{(user.displayName || user.username).slice(0, 2).toUpperCase()}</span><div><strong>{user.displayName || user.username}</strong><small>Administrator</small></div></div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar-title">
            <button type="button" className="admin-back" onClick={onBack}><ArrowLeft size={15} /> Exit admin</button>
            <div><span>Three Terrain back office</span><h1 id="admin-title">{title}</h1></div>
          </div>
          <div className="admin-secure-indicator"><LockKeyhole size={13} /><span>Secure admin session</span></div>
        </header>
        <div className="admin-mobile-tabs" role="tablist" aria-label="Administration sections">{TABS.map(({ id, label }) => <button type="button" role="tab" aria-selected={tab === id} key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
        <div className="admin-page">
          {tab === 'overview' && !overview && !error && <LoadingState />}
          {tab === 'overview' && error && <ErrorState message={error} onRetry={loadOverview} />}
          {tab === 'overview' && overview && <Overview data={overview} onNavigate={setTab} />}
          {tab === 'users' && <UsersPanel currentUser={user} />}
          {tab === 'visits' && <VisitsPanel />}
          {tab === 'terrains' && <TerrainsPanel />}
          {tab === 'audit' && <AuditPanel />}
          {tab === 'security' && <SecurityPanel />}
        </div>
      </div>
    </section>
  );
}
