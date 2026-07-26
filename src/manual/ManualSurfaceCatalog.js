export const MANUAL_SURFACE_MATERIALS = Object.freeze([
  { id: 'grass', label: 'Grass', channel: 0, roleIndex: 3, roleId: 'grass', assetId: 'grass', color: 0x65a85b },
  { id: 'rock', label: 'Rock', channel: 1, roleIndex: 10, roleId: 'rock', assetId: 'rock', color: 0x8b8f97 },
  { id: 'sand', label: 'Sand', channel: 2, roleIndex: 0, roleId: 'sand', assetId: 'sand', color: 0xd8bd73 },
  { id: 'snow', label: 'Snow', channel: 3, roleIndex: 12, roleId: 'snow', assetId: 'snow', color: 0xe8eef4 },
  { id: 'mud', label: 'Mud', channel: 4, roleIndex: 6, roleId: 'swamp', assetId: 'mud', color: 0x735743 },
  { id: 'volcanic', label: 'Volcanic', channel: 5, roleIndex: 8, roleId: 'redRock', assetId: 'volcanic', color: 0x793e34 },
  { id: 'alien', label: 'Alien', channel: 6, roleIndex: 9, roleId: 'redRock2', assetId: 'alien', color: 0x7b5ac7 },
]);

export const MANUAL_SURFACE_MATERIAL_IDS = new Set(MANUAL_SURFACE_MATERIALS.map((material) => material.id));

export const MANUAL_SURFACE_ASSET_BY_ROLE = Object.freeze({
  sand: 'sand',
  dune: 'sand',
  dryGrass: 'grass',
  grass: 'grass',
  forest: 'grass',
  jungle: 'grass',
  swamp: 'mud',
  tundra: 'grass',
  redRock: 'volcanic',
  redRock2: 'alien',
  rock: 'rock',
  rockHi: 'rock',
  snow: 'snow',
});

export function getManualSurfaceMaterial(id) {
  return MANUAL_SURFACE_MATERIALS.find((material) => material.id === id) ?? MANUAL_SURFACE_MATERIALS[0];
}

export function manualSurfaceDiffuseUrl(material) {
  const item = typeof material === 'string' ? getManualSurfaceMaterial(material) : material;
  return `/textures/terrain/${item.assetId}/base/${item.assetId}_diffuse.jpg`;
}
