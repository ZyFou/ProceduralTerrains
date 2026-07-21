import { History as HistoryIcon, RotateCcw } from 'lucide-react';
import React, { useState } from 'react';
import SidePanel, { PanelTabs } from './SidePanel.jsx';

export default function HistoryPanel({ ctx }) {
  const [tab, setTab] = useState('actions'); const h = ctx.creatorHistory || { actions: [], snapshots: [] };
  return <SidePanel title="History" description="Creator checkpoints and actions." onClose={ctx.onClose}>
    <PanelTabs active={tab} onChange={setTab} tabs={[{ id: 'actions', label: 'Actions' }, { id: 'snapshots', label: 'Snapshots' }]} />
    {tab === 'actions' && <div className="history-action-list">{!h.actions?.length && <p className="section-hint">Creator actions will appear here.</p>}{h.actions?.slice().reverse().map((a) => <div className="history-action-row" key={a.id}><span className="history-action-icon"><HistoryIcon size={14} aria-hidden /></span><div><strong>{a.label}</strong><small>{new Date(a.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></div><button type="button" className="history-rewind-btn" onClick={() => ctx.onRestoreHistoryAction(a.id)} title={`Return to ${a.label}`} aria-label={`Return to ${a.label}`}><RotateCcw size={15} aria-hidden /></button></div>)}</div>}
    {tab === 'snapshots' && <><button type="button" className="action-btn primary" onClick={() => { const name = window.prompt('Snapshot name', 'Creator checkpoint'); if (name) ctx.onCreateSnapshot(name); }}>Create snapshot</button>{!h.snapshots?.length && <p className="section-hint">Named snapshots are stored locally and survive reloads.</p>}{h.snapshots?.slice().reverse().map((s) => <div className="settings-hint" key={s.id}>{s.thumbnail && <img alt="" src={s.thumbnail} style={{ width: '100%', borderRadius: 5, marginBottom: 6 }} />}<strong>{s.name}</strong><br />{new Date(s.timestamp).toLocaleString()}<div className="side-panel-quick"><button type="button" className="action-btn" onClick={() => ctx.onRestoreSnapshot(s.id)}>Restore</button><button type="button" className="action-btn" onClick={() => { const n = window.prompt('Rename snapshot', s.name); if (n) ctx.onRenameSnapshot(s.id, n); }}>Rename</button><button type="button" className="action-btn danger" onClick={() => ctx.onDeleteSnapshot(s.id)}>Delete</button></div></div>)}</>}
  </SidePanel>;
}
