import ControlSection from './ControlSection.jsx';
import { SliderCtl } from '../controls.jsx';
import { colorToHex, parseColor } from '../../engine/style/ColorPalette.js';

const SUN_SLIDERS = [
  {
    key: 'sunAzimuth',
    label: 'Sun Azimuth',
    min: 0,
    max: 360,
    step: 1,
    unit: '°',
    info: 'Angle of the sun around the horizon (0-360°)',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
        <path d="M8 2v6l3 3" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )
  },
  {
    key: 'sunElevation',
    label: 'Sun Elevation',
    min: 8,
    max: 85,
    step: 1,
    unit: '°',
    info: 'Angle of the sun above the horizon (8-85°)',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M2 13h12M8 13V3M5 6l3-3 3 3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    )
  },
];

const FOG_SLIDER = {
  key: 'fogDensity',
  label: 'Fog Density',
  min: 0,
  max: 2,
  step: 0.05,
  digits: 2,
  info: 'Density of the atmospheric dust and fog',
  icon: (
    <svg viewBox="0 0 16 16" fill="none">
      <path d="M3 10.5a2.5 2.5 0 0 1 2-4.4 3.5 3.5 0 0 1 6.8 1.1 2.5 2.5 0 0 1-.8 4.8H3z" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
};

const SUN_INTENSITY = {
  key: 'sunIntensity',
  label: 'Sun Intensity',
  min: 0.2,
  max: 3,
  step: 0.05,
  digits: 2,
  info: 'Brightness of the direct sunlight',
  icon: (
    <svg viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
};

export default function EnvironmentPanel({ params, planetStyle, onParam, onTuning }) {
  const style = planetStyle ?? {};

  return (
    <ControlSection
      id="inspector-environment"
      title="ENVIRONMENT"
      defaultOpen
      icon={(
        <svg viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.2" />
          <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" stroke="currentColor" strokeWidth="1.1" />
        </svg>
      )}
    >
      <div className="subsection-label">Sun</div>
      {SUN_SLIDERS.map((def) => (
        <SliderCtl
          key={def.key}
          def={def}
          value={params[def.key]}
          onChange={(v) => onParam(def.key, v)}
        />
      ))}
      <div className="color-field">
        <div className="label-with-icon" data-tooltip="Color tint of the direct sunlight">
          <span className="setting-icon">
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M8 2c-2.5 4-5 5-5 8a5 5 0 0 0 10 0c0-3-2.5-4-5-8z" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </span>
          <span className="setting-label">Sun Color</span>
          <span className="info-icon-trigger">
            <svg viewBox="0 0 16 16" fill="none" width="10" height="10" style={{ marginLeft: '4px' }}>
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
              <path d="M8 11V8M8 5.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
        </div>
        <input
          type="color"
          value={colorToHex(style.sunColor ?? [1.0, 0.94, 0.82])}
          onChange={(e) => onTuning('sunColor', parseColor(e.target.value))}
        />
      </div>
      <SliderCtl
        def={SUN_INTENSITY}
        value={style.sunIntensity ?? 1.25}
        onChange={(v) => onTuning('sunIntensity', v)}
      />

      <div className="subsection-label">Atmosphere</div>
      <SliderCtl
        def={FOG_SLIDER}
        value={params.fogDensity}
        onChange={(v) => onParam('fogDensity', v)}
      />
    </ControlSection>
  );
}
