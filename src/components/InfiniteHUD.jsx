// ============================================================================
// Minimal HUD overlay for Infinite World Mode.
// Shows crosshair, position, speed, chunk stats, and a return button.
// ============================================================================

export default function InfiniteHUD({ stats, onReturn }) {
  if (!stats) return null;
  return (
    <>
      {/* Crosshair */}
      <div id="fps-crosshair">
        <svg width="24" height="24" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="2" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.2" />
          <line x1="12" y1="4" x2="12" y2="9" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
          <line x1="12" y1="15" x2="12" y2="20" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
          <line x1="4" y1="12" x2="9" y2="12" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
          <line x1="15" y1="12" x2="20" y2="12" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
        </svg>
      </div>

      {/* Top-left info */}
      <div id="fps-info">
        <div className="fps-info-row">
          <span className="fps-info-label">POS</span>
          <span className="fps-info-val">{stats.x}, {stats.y}, {stats.z}</span>
        </div>
        <div className="fps-info-row">
          <span className="fps-info-label">SPEED</span>
          <span className="fps-info-val">{stats.speed} u/s</span>
        </div>
        <div className="fps-info-row">
          <span className="fps-info-label">CHUNKS</span>
          <span className="fps-info-val">{stats.chunks}</span>
        </div>
      </div>

      {/* Bottom center speed bar */}
      <div id="fps-speed-bar">
        <svg viewBox="0 0 16 16" width="14" height="14">
          <path d="M8 2v8M4 6l4-4 4 4" stroke="currentColor" fill="none" strokeWidth="1.3" strokeLinejoin="round" />
          <line x1="3" y1="13" x2="13" y2="13" stroke="currentColor" strokeWidth="1.3" />
        </svg>
        <span>{stats.speed} u/s</span>
        <span className="fps-speed-hint">Scroll to adjust</span>
      </div>

      {/* Controls hint */}
      <div id="fps-controls-hint">
        <span>ZQSD</span> Move &nbsp;·&nbsp;
        <span>Mouse</span> Look &nbsp;·&nbsp;
        <span>Scroll</span> Speed &nbsp;·&nbsp;
        <span>Space/Shift</span> Up/Down &nbsp;·&nbsp;
        Click to lock mouse
      </div>

      {/* Return button */}
      <button id="fps-return-btn" onClick={onReturn} title="Return to Terrain Studio">
        <svg viewBox="0 0 16 16" width="14" height="14">
          <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" stroke="currentColor" fill="none" strokeWidth="1.3" />
          <path d="M13.7 1.8v2.8h-2.8" stroke="currentColor" fill="none" strokeWidth="1.3" />
        </svg>
        Terrain Studio
      </button>
    </>
  );
}
