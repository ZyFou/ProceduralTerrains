export const UnrealPreset = {
  id: 'unreal', label: 'Unreal Landscape',
  description: '16-bit landscape heightmap, weightmaps, and centimetre world scale.',
  defaults: {
    format: 'glb', meshRes: '512', texRes: '2048', includeMesh: false,
    bakeColor: true, bakeNormal: true, exportHeightmap: true, exportSplat: true,
    exportCollision: true, collisionRes: '128', exportWater: true,
    exportWaterMask: true, exportWaterMetadata: true,
  },
  layout: {
    root: 'Landscape', heightmapRawPath: 'Landscape/heightmap.r16',
    paths: {
      'terrain.glb': 'Landscape/terrain.glb', 'terrain.obj': 'Landscape/terrain.obj',
      'collision.glb': 'Landscape/collision.glb',
      'textures/terrain_color.png': 'Landscape/textures/terrain_color.png',
      'textures/terrain_normal.png': 'Landscape/textures/terrain_normal.png',
      'textures/terrain_splat.png': 'Landscape/weightmaps/biomes.png',
    },
  },
};
