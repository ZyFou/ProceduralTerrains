import React, { useEffect, useState } from 'react';
import { PanelTabs } from '../panels/SidePanel.jsx';
import PanelResetButton from './PanelResetButton.jsx';
import { SliderCtl, ToggleRow, ColorInput } from '../controls.jsx';
import { colorToHex, parseColor } from '../../engine/style/ColorPalette.js';
import { VISUAL_DEFAULT_PARAMS } from '../../engine/render/VisualSettings.js';
import { RENDER_SLIDERS } from '../panels/defs.jsx';

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

const CAMERA_SLIDERS = {
  pixelResolution: slider('visualsPixelResolution', 'Virtual Resolution', 120, 720, 8, { unit: 'p' }),
  ditheringStrength: slider('visualsDitheringStrength', 'Dithering Strength', 0, 1, 0.02, { digits: 2 }),
  ditheringLevels: slider('visualsDitheringLevels', 'Color Levels', 2, 32, 1),
  ditheringScale: slider('visualsDitheringScale', 'Pattern Scale', 1, 6, 1, { unit: ' px' }),
  crtStrength: slider('visualsCrtStrength', 'CRT Strength', 0, 1, 0.02, { digits: 2 }),
  crtLensBend: slider('visualsCrtLensBend', 'Lens Bend', 0, 1, 0.02, { digits: 2 }),
  crtLineWidth: slider('visualsCrtLineWidth', 'Scanline Width', 1, 6, 0.25, { digits: 2, unit: ' px' }),
  chromaticStrength: slider('visualsChromaticAberrationStrength', 'Chromatic Offset', 0, 8, 0.1, { digits: 1, unit: ' px' }),
};

const VISUALS_TABS = [
  { id: 'post', label: 'Post FX' },
  { id: 'sky', label: 'HDR Sky' },
  { id: 'terrain', label: 'Terrain Surface' },
  { id: 'shoreline', label: 'Shoreline' },
  { id: 'camera', label: 'Camera Shaders' },
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
  const { params, onParam, settingsTarget } = ctx;
  const tint = val(params, 'visualsAtmosphereTint');
  const [tab, setTab] = useState('post');

  useEffect(() => {
    const targetTab = settingsTarget?.panelId === 'visuals' ? settingsTarget?.tabId : null;
    if (targetTab && targetTab !== tab) setTab(targetTab);
  }, [settingsTarget, tab]);

  return (
    <>
      <PanelTabs active={tab} onChange={setTab} tabs={VISUALS_TABS} />

      {tab === 'post' && (
        <>
          <ToggleRow
            label="Post Processing"
            value={val(params, 'visualsPostEnabled') !== false}
            onChange={(v) => onParam('visualsPostEnabled', v)}
            settingId="visuals.visualsPostEnabled"
            info="Tile-mode color grading, bloom, vignette, and sun rays."
          />
          <SliderList items={POST_SLIDERS} params={params} onParam={onParam} />
        </>
      )}

      {tab === 'sky' && (
        <>
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
        </>
      )}

      {tab === 'terrain' && (
        <>
          <SliderList items={TERRAIN_SLIDERS} params={params} onParam={onParam} />
          {RENDER_SLIDERS.map((def) => (
            <SliderCtl key={def.key} def={def} value={params[def.key]} onChange={(v) => onParam(def.key, v)} settingId={`visuals.${def.key}`} />
          ))}
        </>
      )}

      {tab === 'shoreline' && (
        <SliderList items={SHORE_SLIDERS} params={params} onParam={onParam} />
      )}

      {tab === 'camera' && (
        <>
          <ToggleRow
            label="Pixelated"
            value={!!val(params, 'visualsPixelatedEnabled')}
            onChange={(v) => onParam('visualsPixelatedEnabled', v)}
            settingId="visuals.visualsPixelatedEnabled"
            info="Renders the camera through a low-resolution target with hard nearest-neighbor pixels."
          />
          <SliderCtl
            def={CAMERA_SLIDERS.pixelResolution}
            value={val(params, 'visualsPixelResolution')}
            onChange={(v) => onParam('visualsPixelResolution', Math.round(v))}
            settingId="visuals.visualsPixelResolution"
          />
          <ToggleRow
            label="Dithering"
            value={!!val(params, 'visualsDitheringEnabled')}
            onChange={(v) => onParam('visualsDitheringEnabled', v)}
            settingId="visuals.visualsDitheringEnabled"
            info="Applies visible ordered 4×4 dithering with adjustable color depth and pattern size."
          />
          <SliderCtl
            def={CAMERA_SLIDERS.ditheringStrength}
            value={val(params, 'visualsDitheringStrength')}
            onChange={(v) => onParam('visualsDitheringStrength', v)}
            settingId="visuals.visualsDitheringStrength"
          />
          <SliderCtl
            def={CAMERA_SLIDERS.ditheringLevels}
            value={val(params, 'visualsDitheringLevels')}
            onChange={(v) => onParam('visualsDitheringLevels', Math.round(v))}
            settingId="visuals.visualsDitheringLevels"
          />
          <SliderCtl
            def={CAMERA_SLIDERS.ditheringScale}
            value={val(params, 'visualsDitheringScale')}
            onChange={(v) => onParam('visualsDitheringScale', Math.round(v))}
            settingId="visuals.visualsDitheringScale"
          />
          <ToggleRow
            label="CRT"
            value={!!val(params, 'visualsCrtEnabled')}
            onChange={(v) => onParam('visualsCrtEnabled', v)}
            settingId="visuals.visualsCrtEnabled"
            info="Adds adjustable scanlines, RGB mask, lens curvature, analog noise, and edge falloff."
          />
          <SliderCtl
            def={CAMERA_SLIDERS.crtStrength}
            value={val(params, 'visualsCrtStrength')}
            onChange={(v) => onParam('visualsCrtStrength', v)}
            settingId="visuals.visualsCrtStrength"
          />
          <SliderCtl
            def={CAMERA_SLIDERS.crtLensBend}
            value={val(params, 'visualsCrtLensBend')}
            onChange={(v) => onParam('visualsCrtLensBend', v)}
            settingId="visuals.visualsCrtLensBend"
          />
          <SliderCtl
            def={CAMERA_SLIDERS.crtLineWidth}
            value={val(params, 'visualsCrtLineWidth')}
            onChange={(v) => onParam('visualsCrtLineWidth', v)}
            settingId="visuals.visualsCrtLineWidth"
          />
          <ToggleRow
            label="Chromatic Aberration"
            value={!!val(params, 'visualsChromaticAberrationEnabled')}
            onChange={(v) => onParam('visualsChromaticAberrationEnabled', v)}
            settingId="visuals.visualsChromaticAberrationEnabled"
            info="Separates red and blue channels toward the lens edges and combines with every other camera shader."
          />
          <SliderCtl
            def={CAMERA_SLIDERS.chromaticStrength}
            value={val(params, 'visualsChromaticAberrationStrength')}
            onChange={(v) => onParam('visualsChromaticAberrationStrength', v)}
            settingId="visuals.visualsChromaticAberrationStrength"
          />
        </>
      )}

      <PanelResetButton label="Reset Visual Settings" onClick={() => ctx.onResetPanel?.('visuals')} settingId="visuals.reset" />
    </>
  );
}
