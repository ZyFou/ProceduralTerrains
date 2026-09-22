import { describe, expect, it, vi } from 'vitest';
import { estimateExport, ExportDiagnostics, EXPORT_DIAGNOSTICS_KEY, exportError } from '../src/export/ExportDiagnostics.js';
import { validateExport } from '../src/export/ExportValidator.js';

const defaults = { format: 'glb', includeMesh: true, meshRes: 512, texRes: 2048, bakeColor: true, bakeNormal: true };
const context = { worldMode: 'studio', boardSize: 1000, tiles: [{ cx: 0, cz: 0 }] };
describe('export workload warnings', () => {
  it('warns on 4K + 1024 mesh and counts tiles; physical width alone does not increase the estimate', () => {
    expect(estimateExport(defaults, context).large).toBe(false);
    const high = { ...defaults, meshRes: 1024, texRes: 4096 };
    expect(estimateExport(high, context).large).toBe(true);
    expect(validateExport(high, context).some((check) => check.status === 'warning' && check.message.includes('100 MB'))).toBe(true);
    expect(estimateExport(defaults, { ...context, boardSize: 100_000 })).toEqual(estimateExport(defaults, context));
    expect(estimateExport(defaults, { ...context, tiles: Array(9).fill({}) }).large).toBe(true);
  });
  it('counts six planet faces, height-only maps, collision and separate tile maps', () => {
    expect(estimateExport(defaults, { worldMode: 'planet' }).count).toBe(6);
    expect(estimateExport({ includeMesh: false, exportHeightmap: true, texRes: 4096 }, context).vertices).toBe(0);
    const multi = { ...context, tiles: Array(4).fill({}) };
    expect(estimateExport({ ...defaults, exportTileMode: 'separate' }, multi).assetBytes).toBeGreaterThan(estimateExport(defaults, multi).assetBytes);
    expect(estimateExport({ ...defaults, exportCollision: true }, context).assetBytes).toBeGreaterThan(estimateExport(defaults, context).assetBytes);
  });
});

function fixture() {
  let time = 1000;
  const data = new Map();
  const storage = { getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const diagnostics = new ExportDiagnostics({ storage, now: () => time, logger });
  return { diagnostics, storage, logger, advance: (ms) => { time += ms; } };
}
describe('export diagnostics lifecycle', () => {
  it('preserves the stage on reload and distinguishes interruption from a confirmed crash', () => {
    const { diagnostics, storage } = fixture();
    diagnostics.start({ options: defaults });
    diagnostics.stage('Baking normals');
    const recovered = new ExportDiagnostics({ storage });
    expect(recovered.report.status).toBe('interrupted');
    expect(recovered.report.stage).toBe('Baking normals');
    expect(recovered.report.message).toContain('cannot be confirmed');
    diagnostics.finish();
    expect(new ExportDiagnostics({ storage }).report.status).toBe('complete');
  });
  it('flags a stalled stage without finishing it, warns once, then resumes on progress', () => {
    const { diagnostics, advance, logger } = fixture();
    diagnostics.start({});
    advance(60_000);
    diagnostics.checkStall();
    diagnostics.checkStall();
    expect(diagnostics.report.status).toBe('running');
    expect(diagnostics.report.stalled).toBe(true);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    diagnostics.stage('Saving');
    expect(diagnostics.report.stalled).toBe(false);
    diagnostics.finish(new Error('Disk full'));
    advance(60_000);
    diagnostics.checkStall();
    expect(diagnostics.report.status).toBe('failed');
  });
  it('normalizes undefined/null/string failures and survives blocked storage', () => {
    for (const reason of [undefined, null, 'Failed']) expect(exportError(reason)).toBeInstanceOf(Error);
    const storage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } };
    const diagnostics = new ExportDiagnostics({ storage, logger: { info() {}, error() {} } });
    expect(() => { diagnostics.start({}); diagnostics.finish(exportError(undefined)); }).not.toThrow();
    expect(diagnostics.report.status).toBe('failed');
  });
  it('retains error details and bounded timestamped events', () => {
    const { diagnostics, storage } = fixture();
    diagnostics.start({});
    for (let i = 0; i < 110; i++) diagnostics.stage(`Tile ${i}`);
    diagnostics.finish(Object.assign(new Error('GPU lost'), { code: 'GPU_READBACK_FAILED' }));
    const saved = JSON.parse(storage.getItem(EXPORT_DIAGNOSTICS_KEY));
    expect(saved.events).toHaveLength(100);
    expect(saved.error.code).toBe('GPU_READBACK_FAILED');
    expect(saved.error.stack).toContain('GPU lost');
  });
});
