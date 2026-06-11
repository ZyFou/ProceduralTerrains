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
      <div className="stat-row" data-tooltip="Frames per second (aim for 60 for smooth rendering)">
        <div className="label-with-icon">
          <span className="setting-icon">
            <svg viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M8 3.5V8l3 2" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </span>
          <span className="setting-label">FPS</span>
        </div>
        <span className={`stat-value stat-fps${fpsLow ? ' low' : ''}`}>{stats.fps}</span>
      </div>
      <div className="stat-row" data-tooltip="Graphics card model used for hardware rendering">
        <div className="label-with-icon">
          <span className="setting-icon">
            <svg viewBox="0 0 16 16" fill="none">
              <rect x="3" y="3" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M1 5h2M1 8h2M1 11h2M13 5h2M13 8h2M13 11h2" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </span>
          <span className="setting-label">GPU</span>
        </div>
        <span className="stat-value stat-mono stat-truncate" title={gpu}>{gpu || 'Unknown'}</span>
      </div>
      <div className="stat-row" data-tooltip="Total number of 3D triangles rendered in this frame">
        <div className="label-with-icon">
          <span className="setting-icon">
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M8 2l6 11H2L8 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="setting-label">Triangles</span>
        </div>
        <span className="stat-value stat-mono">{fmtTris(stats.triangles)}</span>
      </div>
      <div className="stat-row" data-tooltip="Number of active mesh rendering calls in this frame">
        <div className="label-with-icon">
          <span className="setting-icon">
            <svg viewBox="0 0 16 16" fill="none">
              <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M5 8h6M5 5h6M5 11h4" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </span>
          <span className="setting-label">Draw Calls</span>
        </div>
        <span className="stat-value stat-mono">{stats.drawCalls}</span>
      </div>
    </ControlSection>
  );
}
