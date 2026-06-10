import { useMemo, useRef, useState } from 'react';
import { SliderCtl, ToggleRow, SelectRow } from './controls.jsx';
import {
  PERF_PRESETS, PERF_LIMITS, getPerfPresetKeys,
  resolveLodSegments, resolveLodDistances, estimateTriangles,
} from '../engine/render/PerformanceSettings.js';

const lim = (key, label, step, opts = {}) => ({
  key, label, step, min: PERF_LIMITS[key].min, max: PERF_LIMITS[key].max, ...opts,
});

const PERF_SLIDERS = {
  renderScale: lim('renderScale', 'Render Scale', 0.05, { digits: 2, unit: '×' }),
  resolutionScale: lim('resolutionScale', 'Terrain Resolution', 0.05, { digits: 2, unit: '×' }),
  lodDistanceScale: lim('lodDistanceScale', 'LOD Distance Scale', 0.05, { digits: 2, unit: '×' }),
  viewRadius: lim('viewRadius', 'Chunk Load Radius', 1, { unit: 'chunks' }),
  maxCreatesPerFrame: lim('maxCreatesPerFrame', 'Chunk Builds / Frame', 1),
  cullingAggressiveness: lim('cullingAggressiveness', 'Culling Aggressiveness', 0.1, { digits: 1 }),
  waterReflection: lim('waterReflection', 'Water Reflection', 0.05, { digits: 2, unit: '×' }),
  waterDetail: lim('waterDetail', 'Water Detail', 0.05, { digits: 2, unit: '×' }),
  waterWaves: lim('waterWaves', 'Wave Complexity', 0.05, { digits: 2, unit: '×' }),
  waterDistance: lim('waterDistance', 'Water Distance', 0.05, { digits: 2, unit: '×' }),
  fogDistance: lim('fogDistance', 'Fog Distance', 0.05, { digits: 2, unit: '×' }),
};

const WATER_QUALITY_OPTIONS = [
  { value: 0, label: 'Low' },
  { value: 1, label: 'Medium' },
  { value: 2, label: 'High' },
];

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'lod', label: 'LOD' },
  { id: 'streaming', label: 'Streaming' },
  { id: 'water', label: 'Water' },
  { id: 'fog', label: 'Fog' },
];

function LodMultiSlider({ segments, onChange }) {
  const trackRef = useRef(null);
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  const { min, max } = PERF_LIMITS.lodSegment;
  const lmin = Math.log2(min);
  const lmax = Math.log2(max);
  const toPos = (v) => ((Math.log2(v) - lmin) / (lmax - lmin)) * 100;

  const startDrag = (e, i) => {
    e.preventDefault();
    const rect = trackRef.current.getBoundingClientRect();
    const move = (ev) => {
      const x = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
      const target = Math.pow(2, lmin + x * (lmax - lmin));
      const cur = segmentsRef.current;
      const factor = target / cur[i];
      onChange(cur.map((s) =>
        Math.round(Math.min(max, Math.max(min, s * factor)))
      ));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="ctl">
      <div className="ctl-top">
        <label>LOD Resolutions</label>
        <span className="ctl-val lod-multi-val">{segments.join(' / ')}</span>
      </div>
      <div className="lod-multi-track" ref={trackRef}>
        {segments.map((seg, i) => (
          <div
            key={i}
            className="lod-multi-thumb"
            style={{ left: `${toPos(seg)}%` }}
            onPointerDown={(e) => startDrag(e, i)}
            title={`LOD${i}: ${seg} segments`}
          >
            <span className="lod-multi-tag">L{i}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PerfSlider({ perf, id, onPerfSetting }) {
  const def = PERF_SLIDERS[id];
  return (
    <SliderCtl def={def} value={perf[def.key]} onChange={(v) => onPerfSetting(def.key, v)} />
  );
}

function SettingGroup({ tab, label, keywords, search, activeTab, children }) {
  const haystack = `${label} ${keywords} ${tab}`.toLowerCase();
  const q = search.trim().toLowerCase();
  const visible = q ? haystack.includes(q) : tab === activeTab;
  if (!visible) return null;

  return (
    <div className="settings-field" data-setting-tab={tab} data-setting-label={label}>
      {q && <span className="settings-field-tab">{TABS.find((t) => t.id === tab)?.label}</span>}
      {children}
    </div>
  );
}

function SettingNote({ tab, text, search, activeTab }) {
  const q = search.trim().toLowerCase();
  if (q || tab !== activeTab) return null;
  return <p className="settings-note">{text}</p>;
}

export default function SettingsModal({
  open, onClose, perf, onPerfPreset, onPerfSetting, onPerfReset,
}) {
  const [activeTab, setActiveTab] = useState('overview');
  const [search, setSearch] = useState('');

  const presetOptions = useMemo(() => [
    ...getPerfPresetKeys().map((k) => ({ value: k, label: PERF_PRESETS[k].label })),
    { value: 'custom', label: 'Custom' },
  ], []);

  if (!open) return null;

  const segments = perf ? resolveLodSegments(perf) : [];
  const distances = perf ? resolveLodDistances(perf) : [];
  const estTris = perf ? estimateTriangles(perf) : 0;
  const isSearching = search.trim().length > 0;

  const setLodDistance = (i, v) => {
    const next = [...perf.lodDistances];
    next[i] = v;
    onPerfSetting('lodDistances', next);
  };

  const groupProps = { search, activeTab };

  return (
    <div className="modal settings-modal" onClick={(e) => e.target.classList.contains('modal') && onClose()}>
      <div className="settings-modal-card" onClick={(e) => e.stopPropagation()}>
        <header className="settings-modal-header">
          <div className="settings-modal-title">
            <svg viewBox="0 0 16 16" width="18" height="18" fill="none" aria-hidden>
              <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.2" />
              <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            <span>Project Settings</span>
          </div>
          <button type="button" className="settings-modal-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="settings-modal-toolbar">
          <div className="settings-search-wrap">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              className="settings-search-input"
              placeholder="Search settings…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button type="button" className="settings-search-clear" onClick={() => setSearch('')} aria-label="Clear search">
                ✕
              </button>
            )}
          </div>
        </div>

        {!isSearching && (
          <nav className="settings-tabs" aria-label="Settings categories">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`settings-tab${activeTab === tab.id ? ' active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        )}

        <div className="settings-modal-body">
          {!perf ? (
            <p className="settings-empty">Performance settings are loading…</p>
          ) : isSearching ? (
            <div className="settings-search-results">
              <p className="settings-search-hint">Search results</p>
              {renderSettings({ perf, presetOptions, segments, distances, estTris, setLodDistance, onPerfPreset, onPerfSetting, onPerfReset, groupProps })}
            </div>
          ) : (
            <div className="settings-tab-panel">
              {renderSettings({ perf, presetOptions, segments, distances, estTris, setLodDistance, onPerfPreset, onPerfSetting, onPerfReset, groupProps })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function renderSettings({
  perf, presetOptions, segments, distances, estTris,
  setLodDistance, onPerfPreset, onPerfSetting, onPerfReset, groupProps,
}) {
  return (
    <>
      <SettingGroup tab="overview" label="Performance Preset" keywords="preset quality profile" {...groupProps}>
        <SelectRow label="Preset" value={perf.preset} options={presetOptions} onChange={onPerfPreset} />
      </SettingGroup>

      <SettingGroup tab="overview" label="Auto Performance Mode" keywords="automatic dynamic fps" {...groupProps}>
        <ToggleRow label="Auto Performance Mode" value={perf.autoPerf} onChange={(v) => onPerfSetting('autoPerf', v)} />
      </SettingGroup>

      <SettingGroup tab="overview" label="Render Scale" keywords="resolution pixel dpr scale" {...groupProps}>
        <PerfSlider perf={perf} id="renderScale" onPerfSetting={onPerfSetting} />
      </SettingGroup>

      <SettingNote tab="overview" text={`Worst-case visible triangles: ~${(estTris / 1e6).toFixed(2)}M`} {...groupProps} />

      <SettingGroup tab="overview" label="Reset Performance" keywords="restore defaults" {...groupProps}>
        <button type="button" className="action-btn perf-reset-btn" onClick={onPerfReset}>
          Reset Performance Settings
        </button>
      </SettingGroup>

      <SettingGroup tab="lod" label="Terrain Resolution" keywords="mesh detail segments" {...groupProps}>
        <PerfSlider perf={perf} id="resolutionScale" onPerfSetting={onPerfSetting} />
      </SettingGroup>

      <SettingGroup tab="lod" label="LOD Distance Scale" keywords="level detail distance" {...groupProps}>
        <PerfSlider perf={perf} id="lodDistanceScale" onPerfSetting={onPerfSetting} />
      </SettingGroup>

      <SettingGroup tab="lod" label="LOD Resolutions" keywords="segments mesh lod0 lod1 lod2 lod3" {...groupProps}>
        <LodMultiSlider segments={perf.lodSegments} onChange={(next) => onPerfSetting('lodSegments', next)} />
      </SettingGroup>

      <SettingNote tab="lod" text={`Effective segments: ${segments.join(' / ')}`} {...groupProps} />

      {perf.lodDistances.map((d, i) => (
        <SettingGroup
          key={`lod-dist-${i}`}
          tab="lod"
          label={`LOD ${i} → ${i + 1} Distance`}
          keywords={`lod distance threshold chunk level ${i}`}
          {...groupProps}
        >
          <SliderCtl
            def={{
              label: `LOD${i}→${i + 1} Distance`,
              min: PERF_LIMITS.lodDistance.min,
              max: PERF_LIMITS.lodDistance.max,
              step: 0.5,
              digits: 1,
              unit: '× chunk',
            }}
            value={d}
            onChange={(v) => setLodDistance(i, v)}
          />
        </SettingGroup>
      ))}

      <SettingNote tab="lod" text={`Effective distances: ${distances.map((d) => d.toFixed(1)).join(' / ')} × chunk size`} {...groupProps} />

      <SettingGroup tab="streaming" label="Chunk Load Radius" keywords="view radius streaming load" {...groupProps}>
        <PerfSlider perf={perf} id="viewRadius" onPerfSetting={onPerfSetting} />
      </SettingGroup>

      <SettingGroup tab="streaming" label="Chunk Builds Per Frame" keywords="create spawn streaming budget" {...groupProps}>
        <PerfSlider perf={perf} id="maxCreatesPerFrame" onPerfSetting={onPerfSetting} />
      </SettingGroup>

      <SettingGroup tab="streaming" label="Triangle Budget" keywords="triangles limit budget mesh" {...groupProps}>
        <SliderCtl
          def={{ label: 'Triangle Budget', min: 0.1, max: 3, step: 0.1, digits: 1, unit: 'M' }}
          value={perf.triangleBudget / 1e6}
          onChange={(v) => onPerfSetting('triangleBudget', Math.round(v * 1e6))}
        />
      </SettingGroup>

      <SettingGroup tab="streaming" label="Culling Aggressiveness" keywords="frustum behind camera cull" {...groupProps}>
        <PerfSlider perf={perf} id="cullingAggressiveness" onPerfSetting={onPerfSetting} />
      </SettingGroup>

      <SettingGroup tab="water" label="Water Quality" keywords="shader reflection detail waves" {...groupProps}>
        <SelectRow
          label="Water Quality"
          value={perf.waterQuality}
          options={WATER_QUALITY_OPTIONS}
          onChange={(v) => onPerfSetting('waterQuality', parseInt(v, 10))}
        />
      </SettingGroup>

      <SettingGroup tab="water" label="Water Reflection" keywords="specular glint sun" {...groupProps}>
        <PerfSlider perf={perf} id="waterReflection" onPerfSetting={onPerfSetting} />
      </SettingGroup>

      <SettingGroup tab="water" label="Water Detail" keywords="ripple octave shader" {...groupProps}>
        <PerfSlider perf={perf} id="waterDetail" onPerfSetting={onPerfSetting} />
      </SettingGroup>

      <SettingGroup tab="water" label="Wave Complexity" keywords="waves animation ocean" {...groupProps}>
        <PerfSlider perf={perf} id="waterWaves" onPerfSetting={onPerfSetting} />
      </SettingGroup>

      <SettingGroup tab="water" label="Water Distance" keywords="extent range fade" {...groupProps}>
        <PerfSlider perf={perf} id="waterDistance" onPerfSetting={onPerfSetting} />
      </SettingGroup>

      <SettingGroup tab="fog" label="Fog Distance" keywords="horizon haze atmosphere visibility" {...groupProps}>
        <PerfSlider perf={perf} id="fogDistance" onPerfSetting={onPerfSetting} />
      </SettingGroup>
    </>
  );
}
