import ControlSection from './ControlSection.jsx';
import { SliderCtl } from '../controls.jsx';
import { colorToHex, parseColor } from '../../engine/style/ColorPalette.js';

const SUN_SLIDERS = [
  { key: 'sunAzimuth', label: 'Sun Azimuth', min: 0, max: 360, step: 1, unit: '°' },
  { key: 'sunElevation', label: 'Sun Elevation', min: 8, max: 85, step: 1, unit: '°' },
];

const FOG_SLIDER = {
  key: 'fogDensity', label: 'Fog Density', min: 0, max: 2, step: 0.05, digits: 2,
};

const SUN_INTENSITY = {
  key: 'sunIntensity', label: 'Sun Intensity', min: 0.2, max: 3, step: 0.05, digits: 2,
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
        <label>Sun Color</label>
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
