// ============================================================================
// Minimal HUD overlay for Infinite World Mode.
// Shows crosshair, position, speed, chunk stats, quality preset selector,
// time-of-day slider, and a return button.
// ============================================================================

import { formatTimeOfDay } from '../engine/sky/TimeOfDay.js';
import { QUALITY_PRESETS, getQualityKeys } from '../engine/render/QualitySettings.js';
import { PLANET_PRESETS } from '../engine/style/PlanetPresets.js';

export default function InfiniteHUD({
  stats, onReturn,
  quality, onQualityChange,
  timeOfDay, onTimeOfDay,
  behindCameraCulling, onBehindCameraCulling,
  planetPreset, onPlanetPreset, onGeneratePalette, onRandomPlanet,
}) {
  if (!stats) return null;

  const qualityKeys = getQualityKeys();

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
          <span className="fps-info-val">
            {stats.visibleChunks ?? stats.chunks}
            <span className="fps-info-dim"> / {stats.chunks}</span>
          </span>
        </div>
        {stats.culledChunks > 0 && (
          <div className="fps-info-row">
            <span className="fps-info-label">CULLED</span>
            <span className="fps-info-val fps-info-culled">{stats.culledChunks}</span>
          </div>
        )}
      </div>

      {/* Top-right controls panel */}
      <div id="fps-settings-panel">
        {/* Quality selector */}
        <div className="fps-setting-row">
          <span className="fps-setting-label">Quality</span>
          <select
            id="fps-quality-select"
            className="fps-select"
            value={quality}
            onChange={(e) => onQualityChange(e.target.value)}
          >
            {qualityKeys.map((key) => (
              <option key={key} value={key}>
                {QUALITY_PRESETS[key].label}
              </option>
            ))}
            {quality === 'custom' && <option value="custom">Custom</option>}
          </select>
        </div>

        {/* Time of day slider */}
        <div className="fps-setting-row">
          <span className="fps-setting-label">Time</span>
          <span className="fps-setting-value">{formatTimeOfDay(timeOfDay)}</span>
        </div>
        <input
          id="fps-tod-slider"
          className="fps-slider"
          type="range"
          min="0"
          max="1"
          step="0.005"
          value={timeOfDay}
          style={{ '--fill': `${timeOfDay * 100}%` }}
          onChange={(e) => onTimeOfDay(parseFloat(e.target.value))}
        />

        {/* Planet style (compact) */}
        <div className="fps-setting-row">
          <span className="fps-setting-label">Planet</span>
          <select
            className="fps-select"
            value={planetPreset ?? 'earth'}
            onChange={(e) => onPlanetPreset?.(e.target.value)}
          >
            {Object.entries(PLANET_PRESETS).map(([key, p]) => (
              <option key={key} value={key}>{p.label}</option>
            ))}
          </select>
        </div>
        <div className="fps-planet-actions">
          <button type="button" className="fps-mini-btn" onClick={() => onGeneratePalette?.()}>
            Gen Palette
          </button>
          <button type="button" className="fps-mini-btn" onClick={() => onRandomPlanet?.()}>
            Random
          </button>
        </div>

        {/* Behind-camera culling toggle */}
        <div className="fps-setting-row">
          <span className="fps-setting-label">Back culling</span>
          <button
            type="button"
            className={`toggle${behindCameraCulling ? ' on' : ''}`}
            onClick={() => onBehindCameraCulling(!behindCameraCulling)}
            aria-pressed={!!behindCameraCulling}
          />
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
      {/* <button id="fps-return-btn" onClick={onReturn} title="Return to Terrain Studio">
        <svg viewBox="0 0 16 16" width="14" height="14">
          <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" stroke="currentColor" fill="none" strokeWidth="1.3" />
          <path d="M13.7 1.8v2.8h-2.8" stroke="currentColor" fill="none" strokeWidth="1.3" />
        </svg>
        Terrain Studio
      </button> */}
    </>
  );
}
