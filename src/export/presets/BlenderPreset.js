export const BlenderPreset = {
  id: 'blender', label: 'Blender Scene',
  description: 'GLB terrain package with baked material maps and scene notes.',
  defaults: {
    format: 'glb', meshRes: '512', texRes: '2048', includeMesh: true,
    includeSkirts: true, includeBase: true, bakeColor: true, bakeNormal: true,
    exportHeightmap: true, exportWater: true, exportCollision: false,
  },
  layout: {
    root: 'Blender', paths: {
      'terrain.glb': 'Blender/terrain.glb', 'terrain.obj': 'Blender/terrain.obj',
      'textures/terrain_color.png': 'Blender/textures/terrain_color.png',
      'textures/terrain_normal.png': 'Blender/textures/terrain_normal.png',
      'textures/terrain_heightmap.png': 'Blender/textures/terrain_heightmap.png',
      'textures/terrain_splat.png': 'Blender/textures/terrain_splat.png',
    },
  },
};
