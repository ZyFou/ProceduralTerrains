// Reads the terrain surface material manifest (public/textures/terrain/materials.json)
// and resolves map URLs / variant folders / existence checks. Framework-agnostic —
// no React, no Three.js — the UI and the (future) shader loader both sit on top of this.

const MANIFEST_URL = '/textures/terrain/materials.json';
const BASE_URL = '/textures/terrain';
const VARIANTS_API = '/__surface_api/variants';
const SELECTION_STORAGE_KEY = 'terrain-studio-surface-variants-v1';

export const MAP_SLOT_LABELS = {
  diffuse: 'Diffuse',
  displacement: 'Displacement',
  normalDX: 'Normal DX',
  roughness: 'Roughness',
  ao: 'AO',
};

let manifestPromise = null;

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
  store[materialId] = variant;
  writeSelectionStore(store);
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
}

export function clearOverrideUrl(materialId, variant, slot) {
  const key = overrideKey(materialId, variant, slot);
  const prev = overrides.get(key);
  if (prev) URL.revokeObjectURL(prev);
  overrides.delete(key);
}

// Resolves the URL actually used for a slot: a custom override if set, otherwise
// the manifest's default file for the active variant.
export function resolveMapUrl(material, variant, slot) {
  return getOverrideUrl(material.id, variant, slot) || getMapUrl(material, variant, slot);
}
