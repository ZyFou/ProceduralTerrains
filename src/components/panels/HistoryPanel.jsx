import { getLocale } from '../../i18n/language.js';
import { translateText, useLanguage } from '../../i18n/LanguageContext.jsx';
import { History as HistoryIcon, RotateCcw } from 'lucide-react';
import React, { useState } from 'react';
import SidePanel, { PanelTabs } from './SidePanel.jsx';
import { usePopup } from '../ui/PopupProvider.jsx';

export default function HistoryPanel({ ctx }) {
  useLanguage();
  const [tab, setTab] = useState('actions');
  const { showPrompt } = usePopup();
  const h = ctx.creatorHistory || { actions: [], snapshots: [] };

  const createSnapshot = async () => {
    const name = (await showPrompt({ title: 'Create snapshot', inputLabel: 'Snapshot name', initialValue: 'Creator checkpoint', confirmLabel: 'Create' }))?.trim();
    if (name) ctx.onCreateSnapshot(name);
  };

  const renameSnapshot = async (snapshot) => {
    const name = (await showPrompt({ title: 'Rename snapshot', inputLabel: 'Snapshot name', initialValue: snapshot.name, confirmLabel: 'Rename' }))?.trim();
    if (name && name !== snapshot.name) ctx.onRenameSnapshot(snapshot.id, name);
  };

  return <SidePanel title={translateText("History")} description={translateText("Creator checkpoints and actions.")} onClose={ctx.onClose}>
    <PanelTabs active={tab} onChange={setTab} tabs={[{ id: 'actions', label: 'Actions' }, { id: 'snapshots', label: 'Snapshots' }]} />
    {tab === 'actions' && <div className="history-action-list">{!h.actions?.length && <p className="section-hint">{translateText("Creator actions will appear here.")}</p>}{h.actions?.slice().reverse().map((a) => <div className="history-action-row" key={a.id}><span className="history-action-icon"><HistoryIcon size={14} aria-hidden /></span><div><strong>{translateText(a.label)}</strong><small>{translateText(new Date(a.timestamp).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }))}</small></div><button type="button" className="history-rewind-btn" onClick={() => ctx.onRestoreHistoryAction(a.id)} title={translateText(`Return to ${a.label}`)} aria-label={translateText(`Return to ${a.label}`)}><RotateCcw size={15} aria-hidden /></button></div>)}</div>}
    {tab === 'snapshots' && <><button type="button" className="action-btn primary" onClick={createSnapshot}>{translateText("Create snapshot")}</button>{!h.snapshots?.length && <p className="section-hint">{translateText("Named snapshots are stored locally and survive reloads.")}</p>}{h.snapshots?.slice().reverse().map((s) => <div className="settings-hint" key={s.id}>{s.thumbnail && <img alt="" src={s.thumbnail} style={{ width: '100%', borderRadius: 5, marginBottom: 6 }} />}<strong>{s.name}</strong><br />{translateText(new Date(s.timestamp).toLocaleString(getLocale()))}<div className="side-panel-quick"><button type="button" className="action-btn" onClick={() => ctx.onRestoreSnapshot(s.id)}>{translateText("Restore")}</button><button type="button" className="action-btn" onClick={() => renameSnapshot(s)}>{translateText("Rename")}</button><button type="button" className="action-btn danger" onClick={() => ctx.onDeleteSnapshot(s.id)}>{translateText("Delete")}</button></div></div>)}</>}
  </SidePanel>;
}
