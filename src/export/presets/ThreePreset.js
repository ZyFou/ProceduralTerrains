export const ThreePreset = {
  id: 'three', label: 'Three.js Viewer Assets',
  description: 'Web-ready GLB and texture package for a Three.js viewer.',
  defaults: {
    format: 'glb', meshRes: '256', texRes: '1024', includeMesh: true,
    bakeColor: true, bakeNormal: true, exportHeightmap: true, exportWater: true,
    exportWaterMask: true,
  },
  layout: {
    root: 'terrain-viewer', paths: {
      'terrain.glb': 'terrain-viewer/assets/terrain.glb', 'terrain.obj': 'terrain-viewer/assets/terrain.obj',
      'textures/terrain_color.png': 'terrain-viewer/assets/terrain_color.png',
      'textures/terrain_normal.png': 'terrain-viewer/assets/terrain_normal.png',
      'textures/terrain_heightmap.png': 'terrain-viewer/assets/terrain_heightmap.png',
      'textures/terrain_splat.png': 'terrain-viewer/assets/terrain_splat.png',
    },
  },
};
