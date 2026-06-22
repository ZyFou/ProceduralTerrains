import { useRef } from 'react';
import { ImageUp, Mountain, Palette, Waves } from 'lucide-react';
import CollapsibleGroup from './CollapsibleGroup.jsx';
import { SliderCtl, ToggleRow, SelectRow } from '../controls.jsx';

const IMPORT_MODE_OPTIONS = [
  { value: 'disabled', label: 'Disabled' },
  { value: 'preview', label: 'Preview Only' },
  { value: 'replace', label: 'Replace Procedural' },
  { value: 'blend', label: 'Blend With Procedural' },
];

const MAP_META = {
  noise: { label: 'Noise Map', icon: <Waves size={15} strokeWidth={1.75} />, defaultOpen: false },
  height: { label: 'Height Map', icon: <Mountain size={15} strokeWidth={1.75} />, defaultOpen: true },
  biome: { label: 'Biome Map', icon: <Palette size={15} strokeWidth={1.75} />, defaultOpen: false },
};

function FilePicker({ fileName, onPick }) {
  const inputRef = useRef(null);
  const label = fileName ? 'Replace file' : 'Choose file';

  return (
    <div className="file-picker">
      <button
        type="button"
        className="file-picker-btn"
        onClick={() => inputRef.current?.click()}
      >
        <ImageUp size={15} strokeWidth={1.75} aria-hidden />
        <span>{label}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        className="file-picker-input"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = '';
        }}
      />
      {fileName && <span className="file-picker-name">{fileName}</span>}
    </div>
  );
}

function ImportMapSection({ type, map, ctx }) {
  const meta = MAP_META[type];
  const settings = map?.settings ?? {
    mode: 'disabled',
    blend: 1,
    invert: false,
    normalize: false,
    heightStrength: 1,
    heightOffset: 0,
  };
  const set = (key, value) => ctx.onTileMapSetting(type, key, value);
  const active = settings.mode !== 'disabled' && !!map;

  return (
    <CollapsibleGroup
      title={meta.label}
      icon={meta.icon}
      defaultOpen={meta.defaultOpen || !!map}
      statusDot={active ? 'active' : undefined}
    >
      <FilePicker
        fileName={map?.fileName}
        onPick={(file) => ctx.onImportTileMap(type, file)}
      />
      {map?.preview && (
        <img
          src={map.preview}
          alt={`${meta.label} preview`}
          className="import-map-preview"
        />
      )}
      <div className="stat-row">
        <span className="stat-label">Resolution</span>
        <span className="stat-value stat-mono">
          {map ? `${map.width}×${map.height}` : '—'}
        </span>
      </div>
      {map?.error && <p className="section-hint import-map-error">{map.error}</p>}
      {map?.warning && <p className="section-hint">{map.warning}</p>}
      <SelectRow
        label="Usage Mode"
        value={settings.mode}
        options={IMPORT_MODE_OPTIONS}
        onChange={(v) => set('mode', v)}
      />
      {settings.mode === 'replace' && (
        <p className="section-hint">
          {meta.label} is replacing procedural data. Some procedural settings may have reduced or no effect for this map type.
        </p>
      )}
      {settings.mode === 'blend' && (
        <SliderCtl
          def={{ label: 'Blend Strength', min: 0, max: 1, step: 0.01, digits: 2 }}
          value={settings.blend}
          onChange={(v) => set('blend', v)}
        />
      )}
      <ToggleRow label="Invert" value={!!settings.invert} onChange={(v) => set('invert', v)} />
      <ToggleRow label="Normalize" value={!!settings.normalize} onChange={(v) => set('normalize', v)} />
      {type === 'height' && (
        <>
          <SliderCtl
            def={{ label: 'Height Strength', min: 0, max: 2, step: 0.01, digits: 2 }}
            value={settings.heightStrength}
            onChange={(v) => set('heightStrength', v)}
          />
          <SliderCtl
            def={{ label: 'Height Offset', min: -500, max: 500, step: 1, digits: 0, unit: 'm' }}
            value={settings.heightOffset}
            onChange={(v) => set('heightOffset', v)}
          />
        </>
      )}
    </CollapsibleGroup>
  );
}

export default function ImportMapsContent({ ctx }) {
  return (
    <>
      <p className="section-hint">
        Tile Mode only. Imported height maps in Replace or Blend mode deform the real terrain mesh and GLB export.
      </p>
      {['noise', 'height', 'biome'].map((type) => (
        <ImportMapSection
          key={type}
          type={type}
          map={ctx.importedMaps?.[type]}
          ctx={ctx}
        />
      ))}
    </>
  );
}
