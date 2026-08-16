import { describe, expect, it } from 'vitest';
import { applyExportPreset, createProductionFiles, getExportPreset } from '../src/export/ExportPresetManager.js';
import { hasExportErrors, validateExport } from '../src/export/ExportValidator.js';

describe('production export presets', () => {
  it('sets Unity defaults and production package paths', () => {
    const options = applyExportPreset({ format: 'obj', texRes: '512' }, 'unity');
    expect(options.exportHeightmap).toBe(true);
    expect(options.heightRes).toBe('1025');
    expect(options.heightmapVertexGrid).toBe(true);
    expect(options.exportTileMode).toBe('separate');
    expect(options.heightmapRawPath).toBe('Terrain/heightmap.raw');
    expect(options.runtimeDocumentPath).toBe('Terrain/project.ptrterrain');
    expect(options.packagePaths['textures/terrain_splat.png']).toBe('Terrain/splatmaps/biomes.png');
  });

  it('creates the canonical Unity runtime document instead of generic preset JSON', () => {
    const options = applyExportPreset({}, 'unity');
    const files = createProductionFiles(options, {
      seed: 7, boardSize: 1000, heightScale: 500, seaLevel: 80,
      worldMode: 'studio', projectMode: 'procedural', tileAssemblyShape: 'square',
      tiles: [{ cx: 0, cz: 0 }],
      projectPayload: {
        editorMode: 'procedural', worldMode: 'studio',
        params: { seed: 7, heightScale: 500, seaLevel: 80, surfaceTextureSource: 'procedural' },
      },
    });
    const runtime = JSON.parse(new TextDecoder().decode(files['Terrain/project.ptrterrain']));
    expect(runtime).toMatchObject({
      format: 'procedural-terrains', schemaVersion: 1,
      project: { mode: 'procedural', world: 'studio', seed: 7 },
    });
    expect(files['Terrain/terrain.json']).toBeUndefined();
    expect(files['Terrain/terrain_preset.json']).toBeUndefined();
  });

  it('exports the complete unsigned editor seed range to Unity', () => {
    const options = applyExportPreset({}, 'unity');
    const files = createProductionFiles(options, {
      seed: 0xffffffff, boardSize: 1000, heightScale: 500, seaLevel: 80,
      worldMode: 'studio', projectMode: 'procedural', tileAssemblyShape: 'square',
      tiles: [{ cx: 0, cz: 0 }],
      projectPayload: {
        editorMode: 'procedural', worldMode: 'studio',
        params: { seed: 0xffffffff, heightScale: 500, seaLevel: 80, surfaceTextureSource: 'procedural' },
      },
    });
    const runtime = JSON.parse(new TextDecoder().decode(files['Terrain/project.ptrterrain']));

    expect(runtime.project.seed).toBe(-1);
    expect(runtime.generation.seed).toBe(-1);
  });

  it('keeps a safe custom preset fallback', () => {
    expect(applyExportPreset({ format: 'obj' }, 'nope').exportPresetId).toBe('custom');
    expect(getExportPreset('three').label).toBe('Three.js Viewer Assets');
  });

  it('blocks packages with no primary terrain asset', () => {
    const checks = validateExport({ includeMesh: false, exportHeightmap: false }, { boardSize: 1000 });
    expect(hasExportErrors(checks)).toBe(true);
  });

  it('blocks unsupported Unity worlds and tile layouts', () => {
    const options = applyExportPreset({}, 'unity');
    expect(hasExportErrors(validateExport(options, {
      worldMode: 'planet', boardSize: 1000, tileAssemblyShape: 'square', tiles: [{ cx: 0, cz: 0 }],
    }))).toBe(true);
    expect(hasExportErrors(validateExport(options, {
      worldMode: 'studio', boardSize: 1000, tileAssemblyShape: 'circle', tiles: [{ cx: 0, cz: 0 }],
    }))).toBe(true);
    expect(hasExportErrors(validateExport({ ...options, exportTileMode: 'merged' }, {
      worldMode: 'studio', boardSize: 1000, tileAssemblyShape: 'square', tiles: [{ cx: 0, cz: 0 }, { cx: 1, cz: 0 }],
    }))).toBe(true);
  });

  it('requires the authoritative RAW heightfield for Unity exports', () => {
    const options = applyExportPreset({}, 'unity');
    const checks = validateExport({ ...options, exportHeightmap: false, includeMesh: true }, {
      worldMode: 'studio', boardSize: 1000, tileAssemblyShape: 'square', tiles: [{ cx: 0, cz: 0 }],
    });
    expect(hasExportErrors(checks)).toBe(true);
    expect(checks.some((check) => check.message.includes('RAW heightfield'))).toBe(true);
  });
});
