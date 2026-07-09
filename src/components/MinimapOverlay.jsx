import { useEffect, useMemo, useRef, useState } from 'react';

const MAP_MODES = [
  ['color', 'Color'],
  ['height', 'Height Map'],
  ['biome', 'Biome Map'],
  ['noise', 'Noise Map'],
  ['water', 'Water Mask'],
  ['slope', 'Slope Map'],
  ['props', 'Props Mask'],
];

const SHOW_HOVER_INFO = false;

const fmt = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : '0.00';

const MapIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" width="14" height="14" aria-hidden>
    <path d="M1 3l4.5-2v12L1 15V3zM5.5 1l5 2v12l-5-2V1zM10.5 3L15 1v12l-4.5 2V3z" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

const PickerIcon = ({ mode }) => {
  if (mode === 'height') return <svg viewBox="0 0 16 16" fill="none" aria-hidden><path d="M2 12 6 7l2 2 3-5 3 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (mode === 'biome') return <svg viewBox="0 0 16 16" fill="none" aria-hidden><path d="M8 14V8m0 0C5 8 3 6 3 3c3 0 5 2 5 5Zm0 2c2.5 0 4.5-1.5 5-4-2.7 0-5 1.5-5 4Z" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" /></svg>;
  if (mode === 'noise') return <svg viewBox="0 0 16 16" fill="none" aria-hidden><path d="M2 5c2-4 4 4 6 0s4 4 6 0M2 11c2-4 4 4 6 0s4 4 6 0" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" /></svg>;
  if (mode === 'water') return <svg viewBox="0 0 16 16" fill="none" aria-hidden><path d="M2 9c1.3 1.3 2.7 1.3 4 0 1.3 1.3 2.7 1.3 4 0 1.3 1.3 2.7 1.3 4 0M3 5c1.7-2 3-3 5-3s3.3 1 5 3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" /></svg>;
  if (mode === 'slope') return <svg viewBox="0 0 16 16" fill="none" aria-hidden><path d="M2 13 8 3l6 10H2Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" /></svg>;
  if (mode === 'props') return <svg viewBox="0 0 16 16" fill="none" aria-hidden><circle cx="5" cy="10" r="2" stroke="currentColor" strokeWidth="1.2" /><circle cx="11" cy="6" r="2" stroke="currentColor" strokeWidth="1.2" /><path d="M8 14V8" stroke="currentColor" strokeWidth="1.2" /></svg>;
  return <MapIcon />;
};

const clampZoom = (value) => Math.max(1, Math.min(6, value));

export default function MinimapOverlay({
  boardSize,
  baseRef,
  overlayRef,
  drawerOpen = false,
  onConfigChange,
  onHoverChange,
  onHoverInfoRequest,
}) {
  const [collapsed, setCollapsed] = useState(true);
  const [sizeMode, setSizeMode] = useState('compact');
  const [mode, setMode] = useState('color');
  const [zoom, setZoom] = useState(1);
  const [showChunkGrid, setShowChunkGrid] = useState(false);
  const [hoverInfo, setHoverInfo] = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    onConfigChange?.({ mode, zoom, showChunkGrid });
  }, [mode, zoom, showChunkGrid, onConfigChange]);

  const modeLabel = useMemo(
    () => MAP_MODES.find(([value]) => value === mode)?.[1] ?? 'Color',
    [mode],
  );

  const updateHover = (event) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((event.clientX - rect.left) / rect.width) * 256;
    const py = ((event.clientY - rect.top) / rect.height) * 256;
    onHoverChange?.({ x: px, y: py });
    setHoverInfo(onHoverInfoRequest?.(px, py) ?? null);
  };

  const clearHover = () => {
    onHoverChange?.(null);
    setHoverInfo(null);
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      setZoom((value) => clampZoom(value + (event.deltaY > 0 ? -1 : 1)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div className={`minimap-overlay-container ${sizeMode}${collapsed ? ' collapsed' : ''}${drawerOpen ? ' drawer-open' : ''}`}>
      <button
        type="button"
        className="minimap-fab"
        onClick={() => setCollapsed(false)}
        title="Show minimap"
        aria-label="Show minimap"
        aria-expanded={!collapsed}
      >
        <MapIcon />
      </button>

      <div className="minimap-panel">
        <div className="minimap-overlay-header">
          <span className="minimap-title">
            <MapIcon />
            <span className="minimap-title-text">Mini Map</span>
          </span>
          <div className="minimap-header-actions">
            <button
              type="button"
              className="minimap-toggle-btn"
              onClick={() => setCollapsed((value) => !value)}
              title={collapsed ? 'Expand minimap' : 'Collapse minimap'}
              aria-label={collapsed ? 'Expand minimap' : 'Collapse minimap'}
            >
              {collapsed ? (
                <svg viewBox="0 0 16 16" width="10" height="10" fill="none" aria-hidden>
                  <path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" width="10" height="10" fill="none" aria-hidden>
                  <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              )}
            </button>
          </div>
        </div>

        <div className="minimap-overlay-body">
          <div className="minimap-toolbar">
            <div className="minimap-segmented">
              <button type="button" className={`tb-btn minimap-chip minimap-icon-chip${sizeMode === 'compact' ? ' active' : ''}`} onClick={() => setSizeMode('compact')} title="Compact minimap" aria-label="Compact minimap"><svg viewBox="0 0 16 16" fill="none" aria-hidden><rect x="4" y="4" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.3" /></svg></button>
              <button type="button" className={`tb-btn minimap-chip minimap-icon-chip${sizeMode === 'large' ? ' active' : ''}`} onClick={() => setSizeMode('large')} title="Large minimap" aria-label="Large minimap"><svg viewBox="0 0 16 16" fill="none" aria-hidden><rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="1.3" /></svg></button>
            </div>
            <div className="minimap-zoom-group">
              <span className="minimap-zoom-value">{zoom}x</span>
            </div>
          </div>

          <div className="minimap-mode-grid">
            {MAP_MODES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`tb-btn minimap-chip minimap-icon-chip${mode === value ? ' active' : ''}`}
                onClick={() => setMode(value)}
                title={label}
                aria-label={label}
              >
                <PickerIcon mode={value} />
              </button>
            ))}
            <button
              type="button"
              className={`tb-btn minimap-chip minimap-icon-chip${showChunkGrid ? ' active' : ''}`}
              onClick={() => setShowChunkGrid((value) => !value)}
              title="Chunk grid"
              aria-label="Chunk grid"
            >
              <svg viewBox="0 0 16 16" fill="none" aria-hidden><path d="M2 2h12v12H2zM2 6h12M6 2v12M10 2v12M2 10h12" stroke="currentColor" strokeWidth="1.05" /></svg>
            </button>
          </div>

          <div
            ref={wrapRef}
            className="minimap-wrap"
            onMouseMove={updateHover}
            onMouseLeave={clearHover}
            data-tooltip="Interactive minimap with terrain overlays and hover inspection"
          >
            <canvas className="minimap-base" width="256" height="256" ref={baseRef} />
            <canvas className="minimap-overlay" width="256" height="256" ref={overlayRef} />
          </div>

          <div className="minimap-meta">
            <div className="minimap-caption">
              <span>{modeLabel}</span>
              <span>{boardSize} x {boardSize}u</span>
            </div>
            {SHOW_HOVER_INFO && hoverInfo ? (
              <div className="minimap-hover-info">
                <span>Height: {fmt(hoverInfo.height01, 2)}</span>
                <span>Biome: {hoverInfo.biome}</span>
                <span>Slope: {fmt(hoverInfo.slope, 2)}</span>
                <span>Water: {hoverInfo.water ? 'true' : 'false'}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
