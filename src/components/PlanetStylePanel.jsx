import { translateText, useLanguage } from '../i18n/LanguageContext.jsx';
import PlanetPresetPanel from './PlanetPresetPanel.jsx';
import ColorPalettePanel from './ColorPalettePanel.jsx';
import ControlSection from './ui/ControlSection.jsx';

export default function PlanetStylePanel({
  planetStyle,
  planetPreset,
  palettePreset,
  terrainSeed,
  onPlanetPreset,
  onRandomPlanet,
  onPalettePreset,
  onGeneratePalette,
  onColorChange,
  onTuning,
  onExportStyle,
  onImportStyle,
  settingsTarget,
  embedded = false,
  paletteOnly = false,
}) {
  useLanguage();
  const style = planetStyle ?? {};

  const palettePanel = (
    <ColorPalettePanel
      planetStyle={style}
      palettePreset={palettePreset}
      terrainSeed={terrainSeed}
      onPalettePreset={onPalettePreset}
      onGenerate={onGeneratePalette}
      onColorChange={onColorChange}
      onTuning={onTuning}
      onExport={onExportStyle}
      onImport={onImportStyle}
      settingsTarget={settingsTarget}
    />
  );

  const content = paletteOnly ? palettePanel : (
    <>
      <ControlSection id="planet-preset" title={translateText("Preset")} defaultOpen settingId="planet.section.preset">
        <PlanetPresetPanel
          planetPreset={planetPreset}
          onSelect={onPlanetPreset}
          onRandomize={onRandomPlanet}
        />
      </ControlSection>

      <ControlSection id="planet-palette" title={translateText("Palette")} defaultOpen settingId="planet.section.palette">
        {translateText(palettePanel)}
      </ControlSection>
    </>
  );

  if (embedded) return content;

  return (
    <aside id="planet-style-panel" className="panel">
      <div className="panel-header">
        <span>{translateText("PLANET STYLE")}</span>
      </div>
      <div className="panel-body">{translateText(content)}</div>
    </aside>
  );
}
import React from 'react';

