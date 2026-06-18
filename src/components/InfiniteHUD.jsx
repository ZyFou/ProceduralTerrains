// ============================================================================
// Minimal HUD overlay for Infinite World Mode.
// Shows crosshair, position, speed, chunk stats, quality preset selector,
// time-of-day slider, and a return button.
// ============================================================================

import { useState } from 'react';
import { formatTimeOfDay } from '../engine/sky/TimeOfDay.js';
import { QUALITY_PRESETS, getQualityKeys } from '../engine/render/QualitySettings.js';
import { PLANET_PRESETS } from '../engine/style/PlanetPresets.js';
import PerfSettings from './panels/PerfSettings.jsx';
import PerformanceStats from './ui/PerformancePanel.jsx';

const PLAYER_STATE_LABELS = {
  grounded: 'Grounded',
  falling: 'Falling',
  swimming: 'Swimming',
  underwater: 'Underwater',
};

export default function InfiniteHUD({
  stats, onReturn, isPlanet,
  playerMode, onPlayerMode,
  quality, onQualityChange,
  timeOfDay, onTimeOfDay,
  behindCameraCulling, onBehindCameraCulling,
  planetPreset, onPlanetPreset, onGeneratePalette, onRandomPlanet,
  perf, gpu, perfStats, onPerfPreset, onPerfSetting, onPerfReset,
}) {
  const [perfOpen, setPerfOpen] = useState(false);
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
        {playerMode && stats.playerState && (
          <div className="fps-info-row">
            <span className="fps-info-label">STATE</span>
            <span className={`fps-info-val player-state player-state-${stats.playerState}`}>
              {PLAYER_STATE_LABELS[stats.playerState] ?? stats.playerState}
            </span>
          </div>
        )}
        {stats.culledChunks > 0 && (
          <div className="fps-info-row">
            <span className="fps-info-label">CULLED</span>
            <span className="fps-info-val fps-info-culled">{stats.culledChunks}</span>
          </div>
        )}
      </div>

      {/* Top-right controls panel */}
      <div id="fps-settings-panel">
        {/* Player physics toggle */}
        <div className="fps-setting-row">
          <span className="fps-setting-label">Walk mode</span>
          <button
            type="button"
            className={`toggle${playerMode ? ' on' : ''}`}
            onClick={onPlayerMode}
            aria-pressed={!!playerMode}
            title="Player physics: gravity, walking, jumping, swimming"
          />
        </div>

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

      {/* Collapsible performance window (bottom) */}
      {perf && (
        <div id="fps-perf-window" className={perfOpen ? 'open' : ''}>
          <button
            type="button"
            className="fps-perf-header"
            onClick={() => setPerfOpen((v) => !v)}
            aria-expanded={perfOpen}
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden>
              <path d="M2 12h12M4 9l2.5-4 2.5 3.2L13 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="fps-perf-title">Performance</span>
            <svg className="fps-perf-chevron" viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden>
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {perfOpen && (
            <div className="fps-perf-body">
              <PerformanceStats stats={perfStats} gpu={gpu} />
              <PerfSettings
                perf={perf}
                onPerfPreset={onPerfPreset}
                onPerfSetting={onPerfSetting}
                onPerfReset={onPerfReset}
              />
            </div>
          )}
        </div>
      )}

      {/* Controls hint */}
      <div id="fps-controls-hint">
        {playerMode ? (
          <>
            <span>ZQSD</span> Move &nbsp;·&nbsp;
            <span>Mouse</span> Look &nbsp;·&nbsp;
            <span>Shift</span> Run &nbsp;·&nbsp;
            <span>Space</span> Jump/Swim up &nbsp;·&nbsp;
            <span>Ctrl/C</span> Swim down &nbsp;·&nbsp;
            <span>Scroll</span> Speed &nbsp;·&nbsp;
            Click to lock mouse
          </>
        ) : (
          <>
            <span>ZQSD</span> Move &nbsp;·&nbsp;
            <span>Mouse</span> Look &nbsp;·&nbsp;
            <span>Scroll</span> Speed &nbsp;·&nbsp;
            <span>Space/Shift</span> Up/Down &nbsp;·&nbsp;
            Click to lock mouse
          </>
        )}
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
