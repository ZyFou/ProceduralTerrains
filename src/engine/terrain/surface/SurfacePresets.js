import { createSurfaceDocument } from './SurfaceDocument.js';
export const SURFACE_PRESETS=[
  {id:'alpine',name:'Alpine',roles:{grass:'ambientcg:Ground037',rock:'polyhaven:rock_boulder_dry',snow:'pt:powder-snow'}},
  {id:'forest',name:'Forest',roles:{grass:'polyhaven:forest_ground_04',forest:'polyhaven:forest_leaves_02',rock:'polyhaven:mossy_rock'}},
  {id:'canyon',name:'Canyon',roles:{rock:'polyhaven:rock_face',rockHi:'polyhaven:rock_boulder_cracked',sand:'polyhaven:sand_03'}},
  {id:'dunes',name:'Dunes',roles:{sand:'pt:dune-sand',dune:'pt:dune-sand',rock:'polyhaven:sandstone_cracks'}},
  {id:'marsh',name:'Marsh',roles:{grass:'pt:wet-mud',forest:'pt:jungle-floor',swamp:'pt:wet-mud'}},
  {id:'tundra',name:'Tundra',roles:{grass:'pt:tundra-ground',tundra:'pt:tundra-ground',rock:'polyhaven:mossy_rock'}},
  {id:'volcanic',name:'Volcanic (artistic)',roles:{rock:'pt:volcanic-dark-rock',rockHi:'pt:volcanic-dark-rock',redRock:'pt:volcanic-dark-rock'}},
  {id:'alien',name:'Alien (artistic)',roles:{rock:'pt:alien-mineral',grass:'pt:alien-mineral',rockHi:'pt:alien-mineral'}},
];
export function applySurfacePreset(document,id){const preset=SURFACE_PRESETS.find(p=>p.id===id);if(!preset)throw new Error(`Unknown surface preset ${id}`);const doc=createSurfaceDocument(document);return {...doc,roles:{...doc.roles,...preset.roles},settings:{...doc.settings,paletteInfluence:0},presetId:id};}
