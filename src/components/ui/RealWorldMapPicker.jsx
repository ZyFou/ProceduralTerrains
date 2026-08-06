import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Crosshair, Download, Grip, LoaderCircle, Map, Search, X } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import {
  CUSTOM_AREA_LIMITS,
  describeCustomArea,
  formatCoordinateDisplay,
  makeCustomLocation,
  resolveImageryStyle,
} from '../../engine/terrain/RealWorldHeightmap.js';

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
  return (
    <label className="realworld-map-slider">
      <span>
        <span>{label}</span>
        <output>{value}{unit}</output>
      </span>
      <input
        type="range"
        aria-label={label}
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
  return (
    <label className="realworld-map-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function Stat({ label, children }) {
  return (
    <div className="realworld-map-stat">
      <span>{label}</span>
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
  const info = useMemo(() => describeCustomArea(spec), [spec]);
  const style = resolveImageryStyle(imageryStyle);
  const worldSizeOptions = [64, 128, 192, 256].map((size) => {
    const worldSize = chunkCount * size;
    return {
      value: size,
      label: `${worldSize.toLocaleString()} × ${worldSize.toLocaleString()} units`,
    };
  });

  useEffect(() => {
    specRef.current = spec;
  }, [spec]);

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
              <h2 id="realworld-map-title">Select a real-world area</h2>
              <p>Move the map or click a location to position the terrain.</p>
            </span>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close map picker">
            <X size={17} aria-hidden />
          </button>
        </header>

        <div className="realworld-map-layout">
          <div className="realworld-map-canvas-wrap">
            <div ref={mapNodeRef} className="realworld-map-canvas" aria-label="Interactive world map" />
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
                  placeholder="Search city or place…"
                  aria-label="Search city or place"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button type="submit" disabled={searchBusy || searchQuery.trim().length < 2} aria-label="Search map">
                  {searchBusy ? <LoaderCircle size={15} className="tb-spin" aria-hidden /> : 'Search'}
                </button>
              </form>
              {(searchResults.length > 0 || searchError) && (
                <div className="realworld-map-search-results" role="listbox" aria-label="Place search results">
                  {searchError && <p>{searchError}</p>}
                  {searchResults.map((place) => {
                    const [name, ...rest] = place.label.split(',');
                    return (
                      <button key={place.id} type="button" role="option" aria-selected="false" onClick={() => selectSearchResult(place)}>
                        <strong>{name}</strong>
                        <span>{rest.join(',').trim() || place.type}</span>
                      </button>
                    );
                  })}
                  <small>Search data © OpenStreetMap contributors</small>
                </div>
              )}
            </div>
            <div className="realworld-map-crosshair" aria-hidden>
              <Crosshair size={24} strokeWidth={1.6} />
            </div>
            <div className="realworld-map-instruction">
              <Grip size={14} aria-hidden />
              Drag to move · Scroll to zoom · Click to center
            </div>
          </div>

          <aside className="realworld-map-sidebar">
            <div className="realworld-map-coordinates">
              <span>Selection center</span>
              <strong>{formatCoordinateDisplay(spec)}</strong>
            </div>

            <div className="realworld-map-world-settings" aria-labelledby="realworld-world-settings-title">
              <h3 id="realworld-world-settings-title">World settings</h3>
              <SelectField
                label="3D world size"
                value={chunkSize}
                options={worldSizeOptions}
                onChange={(nextChunkSize) => onChunkSizeChange?.(nextChunkSize)}
              />
              <p>{chunkCount} × {chunkCount} chunks · {chunkSize} units per chunk</p>
            </div>

            <SliderField
              label="Area size"
              value={spec.sizeKm}
              unit=" km"
              {...CUSTOM_AREA_LIMITS.sizeKm}
              onChange={(sizeKm) => update({ sizeKm })}
            />
            <SliderField
              label="Terrain detail"
              value={spec.zoom}
              unit={` · z${info.zoom} effective`}
              {...CUSTOM_AREA_LIMITS.zoom}
              onChange={(zoom) => update({ zoom })}
            />

            <div className="realworld-map-stats">
              <Stat label="Selected area">{spec.sizeKm} × {spec.sizeKm} km</Stat>
              <Stat label="Tiles fetched">{info.tilesX} × {info.tilesY}</Stat>
              <Stat label="Output resolution">{info.outW} × {info.outH}</Stat>
              <Stat label="Ground resolution">≈{groundResolution} m/px</Stat>
            </div>

            {info.zoomClamped && (
              <p className="realworld-map-warning">
                Detail reduced to z{info.zoom} to stay within the 6 × 6 tile limit.
                Reduce the area size for a sharper result.
              </p>
            )}

            <p className="realworld-map-layer-credit">{style.attribution}</p>

            <button
              type="button"
              className="realworld-map-load"
              disabled={busy}
              onClick={() => onLoad(spec)}
            >
              <Download size={16} aria-hidden />
              <span>{busy ? `Loading terrain… ${Math.round(progress * 100)}%` : 'Load selected area'}</span>
            </button>
          </aside>
        </div>
      </section>
    </div>,
    document.body,
  );
}
