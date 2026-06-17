import { useEffect, useState } from 'react';
import SidePanel, { PanelTabs } from './SidePanel.jsx';
import { SliderCtl, ToggleRow, SelectRow } from '../controls.jsx';
import { TERRAIN_SLIDERS, NOISE_SLIDERS, BIOME_SLIDERS, RENDER_SLIDERS, WATER_COLORS, ColorField, InfoDot } from './defs.jsx';
import { PRESETS } from '../../engine/presets.js';
import { NOISE_PRESETS } from '../../engine/style/NoisePresets.js';
import { colorToHex, parseColor } from '../../engine/style/ColorPalette.js';
import { formatTimeOfDay } from '../../engine/sky/TimeOfDay.js';
import { APP_VERSION } from '../../constants/app.js';
import PlanetStylePanel from '../PlanetStylePanel.jsx';
import WorldPanelInner from '../ui/WorldPanel.jsx';
import CloudPanelInner from '../ui/CloudPanel.jsx';
import EnvironmentPanelInner from '../ui/EnvironmentPanel.jsx';
import PerformanceStats from '../ui/PerformancePanel.jsx';
import PlanetSummaryCard from '../ui/PlanetSummaryCard.jsx';
import { LodPanel, CameraPanel } from '../RightPanels.jsx';
import PerfSettings from './PerfSettings.jsx';

// ---- toolbar / panel metadata (single source for icons + labels) ----
const ic = (children) => <svg viewBox="0 0 20 20" fill="none">{children}</svg>;

export const PANEL_META = {
  terrain: { label: 'Terrain', title: 'Terrain', desc: 'Shape and surface generation.', icon: ic(<path d="M3 15 L8 6 L11 10 L14 7 L17 15 Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />) },
  world: { label: 'World', title: 'World', desc: 'Chunking, streaming and grid.', icon: ic(<><rect x="3" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" /><rect x="11" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" /><rect x="3" y="11" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" /><rect x="11" y="11" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" /></>) },
  planet: {
    label: 'Planet',
    title: 'Planet',
    desc: 'Spherical world style and summary.',
    studioLabel: 'Colors',
    studioTitle: 'Colors',
    studioDesc: 'Biome palette and terrain material colors.',
    icon: ic(<><circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.4" /><ellipse cx="10" cy="10" rx="3" ry="6.5" stroke="currentColor" strokeWidth="1" /></>),
    modes: ['planet', 'studio'],
  },
  biomes: { label: 'Biomes', title: 'Biomes', desc: 'Climate distribution and masks.', icon: ic(<><rect x="4" y="4" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" /><rect x="11" y="4" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" /><rect x="4" y="11" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" /><rect x="11" y="11" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" /></>) },
  water: { label: 'Water', title: 'Water', desc: 'Ocean surface and colours.', icon: ic(<path d="M10 4c-2 3-5 5-5 8a5 5 0 0 0 10 0c0-3-3-5-5-8z" stroke="currentColor" strokeWidth="1.4" />) },
  props: { label: 'Props', title: 'Props', desc: 'Procedural grass and flowers.', icon: ic(<path d="M5 16c.2-5 1.2-9 3-13M10 16c-.1-4.8.4-8.6 1.5-12M14 16c-.4-4.2-1.2-7.4-2.4-9.6" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />) },
  clouds: { label: 'Clouds', title: 'Clouds', desc: 'Volumetric cloud layer.', icon: ic(<path d="M5 14a3 3 0 0 1 .5-5.95A4.2 4.2 0 0 1 14 8.3a3 3 0 0 1-.4 5.7H5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />) },
  skybox: { label: 'Skybox', title: 'Skybox', desc: 'Sky environment, time of day and atmosphere.', icon: ic(<><path d="M2 13h16" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><circle cx="6.5" cy="8" r="2.3" stroke="currentColor" strokeWidth="1.3" /><path d="M11 13a3.2 3.2 0 0 1 .3-6 4 4 0 0 1 6.4 1.1" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></>) },
  lighting: { label: 'Lighting', title: 'Lighting', desc: 'Sun, atmosphere and fog.', icon: ic(<><circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.4" /><path d="M10 2v2.5M10 15.5V18M2 10h2.5M15.5 10H18M4.3 4.3l1.8 1.8M13.9 13.9l1.8 1.8M15.7 4.3l-1.8 1.8M6.1 13.9l-1.8 1.8" stroke="currentColor" strokeWidth="1.3" /></>) },
  export: { label: 'Export', title: 'Export', desc: 'Export meshes and textures.', icon: ic(<><path d="M10 3v9M10 3 7 6M10 3l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 12v4h12v-4" stroke="currentColor" strokeWidth="1.4" /></>) },
  performance: { label: 'Performance', title: 'Performance', desc: 'Quality, LOD and budgets.', icon: ic(<path d="M3 15h14M5 11l3-5 3 4 4-7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />) },
  debug: { label: 'Debug', title: 'Debug', desc: 'Live stats and diagnostics.', icon: ic(<><circle cx="10" cy="10" r="4" stroke="currentColor" strokeWidth="1.4" /><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.5 4.5l1.5 1.5M14 14l1.5 1.5M15.5 4.5L14 6M6 14l-1.5 1.5" stroke="currentColor" strokeWidth="1.2" /></>) },
};

// Order used by the left toolbar.
export const PANEL_ORDER = ['terrain', 'biomes', 'water', 'props', 'clouds', 'skybox', 'lighting', 'planet', 'export', 'world', 'performance', 'debug'];

export function panelAvailable(id, worldMode) {
  const meta = PANEL_META[id];
  if (!meta) return false;
  return !meta.modes || meta.modes.includes(worldMode);
}

export function getPanelDisplay(id, worldMode) {
  const meta = PANEL_META[id];
  if (!meta) return { label: id, title: id, desc: '' };
  if (worldMode === 'studio' && meta.studioLabel) {
    return {
      label: meta.studioLabel,
      title: meta.studioTitle ?? meta.studioLabel,
      desc: meta.studioDesc ?? meta.desc,
    };
  }
  return { label: meta.label, title: meta.title, desc: meta.desc };
}

// ---------------------------------------------------------------- helpers
function SeedRow({ seed, onParam, onRandomizeSeed }) {
  const [text, setText] = useState(String(seed));
  useEffect(() => { setText(String(seed)); }, [seed]);
  const commit = () => {
    const v = parseInt(text, 10);
    if (Number.isFinite(v)) onParam('seed', v >>> 0);
    else setText(String(seed));
  };
  return (
    <div className="seed-row">
      <div className="label-with-icon" data-tooltip="Base integer for the procedural height generator" style={{ marginBottom: '5px' }}>
        <span className="setting-label">Seed</span><InfoDot />
      </div>
      <div className="seed-input-wrap">
        <input type="text" spellCheck="false" value={text}
          onChange={(e) => setText(e.target.value)} onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
        <button type="button" className="icon-btn" title="Randomize seed" onClick={onRandomizeSeed}>
          <svg viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.1" />
            <circle cx="5.5" cy="5.5" r="1" fill="currentColor" /><circle cx="10.5" cy="10.5" r="1" fill="currentColor" />
          </svg>
        </button>
      </div>
    </div>
  );
}

const RegenButton = ({ onRegenerate }) => (
  <button type="button" className="action-btn primary" onClick={onRegenerate}>
    <svg viewBox="0 0 16 16" fill="none"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" stroke="currentColor" strokeWidth="1.3" /><path d="M13.7 1.8v2.8h-2.8" stroke="currentColor" strokeWidth="1.3" /></svg>
    Regenerate
  </button>
);

// ---------------------------------------------------------------- panels
function TerrainPanel({ ctx }) {
  const [tab, setTab] = useState('shape');
  const { params, onParam } = ctx;
  return (
    <SidePanel title="Terrain" description="Shape and surface generation." onClose={ctx.onClose}
      footer={<RegenButton onRegenerate={ctx.onRegenerate} />}>
      <PanelTabs active={tab} onChange={setTab} tabs={[
        { id: 'shape', label: 'Shape' }, { id: 'noise', label: 'Noise' }, { id: 'surface', label: 'Surface' },
      ]} />
      {tab === 'shape' && (
        <>
          <SelectRow label="Preset" value={params.preset}
            options={Object.entries(PRESETS).map(([key, p]) => ({ value: key, label: p.label }))}
            onChange={ctx.onPreset} info="Global terrain layout preset." />
          <SeedRow seed={params.seed} onParam={onParam} onRandomizeSeed={ctx.onRandomizeSeed} />
          {TERRAIN_SLIDERS.map((def) => (
            <SliderCtl key={def.key} def={def} value={params[def.key]} onChange={(v) => onParam(def.key, v)} />
          ))}
        </>
      )}
      {tab === 'noise' && (
        <>
          <SelectRow label="Noise Preset" value={params.noisePreset ?? 'default'}
            options={Object.entries(NOISE_PRESETS).map(([key, p]) => ({ value: key, label: p.label }))}
            onChange={ctx.planetStyleProps.onNoisePreset} info="Baseline noise shape configuration." />
          {NOISE_SLIDERS.map((def) => (
            <SliderCtl key={def.key} def={def} value={params[def.key]} onChange={(v) => onParam(def.key, v)} />
          ))}
        </>
      )}
      {tab === 'surface' && (
        <>
          {RENDER_SLIDERS.map((def) => (
            <SliderCtl key={def.key} def={def} value={params[def.key]} onChange={(v) => onParam(def.key, v)} />
          ))}
        </>
      )}
    </SidePanel>
  );
}

function WorldPanel({ ctx }) {
  return (
    <SidePanel title="World" description="Chunking, streaming and grid." onClose={ctx.onClose}>
      <WorldPanelInner params={ctx.params} worldMode={ctx.worldMode} onParam={ctx.onParam} />
    </SidePanel>
  );
}

function PlanetPanel({ ctx }) {
  const isPlanet = ctx.worldMode === 'planet';
  const { title, desc } = getPanelDisplay('planet', ctx.worldMode);
  return (
    <SidePanel title={title} description={desc} onClose={ctx.onClose}>
      {isPlanet && (
        <>
          <WorldPanelInner params={ctx.params} worldMode="planet" onParam={ctx.onParam} />
          <PlanetStylePanel {...ctx.planetStyleProps} embedded />
          <PlanetSummaryCard params={ctx.params} />
        </>
      )}
      {!isPlanet && (
        <PlanetStylePanel {...ctx.planetStyleProps} embedded paletteOnly />
      )}
    </SidePanel>
  );
}

function BiomesPanel({ ctx }) {
  const { params, onParam } = ctx;
  return (
    <SidePanel title="Biomes" description="Climate distribution and masks." onClose={ctx.onClose}>
      {BIOME_SLIDERS.map((def) => (
        <SliderCtl key={def.key} def={def} value={params[def.key]} onChange={(v) => onParam(def.key, v)} />
      ))}
      <ToggleRow label="Biome Debug" value={params.biomeDebug} onChange={(v) => onParam('biomeDebug', v)}
        info="Color-code biomes directly on the terrain surface for inspection." />
    </SidePanel>
  );
}

function WaterPanel({ ctx }) {
  const { params, onParam } = ctx;
  const palette = params.planetStyle?.palette ?? {};
  return (
    <SidePanel title="Water" description="Ocean surface and colours." onClose={ctx.onClose}>
      <ToggleRow label="Water Animation" value={params.waterAnim} onChange={(v) => onParam('waterAnim', v)}
        info="Enable dynamic vertex displacement waves on the water surface." />
      <div className="subsection-label">Water Colors</div>
      {WATER_COLORS.map(({ key, label, icon, info }) => (
        <ColorField key={key} label={label} icon={icon} info={info}
          value={colorToHex(palette[key] ?? [0.05, 0.2, 0.35])}
          onChange={(e) => ctx.planetStyleProps.onColorChange(key, parseColor(e.target.value))} />
      ))}
    </SidePanel>
  );
}

const PROP_SLIDERS = {
  propsDensity: { label: 'Density', min: 0, max: 2, step: 0.05, digits: 2 },
  propsGrass: { label: 'Grass Scale', min: 0.2, max: 2, step: 0.05, digits: 2 },
  propsFlowers: { label: 'Flower Mix', min: 0, max: 1, step: 0.01, digits: 2 },
  propsCullDistance: { label: 'Cull Distance', min: 120, max: 1800, step: 20, digits: 0, unit: ' u' },
  propsLodDistance: { label: 'LOD Distance', min: 60, max: 900, step: 10, digits: 0, unit: ' u' },
};

function PropsPanel({ ctx }) {
  const { params, onParam, worldMode } = ctx;
  const enabled = !!params.propsEnabled;
  return (
    <SidePanel title="Props" description="Procedural grass and flowers." onClose={ctx.onClose}>
      <ToggleRow label="Procedural Props" value={enabled} onChange={(v) => onParam('propsEnabled', v)}
        info="Scatter lightweight procedural grass and flowers on valid terrain in Tile, Infinite World, and Planet modes." />
      {enabled && (
        <>
          <div className="subsection-label">Distribution</div>
          <SliderCtl def={PROP_SLIDERS.propsDensity} value={params.propsDensity} onChange={(v) => onParam('propsDensity', v)} />
          <SliderCtl def={PROP_SLIDERS.propsFlowers} value={params.propsFlowers} onChange={(v) => onParam('propsFlowers', v)} />

          <div className="subsection-label">Look</div>
          <SliderCtl def={PROP_SLIDERS.propsGrass} value={params.propsGrass} onChange={(v) => onParam('propsGrass', v)} />

          <div className="subsection-label">Performance</div>
          <SliderCtl def={PROP_SLIDERS.propsCullDistance} value={params.propsCullDistance} onChange={(v) => onParam('propsCullDistance', v)} />
          <SliderCtl def={PROP_SLIDERS.propsLodDistance} value={params.propsLodDistance} onChange={(v) => onParam('propsLodDistance', v)} />
          <p className="section-hint">
            {worldMode === 'studio'
              ? 'Studio also reads the props mask painted in Paint Mode.'
              : 'This mode uses deterministic procedural scattering from the current seed.'}
          </p>
        </>
      )}
    </SidePanel>
  );
}

function CloudsPanel({ ctx }) {
  return (
    <SidePanel title="Clouds" description="Volumetric cloud layer." onClose={ctx.onClose}>
      <CloudPanelInner
        params={ctx.params}
        onParam={ctx.onParam}
        perf={ctx.perf}
        onPerfSetting={ctx.onPerfSetting}
        onCloudQuality={ctx.onCloudQuality}
        worldMode={ctx.worldMode}
      />
    </SidePanel>
  );
}

// Shared time-of-day control. `timeOfDay` is a single engine-owned value used
// by the Skybox tab here, the Lighting system and the infinite HUD — never
// duplicated. Owned (surfaced) by the Skybox tab.
function TimeOfDayControl({ timeOfDay, onTimeOfDay }) {
  return (
    <div className="ctl">
      <div className="ctl-top">
        <span className="setting-label">Time</span>
        <span className="ctl-val" style={{ pointerEvents: 'none' }}>{formatTimeOfDay(timeOfDay)}</span>
      </div>
      <div className="slider-track-wrap">
        <div className="slider-track-bg" />
        <div className="slider-track-fill" style={{ width: `${timeOfDay * 100}%` }} />
        <input type="range" className="slider-input" min="0" max="1" step="0.005"
          value={timeOfDay} onChange={(e) => onTimeOfDay(parseFloat(e.target.value))} />
      </div>
    </div>
  );
}

const SKYBOX_SLIDERS = {
  skyboxBrightness: { key: 'skyboxBrightness', label: 'Sky Brightness', min: 0.2, max: 2.5, step: 0.05, digits: 2, info: 'Overall brightness of the sky dome and sun glow.' },
  skyboxHaze: { key: 'skyboxHaze', label: 'Horizon Haze', min: 0, max: 1.2, step: 0.05, digits: 2, info: 'Strength of the atmospheric haze band blended around the horizon.' },
};

function SkyboxPanel({ ctx }) {
  const { params, onParam } = ctx;
  const enabled = params.skyboxEnabled !== false;
  return (
    <SidePanel title="Skybox" description="Sky environment, time of day and atmosphere." onClose={ctx.onClose}>
      <ToggleRow label="Procedural Sky" value={enabled} onChange={(v) => onParam('skyboxEnabled', v)}
        info="Surround the scene with the procedural sky dome (Tile + Infinite World). When off, a flat backdrop and the manual Lighting sun angles are used." />

      <div className="panel-group">
        <div className="panel-group-header"><span className="panel-group-title">TIME OF DAY</span></div>
        <div className="panel-group-body">
          <TimeOfDayControl timeOfDay={ctx.timeOfDay} onTimeOfDay={ctx.onTimeOfDay} />
          <p className="section-hint">Drives the sky colours, sun position and atmosphere. Shared across the Tile view and the Infinite World.</p>
        </div>
      </div>

      {enabled && (
        <>
          <div className="subsection-label">Appearance</div>
          <SliderCtl def={SKYBOX_SLIDERS.skyboxBrightness} value={params.skyboxBrightness ?? 1}
            onChange={(v) => onParam('skyboxBrightness', v)} />
          <SliderCtl def={SKYBOX_SLIDERS.skyboxHaze} value={params.skyboxHaze ?? 0.55}
            onChange={(v) => onParam('skyboxHaze', v)} />
          <ToggleRow label="Night Stars" value={params.skyboxStars !== false}
            onChange={(v) => onParam('skyboxStars', v)}
            info="Show the procedural star field when the sun is below the horizon." />
        </>
      )}
    </SidePanel>
  );
}

function LightingPanel({ ctx }) {
  const { params } = ctx;
  const skyOn = params.skyboxEnabled !== false;
  return (
    <SidePanel title="Lighting" description="Sun, atmosphere and fog." onClose={ctx.onClose}>
      {skyOn && (
        <p className="section-hint">Time of day and the sky environment are configured in the <strong>Skybox</strong> tab. While the procedural sky is on, it drives the sun direction and atmosphere; the manual sun angles below apply when the sky is disabled.</p>
      )}
      <EnvironmentPanelInner params={params} planetStyle={params.planetStyle}
        onParam={ctx.onParam} onTuning={ctx.onStyleTuning} />
    </SidePanel>
  );
}

function PerformancePanel({ ctx }) {
  return (
    <SidePanel title="Performance" description="Quality, LOD and budgets." onClose={ctx.onClose}>
      <PerformanceStats stats={ctx.stats} gpu={ctx.gpu} />
      <PerfSettings perf={ctx.perf} onPerfPreset={ctx.onPerfPreset}
        onPerfSetting={ctx.onPerfSetting} onPerfReset={ctx.onPerfReset} />
    </SidePanel>
  );
}

function DebugPanel({ ctx }) {
  return (
    <SidePanel title="Debug" description="Live stats and diagnostics." onClose={ctx.onClose}>
      <PerformanceStats stats={ctx.stats} gpu={ctx.gpu} />
      {ctx.worldMode !== 'planet' && (
        <LodPanel
          lodCounts={ctx.lodCounts} chunkCount={ctx.chunkCount}
          visibleChunks={ctx.visibleChunks} culledChunks={ctx.culledChunks}
          cullingEnabled={ctx.cullingEnabled} behindCameraCulling={ctx.behindCameraCulling}
          onCullingEnabled={ctx.onCullingEnabled} onBehindCameraCulling={ctx.onBehindCameraCulling}
          embedded />
      )}
      <CameraPanel camInfo={ctx.camInfo} camMode={ctx.camMode} onMode={ctx.onMode}
        onFov={ctx.onFov} onFocusCenter={ctx.onFocusCenter} embedded />
      <div className="panel-group">
        <div className="panel-group-header"><span className="panel-group-title">SESSION</span></div>
        <div className="panel-group-body">
          <div className="stat-row"><span className="stat-label">World Mode</span><span className="stat-value">{ctx.worldMode}</span></div>
          <div className="stat-row"><span className="stat-label">Seed</span><span className="stat-value stat-mono">{ctx.params.seed}</span></div>
          <div className="stat-row"><span className="stat-label">Board</span><span className="stat-value stat-mono">{ctx.boardSize} u</span></div>
          <div className="stat-row"><span className="stat-label">Version</span><span className="stat-value stat-mono">v{APP_VERSION}</span></div>
        </div>
      </div>
    </SidePanel>
  );
}

// ------------------------------------------------------------- export panel
const FORMAT_OPTIONS = [
  { value: 'glb', label: 'GLB / GLTF (Recommended)' },
  { value: 'obj', label: 'OBJ (Wavefront)' },
];
const RES_OPTIONS = [
  { value: '64', label: '64 × 64 (Low-poly)' }, { value: '128', label: '128 × 128' },
  { value: '256', label: '256 × 256' }, { value: '512', label: '512 × 512 (Standard)' },
  { value: '1024', label: '1024 × 1024 (High-end)' },
];
const TEX_OPTIONS = [
  { value: '512', label: '512 × 512' }, { value: '1024', label: '1024 × 1024' },
  { value: '2048', label: '2048 × 2048 (Crisp)' }, { value: '4096', label: '4096 × 4096 (UHD)' },
];
const COLL_OPTIONS = [
  { value: '32', label: '32 × 32' }, { value: '64', label: '64 × 64' },
  { value: '128', label: '128 × 128 (Recommended)' }, { value: '256', label: '256 × 256' },
];

function ExportPanel({ ctx }) {
  const [opt, setOpt] = useState({
    format: 'glb', meshRes: '512', includeMesh: true, includeSkirts: true, includeBase: true,
    bakeColor: true, texRes: '2048', bakeLighting: false, bakeNormal: true,
    exportHeightmap: false, exportSplat: false, exportCollision: false, collisionRes: '128',
    exportWater: false, exportPreset: true,
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setOpt((p) => ({ ...p, [k]: v }));
  const showTex = opt.bakeColor || opt.bakeNormal || opt.exportHeightmap;

  const doExport = async () => {
    setBusy(true);
    try { await ctx.onExport(opt); }
    finally { setBusy(false); }
  };

  return (
    <SidePanel title="Export" description="Export meshes and textures."
      onClose={ctx.onClose}
      footer={(
        <button type="button" className="action-btn primary" onClick={doExport} disabled={busy}>
          {busy ? 'Exporting…' : `Export ${ctx.worldMode === 'planet' ? 'Planet' : 'Terrain'}`}
        </button>
      )}>
      <div className="side-panel-quick">
        <button type="button" className="action-btn" onClick={ctx.onExportScreenshot} disabled={busy}>Screenshot</button>
        <button type="button" className="action-btn" onClick={ctx.onExportHeightmap} disabled={busy}>Heightmap</button>
      </div>

      <div className="subsection-label">Format &amp; Resolution</div>
      <SelectRow label="Format" value={opt.format} options={FORMAT_OPTIONS} onChange={(v) => set('format', v)} />
      <ToggleRow label="Include Terrain Mesh" value={opt.includeMesh} onChange={(v) => set('includeMesh', v)} />
      {opt.includeMesh && (
        <>
          <SelectRow label="Mesh Resolution" value={opt.meshRes} options={RES_OPTIONS} onChange={(v) => set('meshRes', v)} />
          <ToggleRow label="Include Side Skirts" value={opt.includeSkirts} onChange={(v) => set('includeSkirts', v)} />
          {opt.includeSkirts && (
            <ToggleRow label="Include Base Slab" value={opt.includeBase} onChange={(v) => set('includeBase', v)} />
          )}
        </>
      )}

      <div className="subsection-label">Texture Baking</div>
      <ToggleRow label="Bake Color Texture" value={opt.bakeColor} onChange={(v) => set('bakeColor', v)} />
      {opt.bakeColor && (
        <ToggleRow label="Bake Lighting into Color" value={opt.bakeLighting} onChange={(v) => set('bakeLighting', v)} />
      )}
      <ToggleRow label="Bake Normal Map" value={opt.bakeNormal} onChange={(v) => set('bakeNormal', v)} />
      {showTex && (
        <SelectRow label="Texture Size" value={opt.texRes} options={TEX_OPTIONS} onChange={(v) => set('texRes', v)} />
      )}

      <div className="subsection-label">Additional Assets</div>
      <ToggleRow label="Export Heightmap" value={opt.exportHeightmap} onChange={(v) => set('exportHeightmap', v)} />
      {opt.exportHeightmap && (
        <ToggleRow label="Include Biome Splat Map" value={opt.exportSplat} onChange={(v) => set('exportSplat', v)} />
      )}
      <ToggleRow label="Export Collision Mesh" value={opt.exportCollision} onChange={(v) => set('exportCollision', v)} />
      {opt.exportCollision && (
        <SelectRow label="Collision Resolution" value={opt.collisionRes} options={COLL_OPTIONS} onChange={(v) => set('collisionRes', v)} />
      )}
      <ToggleRow label="Include Water Plane" value={opt.exportWater} onChange={(v) => set('exportWater', v)} />
      <ToggleRow label="Export Preset (JSON)" value={opt.exportPreset} onChange={(v) => set('exportPreset', v)} />
    </SidePanel>
  );
}

const COMPONENTS = {
  terrain: TerrainPanel, world: WorldPanel, planet: PlanetPanel, biomes: BiomesPanel,
  water: WaterPanel, props: PropsPanel, clouds: CloudsPanel, skybox: SkyboxPanel, lighting: LightingPanel, export: ExportPanel,
  performance: PerformancePanel, debug: DebugPanel,
};

export function renderPanel(id, ctx) {
  const Comp = COMPONENTS[id];
  return Comp ? <Comp ctx={ctx} /> : null;
}
