import { PANEL_ICONS } from '../icons/panelIcons.jsx';

// Lightweight panel metadata lives separately from the panel implementations so
// the startup bundle does not pull every settings panel into the landing page.
export const PANEL_META = {
  terrain: { label: 'Terrain', title: 'Terrain', desc: 'Shape and surface generation.', icon: PANEL_ICONS.terrain },
  noiseLayers: { label: 'Layers', title: 'Noise Layers', desc: 'Stack noise layers to shape terrain.', icon: PANEL_ICONS.noiseLayers },
  world: { label: 'World', title: 'World', desc: 'Layout, tiles, chunking and grid.', icon: PANEL_ICONS.world },
  planet: {
    label: 'Planet',
    title: 'Planet',
    desc: 'Spherical world style and summary.',
    studioLabel: 'Colors',
    studioTitle: 'Colors',
    studioDesc: 'Biome palette and terrain material colors.',
    icon: PANEL_ICONS.planet,
    modes: ['planet', 'studio', 'infinite'],
  },
  biomes: { label: 'Biomes', title: 'Biomes', desc: 'Climate distribution and masks.', icon: PANEL_ICONS.biomes },
  water: { label: 'Water', title: 'Water', desc: 'Ocean surface, quality modes and volumetric settings.', icon: PANEL_ICONS.water },
  props: { label: 'Props', title: 'Props', desc: 'Procedural grass, flowers and rocks.', icon: PANEL_ICONS.props },
  clouds: { label: 'Clouds', title: 'Clouds', desc: 'Volumetric cloud layer.', icon: PANEL_ICONS.clouds },
  visuals: { label: 'Visuals', title: 'Visuals', desc: 'Tile post effects, HDR sky and terrain surface polish.', icon: PANEL_ICONS.visuals, modes: ['studio'] },
  skybox: { label: 'Skybox', title: 'Skybox', desc: 'Sky environment, time of day and atmosphere.', icon: PANEL_ICONS.skybox },
  lighting: { label: 'Lighting', title: 'Lighting', desc: 'Sun, atmosphere and fog.', icon: PANEL_ICONS.lighting },
  export: { label: 'Export', title: 'Export', desc: 'Export meshes and textures.', icon: PANEL_ICONS.export },
  performance: { label: 'Performance', title: 'Performance', desc: 'GPU, water, fog and cloud budgets.', icon: PANEL_ICONS.performance },
  debug: { label: 'Debug', title: 'Debug', desc: 'Live stats and diagnostics.', icon: PANEL_ICONS.debug },
  splines: { label: 'Splines', title: 'Splines', desc: 'Editable roads and rivers.', icon: PANEL_ICONS.splines, modes: ['studio'] },
  history: { label: 'History', title: 'History', desc: 'Creator checkpoints and actions.', icon: PANEL_ICONS.history },
};

export const PANEL_ORDER = ['terrain', 'noiseLayers', 'splines', 'biomes', 'water', 'props', 'clouds', 'visuals', 'skybox', 'lighting', 'planet', 'export', 'world', 'performance', 'debug'];

export function panelAvailable(id, worldMode) {
  const meta = PANEL_META[id];
  if (!meta) return false;
  return !meta.modes || meta.modes.includes(worldMode);
}

export function getPanelDisplay(id, worldMode) {
  const meta = PANEL_META[id];
  if (!meta) return { label: id, title: id, desc: '' };
  if (worldMode !== 'planet' && meta.studioLabel) {
    return {
      label: meta.studioLabel,
      title: meta.studioTitle ?? meta.studioLabel,
      desc: meta.studioDesc ?? meta.desc,
    };
  }
  return { label: meta.label, title: meta.title, desc: meta.desc };
}
