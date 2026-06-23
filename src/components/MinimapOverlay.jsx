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
              <button type="button" className={`tb-btn minimap-chip${sizeMode === 'compact' ? ' active' : ''}`} onClick={() => setSizeMode('compact')}>Compact</button>
              <button type="button" className={`tb-btn minimap-chip${sizeMode === 'large' ? ' active' : ''}`} onClick={() => setSizeMode('large')}>Large</button>
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
                className={`tb-btn minimap-chip${mode === value ? ' active' : ''}`}
                onClick={() => setMode(value)}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className={`tb-btn minimap-chip${showChunkGrid ? ' active' : ''}`}
              onClick={() => setShowChunkGrid((value) => !value)}
            >
              Chunk Grid
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
