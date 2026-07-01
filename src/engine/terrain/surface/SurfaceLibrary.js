// Reads the terrain surface material manifest (public/textures/terrain/materials.json)
// and resolves map URLs / variant folders / existence checks. Framework-agnostic —
// no React, no Three.js — the UI and the (future) shader loader both sit on top of this.

const MANIFEST_URL = '/textures/terrain/materials.json';
const BASE_URL = '/textures/terrain';
const VARIANTS_API = '/__surface_api/variants';
const SELECTION_STORAGE_KEY = 'terrain-studio-surface-variants-v1';
export const CUSTOM_SURFACE_VARIANT = 'custom';
export const CUSTOM_SURFACE_VARIANT_PREFIX = 'custom:v';
export const SURFACE_LIBRARY_CHANGE_EVENT = 'terrain-surface-library-change';

export const MAP_SLOT_LABELS = {
  diffuse: 'Diffuse',
  displacement: 'Displacement',
  normalDX: 'Normal DX',
  roughness: 'Roughness',
  ao: 'AO',
};

let manifestPromise = null;

function notifySurfaceLibraryChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SURFACE_LIBRARY_CHANGE_EVENT));
  }
}

// Fetches + caches materials.json for the session. Returns { mapSlots, materials }.
export function loadMaterialsManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(MANIFEST_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`materials.json ${res.status}`);
        return res.json();
      })
      .catch((err) => {
        manifestPromise = null; // allow retry on next call
        throw err;
      });
  }
  return manifestPromise;
}

// Builds the on-disk URL for a material's map slot under a given variant folder
// (every variant, including "base", is a real subfolder now).
export function getMapUrl(material, variant, slot) {
  const filename = material.maps?.[slot];
  if (!filename) return null;
  return `${BASE_URL}/${material.folder}/${variant}/${filename}`;
}

export function getDefaultMapUrl(material, slot) {
  return getMapUrl(material, 'base', slot);
}

const variantsCache = new Map();

// Lists the actual variant subfolders on disk (via the dev-only local API — see
// vite-plugins/surfaceMaterialsApi.js). Never hardcoded to a fixed count; falls
// back to just "base" if the API isn't available (e.g. a production build).
export async function listVariants(material, { force = false } = {}) {
  if (!force && variantsCache.has(material.id)) return variantsCache.get(material.id);
  let variants;
  try {
    const res = await fetch(`${VARIANTS_API}?material=${encodeURIComponent(material.id)}`);
    if (!res.ok) throw new Error(`variants ${res.status}`);
    const body = await res.json();
    variants = Array.isArray(body.variants) && body.variants.length ? body.variants : ['base'];
  } catch {
    variants = ['base'];
  }
  // "base" always first if present, rest alphabetical (already sorted server-side).
  variants = [...variants].sort((a, b) => (a === 'base' ? -1 : b === 'base' ? 1 : a.localeCompare(b)));
  variantsCache.set(material.id, variants);
  return variants;
}

// Creates a new variant folder (+ README) on disk for a material. Throws with a
// user-facing message on failure (invalid name, already exists, API unavailable).
export async function createVariant(material, name) {
  const res = await fetch(VARIANTS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ material: material.id, name }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Could not create variant (${res.status})`);
  const variants = [...body.variants].sort((a, b) => (a === 'base' ? -1 : b === 'base' ? 1 : a.localeCompare(b)));
  variantsCache.set(material.id, variants);
  return variants;
}

const existenceCache = new Map();

// Cheap existence probe for a static asset URL (Image load/error — works for any
// browser-renderable format; EXR isn't renderable by <img> so it uses a HEAD
// request and rejects the dev-server's SPA-fallback text/html response).
export function probeUrlExists(url) {
  if (!url) return Promise.resolve(false);
  if (existenceCache.has(url)) return existenceCache.get(url);
  const promise = new Promise((resolve) => {
    if (/\.exr$/i.test(url)) {
      fetch(url, { method: 'HEAD' })
        .then((res) => resolve(res.ok && !(res.headers.get('content-type') || '').includes('text/html')))
        .catch(() => resolve(false));
      return;
    }
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
  existenceCache.set(url, promise);
  return promise;
}

function readSelectionStore() {
  try {
    return JSON.parse(localStorage.getItem(SELECTION_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeSelectionStore(store) {
  try {
    localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // storage unavailable (private mode / quota) — selection just won't persist
  }
}

// Persisted (localStorage) "which variant is the default for this material" choice.
export function getActiveVariant(materialId) {
  return readSelectionStore()[materialId] || 'base';
}

export function setActiveVariant(materialId, variant) {
  const store = readSelectionStore();
  if (!variant || variant === 'base') delete store[materialId];
  else store[materialId] = variant;
  writeSelectionStore(store);
  notifySurfaceLibraryChanged();
}

// Session-only custom file overrides (object URLs from a local file picker — these
// can't survive a reload, so they're kept in memory only, not localStorage).
const overrides = new Map();

function overrideKey(materialId, variant, slot) {
  return `${materialId}:${variant}:${slot}`;
}

export function getOverrideUrl(materialId, variant, slot) {
  return overrides.get(overrideKey(materialId, variant, slot)) || null;
}

export function setOverrideUrl(materialId, variant, slot, url) {
  const key = overrideKey(materialId, variant, slot);
  const prev = overrides.get(key);
  if (prev) URL.revokeObjectURL(prev);
  overrides.set(key, url);
  notifySurfaceLibraryChanged();
}

export function clearOverrideUrl(materialId, variant, slot) {
  const key = overrideKey(materialId, variant, slot);
  const prev = overrides.get(key);
  if (prev) URL.revokeObjectURL(prev);
  overrides.delete(key);
  notifySurfaceLibraryChanged();
}

export function getCustomVariantKey(variantIndex = 0) {
  const index = Math.max(0, Math.min(3, Number(variantIndex) || 0));
  return `${CUSTOM_SURFACE_VARIANT_PREFIX}${index}`;
}

export function getMaterialOverrideCount(materialId) {
  let count = 0;
  const prefix = `${materialId}:`;
  for (const key of overrides.keys()) {
    if (key.startsWith(prefix)) count += 1;
  }
  return count;
}

export function resetMaterialSurfaceState(materialId) {
  const store = readSelectionStore();
  delete store[materialId];
  writeSelectionStore(store);

  const prefixes = [`${materialId}:`];
  if (materialId === 'swamp') prefixes.push('mud:');
  for (const [key, url] of overrides.entries()) {
    if (!prefixes.some((prefix) => key.startsWith(prefix))) continue;
    URL.revokeObjectURL(url);
    overrides.delete(key);
  }
  notifySurfaceLibraryChanged();
}

export function resetSurfaceLibraryState() {
  try {
    localStorage.removeItem(SELECTION_STORAGE_KEY);
  } catch {
    // storage unavailable - only session overrides can be reset
  }
  for (const url of overrides.values()) URL.revokeObjectURL(url);
  overrides.clear();
  notifySurfaceLibraryChanged();
}

// Resolves the URL for the legacy variant preview path: a custom override if
// set, otherwise the manifest file for the active variant.
export function resolveMapUrl(material, variant, slot) {
  return getOverrideUrl(material.id, variant, slot) || getMapUrl(material, variant, slot);
}

export function resolveDefaultMapUrl(material, slot) {
  return getDefaultMapUrl(material, slot);
}

// Resolves the URL for Custom Materials rendering. Custom mode is a single
// upload set keyed separately from legacy variants, so it cannot silently use
// shipped base files or old variant folders. Variant 0 also reads the previous
// session-only custom key so old in-memory uploads still appear after this
// pipeline migration.
export function resolveCustomMapUrl(material, slot, variantIndex = 0) {
  const roleId = typeof material === 'string' ? material : material.id;
  const direct = getOverrideUrl(roleId, getCustomVariantKey(variantIndex), slot);
  if (direct) return direct;
  if (variantIndex !== 0) return null;
  const legacyDirect = getOverrideUrl(roleId, CUSTOM_SURFACE_VARIANT, slot);
  if (legacyDirect) return legacyDirect;
  if (roleId === 'swamp') return getOverrideUrl('mud', CUSTOM_SURFACE_VARIANT, slot);
  return null;
}
