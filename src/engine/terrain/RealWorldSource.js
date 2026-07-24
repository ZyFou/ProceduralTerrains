export const REAL_WORLD_SOURCE_VERSION = 1;

export const DEFAULT_IMPORT_SETTINGS = Object.freeze({
  mode: 'disabled',
  blend: 1,
  invert: false,
  normalize: false,
  heightStrength: 1,
  heightOffset: 0,
});

export const DEFAULT_REAL_WORLD_HEIGHT_SETTINGS = Object.freeze({
  ...DEFAULT_IMPORT_SETTINGS,
  mode: 'replace',
});

export const DEFAULT_REAL_WORLD_IMAGERY_SETTINGS = Object.freeze({
  mode: 'replace',
  blend: 1,
});

const IMPORT_MODES = new Set(['disabled', 'preview', 'replace', 'blend']);
const IMAGERY_STYLES = new Set(['satellite', 'opentopo']);

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const boundedText = (value, maxLength) => String(value ?? '').trim().slice(0, maxLength);

function normalizeMode(value, fallback) {
  const mode = String(value ?? '');
  return IMPORT_MODES.has(mode) ? mode : fallback;
}

export function normalizeHeightImportSettings(input = {}) {
  return {
    mode: normalizeMode(input.mode, DEFAULT_REAL_WORLD_HEIGHT_SETTINGS.mode),
    blend: clamp(finite(input.blend, DEFAULT_REAL_WORLD_HEIGHT_SETTINGS.blend), 0, 1),
    invert: input.invert === true,
    normalize: input.normalize === true,
    heightStrength: clamp(finite(input.heightStrength, DEFAULT_REAL_WORLD_HEIGHT_SETTINGS.heightStrength), 0, 2),
    heightOffset: clamp(finite(input.heightOffset, DEFAULT_REAL_WORLD_HEIGHT_SETTINGS.heightOffset), -500, 500),
  };
}

export function normalizeImageryImportSettings(input = {}) {
  return {
    mode: normalizeMode(input.mode, DEFAULT_REAL_WORLD_IMAGERY_SETTINGS.mode),
    blend: clamp(finite(input.blend, DEFAULT_REAL_WORLD_IMAGERY_SETTINGS.blend), 0, 1),
  };
}

function normalizeBbox(input) {
  if (!input || typeof input !== 'object') return null;
  const bbox = {
    minLat: finite(input.minLat, NaN),
    maxLat: finite(input.maxLat, NaN),
    minLon: finite(input.minLon, NaN),
    maxLon: finite(input.maxLon, NaN),
  };
  if (!Object.values(bbox).every(Number.isFinite)) return null;
  if (bbox.minLat < -85.051 || bbox.maxLat > 85.051
      || bbox.minLon < -180 || bbox.maxLon > 180
      || bbox.minLat >= bbox.maxLat || bbox.minLon >= bbox.maxLon) return null;
  return bbox;
}

export function normalizeRealWorldSource(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (input.version != null && Number(input.version) !== REAL_WORLD_SOURCE_VERSION) return null;
  const bbox = normalizeBbox(input.bbox ?? input.bbox0);
  if (!bbox) return null;
  const zoom = Math.round(finite(input.zoom, NaN));
  if (!Number.isInteger(zoom) || zoom < 1 || zoom > 15) return null;
  const imageryStyle = IMAGERY_STYLES.has(input.imageryStyle)
    ? input.imageryStyle
    : 'satellite';
  return {
    version: REAL_WORLD_SOURCE_VERSION,
    id: boundedText(input.id, 80) || 'custom',
    name: boundedText(input.name, 160) || 'Real-world terrain',
    bbox,
    zoom,
    imageryStyle,
    heightSettings: normalizeHeightImportSettings(input.heightSettings),
    imagerySettings: normalizeImageryImportSettings(input.imagerySettings),
  };
}

export function createRealWorldSource({
  id,
  name,
  bbox,
  zoom,
  imageryStyle,
  heightSettings,
  imagerySettings,
}) {
  return normalizeRealWorldSource({
    version: REAL_WORLD_SOURCE_VERSION,
    id,
    name,
    bbox,
    zoom,
    imageryStyle,
    heightSettings: heightSettings ?? DEFAULT_REAL_WORLD_HEIGHT_SETTINGS,
    imagerySettings: imagerySettings ?? DEFAULT_REAL_WORLD_IMAGERY_SETTINGS,
  });
}

export function updateRealWorldSourceSettings(source, type, settings) {
  const normalized = normalizeRealWorldSource(source);
  if (!normalized) return null;
  if (type === 'height') normalized.heightSettings = normalizeHeightImportSettings(settings);
  if (type === 'imagery') normalized.imagerySettings = normalizeImageryImportSettings(settings);
  return normalized;
}

export function updateRealWorldSourceImageryStyle(source, imageryStyle) {
  const normalized = normalizeRealWorldSource(source);
  if (!normalized) return null;
  normalized.imageryStyle = IMAGERY_STYLES.has(imageryStyle) ? imageryStyle : 'satellite';
  return normalized;
}
