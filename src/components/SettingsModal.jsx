import { useRef } from 'react';
import { SliderCtl, ToggleRow, SelectRow } from './controls.jsx';
import {
  PERF_PRESETS, PERF_LIMITS, getPerfPresetKeys,
  resolveLodSegments, resolveLodDistances, estimateTriangles,
} from '../engine/render/PerformanceSettings.js';

// slider definition shorthand from PERF_LIMITS
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

function SectionTitle({ children }) {
  return <div className="settings-section-title">{children}</div>;
}

function SubTitle({ children }) {
  return <div className="settings-subtitle">{children}</div>;
}

// One slider, four thumbs — one per LOD level. The 4 segment counts are
// proportional, so dragging any thumb rescales the whole set by the same
// factor. Positions use a log2 scale so 8/16/32/64 spread out evenly.
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
          <div key={i} className="lod-multi-thumb" style={{ left: `${toPos(seg)}%` }}
            onPointerDown={(e) => startDrag(e, i)} title={`LOD${i}: ${seg} segments`}>
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
    <SliderCtl def={def} value={perf[def.key]}
      onChange={(v) => onPerfSetting(def.key, v)} />
  );
}

export default function SettingsModal({ open, params, onParam, onClose, perf, onPerfPreset, onPerfSetting, onPerfReset }) {
  if (!open) return null;

  const presetOptions = [
    ...getPerfPresetKeys().map((k) => ({ value: k, label: PERF_PRESETS[k].label })),
    { value: 'custom', label: 'Custom' },
  ];

  const segments = perf ? resolveLodSegments(perf) : [];
  const distances = perf ? resolveLodDistances(perf) : [];
  const estTris = perf ? estimateTriangles(perf) : 0;

  const setLodDistance = (i, v) => {
    const next = [...perf.lodDistances];
    next[i] = v;
    onPerfSetting('lodDistances', next);
  };

  return (
    <div className="modal" onClick={(e) => e.target.classList.contains('modal') && onClose()}>
      <div className="modal-card">
        <div className="modal-header">
          <span>Project Settings</span>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {perf && (
            <>
              <SectionTitle>Performance</SectionTitle>
              <SelectRow label="Preset" value={perf.preset} options={presetOptions}
                onChange={(v) => onPerfPreset(v)} />
              <ToggleRow label="Auto Performance Mode" value={perf.autoPerf}
                onChange={(v) => onPerfSetting('autoPerf', v)} />
              <PerfSlider perf={perf} id="renderScale" onPerfSetting={onPerfSetting} />

              <SubTitle>Terrain LOD</SubTitle>
              <PerfSlider perf={perf} id="resolutionScale" onPerfSetting={onPerfSetting} />
              <PerfSlider perf={perf} id="lodDistanceScale" onPerfSetting={onPerfSetting} />
              <LodMultiSlider segments={perf.lodSegments}
                onChange={(next) => onPerfSetting('lodSegments', next)} />
              <div className="perf-note">
                Effective: {segments.join(' / ')} segments
              </div>
              {perf.lodDistances.map((d, i) => (
                <SliderCtl key={`dist${i}`}
                  def={{
                    label: `LOD${i}→${i + 1} Distance`, min: PERF_LIMITS.lodDistance.min,
                    max: PERF_LIMITS.lodDistance.max, step: 0.5, digits: 1, unit: '× chunk',
                  }}
                  value={d} onChange={(v) => setLodDistance(i, v)} />
              ))}
              <div className="perf-note">
                Effective: {distances.map((d) => d.toFixed(1)).join(' / ')} × chunk size
              </div>

              <SubTitle>Streaming &amp; Culling</SubTitle>
              <PerfSlider perf={perf} id="viewRadius" onPerfSetting={onPerfSetting} />
              <PerfSlider perf={perf} id="maxCreatesPerFrame" onPerfSetting={onPerfSetting} />
              <SliderCtl
                def={{ label: 'Triangle Budget', min: 0.1, max: 3, step: 0.1, digits: 1, unit: 'M' }}
                value={perf.triangleBudget / 1e6}
                onChange={(v) => onPerfSetting('triangleBudget', Math.round(v * 1e6))} />
              <PerfSlider perf={perf} id="cullingAggressiveness" onPerfSetting={onPerfSetting} />

              <SubTitle>Water</SubTitle>
              <SelectRow label="Water Quality" value={perf.waterQuality}
                options={WATER_QUALITY_OPTIONS}
                onChange={(v) => onPerfSetting('waterQuality', parseInt(v, 10))} />
              <PerfSlider perf={perf} id="waterReflection" onPerfSetting={onPerfSetting} />
              <PerfSlider perf={perf} id="waterDetail" onPerfSetting={onPerfSetting} />
              <PerfSlider perf={perf} id="waterWaves" onPerfSetting={onPerfSetting} />
              <PerfSlider perf={perf} id="waterDistance" onPerfSetting={onPerfSetting} />

              <SubTitle>Fog</SubTitle>
              <PerfSlider perf={perf} id="fogDistance" onPerfSetting={onPerfSetting} />

              <div className="perf-estimate">
                Worst-case visible triangles: ~{(estTris / 1e6).toFixed(2)}M
              </div>

              <button type="button" className="perf-reset-btn" onClick={onPerfReset}>
                Reset Performance Settings
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
