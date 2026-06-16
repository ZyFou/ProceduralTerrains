import ControlSection from './ControlSection.jsx';
import { SliderCtl, ToggleRow, SelectRow, ColorInput } from '../controls.jsx';
import { colorToHex, parseColor } from '../../engine/style/ColorPalette.js';
import { CLOUD_DEFAULT_PARAMS, CLOUD_NOISE_VARIANTS } from '../../engine/sky/CloudSettings.js';

// Slider definitions grouped into labelled subsections. Keys map 1:1 to the
// cloud* params in DEFAULT_PARAMS.
const SHAPE_SLIDERS = [
  { key: 'cloudCoverage', label: 'Coverage', min: 0, max: 1, step: 0.01, digits: 2, info: 'Fraction of the sky covered by clouds.' },
  { key: 'cloudDensity', label: 'Density', min: 0.1, max: 3, step: 0.05, digits: 2, info: 'Overall opacity / optical thickness of the clouds.' },
  { key: 'cloudSoftness', label: 'Softness', min: 0.01, max: 0.6, step: 0.01, digits: 2, info: 'Softness of the cloud edges where coverage cuts in.' },
];

const SHELL_SLIDERS = [
  { key: 'cloudAltitude', label: 'Altitude', min: 0, max: 1500, step: 5, info: 'Height of the cloud layer base. In studio this is an absolute height (0 = ground level), so clouds can sit right at the surface.' },
  { key: 'cloudThickness', label: 'Thickness', min: 80, max: 2500, step: 10, info: 'Vertical thickness of the cloud layer.' },
];

const NOISE_SLIDERS = [
  { key: 'cloudScale', label: 'Cloud Scale', min: 0.3, max: 8, step: 0.1, digits: 1, info: 'Size of the large cloud shapes (lower = bigger).' },
  { key: 'cloudDetailScale', label: 'Detail Scale', min: 2, max: 24, step: 0.5, digits: 1, info: 'Frequency of the mid-scale billows.' },
  { key: 'cloudDetailStrength', label: 'Detail Strength', min: 0, max: 1, step: 0.02, digits: 2, info: 'How strongly detail noise modulates the shapes.' },
  { key: 'cloudErosionScale', label: 'Erosion Scale', min: 4, max: 40, step: 0.5, digits: 1, info: 'Frequency of the worley erosion that carves wispy edges.' },
  { key: 'cloudErosionStrength', label: 'Erosion Strength', min: 0, max: 1, step: 0.02, digits: 2, info: 'How aggressively erosion eats into the clouds.' },
];

const MOTION_SLIDERS = [
  { key: 'cloudWindDir', label: 'Wind Direction', min: 0, max: 360, step: 1, unit: '°', info: 'Heading the cloud field drifts toward.' },
  { key: 'cloudWindSpeed', label: 'Wind Speed', min: 0, max: 4, step: 0.05, digits: 2, info: 'Speed of the cloud drift.' },
  { key: 'cloudRotationSpeed', label: 'Rotation', min: 0, max: 3, step: 0.05, digits: 2, info: 'Slow rotation of the cloud field around the planet axis.' },
];

const LIGHT_SLIDERS = [
  { key: 'cloudLightAbsorption', label: 'Light Absorption', min: 0.1, max: 3, step: 0.05, digits: 2, info: 'How much the clouds absorb sunlight (contrast of shading).' },
  { key: 'cloudShadowStrength', label: 'Shadow Strength', min: 0, max: 1, step: 0.02, digits: 2, info: 'Darkness of self-shadowed cloud regions.' },
  { key: 'cloudScatteringStrength', label: 'Scattering', min: 0, max: 2, step: 0.05, digits: 2, info: 'Brightness of light scattered toward the camera.' },
];

const QUALITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'ultra', label: 'Ultra' },
];

const FALLBACK_OPTIONS = [
  { value: 'none', label: 'Full' },
  { value: 'lite', label: 'Lite (weak GPU)' },
  { value: 'off', label: 'Off' },
];

const COLOR_FIELDS = [
  { key: 'cloudColor', label: 'Cloud Color', info: 'Base color of sunlit clouds.', def: [1, 1, 1] },
  { key: 'cloudShadowColor', label: 'Shadow Color', info: 'Color of shadowed / underside cloud regions.', def: [0.42, 0.47, 0.6] },
];

function val(params, key) {
  return params[key] ?? CLOUD_DEFAULT_PARAMS[key];
}

export default function CloudPanel({ params, onParam, worldMode, id = 'inspector-clouds', defaultOpen = false }) {
  const enabled = !!params.cloudsEnabled;
  const distInfo = worldMode === 'planet'
    ? 'Hide clouds when the camera is farther than this many planet radii.'
    : 'Hide clouds when the camera is farther than this many board widths.';

  return (
    <ControlSection
      id={id}
      title="CLOUDS"
      defaultOpen={defaultOpen}
      statusDot={enabled ? 'active' : null}
      icon={(
        <svg viewBox="0 0 16 16" fill="none">
          <path d="M4 11.5a2.5 2.5 0 0 1 .4-4.95A3.5 3.5 0 0 1 11.3 6.6a2.5 2.5 0 0 1-.3 4.9H4z" stroke="currentColor" strokeWidth="1.1" />
        </svg>
      )}
    >
      <ToggleRow
        label="Enable Clouds"
        value={enabled}
        onChange={(v) => onParam('cloudsEnabled', v)}
        info="Show the volumetric cloud shell around the planet (planet mode)."
        icon={(
          <svg viewBox="0 0 16 16" fill="none">
            <path d="M4 11.5a2.5 2.5 0 0 1 .4-4.95A3.5 3.5 0 0 1 11.3 6.6a2.5 2.5 0 0 1-.3 4.9H4z" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        )}
      />

      {enabled && (
        <>
          <div className="subsection-label">Shape</div>
          {SHAPE_SLIDERS.map((def) => (
            <SliderCtl key={def.key} def={def} value={val(params, def.key)} onChange={(v) => onParam(def.key, v)} />
          ))}

          <div className="subsection-label">Shell</div>
          {SHELL_SLIDERS.map((def) => (
            <SliderCtl key={def.key} def={def} value={val(params, def.key)} onChange={(v) => onParam(def.key, v)} />
          ))}

          <div className="subsection-label">Noise</div>
          <SelectRow
            label="Noise Variant"
            value={val(params, 'cloudNoiseVariant')}
            options={CLOUD_NOISE_VARIANTS}
            onChange={(v) => onParam('cloudNoiseVariant', v)}
            info="Changes the cloud density field shape without changing raymarch quality."
          />
          {NOISE_SLIDERS.map((def) => (
            <SliderCtl key={def.key} def={def} value={val(params, def.key)} onChange={(v) => onParam(def.key, v)} />
          ))}

          <div className="subsection-label">Motion</div>
          {MOTION_SLIDERS.map((def) => (
            <SliderCtl key={def.key} def={def} value={val(params, def.key)} onChange={(v) => onParam(def.key, v)} />
          ))}

          <div className="subsection-label">Lighting</div>
          {LIGHT_SLIDERS.map((def) => (
            <SliderCtl key={def.key} def={def} value={val(params, def.key)} onChange={(v) => onParam(def.key, v)} />
          ))}
          {COLOR_FIELDS.map(({ key, label, info, def }) => (
            <div className="color-field" key={key}>
              <div className="label-with-icon" data-tooltip={info}>
                <span className="setting-label">{label}</span>
              </div>
              <ColorInput
                value={colorToHex(val(params, key) ?? def)}
                onChange={(v) => onParam(key, parseColor(v))}
              />
            </div>
          ))}
          <ToggleRow
            label="Self Shadowing"
            value={!!params.cloudSelfShadow}
            onChange={(v) => onParam('cloudSelfShadow', v)}
            info="Secondary sun-direction march for soft self-shadowing (costlier)."
          />

          <div className="subsection-label">Performance</div>
          <SelectRow
            label="Quality"
            value={params.cloudQuality}
            options={QUALITY_OPTIONS}
            onChange={(v) => onParam('cloudQuality', v)}
            info="Raymarch step count. Higher = smoother clouds, lower FPS."
          />
          <SelectRow
            label="Fallback Mode"
            value={params.cloudFallback}
            options={FALLBACK_OPTIONS}
            onChange={(v) => onParam('cloudFallback', v)}
            info="Safe modes for weaker devices: Lite caps steps and disables self-shadowing; Off hides clouds."
          />
          <SliderCtl
            def={{ key: 'cloudMaxDistance', label: 'Max Distance', min: 1.5, max: 12, step: 0.5, digits: 1, unit: '×', info: distInfo }}
            value={val(params, 'cloudMaxDistance')}
            onChange={(v) => onParam('cloudMaxDistance', v)}
          />
        </>
      )}
    </ControlSection>
  );
}
