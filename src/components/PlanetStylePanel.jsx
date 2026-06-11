import PlanetPresetPanel from './PlanetPresetPanel.jsx';
import ColorPalettePanel from './ColorPalettePanel.jsx';

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
  embedded = false,
}) {
  const style = planetStyle ?? {};

  const content = (
    <>
      <div className="subsection-label">Preset</div>
      <PlanetPresetPanel
        planetPreset={planetPreset}
        onSelect={onPlanetPreset}
        onRandomize={onRandomPlanet}
      />

      <div className="subsection-label">Palette</div>
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
      />
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
