import { useMemo, useRef, useState } from 'react';
import { ImageUp, Mountain, Palette, Waves, Globe, Download, Crosshair, Map } from 'lucide-react';
import CollapsibleGroup from './CollapsibleGroup.jsx';
import { SliderCtl, ToggleRow, SelectRow } from '../controls.jsx';
import {
  CURATED_LOCATIONS, ELEVATION_SOURCE, IMAGERY_STYLES, CUSTOM_AREA_LIMITS, describeCustomArea,
  formatCoordinateDisplay, parseCoordinateInput, resolveImageryStyle,
} from '../../engine/terrain/RealWorldHeightmap.js';

const IMPORT_MODE_OPTIONS = [
  { value: 'disabled', label: 'Disabled' },
  { value: 'preview', label: 'Preview Only' },
  { value: 'replace', label: 'Replace Procedural' },
  { value: 'blend', label: 'Blend With Procedural' },
];

const IMAGERY_STYLE_OPTIONS = Object.values(IMAGERY_STYLES).map((s) => ({
  value: s.id,
  label: s.label,
}));

const MAP_META = {
  noise: { label: 'Noise Map', icon: <Waves size={15} strokeWidth={1.75} />, defaultOpen: false, filePick: true },
  height: { label: 'Height Map', icon: <Mountain size={15} strokeWidth={1.75} />, defaultOpen: true, filePick: true },
  biome: { label: 'Biome Map', icon: <Palette size={15} strokeWidth={1.75} />, defaultOpen: false, filePick: true },
  imagery: { label: 'Map Texture', icon: <Map size={15} strokeWidth={1.75} />, defaultOpen: true, filePick: false },
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

function ImageryStyleSelect({ ctx }) {
  const styleId = ctx.realWorldImageryStyle || 'satellite';
  const style = resolveImageryStyle(styleId);
  return (
    <>
      <SelectRow
        label="Texture Style"
        value={style.id}
        options={IMAGERY_STYLE_OPTIONS}
        onChange={(v) => ctx.onRealWorldImageryStyle?.(v)}
      />
      <p className="section-hint realworld-attribution">{style.attribution}</p>
    </>
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
  const isImagery = type === 'imagery';

  return (
    <CollapsibleGroup
      title={meta.label}
      icon={meta.icon}
      defaultOpen={meta.defaultOpen || !!map}
      forceOpen={forceOpen}
      statusDot={active ? 'active' : undefined}
      settingId={`terrain.${type}Map`}
    >
      {meta.filePick ? (
        <FilePicker
          fileName={map?.fileName}
          onPick={(file) => ctx.onImportTileMap(type, file)}
        />
      ) : (
        <ImageryStyleSelect ctx={ctx} />
      )}
      {map?.fileName && !meta.filePick && (
        <span className="file-picker-name">{map.fileName}</span>
      )}
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
      {settings.mode === 'blend' && (
        <SliderCtl
          def={{ label: 'Blend Strength', min: 0, max: 1, step: 0.01, digits: 2 }}
          value={settings.blend}
          onChange={(v) => set('blend', v)}
        />
      )}
      {!isImagery && (
        <>
          <ToggleRow label="Invert" value={!!settings.invert} onChange={(v) => set('invert', v)} />
          <ToggleRow label="Normalize" value={!!settings.normalize} onChange={(v) => set('normalize', v)} />
        </>
      )}
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
      <ImageryStyleSelect ctx={ctx} />
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

const CUSTOM_AREA_DEFAULT = { lat: 45.90, lon: 6.90, sizeKm: 30, zoom: 12 };
const customAreaDraft = {
  spec: { ...CUSTOM_AREA_DEFAULT },
  coordText: formatCoordinateDisplay(CUSTOM_AREA_DEFAULT),
};

function syncCustomAreaDraft(spec, coordText) {
  customAreaDraft.spec = { ...spec };
  customAreaDraft.coordText = coordText;
}

const CUSTOM_AREA_SLIDERS = {
  lat: { label: 'Latitude', ...CUSTOM_AREA_LIMITS.lat, digits: 2, unit: '°' },
  lon: { label: 'Longitude', ...CUSTOM_AREA_LIMITS.lon, digits: 2, unit: '°' },
  sizeKm: { label: 'Area Size', ...CUSTOM_AREA_LIMITS.sizeKm, digits: 0, unit: ' km' },
  zoom: { label: 'Detail (Zoom)', ...CUSTOM_AREA_LIMITS.zoom, digits: 0 },
};

function CustomAreaPicker({ ctx }) {
  const [spec, setSpec] = useState(() => ({ ...customAreaDraft.spec }));
  const [coordText, setCoordText] = useState(() => customAreaDraft.coordText);
  const [coordError, setCoordError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const info = useMemo(() => describeCustomArea(spec), [spec]);
  const set = (key) => (v) => {
    setSpec((s) => {
      const next = { ...s, [key]: v };
      const nextCoord = (key === 'lat' || key === 'lon')
        ? formatCoordinateDisplay(next)
        : customAreaDraft.coordText;
      if (key === 'lat' || key === 'lon') {
        setCoordText(nextCoord);
        setCoordError('');
      }
      syncCustomAreaDraft(next, nextCoord);
      return next;
    });
  };

  const commitCoordText = () => {
    const parsed = parseCoordinateInput(coordText);
    if (!parsed) {
      const current = formatCoordinateDisplay(spec);
      if (coordText.trim() && coordText.trim() !== current) {
        setCoordError('Use e.g. 46.07621°N, 6.96224°E');
        return null;
      }
      return spec;
    }
    setCoordError('');
    const next = { ...spec, lat: parsed.lat, lon: parsed.lon };
    const nextCoord = formatCoordinateDisplay(parsed);
    setSpec(next);
    setCoordText(nextCoord);
    syncCustomAreaDraft(next, nextCoord);
    return next;
  };

  const load = async () => {
    const toLoad = commitCoordText();
    if (!toLoad || busy) return;
    setBusy(true);
    setProgress(0);
    try {
      await ctx.onLoadRealWorldCustom?.(toLoad, { onProgress: (p) => setProgress(p) });
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  return (
    <CollapsibleGroup
      title="Custom Area"
      icon={<Crosshair size={15} strokeWidth={1.75} />}
      defaultOpen={false}
      settingId="terrain.realWorldCustom"
    >
      <div className="stat-row">
        <span className="stat-label">Coordinates</span>
      </div>
      <div className="seed-input-wrap">
        <input
          type="text"
          value={coordText}
          onChange={(e) => {
            const next = e.target.value;
            setCoordText(next);
            syncCustomAreaDraft(spec, next);
            if (coordError) setCoordError('');
          }}
          onBlur={commitCoordText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              load();
            }
          }}
          placeholder="46.07621°N, 6.96224°E"
          aria-label="Latitude and longitude"
          spellCheck={false}
        />
      </div>
      {coordError && <p className="section-hint import-map-error">{coordError}</p>}
      <SliderCtl def={CUSTOM_AREA_SLIDERS.lat} value={spec.lat} onChange={set('lat')} settingId="terrain.realWorldLat" />
      <SliderCtl def={CUSTOM_AREA_SLIDERS.lon} value={spec.lon} onChange={set('lon')} settingId="terrain.realWorldLon" />
      <SliderCtl def={CUSTOM_AREA_SLIDERS.sizeKm} value={spec.sizeKm} onChange={set('sizeKm')} settingId="terrain.realWorldSize" />
      <SliderCtl def={CUSTOM_AREA_SLIDERS.zoom} value={spec.zoom} onChange={set('zoom')} settingId="terrain.realWorldZoom" />
      <div className="stat-row">
        <span className="stat-label">Effective zoom</span>
        <span className="stat-value stat-mono">z{info.zoom}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Tiles fetched</span>
        <span className="stat-value stat-mono">{info.tilesX}×{info.tilesY}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Output resolution</span>
        <span className="stat-value stat-mono">{info.outW}×{info.outH}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Ground resolution</span>
        <span className="stat-value stat-mono">≈{info.metersPerPixel < 10 ? info.metersPerPixel.toFixed(1) : Math.round(info.metersPerPixel)} m/px</span>
      </div>
      {info.zoomClamped && (
        <p className="section-hint">
          Zoom reduced to z{info.zoom} so this area stays under the tile-fetch cap. Shrink the area size to get more detail.
        </p>
      )}
      <button type="button" className="file-picker-btn" disabled={busy} onClick={load}>
        <Download size={15} strokeWidth={1.75} aria-hidden />
        <span>{busy ? `Loading… ${Math.round(progress * 100)}%` : 'Load This Area'}</span>
      </button>
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
      <CustomAreaPicker ctx={ctx} />
      {['height', 'imagery', 'noise', 'biome'].map((type) => (
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
