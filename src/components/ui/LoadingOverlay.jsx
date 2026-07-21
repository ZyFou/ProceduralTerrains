// Blocking loading overlay shown above the viewport for heavy actions
// (mode switch, export, heavy generation). The app stays visually alive —
// the viewport remains behind a light scrim.
export function LoadingBar({ progress }) {
  const indeterminate = progress == null || Number.isNaN(progress);
  return (
    <div className="loading-bar">
      {indeterminate ? (
        <div className="loading-bar-fill indeterminate" />
      ) : (
        <div className="loading-bar-fill" style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }} />
      )}
    </div>
  );
}

export default function LoadingOverlay({ task }) {
  if (!task) return null;
  const pct = task.progress != null && !Number.isNaN(task.progress)
    ? `${Math.round(task.progress * 100)}%`
    : null;

  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <div className="loading-card">
        <div className="loading-card-spinner" aria-hidden>
          <svg viewBox="0 0 24 24" width="22" height="22">
            <circle cx="12" cy="12" r="9" fill="none" stroke="var(--border-subtle)" strokeWidth="2.5" />
            <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>
        <div className="loading-card-text">
          <div className="loading-card-title">{task.label}</div>
          {task.detail && <div className="loading-card-detail">{task.detail}</div>}
        </div>
        {pct && <div className="loading-card-pct">{pct}</div>}
      </div>
      <div className="loading-card-barwrap">
        <LoadingBar progress={task.progress} />
      </div>
    </div>
  );
}
import React from 'react';

