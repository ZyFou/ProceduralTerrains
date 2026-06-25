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

const HISTORY_LEN = 120;

const DEFAULT_SETTINGS = {
  open: false,
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
  const [history, setHistory] = useState({ fps: [], frameMs: [], drawCalls: [], triangles: [] });
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

  // throttled poll — 5 Hz while the overlay is open (detailed collection only then)
  useEffect(() => {
    if (!settings.open) {
      setSnapshot(null);
      setHistory({ fps: [], frameMs: [], drawCalls: [], triangles: [] });
      return undefined;
    }
    const period = 200;

    const push = (arr, val) => {
      const next = arr.length >= HISTORY_LEN ? arr.slice(1) : arr.slice();
      next.push(val);
      return next;
    };

    const tick = () => {
      const base = profiler.snapshot();
      let diag = null;
      const eng = engineRef.current;
      if (eng && typeof eng.getPerfDiagnostics === 'function') {
        try { diag = eng.getPerfDiagnostics(); } catch { diag = null; }
      }
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
      setHistory((h) => ({
        fps: push(h.fps, base.fps ?? 0),
        frameMs: push(h.frameMs, base.frame?.avg ?? 0),
        drawCalls: push(h.drawCalls, base.render?.calls ?? 0),
        triangles: push(h.triangles, (base.render?.triangles ?? 0) / 1000),
      }));
    };
    tick();
    const h = setInterval(tick, period);
    return () => clearInterval(h);
  }, [settings.open, engineRef]);

  return {
    settings,
    snapshot,
    history,
    patch,
    toggleOpen,
    setShowWarnings,
    toggleSection,
  };
}
