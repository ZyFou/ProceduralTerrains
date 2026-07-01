export const SURFACE_TEXTURE_VARIANT_COUNT = 4;

export const SURFACE_TEXTURE_ROLE_GROUPS = [
  {
    id: 'beach',
    label: 'Beach',
    roles: [
      { id: 'sand', label: 'Sand', tiling: 18 },
      { id: 'dune', label: 'Dune', tiling: 20 },
    ],
  },
  {
    id: 'vegetation',
    label: 'Vegetation',
    roles: [
      { id: 'dryGrass', label: 'Dry Grass', tiling: 14 },
      { id: 'grass', label: 'Grass', tiling: 12 },
      { id: 'forest', label: 'Forest', tiling: 11 },
      { id: 'jungle', label: 'Jungle', tiling: 10 },
      { id: 'swamp', label: 'Swamp', tiling: 9 },
      { id: 'tundra', label: 'Tundra', tiling: 13 },
    ],
  },
  {
    id: 'rock',
    label: 'Rock',
    roles: [
      { id: 'redRock', label: 'Red Rock', tiling: 7 },
      { id: 'redRock2', label: 'Red Rock B', tiling: 7 },
      { id: 'rock', label: 'Rock', tiling: 6 },
      { id: 'rockHi', label: 'High Rock', tiling: 6 },
    ],
  },
  {
    id: 'snow',
    label: 'Snow',
    roles: [
      { id: 'snow', label: 'Snow', tiling: 10 },
    ],
  },
];

export const SURFACE_TEXTURE_ROLES = SURFACE_TEXTURE_ROLE_GROUPS.flatMap((group) =>
  group.roles.map((role) => ({ ...role, groupId: group.id, groupLabel: group.label }))
);

export const SURFACE_TEXTURE_LAYERS = SURFACE_TEXTURE_ROLES.map((role) => role.id);
export const SURFACE_TEXTURE_ROLE_COUNT = SURFACE_TEXTURE_ROLES.length;
export const SURFACE_TEXTURE_ROWS = SURFACE_TEXTURE_ROLE_COUNT * SURFACE_TEXTURE_VARIANT_COUNT;

export function surfaceVariantKey(variantIndex = 0) {
  const index = Math.max(0, Math.min(SURFACE_TEXTURE_VARIANT_COUNT - 1, Number(variantIndex) || 0));
  return `custom:v${index}`;
}

export function surfaceAtlasRow(roleIndex, variantIndex) {
  return roleIndex * SURFACE_TEXTURE_VARIANT_COUNT + variantIndex;
}
