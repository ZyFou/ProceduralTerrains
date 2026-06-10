import { PLANET_PRESETS } from '../engine/style/PlanetPresets.js';

export default function PlanetPresetPanel({ planetPreset, onSelect, onRandomize }) {
  return (
    <div className="planet-preset-block">
      <div className="row">
        <label>Planet Preset</label>
        <select value={planetPreset} onChange={(e) => onSelect(e.target.value)}>
          {Object.entries(PLANET_PRESETS).map(([key, p]) => (
            <option key={key} value={key}>{p.label}</option>
          ))}
          {planetPreset === 'custom' && <option value="custom">Custom</option>}
        </select>
      </div>
      <button type="button" className="action-btn" onClick={onRandomize}>
        Random Planet
      </button>
    </div>
  );
}
