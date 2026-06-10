import { COLOR_PALETTE_PRESETS } from '../engine/style/ColorPalettePresets.js';
import { PALETTE_KEYS, colorToHex, parseColor } from '../engine/style/ColorPalette.js';
import { SliderCtl } from './controls.jsx';

const COLOR_LABELS = {
  deep: 'Deep Water',
  shallow: 'Shallow',
  sand: 'Sand',
  dune: 'Dune',
  dryGrass: 'Dry Grass',
  grass: 'Grass',
  forest: 'Forest',
  jungle: 'Jungle',
  swamp: 'Swamp',
  tundra: 'Tundra',
  redRock: 'Red Rock',
  redRock2: 'Red Rock B',
  rock: 'Rock',
  rockHi: 'High Rock',
  snow: 'Snow',
  foam: 'Foam',
};

const TUNING_SCHEMA = [
  { key: 'paletteSaturation', label: 'Saturation', min: 0, max: 2, step: 0.05, digits: 2 },
  { key: 'paletteContrast', label: 'Contrast', min: 0.5, max: 1.8, step: 0.05, digits: 2 },
];

export default function ColorPalettePanel({
  planetStyle,
  palettePreset,
  onPalettePreset,
  onGenerate,
  onColorChange,
  onTuning,
  onExport,
  onImport,
}) {
  const palette = planetStyle?.palette ?? {};

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          onImport(JSON.parse(reader.result));
        } catch {
          onImport(null);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  return (
    <div className="palette-block">
      <div className="row">
        <label>Palette</label>
        <select value={palettePreset} onChange={(e) => onPalettePreset(e.target.value)}>
          {Object.entries(COLOR_PALETTE_PRESETS).map(([key, p]) => (
            <option key={key} value={key}>{p.label}</option>
          ))}
          {palettePreset === 'custom' && <option value="custom">Custom</option>}
        </select>
      </div>

      <button type="button" className="action-btn primary" onClick={onGenerate}>
        Generate Palette
      </button>

      <div className="palette-swatches">
        {PALETTE_KEYS.map((key) => (
          <label key={key} className="palette-swatch" title={COLOR_LABELS[key]}>
            <input
              type="color"
              value={colorToHex(palette[key] ?? [0.5, 0.5, 0.5])}
              onChange={(e) => onColorChange(key, parseColor(e.target.value))}
            />
            <span>{COLOR_LABELS[key]}</span>
          </label>
        ))}
      </div>

      {TUNING_SCHEMA.map((def) => (
        <SliderCtl
          key={def.key}
          def={def}
          value={planetStyle?.[def.key] ?? 1}
          onChange={(v) => onTuning(def.key, v)}
        />
      ))}

      <div className="palette-io">
        <button type="button" className="action-btn" onClick={onExport}>Export Palette</button>
        <button type="button" className="action-btn" onClick={handleImport}>Import Palette</button>
      </div>
    </div>
  );
}
