import { PLANET_PRESETS } from '../engine/style/PlanetPresets.js';

export default function PlanetPresetPanel({ planetPreset, onSelect, onRandomize }) {
  return (
    <div className="planet-preset-block">
      <div className="row">
        <div className="label-with-icon" data-tooltip="Apply a curated global style theme including terrain shape, biomes, colors, and atmosphere">
          <span className="setting-icon">
            <svg viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M2 10c2.5-1 9.5-1 12 0" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </span>
          <span className="setting-label">Global Planet Style</span>
          <span className="info-icon-trigger">
            <svg viewBox="0 0 16 16" fill="none" width="10" height="10" style={{ marginLeft: '4px' }}>
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
              <path d="M8 11V8M8 5.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
        </div>
        <select value={planetPreset} onChange={(e) => onSelect(e.target.value)}>
          {Object.entries(PLANET_PRESETS).map(([key, p]) => (
            <option key={key} value={key}>{p.label}</option>
          ))}
          {planetPreset === 'custom' && <option value="custom">Custom</option>}
        </select>
      </div>
      <button type="button" className="action-btn" onClick={onRandomize} data-tooltip="Generate a completely randomized planet type, seed, and styling">
        <svg viewBox="0 0 16 16" fill="none" className="bic">
          <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="5.5" cy="5.5" r="1.1" fill="currentColor" />
          <circle cx="10.5" cy="5.5" r="1.1" fill="currentColor" />
          <circle cx="8" cy="8" r="1.1" fill="currentColor" />
          <circle cx="5.5" cy="10.5" r="1.1" fill="currentColor" />
          <circle cx="10.5" cy="10.5" r="1.1" fill="currentColor" />
        </svg>
        Generate Random Planet
      </button>
    </div>
  );
}
