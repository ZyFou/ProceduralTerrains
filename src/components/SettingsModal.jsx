import { SliderCtl, ToggleRow, SelectRow } from './controls.jsx';
import {
  PERF_PRESETS, PERF_LIMITS, getPerfPresetKeys,
  resolveLodSegments, resolveLodDistances, estimateTriangles,
} from '../engine/render/PerformanceSettings.js';

const ENVIRONMENT_SCHEMA = [
  { key: 'sunAzimuth', label: 'Sun Azimuth', min: 0, max: 360, step: 1, unit: '°' },
  { key: 'sunElevation', label: 'Sun Elevation', min: 8, max: 85, step: 1, unit: '°' },
  { key: 'fogDensity', label: 'Fog Density', min: 0, max: 2, step: 0.05, digits: 2 },
  { key: 'waterAnim', label: 'Water Animation', type: 'toggle' },
];

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

function PerfSlider({ perf, id, onPerfSetting }) {
  const def = PERF_SLIDERS[id];
  return (
    <SliderCtl def={def} value={perf[def.key]}
      onChange={(v) => onPerfSetting(def.key, v)} />
  );
}

export default function SettingsModal({ open, params, onParam, onClose, perf, onPerfPreset, onPerfSetting }) {
  if (!open) return null;

  const presetOptions = [
    ...getPerfPresetKeys().map((k) => ({ value: k, label: PERF_PRESETS[k].label })),
    { value: 'custom', label: 'Custom' },
  ];

  const segments = perf ? resolveLodSegments(perf) : [];
  const distances = perf ? resolveLodDistances(perf) : [];
  const estTris = perf ? estimateTriangles(perf) : 0;

  const setLodSegment = (i, v) => {
    const next = [...perf.lodSegments];
    next[i] = v;
    onPerfSetting('lodSegments', next);
  };
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
          <SectionTitle>Environment</SectionTitle>
          {ENVIRONMENT_SCHEMA.map((def) => {
            if (def.type === 'toggle') {
              return (
                <ToggleRow key={def.key} label={def.label} value={params[def.key]}
                  onChange={(v) => onParam(def.key, v)} />
              );
            }
            return (
              <SliderCtl key={def.key} def={def} value={params[def.key]}
                onChange={(v) => onParam(def.key, v)} />
            );
          })}

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
              {perf.lodSegments.map((seg, i) => (
                <SliderCtl key={`seg${i}`}
                  def={{
                    label: `LOD${i} Segments`, min: PERF_LIMITS.lodSegment.min,
                    max: PERF_LIMITS.lodSegment.max, step: 4,
                  }}
                  value={seg} onChange={(v) => setLodSegment(i, v)} />
              ))}
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
