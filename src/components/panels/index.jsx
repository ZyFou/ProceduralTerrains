import { useEffect, useState } from 'react';
import { Cog, Dices, Eye, RefreshCw } from 'lucide-react';
import SidePanel, { PanelTabs } from './SidePanel.jsx';
import { SliderCtl, ToggleRow, SelectRow } from '../controls.jsx';
import { PANEL_ICONS } from '../icons/panelIcons.jsx';
import ImportMapsContent from '../ui/ImportMapsContent.jsx';
import CollapsibleGroup from '../ui/CollapsibleGroup.jsx';
import ControlSection from '../ui/ControlSection.jsx';
import TileMapDebugSection from '../ui/TileMapDebugSection.jsx';
import { TERRAIN_SLIDERS, NOISE_SLIDERS, BIOME_SLIDERS, RENDER_SLIDERS, InfoDot } from './defs.jsx';
import { PRESETS } from '../../engine/presets.js';
import { NOISE_PRESETS } from '../../engine/style/NoisePresets.js';
import { EROSION_PRESETS, EROSION_QUALITY } from '../../engine/terrain/erosion/ErosionPresets.js';
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
  world: { label: 'World', title: 'World', desc: 'Layout, tiles, chunking and grid.', icon: PANEL_ICONS.world },
  planet: {
    label: 'Planet',
    title: 'Planet',
    desc: 'Spherical world style and summary.',
    studioLabel: 'Colors',
    studioTitle: 'Colors',
    studioDesc: 'Biome palette and terrain material colors.',
    icon: PANEL_ICONS.planet,
    modes: ['planet', 'studio', 'infinite'],
  },
  biomes: { label: 'Biomes', title: 'Biomes', desc: 'Climate distribution and masks.', icon: PANEL_ICONS.biomes },
  water: { label: 'Water', title: 'Water', desc: 'Ocean surface, quality modes and volumetric settings.', icon: PANEL_ICONS.water },
  props: { label: 'Props', title: 'Props', desc: 'Procedural grass, flowers and rocks.', icon: PANEL_ICONS.props },
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
  if (worldMode !== 'planet' && meta.studioLabel) {
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
  // Erosion lives as a tab here (Tile mode only). Its bake state is shared
  // between the tab body and the footer's Bake / Reset buttons.
  const erosion = useErosionBake(ctx);
  useEffect(() => {
    const targetTab = ctx.settingsTarget?.tabId;
    if (targetTab && targetTab !== tab) setTab(targetTab);
  }, [ctx.settingsTarget?.tabId, tab]);
  // Leaving Tile mode hides the Erosion tab — fall back to Shape so we never
  // render an unavailable tab.
  useEffect(() => {
    if (!isStudio && tab === 'erosion') setTab('shape');
  }, [isStudio, tab]);
  const onErosionTab = isStudio && tab === 'erosion';
  const tabs = [
    { id: 'shape', label: 'Shape' },
    { id: 'noise', label: 'Noise' },
    { id: 'surface', label: 'Surface' },
    ...(isStudio ? [{ id: 'erosion', label: 'Erosion' }] : []),
    ...(isStudio ? [{ id: 'import', label: 'Import' }] : []),
  ];
  return (
    <SidePanel title="Terrain" description="Shape and surface generation." onClose={ctx.onClose}
      footer={onErosionTab
        ? <ErosionTabFooter erosion={erosion} />
        : <RegenButton onRegenerate={ctx.onRegenerate} />}>
      <PanelTabs active={tab} onChange={setTab} tabs={tabs} />
      {tab === 'shape' && (
        <>
          <SelectRow label="Preset" value={params.preset} settingId="terrain.preset"
            options={Object.entries(PRESETS).map(([key, p]) => ({ value: key, label: p.label }))}
            onChange={ctx.onPreset} info="Global terrain layout preset." />
          <SeedRow seed={params.seed} onParam={onParam} onRandomizeSeed={ctx.onRandomizeSeed} />
          {TERRAIN_SLIDERS.map((def) => (
            <SliderCtl key={def.key} def={def} value={params[def.key]} onChange={(v) => onParam(def.key, v)} settingId={`terrain.${def.key}`} />
          ))}
          <SelectRow label="Edge Falloff" value={params.edgeFalloffMode ?? 'island'}
            options={[{ value: 'island', label: 'Island' }, { value: 'mountains', label: 'Mountains' }]}
            onChange={(v) => onParam('edgeFalloffMode', v)} info="Island fades terrain toward the boundary. Mountains preserves the terrain and adds ridged noise around the outer edge." />
        </>
      )}
      {tab === 'noise' && (
        <>
          <SelectRow label="Noise Preset" value={params.noisePreset ?? 'default'} settingId="terrain.noisePreset"
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
      {onErosionTab && <ErosionTabContent ctx={ctx} erosion={erosion} />}
      {tab === 'import' && isStudio && <ImportMapsContent ctx={ctx} />}
      {!onErosionTab && (
        <PanelResetButton label="Reset Terrain Settings" onClick={() => ctx.onResetPanel?.('terrain')} settingId="terrain.reset" />
      )}
    </SidePanel>
  );
}

function WorldPanel({ ctx }) {
  return (
    <SidePanel title="World" description="Layout, tiles, chunking and grid." onClose={ctx.onClose}>
      <WorldPanelInner params={ctx.params} worldMode={ctx.worldMode} onParam={ctx.onParam} />
      {ctx.worldMode === 'studio' && <TilesContent ctx={ctx} />}
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

const EROSION_MAIN = [
  { key: 'erosionStrength', label: 'Strength', min: 0, max: 1, step: 0.01, digits: 2, info: 'Master blend of the eroded result over the base terrain (0 = none).' },
  { key: 'erosionDroplets', label: 'Droplets', min: 0, max: 200000, step: 5000, digits: 0, info: 'Rain droplets in the hydraulic pass. More = deeper valleys/ravines, slower bake.' },
  { key: 'erosionLifetime', label: 'Droplet Lifetime', min: 5, max: 80, step: 1, digits: 0, info: 'Max steps each droplet travels before evaporating.' },
  { key: 'erosionSeed', label: 'Seed', min: 1, max: 999, step: 1, digits: 0, info: 'Deterministic random seed for droplet spawn positions.' },
];

const EROSION_ADVANCED = [
  { key: 'erosionRadius', label: 'Erosion Radius', min: 1, max: 6, step: 1, digits: 0, info: 'Brush radius for material removal (larger = smoother channels).' },
  { key: 'erosionErosionRate', label: 'Erosion Strength', min: 0, max: 1, step: 0.01, digits: 2, info: 'How aggressively fast-moving water carves terrain.' },
  { key: 'erosionDeposition', label: 'Deposition', min: 0, max: 1, step: 0.01, digits: 2, info: 'How readily carried sediment settles back out.' },
  { key: 'erosionSedimentCapacity', label: 'Sediment Capacity', min: 1, max: 12, step: 0.5, digits: 1, info: 'How much material a droplet can carry before depositing.' },
  { key: 'erosionEvaporation', label: 'Evaporation', min: 0, max: 0.1, step: 0.005, digits: 3, info: 'Water lost per step (higher = shorter drainage lines).' },
  { key: 'erosionGravity', label: 'Gravity', min: 1, max: 12, step: 0.5, digits: 1, info: 'Downhill acceleration of droplets.' },
  { key: 'erosionInertia', label: 'Inertia', min: 0, max: 0.95, step: 0.01, digits: 2, info: 'How much droplets keep their direction vs. follow the slope.' },
  { key: 'erosionThermalStrength', label: 'Thermal Strength', min: 0, max: 1, step: 0.01, digits: 2, info: 'Strength of loose-material sliding off steep slopes.' },
  { key: 'erosionThermalIterations', label: 'Thermal Iterations', min: 0, max: 100, step: 5, digits: 0, info: 'Relaxation passes for the thermal (talus) erosion.' },
  { key: 'erosionTalus', label: 'Talus Angle', min: 0.1, max: 2, step: 0.05, digits: 2, info: 'Slope steepness (relative to cell size) above which material slides.' },
  { key: 'erosionSmoothing', label: 'Smoothing', min: 0, max: 1, step: 0.01, digits: 2, info: 'Final low-pass blend to soften noise.' },
];

const EROSION_PHASE_LABEL = {
  sampling: 'Sampling base terrain…',
  hydraulic: 'Hydraulic pass',
  thermal: 'Thermal pass',
  done: 'Updating terrain…',
  starting: 'Starting…',
};

// Erosion bake state, shared between the Terrain panel's Erosion tab body and
// its footer (bake / reset live in the footer, the body shows the controls).
function useErosionBake(ctx) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('');
  const [baked, setBaked] = useState(!!ctx.erosionHasResult);

  // Keep the "baked" flag in sync with the engine after undo / redo (which can
  // add or drop the baked result without going through bake/reset here).
  useEffect(() => { setBaked(!!ctx.erosionHasResult); }, [ctx.erosionHasResult]);

  const bake = async () => {
    setBusy(true); setProgress(0); setPhase('starting');
    try {
      const ok = await ctx.onErosionBake((p, ph) => { setProgress(p); setPhase(ph); });
      if (ok) setBaked(true);
    } finally { setBusy(false); }
  };

  const reset = () => { ctx.onErosionReset(); setBaked(false); setProgress(0); setPhase(''); };

  return { busy, progress, phase, baked, bake, reset };
}

function ErosionTabFooter({ erosion }) {
  const { busy, progress, phase, baked, bake, reset } = erosion;
  const pct = Math.round(progress * 100);
  return (
    <div className="side-panel-quick" style={{ width: '100%' }}>
      <button type="button" className="action-btn primary" onClick={bake} disabled={busy} style={{ flex: 2 }}>
        {busy ? `${EROSION_PHASE_LABEL[phase] || 'Baking…'} ${pct}%` : (baked ? 'Re-bake Erosion' : 'Bake Erosion')}
      </button>
      <button type="button" className="action-btn" onClick={reset} disabled={busy || !baked} style={{ flex: 1 }}>
        Reset
      </button>
    </div>
  );
}

function ErosionTabContent({ ctx, erosion }) {
  const { params, onParam } = ctx;
  const { baked } = erosion;

  // Editing any knob detaches from the named preset (→ Custom) without clobbering.
  const setKnob = (key, v) => {
    onParam(key, v);
    if (params.erosionPreset !== 'custom') onParam('erosionPreset', 'custom');
  };

  // Open the Advanced section when search navigates to one of its knobs.
  const advTarget = EROSION_ADVANCED.some((d) => ctx.settingsTarget?.settingId === `erosion.${d.key}`);

  return (
    <>
      <ToggleRow label="Enable Erosion" value={!!params.erosionEnabled} onChange={(v) => onParam('erosionEnabled', v)}
        settingId="erosion.erosionEnabled"
        info="Apply the baked erosion to the terrain. Toggle to compare Before / After. Disabled until you bake." />
      {!baked && (
        <p className="section-hint">No erosion baked yet. Pick a preset, then press <strong>Bake Erosion</strong>. The simulation runs in the background.</p>
      )}

      <SelectRow label="Preset" value={params.erosionPreset ?? 'natural'} settingId="erosion.erosionPreset"
        options={Object.entries(EROSION_PRESETS).map(([key, p]) => ({ value: key, label: p.label }))}
        onChange={(v) => ctx.onErosionPreset(v)} info="Erosion style. Editing any slider switches to Custom." />
      <SelectRow label="Quality" value={params.erosionQuality ?? 'balanced'} settingId="erosion.erosionQuality"
        options={Object.entries(EROSION_QUALITY).map(([key, q]) => ({ value: key, label: `${q.label} (${q.res}²)` }))}
        onChange={(v) => onParam('erosionQuality', v)} info="Grid resolution of the bake. Higher = finer channels but slower." />

      {EROSION_MAIN.map((def) => (
        <SliderCtl key={def.key} def={def} value={params[def.key]} onChange={(v) => setKnob(def.key, v)} settingId={`erosion.${def.key}`} />
      ))}

      <ControlSection id="erosion-advanced" title="Advanced" defaultOpen={false} forceOpen={advTarget} settingId="erosion.section.advanced">
        {EROSION_ADVANCED.map((def) => (
          <SliderCtl key={def.key} def={def} value={params[def.key]} onChange={(v) => setKnob(def.key, v)} settingId={`erosion.${def.key}`} />
        ))}
      </ControlSection>

      <p className="section-hint">Erosion also produces flow / rock / sediment / slope masks used by texturing &amp; props (wiring in progress). Exports already include the eroded terrain. Bake / reset can be reverted with Ctrl+Z.</p>
    </>
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
        settingsTarget={ctx.settingsTarget}
      />
    </SidePanel>
  );
}

const PROP_SLIDERS = {
  propsDensity: { label: 'Density', min: 0, max: 2, step: 0.05, digits: 2 },
  propsGrass: { label: 'Grass Scale', min: 0.05, max: 2, step: 0.05, digits: 2 },
  propsRocks: { label: 'Rock Mix', min: 0, max: 2, step: 0.05, digits: 2 },
  propsRockScale: { label: 'Rock Scale', min: 0.05, max: 2.5, step: 0.05, digits: 2 },
  propsWind: { label: 'Wind', min: 0, max: 1.5, step: 0.05, digits: 2 },
  propsWindSpeed: { label: 'Animation Speed', min: 0, max: 4, step: 0.05, digits: 2 },
  propsGust: { label: 'Gust Motion', min: 0, max: 1.5, step: 0.05, digits: 2 },
  propsFlowers: { label: 'Flower Mix', min: 0, max: 1, step: 0.01, digits: 2 },
  propsCullDistance: { label: 'Cull Distance', min: 120, max: 1800, step: 20, digits: 0, unit: ' u' },
  propsLodDistance: { label: 'LOD Distance', min: 60, max: 900, step: 10, digits: 0, unit: ' u' },
};

function PropsPanel({ ctx }) {
  const { params, onParam, worldMode } = ctx;
  const enabled = !!params.propsEnabled;
  return (
    <SidePanel title="Props" description="Procedural grass, flowers and rocks." onClose={ctx.onClose}>
      <ToggleRow label="Procedural Props" value={enabled} onChange={(v) => onParam('propsEnabled', v)}
        info="Scatter lightweight procedural grass patches, flowers and terrain-matched rocks in Tile, Infinite World, and Planet modes." />
      {enabled && (
        <>
          <ControlSection id="props-distribution" title="Distribution" defaultOpen settingId="props.section.distribution">
            <SliderCtl def={PROP_SLIDERS.propsDensity} value={params.propsDensity} onChange={(v) => onParam('propsDensity', v)} />
            <SliderCtl def={PROP_SLIDERS.propsFlowers} value={params.propsFlowers} onChange={(v) => onParam('propsFlowers', v)} />
            <SliderCtl def={PROP_SLIDERS.propsRocks} value={params.propsRocks ?? 0.8} onChange={(v) => onParam('propsRocks', v)} />
          </ControlSection>

          <ControlSection id="props-look" title="Look" defaultOpen settingId="props.section.look">
            <SliderCtl def={PROP_SLIDERS.propsGrass} value={params.propsGrass} onChange={(v) => onParam('propsGrass', v)} />
            <SliderCtl def={PROP_SLIDERS.propsRockScale} value={params.propsRockScale ?? 0.65} onChange={(v) => onParam('propsRockScale', v)} />
            <SliderCtl def={PROP_SLIDERS.propsWind} value={params.propsWind ?? 0.6} onChange={(v) => onParam('propsWind', v)} />
            <SliderCtl def={PROP_SLIDERS.propsWindSpeed} value={params.propsWindSpeed ?? 1.6} onChange={(v) => onParam('propsWindSpeed', v)} />
            <SliderCtl def={PROP_SLIDERS.propsGust} value={params.propsGust ?? 0.45} onChange={(v) => onParam('propsGust', v)} />
          </ControlSection>

          <ControlSection id="props-performance" title="Performance" defaultOpen settingId="props.section.performance">
            <SliderCtl def={PROP_SLIDERS.propsCullDistance} value={params.propsCullDistance} onChange={(v) => onParam('propsCullDistance', v)} />
            <SliderCtl def={PROP_SLIDERS.propsLodDistance} value={params.propsLodDistance} onChange={(v) => onParam('propsLodDistance', v)} />
            <p className="section-hint">
              {worldMode === 'studio'
                ? 'Studio also reads the props mask painted in Paint Mode.'
                : 'This mode uses deterministic procedural scattering from the current seed.'}
            </p>
          </ControlSection>
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
        settingsTarget={ctx.settingsTarget}
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

      <ControlSection id="skybox-time" title="Time of Day" defaultOpen settingId="skybox.section.time">
        <TimeOfDayControl timeOfDay={ctx.timeOfDay} onTimeOfDay={ctx.onTimeOfDay} settingId="skybox.timeOfDay" />
        <p className="section-hint">Drives the sky colours, sun position and atmosphere. Shared across the Tile view and the Infinite World.</p>
      </ControlSection>

      {enabled && (
        <ControlSection id="skybox-appearance" title="Appearance" defaultOpen settingId="skybox.section.appearance">
          <SliderCtl def={SKYBOX_SLIDERS.skyboxBrightness} value={params.skyboxBrightness ?? 1}
            onChange={(v) => onParam('skyboxBrightness', v)} settingId="skybox.skyboxBrightness" />
          <SliderCtl def={SKYBOX_SLIDERS.skyboxHaze} value={params.skyboxHaze ?? 0.55}
            onChange={(v) => onParam('skyboxHaze', v)} settingId="skybox.skyboxHaze" />
          <ToggleRow label="Night Stars" value={params.skyboxStars !== false}
            onChange={(v) => onParam('skyboxStars', v)}
            settingId="skybox.skyboxStars"
            info="Show the procedural star field when the sun is below the horizon." />
        </ControlSection>
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
        onParam={ctx.onParam} onTuning={ctx.onStyleTuning} settingsTarget={ctx.settingsTarget} />
      <PanelResetButton label="Reset Lighting Settings" onClick={() => ctx.onResetPanel?.('lighting')} settingId="lighting.reset" />
    </SidePanel>
  );
}

function PerformancePanel({ ctx }) {
  return (
    <SidePanel title="Performance" description="Quality, LOD and budgets." onClose={ctx.onClose}>
      <PerformanceStats stats={ctx.stats} gpu={ctx.gpu} />
      <PerfSettings perf={ctx.perf} rendererInfo={ctx.rendererInfo} onPerfPreset={ctx.onPerfPreset}
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
  const detailDebugOptions = [
    { value: 'off', label: 'Off' },
    { value: 'slope', label: 'Slope Mask' },
    { value: 'rock', label: 'Rock Mask' },
    { value: 'shoreline', label: 'Shoreline Mask' },
    { value: 'detailFade', label: 'Close Detail Fade' },
    { value: 'detail', label: 'Detail Noise' },
    { value: 'albedo', label: 'Final Albedo' },
    { value: 'normal', label: 'Final Normal' },
  ];

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
          info="Overlay borders along chunk boundaries. Lines turn green over merged chunk groups and magenta over the macro proxy."
        />
      )}
      <ToggleRow
        label="Show Chunk Merging"
        value={!!ctx.debugFlags?.mergeDebug}
        onChange={(v) => ctx.onDebugFlag?.('mergeDebug', v)}
        info="Tint folded terrain by merge level (green = small 2×2 fold → magenta = whole region). Works in Tile, Infinite and Planet modes. Watch blocks colour in as terrain folds at distance."
        settingId="debug.mergeDebug"
      />
      <ToggleRow
        label="Biome Debug"
        value={params.biomeDebug}
        onChange={(v) => onParam('biomeDebug', v)}
        info="Color-code biomes directly on the terrain surface for inspection."
      />
      <SelectRow
        label="Terrain Material Debug"
        value={ctx.debugFlags?.terrainDetailDebug ?? 'off'}
        options={detailDebugOptions}
        onChange={(v) => ctx.onDebugFlag?.('terrainDetailDebug', v)}
        info="Inspect close-detail masks, albedo, and normals generated by the terrain material."
        settingId="debug.terrainDetailDebug"
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
    exportTileMode: 'merged',
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setOpt((p) => ({ ...p, [k]: v }));
  // Turning on any water mask auto-enables the water plane (overridable: the
  // user can still switch the plane back off afterwards).
  const setMask = (k, v) => setOpt((p) => ({ ...p, [k]: v, ...(v && !p.exportWater ? { exportWater: true } : {}) }));
  const showTex = opt.bakeColor || opt.bakeNormal || opt.exportHeightmap;
  const multiTile = ctx.worldMode === 'studio' && (ctx.tiles?.length ?? 1) > 1;
  const circleTiles = ctx.tileAssemblyShape === 'circle';

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

      {multiTile && !circleTiles && (
        <ControlSection id="export-tile-assembly" title="Tile Assembly" defaultOpen settingId="export.section.tileAssembly">
          <SelectRow
            label="Tile Export"
            value={opt.exportTileMode}
            options={[
              { value: 'merged', label: 'One terrain (merged)' },
              { value: 'separate', label: 'Separate tiles' },
            ]}
            onChange={(v) => set('exportTileMode', v)}
          />
          <div className="settings-hint">
            Merged = one continuous landscape. Separate = each tile as its own
            named object with its own walls.
          </div>
        </ControlSection>
      )}

      <ControlSection id="export-format" title="Format & Resolution" defaultOpen settingId="export.section.format">
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
      </ControlSection>

      <ControlSection id="export-textures" title="Texture Baking" defaultOpen settingId="export.section.textures">
        <ToggleRow label="Bake Color Texture" value={opt.bakeColor} onChange={(v) => set('bakeColor', v)} />
        {opt.bakeColor && (
          <ToggleRow label="Bake Lighting into Color" value={opt.bakeLighting} onChange={(v) => set('bakeLighting', v)} />
        )}
        <ToggleRow label="Bake Normal Map" value={opt.bakeNormal} onChange={(v) => set('bakeNormal', v)} />
        {showTex && (
          <SelectRow label="Texture Size" value={opt.texRes} options={TEX_OPTIONS} onChange={(v) => set('texRes', v)} />
        )}
      </ControlSection>

      <ControlSection id="export-assets" title="Additional Assets" defaultOpen={false} settingId="export.section.assets">
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
      </ControlSection>

      <ControlSection id="export-water-maps" title="Water Maps" defaultOpen={false} settingId="export.section.waterMaps">
        <ToggleRow label="Export Water Mask" value={opt.exportWaterMask} onChange={(v) => setMask('exportWaterMask', v)} />
        <ToggleRow label="Export Depth Map" value={opt.exportDepthMap} onChange={(v) => setMask('exportDepthMap', v)} />
        <ToggleRow label="Export Shoreline Mask" value={opt.exportShorelineMask} onChange={(v) => setMask('exportShorelineMask', v)} />
        <ToggleRow label="Export Foam Mask" value={opt.exportFoamMask} onChange={(v) => setMask('exportFoamMask', v)} />
        <ToggleRow label="Include Water Material Metadata" value={opt.exportWaterMetadata} onChange={(v) => set('exportWaterMetadata', v)} />
        <ToggleRow label="Export Preset (JSON)" value={opt.exportPreset} onChange={(v) => set('exportPreset', v)} />
      </ControlSection>
    </SidePanel>
  );
}

// --------------------------------------------------------------- tiles panel
function TilesContent({ ctx }) {
  const tiles = ctx.tiles ?? [{ cx: 0, cz: 0 }];
  const grid = ctx.tileGridSize ?? 5;
  const extent = ctx.tileGridExtent ?? 2;
  const gridCells = grid * grid;
  const shape = ctx.tileAssemblyShape ?? 'square';
  const diskOuter = extent + 0.5;
  const diskMaxCells = Array.from({ length: grid }, (_, ix) => ix - extent)
    .flatMap((cx) => Array.from({ length: grid }, (_, iz) => ({ cx, cz: iz - extent })))
    .filter(({ cx, cz }) => Math.hypot(Math.max(Math.abs(cx) - 0.5, 0), Math.max(Math.abs(cz) - 0.5, 0)) < diskOuter - 1e-6)
    .length;
  const maxCells = shape === 'circle' ? diskMaxCells : gridCells;
  const atGridEdge = tiles.length >= maxCells;
  return (
    <ControlSection id="inspector-tiles" title="Tiles" defaultOpen settingId="world.section.tiles" icon={PANEL_ICONS.tiles}>
      <ControlSection id="inspector-tiles-assembly" title="Assembly" nested defaultOpen settingId="world.section.tilesAssembly">
        <div className="settings-hint" style={{ marginBottom: 8 }}>
          {shape === 'square'
            ? `Hover near a board edge and click the highlighted square to add a tile. Placement is limited to a ${grid}×${grid} grid centred on the origin.`
            : (ctx.diskRadiusCells < extent
              ? 'Hover around the circular edge and click the highlighted ring to expand the disk.'
              : 'The circular terrain has reached its maximum radius.')}
          {' '}Tiles share the same noise field and export together.
        </div>
        <SelectRow label="Shape" value={shape}
          options={[{ value: 'square', label: 'Square' }, { value: 'circle', label: 'Circle' }]}
          onChange={ctx.onTileAssemblyShape} settingId="world.tileAssemblyShape"
          info="Square supports hover-to-add tiles. Circle crops the current square chunk assembly to a disk." />
        <div className="kv-row"><span>Tiles</span><span>{tiles.length} / {maxCells}</span></div>
        {shape === 'circle' && <div className="kv-row"><span>Disk radius</span><span>{(ctx.diskRadiusCells ?? 0).toFixed(2)} cells</span></div>}
        {atGridEdge && (
          <div className="settings-hint">All {maxCells} available cells are occupied.</div>
        )}
      </ControlSection>

      {shape === 'square' && tiles.length > 1 && (
        <ControlSection id="inspector-tiles-remove" title="Remove a Tile" nested defaultOpen={false} settingId="world.section.tilesRemove">
          <div className="tile-chip-grid">
            {tiles.map((t) => (
              <button
                key={`${t.cx},${t.cz}`}
                type="button"
                className="action-btn"
                title={`Remove tile (${t.cx}, ${t.cz})`}
                onClick={() => ctx.onRemoveTile?.(t.cx, t.cz)}
              >
                {t.cx === 0 && t.cz === 0 ? 'origin' : `${t.cx}, ${t.cz}`} ✕
              </button>
            ))}
          </div>
        </ControlSection>
      )}
    </ControlSection>
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
  water: WaterPanel, props: PropsPanel, clouds: CloudsPanel, skybox: SkyboxPanel, lighting: LightingPanel, export: ExportPanel,
  performance: PerformancePanel, debug: DebugPanel,
};

export function renderPanel(id, ctx) {
  const Comp = COMPONENTS[id];
  return Comp ? <Comp ctx={ctx} /> : null;
}
