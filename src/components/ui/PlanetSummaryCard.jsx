import { PRESETS } from '../../engine/presets.js';
import { PLANET_PRESETS } from '../../engine/style/PlanetPresets.js';
import { COLOR_PALETTE_PRESETS } from '../../engine/style/ColorPalettePresets.js';
import ControlSection from './ControlSection.jsx';

export default function PlanetSummaryCard({ params }) {
  const terrainLabel = PRESETS[params.preset]?.label ?? params.preset;
  const planetLabel = PLANET_PRESETS[params.planetPreset]?.label ?? params.planetPreset;
  const paletteLabel = COLOR_PALETTE_PRESETS[params.palettePreset]?.label
    ?? (params.palettePreset === 'custom' ? 'Custom' : params.palettePreset);

  return (
    <ControlSection
      id="inspector-planet-summary"
      title="PLANET SUMMARY"
      defaultOpen={false}
      icon={(
        <svg viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M2.5 8h11" stroke="currentColor" strokeWidth="0.9" />
        </svg>
      )}
    >
      <div className="stat-row">
        <span className="stat-label">Planet Style</span>
        <span className="stat-value">{planetLabel}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Palette</span>
        <span className="stat-value">{paletteLabel}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Terrain Type</span>
        <span className="stat-value">{terrainLabel}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Sea Level</span>
        <span className="stat-value stat-mono">{params.seaLevel} m</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Noise Style</span>
        <span className="stat-value">{params.noisePreset ?? 'default'}</span>
      </div>
    </ControlSection>
  );
}
