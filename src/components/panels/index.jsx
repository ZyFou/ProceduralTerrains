import { useEffect, useState } from 'react';
import { Cog, Dices, Eye, RefreshCw } from 'lucide-react';
import SidePanel, { PanelTabs } from './SidePanel.jsx';
import { SliderCtl, ToggleRow, SelectRow } from '../controls.jsx';
import { PANEL_ICONS } from '../icons/panelIcons.jsx';
import ImportMapsContent from '../ui/ImportMapsContent.jsx';
import CollapsibleGroup from '../ui/CollapsibleGroup.jsx';
import TileMapDebugSection from '../ui/TileMapDebugSection.jsx';
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
import NoiseLayersPanel from '../NoiseLayersPanel.jsx';

// ---- toolbar / panel metadata (single source for icons + labels) ----
export const PANEL_META = {
  terrain: { label: 'Terrain', title: 'Terrain', desc: 'Shape and surface generation.', icon: PANEL_ICONS.terrain },
  noiseLayers: { label: 'Layers', title: 'Noise Layers', desc: 'Stack noise layers to shape terrain.', icon: PANEL_ICONS.noiseLayers },
  world: { label: 'World', title: 'World', desc: 'Chunking, streaming and grid.', icon: PANEL_ICONS.world },
  planet: {
    label: 'Planet',
    title: 'Planet',
    desc: 'Spherical world style and summary.',
    studioLabel: 'Colors',
    studioTitle: 'Colors',
    studioDesc: 'Biome palette and terrain material colors.',
    icon: PANEL_ICONS.planet,
    modes: ['planet', 'studio'],
  },
  biomes: { label: 'Biomes', title: 'Biomes', desc: 'Climate distribution and masks.', icon: PANEL_ICONS.biomes },
  water: { label: 'Water', title: 'Water', desc: 'Ocean surface and colours.', icon: PANEL_ICONS.water },
  props: { label: 'Props', title: 'Props', desc: 'Procedural grass and flowers.', icon: PANEL_ICONS.props },
  clouds: { label: 'Clouds', title: 'Clouds', desc: 'Volumetric cloud layer.', icon: PANEL_ICONS.clouds },
  skybox: { label: 'Skybox', title: 'Skybox', desc: 'Sky environment, time of day and atmosphere.', icon: PANEL_ICONS.skybox },
  lighting: { label: 'Lighting', title: 'Lighting', desc: 'Sun, atmosphere and fog.', icon: PANEL_ICONS.lighting },
  export: { label: 'Export', title: 'Export', desc: 'Export meshes and textures.', icon: PANEL_ICONS.export },
  performance: { label: 'Performance', title: 'Performance', desc: 'Quality, LOD and budgets.', icon: PANEL_ICONS.performance },
  debug: { label: 'Debug', title: 'Debug', desc: 'Live stats and diagnostics.', icon: PANEL_ICONS.debug },
};

// Order used by the left toolbar.
export const PANEL_ORDER = ['terrain', 'noiseLayers', 'biomes', 'water', 'props', 'clouds', 'skybox', 'lighting', 'planet', 'export', 'world', 'performance', 'debug'];

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
          <Dices size={14} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
    </div>
  );
}

const RegenButton = ({ onRegenerate }) => (
  <button type="button" className="action-btn primary" onClick={onRegenerate}>
    <RefreshCw size={14} strokeWidth={1.75} aria-hidden />
    Regenerate
  </button>
);

// ---------------------------------------------------------------- panels
function TerrainPanel({ ctx }) {
  const [tab, setTab] = useState('shape');
  const { params, onParam, worldMode } = ctx;
  const isStudio = worldMode === 'studio';
  const tabs = [
    { id: 'shape', label: 'Shape' },
    { id: 'noise', label: 'Noise' },
    { id: 'surface', label: 'Surface' },
    ...(isStudio ? [{ id: 'import', label: 'Import' }] : []),
  ];
  return (
    <SidePanel title="Terrain" description="Shape and surface generation." onClose={ctx.onClose}
      footer={<RegenButton onRegenerate={ctx.onRegenerate} />}>
      <PanelTabs active={tab} onChange={setTab} tabs={tabs} />
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
      {tab === 'import' && isStudio && <ImportMapsContent ctx={ctx} />}
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
  const [tab, setTab] = useState('monitor');
  const isStudio = ctx.worldMode === 'studio';

  return (
    <SidePanel title="Debug" description="Live stats and diagnostics." onClose={ctx.onClose}>
      <PanelTabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'monitor', label: 'Monitor' },
          { id: 'viewport', label: 'Viewport' },
          { id: 'engine', label: 'Engine' },
        ]}
      />

      {tab === 'monitor' && (
        <>
          <PerformanceStats stats={ctx.stats} gpu={ctx.gpu} />
          <SessionInfo ctx={ctx} />
        </>
      )}

      {tab === 'viewport' && (
        <>
          <CameraPanel
            camInfo={ctx.camInfo}
            camMode={ctx.camMode}
            onMode={ctx.onMode}
            onFov={ctx.onFov}
            onFocusCenter={ctx.onFocusCenter}
            embedded
          />
          {ctx.worldMode !== 'planet' && (
            <LodPanel
              lodCounts={ctx.lodCounts}
              chunkCount={ctx.chunkCount}
              visibleChunks={ctx.visibleChunks}
              culledChunks={ctx.culledChunks}
              cullingEnabled={ctx.cullingEnabled}
              behindCameraCulling={ctx.behindCameraCulling}
              onCullingEnabled={ctx.onCullingEnabled}
              onBehindCameraCulling={ctx.onBehindCameraCulling}
              embedded
            />
          )}
          <TerrainOverlayOptions ctx={ctx} />
          {isStudio && (
            <TileMapDebugSection
              tileDebug={ctx.tileDebug}
              onTileDebug={ctx.onTileDebug}
            />
          )}
        </>
      )}

      {tab === 'engine' && <EngineDebugOptions ctx={ctx} />}
    </SidePanel>
  );
}

function SessionInfo({ ctx }) {
  return (
    <div className="panel-group">
      <div className="panel-group-header">
        <span className="panel-group-title">SESSION</span>
      </div>
      <div className="panel-group-body">
        <div className="stat-row">
          <span className="stat-label">World Mode</span>
          <span className="stat-value">{ctx.worldMode}</span>
        </div>
        <div className="stat-row">
          <span className="stat-label">Seed</span>
          <span className="stat-value stat-mono">{ctx.params.seed}</span>
        </div>
        <div className="stat-row">
          <span className="stat-label">Board</span>
          <span className="stat-value stat-mono">{ctx.boardSize} u</span>
        </div>
        {ctx.worldMode === 'studio' && (
          <div className="stat-row">
            <span className="stat-label">Height Bake</span>
            <span className="stat-value">
              {ctx.debugFlags?.disableHeightBake ? 'Off (live field)' : 'Active'}
            </span>
          </div>
        )}
        <div className="stat-row">
          <span className="stat-label">Version</span>
          <span className="stat-value stat-mono">v{APP_VERSION}</span>
        </div>
      </div>
    </div>
  );
}

function TerrainOverlayOptions({ ctx }) {
  const { params, onParam, worldMode } = ctx;
  const isStudio = worldMode === 'studio';

  return (
    <CollapsibleGroup
      title="Terrain Overlays"
      icon={<Eye size={15} strokeWidth={1.75} />}
      defaultOpen
    >
      <ToggleRow
        label="Wireframe"
        value={params.wireframe}
        onChange={(v) => onParam('wireframe', v)}
        info="Draw the terrain as wire mesh lines instead of solid triangles."
      />
      <ToggleRow
        label="LOD Debug"
        value={params.lodDebug}
        onChange={(v) => onParam('lodDebug', v)}
        info="Tint chunks by their active level-of-detail (red = highest detail → blue = lowest)."
      />
      {isStudio && (
        <ToggleRow
          label="Chunk Grid"
          value={params.chunkGrid}
          onChange={(v) => onParam('chunkGrid', v)}
          info="Overlay borders along chunk boundaries."
        />
      )}
      <ToggleRow
        label="Biome Debug"
        value={params.biomeDebug}
        onChange={(v) => onParam('biomeDebug', v)}
        info="Color-code biomes directly on the terrain surface for inspection."
      />
    </CollapsibleGroup>
  );
}

function EngineDebugOptions({ ctx }) {
  const { params, onParam, worldMode } = ctx;
  const flags = ctx.debugFlags ?? {};
  const setFlag = ctx.onDebugFlag ?? (() => {});
  const isStudio = worldMode === 'studio';

  return (
    <>
      <CollapsibleGroup
        title="Generation"
        icon={<RefreshCw size={15} strokeWidth={1.75} />}
        defaultOpen
      >
        <ToggleRow
          label="Auto Update"
          value={params.autoUpdate}
          onChange={(v) => onParam('autoUpdate', v)}
          info="Rebuild the terrain live as shape settings change. When off, edits are deferred until you press Regenerate."
        />
      </CollapsibleGroup>

      <CollapsibleGroup
        title="Diagnostics"
        icon={<Cog size={15} strokeWidth={1.75} />}
        defaultOpen={isStudio}
      >
        {isStudio ? (
          <>
            <ToggleRow
              label="Freeze Culling"
              value={!!flags.freezeCulling}
              onChange={(v) => setFlag('freezeCulling', v)}
              info="Stop recomputing chunk visibility. Freeze, then orbit out to inspect the culling frustum from outside."
            />
            <ToggleRow
              label="Freeze LOD"
              value={!!flags.freezeLod}
              onChange={(v) => setFlag('freezeLod', v)}
              info="Stop recomputing per-chunk level of detail — hold the current LOD layout while you move."
            />
            <ToggleRow
              label="Force Render"
              value={!!flags.forceRender}
              onChange={(v) => setFlag('forceRender', v)}
              info="Bypass on-demand rendering and draw every frame (use to read true sustained FPS)."
            />
            <ToggleRow
              label="Disable Height Bake"
              value={!!flags.disableHeightBake}
              onChange={(v) => setFlag('disableHeightBake', v)}
              info="Force the live per-pixel height field instead of the baked texture — A/B the studio render optimization."
            />
          </>
        ) : (
          <p className="section-hint">Freeze and render diagnostics are available in Tile mode.</p>
        )}
      </CollapsibleGroup>
    </>
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

function NoiseLayersPanelWrapper({ ctx }) {
  return <NoiseLayersPanel ctx={ctx} />;
}

const COMPONENTS = {
  terrain: TerrainPanel, noiseLayers: NoiseLayersPanelWrapper, world: WorldPanel, planet: PlanetPanel, biomes: BiomesPanel,
  water: WaterPanel, props: PropsPanel, clouds: CloudsPanel, skybox: SkyboxPanel, lighting: LightingPanel, export: ExportPanel,
  performance: PerformancePanel, debug: DebugPanel,
};

export function renderPanel(id, ctx) {
  const Comp = COMPONENTS[id];
  return Comp ? <Comp ctx={ctx} /> : null;
}
