export const BlenderPreset = {
  id: 'blender', label: 'Blender Scene',
  description: 'Validated heightfields, baked material maps, and a Blender 5.2 importer document.',
  defaults: {
    format: 'glb', meshRes: '512', texRes: '2048', includeMesh: false,
    includeSkirts: false, includeBase: false, heightRes: '1025',
    heightmapVertexGrid: true, exportTileMode: 'separate',
    bakeColor: true, bakeNormal: true, exportHeightmap: true, exportSplat: true,
    exportWater: true, exportCollision: false, exportPreset: false,
  },
  layout: {
    root: 'Blender', heightmapRawPath: 'Blender/heightmap.raw',
    runtimeDocumentPath: 'Blender/project.ptrterrain',
    paths: {
      'terrain.glb': 'Blender/terrain.glb', 'terrain.obj': 'Blender/terrain.obj',
      'textures/terrain_color.png': 'Blender/textures/terrain_color.png',
      'textures/terrain_normal.png': 'Blender/textures/terrain_normal.png',
      'textures/terrain_heightmap.png': 'Blender/textures/terrain_heightmap.png',
      'textures/terrain_splat.png': 'Blender/splatmaps/biomes.png',
    },
  },
};
