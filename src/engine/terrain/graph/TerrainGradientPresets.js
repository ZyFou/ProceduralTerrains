export const TERRAIN_GRADIENT_PRESETS = Object.freeze({
  alpine: Object.freeze({
    label: 'Alpine satellite',
    description: 'Cool valley greens, weathered stone, pale granite, and restrained snow.',
    colors: Object.freeze(['#25362f', '#59634e', '#766f62', '#b7b0a2']),
    points: Object.freeze([0, 0.28, 0.62, 0.86]),
    variation: 0.16,
    macroScale: 0.42,
  }),
  temperate: Object.freeze({
    label: 'Temperate highlands',
    description: 'Deep forest, muted grass, exposed earth, and lichen-grey summits.',
    colors: Object.freeze(['#1e3128', '#40563b', '#746b52', '#aaa596']),
    points: Object.freeze([0, 0.25, 0.58, 0.88]),
    variation: 0.2,
    macroScale: 0.36,
  }),
  arid: Object.freeze({
    label: 'Arid plateau',
    description: 'Dusty basin sediment, ochre shelves, iron-rich rock, and sun-bleached caps.',
    colors: Object.freeze(['#6b5844', '#927055', '#8a5841', '#c0aa8b']),
    points: Object.freeze([0, 0.3, 0.63, 0.9]),
    variation: 0.18,
    macroScale: 0.5,
  }),
  volcanic: Object.freeze({
    label: 'Volcanic field',
    description: 'Basalt lowlands, charcoal lava, oxidized scoria, and ash-grey ridges.',
    colors: Object.freeze(['#171a18', '#2d302c', '#55443a', '#928b7f']),
    points: Object.freeze([0, 0.32, 0.64, 0.9]),
    variation: 0.22,
    macroScale: 0.55,
  }),
  coastal: Object.freeze({
    label: 'Coastal range',
    description: 'Damp coastal scrub, dense foothills, cool stone, and high cloud-washed rock.',
    colors: Object.freeze(['#34483e', '#4d6049', '#74766c', '#aaa99f']),
    points: Object.freeze([0, 0.27, 0.6, 0.87]),
    variation: 0.18,
    macroScale: 0.38,
  }),
  river: Object.freeze({
    label: 'River valley',
    description: 'Dark wet channels, silty banks, muted floodplain vegetation, and cool weathered uplands.',
    colors: Object.freeze(['#183a38', '#536448', '#81745a', '#9b9b91']),
    points: Object.freeze([0, 0.22, 0.58, 0.88]),
    variation: 0.2,
    macroScale: 0.34,
  }),
  canyon: Object.freeze({
    label: 'Sedimentary canyon',
    description: 'Shadowed canyon floors, oxidized sandstone walls, pale shelves, and sun-bleached rims.',
    colors: Object.freeze(['#3a302b', '#76503c', '#a06d48', '#c4a57f']),
    points: Object.freeze([0, 0.24, 0.64, 0.9]),
    variation: 0.22,
    macroScale: 0.48,
  }),
  dunes: Object.freeze({
    label: 'Windblown desert',
    description: 'Cool trough shadow, warm dune bodies, ochre slip faces, and pale sunlit crests.',
    colors: Object.freeze(['#6a5541', '#a47b50', '#c79a62', '#e0c18e']),
    points: Object.freeze([0, 0.24, 0.62, 0.88]),
    variation: 0.16,
    macroScale: 0.56,
  }),
});

export const TERRAIN_GRADIENT_OPTIONS = Object.freeze(Object.entries(TERRAIN_GRADIENT_PRESETS)
  .map(([value, preset]) => Object.freeze({ value, label: preset.label })));

export function getTerrainGradientPreset(id) {
  return TERRAIN_GRADIENT_PRESETS[id] || TERRAIN_GRADIENT_PRESETS.alpine;
}

export function terrainGradientCss(id) {
  const preset = getTerrainGradientPreset(id);
  return `linear-gradient(90deg, ${preset.colors.map((color, index) => `${color} ${Math.round(preset.points[index] * 100)}%`).join(', ')})`;
}
