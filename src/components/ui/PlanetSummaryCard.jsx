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
      <div className="stat-row" data-tooltip="Global styling configuration preset applied to the world">
        <div className="label-with-icon">
          <span className="setting-icon">
            <svg viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M2 10c2.5-1 9.5-1 12 0" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </span>
          <span className="setting-label">Planet Style</span>
        </div>
        <span className="stat-value">{planetLabel}</span>
      </div>
      <div className="stat-row" data-tooltip="Color palette preset applied to height bands / biomes">
        <div className="label-with-icon">
          <span className="setting-icon">
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M8 2a6 6 0 1 0 6 6c0-.8-.7-1.5-1.5-1.5h-1a1.5 1.5 0 0 1-1.5-1.5v-1A1.5 1.5 0 0 0 8 2z" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="5.5" cy="5.5" r="1.1" fill="currentColor" />
              <circle cx="5.5" cy="9.5" r="1.1" fill="currentColor" />
              <circle cx="9.5" cy="9.5" r="1.1" fill="currentColor" />
            </svg>
          </span>
          <span className="setting-label">Palette</span>
        </div>
        <span className="stat-value">{paletteLabel}</span>
      </div>
      <div className="stat-row" data-tooltip="Base geological preset model shaping the terrain contours">
        <div className="label-with-icon">
          <span className="setting-icon">
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M1.5 12l4-7 3.5 5 2.5-3.5 3 5.5h-13z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="setting-label">Terrain Type</span>
        </div>
        <span className="stat-value">{terrainLabel}</span>
      </div>
      <div className="stat-row" data-tooltip="Height scale offset at which deep and shallow water biomes render">
        <div className="label-with-icon">
          <span className="setting-icon">
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M1 9c1.5-1 2.5-1 4 0s2.5 1 4 0 2.5-1 4 0 2.5 1 3 0" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </span>
          <span className="setting-label">Sea Level</span>
        </div>
        <span className="stat-value stat-mono">{params.seaLevel} m</span>
      </div>
      <div className="stat-row" data-tooltip="Procedural height generator detail noise pattern preset">
        <div className="label-with-icon">
          <span className="setting-icon">
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M1 9c2.5-3 3.5-3 5 0s2.5 3 5 0 2.5-3 4 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </span>
          <span className="setting-label">Noise Style</span>
        </div>
        <span className="stat-value">{params.noisePreset ?? 'default'}</span>
      </div>
    </ControlSection>
  );
}
