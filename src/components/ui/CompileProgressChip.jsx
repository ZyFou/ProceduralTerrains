import { LoadingBar } from './LoadingOverlay.jsx';

export default function CompileProgressChip({ progress }) {
  if (!progress) return null;

  const total = Number(progress.total);
  const rawDone = Number(progress.done);
  const hasTotal = Number.isFinite(total) && total > 0;
  const done = hasTotal && Number.isFinite(rawDone)
    ? Math.max(0, Math.min(total, rawDone))
    : 0;
  const ratio = hasTotal ? done / total : null;
  const label = progress.label || 'Compiling';

  return (
    <div className="compile-progress-chip" role="status" aria-live="polite">
      <div className="compile-progress-chip-main">
        <span className="compile-progress-label">{label}</span>
        {hasTotal && (
          <span className="compile-progress-count">
            {Math.round(done)} / {Math.round(total)}
          </span>
        )}
      </div>
      <LoadingBar progress={ratio} />
    </div>
  );
}
