export function tileExportFolder({ cx, cz }) {
  return `tiles/tile_${cx}_${cz}`;
}

function relativeToPackageRoot(path, packageRoot) {
  const normalized = path.replaceAll('\\', '/');
  const root = packageRoot?.replaceAll('\\', '/').replace(/\/$/, '');
  return root && normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized;
}

export function tilePackageAssetPath(tile, assetPath, options = {}) {
  const mapped = options.packagePaths?.[assetPath] ?? assetPath;
  return `${tileExportFolder(tile)}/${relativeToPackageRoot(mapped, options.packageRoot)}`;
}

export function tilePackageHeightmapPath(tile, options = {}) {
  if (options.heightmapRawPath) {
    return `${tileExportFolder(tile)}/${relativeToPackageRoot(options.heightmapRawPath, options.packageRoot)}`;
  }
  return tilePackageAssetPath(tile, 'textures/terrain_heightmap.png', options);
}

export function createTileExportManifest(tiles, format, options = {}) {
  const modelExt = format === 'obj' ? 'obj' : 'glb';
  return {
    version: 1,
    mode: 'separate',
    tiles: tiles
      .map(({ cx, cz }) => ({
        cx,
        cz,
        folder: tileExportFolder({ cx, cz }),
        model: options.includeMesh === false ? null : relativeToPackageRoot(options.packagePaths?.[`terrain.${modelExt}`] ?? `terrain.${modelExt}`, options.packageRoot),
        collision: options.exportCollision ? 'collision.glb' : null,
        water: options.includeMesh !== false && !!options.exportWater,
        maps: {
          color: options.bakeColor ? relativeToPackageRoot(options.packagePaths?.['textures/terrain_color.png'] ?? 'textures/terrain_color.png', options.packageRoot) : null,
          normal: options.bakeNormal ? relativeToPackageRoot(options.packagePaths?.['textures/terrain_normal.png'] ?? 'textures/terrain_normal.png', options.packageRoot) : null,
          heightmap: options.exportHeightmap ? relativeToPackageRoot(options.heightmapRawPath ?? options.packagePaths?.['textures/terrain_heightmap.png'] ?? 'textures/terrain_heightmap.png', options.packageRoot) : null,
          splat: options.exportHeightmap && options.exportSplat ? relativeToPackageRoot(options.packagePaths?.['textures/terrain_splat.png'] ?? 'textures/terrain_splat.png', options.packageRoot) : null,
        },
      }))
      .sort((a, b) => a.cz - b.cz || a.cx - b.cx),
  };
}
