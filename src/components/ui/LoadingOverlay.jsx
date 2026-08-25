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
  const phases = Array.isArray(task.phases) ? task.phases : [];
  const stageIndex = phases.indexOf(task.stage);
  const phaseIndex = task.stage === 'ready'
    ? phases.length
    : Math.max(0, stageIndex);
  const iconProgress = task.progress == null ? 0.15 : Math.max(0, Math.min(1, task.progress));

  return (
    <div className={`loading-overlay${task.opaque ? ' opaque' : ''}`} role="status" aria-live="polite">
      <div className="loading-card">
        <div className="loading-card-spinner" aria-hidden>
          <svg className="loading-terrain-icon" viewBox="0 0 32 26" width="30" height="26">
            <path d="M2 23 10.5 9l4.2 6.2L20 4l10 19H2Z" fill="none" stroke="var(--border-subtle)" strokeWidth="2" strokeLinejoin="round" />
            <path className="loading-terrain-progress" pathLength="1" d="M2 23 10.5 9l4.2 6.2L20 4l10 19H2Z" fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinejoin="round" style={{ strokeDasharray: `${iconProgress} 1` }} />
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
        {phases.length > 0 && (
          <div className="loading-phases" aria-label={task.stage === 'ready'
            ? `All ${phases.length} phases complete`
            : `Phase ${phaseIndex + 1} of ${phases.length}`}>
            {phases.map((phase, index) => (
              <span key={phase} className={index < phaseIndex ? 'done' : index === phaseIndex ? 'active' : ''}>
                <i />{phase}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
import React from 'react';

