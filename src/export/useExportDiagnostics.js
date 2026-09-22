import { useEffect, useState } from 'react';
import { ExportDiagnostics, exportError } from './ExportDiagnostics.js';

export function useExportDiagnostics() {
  const [diagnostics] = useState(() => {
    let storage;
    try { storage = window.sessionStorage; } catch { /* privacy settings */ }
    return new ExportDiagnostics({ storage });
  });
  const [report, setReport] = useState(diagnostics.report);
  useEffect(() => {
    diagnostics.onChange = setReport;
    const timer = setInterval(() => diagnostics.checkStall(), 5000);
    const onError = (event) => {
      if (diagnostics.report?.status !== 'running') return;
      const error = exportError(event.reason ?? event.error ?? event.message);
      diagnostics.record('warning', `Browser error during export: ${error.message}`, { stack: error.stack });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onError);
    return () => {
      clearInterval(timer);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onError);
      diagnostics.onChange = () => {};
    };
  }, [diagnostics]);
  return { diagnostics, report };
}
