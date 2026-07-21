// ============================================================================
// Minimal HUD overlay for Infinite World Mode.
// Shows crosshair, position, speed, chunk stats, quality preset selector,
// time-of-day slider, and a return button.
// ============================================================================

import React, { useState } from 'react';
import { Compass } from 'lucide-react';
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
  flying: 'Flying',
  stalling: 'Stalling',
};

const DockBtn = ({ active, onClick, title, children }) => (
  <button
    type="button"
    className={`fps-dock-btn camera-bar-btn${active ? ' active' : ''}`}
    onClick={onClick}
    title={title}
    aria-pressed={active}
  >
    {children}
  </button>
);

export default function InfiniteHUD({
  stats, onReturn, isPlanet,
  exploreMode, onExploreMode,
  quality, onQualityChange,
  timeOfDay, onTimeOfDay,
  behindCameraCulling, onBehindCameraCulling,
  planetPreset, onPlanetPreset, onGeneratePalette, onRandomPlanet,
  perf, rendererInfo, gpu, perfStats, onPerfPreset, onPerfSetting, onPerfReset,
}) {
  const [perfOpen, setPerfOpen] = useState(false);
  if (!stats) return null;

  const qualityKeys = getQualityKeys();
  const togglePerf = () => setPerfOpen((v) => !v);
  const exploring = exploreMode === 'walk' || exploreMode === 'plane' || exploreMode === 'freecam';

  return (
    <>
      <div id="fps-crosshair">
        <svg width="24" height="24" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="2" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.2" />
          <line x1="12" y1="4" x2="12" y2="9" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
          <line x1="12" y1="15" x2="12" y2="20" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
          <line x1="4" y1="12" x2="9" y2="12" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
          <line x1="15" y1="12" x2="20" y2="12" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
        </svg>
      </div>

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
        {exploring && stats.playerState && (
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

      <div id="fps-settings-panel">
        <div className="fps-setting-row">
          <span className="fps-setting-label">Explore</span>
          <div className="fps-explore-select" role="group" aria-label="Explore mode">
            <button
              type="button"
              className={`fps-explore-option${exploreMode === 'walk' ? ' active' : ''}`}
              onClick={() => onExploreMode?.('walk')}
              title="Walk on the terrain"
            >
              <Compass aria-hidden size={12} strokeWidth={1.8} />
              Walk
            </button>
            <button
              type="button"
              className={`fps-explore-option${exploreMode === 'plane' ? ' active' : ''}`}
              onClick={() => onExploreMode?.('plane')}
              title="Fly with throttle, lift, gravity, and stalls"
            >
              Plane
            </button>
            {exploreMode === 'freecam' && (
              <button
                type="button"
                className="fps-explore-option active"
                onClick={() => onExploreMode?.('freecam')}
                title="Exit no-clip free camera"
              >
                Free Cam
              </button>
            )}
          </div>
        </div>
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

      <div id="fps-speed-bar">
        <svg viewBox="0 0 16 16" width="14" height="14">
          <path d="M8 2v8M4 6l4-4 4 4" stroke="currentColor" fill="none" strokeWidth="1.3" strokeLinejoin="round" />
          <line x1="3" y1="13" x2="13" y2="13" stroke="currentColor" strokeWidth="1.3" />
        </svg>
        <span>{stats.speed} u/s</span>
        <span className="fps-speed-hint">Scroll to adjust</span>
      </div>

      {perf && (
        <div className="fps-mobile-dock">
          <DockBtn active={perfOpen} onClick={togglePerf} title="Performance">
            <svg viewBox="0 0 16 16" fill="none" width="14" height="14" aria-hidden>
              <path d="M2 12h12M4 9l2.5-4 2.5 3.2L13 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </DockBtn>
          <span className="fps-dock-speed">{stats.speed} u/s</span>
        </div>
      )}

      {perf && (
        <div id="fps-perf-window" className={perfOpen ? 'open' : ''}>
          <button
            type="button"
            className="fps-perf-header fps-perf-header-desktop"
            onClick={togglePerf}
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
                rendererInfo={rendererInfo}
                onPerfPreset={onPerfPreset}
                onPerfSetting={onPerfSetting}
                onPerfReset={onPerfReset}
              />
            </div>
          )}
        </div>
      )}

      <div id="fps-controls-hint">
        {exploreMode === 'walk' ? (
          <>
            <span>ZQSD</span> Move &nbsp;·&nbsp;
            <span>Mouse</span> Look &nbsp;·&nbsp;
            <span>Shift</span> Run &nbsp;·&nbsp;
            <span>Space</span> Jump/Swim up &nbsp;·&nbsp;
            <span>Ctrl/C</span> Swim down &nbsp;·&nbsp;
            <span>Scroll</span> Speed &nbsp;·&nbsp;
            Click to lock mouse
          </>
        ) : exploreMode === 'plane' ? (
          <>
            <span>Mouse</span> Pitch/bank &nbsp;/&nbsp;
            <span>W/S</span> Throttle/brake &nbsp;/&nbsp;
            <span>A/D</span> Bank &nbsp;/&nbsp;
            <span>Scroll</span> Cruise speed &nbsp;/&nbsp;
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
    </>
  );
}
