// ============================================================================
// usePerfOverlay — owns the Performance Overlay's UI state, persistence,
// keyboard shortcut and the throttled snapshot poll.
//
// Data flow: the engine writes into the shared `profiler` singleton every
// frame; this hook reads a snapshot on an interval (NOT every render frame) and
// merges in the engine's structured diagnostics + the app's loading tasks. The
// overlay/badge re-render only at the poll rate, so the debug UI can never
// become a per-frame performance problem itself.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { profiler } from '../../engine/perf/PerformanceProfiler.js';

const STORAGE_KEY = 'terrain-studio-perf-overlay-v1';

const DEFAULT_SETTINGS = {
  open: false,
  badge: true,          // small FPS badge entry point (cheap, default on)
  compact: false,
  showWarnings: true,
  collapsed: {},        // section id -> true when collapsed
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

export function usePerfOverlay(engineRef, loadingTasks) {
  const [settings, setSettings] = useState(loadSettings);
  const [snapshot, setSnapshot] = useState(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const loadingRef = useRef(loadingTasks);
  loadingRef.current = loadingTasks;

  // persist
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
  }, [settings]);

  // detailed collection only while the overlay is open
  useEffect(() => {
    profiler.setActive(settings.open);
    return () => profiler.setActive(false);
  }, [settings.open]);

  const patch = useCallback((p) => setSettings((s) => ({ ...s, ...p })), []);
  const toggleOpen = useCallback(() => setSettings((s) => ({ ...s, open: !s.open })), []);
  const setBadge = useCallback((v) => setSettings((s) => ({ ...s, badge: v })), []);
  const setCompact = useCallback((v) => setSettings((s) => ({ ...s, compact: v })), []);
  const setShowWarnings = useCallback((v) => setSettings((s) => ({ ...s, showWarnings: v })), []);
  const toggleSection = useCallback((id) =>
    setSettings((s) => ({ ...s, collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } })), []);

  // keyboard shortcut: Ctrl/Cmd + Shift + P
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        // avoid clashing with the browser print dialog (Ctrl+P has no shift)
        e.preventDefault();
        toggleOpen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleOpen]);

  // throttled poll — 5 Hz when open, 2 Hz when only the badge is visible
  useEffect(() => {
    const active = settings.open || settings.badge;
    if (!active) { setSnapshot(null); return undefined; }
    const period = settings.open ? 200 : 500;

    const tick = () => {
      const base = profiler.snapshot();
      let diag = null;
      const eng = engineRef.current;
      if (eng && typeof eng.getPerfDiagnostics === 'function') {
        try { diag = eng.getPerfDiagnostics(); } catch { diag = null; }
      }
      // merge app-level (React) loading tasks with engine profiler tasks
      const appTasks = (loadingRef.current || []).map((t) => ({
        id: `app-${t.id}`,
        name: t.label || t.id,
        status: 'running',
        progress: t.progress ?? null,
        details: t.detail || '',
        elapsed: 0,
      }));
      const tasks = [...appTasks, ...base.tasks];
      setSnapshot({ ...base, diag, tasks });
    };
    tick();
    const h = setInterval(tick, period);
    return () => clearInterval(h);
  }, [settings.open, settings.badge, engineRef]);

  return {
    settings,
    snapshot,
    patch,
    toggleOpen,
    setBadge,
    setCompact,
    setShowWarnings,
    toggleSection,
  };
}
