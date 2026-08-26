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

const LOADING_STAGE_LABELS = {
  planning: 'Plan',
  renderer: 'GPU',
  resources: 'Assets',
  geometry: 'Terrain',
  compile: 'Shaders',
  present: 'Frame',
  ready: 'Ready',
};

export default function LoadingOverlay({ task }) {
  if (!task) return null;
  const iconProgress = task.progress == null ? 0.15 : Math.max(0, Math.min(1, task.progress));
  const stepLabel = LOADING_STAGE_LABELS[task.stage] ?? task.stage ?? 'Working';

  return (
    <div
      className={`loading-overlay${task.opaque ? ' opaque' : ''}`}
      role="status"
      aria-label={task.label}
      aria-live="polite"
    >
      <div className="loading-card">
        <div className="loading-card-visual">
          <svg className="landing-boot-terrain loading-terrain-icon" viewBox="0 0 72 46" aria-hidden="true">
            <defs>
              <clipPath id="loading-terrain-progress-clip">
                <rect x="0" y="0" width={72 * iconProgress} height="46" />
              </clipPath>
            </defs>
            <path className="landing-boot-terrain-base" d="M3 40 20 19l9 11L43 8l26 32H3Z" />
            <path className="landing-boot-terrain-line" d="m3 40 17-21 9 11L43 8l26 32" />
            <path className="landing-boot-terrain-fill" clipPath="url(#loading-terrain-progress-clip)" d="M3 40 20 19l9 11L43 8l26 32H3Z" />
          </svg>
          <span className="landing-boot-progress-step">{stepLabel}</span>
          <span className="loading-activity-spinner" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
import React from 'react';

