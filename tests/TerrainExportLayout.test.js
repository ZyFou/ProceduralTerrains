import { describe, expect, it } from 'vitest';
import {
  createTileExportManifest,
  tileExportFolder,
  tilePackageAssetPath,
  tilePackageHeightmapPath,
} from '../src/engine/terrain/TerrainExportLayout.js';

describe('tile export layout', () => {
  it('uses deterministic folders for negative tile coordinates', () => {
    expect(tileExportFolder({ cx: -2, cz: 1 })).toBe('tiles/tile_-2_1');
  });

  it('lists a separately importable package for every occupied tile', () => {
    const manifest = createTileExportManifest(
      [{ cx: 1, cz: 0 }, { cx: -1, cz: -2 }],
      'glb',
      { bakeColor: true, bakeNormal: true, exportHeightmap: true, exportSplat: true, exportCollision: true, exportWater: true },
    );

    expect(manifest).toMatchObject({ version: 1, mode: 'separate' });
    expect(manifest.tiles).toEqual([
      expect.objectContaining({ cx: -1, cz: -2, folder: 'tiles/tile_-1_-2', model: 'terrain.glb', collision: 'collision.glb' }),
      expect.objectContaining({ cx: 1, cz: 0, folder: 'tiles/tile_1_0', model: 'terrain.glb', water: true }),
    ]);
    expect(manifest.tiles[0].maps).toEqual({
      color: 'textures/terrain_color.png', normal: 'textures/terrain_normal.png',
      heightmap: 'textures/terrain_heightmap.png', splat: 'textures/terrain_splat.png',
    });
  });

  it('uses the selected OBJ extension without collision entries when disabled', () => {
    const [tile] = createTileExportManifest([{ cx: 0, cz: 0 }], 'obj', {}).tiles;
    expect(tile).toMatchObject({ model: 'terrain.obj', collision: null, water: false });
  });

  it('keeps each engine preset asset layout inside its tile package', () => {
    const unity = { packageRoot: 'Terrain', heightmapRawPath: 'Terrain/heightmap.raw', packagePaths: { 'textures/terrain_splat.png': 'Terrain/splatmaps/biomes.png' } };
    const unreal = { packageRoot: 'Landscape', heightmapRawPath: 'Landscape/heightmap.r16' };
    const godot = { packageRoot: 'Terrain3D', heightmapRawPath: 'Terrain3D/heightmap.r16', packagePaths: { 'textures/terrain_color.png': 'Terrain3D/textures/albedo.png' } };
    const three = { packageRoot: 'terrain-viewer', packagePaths: { 'terrain.glb': 'terrain-viewer/assets/terrain.glb' } };
    const tile = { cx: -1, cz: 2 };

    expect(tilePackageHeightmapPath(tile, unity)).toBe('tiles/tile_-1_2/heightmap.raw');
    expect(tilePackageHeightmapPath(tile, unreal)).toBe('tiles/tile_-1_2/heightmap.r16');
    expect(tilePackageAssetPath(tile, 'textures/terrain_color.png', godot)).toBe('tiles/tile_-1_2/textures/albedo.png');
    expect(tilePackageAssetPath(tile, 'terrain.glb', three)).toBe('tiles/tile_-1_2/assets/terrain.glb');
  });

  it('does not advertise a model or water mesh for heightmap-only exports', () => {
    const [tile] = createTileExportManifest([{ cx: 0, cz: 0 }], 'glb', {
      includeMesh: false, exportHeightmap: true, exportWater: true,
      heightmapRawPath: 'Terrain/heightmap.raw', packageRoot: 'Terrain',
    }).tiles;
    expect(tile.model).toBeNull();
    expect(tile.water).toBe(false);
    expect(tile.maps.heightmap).toBe('heightmap.raw');
  });
});
