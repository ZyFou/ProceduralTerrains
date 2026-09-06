import { getDefaultMapUrl, loadMaterialsManifest, resolveCustomMapUrl } from './SurfaceLibrary.js';
import { MANUAL_SURFACE_ASSET_BY_ROLE } from '../../../manual/ManualSurfaceCatalog.js';
import { SURFACE_TEXTURE_ROLES } from './SurfaceTextureRoles.js';
import { buildSurfaceAtlas } from './SurfaceTextureAtlas.js';
import { SURFACE_TEXTURE_SOURCE, normalizeSurfaceTextureSource } from './SurfaceTextureSources.js';

// Builds the terrain surface atlas from the CURRENTLY selected variants /
// overrides in the Surface Library, or an explicit snapshot supplied by the
// UI to the renderer worker. Returns two textures plus coverage metadata.
export async function buildActiveSurfaceAtlas({ source = SURFACE_TEXTURE_SOURCE.CUSTOM, customMaps } = {}) {
  const normalizedSource = normalizeSurfaceTextureSource({ surfaceTextureSource: source });
  const manifest = await loadMaterialsManifest();
  const manifestById = Object.fromEntries((manifest.materials || []).map((material) => [material.id, material]));
  const byId = Object.fromEntries(SURFACE_TEXTURE_ROLES.map((m) => [m.id, m]));

  const resolveUrl = (materialId, slot, variantIndex = 0) => {
    const mat = byId[materialId];
    if (!mat) return null;
    if (normalizedSource === SURFACE_TEXTURE_SOURCE.CUSTOM) {
      // An explicitly empty snapshot must not read stale renderer-local state.
      if (customMaps != null) return customMaps[materialId]?.[variantIndex]?.[slot] ?? null;
      return resolveCustomMapUrl(mat, slot, variantIndex);
    }
    if (normalizedSource === SURFACE_TEXTURE_SOURCE.BUILT_IN) {
      const material = manifestById[MANUAL_SURFACE_ASSET_BY_ROLE[materialId]];
      return material ? getDefaultMapUrl(material, slot) : null;
    }
    return null;
  };
  const tilingFor = (materialId) => byId[materialId]?.tiling ?? 12;
  const labelFor = (materialId) => byId[materialId]?.label ?? materialId;

  return buildSurfaceAtlas({
    source: normalizedSource,
    mapSlots: manifest.mapSlots,
    resolveUrl,
    tilingFor,
    labelFor,
  });
}
