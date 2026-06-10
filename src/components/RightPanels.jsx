import { useEffect, useRef, useState } from 'react';
import { Panel } from './controls.jsx';

const LOD_LEVELS = [
  { name: 'LOD 0 (High)', color: '#e5484d' },
  { name: 'LOD 1 (Med)', color: '#f5a524' },
  { name: 'LOD 2 (Low)', color: '#f5d90a' },
  { name: 'LOD 3 (Far)', color: '#3b82f6' },
];

function lodLabel(count) {
  const side = Math.sqrt(count);
  return Number.isInteger(side) && count > 0 ? `${side} × ${side} chunks` : `${count} chunks`;
}

function LodDonut({ counts }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const rOut = canvas.width / 2 - 4, rIn = rOut * 0.58;
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
  return <canvas id="lod-donut" width="120" height="120" ref={ref} />;
}

export function CameraPanel({ camInfo, camMode, onMode, onFov, onFocusCenter }) {
  const [fov, setFov] = useState(45);
  const commitFov = () => {
    const v = Math.min(Math.max(parseFloat(fov) || 45, 20), 90);
    setFov(v);
    onFov(v);
  };
  return (
    <Panel id="camera-panel" title="CAMERA">
      <div className="row">
        <label>Mode</label>
        <select value={camMode} onChange={(e) => onMode(e.target.value)}>
          <option value="orbit">Orbit</option>
          <option value="topdown">Top-down</option>
        </select>
      </div>
      <div className="row">
        <label>FOV</label>
        <input type="number" min="20" max="90" step="1" value={fov}
          onChange={(e) => setFov(e.target.value)} onBlur={commitFov}
          onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
      </div>
      <div className="row"><label>Angle</label><input type="text" readOnly value={camInfo.angle} /></div>
      <div className="row"><label>Distance</label><input type="text" readOnly value={camInfo.distance} /></div>
      <button className="wide-btn" onClick={onFocusCenter}>
        <svg viewBox="0 0 16 16" className="bic">
          <circle cx="8" cy="8" r="2" fill="currentColor" />
          <path d="M8 1.5v2.6M8 11.9v2.6M1.5 8h2.6M11.9 8h2.6" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        Focus Center
      </button>
    </Panel>
  );
}

export function LodPanel({ lodCounts, chunkCount }) {
  const total = lodCounts.reduce((a, b) => a + b, 0);
  return (
    <Panel id="lod-panel" title="LOD INFORMATION">
      {LOD_LEVELS.map((level, i) => (
        <div className="lod-row" key={level.name}>
          <span className="lod-dot" style={{ background: level.color }} />
          <span className="lod-name">{level.name}</span>
          <span className="lod-count">{lodLabel(lodCounts[i])}</span>
        </div>
      ))}
      <div className="lod-summary">
        <LodDonut counts={lodCounts} />
        <div className="lod-total">
          <div className="lod-total-num">{total}</div>
          <div className="lod-total-label">
            Total Chunks<br />
            <span id="lod-grid-label">({chunkCount} × {chunkCount})</span>
          </div>
        </div>
      </div>
    </Panel>
  );
}

export function MinimapPanel({ boardSize, baseRef, overlayRef }) {
  return (
    <Panel id="minimap-panel" title="MINIMAP">
      <div id="minimap-wrap">
        <canvas id="minimap-base" width="256" height="256" ref={baseRef} />
        <canvas id="minimap-overlay" width="256" height="256" ref={overlayRef} />
      </div>
      <div id="minimap-caption">Board Size: {boardSize} × {boardSize} units</div>
    </Panel>
  );
}
