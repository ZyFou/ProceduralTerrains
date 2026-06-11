import PlanetPresetPanel from './PlanetPresetPanel.jsx';
import ColorPalettePanel from './ColorPalettePanel.jsx';
import { colorToHex, parseColor } from '../engine/style/ColorPalette.js';

const ATMOSPHERE_COLORS = [
  {
    key: 'skyAmbient',
    label: 'Sky Ambient',
    info: 'Color of ambient scattered sky light reflecting onto the terrain',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M8 3a4 4 0 0 1 4 4H4a4 4 0 0 1 4-4zM2 10h12M4 13h8" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )
  },
  {
    key: 'groundBounce',
    label: 'Ground Bounce',
    info: 'Color of light bouncing from the ground back up into shadowed areas',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M2 13h12M4 4l4 6 4-6" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    )
  },
];

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

      <div className="subsection-label">Atmosphere</div>
      {ATMOSPHERE_COLORS.map(({ key, label, icon, info }) => (
        <div className="color-field" key={key}>
          <div className="label-with-icon" data-tooltip={info}>
            {icon && <span className="setting-icon">{icon}</span>}
            <span className="setting-label">{label}</span>
            {info && (
              <span className="info-icon-trigger">
                <svg viewBox="0 0 16 16" fill="none" width="10" height="10" style={{ marginLeft: '4px' }}>
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M8 11V8M8 5.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </span>
            )}
          </div>
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
