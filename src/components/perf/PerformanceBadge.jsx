// Compact always-available FPS badge. Doubles as the overlay toggle button.
// Cheap: shows FPS, frame ms and the current loading/scene state.

export default function PerformanceBadge({ snapshot, open, onToggle }) {
  const fps = snapshot?.fps ?? 0;
  const frame = snapshot?.frame?.avg ?? 0;
  const state = snapshot?.diag?.state || 'idle';
  const busy = state !== 'idle';
  const fpsClass = fps > 0 && fps < 30 ? 'crit' : (fps > 0 && fps < 45 ? 'warn' : '');

  return (
    <button
      type="button"
      className={`perf-badge${open ? ' is-open' : ''}`}
      onClick={onToggle}
      title="Performance overlay (Ctrl/Cmd+Shift+P)"
    >
      <span className={`perf-badge-fps ${fpsClass}`}>{fps}</span>
      <span className="perf-badge-unit">fps</span>
      <span className="perf-badge-sep" />
      <span className="perf-badge-ms">{frame ? frame.toFixed(1) : '–'}<em>ms</em></span>
      {busy && <span className="perf-badge-state" title={state}>{state}</span>}
    </button>
  );
}
