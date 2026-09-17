import React from 'react';
import ControlSection from '../../ui/ControlSection.jsx';
import { SelectRow } from '../../controls.jsx';
import { normalizeEnergySettings } from '../../../engine/render/FramePacer.js';

export default function EnergySavingSettings({ perf, onPerfSetting }) {
  const settings = normalizeEnergySettings(perf);
  return (
    <ControlSection id="perf-energy-saving" title="Energy & Frame Rate" defaultOpen>
      <SelectRow
        label="Energy Saving"
        value={settings.energyMode}
        options={[
          { value: 'off', label: 'Off (legacy behavior)' },
          { value: 'balanced', label: 'Balanced (dynamic FPS)' },
          { value: 'eco', label: 'Eco (lower frame rate)' },
        ]}
        onChange={(value) => onPerfSetting('energyMode', value)}
        settingId="performance.energyMode"
        info="Paces CPU updates and GPU rendering on every GPU tier. Hidden pages pause the regular render loop. Spatial quality is unchanged."
      />
      {settings.energyMode === 'balanced' && <SelectRow
        label="Active FPS Limit"
        value={settings.energyMaxFps}
        options={[30, 60, 90, 120].map((value) => ({ value, label: `${value} FPS` }))}
        onChange={(value) => onPerfSetting('energyMaxFps', Number(value))}
        settingId="performance.energyMaxFps"
        info="The maximum while navigating or editing; it is not a guaranteed frame rate."
      />}
      <p className="settings-note">
        {settings.energyMode === 'off'
          ? 'Uses the original rendering cadence. Background visibility fixes remain enabled.'
          : settings.energyMode === 'eco'
            ? 'Up to 30 FPS active, 24 FPS after 1.5 seconds idle. Exploration stays at the active limit.'
            : `Up to ${settings.energyMaxFps} FPS active, 30 FPS after 1.5 seconds idle. Exploration stays at the active limit.`}
        {' '}Static Tile scenes retain on-demand rendering. Boot, transitions and exports are not throttled.
      </p>
    </ControlSection>
  );
}
