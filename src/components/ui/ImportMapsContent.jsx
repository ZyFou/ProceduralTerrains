import { useMemo, useRef, useState } from 'react';
import { ImageUp, Mountain, Palette, Waves, Globe, Download } from 'lucide-react';
import CollapsibleGroup from './CollapsibleGroup.jsx';
import { SliderCtl, ToggleRow, SelectRow } from '../controls.jsx';
import { CURATED_LOCATIONS, ELEVATION_SOURCE } from '../../engine/terrain/RealWorldHeightmap.js';

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

function ImportMapSection({ type, map, ctx, forceOpen = false }) {
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
      forceOpen={forceOpen}
      statusDot={active ? 'active' : undefined}
      settingId={`terrain.${type}Map`}
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

function filterLocations(query) {
  const q = query.trim().toLowerCase();
  if (!q) return CURATED_LOCATIONS;
  return CURATED_LOCATIONS.filter(
    (loc) =>
      loc.name.toLowerCase().includes(q)
      || loc.blurb.toLowerCase().includes(q)
      || loc.id.toLowerCase().includes(q),
  );
}

function RealWorldBrowser({ ctx }) {
  const [busyId, setBusyId] = useState(null);
  const [progress, setProgress] = useState(0);
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => filterLocations(search), [search]);

  const load = async (loc) => {
    if (busyId) return;
    setBusyId(loc.id);
    setProgress(0);
    try {
      await ctx.onLoadRealWorldLocation?.(loc.id, { onProgress: (p) => setProgress(p) });
    } finally {
      setBusyId(null);
      setProgress(0);
    }
  };

  return (
    <CollapsibleGroup
      title="Real-World Locations"
      icon={<Globe size={15} strokeWidth={1.75} />}
      defaultOpen={false}
    >
      <p className="section-hint">
        Loads real Earth elevation as the height map. Fetches public terrain tiles from the internet.
      </p>
      <div className="settings-search-wrap realworld-search">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          className="settings-search-input"
          placeholder="Search locations…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            type="button"
            className="settings-search-clear"
            onClick={() => setSearch('')}
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>
      <div className="realworld-list">
        {filtered.length === 0 ? (
          <p className="settings-search-empty">No locations match &ldquo;{search.trim()}&rdquo;</p>
        ) : filtered.map((loc) => {
          const isBusy = busyId === loc.id;
          return (
            <button
              key={loc.id}
              type="button"
              className="realworld-item"
              disabled={!!busyId}
              onClick={() => load(loc)}
            >
              <span className="realworld-text">
                <span className="realworld-name">{loc.name}</span>
                <span className="realworld-blurb">{loc.blurb}</span>
              </span>
              {isBusy
                ? <span className="realworld-progress">{Math.round(progress * 100)}%</span>
                : <Download size={14} strokeWidth={1.75} aria-hidden />}
            </button>
          );
        })}
      </div>
      <p className="section-hint realworld-attribution">{ELEVATION_SOURCE}</p>
    </CollapsibleGroup>
  );
}

export default function ImportMapsContent({ ctx }) {
  const targetId = ctx.settingsTarget?.settingId ?? null;
  return (
    <>
      <p className="section-hint">
        Tile Mode only. Imported height maps in Replace or Blend mode deform the real terrain mesh and GLB export.
      </p>
      <RealWorldBrowser ctx={ctx} />
      {['height', 'noise', 'biome'].map((type) => (
        <ImportMapSection
          key={type}
          type={type}
          map={ctx.importedMaps?.[type]}
          ctx={ctx}
          forceOpen={targetId === `terrain.${type}Map`}
        />
      ))}
    </>
  );
}
