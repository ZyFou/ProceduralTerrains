import { translateText, useLanguage } from '../../i18n/LanguageContext.jsx';
import { matchesTranslatedSearch } from '../../i18n/language.js';
// Performance settings content (search + sub-tabs + body), shared by the
// Performance drawer panel. Extracted from the old SettingsModal so the same
// controls live in one place.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import ControlSection from '../ui/ControlSection.jsx';
import { SliderCtl, ToggleRow, SelectRow } from '../controls.jsx';
import {
  PERF_PRESETS, PERF_LIMITS, getPerfPresetKeys,
  resolveLodSegments, resolveLodDistances, estimateTriangles,
} from '../../engine/render/PerformanceSettings.js';
import {
  detectRendererCapabilities,
  labelGpuPreference,
} from '../../engine/render/RendererCapabilities.js';

const lim = (key, label, step, opts = {}) => ({
  key, label, step, min: PERF_LIMITS[key].min, max: PERF_LIMITS[key].max, ...opts,
});

const PERF_SLIDERS = {
  renderScale: lim('renderScale', 'Render Scale', 0.05, { digits: 2, unit: '×' }),
  resolutionScale: lim('resolutionScale', 'Terrain Resolution', 0.05, { digits: 2, unit: '×' }),
  lodDistanceScale: lim('lodDistanceScale', 'LOD Distance Scale', 0.05, { digits: 2, unit: '×' }),
  viewRadius: lim('viewRadius', 'Chunk Load Radius', 1, { unit: 'chunks' }),
  maxCreatesPerFrame: lim('maxCreatesPerFrame', 'Chunk Builds / Frame', 1, {
    unit: 'chunks',
    info: 'Caps how many chunks are created per frame for Infinite World streaming and new Tile cells. Set to 0 to build all pending chunks instantly.',
  }),
  cullingAggressiveness: lim('cullingAggressiveness', 'Culling Aggressiveness', 0.1, { digits: 1 }),
  waterReflection: lim('waterReflection', 'Water Reflection', 0.05, { digits: 2, unit: '×' }),
  waterDetail: lim('waterDetail', 'Water Detail', 0.05, { digits: 2, unit: '×' }),
  waterWaves: lim('waterWaves', 'Wave Complexity', 0.05, { digits: 2, unit: '×' }),
  waterDistance: lim('waterDistance', 'Water Distance', 0.05, { digits: 2, unit: '×' }),
  fogDistance: lim('fogDistance', 'Fog Distance', 0.05, { digits: 2, unit: '×' }),
  terrainDetailOpacity: lim('terrainDetailOpacity', 'Detail Opacity', 0.05, { digits: 2, unit: 'x' }),
  terrainDetailScale: lim('terrainDetailScale', 'Detail Texture Scale', 0.01, { digits: 2, unit: 'x' }),
  terrainDetailStrength: lim('terrainDetailStrength', 'Detail Strength', 0.05, { digits: 2, unit: 'x' }),
  terrainDetailNormal: lim('terrainDetailNormal', 'Detail Normal Strength', 0.05, { digits: 2, unit: 'x' }),
  terrainMicroDetail: lim('terrainMicroDetail', 'Micro Detail', 0.05, { digits: 2, unit: 'x' }),
  terrainMacroVariation: lim('terrainMacroVariation', 'Macro Variation', 0.05, { digits: 2, unit: 'x' }),
  terrainDetailNear: lim('terrainDetailNear', 'Full Detail Distance', 5, { unit: 'm' }),
  terrainDetailFar: lim('terrainDetailFar', 'Detail Fade Distance', 5, { unit: 'm' }),
  terrainRockSlope: lim('terrainRockSlope', 'Rock Slope Blend', 0.01, { digits: 2 }),
  terrainRockSharpness: lim('terrainRockSharpness', 'Rock Blend Width', 0.01, { digits: 2 }),
  terrainShoreRange: lim('terrainShoreRange', 'Shoreline Range', 1, { unit: 'm' }),
  terrainShoreWetness: lim('terrainShoreWetness', 'Shoreline Wetness', 0.05, { digits: 2, unit: 'x' }),
  cloudSteps: lim('cloudSteps', 'Raymarch Steps', 4),
  cloudLightSteps: lim('cloudLightSteps', 'Shadow Steps', 1),
  cloudOctaves: lim('cloudOctaves', 'Base Noise Octaves', 1),
  cloudDetailOctaves: lim('cloudDetailOctaves', 'Detail Noise Octaves', 1),
  cloudMaxDistance: lim('cloudMaxDistance', 'Max Distance', 0.5, { digits: 1, unit: '×' }),
};

const WATER_QUALITY_OPTIONS = [
  { value: 0, label: 'Low' },
  { value: 1, label: 'Medium' },
  { value: 2, label: 'High' },
];

const TERRAIN_DETAIL_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 1, label: 'Low' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'High' },
];

const GPU_PREFERENCE_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'high-performance', label: 'High Performance' },
  { value: 'low-power', label: 'Low Power' },
];

const RESOLUTION_DENOISE_OPTIONS = [
  { value: 'clean', label: 'Clean Denoise' },
  { value: 'pixelated', label: 'Pixelated Denoise' },
];

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'lod', label: 'LOD' },
  { id: 'streaming', label: 'Streaming' },
  { id: 'water', label: 'Water' },
  { id: 'fog', label: 'Fog' },
  { id: 'clouds', label: 'Clouds' },
];

function LodMultiSlider({ segments, onChange }) {
  useLanguage();
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
      onChange(cur.map((s) => Math.round(Math.min(max, Math.max(min, s * factor)))));
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
        <label>{translateText("LOD Resolutions")}</label>
        <span className="ctl-val lod-multi-val">{translateText(segments.join(' / '))}</span>
      </div>
      <div className="lod-multi-track" ref={trackRef}>
        {segments.map((seg, i) => (
          <div
            key={i}
            className="lod-multi-thumb"
            style={{ left: `${toPos(seg)}%` }}
            onPointerDown={(e) => startDrag(e, i)}
            title={translateText(`LOD${i}: ${seg} segments`)}
          >
            <span className="lod-multi-tag">{translateText("L")}{translateText(i)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PerfSlider({ perf, id, onPerfSetting, settingId }) {
  useLanguage();
  const def = PERF_SLIDERS[id];
  return <SliderCtl def={def} value={perf[def.key]} onChange={(v) => onPerfSetting(def.key, v)} settingId={settingId} />;
}

function SettingGroup({ tab, label, keywords, search, activeTab, settingId, children }) {
  useLanguage();
  const q = search.trim().toLowerCase();
  const visible = q ? matchesTranslatedSearch(q, label, keywords, tab) : tab === activeTab;
  if (!visible) return null;
  return (
    <div className="settings-field" data-setting-tab={tab} data-setting-label={label} data-setting-id={settingId}>
      {q && <span className="settings-field-tab">{translateText(TABS.find((t) => t.id === tab)?.label)}</span>}
      {children}
    </div>
  );
}

function SettingNote({ tab, text, search, activeTab }) {
  useLanguage();
  const q = search.trim().toLowerCase();
  if (q || tab !== activeTab) return null;
  return <p className="settings-note">{translateText(text)}</p>;
}

function CapabilityRow({ label, value, title }) {
  useLanguage();
  return (
    <div className="gpu-cap-row">
      <span>{translateText(label)}</span>
      <strong title={translateText(title || String(value))}>{translateText(value)}</strong>
    </div>
  );
}

function GpuRendererSection({ perf, rendererInfo, onPerfSetting }) {
  useLanguage();
  const fallbackCaps = useMemo(() => detectRendererCapabilities(), []);
  const caps = rendererInfo?.capabilities || fallbackCaps;
  const webgpuSupported = !!caps.webgpu?.supported;
  const backendOptions = [
    { value: 'auto', label: 'Auto' },
    { value: 'webgl', label: 'WebGL' },
    {
      value: 'webgpu',
      label: webgpuSupported ? 'WebGPU' : 'WebGPU unavailable',
      disabled: !webgpuSupported,
    },
  ];
  const activeGpuPreference = rendererInfo?.activeGpuPreference || 'default';
  const reloadRequired = !!rendererInfo?.reloadRequired;
  const gpuInfo = caps.gpuInfoAvailable
    ? caps.detectedGpu
    : (caps.gpuInfoReason || 'GPU info hidden by browser');

  return (
    <ControlSection
      id="perf-gpu-renderer"
      title={translateText("GPU / Renderer")}
      defaultOpen
      settingId="performance.section.gpu"
    >
      <div className="gpu-renderer-section">
        <SelectRow
          label={translateText("Renderer Backend")}
          value={perf.rendererBackend}
          options={backendOptions}
          onChange={(v) => onPerfSetting('rendererBackend', v)}
          info={translateText("Auto uses the safest available renderer. WebGPU requires browser support and may fall back in this build.")}
          settingId="performance.rendererBackend"
        />
        <SelectRow
          label={translateText("GPU Preference")}
          value={perf.gpuPreference}
          options={GPU_PREFERENCE_OPTIONS}
          onChange={(v) => onPerfSetting('gpuPreference', v)}
          info={translateText("A browser hint only. The browser or OS may ignore this preference.")}
          settingId="performance.gpuPreference"
        />
        <ToggleRow
          label={translateText("Worker Renderer")}
          value={!!perf.useWorker}
          onChange={(v) => onPerfSetting('useWorker', v)}
          info={translateText("Keeps shader compilation and rendering off the UI thread when OffscreenCanvas is supported. Disable only for compatibility diagnostics; reloading is required.")}
          settingId="performance.useWorker"
        />
        <div className="gpu-cap-list">
          <CapabilityRow label={translateText("Detected Renderer")} value={rendererInfo?.activeBackendLabel || caps.detectedRenderer} />
          <CapabilityRow label={translateText("Detected GPU")} value={gpuInfo} title={translateText(caps.detectedGpu)} />
          <CapabilityRow label={translateText("GPU Timing")} value={caps.gpuTiming?.supported ? 'Available' : 'Unavailable'} />
          <CapabilityRow label={translateText("Power Preference")} value={labelGpuPreference(activeGpuPreference)} />
          <CapabilityRow label={translateText("Worker Renderer")} value={rendererInfo?.workerActive ? 'Active' : 'Inactive'} />
          {perf.rendererBackend === 'webgpu' && !webgpuSupported && (
            <CapabilityRow label={translateText("WebGPU")} value={caps.webgpu?.reason || 'Unavailable'} />
          )}
        </div>
        {reloadRequired ? (
          <div className="gpu-apply-row">
            <span>{translateText("Reload required to apply GPU changes")}</span>
            <button type="button" className="action-btn gpu-apply-btn" onClick={() => window.location.reload()}>{translateText("Reload & Apply")}</button>
          </div>
        ) : (
          <p className="gpu-footnote">{translateText("Browser may ignore GPU preference hints.")}</p>
        )}
      </div>
    </ControlSection>
  );
}

// Terrain texture / close-range material sliders — surfaced in the Terrain
// panel's Surface > Properties tab (extracted from the old Performance
// panel's "Terrain" tab, since these describe material look, not budget).
export function SurfacePropertiesSettings({ perf, onPerfSetting }) {
  useLanguage();
  if (!perf) return <p className="settings-empty">{translateText("Performance settings are loading…")}</p>;
  const groupProps = { search: '', activeTab: 'terrain' };

  return (
    <div className="perf-settings">
      <div className="perf-settings-body">
        <SettingGroup tab="terrain" label={translateText("Terrain Detail Quality")} keywords="terrain material detail close walk first person texture quality" {...groupProps}>
          <SelectRow label={translateText("Terrain Detail Quality")} value={perf.terrainDetailQuality} options={TERRAIN_DETAIL_OPTIONS} onChange={(v) => onPerfSetting('terrainDetailQuality', parseInt(v, 10))} settingId="performance.terrainDetailQuality" />
        </SettingGroup>

        <SettingGroup tab="terrain" label={translateText("Detail Opacity")} keywords="terrain detail opacity master mix amount overall fade blend close" {...groupProps}>
          <PerfSlider perf={perf} id="terrainDetailOpacity" onPerfSetting={onPerfSetting} settingId="performance.terrainDetailOpacity" />
        </SettingGroup>

        <SettingGroup tab="terrain" label={translateText("Detail Texture Scale")} keywords="terrain close texture scale grain noise world space" {...groupProps}>
          <PerfSlider perf={perf} id="terrainDetailScale" onPerfSetting={onPerfSetting} settingId="performance.terrainDetailScale" />
        </SettingGroup>

        <SettingGroup tab="terrain" label={translateText("Detail Strength")} keywords="terrain albedo biome detail close strength" {...groupProps}>
          <PerfSlider perf={perf} id="terrainDetailStrength" onPerfSetting={onPerfSetting} settingId="performance.terrainDetailStrength" />
        </SettingGroup>

        <SettingGroup tab="terrain" label={translateText("Detail Normal Strength")} keywords="terrain normal material lighting bump close" {...groupProps}>
          <PerfSlider perf={perf} id="terrainDetailNormal" onPerfSetting={onPerfSetting} settingId="performance.terrainDetailNormal" />
        </SettingGroup>

        <SettingGroup tab="terrain" label={translateText("Micro & Macro Detail")} keywords="terrain micro grain macro variation weathering patches biome speckle close up" {...groupProps}>
          <PerfSlider perf={perf} id="terrainMicroDetail" onPerfSetting={onPerfSetting} settingId="performance.terrainMicroDetail" />
          <PerfSlider perf={perf} id="terrainMacroVariation" onPerfSetting={onPerfSetting} settingId="performance.terrainMacroVariation" />
        </SettingGroup>

        <SettingGroup tab="terrain" label={translateText("Distance Detail Fade")} keywords="terrain detail fade near far walk distance shimmer" {...groupProps}>
          <PerfSlider perf={perf} id="terrainDetailNear" onPerfSetting={onPerfSetting} settingId="performance.terrainDetailNear" />
          <PerfSlider perf={perf} id="terrainDetailFar" onPerfSetting={onPerfSetting} settingId="performance.terrainDetailFar" />
        </SettingGroup>

        <SettingGroup tab="terrain" label={translateText("Slope Rock Blending")} keywords="terrain slope rock cliff material blend" {...groupProps}>
          <PerfSlider perf={perf} id="terrainRockSlope" onPerfSetting={onPerfSetting} settingId="performance.terrainRockSlope" />
          <PerfSlider perf={perf} id="terrainRockSharpness" onPerfSetting={onPerfSetting} settingId="performance.terrainRockSharpness" />
        </SettingGroup>

        <SettingGroup tab="terrain" label={translateText("Triplanar Detail")} keywords="terrain triplanar cliff steep stretch projection" {...groupProps}>
          <ToggleRow label={translateText("Triplanar Detail")} value={perf.terrainTriplanar !== false} onChange={(v) => onPerfSetting('terrainTriplanar', v)} settingId="performance.terrainTriplanar" />
        </SettingGroup>

        <SettingGroup tab="terrain" label={translateText("Shoreline Detail")} keywords="terrain shoreline shore wet sand mud coast water edge" {...groupProps}>
          <PerfSlider perf={perf} id="terrainShoreRange" onPerfSetting={onPerfSetting} settingId="performance.terrainShoreRange" />
          <PerfSlider perf={perf} id="terrainShoreWetness" onPerfSetting={onPerfSetting} settingId="performance.terrainShoreWetness" />
        </SettingGroup>
      </div>
    </div>
  );
}

export default function PerfSettings({ perf, rendererInfo, onPerfPreset, onPerfSetting, onPerfReset, settingsTarget, onSettingsTargetHandled }) {
  useLanguage();
  const [activeTab, setActiveTab] = useState('overview');
  const [search, setSearch] = useState('');

  const presetOptions = useMemo(() => [
    ...getPerfPresetKeys().map((k) => ({ value: k, label: PERF_PRESETS[k].label })),
    { value: 'custom', label: 'Custom' },
  ], []);

  if (!perf) return <p className="settings-empty">{translateText("Performance settings are loading…")}</p>;

  const segments = resolveLodSegments(perf);
  const distances = resolveLodDistances(perf);
  const estTris = estimateTriangles(perf);
  const isSearching = search.trim().length > 0;

  useEffect(() => {
    if (settingsTarget?.tabId && settingsTarget.tabId !== activeTab) {
      setActiveTab(settingsTarget.tabId);
    }
  }, [settingsTarget?.tabId, activeTab]);

  useEffect(() => {
    if (!settingsTarget?.settingId) return;
    if (settingsTarget.tabId && settingsTarget.tabId !== activeTab) return;
    const target = document.querySelector(`[data-setting-id="${settingsTarget.settingId}"]`);
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.add('setting-target-flash');
    const timer = window.setTimeout(() => target.classList.remove('setting-target-flash'), 1200);
    onSettingsTargetHandled?.();
    return () => window.clearTimeout(timer);
  }, [settingsTarget, activeTab, onSettingsTargetHandled]);

  const setLodDistance = (i, v) => {
    const next = [...perf.lodDistances];
    next[i] = v;
    onPerfSetting('lodDistances', next);
  };

  const groupProps = { search, activeTab };
  const body = renderSettings({ perf, rendererInfo, presetOptions, segments, distances, estTris, setLodDistance, onPerfPreset, onPerfSetting, onPerfReset, groupProps });

  return (
    <div className="perf-settings">
      <div className="settings-search-wrap">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          className="settings-search-input"
          placeholder={translateText("Search settings…")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button type="button" className="settings-search-clear" onClick={() => setSearch('')} aria-label={translateText("Clear search")}>✕</button>
        )}
      </div>

      {!isSearching && (
        <div className="panel-tabs" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`panel-tab${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {translateText(tab.label)}
            </button>
          ))}
        </div>
      )}

      <div className="perf-settings-body">
        {isSearching && <p className="settings-search-hint">{translateText("Search results")}</p>}
        {translateText(body)}
      </div>
    </div>
  );
}

function renderSettings({
  perf, rendererInfo, presetOptions, segments, distances, estTris,
  setLodDistance, onPerfPreset, onPerfSetting, onPerfReset, groupProps,
}) {
  return (
    <>
      <SettingGroup tab="overview" label={translateText("Performance Preset")} keywords="preset quality profile" {...groupProps}>
        <SelectRow label={translateText("Preset")} value={perf.preset} options={presetOptions} onChange={onPerfPreset} settingId="performance.preset" />
      </SettingGroup>

      <SettingGroup tab="overview" label={translateText("GPU Renderer")} keywords="gpu renderer backend webgl webgpu power preference dedicated low power timing" {...groupProps}>
        <GpuRendererSection perf={perf} rendererInfo={rendererInfo} onPerfSetting={onPerfSetting} />
      </SettingGroup>

      <SettingGroup tab="overview" label={translateText("Auto Performance Mode")} keywords="automatic dynamic fps" {...groupProps}>
        <ToggleRow label={translateText("Auto Performance Mode")} value={perf.autoPerf} onChange={(v) => onPerfSetting('autoPerf', v)} settingId="performance.autoPerf" />
      </SettingGroup>

      <SettingGroup tab="overview" label={translateText("Pause When Idle")} keywords="on demand static studio redraw idle battery heat power" {...groupProps}>
        <ToggleRow label={translateText("Pause When Idle")} value={perf.onDemandStudio} onChange={(v) => onPerfSetting('onDemandStudio', v)} settingId="performance.onDemandStudio" />
      </SettingGroup>

      <SettingNote tab="overview" text="Pause When Idle stops redrawing the studio board when nothing moves — big GPU/battery/heat saving on weak machines." {...groupProps} />


      <SettingGroup tab="overview" label={translateText("Render Scale")} keywords="resolution pixel dpr scale" {...groupProps}>
        <PerfSlider perf={perf} id="renderScale" onPerfSetting={onPerfSetting} settingId="performance.renderScale" />
      </SettingGroup>

      <SettingGroup tab="overview" label={translateText("Resolution Reconstruction")} keywords="resolution upscale denoise clean pixelated nearest ps1" {...groupProps}>
        <SelectRow
          label={translateText("Resolution Reconstruction")}
          value={perf.resolutionDenoiseMode || 'clean'}
          options={RESOLUTION_DENOISE_OPTIONS}
          onChange={(v) => onPerfSetting('resolutionDenoiseMode', v)}
          settingId="performance.resolutionDenoiseMode"
        />
      </SettingGroup>

      <SettingNote tab="overview" text="Clean Denoise reconstructs reduced resolution while preserving edges. Pixelated Denoise keeps hard source pixels for a retro look." {...groupProps} />

      <SettingNote tab="overview" text={`Worst-case visible triangles: ~${(estTris / 1e6).toFixed(2)}M`} {...groupProps} />

      <SettingGroup tab="lod" label={translateText("Terrain Resolution")} keywords="mesh detail segments" {...groupProps}>
        <PerfSlider perf={perf} id="resolutionScale" onPerfSetting={onPerfSetting} settingId="performance.resolutionScale" />
      </SettingGroup>

      <SettingGroup tab="lod" label={translateText("LOD Distance Scale")} keywords="level detail distance" {...groupProps}>
        <PerfSlider perf={perf} id="lodDistanceScale" onPerfSetting={onPerfSetting} settingId="performance.lodDistanceScale" />
      </SettingGroup>

      <SettingGroup tab="lod" label={translateText("LOD Resolutions")} keywords="segments mesh lod0 lod1 lod2 lod3" {...groupProps}>
        <div data-setting-id="performance.lodSegments">
          <LodMultiSlider segments={perf.lodSegments} onChange={(next) => onPerfSetting('lodSegments', next)} />
        </div>
      </SettingGroup>

      <SettingNote tab="lod" text={`Effective segments: ${segments.join(' / ')}`} {...groupProps} />

      {perf.lodDistances.map((d, i) => (
        <SettingGroup key={`lod-dist-${i}`} tab="lod" label={translateText(`LOD ${i} → ${i + 1} Distance`)} keywords={`lod distance threshold chunk level ${i}`} {...groupProps}>
          <SliderCtl
            def={{ label: `LOD${i}→${i + 1} Distance`, min: PERF_LIMITS.lodDistance.min, max: PERF_LIMITS.lodDistance.max, step: 0.5, digits: 1, unit: '× chunk' }}
            value={d}
            onChange={(v) => setLodDistance(i, v)}
            settingId={`performance.lodDistance.${i}`}
          />
        </SettingGroup>
      ))}

      <SettingNote tab="lod" text={`Effective distances: ${distances.map((d) => d.toFixed(1)).join(' / ')} × chunk size`} {...groupProps} />

      <SettingGroup tab="lod" label={translateText("Chunk Merging")} keywords="merge chunk group draw call batch far distant tile macro proxy combine" {...groupProps}>
        <ToggleRow
          label={translateText("Chunk Merging")}
          value={perf.terrainMerge !== false}
          onChange={(v) => onPerfSetting('terrainMerge', v)}
          info={translateText("Collapses far Tile-mode chunks into fewer larger meshes once they pass the lowest LOD band. Cuts draw calls / CPU with no change to the silhouette.")}
          settingId="performance.terrainMerge"
        />
      </SettingGroup>

      <SettingGroup tab="lod" label={translateText("Merge Distance")} keywords="merge fold distance quadtree aggressiveness near far block size threshold" {...groupProps}>
        <SliderCtl
          def={{ label: 'Merge Distance', min: PERF_LIMITS.terrainMergeDistance.min, max: PERF_LIMITS.terrainMergeDistance.max, step: 0.5, digits: 1, unit: '× block' }}
          value={perf.terrainMergeDistance ?? 4}
          onChange={(v) => onPerfSetting('terrainMergeDistance', v)}
          settingId="performance.terrainMergeDistance"
        />
      </SettingGroup>

      <SettingNote tab="lod" text="A quadtree block folds into one mesh once the camera is farther than its width × this. Higher = keep detail (split) longer; lower = fold sooner for more savings." {...groupProps} />

      <SettingGroup tab="lod" label={translateText("Merge Density")} keywords="merge density resolution quads detail far mesh quality" {...groupProps}>
        <SliderCtl
          def={{ label: 'Merge Density', min: PERF_LIMITS.terrainMergeQuads.min, max: PERF_LIMITS.terrainMergeQuads.max, step: 1, unit: 'quads/chunk' }}
          value={perf.terrainMergeQuads ?? 8}
          onChange={(v) => onPerfSetting('terrainMergeQuads', Math.round(v))}
          settingId="performance.terrainMergeQuads"
        />
      </SettingGroup>

      <SettingNote tab="lod" text="Merge Density 8 matches the lowest chunk LOD. Lower it for extra savings at the cost of a slightly coarser folded silhouette." {...groupProps} />

      <SettingGroup tab="lod" label={translateText("Full Board Merge")} keywords="macro proxy single mesh whole tile board zoom out far extreme distance root fold" {...groupProps}>
        <ToggleRow
          label={translateText("Full Board Merge")}
          value={perf.terrainMacroProxy !== false}
          onChange={(v) => onPerfSetting('terrainMacroProxy', v)}
          info={translateText("Allow the whole board to fold into a single mesh at extreme distance (the top of the quadtree). Off keeps it split one level below.")}
          settingId="performance.terrainMacroProxy"
        />
      </SettingGroup>

      <SettingGroup tab="streaming" label={translateText("Chunk Load Radius")} keywords="view radius streaming load" {...groupProps}>
        <PerfSlider perf={perf} id="viewRadius" onPerfSetting={onPerfSetting} settingId="performance.viewRadius" />
      </SettingGroup>

      <SettingGroup tab="streaming" label={translateText("Chunk Builds Per Frame")} keywords="create spawn streaming budget tile new cells add chunks" {...groupProps}>
        <PerfSlider perf={perf} id="maxCreatesPerFrame" onPerfSetting={onPerfSetting} settingId="performance.maxCreatesPerFrame" />
      </SettingGroup>

      <SettingGroup tab="streaming" label={translateText("Triangle Budget")} keywords="triangles limit budget mesh" {...groupProps}>
        <SliderCtl
          def={{ label: 'Triangle Budget', min: 0.1, max: 3, step: 0.1, digits: 1, unit: 'M' }}
          value={perf.triangleBudget / 1e6}
          onChange={(v) => onPerfSetting('triangleBudget', Math.round(v * 1e6))}
          settingId="performance.triangleBudget"
        />
      </SettingGroup>

      <SettingGroup tab="streaming" label={translateText("Culling Aggressiveness")} keywords="frustum behind camera cull" {...groupProps}>
        <PerfSlider perf={perf} id="cullingAggressiveness" onPerfSetting={onPerfSetting} settingId="performance.cullingAggressiveness" />
      </SettingGroup>

      <SettingGroup tab="water" label={translateText("Water Quality")} keywords="shader reflection detail waves" {...groupProps}>
        <SelectRow label={translateText("Water Quality")} value={perf.waterQuality} options={WATER_QUALITY_OPTIONS} onChange={(v) => onPerfSetting('waterQuality', parseInt(v, 10))} settingId="performance.waterQuality" />
      </SettingGroup>

      <SettingGroup tab="water" label={translateText("Water Reflection")} keywords="specular glint sun" {...groupProps}>
        <PerfSlider perf={perf} id="waterReflection" onPerfSetting={onPerfSetting} settingId="performance.waterReflection" />
      </SettingGroup>

      <SettingGroup tab="water" label={translateText("Water Detail")} keywords="ripple octave shader" {...groupProps}>
        <PerfSlider perf={perf} id="waterDetail" onPerfSetting={onPerfSetting} settingId="performance.waterDetail" />
      </SettingGroup>

      <SettingGroup tab="water" label={translateText("Wave Complexity")} keywords="waves animation ocean" {...groupProps}>
        <PerfSlider perf={perf} id="waterWaves" onPerfSetting={onPerfSetting} settingId="performance.waterWaves" />
      </SettingGroup>

      <SettingGroup tab="water" label={translateText("Underwater Effect")} keywords="underwater submerged camera dive fog tint" {...groupProps}>
        <ToggleRow label={translateText("Underwater Effect")} value={perf.underwaterEffect !== false} onChange={(v) => onPerfSetting('underwaterEffect', v)} settingId="performance.underwaterEffect" />
      </SettingGroup>

      <SettingGroup tab="water" label={translateText("Water Distance")} keywords="extent range fade" {...groupProps}>
        <PerfSlider perf={perf} id="waterDistance" onPerfSetting={onPerfSetting} settingId="performance.waterDistance" />
      </SettingGroup>

      <SettingGroup tab="fog" label={translateText("Fog Distance")} keywords="horizon haze atmosphere visibility" {...groupProps}>
        <PerfSlider perf={perf} id="fogDistance" onPerfSetting={onPerfSetting} settingId="performance.fogDistance" />
      </SettingGroup>

      <SettingGroup tab="clouds" label={translateText("Fallback Mode")} keywords="clouds performance quality fallback mode" {...groupProps}>
        <SelectRow label={translateText("Fallback Mode")} value={perf.cloudFallback} options={[{ value: 'none', label: 'Full' }, { value: 'lite', label: 'Lite (weak GPU)' }, { value: 'off', label: 'Off' }]} onChange={(v) => onPerfSetting('cloudFallback', v)} settingId="performance.cloudFallback" />
      </SettingGroup>

      <SettingGroup tab="clouds" label={translateText("Raymarch Steps")} keywords="clouds step raymarch resolution quality steps" {...groupProps}>
        <PerfSlider perf={perf} id="cloudSteps" onPerfSetting={onPerfSetting} settingId="performance.cloudSteps" />
      </SettingGroup>

      <SettingGroup tab="clouds" label={translateText("Self-Shadowing")} keywords="clouds shadow self lighting" {...groupProps}>
        <ToggleRow label={translateText("Self-Shadowing")} value={perf.cloudSelfShadow !== false} onChange={(v) => onPerfSetting('cloudSelfShadow', v)} settingId="performance.cloudSelfShadow" />
      </SettingGroup>

      <SettingGroup tab="clouds" label={translateText("Fast Shadows")} keywords="clouds shadow analytic cheap performance fast self lighting" {...groupProps}>
        <ToggleRow label={translateText("Fast Shadows (analytic)")} value={!!perf.cloudLightMode} onChange={(v) => onPerfSetting('cloudLightMode', v)} settingId="performance.cloudLightMode" />
      </SettingGroup>

      <SettingNote tab="clouds" text="Fast Shadows replaces the secondary shadow march with a cheap 2-tap approximation — big win when Self-Shadowing is on, near-identical look." {...groupProps} />

      <SettingGroup tab="clouds" label={translateText("Shadow Steps")} keywords="clouds shadow lighting steps" {...groupProps}>
        <PerfSlider perf={perf} id="cloudLightSteps" onPerfSetting={onPerfSetting} settingId="performance.cloudLightSteps" />
      </SettingGroup>

      <SettingGroup tab="clouds" label={translateText("Distance Step LOD")} keywords="clouds distance lod steps raymarch performance far" {...groupProps}>
        <ToggleRow label={translateText("Distance Step LOD")} value={!!perf.cloudStepLOD} onChange={(v) => onPerfSetting('cloudStepLOD', v)} settingId="performance.cloudStepLOD" />
      </SettingGroup>

      <SettingNote tab="clouds" text="Distance Step LOD marches fewer samples as the camera pulls away from the surface." {...groupProps} />


      <SettingGroup tab="clouds" label={translateText("Base Noise Octaves")} keywords="clouds octaves noise fbm base" {...groupProps}>
        <PerfSlider perf={perf} id="cloudOctaves" onPerfSetting={onPerfSetting} settingId="performance.cloudOctaves" />
      </SettingGroup>

      <SettingGroup tab="clouds" label={translateText("Detail Noise Octaves")} keywords="clouds octaves detail noise fbm" {...groupProps}>
        <PerfSlider perf={perf} id="cloudDetailOctaves" onPerfSetting={onPerfSetting} settingId="performance.cloudDetailOctaves" />
      </SettingGroup>

      <SettingGroup tab="clouds" label={translateText("Erosion (Worley Noise)")} keywords="clouds erosion cellular worley detail" {...groupProps}>
        <ToggleRow label={translateText("Erosion (Worley Noise)")} value={perf.cloudUseErosion !== false} onChange={(v) => onPerfSetting('cloudUseErosion', v)} settingId="performance.cloudUseErosion" />
      </SettingGroup>

      <SettingGroup tab="clouds" label={translateText("Max Distance")} keywords="clouds max distance visibility culling" {...groupProps}>
        <PerfSlider perf={perf} id="cloudMaxDistance" onPerfSetting={onPerfSetting} settingId="performance.cloudMaxDistance" />
      </SettingGroup>
    </>
  );
}
