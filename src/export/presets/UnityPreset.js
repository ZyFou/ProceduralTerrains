export const UnityPreset = {
  id: 'unity',
  label: 'Unity Terrain',
  description: '16-bit RAW heightmap, terrain masks, and Unity scale metadata.',
  defaults: {
    format: 'glb', meshRes: '512', texRes: '2048', includeMesh: false,
    bakeColor: true, bakeNormal: true, exportHeightmap: true, exportSplat: true,
    exportCollision: true, collisionRes: '128', exportWater: true,
    exportWaterMask: true, exportWaterMetadata: true,
  },
  layout: {
    root: 'Terrain', heightmapRawPath: 'Terrain/heightmap.raw',
    paths: {
      'terrain.glb': 'Terrain/terrain.glb', 'terrain.obj': 'Terrain/terrain.obj',
      'collision.glb': 'Terrain/collision.glb',
      'textures/terrain_color.png': 'Terrain/textures/terrain_color.png',
      'textures/terrain_normal.png': 'Terrain/textures/terrain_normal.png',
      'textures/terrain_splat.png': 'Terrain/splatmaps/biomes.png',
    },
  },
};
