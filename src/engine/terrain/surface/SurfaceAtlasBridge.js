import { SURFACE_TEXTURE_ROLES, SURFACE_TEXTURE_VARIANT_COUNT } from './SurfaceTextureRoles.js';
import { SURFACE_TEXTURE_SOURCE, normalizeSurfaceTextureSource } from './SurfaceTextureSources.js';

const SLOTS = ['diffuse', 'normalDX', 'roughness', 'ao'];

function abortError() {
  return new DOMException('Aborted', 'AbortError');
}

export function surfaceAtlasSuperseded() {
  return Object.assign(new Error('A newer surface bake replaced this request.'), {
    code: 'SURFACE_ATLAS_SUPERSEDED',
  });
}

// The UI owns the upload URLs. Send immutable, structured-cloneable Blobs, not
// the UI's module-local Map or URLs that replacing an upload can revoke.
async function collectSurfaceAtlasMapRefs(source, { resolveUrl, signal } = {}) {
  if (normalizeSurfaceTextureSource({ surfaceTextureSource: source }) !== SURFACE_TEXTURE_SOURCE.CUSTOM) return null;
  const resolve = resolveUrl || (await import('./SurfaceLibrary.js')).resolveCustomMapUrl;
  const maps = {};
  for (const role of SURFACE_TEXTURE_ROLES) {
    maps[role.id] = Array.from({ length: SURFACE_TEXTURE_VARIANT_COUNT }, () => ({}));
    for (let variant = 0; variant < SURFACE_TEXTURE_VARIANT_COUNT; variant += 1) {
      for (const slot of SLOTS) {
        const url = resolve(role.id, slot, variant);
        if (!url) continue;
        maps[role.id][variant][slot] = url;
      }
    }
  }
  // Abort as soon as the user changes source or cancels; this helper may
  // execute while the upload source is transiently reconfigured.
  if (signal?.aborted) throw abortError();
  return maps;
}

export async function captureSurfaceAtlasMapRefs(source, { resolveUrl, signal } = {}) {
  return collectSurfaceAtlasMapRefs(source, { resolveUrl, signal });
}

// Legacy path for environments that need immutable blobs to cross the boundary.
// This remains for environments that cannot (or should not) fetch object URLs
// from the renderer worker.
export async function captureSurfaceAtlasMaps(source, { resolveUrl, signal } = {}) {
  const maps = await collectSurfaceAtlasMapRefs(source, { resolveUrl, signal });
  if (!maps) return null;
  const reads = new Map();
  const pending = [];
  for (const role of SURFACE_TEXTURE_ROLES) {
    for (let variant = 0; variant < SURFACE_TEXTURE_VARIANT_COUNT; variant += 1) {
      for (const slot of SLOTS) {
        const url = maps[role.id]?.[variant]?.[slot];
        if (!url) continue;
        if (!reads.has(url)) {
          reads.set(url, fetch(url, { signal }).then((response) => {
            if (!response.ok) throw new Error(`Could not read uploaded texture (${response.status}).`);
            return response.blob();
          }));
        }
        pending.push(reads.get(url).then((blob) => {
          maps[role.id][variant][slot] = blob;
        }).catch((cause) => {
          if (signal?.aborted) throw signal?.reason instanceof DOMException && signal.reason.name === 'AbortError' ? signal.reason : abortError();
          throw new Error(`Could not read ${role.label} V${variant + 1} ${slot}. Please upload that map again.`, { cause });
        }));
      }
    }
  }
  await Promise.all(pending);
  return maps;
}

// Keep Three.js resources inside the renderer. Only the UI-facing metadata is
// returned across the worker boundary; a rejected stale build owns its cleanup.
export async function buildAndInstallSurfaceAtlas(engine, source, customMaps, {
  isCurrent = () => true,
  buildAtlas,
} = {}) {
  if (!isCurrent()) throw surfaceAtlasSuperseded();
  const build = buildAtlas || (await import('./applyTerrainSurface.js')).buildActiveSurfaceAtlas;
  const atlas = await build({ source, customMaps });
  if (!isCurrent()) {
    atlas.diffuse?.dispose();
    atlas.props?.dispose();
    throw surfaceAtlasSuperseded();
  }
  engine.setSurfaceAtlas(atlas, source);
  return {
    anyPresent: !!atlas.anyPresent,
    bakedAt: atlas.bakedAt,
    coverage: atlas.coverage,
    layers: atlas.layers,
    source,
  };
}
