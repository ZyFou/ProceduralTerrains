import { describe, expect, it } from 'vitest';
import {
  WATER_DEFAULT_PARAMS,
  isWaterModeDowngraded,
  migrateWaterParams,
  resolveEffectiveWaterMode,
} from '../src/engine/water/WaterSettings.js';

describe('water settings compatibility and safeguards', () => {
  it('migrates enabled legacy saves without changing their other values', () => {
    const saved = {
      waterEnabled: true,
      seaLevel: 82,
      waterOpacity: 0.61,
    };

    expect(migrateWaterParams(saved)).toEqual({
      ...saved,
      waterMode: 'legacy',
    });
    expect(saved).not.toHaveProperty('waterMode');
  });

  it('migrates disabled or dry legacy saves to off', () => {
    expect(migrateWaterParams({
      waterEnabled: false,
      seaLevel: 82,
    })).toMatchObject({
      waterEnabled: false,
      waterMode: 'off',
    });
    expect(migrateWaterParams({
      waterEnabled: true,
      seaLevel: 0,
    })).toMatchObject({
      waterEnabled: false,
      waterMode: 'off',
    });
  });

  it('leaves already migrated saves unchanged', () => {
    const saved = {
      waterEnabled: true,
      waterMode: 'cinematic',
      seaLevel: 90,
    };

    expect(migrateWaterParams(saved)).toBe(saved);
  });

  it('maps expensive modes to the supported renderer for each world type', () => {
    const cinematic = {
      waterEnabled: true,
      waterMode: 'cinematic',
      waterAutoDowngradeInfinite: true,
      seaLevel: 100,
    };

    expect(resolveEffectiveWaterMode(cinematic, 'studio')).toBe('cinematic');
    expect(resolveEffectiveWaterMode(cinematic, 'infinite')).toBe('realistic');
    expect(resolveEffectiveWaterMode(cinematic, 'planet')).toBe('legacy');
    expect(isWaterModeDowngraded(cinematic, 'infinite')).toBe(true);
    expect(isWaterModeDowngraded(cinematic, 'studio')).toBe(false);

    expect(resolveEffectiveWaterMode({
      ...cinematic,
      waterAutoDowngradeInfinite: false,
    }, 'infinite')).toBe('cinematic');
  });

  it('keeps valid defaults for lazy water targets and diagnostics', () => {
    expect(WATER_DEFAULT_PARAMS).toMatchObject({
      waterReflectionQuality: 1,
      waterRefractionQuality: 0.6,
      waterRenderScale: 1,
      waterUpdateFrequency: 1,
      waterShowPerfCost: false,
      waterUnderwaterCausticMinDepth: 1,
      waterUnderwaterCausticMinDepthFalloff: 1,
      waterBiomeColorEnabled: true,
      waterBiomeColorStrength: 0.55,
    });
    expect(WATER_DEFAULT_PARAMS.waterRenderScale).toBeGreaterThan(0);
    expect([1, 2, 4]).toContain(WATER_DEFAULT_PARAMS.waterUpdateFrequency);
  });
});
