import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { exportError } from '../src/export/ExportDiagnostics.js';
import { validateExport, hasExportErrors } from '../src/export/ExportValidator.js';

// Exercise the actual entry method with minimal renderer/engine dependencies.
const source = readFileSync(new URL('../src/engine/Engine.js', import.meta.url), 'utf8');
const start = source.indexOf('  async export3DTerrain(options) {');
const end = source.indexOf('\n  async _splineMaskZipFiles()', start);
const method = source.slice(start, end).trim().replace('async export3DTerrain(', 'async function(');

describe('engine export failure reporting', () => {
  it('reports an undefined rejection, preserves failed task status, and restores rendering', async () => {
    const run = vm.runInNewContext(`(${method})`, {
      exportError, validateExport, hasExportErrors, createProductionFiles: () => ({}), console: { error: vi.fn() },
    });
    const previousTarget = {};
    const engine = {
      worldMode: 'studio', boardSize: 100, tileAssemblyShape: 'square', tiles: [{ cx: 0, cz: 0 }],
      params: {}, createProjectPayload: () => ({}),
      renderer: { getRenderTarget: () => previousTarget, setRenderTarget: vi.fn() },
      cb: { onToast: vi.fn(), onStatus: vi.fn() },
      profiler: { registerLoadingTask: () => 1, updateLoadingTask: vi.fn(), failLoadingTask: vi.fn(), finishLoadingTask: vi.fn() },
      _unionWidth: () => 100, _unionDepth: () => 100, _unionCenter: () => ({ x: 0, z: 0 }),
      waterSystem: { exportMasks: () => Promise.reject(undefined) },
    };
    await expect(run.call(engine, { includeMesh: true, exportWaterMask: true })).rejects.toThrow('without an error message');
    expect(engine.cb.onToast).toHaveBeenLastCalledWith(expect.stringContaining('Export failed:'));
    expect(engine.profiler.failLoadingTask).toHaveBeenCalledOnce();
    expect(engine.profiler.finishLoadingTask).not.toHaveBeenCalled();
    expect(engine._exporting).toBe(false);
    expect(engine.renderer.setRenderTarget).toHaveBeenLastCalledWith(previousTarget);
  });
});
