import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../src/engine/Engine.js';
import {
  REAL_WORLD_SOURCE_VERSION,
  createRealWorldSource,
  normalizeRealWorldSource,
  updateRealWorldSourceImageryStyle,
  updateRealWorldSourceSettings,
} from '../src/engine/terrain/RealWorldSource.js';

const sourceInput = {
  id: 'mont-blanc',
  name: 'Mont Blanc',
  bbox: { minLat: 45.78, maxLat: 45.92, minLon: 6.79, maxLon: 6.95 },
  zoom: 12,
  imageryStyle: 'satellite',
};

describe('real-world project source', () => {
  it('normalizes a JSON-safe descriptor with geographic import defaults', () => {
    const source = createRealWorldSource(sourceInput);

    expect(source).toEqual({
      version: REAL_WORLD_SOURCE_VERSION,
      ...sourceInput,
      heightSettings: {
        mode: 'replace',
        blend: 1,
        invert: false,
        normalize: false,
        heightStrength: 1,
        heightOffset: 0,
      },
      imagerySettings: { mode: 'replace', blend: 1 },
    });
    expect(normalizeRealWorldSource(JSON.parse(JSON.stringify(source)))).toEqual(source);
  });

  it('keeps only supported settings and rejects invalid geography', () => {
    const source = normalizeRealWorldSource({
      ...sourceInput,
      cells: { '0,0': { elev: new Float32Array([1, 2, 3]) } },
      preview: 'data:image/png;base64,pixels',
      heightSettings: {
        mode: 'blend',
        blend: 4,
        invert: true,
        normalize: true,
        heightStrength: -2,
        heightOffset: 900,
        texture: { gpu: true },
      },
      imagerySettings: { mode: 'preview', blend: -3, rgba: [1, 2, 3] },
    });

    expect(source.heightSettings).toEqual({
      mode: 'blend',
      blend: 1,
      invert: true,
      normalize: true,
      heightStrength: 0,
      heightOffset: 500,
    });
    expect(source.imagerySettings).toEqual({ mode: 'preview', blend: 0 });
    expect(source).not.toHaveProperty('cells');
    expect(source).not.toHaveProperty('preview');
    expect(normalizeRealWorldSource({ ...sourceInput, bbox: { ...sourceInput.bbox, minLat: 50 } })).toBeNull();
    expect(normalizeRealWorldSource({ ...sourceInput, version: 99 })).toBeNull();
  });

  it('tracks imagery style and live height/imagery controls', () => {
    let source = createRealWorldSource(sourceInput);
    source = updateRealWorldSourceSettings(source, 'height', {
      mode: 'blend',
      blend: 0.35,
      invert: true,
      normalize: true,
      heightStrength: 1.4,
      heightOffset: -32,
    });
    source = updateRealWorldSourceSettings(source, 'imagery', { mode: 'blend', blend: 0.62 });
    source = updateRealWorldSourceImageryStyle(source, 'opentopo');

    expect(source.imageryStyle).toBe('opentopo');
    expect(source.heightSettings).toMatchObject({
      mode: 'blend',
      blend: 0.35,
      invert: true,
      normalize: true,
      heightStrength: 1.4,
      heightOffset: -32,
    });
    expect(source.imagerySettings).toEqual({ mode: 'blend', blend: 0.62 });
  });

  it('serializes only the descriptor and omits every imported pixel cache', () => {
    const engine = Object.create(Engine.prototype);
    const source = createRealWorldSource(sourceInput);
    Object.assign(engine, {
      params: { seed: 7 },
      tiles: [{ cx: 0, cz: 0 }],
      tileAssemblyShape: 'square',
      circleRadiusCells: 0,
      projectMode: 'procedural',
      generationSource: 'classic',
      terrainGraph: null,
      graphView: { x: 0, y: 0, zoom: 1 },
      realWorldSource: {
        ...source,
        cells: { '0,0': { elev: new Float32Array([10, 20]) } },
        rgba: new Uint8Array([1, 2, 3, 4]),
        preview: 'data:image/png;base64,pixels',
      },
      importedMaps: {
        noise: { imageData: { data: new Uint8Array([1]) } },
        height: { floatData: new Float32Array([0.5]), texture: { gpu: true } },
        biome: { preview: 'data:image/png;base64,biome' },
        imagery: { rgba: new Uint8Array([1, 2, 3, 4]) },
      },
      paintMode: { serialize: () => null },
      projectHistory: { serializeMetadata: () => null },
      _serializeCreatorTools: () => ({ splines: [], analysis: {} }),
      _syncPlanetStyleToParams: vi.fn(),
    });

    const payload = engine.createProjectPayload();
    const serialized = JSON.stringify(payload);

    expect(payload.realWorldSource).toEqual(source);
    expect(payload).not.toHaveProperty('importedMaps');
    expect(serialized).not.toContain('floatData');
    expect(serialized).not.toContain('imageData');
    expect(serialized).not.toContain('rgba');
    expect(serialized).not.toContain('base64,pixels');
  });

  it('updates the saved descriptor when geographic controls change', async () => {
    const engine = Object.create(Engine.prototype);
    Object.assign(engine, {
      realWorldSource: createRealWorldSource(sourceInput),
      realWorldImageryStyle: 'satellite',
      worldMode: 'studio',
      importedMaps: {
        noise: null,
        height: {
          settings: {
            mode: 'replace',
            blend: 1,
            invert: false,
            normalize: false,
            heightStrength: 1,
            heightOffset: 0,
          },
        },
        biome: null,
        imagery: null,
      },
      cb: { onRealWorldImageryStyle: vi.fn() },
      _syncImportedMapUniforms: vi.fn(),
      _setImportState: vi.fn(),
      applyAll: vi.fn(),
      _rebuildImportedTexture: vi.fn(),
    });

    engine.setTileMapSetting('height', 'heightOffset', 88);
    await engine.setRealWorldImageryStyle('opentopo');

    expect(engine.realWorldSource.heightSettings.heightOffset).toBe(88);
    expect(engine.realWorldSource.imageryStyle).toBe('opentopo');
    expect(engine.cb.onRealWorldImageryStyle).toHaveBeenCalledWith('opentopo');
  });

  it('restores a custom geographic bbox through the normal fetch pipeline', async () => {
    const engine = Object.create(Engine.prototype);
    const source = createRealWorldSource({
      ...sourceInput,
      id: 'custom',
      name: 'Custom Alps area',
      imageryStyle: 'opentopo',
    });
    engine._loadRealWorldHeightmap = vi.fn(async () => true);

    await engine._restoreRealWorldSource(source);

    expect(engine._loadRealWorldHeightmap).toHaveBeenCalledWith({
      id: 'custom',
      name: 'Custom Alps area',
      bbox: source.bbox,
      zoom: 12,
    }, { persistedSource: source, silent: true });
  });
});
