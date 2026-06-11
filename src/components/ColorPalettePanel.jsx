import { useRef, useState } from 'react';
import { COLOR_PALETTE_PRESETS } from '../engine/style/ColorPalettePresets.js';
import { PLANET_GEN_TYPES } from '../engine/style/ColorPaletteGenerator.js';
import { PALETTE_KEYS, colorToHex, parseColor } from '../engine/style/ColorPalette.js';
import { SliderCtl } from './controls.jsx';

const COLOR_GROUPS = [
  {
    id: 'water',
    label: 'Water',
    keys: ['deep', 'shallow', 'foam'],
  },
  {
    id: 'beach',
    label: 'Beach',
    keys: ['sand', 'dune'],
  },
  {
    id: 'vegetation',
    label: 'Vegetation',
    keys: ['dryGrass', 'grass', 'forest', 'jungle', 'swamp', 'tundra'],
  },
  {
    id: 'rock',
    label: 'Rock',
    keys: ['redRock', 'redRock2', 'rock', 'rockHi'],
  },
  {
    id: 'snow',
    label: 'Snow',
    keys: ['snow'],
  },
];

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
  {
    key: 'paletteSaturation',
    label: 'Saturation',
    min: 0,
    max: 2,
    step: 0.05,
    digits: 2,
    info: 'Increase or decrease color saturation across all biomes',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
        <path d="M8 2v12A6 6 0 0 0 8 2" fill="currentColor" />
      </svg>
    )
  },
  {
    key: 'paletteContrast',
    label: 'Contrast',
    min: 0.5,
    max: 1.8,
    step: 0.05,
    digits: 2,
    info: 'Adjust contrast between color transitions',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
        <path d="M8 2c-3.3 0-6 2.7-6 6s2.7 6 6 6V2" fill="currentColor" />
      </svg>
    )
  },
];

function PaletteSwatch({ colorKey, rgb, onChange }) {
  const hex = colorToHex(rgb ?? [0.5, 0.5, 0.5]);
  return (
    <label className="palette-color-row" title={COLOR_LABELS[colorKey]}>
      <span className="palette-color-chip" style={{ background: hex }} />
      <span className="palette-color-name">{COLOR_LABELS[colorKey]}</span>
      <input
        key={hex}
        type="color"
        className="palette-color-input"
        value={hex}
        onChange={(e) => onChange(colorKey, parseColor(e.target.value))}
      />
    </label>
  );
}

function PaletteGroup({ group, palette, open, onToggle, onColorChange }) {
  return (
    <div className={`palette-group${open ? ' open' : ''}`}>
      <button type="button" className="palette-group-header" onClick={onToggle} aria-expanded={open}>
        <span className="palette-group-dots">
          {group.keys.map((key) => (
            <span
              key={key}
              className="palette-group-dot"
              style={{ background: colorToHex(palette[key] ?? [0.5, 0.5, 0.5]) }}
            />
          ))}
        </span>
        <span className="palette-group-label">{group.label}</span>
        <span className={`palette-group-chevron${open ? ' open' : ''}`} aria-hidden>
          <svg viewBox="0 0 16 16" width="12" height="12">
            <path d="M4 6l4 4 4-4" stroke="currentColor" fill="none" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="palette-group-body">
          {group.keys.map((key) => (
            <PaletteSwatch
              key={key}
              colorKey={key}
              rgb={palette[key]}
              onChange={onColorChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ColorPalettePanel({
  planetStyle,
  palettePreset,
  terrainSeed,
  onPalettePreset,
  onGenerate,
  onColorChange,
  onTuning,
  onExport,
  onImport,
}) {
  const palette = planetStyle?.palette ?? {};
  const paletteGenRev = planetStyle?.paletteGenRev ?? 0;
  const seedInputRef = useRef(null);
  const [genType, setGenType] = useState('random');
  const [genSeed, setGenSeed] = useState(() => String(terrainSeed ?? Date.now()));
  const [openGroups, setOpenGroups] = useState({ water: true, vegetation: true });

  const readSeed = () => {
    const raw = seedInputRef.current?.value ?? genSeed;
    const parsed = parseInt(String(raw).trim(), 10);
    return Number.isFinite(parsed) ? parsed >>> 0 : Date.now();
  };

  const previewGradient = PALETTE_KEYS
    .map((key) => colorToHex(palette[key] ?? [0.5, 0.5, 0.5]))
    .join(', ');

  const toggleGroup = (id) => {
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const randomizeSeed = () => {
    const next = (Math.random() * 0xFFFFFFFF) >>> 0;
    setGenSeed(String(next));
  };

  const handleGenerate = () => {
    const seed = readSeed();
    onGenerate?.({ seed, type: genType });
    setGenSeed(String((seed + 1) >>> 0));
  };

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
    <div className="palette-block" data-palette-rev={paletteGenRev}>
      {/* Preview strip */}
      <div className="palette-preview-wrap">
        <div className="palette-preview" style={{ background: `linear-gradient(90deg, ${previewGradient})` }} />
        <span className="palette-preview-hint">{PALETTE_KEYS.length} biomes</span>
      </div>

      {/* Procedural generator */}
      <div className="palette-generator">
        <div className="palette-generator-head">
          <span className="palette-generator-title">Procedural Generator</span>
        </div>
        <div className="row">
          <div className="label-with-icon" data-tooltip="The style guidelines used by the procedural color generator (e.g. Desert, Lush, Toxic)">
            <span className="setting-icon">
              <svg viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.2" />
                <ellipse cx="8" cy="8" rx="2.5" ry="5.5" stroke="currentColor" strokeWidth="0.9" />
              </svg>
            </span>
            <span className="setting-label">Color Theme</span>
            <span className="info-icon-trigger">
              <svg viewBox="0 0 16 16" fill="none" width="10" height="10" style={{ marginLeft: '4px' }}>
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
                <path d="M8 11V8M8 5.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </span>
          </div>
          <select value={genType} onChange={(e) => setGenType(e.target.value)}>
            {PLANET_GEN_TYPES.map(({ key, label }) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
        <div className="seed-row">
          <div className="label-with-icon" data-tooltip="Input seed value for unique procedural color generation variations">
            <span className="setting-icon">
              <svg viewBox="0 0 16 16" fill="none">
                <rect x="3" y="3" width="10" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" />
                <path d="M8 1v2M8 13v2M1 8h2M13 8h2" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </span>
            <span className="setting-label">Color Seed</span>
            <span className="info-icon-trigger">
              <svg viewBox="0 0 16 16" fill="none" width="10" height="10" style={{ marginLeft: '4px' }}>
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
                <path d="M8 11V8M8 5.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </span>
          </div>
          <div className="seed-input-wrap">
            <input
              ref={seedInputRef}
              type="text"
              value={genSeed}
              onChange={(e) => setGenSeed(e.target.value)}
              placeholder="Seed"
            />
            <button type="button" className="icon-btn" onClick={randomizeSeed} title="Random seed">
              <svg viewBox="0 0 16 16" fill="none">
                <rect x="1.5" y="1.5" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.2" />
                <circle cx="5" cy="5" r="0.9" fill="currentColor" />
                <circle cx="11" cy="5" r="0.9" fill="currentColor" />
                <circle cx="8" cy="8" r="0.9" fill="currentColor" />
                <circle cx="5" cy="11" r="0.9" fill="currentColor" />
                <circle cx="11" cy="11" r="0.9" fill="currentColor" />
              </svg>
            </button>
          </div>
        </div>
        <button type="button" className="action-btn primary palette-generate-btn" onClick={handleGenerate} data-tooltip="Procedurally create a new color scheme for all height bands based on the seed and theme">
          <svg viewBox="0 0 16 16" fill="none">
            <path d="M8 2v4M8 10v4M2 8h4M10 8h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          Generate Custom Palette
        </button>
      </div>

      {/* Preset selector */}
      <div className="row palette-preset-row">
        <div className="label-with-icon" data-tooltip="Select from pre-defined artist-designed color schemes">
          <span className="setting-icon">
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M8 2a6 6 0 1 0 6 6c0-.8-.7-1.5-1.5-1.5h-1a1.5 1.5 0 0 1-1.5-1.5v-1A1.5 1.5 0 0 0 8 2z" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="5.5" cy="5.5" r="1.1" fill="currentColor" />
              <circle cx="5.5" cy="9.5" r="1.1" fill="currentColor" />
              <circle cx="9.5" cy="9.5" r="1.1" fill="currentColor" />
            </svg>
          </span>
          <span className="setting-label">Color Palette Preset</span>
          <span className="info-icon-trigger">
            <svg viewBox="0 0 16 16" fill="none" width="10" height="10" style={{ marginLeft: '4px' }}>
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
              <path d="M8 11V8M8 5.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
        </div>
        <select value={palettePreset} onChange={(e) => onPalettePreset(e.target.value)}>
          {Object.entries(COLOR_PALETTE_PRESETS).map(([key, p]) => (
            <option key={key} value={key}>{p.label}</option>
          ))}
          {palettePreset === 'custom' && <option value="custom">Custom</option>}
        </select>
      </div>

      {/* Grouped color editor */}
      <div className="palette-groups">
        {COLOR_GROUPS.map((group) => (
          <PaletteGroup
            key={group.id}
            group={group}
            palette={palette}
            open={!!openGroups[group.id]}
            onToggle={() => toggleGroup(group.id)}
            onColorChange={onColorChange}
          />
        ))}
      </div>

      {/* Tuning */}
      <div className="palette-tuning">
        {TUNING_SCHEMA.map((def) => (
          <SliderCtl
            key={def.key}
            def={def}
            value={planetStyle?.[def.key] ?? 1}
            onChange={(v) => onTuning(def.key, v)}
          />
        ))}
      </div>

      {/* Import / Export */}
      <div className="palette-io">
        <button type="button" className="action-btn" onClick={onExport} data-tooltip="Save the current custom planet styling to a JSON file">
          <svg viewBox="0 0 16 16" fill="none">
            <path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 13h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          Export
        </button>
        <button type="button" className="action-btn" onClick={handleImport} data-tooltip="Load a planet styling configuration from a JSON file">
          <svg viewBox="0 0 16 16" fill="none">
            <path d="M8 14V6M5 9l3-3 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 3h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          Import
        </button>
      </div>
    </div>
  );
}
