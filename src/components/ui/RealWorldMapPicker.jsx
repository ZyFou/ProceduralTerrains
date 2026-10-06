import { getLocale } from '../../i18n/language.js';
import { translateText, useLanguage } from '../../i18n/LanguageContext.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Crosshair, Download, Grip, LoaderCircle, Map, Search, X } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import './RealWorldSelectionCenter.css';
import {
  CUSTOM_AREA_LIMITS,
  describeCustomArea,
  formatCoordinateDisplay,
  parseCoordinateInput,
  makeCustomLocation,
  resolveImageryStyle,
} from '../../engine/terrain/RealWorldHeightmap.js';
import { COORDINATE_FORMATS } from '../../engine/terrain/CoordinateFormats.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const GEOCODING_SEARCH_URL = import.meta.env.VITE_GEOCODING_SEARCH_URL
  || 'https://nominatim.openstreetmap.org/search';
const geocodingCache = new globalThis.Map();

function selectionBounds(spec) {
  const { bbox } = makeCustomLocation(spec);
  return [
    [bbox.minLat, bbox.minLon],
    [bbox.maxLat, bbox.maxLon],
  ];
}

function SliderField({ label, value, min, max, step, unit = '', onChange }) {
  useLanguage();
  return (
    <label className="realworld-map-slider">
      <span>
        <span>{translateText(label)}</span>
        <output>{value}{translateText(unit)}</output>
      </span>
      <input
        type="range"
        aria-label={translateText(label)}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function SelectField({ label, value, options, onChange }) {
  useLanguage();
  return (
    <label className="realworld-map-select">
      <span>{translateText(label)}</span>
      <select value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{translateText(option.label)}</option>
        ))}
      </select>
    </label>
  );
}

function Stat({ label, children }) {
  useLanguage();
  return (
    <div className="realworld-map-stat">
      <span>{translateText(label)}</span>
      <strong>{children}</strong>
    </div>
  );
}

export default function RealWorldMapPicker({
  spec,
  imageryStyle = 'satellite',
  busy = false,
  progress = 0,
  chunkCount = 16,
  chunkSize = 128,
  onChunkSizeChange,
  onChange,
  onLoad,
  onClose,
}) {
  useLanguage();
  const mapNodeRef = useRef(null);
  const mapRef = useRef(null);
  const rectangleRef = useRef(null);
  const tileLayerRef = useRef(null);
  const leafletRef = useRef(null);
  const specRef = useRef(spec);
  const frameRef = useRef(0);
  const dialogRef = useRef(null);
  const searchAbortRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [coordinateFormat, setCoordinateFormat] = useState('degrees');
  const [coordinateText, setCoordinateText] = useState(() => formatCoordinateDisplay(spec));
  const [coordinateError, setCoordinateError] = useState('');
  const info = useMemo(() => describeCustomArea(spec), [spec]);
  const style = resolveImageryStyle(imageryStyle);
  const worldSizeOptions = [64, 128, 192, 256].map((size) => {
    const worldSize = chunkCount * size;
    return {
      value: size,
      label: `${worldSize.toLocaleString(getLocale())} × ${worldSize.toLocaleString(getLocale())} units`,
    };
  });

  useEffect(() => {
    specRef.current = spec;
  }, [spec]);

  useEffect(() => {
    setCoordinateText(formatCoordinateDisplay({ lat: spec.lat, lon: spec.lon }, coordinateFormat));
    setCoordinateError('');
  }, [spec.lat, spec.lon, coordinateFormat]);

  const commitSelectionCenter = () => {
    const current = specRef.current;
    if (coordinateText.trim() === formatCoordinateDisplay(current, coordinateFormat)) {
      setCoordinateError('');
      return current;
    }
    const point = parseCoordinateInput(coordinateText, coordinateFormat);
    if (!point || point.lat < CUSTOM_AREA_LIMITS.lat.min || point.lat > CUSTOM_AREA_LIMITS.lat.max) {
      setCoordinateError(coordinateFormat === 'lambert93'
        ? 'Enter valid Lambert 93 easting, northing in meters within France.'
        : coordinateFormat === 'mercator'
          ? 'Enter valid Web Mercator easting, northing in meters (latitude between −85° and 85°).'
          : 'Enter latitude (−85° to 85°), longitude (−180° to 180°) in decimal degrees or DMS.');
      return null;
    }
    const next = { ...current, ...point };
    // Update the map event source before recentering, so its move callback
    // retains the newly entered center and current size/detail settings.
    specRef.current = next;
    cancelAnimationFrame(frameRef.current);
    onChange(next);
    mapRef.current?.panTo([next.lat, next.lon], { animate: false });
    setCoordinateText(formatCoordinateDisplay(next, coordinateFormat));
    setCoordinateError('');
    return next;
  };

  const changeCoordinateFormat = (format) => {
    const next = commitSelectionCenter();
    if (!next) return;
    if (format === 'lambert93' && !parseCoordinateInput(formatCoordinateDisplay(next, format), format)) {
      setCoordinateError('Lambert 93 covers mainland France and Corsica. Choose another format for this location.');
      return;
    }
    setCoordinateFormat(format);
  };

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      searchAbortRef.current?.abort();
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [busy, onClose]);

  const searchPlaces = async (event) => {
    event?.preventDefault();
    const query = searchQuery.trim();
    if (query.length < 2 || searchBusy) return;
    setSearchError('');
    const cacheKey = query.toLocaleLowerCase();
    if (geocodingCache.has(cacheKey)) {
      setSearchResults(geocodingCache.get(cacheKey));
      return;
    }
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setSearchBusy(true);
    try {
      const url = new URL(GEOCODING_SEARCH_URL);
      url.searchParams.set('q', query);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('limit', '6');
      url.searchParams.set('accept-language', navigator.languages?.join(',') || navigator.language || 'en');
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Search failed (${response.status})`);
      const payload = await response.json();
      const results = (Array.isArray(payload) ? payload : []).map((place) => ({
        id: String(place.place_id ?? `${place.lat}:${place.lon}`),
        lat: Number(place.lat),
        lon: Number(place.lon),
        label: String(place.display_name ?? query),
        type: String(place.type ?? place.addresstype ?? ''),
      })).filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lon));
      geocodingCache.set(cacheKey, results);
      setSearchResults(results);
      if (!results.length) setSearchError('No matching places found.');
    } catch (error) {
      if (error?.name !== 'AbortError') setSearchError('Place search is unavailable right now.');
    } finally {
      if (searchAbortRef.current === controller) {
        searchAbortRef.current = null;
        setSearchBusy(false);
      }
    }
  };

  const selectSearchResult = (place) => {
    const next = {
      ...specRef.current,
      lat: clamp(place.lat, CUSTOM_AREA_LIMITS.lat.min, CUSTOM_AREA_LIMITS.lat.max),
      lon: clamp(place.lon, CUSTOM_AREA_LIMITS.lon.min, CUSTOM_AREA_LIMITS.lon.max),
    };
    onChange({ ...next, lat: Number(next.lat.toFixed(5)), lon: Number(next.lon.toFixed(5)) });
    mapRef.current?.flyTo([next.lat, next.lon], Math.max(mapRef.current.getZoom(), 10), { duration: 0.65 });
    setSearchQuery(place.label.split(',')[0]);
    setSearchResults([]);
    setSearchError('');
  };

  useEffect(() => {
    let cancelled = false;
    let map;

    import('leaflet').then(({ default: L }) => {
      if (cancelled || !mapNodeRef.current) return;
      leafletRef.current = L;
      map = L.map(mapNodeRef.current, {
        center: [specRef.current.lat, specRef.current.lon],
        zoom: 10,
        minZoom: 2,
        maxZoom: 18,
        maxBounds: [[-85.051, -180], [85.051, 180]],
        maxBoundsViscosity: 1,
        zoomControl: true,
        attributionControl: false,
        worldCopyJump: false,
      });
      mapRef.current = map;

      const initialStyle = resolveImageryStyle(imageryStyle);
      const GeoTileLayer = L.TileLayer.extend({
        getTileUrl(coords) {
          return initialStyle.tileUrl(coords.z, coords.x, coords.y);
        },
      });
      tileLayerRef.current = new GeoTileLayer('', {
        minZoom: 2,
        maxZoom: 18,
        maxNativeZoom: 18,
        noWrap: true,
        crossOrigin: true,
      }).addTo(map);

      rectangleRef.current = L.rectangle(selectionBounds(specRef.current), {
        color: '#5ca1ff',
        weight: 2,
        opacity: 1,
        fillColor: '#2f7de1',
        fillOpacity: 0.16,
        interactive: false,
      }).addTo(map);

      const syncFromMap = () => {
        const center = map.getCenter();
        const next = {
          ...specRef.current,
          lat: clamp(center.lat, CUSTOM_AREA_LIMITS.lat.min, CUSTOM_AREA_LIMITS.lat.max),
          lon: clamp(center.lng, CUSTOM_AREA_LIMITS.lon.min, CUSTOM_AREA_LIMITS.lon.max),
        };
        rectangleRef.current?.setBounds(selectionBounds(next));
        cancelAnimationFrame(frameRef.current);
        frameRef.current = requestAnimationFrame(() => {
          onChange({
            ...next,
            lat: Number(next.lat.toFixed(5)),
            lon: Number(next.lon.toFixed(5)),
          });
        });
      };

      map.on('move', syncFromMap);
      map.on('click', (event) => map.panTo(event.latlng));
      map.fitBounds(selectionBounds(specRef.current), {
        padding: [90, 90],
        maxZoom: 13,
        animate: false,
      });
      map.invalidateSize();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameRef.current);
      map?.remove();
      mapRef.current = null;
      rectangleRef.current = null;
      tileLayerRef.current = null;
      leafletRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const center = map.getCenter();
    if (Math.abs(center.lat - spec.lat) > 0.00002 || Math.abs(center.lng - spec.lon) > 0.00002) {
      map.panTo([spec.lat, spec.lon], { animate: false });
    }
    rectangleRef.current?.setBounds(selectionBounds(spec));
  }, [spec]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    tileLayerRef.current?.remove();
    const nextStyle = resolveImageryStyle(imageryStyle);
    const GeoTileLayer = L.TileLayer.extend({
      getTileUrl(coords) {
        return nextStyle.tileUrl(coords.z, coords.x, coords.y);
      },
    });
    tileLayerRef.current = new GeoTileLayer('', {
      minZoom: 2,
      maxZoom: 18,
      maxNativeZoom: 18,
      noWrap: true,
      crossOrigin: true,
    }).addTo(map);
    tileLayerRef.current.bringToBack();
  }, [imageryStyle]);

  const update = (patch) => onChange({ ...spec, ...patch });
  const groundResolution = info.metersPerPixel < 10
    ? info.metersPerPixel.toFixed(1)
    : Math.round(info.metersPerPixel);

  return createPortal(
    <div
      className="realworld-map-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="realworld-map-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="realworld-map-title"
        tabIndex={-1}
      >
        <header className="realworld-map-header">
          <div>
            <span className="realworld-map-heading-icon"><Map size={17} aria-hidden /></span>
            <span>
              <h2 id="realworld-map-title">{translateText("Select a real-world area")}</h2>
              <p>{translateText("Move the map or click a location to position the terrain.")}</p>
            </span>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label={translateText("Close map picker")}>
            <X size={17} aria-hidden />
          </button>
        </header>

        <div className="realworld-map-layout">
          <div className="realworld-map-canvas-wrap">
            <div ref={mapNodeRef} className="realworld-map-canvas" aria-label={translateText("Interactive world map")} />
            <div className="realworld-map-search">
              <form onSubmit={searchPlaces} role="search">
                <Search size={15} aria-hidden />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setSearchResults([]);
                    setSearchError('');
                  }}
                  placeholder={translateText("Search city or place…")}
                  aria-label={translateText("Search city or place")}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button type="submit" disabled={searchBusy || searchQuery.trim().length < 2} aria-label={translateText("Search map")}>
                  {searchBusy ? <LoaderCircle size={15} className="tb-spin" aria-hidden /> : 'Search'}
                </button>
              </form>
              {(searchResults.length > 0 || searchError) && (
                <div className="realworld-map-search-results" role="listbox" aria-label={translateText("Place search results")}>
                  {searchError && <p>{translateText(searchError)}</p>}
                  {searchResults.map((place) => {
                    const [name, ...rest] = place.label.split(',');
                    return (
                      <button key={place.id} type="button" role="option" aria-selected="false" onClick={() => selectSearchResult(place)}>
                        <strong>{translateText(name)}</strong>
                        <span>{translateText(rest.join(',').trim() || place.type)}</span>
                      </button>
                    );
                  })}
                  <small>{translateText("Search data © OpenStreetMap contributors")}</small>
                </div>
              )}
            </div>
            <div className="realworld-map-crosshair" aria-hidden>
              <Crosshair size={24} strokeWidth={1.6} />
            </div>
            <div className="realworld-map-instruction">
              <Grip size={14} aria-hidden />{translateText("Drag to move · Scroll to zoom · Click to center")}</div>
          </div>

          <aside className="realworld-map-sidebar">
            <form className="realworld-map-coordinates realworld-center" onSubmit={(event) => {
              event.preventDefault();
              if (!busy) commitSelectionCenter();
            }}>
              <div className="realworld-center-heading"><Crosshair size={15} aria-hidden /><h3>{translateText("Selection center")}</h3></div>
              <label className="realworld-map-select">
                <span>{translateText("Coordinate format")}</span>
                <select aria-label={translateText("Selection center coordinate format")} value={coordinateFormat}
                  disabled={busy} onChange={(event) => changeCoordinateFormat(event.target.value)}>
                  {COORDINATE_FORMATS.map(({ value, label }) => <option key={value} value={value}>{translateText(label)}</option>)}
                </select>
              </label>
              <label className="realworld-center-label" htmlFor="realworld-selection-center">{translateText("Coordinates")}</label>
              <div className={`realworld-center-field${coordinateError ? ' is-invalid' : ''}`}>
                <Crosshair size={15} aria-hidden />
                <input id="realworld-selection-center" type="text" value={coordinateText}
                disabled={busy} spellCheck={false} autoComplete="off"
                aria-describedby="realworld-selection-center-hint"
                aria-invalid={!!coordinateError}
                aria-label={translateText("Selection center")}
                onChange={(event) => { setCoordinateText(event.target.value); setCoordinateError(''); }} />
              </div>
              <small className="realworld-center-hint" id="realworld-selection-center-hint">
                {translateText(['lambert93', 'mercator'].includes(coordinateFormat) ? 'Easting, northing in meters' : 'Latitude, longitude · decimal degrees or DMS')}
              </small>
              {coordinateError && <p className="realworld-map-warning" role="alert">{translateText(coordinateError)}</p>}
              <button type="submit" className="action-btn realworld-center-apply" disabled={busy}>
                <Crosshair size={14} aria-hidden />{translateText(" Center map")}</button>
            </form>

            <div className="realworld-map-world-settings" aria-labelledby="realworld-world-settings-title">
              <h3 id="realworld-world-settings-title">{translateText("World settings")}</h3>
              <SelectField
                label={translateText("3D world size")}
                value={chunkSize}
                options={worldSizeOptions}
                onChange={(nextChunkSize) => onChunkSizeChange?.(nextChunkSize)}
              />
              <p>{translateText(chunkCount)} × {translateText(chunkCount)}{translateText(" chunks · ")}{translateText(chunkSize)}{translateText(" units per chunk")}</p>
            </div>

            <SliderField
              label={translateText("Area size")}
              value={spec.sizeKm}
              unit=" km"
              {...CUSTOM_AREA_LIMITS.sizeKm}
              onChange={(sizeKm) => update({ sizeKm })}
            />
            <SliderField
              label={translateText("Terrain detail")}
              value={spec.zoom}
              unit={` · z${info.zoom} effective`}
              {...CUSTOM_AREA_LIMITS.zoom}
              onChange={(zoom) => update({ zoom })}
            />

            <div className="realworld-map-stats">
              <Stat label={translateText("Selected area")}>{translateText(spec.sizeKm)} × {translateText(spec.sizeKm)}{translateText(" km")}</Stat>
              <Stat label={translateText("Tiles fetched")}>{translateText(info.tilesX)} × {translateText(info.tilesY)}</Stat>
              <Stat label={translateText("Output resolution")}>{translateText(info.outW)} × {translateText(info.outH)}</Stat>
              <Stat label={translateText("Ground resolution")}>≈{translateText(groundResolution)}{translateText(" m/px")}</Stat>
            </div>

            {info.zoomClamped && (
              <p className="realworld-map-warning">{translateText("Detail reduced to z")}{translateText(info.zoom)}{translateText(" to stay within the 6 × 6 tile limit. Reduce the area size for a sharper result.")}</p>
            )}

            <p className="realworld-map-layer-credit">{translateText(style.attribution)}</p>

            <button
              type="button"
              className="realworld-map-load"
              disabled={busy}
              onClick={() => {
                const next = commitSelectionCenter();
                if (next) onLoad(next);
              }}
            >
              <Download size={16} aria-hidden />
              <span>{translateText(busy ? `Loading terrain… ${Math.round(progress * 100)}%` : 'Load selected area')}</span>
            </button>
          </aside>
        </div>
      </section>
    </div>,
    document.body,
  );
}
