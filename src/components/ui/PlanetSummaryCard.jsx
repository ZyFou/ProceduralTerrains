import { translateText, useLanguage } from '../../i18n/LanguageContext.jsx';
import { PRESETS } from '../../engine/presets.js';
import { PLANET_PRESETS } from '../../engine/style/PlanetPresets.js';
import { COLOR_PALETTE_PRESETS } from '../../engine/style/ColorPalettePresets.js';
import ControlSection from './ControlSection.jsx';

export default function PlanetSummaryCard({ params }) {
  useLanguage();
  const terrainLabel = PRESETS[params.preset]?.label ?? params.preset;
  const planetLabel = PLANET_PRESETS[params.planetPreset]?.label ?? params.planetPreset;
  const paletteLabel = COLOR_PALETTE_PRESETS[params.palettePreset]?.label
    ?? (params.palettePreset === 'custom' ? 'Custom' : params.palettePreset);

  return (
    <ControlSection
      id="inspector-planet-summary"
      title={translateText("PLANET SUMMARY")}
      defaultOpen={false}
      icon={(
        <svg viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M2.5 8h11" stroke="currentColor" strokeWidth="0.9" />
        </svg>
      )}
    >
      <div className="stat-row" data-tooltip={translateText("Global styling configuration preset applied to the world")}>
        <div className="label-with-icon">
          <span className="setting-icon">
            <svg viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M2 10c2.5-1 9.5-1 12 0" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </span>
          <span className="setting-label">{translateText("Planet Style")}</span>
        </div>
        <span className="stat-value">{translateText(planetLabel)}</span>
      </div>
      <div className="stat-row" data-tooltip={translateText("Color palette preset applied to height bands / biomes")}>
        <div className="label-with-icon">
          <span className="setting-icon">
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M8 2a6 6 0 1 0 6 6c0-.8-.7-1.5-1.5-1.5h-1a1.5 1.5 0 0 1-1.5-1.5v-1A1.5 1.5 0 0 0 8 2z" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="5.5" cy="5.5" r="1.1" fill="currentColor" />
              <circle cx="5.5" cy="9.5" r="1.1" fill="currentColor" />
              <circle cx="9.5" cy="9.5" r="1.1" fill="currentColor" />
            </svg>
          </span>
          <span className="setting-label">{translateText("Palette")}</span>
        </div>
        <span className="stat-value">{translateText(paletteLabel)}</span>
      </div>
      <div className="stat-row" data-tooltip={translateText("Base geological preset model shaping the terrain contours")}>
        <div className="label-with-icon">
          <span className="setting-icon">
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M1.5 12l4-7 3.5 5 2.5-3.5 3 5.5h-13z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="setting-label">{translateText("Terrain Type")}</span>
        </div>
        <span className="stat-value">{translateText(terrainLabel)}</span>
      </div>
      <div className="stat-row" data-tooltip={translateText("Height scale offset at which deep and shallow water biomes render")}>
        <div className="label-with-icon">
          <span className="setting-icon">
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M1 9c1.5-1 2.5-1 4 0s2.5 1 4 0 2.5-1 4 0 2.5 1 3 0" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </span>
          <span className="setting-label">{translateText("Sea Level")}</span>
        </div>
        <span className="stat-value stat-mono">{translateText(params.seaLevel)}{translateText(" m")}</span>
      </div>
      <div className="stat-row" data-tooltip={translateText("Procedural height generator detail noise pattern preset")}>
        <div className="label-with-icon">
          <span className="setting-icon">
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M1 9c2.5-3 3.5-3 5 0s2.5 3 5 0 2.5-3 4 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </span>
          <span className="setting-label">{translateText("Noise Style")}</span>
        </div>
        <span className="stat-value">{translateText(params.noisePreset ?? 'default')}</span>
      </div>
    </ControlSection>
  );
}
import React from 'react';

