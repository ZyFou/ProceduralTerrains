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
      <ControlSection id="planet-preset" title="Preset" defaultOpen settingId="planet.section.preset">
        <PlanetPresetPanel
          planetPreset={planetPreset}
          onSelect={onPlanetPreset}
          onRandomize={onRandomPlanet}
        />
      </ControlSection>

      <ControlSection id="planet-palette" title="Palette" defaultOpen settingId="planet.section.palette">
        {palettePanel}
      </ControlSection>
    </>
  );

  if (embedded) return content;

  return (
    <aside id="planet-style-panel" className="panel">
      <div className="panel-header">
        <span>PLANET STYLE</span>
      </div>
      <div className="panel-body">{content}</div>
    </aside>
  );
}
import React from 'react';

