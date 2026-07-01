import { loadMaterialsManifest, resolveMapUrl, getActiveVariant } from './SurfaceLibrary.js';
import { buildSurfaceAtlas } from './SurfaceTextureAtlas.js';

// Builds the terrain surface atlas from the CURRENTLY selected variants /
// overrides in the Surface Library. Returns the atlas (4 THREE textures +
// present/tile arrays) ready to hand to Engine.setSurfaceAtlas().
export async function buildActiveSurfaceAtlas() {
  const manifest = await loadMaterialsManifest();
  const byId = Object.fromEntries(manifest.materials.map((m) => [m.id, m]));

  const resolveUrl = (materialId, slot) => {
    const mat = byId[materialId];
    if (!mat) return null;
    const variant = getActiveVariant(materialId);
    return resolveMapUrl(mat, variant, slot);
  };
  const tilingFor = (materialId) => byId[materialId]?.tiling ?? 12;

  return buildSurfaceAtlas({ resolveUrl, tilingFor });
}
