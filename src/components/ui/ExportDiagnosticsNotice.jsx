import { translateText, useLanguage } from '../../i18n/LanguageContext.jsx';
import React, { useState } from 'react';
import { saveBlob } from '../../platform/DesktopBridge.js';

export default function ExportDiagnosticsNotice({ report }) {
  useLanguage();
  const [dismissed, setDismissed] = useState(null);
  const [saveError, setSaveError] = useState('');
  if (!report) return null;
  const warning = report.events?.filter((event) => event.kind === 'warning').at(-1);
  const visible = ['failed', 'interrupted'].includes(report.status) || (report.status === 'running' && (report.stalled || warning));
  const key = `${report.id}:${report.status}:${report.stalled}:${warning?.at}`;
  if (!visible || dismissed === key) return null;
  const download = async () => {
    try {
      await saveBlob(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), `${report.id}-diagnostics.json`);
      setSaveError('');
    } catch (error) { setSaveError(error?.message || 'Could not save diagnostics. Logs are also available in the browser console.'); }
  };
  return <aside className="export-diagnostics-notice" role="alert">
    <strong>{translateText(report.status === 'failed' ? 'Export failed' : report.status === 'interrupted' ? 'Previous export interrupted' : 'Export needs attention')}</strong>
    <p>{translateText(report.message || warning?.message)}</p>
    <p>{translateText("Last stage: ")}{translateText(report.stage)}</p>
    {report.status === 'running' && <p>{translateText("The export is still active. A slow stage does not confirm a crash.")}</p>}
    {saveError && <p>{translateText(saveError)}</p>}
    <button type="button" onClick={download}>{translateText("Save diagnostics")}</button>
    <button type="button" onClick={() => setDismissed(key)}>{translateText("Dismiss")}</button>
  </aside>;
}
