import { translateText, useLanguage } from '../i18n/LanguageContext.jsx';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Ruler } from 'lucide-react';

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
  useLanguage();
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
  docked = false,
}) {
  useLanguage();
  const [collapsed, setCollapsed] = useState(!docked);
  const [mode, setMode] = useState('color');
  const [zoom, setZoom] = useState(1);
  const [showChunkGrid, setShowChunkGrid] = useState(false);
  const [showDistanceScale, setShowDistanceScale] = useState(true);
  const [hoverInfo, setHoverInfo] = useState(null);
  const wrapRef = useRef(null);
  const hoverRequestRef = useRef(0);

  useEffect(() => {
    onConfigChange?.({ mode, zoom, showChunkGrid, showDistanceScale });
  }, [mode, zoom, showChunkGrid, showDistanceScale, onConfigChange]);

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
    const requestId = hoverRequestRef.current + 1;
    hoverRequestRef.current = requestId;
    const result = onHoverInfoRequest?.(px, py) ?? null;
    if (result && typeof result.then === 'function') {
      void result.then((info) => {
        if (hoverRequestRef.current === requestId) setHoverInfo(info ?? null);
      }).catch(() => {
        if (hoverRequestRef.current === requestId) setHoverInfo(null);
      });
    } else setHoverInfo(result);
  };

  const clearHover = () => {
    hoverRequestRef.current += 1;
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

  useEffect(() => {
    if (docked) return undefined;

    const onKeyDown = (event) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;
      if (String(event.key ?? '').toLowerCase() !== 'm') return;

      event.preventDefault();
      setCollapsed((value) => !value);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [docked]);

  return (
    <div className={`minimap-overlay-container${collapsed ? ' collapsed' : ''}${drawerOpen ? ' drawer-open' : ''}${docked ? ' docked' : ''}`}>
      {!docked && <button
        type="button"
        className="minimap-fab"
        onClick={() => setCollapsed(false)}
        title={translateText("Show minimap")}
        aria-label={translateText("Show minimap")}
        aria-expanded={!collapsed}
      >
        <MapIcon />
      </button>}

      <div className="minimap-panel">
        <div className="minimap-overlay-header">
          <span className="minimap-title">
            <MapIcon />
            <span className="minimap-title-text">{translateText("Mini Map")}</span>
          </span>
          <div className="minimap-header-actions">
            {!docked && <button
              type="button"
              className="minimap-toggle-btn"
              onClick={() => setCollapsed((value) => !value)}
              title={translateText(collapsed ? 'Expand minimap' : 'Collapse minimap')}
              aria-label={translateText(collapsed ? 'Expand minimap' : 'Collapse minimap')}
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
            </button>}
          </div>
        </div>

        <div className="minimap-overlay-body">
          <div className="minimap-toolbar">
            <div className="minimap-zoom-group">
              <span className="minimap-zoom-value">{translateText(zoom)}{translateText("x")}</span>
            </div>
          </div>

          <div className="minimap-mode-grid">
            <button type="button"
              className={`tb-btn minimap-chip minimap-icon-chip${showDistanceScale ? ' active' : ''}`}
              onClick={() => setShowDistanceScale((value) => !value)}
              title={translateText("Distance scale")} aria-label={translateText("Distance scale")} aria-pressed={showDistanceScale}>
              <Ruler size={16} aria-hidden />
            </button>
            {MAP_MODES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`tb-btn minimap-chip minimap-icon-chip${mode === value ? ' active' : ''}`}
                onClick={() => setMode(value)}
                title={translateText(label)}
                aria-label={translateText(label)}
              >
                <PickerIcon mode={value} />
              </button>
            ))}
            <button
              type="button"
              className={`tb-btn minimap-chip minimap-icon-chip${showChunkGrid ? ' active' : ''}`}
              onClick={() => setShowChunkGrid((value) => !value)}
              title={translateText("Chunk grid")}
              aria-label={translateText("Chunk grid")}
            >
              <svg viewBox="0 0 16 16" fill="none" aria-hidden><path d="M2 2h12v12H2zM2 6h12M6 2v12M10 2v12M2 10h12" stroke="currentColor" strokeWidth="1.05" /></svg>
            </button>
          </div>

          <div
            ref={wrapRef}
            className="minimap-wrap"
            onMouseMove={updateHover}
            onMouseLeave={clearHover}
            data-tooltip={translateText("Interactive minimap with terrain overlays and hover inspection")}
          >
            <canvas className="minimap-base" width="256" height="256" ref={baseRef} />
            <canvas className="minimap-overlay" width="256" height="256" ref={overlayRef} />
          </div>

          <div className="minimap-meta">
            <div className="minimap-caption">
              <span>{translateText(modeLabel)}</span>
              <span>{translateText(boardSize)}{translateText(" x ")}{translateText(boardSize)}{translateText("u")}</span>
            </div>
            {SHOW_HOVER_INFO && hoverInfo ? (
              <div className="minimap-hover-info">
                <span>{translateText("Height: ")}{translateText(fmt(hoverInfo.height01, 2))}</span>
                <span>{translateText("Biome: ")}{translateText(hoverInfo.biome)}</span>
                <span>{translateText("Slope: ")}{translateText(fmt(hoverInfo.slope, 2))}</span>
                <span>{translateText("Water: ")}{translateText(hoverInfo.water ? 'true' : 'false')}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
