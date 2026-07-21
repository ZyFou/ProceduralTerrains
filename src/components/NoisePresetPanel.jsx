import { NOISE_PRESETS } from '../engine/style/NoisePresets.js';

export default function NoisePresetPanel({ noisePreset, onSelect }) {
  return (
    <div className="row">
      <label>Noise Style</label>
      <select value={noisePreset} onChange={(e) => onSelect(e.target.value)}>
        {Object.entries(NOISE_PRESETS).map(([key, p]) => (
          <option key={key} value={key}>{p.label}</option>
        ))}
      </select>
    </div>
  );
}
import React from 'react';

