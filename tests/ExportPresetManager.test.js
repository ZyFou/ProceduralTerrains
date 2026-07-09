import { describe, expect, it } from 'vitest';
import { applyExportPreset, getExportPreset } from '../src/export/ExportPresetManager.js';
import { hasExportErrors, validateExport } from '../src/export/ExportValidator.js';

describe('production export presets', () => {
  it('sets Unity defaults and production package paths', () => {
    const options = applyExportPreset({ format: 'obj', texRes: '512' }, 'unity');
    expect(options.exportHeightmap).toBe(true);
    expect(options.heightmapRawPath).toBe('Terrain/heightmap.raw');
    expect(options.packagePaths['textures/terrain_splat.png']).toBe('Terrain/splatmaps/biomes.png');
  });

  it('keeps a safe custom preset fallback', () => {
    expect(applyExportPreset({ format: 'obj' }, 'nope').exportPresetId).toBe('custom');
    expect(getExportPreset('three').label).toBe('Three.js Viewer Assets');
  });

  it('blocks packages with no primary terrain asset', () => {
    const checks = validateExport({ includeMesh: false, exportHeightmap: false }, { boardSize: 1000 });
    expect(hasExportErrors(checks)).toBe(true);
  });
});
