import ControlSection from './ControlSection.jsx';

function fmtTris(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

export default function PerformancePanel({ stats, gpu }) {
  const fpsLow = stats.fps > 0 && stats.fps < 30;

  return (
    <ControlSection
      id="inspector-performance"
      title="PERFORMANCE"
      defaultOpen
      icon={(
        <svg viewBox="0 0 16 16" fill="none">
          <path d="M2 12h12M4 9l2-4 2 3 3-5 3 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      )}
    >
      <div className="stat-row">
        <span className="stat-label">FPS</span>
        <span className={`stat-value stat-fps${fpsLow ? ' low' : ''}`}>{stats.fps}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">GPU</span>
        <span className="stat-value stat-mono stat-truncate" title={gpu}>{gpu || 'Unknown'}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Triangles</span>
        <span className="stat-value stat-mono">{fmtTris(stats.triangles)}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Draw Calls</span>
        <span className="stat-value stat-mono">{stats.drawCalls}</span>
      </div>
    </ControlSection>
  );
}
