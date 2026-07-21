import React, { useContext } from 'react';
import ControlSection from './ControlSection.jsx';
import { FlatPanelContext } from '../panels/PanelContext.js';
import { shouldForceSectionOpen } from '../panels/sectionUtils.js';
import { SliderCtl, ColorInput } from '../controls.jsx';
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

const ATMOSPHERE_COLORS = [
  {
    key: 'skyAmbient',
    label: 'Sky Ambient',
    info: 'Color of ambient scattered sky light reflecting onto the terrain',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M8 3a4 4 0 0 1 4 4H4a4 4 0 0 1 4-4zM2 10h12M4 13h8" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )
  },
  {
    key: 'groundBounce',
    label: 'Ground Bounce',
    info: 'Color of light bouncing from the ground back up into shadowed areas',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M2 13h12M4 4l4 6 4-6" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    )
  },
];

export default function EnvironmentPanel({ params, planetStyle, onParam, onTuning, settingsTarget }) {
  const flat = useContext(FlatPanelContext);
  const style = planetStyle ?? {};
  const target = settingsTarget?.panelId === 'lighting' ? settingsTarget : null;
  const forceSection = (sectionId, sectionLabel, prefixes = []) =>
    shouldForceSectionOpen(target, sectionId, { sectionLabel, childPrefixes: prefixes });

  const sections = (
    <>
      <ControlSection
        id="inspector-environment-sun"
        title="Sun"
        defaultOpen
        settingId="lighting.section.sun"
        forceOpen={forceSection('lighting.section.sun', 'Sun', ['lighting.sun'])}
      >
        {SUN_SLIDERS.map((def) => (
          <SliderCtl
            key={def.key}
            def={def}
            value={params[def.key]}
            onChange={(v) => onParam(def.key, v)}
            settingId={`lighting.${def.key}`}
          />
        ))}
        <div className="color-field" data-setting-id="lighting.sunColor">
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
          <ColorInput
            value={colorToHex(style.sunColor ?? [1.0, 0.94, 0.82])}
            onChange={(v) => onTuning('sunColor', parseColor(v))}
          />
        </div>
        <SliderCtl
          def={SUN_INTENSITY}
          value={style.sunIntensity ?? 1.25}
          onChange={(v) => onTuning('sunIntensity', v)}
          settingId="lighting.sunIntensity"
        />
      </ControlSection>

      <ControlSection
        id="inspector-environment-atmosphere"
        title="Atmosphere"
        defaultOpen
        settingId="lighting.section.atmosphere"
        forceOpen={forceSection('lighting.section.atmosphere', 'Atmosphere', ['lighting.fog', 'lighting.skyAmbient', 'lighting.groundBounce'])}
      >
        <SliderCtl
          def={FOG_SLIDER}
          value={params.fogDensity}
          onChange={(v) => onParam('fogDensity', v)}
          settingId="lighting.fogDensity"
        />
        {ATMOSPHERE_COLORS.map(({ key, label, icon, info }) => (
          <div className="color-field" key={key} data-setting-id={`lighting.${key}`}>
            <div className="label-with-icon" data-tooltip={info}>
              {icon && <span className="setting-icon">{icon}</span>}
              <span className="setting-label">{label}</span>
              {info && (
                <span className="info-icon-trigger">
                  <svg viewBox="0 0 16 16" fill="none" width="10" height="10" style={{ marginLeft: '4px' }}>
                    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M8 11V8M8 5.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </span>
              )}
            </div>
            <ColorInput
              value={colorToHex(style[key] ?? [0.5, 0.5, 0.5])}
              onChange={(v) => onTuning(key, parseColor(v))}
            />
          </div>
        ))}
      </ControlSection>
    </>
  );

  if (flat) return sections;

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
      {sections}
    </ControlSection>
  );
}
