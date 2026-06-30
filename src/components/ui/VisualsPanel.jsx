import ControlSection from './ControlSection.jsx';
import PanelResetButton from './PanelResetButton.jsx';
import { SliderCtl, ToggleRow, ColorInput } from '../controls.jsx';
import { colorToHex, parseColor } from '../../engine/style/ColorPalette.js';
import { VISUAL_DEFAULT_PARAMS } from '../../engine/render/VisualSettings.js';

const slider = (key, label, min, max, step, opts = {}) => ({ key, label, min, max, step, ...opts });

const POST_SLIDERS = [
  slider('visualsExposure', 'Exposure', 0.5, 1.8, 0.02, { digits: 2 }),
  slider('visualsContrast', 'Contrast', 0.75, 1.45, 0.02, { digits: 2 }),
  slider('visualsSaturation', 'Saturation', 0.4, 1.6, 0.02, { digits: 2 }),
  slider('visualsVignette', 'Vignette', 0, 0.65, 0.01, { digits: 2 }),
  slider('visualsBloomStrength', 'Bloom Strength', 0, 0.9, 0.02, { digits: 2 }),
  slider('visualsBloomThreshold', 'Bloom Threshold', 0.35, 1.2, 0.02, { digits: 2 }),
  slider('visualsSunRaysStrength', 'Sun Rays', 0, 0.8, 0.02, { digits: 2 }),
];

const SKY_SLIDERS = [
  slider('visualsSkyIntensity', 'HDR Sky Intensity', 0.4, 2.2, 0.02, { digits: 2 }),
  slider('visualsSunGlow', 'Sun Glow', 0, 2.2, 0.02, { digits: 2 }),
  slider('visualsHorizonGlow', 'Horizon Glow', 0, 1.4, 0.02, { digits: 2 }),
];

const TERRAIN_SLIDERS = [
  slider('visualsTerrainColorVariation', 'Color Variation', 0, 1, 0.02, { digits: 2 }),
  slider('visualsTerrainHeightDetail', 'Detail Height', 0, 1, 0.02, { digits: 2 }),
  slider('visualsWetShoreStrength', 'Wet Shore Strength', 0, 1.2, 0.02, { digits: 2 }),
  slider('visualsRockDetail', 'Rock Detail', 0, 1, 0.02, { digits: 2 }),
  slider('visualsSoilDetail', 'Soil Detail', 0, 1, 0.02, { digits: 2 }),
  slider('visualsSandDetail', 'Sand Detail', 0, 1, 0.02, { digits: 2 }),
];

const SHORE_SLIDERS = [
  slider('visualsFoamBreakup', 'Foam Breakup', 0, 1, 0.02, { digits: 2 }),
  slider('visualsWetSandRange', 'Wet Sand Range', 2, 48, 1, { unit: 'u' }),
  slider('visualsShallowWaterSoftness', 'Shallow Water Softness', 0, 1, 0.02, { digits: 2 }),
];

function val(params, key) {
  return params[key] ?? VISUAL_DEFAULT_PARAMS[key];
}

function SliderList({ items, params, onParam }) {
  return items.map((def) => (
    <SliderCtl
      key={def.key}
      def={def}
      value={val(params, def.key)}
      onChange={(v) => onParam(def.key, v)}
      settingId={`visuals.${def.key}`}
    />
  ));
}

export default function VisualsPanel({ ctx }) {
  const { params, onParam } = ctx;
  const tint = val(params, 'visualsAtmosphereTint');

  return (
    <>
      <ControlSection id="visuals-post" title="Post FX" defaultOpen settingId="visuals.section.post">
        <ToggleRow
          label="Post Processing"
          value={val(params, 'visualsPostEnabled') !== false}
          onChange={(v) => onParam('visualsPostEnabled', v)}
          settingId="visuals.visualsPostEnabled"
          info="Tile-mode color grading, bloom, vignette, and sun rays."
        />
        <SliderList items={POST_SLIDERS} params={params} onParam={onParam} />
      </ControlSection>

      <ControlSection id="visuals-hdr-sky" title="HDR Sky" defaultOpen settingId="visuals.section.sky">
        <SliderList items={SKY_SLIDERS} params={params} onParam={onParam} />
        <div className="color-field" data-setting-id="visuals.visualsAtmosphereTint">
          <div className="label-with-icon" data-tooltip="Tint applied to the procedural sky environment.">
            <span className="setting-label">Atmosphere Tint</span>
          </div>
          <ColorInput
            value={colorToHex(tint)}
            onChange={(v) => onParam('visualsAtmosphereTint', parseColor(v))}
          />
        </div>
      </ControlSection>

      <ControlSection id="visuals-terrain" title="Terrain Surface" defaultOpen settingId="visuals.section.terrain">
        <SliderList items={TERRAIN_SLIDERS} params={params} onParam={onParam} />
      </ControlSection>

      <ControlSection id="visuals-shoreline" title="Shoreline" defaultOpen={false} settingId="visuals.section.shoreline">
        <SliderList items={SHORE_SLIDERS} params={params} onParam={onParam} />
      </ControlSection>

      <PanelResetButton label="Reset Visual Settings" onClick={() => ctx.onResetPanel?.('visuals')} settingId="visuals.reset" />
    </>
  );
}
