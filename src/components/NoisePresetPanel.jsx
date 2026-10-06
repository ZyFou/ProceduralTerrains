import { translateText, useLanguage } from '../i18n/LanguageContext.jsx';
import { NOISE_PRESETS } from '../engine/style/NoisePresets.js';

export default function NoisePresetPanel({ noisePreset, onSelect }) {
  useLanguage();
  return (
    <div className="row">
      <label>{translateText("Noise Style")}</label>
      <select value={noisePreset} onChange={(e) => onSelect(e.target.value)}>
        {Object.entries(NOISE_PRESETS).map(([key, p]) => (
          <option key={key} value={key}>{translateText(p.label)}</option>
        ))}
      </select>
    </div>
  );
}
import React from 'react';

