import { getLocale } from '../i18n/language.js';
import { translateText, useLanguage } from '../i18n/LanguageContext.jsx';
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

const number = { format: (value) => new Intl.NumberFormat(getLocale()).format(value) };
const shortDate = { format: (value) => new Intl.DateTimeFormat(getLocale(), { month: 'short', day: 'numeric' }).format(value) };
const dateTime = { format: (value) => new Intl.DateTimeFormat(getLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value) };

const formatDate = (value, fallback = 'Never') => value ? dateTime.format(new Date(value)) : fallback;
const actionLabel = (value = '') => value.split('.').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' · ');
const localDayKey = (value) => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

function LoadingState() {
  useLanguage();
  return <div className="admin-loading" role="status"><span /><strong>{translateText("Loading secure data")}</strong><small>{translateText("Retrieving the latest administration records…")}</small></div>;
}

function ErrorState({ message, onRetry }) {
  useLanguage();
  return (
    <div className="admin-error" role="alert">
      <ShieldAlert size={22} />
      <strong>{translateText("Couldn't load this view")}</strong>
      <span>{translateText(message || 'The administration service did not respond.')}</span>
      <button type="button" onClick={onRetry}><RefreshCw size={13} />{translateText(" Try again")}</button>
    </div>
  );
}

function Pagination({ page, pages, onPage }) {
  useLanguage();
  if (pages <= 1) return null;
  return (
    <nav className="admin-pagination" aria-label={translateText("Results pages")}>
      <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1}><ChevronLeft size={14} />{translateText(" Previous")}</button>
      <span>{translateText("Page ")}<strong>{translateText(page)}</strong>{translateText(" of ")}{translateText(pages)}</span>
      <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages}>{translateText("Next ")}<ChevronRight size={14} /></button>
    </nav>
  );
}

function TrendChart({ data = [], valueKey = 'visits', days: requestedDays = 14, valueLabel: requestedValueLabel }) {
  useLanguage();
  const days = Math.max(1, Number(requestedDays) || 14);
  const valueLabel = requestedValueLabel || valueKey.replace(/([A-Z])/g, ' $1').toLowerCase();
  const points = useMemo(() => {
    const byDay = new Map(data.map((item) => [localDayKey(item.day), item]));
    return Array.from({ length: days }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (days - 1 - index));
      const key = localDayKey(date);
      return { day: date, value: Number(byDay.get(key)?.[valueKey] ?? 0) };
    });
  }, [data, days, valueKey]);
  const max = Math.max(1, ...points.map((item) => item.value));
  const labelStep = days <= 7 ? 2 : days <= 31 ? 7 : 14;
  const shouldLabel = (index) => index === 0 || index === points.length - 1 || index % labelStep === 0;
  const [activeIndex, setActiveIndex] = useState(null);
  return (
    <div className="admin-chart" role="group" aria-label={translateText(`Daily ${valueLabel} over the last ${days} days`)}>
      <div className="admin-chart-grid" aria-hidden="true"><i /><i /><i /></div>
      <div className="admin-chart-bars">
        {points.map((item, index) => (
          <span
            className={`admin-chart-column ${activeIndex === index ? 'is-active' : ''}`}
            key={item.day.toISOString()}
            tabIndex="0"
            aria-label={translateText(`${shortDate.format(item.day)}: ${number.format(item.value)} ${valueLabel}`)}
            onMouseEnter={() => setActiveIndex(index)}
            onMouseLeave={() => setActiveIndex(null)}
            onFocus={() => setActiveIndex(index)}
            onBlur={() => setActiveIndex(null)}
          >
            <span className="admin-chart-bar" style={{ height: `${Math.max(item.value ? 6 : 2, (item.value / max) * 100)}%` }}>
              <span className="admin-chart-tooltip" role="status"><strong>{translateText(number.format(item.value))}</strong><small>{translateText(shortDate.format(item.day))}</small><em>{translateText(valueLabel)}</em></span>
            </span>
            {shouldLabel(index) && <small>{translateText(shortDate.format(item.day))}</small>}
          </span>
        ))}
      </div>
    </div>
  );
}

const REPORTING_RANGES = [
  { value: 7, label: 'Weekly' },
  { value: 30, label: 'Monthly' },
  { value: 90, label: '90 days' },
];

function RangeSelector({ value, onChange, label = 'Reporting period' }) {
  useLanguage();
  return (
    <div className="admin-range-selector" role="group" aria-label={translateText(label)}>
      {REPORTING_RANGES.map((range) => (
        <button type="button" key={range.value} className={value === range.value ? 'active' : ''} onClick={() => onChange(range.value)} aria-pressed={value === range.value}>
          {translateText(range.label)}
        </button>
      ))}
    </div>
  );
}

function Overview({ data, onNavigate, rangeDays, onRangeChange }) {
  useLanguage();
  const rangeLabel = REPORTING_RANGES.find((range) => range.value === rangeDays)?.label.toLowerCase() || `${rangeDays} days`;
  const stats = [
    { label: 'Total users', value: data.counts.users, meta: `${number.format(data.counts.activeUsers)} active`, icon: UsersRound, tone: 'blue' },
    { label: 'Visits today', value: data.counts.visitsToday, meta: `${number.format(data.counts.uniqueToday)} unique`, icon: Activity, tone: 'green' },
    { label: 'Terrains', value: data.counts.terrains, meta: 'Across all users', icon: FolderKanban, tone: 'violet' },
    { label: 'Open sessions', value: data.counts.openSessions, meta: 'Unexpired sessions', icon: KeyRound, tone: 'amber' },
  ];
  return (
    <div className="admin-overview">
      <section className="admin-stat-grid" aria-label={translateText("Service overview")}>
        {stats.map(({ label, value, meta, icon: Icon, tone }) => (
          <article className={`admin-stat ${tone}`} key={label}>
            <span className="admin-stat-icon"><Icon size={18} /></span>
            <span><small>{translateText(label)}</small><strong>{translateText(number.format(value))}</strong><em>{translateText(meta)}</em></span>
          </article>
        ))}
      </section>

      <section className="admin-panel admin-trend-panel">
        <header>
          <div><span className="admin-eyebrow">{translateText("Traffic")}</span><h2>{translateText("Visits over the last ")}{translateText(rangeDays)}{translateText(" days")}</h2></div>
          <div className="admin-panel-actions"><RangeSelector value={rangeDays} onChange={onRangeChange} /><button type="button" className="admin-text-button" onClick={() => onNavigate('visits')}>{translateText("View visit log ")}<ChevronRight size={13} /></button></div>
        </header>
        <TrendChart data={data.visitTrend} days={rangeDays} valueLabel="page visits" />
        <div className="admin-chart-legend"><span><i className="blue" />{translateText(" Page visits")}</span><span><i className="muted" />{translateText(" Daily values · ")}{translateText(rangeLabel)}</span></div>
      </section>

      <div className="admin-overview-columns">
        <section className="admin-panel">
          <header><div><span className="admin-eyebrow">{translateText("Latest work")}</span><h2>{translateText("Recent terrains")}</h2></div><button type="button" className="admin-icon-button" onClick={() => onNavigate('terrains')} aria-label={translateText("View all terrains")}><ChevronRight size={15} /></button></header>
          <div className="admin-compact-list">
            {data.recentTerrains.length === 0 && <p className="admin-empty">{translateText("No cloud terrains yet.")}</p>}
            {data.recentTerrains.map((terrain) => (
              <div key={terrain.id}>
                <span className="admin-list-icon"><FolderKanban size={14} /></span>
                <span><strong>{terrain.name}</strong><small>@{terrain.username} · {translateText(formatDate(terrain.updatedAt))}</small></span>
                <span className={`admin-badge ${terrain.visibility}`}>{translateText(terrain.visibility)}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="admin-panel">
          <header><div><span className="admin-eyebrow">{translateText("Accountability")}</span><h2>{translateText("Administrator activity")}</h2></div><button type="button" className="admin-icon-button" onClick={() => onNavigate('audit')} aria-label={translateText("View audit log")}><ChevronRight size={15} /></button></header>
          <div className="admin-compact-list audit">
            {data.recentAudit.length === 0 && <p className="admin-empty">{translateText("No administrator changes recorded yet.")}</p>}
            {data.recentAudit.map((event) => (
              <div key={event.id}>
                <span className="admin-list-icon"><FileClock size={14} /></span>
                <span><strong>{translateText(actionLabel(event.action))}</strong><small>{translateText(event.actor)} · {translateText(formatDate(event.createdAt))}</small></span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function UsersPanel({ currentUser }) {
  useLanguage();
  const { showPopup, showConfirm } = usePopup();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [verified, setVerified] = useState('');
  const [activity, setActivity] = useState('');
  const [terrains, setTerrains] = useState('');
  const [sessions, setSessions] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setData(await adminApi.users({ page, q: query, status, role, verified, activity, terrains, sessions })); }
    catch (nextError) { setError(nextError.message); }
  }, [page, query, status, role, verified, activity, terrains, sessions]);
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
        <div><span className="admin-eyebrow">{translateText("Accounts")}</span><h2>{translateText("User management")}</h2><p>{translateText("Review access, roles, account status, and sessions.")}</p></div>
        <button type="button" className="admin-refresh" onClick={load}><RefreshCw size={13} />{translateText(" Refresh")}</button>
      </header>
      <form className="admin-filters users-filters" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(search); }}>
        <label className="admin-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={translateText("Search name, username, or email")} aria-label={translateText("Search users")} /></label>
        <select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }} aria-label={translateText("Filter user status")}>
          <option value="">{translateText("All statuses")}</option><option value="active">{translateText("Active")}</option><option value="suspended">{translateText("Suspended")}</option>
        </select>
        <select value={role} onChange={(event) => { setPage(1); setRole(event.target.value); }} aria-label={translateText("Filter user role")}>
          <option value="">{translateText("All roles")}</option><option value="admin">{translateText("Administrators")}</option><option value="user">{translateText("Members")}</option>
        </select>
        <select value={verified} onChange={(event) => { setPage(1); setVerified(event.target.value); }} aria-label={translateText("Filter email verification")}>
          <option value="">{translateText("All verification")}</option><option value="verified">{translateText("Verified email")}</option><option value="unverified">{translateText("Unverified email")}</option>
        </select>
        <select value={terrains} onChange={(event) => { setPage(1); setTerrains(event.target.value); }} aria-label={translateText("Filter terrain ownership")}>
          <option value="">{translateText("All terrain activity")}</option><option value="has">{translateText("Has terrains")}</option><option value="none">{translateText("No terrains")}</option>
        </select>
        <select value={activity} onChange={(event) => { setPage(1); setActivity(event.target.value); }} aria-label={translateText("Filter recent activity")}>
          <option value="">{translateText("Any last seen")}</option><option value="7d">{translateText("Seen in 7 days")}</option><option value="30d">{translateText("Seen in 30 days")}</option><option value="never">{translateText("Never seen")}</option>
        </select>
        <select value={sessions} onChange={(event) => { setPage(1); setSessions(event.target.value); }} aria-label={translateText("Filter active sessions")}>
          <option value="">{translateText("All sessions")}</option><option value="active">{translateText("Has active sessions")}</option><option value="none">{translateText("No active sessions")}</option>
        </select>
        <button type="submit">{translateText("Search")}</button>
      </form>
      {!data && !error && <LoadingState />}
      {error && <ErrorState message={translateText(error)} onRetry={load} />}
      {data && (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>{translateText("User")}</th><th>{translateText("Status")}</th><th>{translateText("Role")}</th><th>{translateText("Terrains")}</th><th>{translateText("Sessions")}</th><th>{translateText("Last seen")}</th><th><span className="sr-only">{translateText("Actions")}</span></th></tr></thead>
              <tbody>
                {data.users.map((user) => (
                  <tr key={user.id}>
                    <td><span className="admin-user-cell"><span className="admin-user-avatar">{(user.displayName || user.username).slice(0, 2).toUpperCase()}</span><span><strong>{user.displayName || user.username}{user.id === currentUser.id && <em>{translateText("You")}</em>}</strong><small>@{user.username} · {user.email}</small></span></span></td>
                    <td><span className={`admin-status ${user.status}`}><i />{translateText(user.status)}</span></td>
                    <td><span className={`admin-role ${user.role}`}><ShieldCheck size={12} /> {translateText(user.role)}</span></td>
                    <td>{translateText(number.format(user.projectCount))}</td>
                    <td>{translateText(number.format(user.activeSessions))}</td>
                    <td><span className="admin-muted">{translateText(formatDate(user.lastSeenAt))}</span></td>
                    <td>
                      <div className="admin-row-actions">
                        {user.status === 'active'
                          ? <button type="button" className="danger" disabled={busy === user.id || user.id === currentUser.id} onClick={() => update(user, { status: 'suspended' })}><UserX size={13} />{translateText(" Suspend")}</button>
                          : <button type="button" disabled={busy === user.id} onClick={() => update(user, { status: 'active' })}><UserCheck size={13} />{translateText(" Activate")}</button>}
                        {user.role === 'admin'
                          ? <button type="button" disabled={busy === user.id || user.id === currentUser.id} onClick={() => update(user, { role: 'user' })}><CircleUserRound size={13} />{translateText(" Make member")}</button>
                          : <button type="button" disabled={busy === user.id} onClick={() => update(user, { role: 'admin' })}><UserCog size={13} />{translateText(" Make admin")}</button>}
                        <button type="button" disabled={busy === user.id || user.id === currentUser.id || user.activeSessions === 0} onClick={() => revoke(user)}><KeyRound size={13} />{translateText(" Revoke sessions")}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.users.length === 0 && <p className="admin-empty">{translateText("No users match these filters.")}</p>}
          </div>
          <footer className="admin-results-footer"><span>{translateText(number.format(data.total))}{translateText(" user")}{translateText(data.total === 1 ? '' : 's')}</span><Pagination page={data.page} pages={data.pages} onPage={setPage} /></footer>
        </>
      )}
    </section>
  );
}

function VisitsPanel() {
  useLanguage();
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
      {data && <section className="admin-panel admin-trend-panel"><header><div><span className="admin-eyebrow">{translateText("Audience")}</span><h2>{translateText("Visits and unique visitors")}</h2></div><RangeSelector value={days} onChange={(value) => { setPage(1); setDays(value); }} /></header><div className="admin-inline-metrics"><div><strong>{translateText(number.format(data.summary?.visits ?? data.total))}</strong><span>{translateText("Total visits")}</span></div><div><strong>{translateText(number.format(data.summary?.uniqueVisitors ?? 0))}</strong><span>{translateText("Unique visitors")}</span></div><div><strong>{translateText(number.format(data.summary?.averagePerDay ?? 0))}</strong><span>{translateText("Average per day")}</span></div></div><TrendChart data={data.trend} days={days} valueLabel="page visits" /><div className="admin-chart-legend"><span><i className="blue" />{translateText(" Page visits")}</span><span><i className="green" />{translateText(" Hover a day for the exact count")}</span></div></section>}
      <section className="admin-panel admin-data-panel">
        <header className="admin-data-head"><div><span className="admin-eyebrow">{translateText("Recent traffic")}</span><h2>{translateText("Visit log")}</h2><p>{translateText("Raw network addresses are never shown or stored.")}</p></div><button type="button" className="admin-refresh" onClick={load}><RefreshCw size={13} />{translateText(" Refresh")}</button></header>
        {!data && !error && <LoadingState />}{error && <ErrorState message={translateText(error)} onRetry={load} />}
        {data && <><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>{translateText("Time")}</th><th>{translateText("Path")}</th><th>{translateText("Visitor")}</th><th>{translateText("Device")}</th><th>{translateText("Referrer")}</th></tr></thead><tbody>{data.visits.map((visit) => <tr key={visit.id}><td><span className="admin-muted">{translateText(formatDate(visit.createdAt))}</span></td><td><code>{visit.path}</code></td><td>{visit.username ? `@${visit.username}` : <span className="admin-muted">{translateText("Anonymous")}</span>}</td><td><span className="admin-device"><DeviceIcon device={visit.device} />{translateText(visit.device)}</span></td><td><span className="admin-muted">{translateText(visit.referrerHost || 'Direct')}</span></td></tr>)}</tbody></table>{data.visits.length === 0 && <p className="admin-empty">{translateText("No visits in this period.")}</p>}</div><footer className="admin-results-footer"><span>{translateText(number.format(data.total))}{translateText(" visits")}</span><Pagination page={data.page} pages={data.pages} onPage={setPage} /></footer></>}
      </section>
    </div>
  );
}

function TerrainsPanel() {
  useLanguage();
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
      <header className="admin-data-head"><div><span className="admin-eyebrow">{translateText("Cloud library")}</span><h2>{translateText("Recent terrains")}</h2><p>{translateText("Metadata only; private terrain content is not exposed here.")}</p></div><button type="button" className="admin-refresh" onClick={load}><RefreshCw size={13} />{translateText(" Refresh")}</button></header>
      <form className="admin-filters" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(search); }}><label className="admin-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={translateText("Search terrain or owner")} aria-label={translateText("Search terrains")} /></label><select value={visibility} onChange={(event) => { setPage(1); setVisibility(event.target.value); }} aria-label={translateText("Filter terrain visibility")}><option value="">{translateText("All visibility")}</option><option value="private">{translateText("Private")}</option><option value="unlisted">{translateText("Unlisted")}</option><option value="public">{translateText("Public")}</option></select><button type="submit">{translateText("Search")}</button></form>
      {!data && !error && <LoadingState />}{error && <ErrorState message={translateText(error)} onRetry={load} />}
      {data && <><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>{translateText("Terrain")}</th><th>{translateText("Owner")}</th><th>{translateText("Visibility")}</th><th>{translateText("Revision")}</th><th>{translateText("Created")}</th><th>{translateText("Last updated")}</th></tr></thead><tbody>{data.terrains.map((terrain) => <tr key={terrain.id}><td><span className="admin-terrain-cell"><span className="admin-list-icon"><FolderKanban size={14} /></span><span><strong>{terrain.name}</strong><small>{translateText(terrain.description || 'No description')}</small></span></span></td><td>@{translateText(terrain.owner.username)}</td><td><span className={`admin-badge ${terrain.visibility}`}>{translateText(terrain.visibility)}</span></td><td>{translateText("v")}{translateText(terrain.contentRevision)}</td><td><span className="admin-muted">{translateText(formatDate(terrain.createdAt))}</span></td><td><span className="admin-muted">{translateText(formatDate(terrain.updatedAt))}</span></td></tr>)}</tbody></table>{data.terrains.length === 0 && <p className="admin-empty">{translateText("No terrains match these filters.")}</p>}</div><footer className="admin-results-footer"><span>{translateText(number.format(data.total))}{translateText(" terrains")}</span><Pagination page={data.page} pages={data.pages} onPage={setPage} /></footer></>}
    </section>
  );
}

function AuditPanel() {
  useLanguage();
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
      <header className="admin-data-head"><div><span className="admin-eyebrow">{translateText("Accountability")}</span><h2>{translateText("Administrator audit log")}</h2><p>{translateText("Security-sensitive administrator actions are recorded with their actor and target.")}</p></div><button type="button" className="admin-refresh" onClick={load}><RefreshCw size={13} />{translateText(" Refresh")}</button></header>
      <form className="admin-filters compact" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(search); }}><label className="admin-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={translateText("Search action, actor, or target ID")} aria-label={translateText("Search audit log")} /></label><button type="submit">{translateText("Search")}</button></form>
      {!data && !error && <LoadingState />}{error && <ErrorState message={translateText(error)} onRetry={load} />}
      {data && <><div className="admin-audit-list">{data.events.map((event) => <article key={event.id}><span className="admin-audit-mark"><FileClock size={14} /></span><div><header><strong>{translateText(actionLabel(event.action))}</strong><span>{translateText(formatDate(event.createdAt))}</span></header><p><b>{translateText(event.actor)}</b>{translateText(" changed ")}{translateText(event.targetType)}{translateText(event.targetId ? ` ${event.targetId}` : '')}.</p>{event.metadata?.changes && <div className="admin-change-chips">{Object.entries(event.metadata.changes).map(([key, value]) => <span key={key}>{translateText(key)}: <strong>{translateText(String(value))}</strong></span>)}</div>}</div></article>)}{data.events.length === 0 && <p className="admin-empty">{translateText("No audit events match this search.")}</p>}</div><footer className="admin-results-footer"><span>{translateText(number.format(data.total))}{translateText(" audit events")}</span><Pagination page={data.page} pages={data.pages} onPage={setPage} /></footer></>}
    </section>
  );
}

function SecurityPanel() {
  useLanguage();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try { setData(await adminApi.security()); }
    catch (nextError) { setError(nextError.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!data && !error) return <LoadingState />;
  if (error) return <ErrorState message={translateText(error)} onRetry={load} />;
  const stats = [
    { label: 'Failed sign-ins · 24h', value: data.summary.failedLogins, icon: ShieldAlert, danger: data.summary.failedLogins > 10 },
    { label: 'Open sessions', value: data.summary.openSessions, icon: KeyRound },
    { label: 'Suspended users', value: data.summary.suspendedUsers, icon: UserX },
    { label: 'Active administrators', value: data.summary.admins, icon: ShieldCheck },
  ];
  return (
    <div className="admin-stack">
      <section className="admin-security-grid">{stats.map(({ label, value, icon: Icon, danger }) => <article className={danger ? 'danger' : ''} key={label}><Icon size={18} /><span><strong>{translateText(number.format(value))}</strong><small>{translateText(label)}</small></span></article>)}</section>
      <section className="admin-panel admin-security-note"><LockKeyhole size={19} /><div><strong>{translateText("Security controls are active")}</strong><p>{translateText("Server-side role checks, exact-origin enforcement, HTTP-only cookies, rate limits, privacy-safe identifiers, password hashing, and administrator audit events protect this area.")}</p></div></section>
      <section className="admin-panel admin-data-panel"><header className="admin-data-head"><div><span className="admin-eyebrow">{translateText("Authentication")}</span><h2>{translateText("Recent security events")}</h2><p>{translateText("Identifiers and network addresses are not exposed.")}</p></div><button type="button" className="admin-refresh" onClick={load}><RefreshCw size={13} />{translateText(" Refresh")}</button></header><div className="admin-security-events">{data.events.map((event) => <div key={event.id}><span className={`admin-event-icon ${event.outcome}`}>{event.outcome === 'success' ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}</span><span><strong>{translateText(actionLabel(event.type))}</strong><small>{translateText(event.username ? `@${event.username}` : 'Unknown account')} · {translateText(formatDate(event.createdAt))}</small></span><span className={`admin-status ${event.outcome}`}><i />{translateText(event.outcome)}</span></div>)}{data.events.length === 0 && <p className="admin-empty">{translateText("No security events recorded yet.")}</p>}</div></section>
    </div>
  );
}

export default function AdminDashboard({ user, onBack }) {
  useLanguage();
  const [tab, setTab] = useState('overview');
  const [overview, setOverview] = useState(null);
  const [overviewDays, setOverviewDays] = useState(30);
  const [error, setError] = useState('');
  const loadOverview = useCallback(async () => {
    setError('');
    try { setOverview(await adminApi.overview({ days: overviewDays })); }
    catch (nextError) { setError(nextError.message); }
  }, [overviewDays]);
  useEffect(() => { loadOverview(); }, [loadOverview]);
  const changeOverviewRange = useCallback((days) => {
    setOverview(null);
    setOverviewDays(days);
  }, []);
  const title = TABS.find((item) => item.id === tab)?.label ?? 'Overview';

  return (
    <section className="admin-dashboard" aria-labelledby="admin-title">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-heading"><span className="admin-shield"><ShieldCheck size={18} /></span><span><strong>{translateText("Admin console")}</strong><small>{translateText("Three Terrain")}</small></span></div>
        <nav aria-label={translateText("Administration")}>
          {TABS.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={15} /><span>{translateText(label)}</span></button>)}
        </nav>
        <div className="admin-sidebar-account"><span>{(user.displayName || user.username).slice(0, 2).toUpperCase()}</span><div><strong>{user.displayName || user.username}</strong><small>{translateText("Administrator")}</small></div></div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar-content">
            <div className="admin-topbar-title">
              <button type="button" className="admin-back" onClick={onBack}><ArrowLeft size={15} />{translateText(" Exit admin")}</button>
              <div><span>{translateText("Three Terrain back office")}</span><h1 id="admin-title">{translateText(title)}</h1></div>
            </div>
            <div className="admin-secure-indicator"><LockKeyhole size={13} /><span>{translateText("Secure admin session")}</span></div>
          </div>
        </header>
        <div className="admin-mobile-tabs" role="tablist" aria-label={translateText("Administration sections")}>{TABS.map(({ id, label }) => <button type="button" role="tab" aria-selected={tab === id} key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{translateText(label)}</button>)}</div>
        <div className="admin-page">
          {tab === 'overview' && !overview && !error && <LoadingState />}
          {tab === 'overview' && error && <ErrorState message={translateText(error)} onRetry={loadOverview} />}
          {tab === 'overview' && overview && <Overview data={overview} onNavigate={setTab} rangeDays={overviewDays} onRangeChange={changeOverviewRange} />}
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
