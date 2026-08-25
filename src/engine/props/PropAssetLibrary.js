const TYPES = ['grass', 'flower', 'rock', 'broadleaf', 'conifer'];

export const PROP_ASSET_TYPES = Object.freeze([
  { id: 'grass', label: 'Grass' },
  { id: 'flower', label: 'Flowers' },
  { id: 'rock', label: 'Rocks' },
  { id: 'broadleaf', label: 'Broadleaf trees' },
  { id: 'conifer', label: 'Conifer trees' },
]);

export const PROP_ASSET_PRESETS = Object.freeze([
  { id: 'meadow-grass', name: 'Meadow Grass', type: 'grass', color: '#79a95b', scale: 1, width: 1.08, height: 0.9 },
  { id: 'wild-grass', name: 'Wild Grass', type: 'grass', color: '#91a85b', scale: 1, width: 0.9, height: 1.28 },
  { id: 'dry-grass', name: 'Dry Grass', type: 'grass', color: '#b09a58', scale: 1, width: 0.98, height: 1.05 },
  { id: 'wildflowers', name: 'Wildflowers', type: 'flower', color: '#e8899e', scale: 1, width: 1, height: 1 },
  { id: 'lavender', name: 'Lavender', type: 'flower', color: '#a58ada', scale: 1, width: 0.82, height: 1.2 },
  { id: 'golden-flowers', name: 'Golden Flowers', type: 'flower', color: '#e6bd59', scale: 1, width: 1.05, height: 0.9 },
  { id: 'granite-rock', name: 'Granite Rock', type: 'rock', color: '#77756f', scale: 1, width: 1, height: 1 },
  { id: 'sandstone-rock', name: 'Sandstone Rock', type: 'rock', color: '#a96f49', scale: 1, width: 1.18, height: 0.82 },
  { id: 'basalt-rock', name: 'Basalt Rock', type: 'rock', color: '#4f5558', scale: 1, width: 0.82, height: 1.22 },
  { id: 'oak-tree', name: 'Oak Tree', type: 'broadleaf', color: '#5f8d4e', scale: 1, width: 1.12, height: 0.94 },
  { id: 'birch-tree', name: 'Birch Tree', type: 'broadleaf', color: '#83a95d', scale: 1, width: 0.8, height: 1.16 },
  { id: 'autumn-tree', name: 'Autumn Tree', type: 'broadleaf', color: '#b46c3d', scale: 1, width: 1.04, height: 1 },
  { id: 'pine-tree', name: 'Pine Tree', type: 'conifer', color: '#446f51', scale: 1, width: 0.88, height: 1.12 },
  { id: 'spruce-tree', name: 'Spruce Tree', type: 'conifer', color: '#385f4c', scale: 1, width: 1.04, height: 0.98 },
  { id: 'snow-conifer', name: 'Snow Conifer', type: 'conifer', color: '#73918a', scale: 1, width: 0.96, height: 1.08 },
]);

const DEFAULT_PRESET_IDS = ['meadow-grass', 'wildflowers', 'granite-rock', 'oak-tree', 'pine-tree'];

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function validColor(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export function getPropAssetPreset(id) {
  return PROP_ASSET_PRESETS.find((preset) => preset.id === id) || PROP_ASSET_PRESETS[0];
}

export function createPropAsset(presetId, id = null) {
  const preset = getPropAssetPreset(presetId);
  return {
    id: id || `${preset.type}-${Date.now().toString(36)}`,
    preset: preset.id,
    name: preset.name,
    type: preset.type,
    enabled: true,
    density: 1,
    scale: preset.scale,
    width: preset.width,
    height: preset.height,
    color: preset.color,
  };
}

export function createDefaultPropAssets() {
  // Keep the first-run library inside the physical metre ranges defined by
  // propCatalog. Users can deliberately reshape or replace these afterwards.
  return DEFAULT_PRESET_IDS.map((id) => ({ ...createPropAsset(id, id), width: 1, height: 1 }));
}

export function normalizePropAsset(raw, index = 0) {
  const rawPreset = getPropAssetPreset(raw?.preset);
  const type = TYPES.includes(raw?.type) ? raw.type : rawPreset.type;
  const fallbackPreset = rawPreset.type === type
    ? rawPreset
    : PROP_ASSET_PRESETS.find((preset) => preset.type === type);
  return {
    id: typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : `${type}-asset-${index}`,
    preset: fallbackPreset.id,
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 48) : fallbackPreset.name,
    type,
    enabled: raw?.enabled !== false,
    density: clamp(raw?.density, 0, 2, 1),
    scale: clamp(raw?.scale, 0.25, 2.5, fallbackPreset.scale),
    width: clamp(raw?.width, 0.5, 1.6, fallbackPreset.width),
    height: clamp(raw?.height, 0.5, 1.6, fallbackPreset.height),
    color: validColor(raw?.color, fallbackPreset.color),
  };
}

export function normalizePropAssetLibrary(value) {
  const source = Array.isArray(value) ? value : createDefaultPropAssets();
  const seen = new Set();
  return source.map((raw, index) => {
    const asset = normalizePropAsset(raw, index);
    let id = asset.id;
    let suffix = 2;
    while (seen.has(id)) id = `${asset.id}-${suffix++}`;
    seen.add(id);
    return { ...asset, id };
  });
}

export function propAssetLibrarySignature(value) {
  return JSON.stringify(normalizePropAssetLibrary(value));
}

export function enabledAssetsForType(value, type) {
  return normalizePropAssetLibrary(value).filter((asset) => asset.type === type && asset.enabled && asset.density > 0);
}

export function assetDensityForType(value, type) {
  return Math.min(2, enabledAssetsForType(value, type).reduce((sum, asset) => sum + asset.density, 0));
}

export function selectPropAsset(assets, roll) {
  if (!assets.length) return null;
  const total = assets.reduce((sum, asset) => sum + asset.density, 0);
  let cursor = Math.max(0, Math.min(0.999999, roll)) * total;
  for (const asset of assets) {
    cursor -= asset.density;
    if (cursor <= 0) return asset;
  }
  return assets[assets.length - 1];
}

export function propAssetColorRGB(asset) {
  const hex = validColor(asset?.color, '#ffffff').slice(1);
  return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
}
