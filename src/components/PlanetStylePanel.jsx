import { useState } from 'react';
import PlanetPresetPanel from './PlanetPresetPanel.jsx';
import ColorPalettePanel from './ColorPalettePanel.jsx';
import NoisePresetPanel from './NoisePresetPanel.jsx';

export default function PlanetStylePanel({
  planetStyle,
  planetPreset,
  palettePreset,
  noisePreset,
  onPlanetPreset,
  onRandomPlanet,
  onPalettePreset,
  onGeneratePalette,
  onColorChange,
  onTuning,
  onNoisePreset,
  onExportStyle,
  onImportStyle,
}) {
  const [open, setOpen] = useState(true);

  return (
    <aside id="planet-style-panel" className="panel">
      <div className="panel-header">
        <span>PLANET STYLE</span>
        <button type="button" className="collapse-btn" onClick={() => setOpen(!open)}>
          {open ? '‹' : '›'}
        </button>
      </div>
      <div className={`panel-body${open ? '' : ' collapsed'}`}>
        <div className="section-title">PRESETS</div>
        <PlanetPresetPanel
          planetPreset={planetPreset}
          onSelect={onPlanetPreset}
          onRandomize={onRandomPlanet}
        />

        <div className="section-title">NOISE</div>
        <NoisePresetPanel noisePreset={noisePreset} onSelect={onNoisePreset} />

        <div className="section-title">PALETTE</div>
        <ColorPalettePanel
          planetStyle={planetStyle}
          palettePreset={palettePreset}
          onPalettePreset={onPalettePreset}
          onGenerate={onGeneratePalette}
          onColorChange={onColorChange}
          onTuning={onTuning}
          onExport={onExportStyle}
          onImport={onImportStyle}
        />
      </div>
    </aside>
  );
}
