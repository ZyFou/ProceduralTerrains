import { useEffect, useState } from 'react';
import { Cog, Dices, Eye, RefreshCw, Sparkles } from 'lucide-react';
import SidePanel, { PanelTabs } from './SidePanel.jsx';
import { SliderCtl, ToggleRow, SelectRow } from '../controls.jsx';
import { PANEL_ICONS } from '../icons/panelIcons.jsx';
import ImportMapsContent from '../ui/ImportMapsContent.jsx';
import CollapsibleGroup from '../ui/CollapsibleGroup.jsx';
import TileMapDebugSection from '../ui/TileMapDebugSection.jsx';
import { TERRAIN_SLIDERS, NOISE_SLIDERS, BIOME_SLIDERS, RENDER_SLIDERS, InfoDot, ColorField } from './defs.jsx';
import { PRESETS } from '../../engine/presets.js';
import { NOISE_PRESETS } from '../../engine/style/NoisePresets.js';
import { formatTimeOfDay } from '../../engine/sky/TimeOfDay.js';
import { APP_VERSION } from '../../constants/app.js';
import PlanetStylePanel from '../PlanetStylePanel.jsx';
import WorldPanelInner from '../ui/WorldPanel.jsx';
import CloudPanelInner from '../ui/CloudPanel.jsx';
import WaterPanelInner from '../ui/WaterPanel.jsx';
import PanelResetButton from '../ui/PanelResetButton.jsx';
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
  water: { label: 'Water', title: 'Water', desc: 'Ocean surface, quality modes and volumetric settings.', icon: PANEL_ICONS.water },
  props: { label: 'Props', title: 'Props', desc: 'Procedural grass and flowers.', icon: PANEL_ICONS.props },
  clouds: { label: 'Clouds', title: 'Clouds', desc: 'Volumetric cloud layer.', icon: PANEL_ICONS.clouds },
  skybox: { label: 'Skybox', title: 'Skybox', desc: 'Sky environment, time of day and atmosphere.', icon: PANEL_ICONS.skybox },
  lighting: { label: 'Lighting', title: 'Lighting', desc: 'Sun, atmosphere and fog.', icon: PANEL_ICONS.lighting },
  visuals: { label: 'Visuals', title: 'Visuals / Post FX', desc: 'Atmosphere, volumetrics, color grading and final image polish.', icon: PANEL_ICONS.visuals },
  export: { label: 'Export', title: 'Export', desc: 'Export meshes and textures.', icon: PANEL_ICONS.export },
  performance: { label: 'Performance', title: 'Performance', desc: 'Quality, LOD and budgets.', icon: PANEL_ICONS.performance },
  debug: { label: 'Debug', title: 'Debug', desc: 'Live stats and diagnostics.', icon: PANEL_ICONS.debug },
};

// Order used by the left toolbar.
export const PANEL_ORDER = ['terrain', 'noiseLayers', 'biomes', 'water', 'props', 'clouds', 'skybox', 'lighting', 'visuals', 'planet', 'export', 'world', 'performance', 'debug'];

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
  useEffect(() => {
    const targetTab = ctx.settingsTarget?.tabId;
    if (targetTab && targetTab !== tab) setTab(targetTab);
  }, [ctx.settingsTarget?.tabId, tab]);
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
            <SliderCtl key={def.key} def={def} value={params[def.key]} onChange={(v) => onParam(def.key, v)} settingId={`terrain.${def.key}`} />
          ))}
        </>
      )}
      {tab === 'noise' && (
        <>
          <SelectRow label="Noise Preset" value={params.noisePreset ?? 'default'}
            options={Object.entries(NOISE_PRESETS).map(([key, p]) => ({ value: key, label: p.label }))}
            onChange={ctx.planetStyleProps.onNoisePreset} info="Baseline noise shape configuration." />
          {NOISE_SLIDERS.map((def) => (
            <SliderCtl key={def.key} def={def} value={params[def.key]} onChange={(v) => onParam(def.key, v)} settingId={`terrain.${def.key}`} />
          ))}
        </>
      )}
      {tab === 'surface' && (
        <>
          {RENDER_SLIDERS.map((def) => (
            <SliderCtl key={def.key} def={def} value={params[def.key]} onChange={(v) => onParam(def.key, v)} settingId={`terrain.${def.key}`} />
          ))}
        </>
      )}
      {tab === 'import' && isStudio && <ImportMapsContent ctx={ctx} />}
      <PanelResetButton label="Reset Terrain Settings" onClick={() => ctx.onResetPanel?.('terrain')} settingId="terrain.reset" />
    </SidePanel>
  );
}

function WorldPanel({ ctx }) {
  return (
    <SidePanel title="World" description="Chunking, streaming and grid." onClose={ctx.onClose}>
      <WorldPanelInner params={ctx.params} worldMode={ctx.worldMode} onParam={ctx.onParam} />
      <PanelResetButton label="Reset World Settings" onClick={() => ctx.onResetPanel?.('world')} settingId="world.reset" />
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
          <PlanetStylePanel {...ctx.planetStyleProps} settingsTarget={ctx.settingsTarget} embedded />
          <PlanetSummaryCard params={ctx.params} />
        </>
      )}
      {!isPlanet && (
        <PlanetStylePanel {...ctx.planetStyleProps} settingsTarget={ctx.settingsTarget} embedded paletteOnly />
      )}
      <PanelResetButton label="Reset Planet / Colors Settings" onClick={() => ctx.onResetPanel?.('planet')} settingId="planet.reset" />
    </SidePanel>
  );
}

function BiomesPanel({ ctx }) {
  const { params, onParam } = ctx;
  return (
      <SidePanel title="Biomes" description="Climate distribution and masks." onClose={ctx.onClose}>
      {BIOME_SLIDERS.map((def) => (
        <SliderCtl key={def.key} def={def} value={params[def.key]} onChange={(v) => onParam(def.key, v)} settingId={`biomes.${def.key}`} />
      ))}
      <ToggleRow label="Biome Debug" value={params.biomeDebug} onChange={(v) => onParam('biomeDebug', v)}
        settingId="biomes.biomeDebug"
        info="Color-code biomes directly on the terrain surface for inspection." />
      <PanelResetButton label="Reset Biome Settings" onClick={() => ctx.onResetPanel?.('biomes')} settingId="biomes.reset" />
    </SidePanel>
  );
}

function WaterPanel({ ctx }) {
  return (
    <SidePanel title="Water" description="Ocean surface, quality modes and volumetric settings." onClose={ctx.onClose}>
      <WaterPanelInner
        params={ctx.params}
        onParam={ctx.onParam}
        worldMode={ctx.worldMode}
        perf={ctx.perf}
        onPerfSetting={ctx.onPerfSetting}
        planetStyleProps={ctx.planetStyleProps}
        onResetWaterSettings={() => ctx.onResetPanel?.('water')}
        onExportWaterMasks={ctx.onExportWaterMasks}
      />
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
      <PanelResetButton label="Reset Props Settings" onClick={() => ctx.onResetPanel?.('props')} settingId="props.reset" />
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
      <PanelResetButton label="Reset Cloud Settings" onClick={() => ctx.onResetPanel?.('clouds')} settingId="clouds.reset" />
    </SidePanel>
  );
}

// Shared time-of-day control. `timeOfDay` is a single engine-owned value used
// by the Skybox tab here, the Lighting system and the infinite HUD — never
// duplicated. Owned (surfaced) by the Skybox tab.
function TimeOfDayControl({ timeOfDay, onTimeOfDay, settingId }) {
  return (
    <div className="ctl" data-setting-id={settingId}>
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
        settingId="skybox.skyboxEnabled"
        info="Surround the scene with the procedural sky dome (Tile + Infinite World). When off, a flat backdrop and the manual Lighting sun angles are used." />

      <div className="panel-group">
        <div className="panel-group-header"><span className="panel-group-title">TIME OF DAY</span></div>
        <div className="panel-group-body">
          <TimeOfDayControl timeOfDay={ctx.timeOfDay} onTimeOfDay={ctx.onTimeOfDay} settingId="skybox.timeOfDay" />
          <p className="section-hint">Drives the sky colours, sun position and atmosphere. Shared across the Tile view and the Infinite World.</p>
        </div>
      </div>

      {enabled && (
        <>
          <div className="subsection-label">Appearance</div>
          <SliderCtl def={SKYBOX_SLIDERS.skyboxBrightness} value={params.skyboxBrightness ?? 1}
            onChange={(v) => onParam('skyboxBrightness', v)} settingId="skybox.skyboxBrightness" />
          <SliderCtl def={SKYBOX_SLIDERS.skyboxHaze} value={params.skyboxHaze ?? 0.55}
            onChange={(v) => onParam('skyboxHaze', v)} settingId="skybox.skyboxHaze" />
          <ToggleRow label="Night Stars" value={params.skyboxStars !== false}
            onChange={(v) => onParam('skyboxStars', v)}
            settingId="skybox.skyboxStars"
            info="Show the procedural star field when the sun is below the horizon." />
        </>
      )}
      <PanelResetButton label="Reset Skybox Settings" onClick={() => ctx.onResetPanel?.('skybox')} settingId="skybox.reset" />
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
      <PanelResetButton label="Reset Lighting Settings" onClick={() => ctx.onResetPanel?.('lighting')} settingId="lighting.reset" />
    </SidePanel>
  );
}

function PerformancePanel({ ctx }) {
  return (
    <SidePanel title="Performance" description="Quality, LOD and budgets." onClose={ctx.onClose}>
      <PerformanceStats stats={ctx.stats} gpu={ctx.gpu} />
      <PerfSettings perf={ctx.perf} onPerfPreset={ctx.onPerfPreset}
        onPerfSetting={ctx.onPerfSetting} onPerfReset={ctx.onPerfReset}
        settingsTarget={ctx.settingsTarget}
        onSettingsTargetHandled={ctx.onSettingsTargetHandled} />
      <PanelResetButton label="Reset Performance Settings" onClick={() => ctx.onResetPanel?.('performance')} settingId="performance.reset" />
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
          {ctx.worldMode !== 'planet' && ctx.worldMode !== 'infinite' && (
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

      <PanelResetButton label="Reset Debug Settings" onClick={() => ctx.onResetPanel?.('debug')} settingId="debug.reset" />
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
          settingId="debug.autoUpdate"
        />
      </CollapsibleGroup>

      <CollapsibleGroup
        title="Diagnostics"
        icon={<Cog size={15} strokeWidth={1.75} />}
        defaultOpen={isStudio || worldMode === 'planet'}
      >
        {isStudio || worldMode === 'planet' ? (
          <>
            <ToggleRow
              label="Freeze Culling"
              value={!!flags.freezeCulling}
              onChange={(v) => setFlag('freezeCulling', v)}
              info="Stop recomputing chunk visibility. Freeze, then orbit out to inspect the culling frustum from outside."
              settingId="debug.freezeCulling"
            />
            <ToggleRow
              label="Freeze LOD"
              value={!!flags.freezeLod}
              onChange={(v) => setFlag('freezeLod', v)}
              info="Stop recomputing per-chunk level of detail — hold the current LOD layout while you move."
              settingId="debug.freezeLod"
            />
            <ToggleRow
              label="Force Render"
              value={!!flags.forceRender}
              onChange={(v) => setFlag('forceRender', v)}
              info="Bypass on-demand rendering and draw every frame (use to read true sustained FPS)."
              settingId="debug.forceRender"
            />
            <ToggleRow
              label="Disable Height Bake"
              value={!!flags.disableHeightBake}
              onChange={(v) => setFlag('disableHeightBake', v)}
              info={isStudio
                ? 'Force the live per-pixel height field instead of the baked texture — A/B the studio render optimization.'
                : 'Force the live per-pixel height field instead of the baked cubemap — A/B the planet render optimization.'}
              settingId="debug.disableHeightBake"
            />
          </>
        ) : (
          <p className="section-hint">Freeze / render diagnostics apply to Tile or Planet mode.</p>
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
    exportWaterMask: false, exportDepthMap: false, exportShorelineMask: false, exportFoamMask: false,
    excludeWaterFromExport: false, exportWaterMetadata: false,
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
      {opt.exportWater && (
        <ToggleRow label="Exclude Water from Export" value={opt.excludeWaterFromExport} onChange={(v) => set('excludeWaterFromExport', v)} />
      )}
      <div className="subsection-label">Water Maps</div>
      <ToggleRow label="Export Water Mask" value={opt.exportWaterMask} onChange={(v) => set('exportWaterMask', v)} />
      <ToggleRow label="Export Depth Map" value={opt.exportDepthMap} onChange={(v) => set('exportDepthMap', v)} />
      <ToggleRow label="Export Shoreline Mask" value={opt.exportShorelineMask} onChange={(v) => set('exportShorelineMask', v)} />
      <ToggleRow label="Export Foam Mask" value={opt.exportFoamMask} onChange={(v) => set('exportFoamMask', v)} />
      <ToggleRow label="Include Water Material Metadata" value={opt.exportWaterMetadata} onChange={(v) => set('exportWaterMetadata', v)} />
      <ToggleRow label="Export Preset (JSON)" value={opt.exportPreset} onChange={(v) => set('exportPreset', v)} />
    </SidePanel>
  );
}


function VisualsPanel({ ctx }) {
  const { params, onParam, onVisualPreset, worldMode } = ctx;
  const set = (key, value) => onParam(key, value);
  const presetOptions = ['off', 'low', 'balanced', 'high', 'cinematic'].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }));
  const qualityOptions = ['low', 'medium', 'high'].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }));
  const debugOptions = [
    { value: 'off', label: 'Off' }, { value: 'depth', label: 'Depth Buffer' },
    { value: 'fog', label: 'Fog Density' }, { value: 'cloudShadows', label: 'Cloud Shadow Mask' },
  ];
  const cinematicBlocked = worldMode === 'infinite';
  return (
    <SidePanel title="Visuals / Post FX" description="Cost-aware cinematic atmosphere, volumetrics, cloud shadows and final color polish.">
      <ControlSection id="visuals-preset" title="Preset" icon={<Sparkles size={15} strokeWidth={1.75} />} defaultOpen>
        <SelectRow label="Visual Quality Preset" value={params.visualPreset} options={presetOptions} onChange={(v) => onVisualPreset?.(v)} info="Applies a coordinated atmosphere and post-processing preset. Infinite World keeps cinematic effects opt-in and safe." settingId="visuals.preset" />
        {cinematicBlocked && <p className="section-hint">Infinite World uses safe defaults; cinematic render scale and heavy volumetrics remain opt-in.</p>}
        <ToggleRow label="Visuals Enabled" value={params.visualsEnabled} onChange={(v) => set('visualsEnabled', v)} settingId="visuals.enabled" />
        <ToggleRow label="Atmosphere Enabled" value={params.atmosphereEnabled} onChange={(v) => set('atmosphereEnabled', v)} settingId="visuals.atmosphere" />
        <ToggleRow label="Post FX Enabled" value={params.postFxEnabled} onChange={(v) => set('postFxEnabled', v)} settingId="visuals.postfx" />
        <ToggleRow label="Auto Adjust With Time" value={params.atmosphereAutoTime} onChange={(v) => set('atmosphereAutoTime', v)} settingId="visuals.autoTime" />
        <ToggleRow label="Biome-Aware Atmosphere" value={params.atmosphereAutoBiome} onChange={(v) => set('atmosphereAutoBiome', v)} settingId="visuals.autoBiome" />
      </ControlSection>
      <ControlSection id="visuals-fog" title="Fog & Haze" defaultOpen>
        <ToggleRow label="Fog Enabled" value={params.fogEnabled} onChange={(v) => set('fogEnabled', v)} />
        <ColorField label="Fog Color" value={params.fogColor} onChange={(e) => set('fogColor', e.target.value)} />
        <SliderCtl def={{ label:'Fog Density', min:0, max:0.8, step:0.01, digits:2 }} value={params.fogDensity} onChange={(v) => set('fogDensity', v)} />
        <SliderCtl def={{ label:'Fog Start', min:0, max:3000, step:10, unit:'m' }} value={params.fogStart} onChange={(v) => set('fogStart', v)} />
        <SliderCtl def={{ label:'Fog End', min:200, max:8000, step:25, unit:'m' }} value={params.fogEnd} onChange={(v) => set('fogEnd', v)} />
        <SliderCtl def={{ label:'Height Fog Strength', min:0, max:1, step:0.01, digits:2 }} value={params.heightFogStrength} onChange={(v) => set('heightFogStrength', v)} />
        <SliderCtl def={{ label:'Distance Fog Strength', min:0, max:1, step:0.01, digits:2 }} value={params.distanceFogStrength} onChange={(v) => set('distanceFogStrength', v)} />
        <ToggleRow label="Horizon Haze" value={params.horizonHaze} onChange={(v) => set('horizonHaze', v)} />
        <ColorField label="Haze Color" value={params.hazeColor} onChange={(e) => set('hazeColor', e.target.value)} />
        <SliderCtl def={{ label:'Haze Density', min:0, max:1, step:0.01, digits:2 }} value={params.hazeDensity} onChange={(v) => set('hazeDensity', v)} />
        <SliderCtl def={{ label:'Sun Haze Strength', min:0, max:1, step:0.01, digits:2 }} value={params.sunHazeStrength} onChange={(v) => set('sunHazeStrength', v)} />
      </ControlSection>
      <ControlSection id="visuals-shadows-rays" title="Cloud Shadows & Light Shafts" defaultOpen={false}>
        <ToggleRow label="Cloud Shadows" value={params.cloudShadowsEnabled} onChange={(v) => set('cloudShadowsEnabled', v)} />
        <SliderCtl def={{ label:'Shadow Strength', min:0, max:0.6, step:0.01, digits:2 }} value={params.cloudShadowStrength} onChange={(v) => set('cloudShadowStrength', v)} />
        <SliderCtl def={{ label:'Shadow Scale', min:0.2, max:6, step:0.05, digits:2 }} value={params.cloudShadowScale} onChange={(v) => set('cloudShadowScale', v)} />
        <SliderCtl def={{ label:'Shadow Speed', min:0, max:0.2, step:0.005, digits:3 }} value={params.cloudShadowSpeed} onChange={(v) => set('cloudShadowSpeed', v)} />
        <ToggleRow label="Light Shafts" value={params.lightShaftsEnabled} onChange={(v) => set('lightShaftsEnabled', v)} disabled={worldMode === 'infinite'} disabledTooltip="Disabled by default in Infinite World to protect movement FPS." />
        <SliderCtl def={{ label:'Shaft Intensity', min:0, max:1, step:0.01, digits:2 }} value={params.lightShaftIntensity} onChange={(v) => set('lightShaftIntensity', v)} />
        <SliderCtl def={{ label:'Shaft Length', min:0.1, max:1.5, step:0.01, digits:2 }} value={params.lightShaftLength} onChange={(v) => set('lightShaftLength', v)} />
        <SelectRow label="Shaft Quality" value={params.lightShaftQuality} options={qualityOptions} onChange={(v) => set('lightShaftQuality', v)} />
      </ControlSection>
      <ControlSection id="visuals-post" title="Tone Mapping & Color" defaultOpen>
        <SelectRow label="Tone Mapping" value={params.toneMappingMode} options={['linear','filmic','reinhard'].map((value)=>({value,label:value}))} onChange={(v) => set('toneMappingMode', v)} />
        <SliderCtl def={{ label:'Exposure', min:0.2, max:2.5, step:0.01, digits:2 }} value={params.exposure} onChange={(v) => set('exposure', v)} />
        <SliderCtl def={{ label:'Gamma', min:1, max:3, step:0.01, digits:2 }} value={params.gamma} onChange={(v) => set('gamma', v)} />
        <SliderCtl def={{ label:'Contrast', min:0.5, max:1.8, step:0.01, digits:2 }} value={params.contrast} onChange={(v) => set('contrast', v)} />
        <SliderCtl def={{ label:'Saturation', min:0, max:2, step:0.01, digits:2 }} value={params.saturation} onChange={(v) => set('saturation', v)} />
        <SliderCtl def={{ label:'Temperature', min:-1, max:1, step:0.01, digits:2 }} value={params.temperature} onChange={(v) => set('temperature', v)} />
        <SliderCtl def={{ label:'Tint', min:-1, max:1, step:0.01, digits:2 }} value={params.tint} onChange={(v) => set('tint', v)} />
      </ControlSection>
      <ControlSection id="visuals-bloom-lens" title="Bloom, AO & Lens" defaultOpen={false}>
        <ToggleRow label="Bloom" value={params.bloomEnabled} onChange={(v) => set('bloomEnabled', v)} />
        <SliderCtl def={{ label:'Bloom Strength', min:0, max:0.8, step:0.01, digits:2 }} value={params.bloomStrength} onChange={(v) => set('bloomStrength', v)} />
        <SliderCtl def={{ label:'Bloom Threshold', min:0, max:1.5, step:0.01, digits:2 }} value={params.bloomThreshold} onChange={(v) => set('bloomThreshold', v)} />
        <ToggleRow label="Ambient Occlusion" value={params.aoEnabled} onChange={(v) => set('aoEnabled', v)} />
        <SliderCtl def={{ label:'AO Strength', min:0, max:0.6, step:0.01, digits:2 }} value={params.aoStrengthPost} onChange={(v) => set('aoStrengthPost', v)} />
        <ToggleRow label="Depth of Field" value={params.dofEnabled} onChange={(v) => set('dofEnabled', v)} />
        <ToggleRow label="Vignette" value={params.vignette} onChange={(v) => set('vignette', v)} />
        <ToggleRow label="Film Grain" value={params.filmGrain} onChange={(v) => set('filmGrain', v)} />
        <ToggleRow label="Chromatic Aberration" value={params.chromaticAberration} onChange={(v) => set('chromaticAberration', v)} />
      </ControlSection>
      <ControlSection id="visuals-performance" title="Performance & Debug" defaultOpen={false}>
        <SliderCtl def={{ label:'Post FX Render Scale', min:0.5, max:1.5, step:0.05, digits:2 }} value={params.visualRenderScale} onChange={(v) => set('visualRenderScale', v)} />
        <ToggleRow label="Volumetric Fog Layer" value={params.volumetricFogEnabled} onChange={(v) => set('volumetricFogEnabled', v)} disabled={worldMode !== 'studio'} disabledTooltip="Optimized volumetric fog is currently limited to Tile mode; planet/infinite use haze fallbacks." />
        <ToggleRow label="Screenshot Override" value={params.screenshotVisualOverride} onChange={(v) => set('screenshotVisualOverride', v)} />
        <SliderCtl def={{ label:'Screenshot Render Scale', min:1, max:2, step:0.05, digits:2 }} value={params.screenshotRenderScale} onChange={(v) => set('screenshotRenderScale', v)} />
        <SelectRow label="Debug View" value={params.visualDebugView} options={debugOptions} onChange={(v) => set('visualDebugView', v)} />
      </ControlSection>
    </SidePanel>
  );
}

function NoiseLayersPanelWrapper({ ctx }) {
  return (
    <NoiseLayersPanel ctx={ctx}>
      <PanelResetButton label="Reset Noise Layers" onClick={() => ctx.onResetPanel?.('noiseLayers')} settingId="noiseLayers.reset" />
    </NoiseLayersPanel>
  );
}

const COMPONENTS = {
  terrain: TerrainPanel, noiseLayers: NoiseLayersPanelWrapper, world: WorldPanel, planet: PlanetPanel, biomes: BiomesPanel,
  water: WaterPanel, props: PropsPanel, clouds: CloudsPanel, skybox: SkyboxPanel, lighting: LightingPanel, visuals: VisualsPanel, export: ExportPanel,
  performance: PerformancePanel, debug: DebugPanel,
};

export function renderPanel(id, ctx) {
  const Comp = COMPONENTS[id];
  return Comp ? <Comp ctx={ctx} /> : null;
}
