import { translateText, useLanguage } from '../../i18n/LanguageContext.jsx';
import React from 'react';
import { Dices, Focus, Save, Trash2 } from 'lucide-react';
import SidePanel from './SidePanel.jsx';
import { SliderCtl, SelectRow, ToggleRow } from '../controls.jsx';
import CollapsibleGroup from '../ui/CollapsibleGroup.jsx';
import {
  MINI_CUT_STYLES,
  MINI_PROCEDURAL_PRESETS,
  MINI_PROP_SCALE_LIMITS,
  MINI_QUALITY_PROFILES,
  MINI_RECIPES,
  describeMiniTerrain,
} from '../../engine/mini/MiniTerrainSettings.js';

// Mini Terrain panel: the composed scene comes first (preset, seed,
// regenerate), then a handful of meaningful controls. Advanced water, cloud,
// props and lighting settings stay in their own panels — nothing is
// duplicated here.

const RELIEF = { label: 'Relief', min: 0.4, max: 1.6, step: 0.01, digits: 2, info: 'Height of the composed silhouette. Rebakes the relief only.' };
const WATER = { label: 'Water level', min: 0, max: 1, step: 0.01, digits: 2, info: 'Moves the water, never the terrain.' };
const VEGETATION = { label: 'Vegetation', min: 0, max: 1, step: 0.01, digits: 2, info: 'Tree and plant density. Never changes the relief.' };
const PROP_SIZE = {
  label: 'Props size', min: MINI_PROP_SCALE_LIMITS.min, max: MINI_PROP_SCALE_LIMITS.max, step: 0.05, digits: 2, unit: '×',
  info: 'Size of trees, rocks and grass on the diorama. Rebuilds the props only, never the relief.',
};
const CLOUD_SPREAD = { label: 'Clouds spread', min: 10, max: 200, step: 1, digits: 1, unit: '%', info: 'Width of the cloud generation zone relative to the terrain. 100% matches the terrain width; lower values keep clouds closer to the center.' };
const CLOUDS = { label: 'Clouds', min: 0, max: 1, step: 0.01, digits: 2, info: 'A few small formations sized to the diorama. 0 disables them.' };
const WATER_EDGES = { label: 'Water Edges', min: 0, max: 2, step: 0.05, digits: 2, info: 'Brightness of the water block outline. 0 hides the edge highlight.' };
const WATER_BEVEL = { label: 'Water Bevel', min: 0, max: 10, step: 0.25, digits: 2, unit: '%', info: 'Size of the water corner chamfer or rounding. Percentage of the footprint width; 0 keeps square corners.' };
const TERRAIN_BEVEL = { ...WATER_BEVEL, label: 'Terrain Bevel', info: 'Size of the terrain corner chamfer or rounding. Percentage of the footprint width; 0 keeps square corners.' };

const RECIPE_OPTIONS = Object.values(MINI_RECIPES).map((r) => ({ value: r.id, label: r.labelEn }));
const QUALITY_OPTIONS = Object.values(MINI_QUALITY_PROFILES).map((q) => ({
  value: q.id,
  label: `${q.label} · ${q.segments}×${q.segments}`,
}));
const CLOUD_SHAPE_OPTIONS = [{ value: 'circle', label: 'Circle' }, { value: 'square', label: 'Square' }];
const SHAPE_OPTIONS = [{ value: 'square', label: 'Square' }, { value: 'circle', label: 'Circle' }, { value: 'hexagon', label: 'Hexagon' }];
const CUT_OPTIONS =Object.values(MINI_CUT_STYLES).map((c) => ({ value: c.id, label: c.label }));
const BASE_OPTIONS = MINI_PROCEDURAL_PRESETS.map((p) => ({ value: p.id, label: p.label }));

export default function MiniTerrainPanel({ ctx }) {
  useLanguage();
  const mini = ctx.miniTerrain;
  if (!mini) {
    return (
      <SidePanel title={translateText('Mini Terrain')} description={translateText('Diorama presentation.')} onClose={ctx.onClose}>
        <p className="section-hint">{translateText('This project is not a Mini Terrain.')}</p>
      </SidePanel>
    );
  }
  const set = (patch) => ctx.onMiniTerrain?.(patch);
  const info = describeMiniTerrain(mini);
  const views = mini.camera?.views ?? [];

  return (
    <SidePanel
      title={translateText('Mini Terrain')}
      description={translateText('A composed diorama: one footprint, one seed, a cut-away base.')}
      onClose={ctx.onClose}
    >
      <SelectRow
        label="Preset"
        value={mini.recipe}
        options={RECIPE_OPTIONS}
        onChange={(recipe) => set({ recipe })}
        settingId="mini.recipe"
        info="Procedural uses a regular terrain preset; composed scenes add a dominant silhouette. Changing it replaces relief, palette and water look."
      />
      {mini.recipe === 'procedural' && (
        <SelectRow
          label="Base terrain"
          value={mini.preset}
          options={BASE_OPTIONS}
          onChange={(preset) => set({ preset })}
          settingId="mini.preset"
          info="Any procedural preset, scaled to the diorama. Noise Layers and Terrain panels keep working as usual."
        />
      )}
      <div className="row" data-setting-id="mini.seed">
        <div className="label-with-icon"><span className="setting-label">{translateText('Seed')}</span></div>
        <input
          className="ctl-val mini-seed-input"
          type="text"
          inputMode="numeric"
          defaultValue={mini.seed}
          key={mini.seed}
          onBlur={(e) => {
            const v = Number.parseInt(e.target.value, 10);
            if (Number.isFinite(v) && (v >>> 0) !== mini.seed) set({ seed: v >>> 0 });
            else e.target.value = String(mini.seed);
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          aria-label={translateText('Seed')}
        />
      </div>
      <div className="mini-actions">
        <button type="button" className="action-btn primary" onClick={() => ctx.onMiniRegenerate?.()} data-setting-id="mini.regenerate">
          <Dices size={14} aria-hidden /> {translateText('Regenerate')}
        </button>
        <button type="button" className="action-btn" onClick={() => ctx.onMiniFrame?.()} data-setting-id="mini.frame">
          <Focus size={14} aria-hidden /> {translateText('Recenter')}
        </button>
      </div>
      <p className="section-hint">
        {translateText('Regenerate replaces the composition, detail noise and scattered props. Amounts, quality, paint layers and saved views are kept.')}
      </p>

      <SliderCtl def={RELIEF} value={mini.relief} onChange={(relief) => set({ relief })} settingId="mini.relief" />
      <SliderCtl def={WATER} value={mini.waterLevel} onChange={(waterLevel) => set({ waterLevel })} settingId="mini.waterLevel" />
      <SliderCtl def={VEGETATION} value={mini.vegetation} onChange={(vegetation) => set({ vegetation })} settingId="mini.vegetation" />
      <SliderCtl def={PROP_SIZE} value={mini.propScale ?? 1} onChange={(propScale) => set({ propScale })} settingId="mini.propScale" />
      <SliderCtl def={CLOUDS} value={mini.clouds} onChange={(clouds) => set({ clouds })} settingId="mini.clouds" />
      <SliderCtl def={CLOUD_SPREAD} value={mini.cloudSpread ?? 142.6} onChange={(cloudSpread) => set({ cloudSpread })} settingId="mini.cloudSpread" />
      <SelectRow label="Clouds shape" value={mini.cloudShape ?? 'circle'} options={CLOUD_SHAPE_OPTIONS} onChange={(cloudShape) => set({ cloudShape })} settingId="mini.cloudShape"
        info="Outline of the cloud generation zone: a circle, or a square aligned with the terrain edges." />
      <div className="mini-actions">
        <button type="button" className="action-btn" onClick={() => set({ cloudSpread: 100 })} data-setting-id="mini.matchCloudsToTerrain">
          <Focus size={14} aria-hidden /> {translateText('Match to terrain')}
        </button>
      </div>

      <CollapsibleGroup title="Base & presentation" defaultOpen settingId="mini.base">
        <SelectRow label="Cut style" value={mini.cutStyle} options={CUT_OPTIONS} onChange={(cutStyle) => set({ cutStyle })} settingId="mini.cutStyle" />
        <SelectRow label="Shape" value={mini.shape ?? 'square'} options={SHAPE_OPTIONS} onChange={(shape) => set({ shape })} settingId="mini.shape"
          info="Outline of the diorama: square, circle or hexagon. Terrain, walls, water and socle follow." />
        <SliderCtl def={WATER_EDGES} value={mini.waterEdges} onChange={(waterEdges) => set({ waterEdges })} settingId="mini.waterEdges" />
        {(mini.shape ?? 'square') === 'square' && <>
          <ToggleRow label="Sync Bevels" value={mini.bevelSync} onChange={(bevelSync) => set({ bevelSync })} settingId="mini.bevelSync"
            info="Link the water and terrain corner sizes. Enabling sync uses the current Water Bevel value." />
          <SelectRow label="Bevel Style" value={mini.bevelStyle} options={[{ value: 'chamfer', label: 'Chamfer' }, { value: 'rounded', label: 'Rounded' }]}
            onChange={(bevelStyle) => set({ bevelStyle })} settingId="mini.bevelStyle" />
          <SliderCtl def={WATER_BEVEL} value={mini.waterBevel} onChange={(waterBevel) => set({ waterBevel })} settingId="mini.waterBevel" />
          <SliderCtl def={TERRAIN_BEVEL} value={mini.terrainBevel} onChange={(terrainBevel) => set({ terrainBevel })} settingId="mini.terrainBevel" />
        </>}
        <ToggleRow label="Socle" value={mini.socle} onChange={(socle) => set({ socle })} settingId="mini.socle" />
      </CollapsibleGroup>

      <CollapsibleGroup title="Quality" settingId="mini.qualityGroup">
        <SelectRow
          label="Terrain resolution"
          value={mini.quality}
          options={QUALITY_OPTIONS}
          onChange={(quality) => set({ quality })}
          settingId="mini.quality"
          info="Requested surface resolution and water backend. The composition and seed never change with quality."
        />
        {info && (
          <p className="section-hint">
            {translateText('Surface')}: {info.triangles.toLocaleString()} {translateText('triangles')} · {translateText('footprint')} {info.width}
          </p>
        )}
      </CollapsibleGroup>

      <CollapsibleGroup title="Saved views" settingId="mini.views">
        <div className="mini-actions">
          <button type="button" className="action-btn" onClick={() => ctx.onMiniSaveView?.()} disabled={views.length >= 8}>
            <Save size={14} aria-hidden /> {translateText('Save current view')}
          </button>
        </div>
        {views.length === 0 && <p className="section-hint">{translateText('No saved view yet.')}</p>}
        <ul className="mini-views">
          {views.map((view, index) => (
            <li key={`${view.name}-${index}`}>
              <button type="button" className="mini-view-go" onClick={() => ctx.onMiniGoToView?.(index)}>{view.name}</button>
              <button type="button" className="icon-btn danger" onClick={() => ctx.onMiniRemoveView?.(index)} aria-label={translateText('Remove view')}>
                <Trash2 size={13} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </CollapsibleGroup>
    </SidePanel>
  );
}
