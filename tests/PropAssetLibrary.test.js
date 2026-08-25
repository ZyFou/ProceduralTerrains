import { describe, expect, it } from 'vitest';
import {
  PROP_ASSET_PRESETS,
  assetDensityForType,
  createDefaultPropAssets,
  createPropAsset,
  normalizePropAssetLibrary,
  selectPropAsset,
} from '../src/engine/props/PropAssetLibrary.js';

describe('terrain prop asset library', () => {
  it('ships one editable default asset for every optimized prop family', () => {
    const defaults = createDefaultPropAssets();
    expect(defaults).toHaveLength(5);
    expect(defaults.map((asset) => asset.type)).toEqual([
      'grass', 'flower', 'rock', 'broadleaf', 'conifer',
    ]);
    expect(new Set(defaults.map((asset) => asset.id)).size).toBe(defaults.length);
    expect(PROP_ASSET_PRESETS.length).toBeGreaterThanOrEqual(15);
  });

  it('sanitizes saved assets, preserves an intentionally empty library, and repairs duplicate ids', () => {
    expect(normalizePropAssetLibrary([])).toEqual([]);
    const assets = normalizePropAssetLibrary([
      { id: 'rock', preset: 'granite-rock', type: 'rock', name: '', density: 9, scale: -1, color: 'bad' },
      { id: 'rock', preset: 'sandstone-rock', type: 'rock', width: 9, height: 0 },
    ]);
    expect(assets[0]).toMatchObject({ id: 'rock', name: 'Granite Rock', density: 2, scale: 0.25, color: '#77756f' });
    expect(assets[1]).toMatchObject({ id: 'rock-2', width: 1.6, height: 0.5 });
  });

  it('uses mix weights to select variants deterministically', () => {
    const grass = createPropAsset('meadow-grass', 'a');
    const wild = { ...createPropAsset('wild-grass', 'b'), density: 0.25 };
    const assets = [grass, wild];
    expect(assetDensityForType(assets, 'grass')).toBe(1.25);
    expect(selectPropAsset(assets, 0)).toBe(grass);
    expect(selectPropAsset(assets, 0.99)).toBe(wild);
    expect(selectPropAsset(assets, 0.99)).toBe(selectPropAsset(assets, 0.99));
  });

  it('lets disabling or removing all assets of a family suppress that family', () => {
    const defaults = createDefaultPropAssets();
    const disabledRocks = defaults.map((asset) => asset.type === 'rock' ? { ...asset, enabled: false } : asset);
    expect(assetDensityForType(disabledRocks, 'rock')).toBe(0);
    expect(assetDensityForType(defaults.filter((asset) => asset.type !== 'conifer'), 'conifer')).toBe(0);
  });
});
