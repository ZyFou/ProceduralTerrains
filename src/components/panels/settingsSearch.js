const SETTINGS_INDEX = [
  // Terrain — presets (shape preset also carries the cartoon palette/noise)
  { panelId: 'terrain', tabId: 'shape', sectionLabel: 'Shape', settingId: 'terrain.preset', label: 'Terrain Preset', keywords: 'preset style layout highlands alpine desert dunes canyon volcanic rolling archipelago cartoon', aliases: 'cartoon toon preset' },
  { panelId: 'terrain', tabId: 'noise', sectionLabel: 'Noise', settingId: 'terrain.noisePreset', label: 'Noise Preset', keywords: 'noise preset style cartoon simple flat low relief default', aliases: 'cartoon toon' },

  // Terrain — erosion (Tile mode only)
  { panelId: 'terrain', tabId: 'erosion', sectionLabel: 'Erosion', settingId: 'erosion.erosionEnabled', label: 'Enable Erosion', keywords: 'erosion hydraulic thermal weathering bake apply rivers valleys carve' },
  { panelId: 'terrain', tabId: 'erosion', sectionLabel: 'Erosion', settingId: 'erosion.erosionPreset', label: 'Erosion Preset', keywords: 'erosion preset natural mountain canyon rain thermal lite dry' },
  { panelId: 'terrain', tabId: 'erosion', sectionLabel: 'Erosion', settingId: 'erosion.erosionQuality', label: 'Erosion Quality', keywords: 'erosion quality resolution grid bake preview balanced high ultra' },
  { panelId: 'terrain', tabId: 'erosion', sectionLabel: 'Erosion', settingId: 'erosion.erosionStrength', label: 'Erosion Strength', keywords: 'erosion strength blend amount master mix' },
  { panelId: 'terrain', tabId: 'erosion', sectionLabel: 'Erosion', settingId: 'erosion.erosionDroplets', label: 'Droplets', keywords: 'erosion droplets rain hydraulic valleys ravines channels' },
  { panelId: 'terrain', tabId: 'erosion', sectionLabel: 'Erosion', settingId: 'erosion.erosionLifetime', label: 'Droplet Lifetime', keywords: 'erosion droplet lifetime steps travel' },
  { panelId: 'terrain', tabId: 'erosion', sectionLabel: 'Erosion', settingId: 'erosion.erosionSeed', label: 'Erosion Seed', keywords: 'erosion seed random droplet spawn deterministic' },
  { panelId: 'terrain', tabId: 'erosion', sectionLabel: 'Erosion · Advanced', settingId: 'erosion.erosionRadius', label: 'Erosion Radius', keywords: 'erosion radius brush channels smoothing advanced' },
  { panelId: 'terrain', tabId: 'erosion', sectionLabel: 'Erosion · Advanced', settingId: 'erosion.erosionErosionRate', label: 'Erosion Rate', keywords: 'erosion rate carve aggressive water advanced' },
  { panelId: 'terrain', tabId: 'erosion', sectionLabel: 'Erosion · Advanced', settingId: 'erosion.erosionDeposition', label: 'Deposition', keywords: 'erosion deposition sediment settle advanced' },
  { panelId: 'terrain', tabId: 'erosion', sectionLabel: 'Erosion · Advanced', settingId: 'erosion.erosionSedimentCapacity', label: 'Sediment Capacity', keywords: 'erosion sediment capacity carry advanced' },
  { panelId: 'terrain', tabId: 'erosion', sectionLabel: 'Erosion · Advanced', settingId: 'erosion.erosionEvaporation', label: 'Evaporation', keywords: 'erosion evaporation water drainage advanced' },
  { panelId: 'terrain', tabId: 'erosion', sectionLabel: 'Erosion · Advanced', settingId: 'erosion.erosionGravity', label: 'Gravity', keywords: 'erosion gravity downhill droplet advanced' },
  { panelId: 'terrain', tabId: 'erosion', sectionLabel: 'Erosion · Advanced', settingId: 'erosion.erosionInertia', label: 'Inertia', keywords: 'erosion inertia direction slope advanced' },
  { panelId: 'terrain', tabId: 'erosion', sectionLabel: 'Erosion · Advanced', settingId: 'erosion.erosionThermalStrength', label: 'Thermal Strength', keywords: 'erosion thermal strength talus slide slope advanced' },
  { panelId: 'terrain', tabId: 'erosion', sectionLabel: 'Erosion · Advanced', settingId: 'erosion.erosionThermalIterations', label: 'Thermal Iterations', keywords: 'erosion thermal iterations relaxation talus advanced' },
  { panelId: 'terrain', tabId: 'erosion', sectionLabel: 'Erosion · Advanced', settingId: 'erosion.erosionTalus', label: 'Talus Angle', keywords: 'erosion talus angle slope slide steepness advanced' },
  { panelId: 'terrain', tabId: 'erosion', sectionLabel: 'Erosion · Advanced', settingId: 'erosion.erosionSmoothing', label: 'Smoothing', keywords: 'erosion smoothing low pass soften noise advanced' },

  // Terrain
  { panelId: 'terrain', tabId: 'shape', sectionLabel: 'Shape', settingId: 'terrain.heightScale', label: 'Height Scale', keywords: 'height elevation mountain terrain amplitude', aliases: 'height map height noise' },
  { panelId: 'terrain', tabId: 'shape', sectionLabel: 'Shape', settingId: 'terrain.seaLevel', label: 'Sea Level', keywords: 'water ocean coast shoreline sea' },
  { panelId: 'terrain', tabId: 'noise', sectionLabel: 'Noise', settingId: 'terrain.noiseScale', label: 'Noise Scale', keywords: 'height noise detail fractal terrain' },
  { panelId: 'terrain', tabId: 'noise', sectionLabel: 'Noise', settingId: 'terrain.noiseStrength', label: 'Noise Strength', keywords: 'height noise amplitude terrain' },
  { panelId: 'terrain', tabId: 'noise', sectionLabel: 'Noise', settingId: 'terrain.octaves', label: 'Octaves', keywords: 'height noise detail fbm terrain' },
  { panelId: 'terrain', tabId: 'noise', sectionLabel: 'Noise', settingId: 'terrain.persistence', label: 'Persistence', keywords: 'height noise roughness fbm' },
  { panelId: 'terrain', tabId: 'noise', sectionLabel: 'Noise', settingId: 'terrain.lacunarity', label: 'Lacunarity', keywords: 'height noise frequency fbm' },
  { panelId: 'terrain', tabId: 'noise', sectionLabel: 'Noise', settingId: 'terrain.ridge', label: 'Ridge Intensity', keywords: 'height noise ridge mountain alpine' },
  { panelId: 'terrain', tabId: 'noise', sectionLabel: 'Noise', settingId: 'terrain.warp', label: 'Domain Warp', keywords: 'height noise warp fold distortion' },
  { panelId: 'terrain', tabId: 'noise', sectionLabel: 'Noise', settingId: 'terrain.falloff', label: 'Edge Falloff Width', keywords: 'height coast island edge falloff' },
  { panelId: 'terrain', tabId: 'surface', sectionLabel: 'Surface', settingId: 'terrain.normalStrength', label: 'Normal Strength', keywords: 'surface shading detail normals' },
  { panelId: 'terrain', tabId: 'surface', sectionLabel: 'Surface', settingId: 'terrain.aoStrength', label: 'Ambient Occlusion', keywords: 'surface shading crevice darkening' },
  { panelId: 'terrain', tabId: 'import', sectionLabel: 'Import', settingId: 'terrain.heightMap', label: 'Height Map', keywords: 'height import replace blend map' },
  { panelId: 'terrain', tabId: 'import', sectionLabel: 'Import', settingId: 'terrain.noiseMap', label: 'Noise Map', keywords: 'noise import replace blend map' },
  { panelId: 'terrain', tabId: 'import', sectionLabel: 'Import', settingId: 'terrain.biomeMap', label: 'Biome Map', keywords: 'biome import replace blend map' },

  // Biomes
  { panelId: 'biomes', settingId: 'biomes.biomeScale', label: 'Biome Density', keywords: 'biome density distribution climate map' },
  { panelId: 'biomes', settingId: 'biomes.tempBias', label: 'Temperature', keywords: 'biome climate heat cold' },
  { panelId: 'biomes', settingId: 'biomes.moistScale', label: 'Moisture Scale', keywords: 'biome climate humidity wet dry' },
  { panelId: 'biomes', settingId: 'biomes.moistBias', label: 'Moisture Bias', keywords: 'biome climate humidity wet dry' },
  { panelId: 'biomes', settingId: 'biomes.snowLine', label: 'Snow Line', keywords: 'biome climate snow altitude' },
  { panelId: 'biomes', settingId: 'biomes.biomeDebug', label: 'Biome Debug', keywords: 'biome debug overlay inspection' },

  // World
  { panelId: 'world', settingId: 'world.chunkCount', label: 'Chunk Count', keywords: 'world grid streaming tiles' },
  { panelId: 'world', settingId: 'world.chunkSize', label: 'Chunk Size', keywords: 'world grid streaming tiles' },
  { panelId: 'world', settingId: 'world.chunkGrid', label: 'Chunk Grid', keywords: 'world grid debug overlay' },
  { panelId: 'world', settingId: 'world.tileAssemblyShape', label: 'Tile Shape', keywords: 'tiles square circle assembly disk' },
  { panelId: 'world', settingId: 'world.planetRadius', label: 'Planet Radius', keywords: 'planet sphere radius curvature' },
  { panelId: 'world', settingId: 'world.planetFaceGrid', label: 'Surface Detail', keywords: 'planet face grid chunk detail' },

  // Water
  { panelId: 'water', settingId: 'water.waterEnabled', label: 'Water Enabled', keywords: 'water ocean enable disable' },
  { panelId: 'water', settingId: 'water.seaLevel', label: 'Sea Level', keywords: 'water ocean sea level height coast' },
  { panelId: 'water', settingId: 'water.waterMode', label: 'Water Mode', keywords: 'water legacy realistic volumetric cinematic quality cartoon tropical ocean lake', aliases: 'cartoon toon' },
  { panelId: 'water', settingId: 'water.waterAnim', label: 'Water Animation', keywords: 'water waves ocean motion' },
  { panelId: 'water', settingId: 'water.waterDebugView', label: 'Water Debug View', keywords: 'water debug depth foam shoreline mask' },

  // Planet style / colors
  { panelId: 'planet', sectionLabel: 'Palette', settingId: 'planet.palettePreset', label: 'Color Palette Preset', keywords: 'palette preset colors theme earth desert ice toxic neon volcanic cartoon pastel moon rust', aliases: 'cartoon toon colors palette' },
  { panelId: 'planet', sectionLabel: 'Water', settingId: 'planet.water.deep', label: 'Deep Water', keywords: 'water color ocean deep' },
  { panelId: 'planet', sectionLabel: 'Water', settingId: 'planet.water.shallow', label: 'Shallow', keywords: 'water color shore coast shallow' },
  { panelId: 'planet', sectionLabel: 'Water', settingId: 'planet.water.foam', label: 'Foam', keywords: 'water color waves foam shoreline' },
  { panelId: 'planet', sectionLabel: 'Palette', settingId: 'planet.paletteSaturation', label: 'Saturation', keywords: 'palette color tuning contrast' },
  { panelId: 'planet', sectionLabel: 'Palette', settingId: 'planet.paletteContrast', label: 'Contrast', keywords: 'palette color tuning contrast' },

  // Performance
  { panelId: 'performance', tabId: 'overview', settingId: 'performance.preset', label: 'Preset', keywords: 'quality profile performance' },
  { panelId: 'performance', tabId: 'overview', settingId: 'performance.rendererBackend', label: 'Renderer Backend', keywords: 'gpu renderer backend webgl webgpu auto graphics' },
  { panelId: 'performance', tabId: 'overview', settingId: 'performance.gpuPreference', label: 'GPU Preference', keywords: 'gpu power preference high performance low power dedicated battery' },
  { panelId: 'performance', tabId: 'overview', settingId: 'performance.useWorker', label: 'Worker Renderer', keywords: 'offscreen canvas worker renderer experimental main thread' },
  { panelId: 'performance', tabId: 'overview', settingId: 'performance.autoPerf', label: 'Auto Performance Mode', keywords: 'automatic fps performance' },
  { panelId: 'performance', tabId: 'overview', settingId: 'performance.onDemandStudio', label: 'Pause When Idle', keywords: 'idle redraw battery performance' },
  { panelId: 'performance', tabId: 'overview', settingId: 'performance.renderScale', label: 'Render Scale', keywords: 'resolution pixel dpr scale' },
  { panelId: 'performance', tabId: 'lod', settingId: 'performance.resolutionScale', label: 'Terrain Resolution', keywords: 'lod mesh detail' },
  { panelId: 'performance', tabId: 'lod', settingId: 'performance.lodDistanceScale', label: 'LOD Distance Scale', keywords: 'lod distance scale' },
  { panelId: 'performance', tabId: 'streaming', settingId: 'performance.viewRadius', label: 'Chunk Load Radius', keywords: 'streaming load radius chunks' },
  { panelId: 'performance', tabId: 'terrain', settingId: 'performance.terrainDetailQuality', label: 'Terrain Detail Quality', keywords: 'terrain material texture detail walk first person close' },
  { panelId: 'performance', tabId: 'terrain', settingId: 'performance.terrainDetailOpacity', label: 'Detail Opacity', keywords: 'terrain detail opacity master mix amount overall fade blend' },
  { panelId: 'performance', tabId: 'terrain', settingId: 'performance.terrainDetailScale', label: 'Detail Texture Scale', keywords: 'terrain noise texture scale grain world space' },
  { panelId: 'performance', tabId: 'terrain', settingId: 'performance.terrainDetailStrength', label: 'Detail Strength', keywords: 'terrain albedo biome close detail' },
  { panelId: 'performance', tabId: 'terrain', settingId: 'performance.terrainDetailNormal', label: 'Detail Normal Strength', keywords: 'terrain normal lighting bump close material' },
  { panelId: 'performance', tabId: 'terrain', settingId: 'performance.terrainMicroDetail', label: 'Micro Detail', keywords: 'terrain micro grain speckle crisp close up high frequency' },
  { panelId: 'performance', tabId: 'terrain', settingId: 'performance.terrainMacroVariation', label: 'Macro Variation', keywords: 'terrain macro variation weathering patches biome breakup large scale' },
  { panelId: 'performance', tabId: 'terrain', settingId: 'performance.terrainDetailFar', label: 'Distance Detail Fade', keywords: 'terrain detail fade near far distance' },
  { panelId: 'performance', tabId: 'terrain', settingId: 'performance.terrainRockSlope', label: 'Rock Slope Blend', keywords: 'terrain slope rock cliff blend triplanar' },
  { panelId: 'performance', tabId: 'terrain', settingId: 'performance.terrainTriplanar', label: 'Triplanar Detail', keywords: 'terrain cliff projection stretching triplanar' },
  { panelId: 'performance', tabId: 'terrain', settingId: 'performance.terrainShoreRange', label: 'Shoreline Detail', keywords: 'terrain shore wet sand mud coastline water edge' },
  { panelId: 'performance', tabId: 'water', settingId: 'performance.waterQuality', label: 'Water Quality', keywords: 'water quality reflection detail' },
  { panelId: 'performance', tabId: 'water', settingId: 'performance.waterReflection', label: 'Water Reflection', keywords: 'water specular reflection' },
  { panelId: 'performance', tabId: 'water', settingId: 'performance.waterDetail', label: 'Water Detail', keywords: 'water ripple detail' },
  { panelId: 'performance', tabId: 'water', settingId: 'performance.waterWaves', label: 'Wave Strength', keywords: 'water waves motion complexity' },
  { panelId: 'performance', tabId: 'water', settingId: 'performance.underwaterEffect', label: 'Underwater Effect', keywords: 'water underwater fog tint' },
  { panelId: 'performance', tabId: 'water', settingId: 'performance.waterDistance', label: 'Water Distance', keywords: 'water range fade' },
  { panelId: 'performance', tabId: 'fog', settingId: 'performance.fogDistance', label: 'Fog Distance', keywords: 'fog atmosphere visibility' },
  { panelId: 'performance', tabId: 'clouds', settingId: 'performance.cloudSteps', label: 'Raymarch Steps', keywords: 'cloud steps quality performance' },
  { panelId: 'performance', tabId: 'clouds', settingId: 'performance.cloudLightSteps', label: 'Shadow Steps', keywords: 'cloud shadow steps performance' },
  { panelId: 'performance', tabId: 'clouds', settingId: 'performance.cloudOctaves', label: 'Base Noise Octaves', keywords: 'cloud noise octaves' },
  { panelId: 'performance', tabId: 'clouds', settingId: 'performance.cloudDetailOctaves', label: 'Detail Noise Octaves', keywords: 'cloud noise detail octaves' },
  { panelId: 'performance', tabId: 'clouds', settingId: 'performance.cloudMaxDistance', label: 'Max Distance', keywords: 'cloud distance visibility culling' },

  // Sky / lighting
  { panelId: 'skybox', settingId: 'skybox.timeOfDay', label: 'Time of Day', keywords: 'sun sky day night time' },
  { panelId: 'skybox', settingId: 'skybox.skyboxBrightness', label: 'Sky Brightness', keywords: 'sky atmosphere brightness' },
  { panelId: 'skybox', settingId: 'skybox.skyboxHaze', label: 'Horizon Haze', keywords: 'sky atmosphere haze' },
  { panelId: 'skybox', settingId: 'skybox.skyboxStars', label: 'Night Stars', keywords: 'sky stars night' },
  { panelId: 'lighting', settingId: 'lighting.sunAzimuth', label: 'Sun Azimuth', keywords: 'sun lighting direction' },
  { panelId: 'lighting', settingId: 'lighting.sunElevation', label: 'Sun Elevation', keywords: 'sun lighting direction' },
  { panelId: 'lighting', settingId: 'lighting.sunColor', label: 'Sun Color', keywords: 'sun lighting color' },
  { panelId: 'lighting', settingId: 'lighting.sunIntensity', label: 'Sun Intensity', keywords: 'sun lighting brightness' },
  { panelId: 'lighting', settingId: 'lighting.fogDensity', label: 'Fog Density', keywords: 'fog atmosphere density' },
  { panelId: 'lighting', settingId: 'lighting.skyAmbient', label: 'Sky Ambient', keywords: 'ambient sky bounce lighting' },
  { panelId: 'lighting', settingId: 'lighting.groundBounce', label: 'Ground Bounce', keywords: 'bounce lighting shadow' },

  // Clouds / props / debug / export
  { panelId: 'clouds', sectionLabel: 'Shape', settingId: 'clouds.cloudCoverage', label: 'Coverage', keywords: 'cloud density cover sky shape' },
  { panelId: 'clouds', sectionLabel: 'Shape', settingId: 'clouds.cloudDensity', label: 'Density', keywords: 'cloud thickness opacity shape' },
  { panelId: 'clouds', sectionLabel: 'Shape', settingId: 'clouds.cloudSoftness', label: 'Softness', keywords: 'cloud edge softness shape' },
  { panelId: 'clouds', settingId: 'clouds.cloudsEnabled', label: 'Enable Clouds', keywords: 'cloud volumetric sky enable' },
  { panelId: 'props', sectionLabel: 'Distribution', settingId: 'props.propsDensity', label: 'Density', keywords: 'props grass flowers rocks density scatter' },
  { panelId: 'props', sectionLabel: 'Distribution', settingId: 'props.propsFlowers', label: 'Flower Mix', keywords: 'props flowers meadow scatter' },
  { panelId: 'props', sectionLabel: 'Distribution', settingId: 'props.propsRocks', label: 'Rock Mix', keywords: 'props rocks boulders stones terrain color' },
  { panelId: 'props', sectionLabel: 'Look', settingId: 'props.propsGrass', label: 'Grass Scale', keywords: 'props grass scale patch blades biome color' },
  { panelId: 'props', sectionLabel: 'Look', settingId: 'props.propsRockScale', label: 'Rock Scale', keywords: 'props rocks scale boulders stones' },
  { panelId: 'props', sectionLabel: 'Look', settingId: 'props.propsWind', label: 'Wind', keywords: 'props animation grass flower wind sway' },
  { panelId: 'props', sectionLabel: 'Look', settingId: 'props.propsWindSpeed', label: 'Animation Speed', keywords: 'props animation speed wind sway' },
  { panelId: 'props', sectionLabel: 'Look', settingId: 'props.propsGust', label: 'Gust Motion', keywords: 'props animation gust wind sway' },
  { panelId: 'debug', settingId: 'debug.autoUpdate', label: 'Auto Update', keywords: 'debug generation rebuild' },
  { panelId: 'debug', settingId: 'debug.freezeCulling', label: 'Freeze Culling', keywords: 'debug culling freeze' },
  { panelId: 'debug', settingId: 'debug.freezeLod', label: 'Freeze LOD', keywords: 'debug lod freeze' },
  { panelId: 'debug', settingId: 'debug.forceRender', label: 'Force Render', keywords: 'debug render fps' },
  { panelId: 'debug', settingId: 'debug.disableHeightBake', label: 'Disable Height Bake', keywords: 'debug height bake' },
  { panelId: 'debug', settingId: 'debug.terrainDetailDebug', label: 'Terrain Material Debug', keywords: 'debug terrain detail slope rock shoreline normal albedo' },
  { panelId: 'export', settingId: 'export.format', label: 'Format', keywords: 'export file glb obj' },
];

const SECTION_INDEX = [
  // Water
  { panelId: 'water', sectionLabel: 'Mode', settingId: 'water.section.mode', label: 'Mode', keywords: 'water mode enable sea level', isSection: true },
  { panelId: 'water', sectionLabel: 'Shader Quality', settingId: 'water.section.shader', label: 'Shader Quality', keywords: 'water shader quality reflection detail waves', isSection: true },
  { panelId: 'water', sectionLabel: 'Material', settingId: 'water.section.material', label: 'Material', keywords: 'water material animation colors', isSection: true },
  { panelId: 'water', sectionLabel: 'Depth', settingId: 'water.section.depth', label: 'Depth', keywords: 'water depth absorption shallow deep', isSection: true },
  { panelId: 'water', sectionLabel: 'Waves', settingId: 'water.section.waves', label: 'Waves', keywords: 'water waves animation motion', isSection: true },
  { panelId: 'water', sectionLabel: 'Foam', settingId: 'water.section.foam', label: 'Foam', keywords: 'water foam shoreline', isSection: true },
  { panelId: 'water', sectionLabel: 'Underwater', settingId: 'water.section.underwater', label: 'Underwater', keywords: 'water underwater fog caustics', isSection: true },

  // Clouds
  { panelId: 'clouds', sectionLabel: 'Shape', settingId: 'clouds.section.shape', label: 'Shape', keywords: 'cloud shape coverage density softness', isSection: true },
  { panelId: 'clouds', sectionLabel: 'Shell', settingId: 'clouds.section.shell', label: 'Shell', keywords: 'cloud altitude thickness shell layer', isSection: true },
  { panelId: 'clouds', sectionLabel: 'Noise', settingId: 'clouds.section.noise', label: 'Noise', keywords: 'cloud noise erosion detail scale', isSection: true },
  { panelId: 'clouds', sectionLabel: 'Motion', settingId: 'clouds.section.motion', label: 'Motion', keywords: 'cloud wind rotation evolve motion', isSection: true },
  { panelId: 'clouds', sectionLabel: 'Lighting', settingId: 'clouds.section.lighting', label: 'Lighting', keywords: 'cloud lighting shadow scattering color', isSection: true },
  { panelId: 'clouds', sectionLabel: 'Performance', settingId: 'clouds.section.performance', label: 'Performance', keywords: 'cloud performance resolution distance steps', isSection: true },

  // Lighting
  { panelId: 'lighting', sectionLabel: 'Sun', settingId: 'lighting.section.sun', label: 'Sun', keywords: 'sun lighting azimuth elevation color intensity', isSection: true },
  { panelId: 'lighting', sectionLabel: 'Atmosphere', settingId: 'lighting.section.atmosphere', label: 'Atmosphere', keywords: 'atmosphere fog ambient bounce lighting', isSection: true },

  // Skybox
  { panelId: 'skybox', sectionLabel: 'Time of Day', settingId: 'skybox.section.time', label: 'Time of Day', keywords: 'sky time day night sun', isSection: true },
  { panelId: 'skybox', sectionLabel: 'Appearance', settingId: 'skybox.section.appearance', label: 'Appearance', keywords: 'sky brightness haze stars appearance', isSection: true },

  // Props
  { panelId: 'props', sectionLabel: 'Distribution', settingId: 'props.section.distribution', label: 'Distribution', keywords: 'props grass flowers rocks density distribution', isSection: true },
  { panelId: 'props', sectionLabel: 'Look', settingId: 'props.section.look', label: 'Look', keywords: 'props grass rock look scale animation wind', isSection: true },
  { panelId: 'props', sectionLabel: 'Performance', settingId: 'props.section.performance', label: 'Performance', keywords: 'props cull lod performance distance', isSection: true },

  // Export
  { panelId: 'export', sectionLabel: 'Format & Resolution', settingId: 'export.section.format', label: 'Format & Resolution', keywords: 'export format mesh resolution glb', isSection: true },
  { panelId: 'export', sectionLabel: 'Texture Baking', settingId: 'export.section.textures', label: 'Texture Baking', keywords: 'export texture bake color normal', isSection: true },
  { panelId: 'export', sectionLabel: 'Additional Assets', settingId: 'export.section.assets', label: 'Additional Assets', keywords: 'export heightmap collision assets', isSection: true },
  { panelId: 'export', sectionLabel: 'Water Maps', settingId: 'export.section.waterMaps', label: 'Water Maps', keywords: 'export water mask depth shoreline foam', isSection: true },

  // Planet
  { panelId: 'planet', sectionLabel: 'Preset', settingId: 'planet.section.preset', label: 'Preset', keywords: 'planet style preset', isSection: true },
  { panelId: 'planet', sectionLabel: 'Palette', settingId: 'planet.section.palette', label: 'Palette', keywords: 'planet palette colors biomes', isSection: true },
];

const FULL_SETTINGS_INDEX = [...SETTINGS_INDEX, ...SECTION_INDEX];

const normalizeText = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

function scoreEntry(entry, q, tokens) {
  const haystack = normalizeText([
    entry.label,
    entry.sectionLabel,
    entry.panelId,
    entry.keywords,
    entry.aliases,
  ].filter(Boolean).join(' '));
  if (!haystack || !haystack.includes(q)) {
    if (!tokens.every((token) => haystack.includes(token))) return 0;
  }

  let score = 0;
  const label = normalizeText(entry.label);
  const section = normalizeText(entry.sectionLabel);
  const aliases = normalizeText(entry.aliases);

  if (label === q) score += 1200;
  if (label.startsWith(q)) score += 600;
  if (label.includes(q)) score += 300;
  if (section && section === q) score += 500;
  if (section && section.includes(q)) score += 120;
  if (aliases && aliases.includes(q)) score += 180;
  if (haystack.startsWith(q)) score += 80;
  score += Math.max(0, 60 - haystack.indexOf(q));
  for (const token of tokens) {
    if (label.includes(token)) score += 40;
    if (section.includes(token)) score += 20;
    if (aliases.includes(token)) score += 30;
  }

  return score;
}

export function searchSettings(query, isPanelAvailable = () => true) {
  const q = normalizeText(query);
  if (!q) return [];

  const tokens = q.split(/\s+/).filter(Boolean);
  return FULL_SETTINGS_INDEX
    .map((entry) => {
      if (!isPanelAvailable(entry.panelId)) return null;
      const score = scoreEntry(entry, q, tokens);
      if (!score) return null;
      return { ...entry, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

export { SETTINGS_INDEX, SECTION_INDEX, FULL_SETTINGS_INDEX };
