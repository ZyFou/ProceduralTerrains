import React, { useState } from 'react';
import { saveBlob } from '../../platform/DesktopBridge.js';

export default function ExportDiagnosticsNotice({ report }) {
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
    <strong>{report.status === 'failed' ? 'Export failed' : report.status === 'interrupted' ? 'Previous export interrupted' : 'Export needs attention'}</strong>
    <p>{report.message || warning?.message}</p>
    <p>Last stage: {report.stage}</p>
    {report.status === 'running' && <p>The export is still active. A slow stage does not confirm a crash.</p>}
    {saveError && <p>{saveError}</p>}
    <button type="button" onClick={download}>Save diagnostics</button>
    <button type="button" onClick={() => setDismissed(key)}>Dismiss</button>
  </aside>;
}
