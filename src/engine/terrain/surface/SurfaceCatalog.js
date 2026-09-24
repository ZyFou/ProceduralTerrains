// Shared by the offline pack builder, editor, worker and project serializer.
const rows = [
  ['aerial_grass_rock','Rocky grassland','meso','core','Grass'],
  ['rock_boulder_dry','Dry pale rock','detail','core','Rock'],
  ['brown_mud','Brown soil','detail','core','Earth'],
  ['forest_ground_04','Forest ground','detail','core','Forest'],
  ['forest_leaves_02','Forest litter','detail','core','Forest'],
  ['mossy_rock','Mossy rock','detail','core','Rock'],
  ['brown_mud_dry','Dry granular soil','detail','core','Earth'],
  ['brown_mud_leaves_01','Soil with leaves','detail','extended','Earth'],
  ['sand_03','Coastal sand','detail','core','Sand'],
  ['sand_02','Marked sand','detail','extended','Paths'],
  ['sandstone_cracks','Cracked sandstone','detail','core','Rock'],
  ['rock_face','Brown-red rock face','detail','core','Rock'],
  ['river_small_rocks','River gravel','detail','core','Banks'],
  ['aerial_rocks_02','Aerial rock massif','macro','extended','Rock'],
  ['rock_boulder_cracked','Cracked orange rock','detail','extended','Rock'],
  ['rocky_terrain_02','Rocky grass terrain','macro','extended','Grass'],
  ['snow_02','Fresh snow','detail','core','Snow'],
  ['snow_01','Trodden snow','detail','extended','Paths'],
  ['grass_path_2','Grass path','detail','extended','Paths'],
  ['Ground037','Mossy ground','detail','core','Grass'],
  ['Grass004','Short grass','detail','core','Grass'],
  ['red_sand','Marked red sand','detail','extended','Paths'],
];
export const SURFACE_ASSETS = rows.map(([sourceId,name,scaleClass,distribution,category]) => {
  const provider = /^[A-Z]/.test(sourceId) ? 'ambientcg' : 'polyhaven';
  return { id: `${provider}:${sourceId}`, sourceId, provider, name, scaleClass, distribution, category,
    origin: sourceId === 'Grass004' ? 'procedural' : 'photogrammetry',
    naturalFill: category !== 'Paths', physicalSize: null, license: 'CC0-1.0',
    sourceUrl: provider === 'polyhaven' ? `https://polyhaven.com/a/${sourceId}` : `https://ambientcg.com/a/${sourceId}` };
});
const ph = (id) => `polyhaven:${id}`;
const ac = (id) => `ambientcg:${id}`;
export const SURFACE_RECIPES = [
  ['dry-grass','Dry sparse grass',[ac('Grass004'),ph('brown_mud_dry')],[1.12,0.94,0.68],0],
  ['tundra-ground','Mineral tundra',[ph('aerial_grass_rock'),ph('mossy_rock')],[1,1,1],0],
  ['jungle-floor','Damp tropical floor',[ac('Ground037'),ph('forest_leaves_02')],[0.85,0.94,0.8],0.25],
  ['wet-mud','Wet mud',[ph('brown_mud'),ph('brown_mud_leaves_01')],[0.7,0.7,0.7],0.45],
  ['canyon-red-stone','Red canyon sandstone',[ph('sandstone_cracks')],[1.1,0.52,0.32],0],
  ['volcanic-dark-rock','Stylized volcanic rock',[ph('rock_boulder_cracked')],[0.23,0.24,0.26],0],
  ['alien-mineral','Alien mineral',[ph('rock_boulder_dry')],[0.62,0.38,0.88],0],
  ['dune-sand','Pale dune sand',[ph('sand_03')],[3.2,3.5,4.0],0],
  ['powder-snow','Bright powder snow',[ph('snow_02')],[2.2,2.2,2.2],0],
].map(([id,name,assets,tint,wetness]) => ({id:`pt:${id}`,name,assets,tint,wetness,derived:true}));
export const DEFAULT_SURFACE_ROLES = {
  sand:'pt:dune-sand', dune:'pt:dune-sand', dryGrass:ph('brown_mud_dry'), grass:ac('Ground037'),
  forest:ph('forest_ground_04'), jungle:ph('forest_leaves_02'), swamp:ph('brown_mud'), tundra:ph('aerial_grass_rock'),
  redRock:ph('rock_face'), redRock2:ph('rock_boulder_cracked'), rock:ph('rock_boulder_dry'),
  rockHi:ph('rock_face'), snow:'pt:powder-snow',
};
export const SURFACE_PROFILES = {
  eco:{resolution:512,contributions:2,budgetBytes:96*1024**2},
  standard:{resolution:1024,contributions:4,budgetBytes:256*1024**2},
  quality:{resolution:2048,contributions:8,budgetBytes:512*1024**2},
};
