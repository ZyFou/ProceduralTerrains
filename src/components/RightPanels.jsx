import { useEffect, useRef, useState } from 'react';
import ControlSection from './ui/ControlSection.jsx';

const LOD_LEVELS = [
  { name: 'LOD 0 High', color: '#e5484d' },
  { name: 'LOD 1 Medium', color: '#f5a524' },
  { name: 'LOD 2 Low', color: '#f5d90a' },
  { name: 'LOD 3 Lowest', color: '#3b82f6' },
];

function lodLabel(count) {
  const side = Math.sqrt(count);
  return Number.isInteger(side) && count > 0 ? `${side} × ${side}` : `${count}`;
}

function LodDonut({ counts }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const rOut = canvas.width / 2 - 4;
    const rIn = rOut * 0.58;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let angle = -Math.PI / 2;
    counts.forEach((count, i) => {
      if (!count) return;
      const sweep = (count / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, rOut, angle, angle + sweep);
      ctx.arc(cx, cy, rIn, angle + sweep, angle, true);
      ctx.closePath();
      ctx.fillStyle = LOD_LEVELS[i].color;
      ctx.fill();
      angle += sweep;
    });
  }, [counts]);
  return <canvas className="lod-donut" width="120" height="120" ref={ref} />;
}

export function CameraPanel({ camInfo, camMode, onMode, onFov, onFocusCenter, embedded }) {
  const [fov, setFov] = useState(45);
  const commitFov = () => {
    const v = Math.min(Math.max(parseFloat(fov) || 45, 20), 90);
    setFov(v);
    onFov(v);
  };

  const body = (
    <>
      <div className="row">
        <label>Mode</label>
        <select value={camMode} onChange={(e) => onMode(e.target.value)}>
          <option value="orbit">Orbit</option>
          <option value="topdown">Top-down</option>
        </select>
      </div>
      <div className="row">
        <label>FOV</label>
        <input
          type="number"
          min="20"
          max="90"
          step="1"
          value={fov}
          onChange={(e) => setFov(e.target.value)}
          onBlur={commitFov}
          onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
        />
      </div>
      <div className="row"><label>Angle</label><input type="text" readOnly value={camInfo.angle} /></div>
      <div className="row"><label>Distance</label><input type="text" readOnly value={camInfo.distance} /></div>
      <button type="button" className="action-btn" onClick={onFocusCenter}>
        <svg viewBox="0 0 16 16" className="bic">
          <circle cx="8" cy="8" r="2" fill="currentColor" />
          <path d="M8 1.5v2.6M8 11.9v2.6M1.5 8h2.6M11.9 8h2.6" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        Focus Center
      </button>
    </>
  );

  if (embedded) {
    return (
      <ControlSection
        id="inspector-camera"
        title="CAMERA"
        defaultOpen
        icon={(
          <svg viewBox="0 0 16 16" fill="none">
            <path d="M2 5h3l1.5-2h3L11 5h3v7H2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            <circle cx="8" cy="8.5" r="2" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        )}
      >
        {body}
      </ControlSection>
    );
  }

  return (
    <section className="panel" id="camera-panel">
      <div className="panel-header"><span>CAMERA</span></div>
      <div className="panel-body">{body}</div>
    </section>
  );
}

export function LodPanel({ lodCounts, chunkCount, embedded }) {
  const total = lodCounts.reduce((a, b) => a + b, 0);

  const body = (
    <>
      {LOD_LEVELS.map((level, i) => (
        <div className="lod-row" key={level.name}>
          <span className="lod-dot" style={{ background: level.color }} />
          <span className="lod-name">{level.name}</span>
          <span className="lod-count">{lodLabel(lodCounts[i])}</span>
        </div>
      ))}
      <div className="stat-row">
        <span className="stat-label">Draw Calls</span>
        <span className="stat-value stat-mono">{total}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Active LOD</span>
        <span className="stat-value stat-mono">{chunkCount} × {chunkCount}</span>
      </div>
      <div className="lod-summary">
        <LodDonut counts={lodCounts} />
        <div className="lod-total">
          <div className="lod-total-num">{total}</div>
          <div className="lod-total-label">
            Total Chunks
            <span className="lod-grid-label">({chunkCount} × {chunkCount})</span>
          </div>
        </div>
      </div>
    </>
  );

  if (embedded) {
    return (
      <ControlSection
        id="inspector-lod"
        title="LOD INFORMATION"
        defaultOpen
        icon={(
          <svg viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1" />
            <rect x="9" y="5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1" />
            <rect x="5" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        )}
      >
        {body}
      </ControlSection>
    );
  }

  return (
    <section className="panel" id="lod-panel">
      <div className="panel-header"><span>LOD INFORMATION</span></div>
      <div className="panel-body">{body}</div>
    </section>
  );
}

export function MinimapPanel({ boardSize, baseRef, overlayRef, embedded }) {
  const body = (
    <>
      <div className="minimap-wrap">
        <canvas className="minimap-base" width="256" height="256" ref={baseRef} />
        <canvas className="minimap-overlay" width="256" height="256" ref={overlayRef} />
      </div>
      <div className="minimap-caption">Board: {boardSize} × {boardSize} units</div>
    </>
  );

  if (embedded) {
    return (
      <ControlSection
        id="inspector-minimap"
        title="MINIMAP"
        defaultOpen
        icon={(
          <svg viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
            <rect x="5" y="5" width="4" height="4" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      >
        {body}
      </ControlSection>
    );
  }

  return (
    <section className="panel" id="minimap-panel">
      <div className="panel-header"><span>MINIMAP</span></div>
      <div className="panel-body">{body}</div>
    </section>
  );
}
