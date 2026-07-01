import { loadMaterialsManifest, resolveCustomMapUrl } from './SurfaceLibrary.js';
import { SURFACE_TEXTURE_ROLES } from './SurfaceTextureRoles.js';
import { buildSurfaceAtlas } from './SurfaceTextureAtlas.js';
import { SURFACE_TEXTURE_SOURCE, normalizeSurfaceTextureSource } from './SurfaceTextureSources.js';

// Builds the terrain surface atlas from the CURRENTLY selected variants /
// overrides in the Surface Library. Returns the atlas (4 THREE textures +
// present/tile arrays) ready to hand to Engine.setSurfaceAtlas().
export async function buildActiveSurfaceAtlas({ source = SURFACE_TEXTURE_SOURCE.CUSTOM } = {}) {
  const normalizedSource = normalizeSurfaceTextureSource({ surfaceTextureSource: source });
  const manifest = await loadMaterialsManifest();
  const byId = Object.fromEntries(SURFACE_TEXTURE_ROLES.map((m) => [m.id, m]));

  const resolveUrl = (materialId, slot, variantIndex = 0) => {
    const mat = byId[materialId];
    if (!mat) return null;
    if (normalizedSource === SURFACE_TEXTURE_SOURCE.CUSTOM) return resolveCustomMapUrl(mat, slot, variantIndex);
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
