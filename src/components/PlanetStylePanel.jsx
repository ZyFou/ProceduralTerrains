import PlanetPresetPanel from './PlanetPresetPanel.jsx';
import ColorPalettePanel from './ColorPalettePanel.jsx';
import { colorToHex, parseColor } from '../engine/style/ColorPalette.js';

const ATMOSPHERE_COLORS = [
  { key: 'sunColor', label: 'Sun Light' },
  { key: 'skyAmbient', label: 'Sky Ambient' },
  { key: 'groundBounce', label: 'Ground Bounce' },
];

export default function PlanetStylePanel({
  planetStyle,
  planetPreset,
  palettePreset,
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
        onPalettePreset={onPalettePreset}
        onGenerate={onGeneratePalette}
        onColorChange={onColorChange}
        onTuning={onTuning}
        onExport={onExportStyle}
        onImport={onImportStyle}
      />

      <div className="subsection-label">Atmosphere</div>
      {ATMOSPHERE_COLORS.map(({ key, label }) => (
        <div className="color-field" key={key}>
          <label>{label}</label>
          <input
            type="color"
            value={colorToHex(style[key] ?? [0.5, 0.5, 0.5])}
            onChange={(e) => onTuning(key, parseColor(e.target.value))}
          />
        </div>
      ))}
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
