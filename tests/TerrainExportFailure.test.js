import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { unzipSync } from 'fflate';
import { TerrainExporter } from '../src/engine/terrain/TerrainExporter.js';
import { serializeGlb } from '../src/export/ExportEncoding.js';
import { saveBlob } from '../src/platform/DesktopBridge.js';

vi.mock('../src/export/ExportEncoding.js', () => ({ serializeGlb: vi.fn(), canvasPngBytes: vi.fn() }));
vi.mock('../src/platform/DesktopBridge.js', () => ({ saveBlob: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

function exportTerrain() {
  let target = null;
  const renderer = {
    isWebGLRenderer: true, render() {},
    getRenderTarget: () => target, setRenderTarget: (next) => { target = next; },
    readRenderTargetPixelsAsync: async () => {},
  };
  return TerrainExporter.export(renderer, { heightScale: 10, seaLevel: 0, octaves: 1, seed: 1 }, {}, 100,
    { format: 'glb', includeMesh: true, meshRes: 2 }, () => {});
}

describe('terrain export serialization integration', () => {
  it('releases model resources and does not save a partial ZIP on GLB failure', async () => {
    serializeGlb.mockRejectedValue(new Error('GLB failed'));
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const materialDispose = vi.spyOn(THREE.Material.prototype, 'dispose');
    await expect(exportTerrain()).rejects.toThrow('GLB failed');
    expect(geometryDispose.mock.instances.some((geometry) => geometry.getAttribute('position')?.count === 9)).toBe(true);
    expect(materialDispose.mock.instances.some((material) => material.name === 'Terrain_Material')).toBe(true);
    expect(saveBlob).not.toHaveBeenCalled();
  });
  it('still produces the requested model in a ZIP on success', async () => {
    const model = new Uint8Array([103, 108, 84, 70]);
    serializeGlb.mockResolvedValue(model);
    saveBlob.mockResolvedValue({ canceled: false });
    await exportTerrain();
    const blob = saveBlob.mock.calls[0][0];
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(files['terrain.glb']).toEqual(model);
  });
});
