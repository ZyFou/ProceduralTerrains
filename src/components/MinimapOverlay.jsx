import { useState } from 'react';

export default function MinimapOverlay({ boardSize, baseRef, overlayRef, drawerOpen = false }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`minimap-overlay-container${collapsed ? ' collapsed' : ''}${drawerOpen ? ' drawer-open' : ''}`}>
      <div className="minimap-overlay-header">
        <span className="minimap-title">
          <svg viewBox="0 0 16 16" fill="none" width="12" height="12" style={{ marginRight: '6px', color: 'var(--accent)' }}>
            <path d="M1 3l4.5-2v12L1 15V3zM5.5 1l5 2v12l-5-2V1zM10.5 3L15 1v12l-4.5 2V3z" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          MAP Preview
        </span>
        <button
          type="button"
          className="minimap-toggle-btn"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? "Expand Minimap" : "Collapse Minimap"}
        >
          {collapsed ? (
            <svg viewBox="0 0 16 16" width="10" height="10" fill="none">
              <path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width="10" height="10" fill="none">
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </div>
      <div className="minimap-overlay-body">
        <div className="minimap-wrap" data-tooltip="Minimap showing active terrain height contours and camera positions">
          <canvas className="minimap-base" width="256" height="256" ref={baseRef} />
          <canvas className="minimap-overlay" width="256" height="256" ref={overlayRef} />
        </div>
        <div className="minimap-caption" data-tooltip="Total boundary size of the generated world grid in units">
          Board: {boardSize} × {boardSize} units
        </div>
      </div>
    </div>
  );
}
