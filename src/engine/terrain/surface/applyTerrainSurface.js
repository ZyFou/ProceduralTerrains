import { loadMaterialsManifest, resolveCustomMapUrl } from './SurfaceLibrary.js';
import { buildSurfaceAtlas } from './SurfaceTextureAtlas.js';
import { SURFACE_TEXTURE_SOURCE, normalizeSurfaceTextureSource } from './SurfaceTextureSources.js';

// Builds the terrain surface atlas from the CURRENTLY selected variants /
// overrides in the Surface Library. Returns the atlas (4 THREE textures +
// present/tile arrays) ready to hand to Engine.setSurfaceAtlas().
export async function buildActiveSurfaceAtlas({ source = SURFACE_TEXTURE_SOURCE.CUSTOM } = {}) {
  const normalizedSource = normalizeSurfaceTextureSource({ surfaceTextureSource: source });
  const manifest = await loadMaterialsManifest();
  const byId = Object.fromEntries(manifest.materials.map((m) => [m.id, m]));

  const resolveUrl = (materialId, slot) => {
    const mat = byId[materialId];
    if (!mat) return null;
    if (normalizedSource === SURFACE_TEXTURE_SOURCE.CUSTOM) return resolveCustomMapUrl(mat, slot);
    return null;
  };
  const tilingFor = (materialId) => byId[materialId]?.tiling ?? 12;
  const labelFor = (materialId) => byId[materialId]?.name ?? materialId;

  return buildSurfaceAtlas({ source: normalizedSource, resolveUrl, tilingFor, labelFor });
}
