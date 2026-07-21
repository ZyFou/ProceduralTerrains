import React, { useContext } from 'react';
import ControlSection from './ControlSection.jsx';
import { FlatPanelContext } from '../panels/PanelContext.js';
import { shouldForceSectionOpen } from '../panels/sectionUtils.js';
import { SliderCtl, ToggleRow, SelectRow, ColorInput } from '../controls.jsx';
import { colorToHex, parseColor } from '../../engine/style/ColorPalette.js';
import { CLOUD_DEFAULT_PARAMS, CLOUD_NOISE_VARIANTS } from '../../engine/sky/CloudSettings.js';

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
  { key: 'cloudEvolveSpeed', label: 'Evolve', min: 0, max: 4, step: 0.05, digits: 2, info: 'How fast clouds form, morph and dissipate in place (0 = static shapes that only drift).' },
];

const LIGHT_SLIDERS = [
  { key: 'cloudLightAbsorption', label: 'Light Absorption', min: 0.1, max: 3, step: 0.05, digits: 2, info: 'How much the clouds absorb sunlight (contrast of shading).' },
  { key: 'cloudShadowStrength', label: 'Shadow Strength', min: 0, max: 1, step: 0.02, digits: 2, info: 'Darkness of self-shadowed cloud regions.' },
  { key: 'cloudScatteringStrength', label: 'Scattering', min: 0, max: 2, step: 0.05, digits: 2, info: 'Brightness of light scattered toward the camera.' },
];

const RESOLUTION_OPTIONS = [
  { value: 'low', label: 'Low (12 steps)' },
  { value: 'medium', label: 'Medium (24 steps)' },
  { value: 'high', label: 'High (40 steps)' },
  { value: 'ultra', label: 'Ultra (72 steps)' },
  { value: 'custom', label: 'Custom' },
];

const FALLBACK_OPTIONS = [
  { value: 'none', label: 'Full' },
  { value: 'lite', label: 'Lite (weak GPU)' },
  { value: 'off', label: 'Off' },
];

const RENDER_SCALE_OPTIONS = [
  { value: '1', label: 'Full res' },
  { value: '0.5', label: 'Half res (denoise)' },
  { value: '0.25', label: 'Quarter res' },
];

const COLOR_FIELDS = [
  { key: 'cloudColor', label: 'Cloud Color', info: 'Base color of sunlit clouds.', def: [1, 1, 1] },
  { key: 'cloudShadowColor', label: 'Shadow Color', info: 'Color of shadowed / underside cloud regions.', def: [0.42, 0.47, 0.6] },
];

function val(params, key) {
  return params[key] ?? CLOUD_DEFAULT_PARAMS[key];
}

export default function CloudPanel({
  params,
  onParam,
  perf,
  onPerfSetting,
  worldMode,
  settingsTarget,
  id = 'inspector-clouds',
  defaultOpen = false,
}) {
  const flat = useContext(FlatPanelContext);
  const enabled = !!params.cloudsEnabled;
  const distInfo = worldMode === 'planet'
    ? 'Hide clouds when the camera is farther than this many planet radii.'
    : 'Hide clouds when the camera is farther than this many board widths.';
  const p = perf ?? {};
  const currentSteps = p.cloudSteps ?? 12;
  let resolutionName = 'custom';
  if (currentSteps === 8) resolutionName = 'low';
  else if (currentSteps === 12) resolutionName = 'medium';
  else if (currentSteps === 16) resolutionName = 'quality';
  else if (currentSteps === 24) resolutionName = 'high';
  else if (currentSteps === 48) resolutionName = 'ultra';

  const target = settingsTarget?.panelId === 'clouds' ? settingsTarget : null;
  const forceSection = (sectionId, sectionLabel, prefixes = []) =>
    shouldForceSectionOpen(target, sectionId, { sectionLabel, childPrefixes: prefixes });

  const handleResolutionChange = (v) => {
    if (v === 'low') onPerfSetting('cloudSteps', 8);
    else if (v === 'medium') onPerfSetting('cloudSteps', 12);
    else if (v === 'quality') onPerfSetting('cloudSteps', 16);
    else if (v === 'high') onPerfSetting('cloudSteps', 24);
    else if (v === 'ultra') onPerfSetting('cloudSteps', 48);
  };

  const content = (
    <>
      <ToggleRow
        label="Enable Clouds"
        value={enabled}
        onChange={(v) => onParam('cloudsEnabled', v)}
        info="Show the volumetric cloud shell around the planet (planet mode)."
        settingId="clouds.cloudsEnabled"
      />

      {enabled && (
        <>
          <ControlSection
            id={`${id}-shape`}
            title="Shape"
            defaultOpen
            settingId="clouds.section.shape"
            forceOpen={forceSection('clouds.section.shape', 'Shape', ['clouds.cloudCoverage', 'clouds.cloudDensity', 'clouds.cloudSoftness'])}
          >
            {SHAPE_SLIDERS.map((def) => (
              <SliderCtl key={def.key} def={def} value={val(params, def.key)} onChange={(v) => onParam(def.key, v)} settingId={`clouds.${def.key}`} />
            ))}
          </ControlSection>

          <ControlSection
            id={`${id}-shell`}
            title="Shell"
            defaultOpen={false}
            settingId="clouds.section.shell"
            forceOpen={forceSection('clouds.section.shell', 'Shell', ['clouds.cloudAltitude', 'clouds.cloudThickness'])}
          >
            {SHELL_SLIDERS.map((def) => (
              <SliderCtl key={def.key} def={def} value={val(params, def.key)} onChange={(v) => onParam(def.key, v)} settingId={`clouds.${def.key}`} />
            ))}
          </ControlSection>

          <ControlSection
            id={`${id}-noise`}
            title="Noise"
            defaultOpen={false}
            settingId="clouds.section.noise"
            forceOpen={forceSection('clouds.section.noise', 'Noise', ['clouds.cloudNoiseVariant', 'clouds.cloudScale', 'clouds.cloudDetail', 'clouds.cloudErosion'])}
          >
            <SelectRow
              label="Noise Variant"
              value={val(params, 'cloudNoiseVariant')}
              options={CLOUD_NOISE_VARIANTS}
              onChange={(v) => onParam('cloudNoiseVariant', v)}
              info="Changes the cloud density field shape without changing raymarch quality."
              settingId="clouds.cloudNoiseVariant"
            />
            {NOISE_SLIDERS.map((def) => (
              <SliderCtl key={def.key} def={def} value={val(params, def.key)} onChange={(v) => onParam(def.key, v)} settingId={`clouds.${def.key}`} />
            ))}
          </ControlSection>

          <ControlSection
            id={`${id}-motion`}
            title="Motion"
            defaultOpen={false}
            settingId="clouds.section.motion"
            forceOpen={forceSection('clouds.section.motion', 'Motion', ['clouds.cloudWind', 'clouds.cloudRotation', 'clouds.cloudEvolve'])}
          >
            {MOTION_SLIDERS.map((def) => (
              <SliderCtl key={def.key} def={def} value={val(params, def.key)} onChange={(v) => onParam(def.key, v)} settingId={`clouds.${def.key}`} />
            ))}
          </ControlSection>

          <ControlSection
            id={`${id}-lighting`}
            title="Lighting"
            defaultOpen={false}
            settingId="clouds.section.lighting"
            forceOpen={forceSection('clouds.section.lighting', 'Lighting', ['clouds.cloudLight', 'clouds.cloudShadow', 'clouds.cloudScattering', 'clouds.cloudColor', 'performance.cloudSelfShadow'])}
          >
            {LIGHT_SLIDERS.map((def) => (
              <SliderCtl key={def.key} def={def} value={val(params, def.key)} onChange={(v) => onParam(def.key, v)} settingId={`clouds.${def.key}`} />
            ))}
            {COLOR_FIELDS.map(({ key, label, info, def }) => (
              <div className="color-field" key={key} data-setting-id={`clouds.${key}`}>
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
              value={p.cloudSelfShadow !== false}
              onChange={(v) => onPerfSetting('cloudSelfShadow', v)}
              info="Secondary sun-direction march for soft self-shadowing (costlier). Shared with Performance settings."
              settingId="performance.cloudSelfShadow"
            />
          </ControlSection>

          <ControlSection
            id={`${id}-performance`}
            title="Performance"
            defaultOpen={false}
            settingId="clouds.section.performance"
            forceOpen={forceSection('clouds.section.performance', 'Performance', ['performance.cloudSteps', 'performance.cloudFallback', 'performance.cloudMaxDistance'])}
          >
            <SelectRow
              label="Resolution"
              value={resolutionName}
              options={RESOLUTION_OPTIONS}
              onChange={handleResolutionChange}
              info="Raymarch step count. Higher = smoother clouds, lower FPS. Shared with Performance settings."
              settingId="performance.cloudSteps"
            />
            <SelectRow
              label="Render Scale"
              value={String(p.cloudRenderScale ?? 1)}
              options={RENDER_SCALE_OPTIONS}
              onChange={(v) => onPerfSetting('cloudRenderScale', parseFloat(v))}
              info="Render clouds at lower resolution, then upscale with a depth-aware (bilateral) filter. Big FPS win since clouds are fill-rate bound; edges stay crisp against terrain and noise is smoothed. Shared with Performance settings."
              settingId="performance.cloudRenderScale"
            />
            <SelectRow
              label="Fallback Mode"
              value={p.cloudFallback ?? 'none'}
              options={FALLBACK_OPTIONS}
              onChange={(v) => onPerfSetting('cloudFallback', v)}
              info="Safe modes for weaker devices: Lite caps steps and disables self-shadowing; Off hides clouds."
              settingId="performance.cloudFallback"
            />
            <SliderCtl
              def={{ key: 'cloudMaxDistance', label: 'Max Distance', min: 1.5, max: 12, step: 0.5, digits: 1, unit: '×', info: distInfo }}
              value={p.cloudMaxDistance ?? 6.0}
              onChange={(v) => onPerfSetting('cloudMaxDistance', v)}
              settingId="performance.cloudMaxDistance"
            />
          </ControlSection>
        </>
      )}
    </>
  );

  if (flat) return content;

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
      {content}
    </ControlSection>
  );
}
