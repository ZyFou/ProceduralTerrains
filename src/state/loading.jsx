// ============================================================================
// Central loading system.
//
// One place to register heavy/async work so the UI can show a clear blocking
// overlay (mode switch, export, heavy generation) or a small non-blocking
// indicator (minor recalcs) — instead of silent freezes and scattered booleans.
//
// LoadingTask = { id, label, detail?, progress?, blocking }
// ============================================================================
import React, { createContext, useContext, useMemo, useRef, useState, useCallback } from 'react';

const LoadingContext = createContext(null);

export function LoadingProvider({ children }) {
  const [tasks, setTasks] = useState([]);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const start = useCallback((id, opts = {}) => {
    const task = {
      id,
      label: opts.label ?? 'Working…',
      detail: opts.detail,
      progress: opts.progress,
      blocking: opts.blocking ?? false,
    };
    setTasks((prev) => {
      const without = prev.filter((t) => t.id !== id);
      return [...without, task];
    });
    return id;
  }, []);

  const update = useCallback((id, patch = {}) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const done = useCallback((id) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const fail = done; // same effect on the task list; caller raises a toast

  // Wrap async work so the task is ALWAYS cleared (covers the "stuck loading"
  // edge case). `fn` receives an `update(patch)` helper bound to this task.
  const run = useCallback(async (id, opts, fn) => {
    start(id, opts);
    // Yield so the overlay actually paints before heavy (possibly synchronous)
    // work begins — otherwise the loading state never shows. Race rAF against a
    // timeout so this never stalls when the tab is occluded (rAF won't fire).
    await new Promise((r) => {
      let done = false;
      const go = () => { if (!done) { done = true; r(); } };
      requestAnimationFrame(go);
      setTimeout(go, 40);
    });
    try {
      return await fn((patch) => update(id, patch));
    } finally {
      done(id);
    }
  }, [start, update, done]);

  const value = useMemo(() => ({ tasks, start, update, done, fail, run }), [tasks, start, update, done, fail, run]);

  return <LoadingContext.Provider value={value}>{children}</LoadingContext.Provider>;
}

export function useLoading() {
  const ctx = useContext(LoadingContext);
  if (!ctx) throw new Error('useLoading must be used within a LoadingProvider');
  return ctx;
}

// Selectors / helpers
export function blockingTask(tasks) {
  return tasks.find((t) => t.blocking) ?? null;
}
export function nonBlockingTask(tasks) {
  return tasks.find((t) => !t.blocking) ?? null;
}
