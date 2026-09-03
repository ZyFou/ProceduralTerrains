import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import {
  ShaderBenchmarkRunner,
  classifyShaderBenchmarkRole,
  parseShaderBenchmarkOptions,
  selectShaderBenchmarkCandidates,
} from '../src/engine/render/ShaderBenchmark.js';

const require = createRequire(import.meta.url);
const {
  addShaderBenchmarkQuery,
  parseShaderBenchmarkArgv,
} = require('../electron/shader-benchmark.cjs');

describe('shader benchmark options', () => {
  it('accepts browser family modes and makes an explicit cold key win', () => {
    const options = parseShaderBenchmarkOptions(
      '?shaderBenchmark=terrain&shaderBenchmarkToken=repeat-1&coldShaderRun=old',
      { randomToken: () => 'unused' },
    );
    expect(options).toMatchObject({
      mode: 'isolated',
      requestedFamily: 'terrain',
      token: 'repeat-1',
      explicitToken: true,
      coldShaderRunIgnored: true,
    });
    expect(options.defineValue).toBeGreaterThan(0);
  });

  it('generates tokens, accepts the suite, and rejects invalid modes', () => {
    expect(parseShaderBenchmarkOptions('?shaderBenchmark=all', {
      randomToken: () => 'generated-token',
    })).toMatchObject({ mode: 'suite', token: 'generated-token' });
    expect(parseShaderBenchmarkOptions('?shaderBenchmark=everything')).toBeNull();
    expect(parseShaderBenchmarkOptions('')).toBeNull();
  });

  it('sanitizes initial Electron arguments before adding them to the URL', () => {
    const options = parseShaderBenchmarkArgv([
      'ProceduralTerrains.exe',
      '--shader-benchmark=water',
      '--shader-benchmark-token=a token?<unsafe>',
    ]);
    expect(options).toEqual({ family: 'water', token: 'a-token--unsafe-' });
    expect(addShaderBenchmarkQuery('procedural-terrain://app/index.html', options))
      .toBe('procedural-terrain://app/index.html?shaderBenchmark=water&shaderBenchmarkToken=a-token--unsafe-');
    expect(parseShaderBenchmarkArgv(['app.exe', '--shader-benchmark=invalid'])).toBeNull();
  });
});

describe('shader benchmark candidate selection', () => {
  it.each([
    ['terrain:base', 'terrain'],
    ['infinite-terrain:clipmap', 'terrain'],
    ['planet-terrain', 'terrain'],
    ['water:realistic', 'water'],
    ['cloud:composite', 'cloud'],
    ['post:camera', 'post'],
    ['MeshStandardMaterial', 'scene'],
  ])('classifies %s as %s', (role, family) => {
    expect(classifyShaderBenchmarkRole(role)).toBe(family);
  });

  it('deduplicates variants and keeps fixed suite family order', () => {
    const material = { id: 1 };
    const candidates = [
      { key: 'same', material, role: 'water:legacy' },
      { key: 'same', material, role: 'water:legacy' },
      { key: 'terrain', material: { id: 2 }, role: 'terrain:base' },
      { key: 'post', material: { id: 3 }, role: 'post:look' },
    ];
    expect(selectShaderBenchmarkCandidates(candidates, {
      mode: 'suite', requestedFamily: 'all',
    }).map(({ family }) => family)).toEqual(['terrain', 'water', 'post']);
  });
});

describe('ShaderBenchmarkRunner', () => {
  it('runs a suite sequentially and records absent families as skips', async () => {
    const order = [];
    const logger = { info: vi.fn(), table: vi.fn() };
    const runner = new ShaderBenchmarkRunner({
      compileCase: async (candidate) => {
        order.push(candidate.family);
        return { status: 'passed', submitMs: 1, driverWaitMs: 2, validationMs: 3, totalMs: 6 };
      },
      now: (() => { let value = 0; return () => ++value; })(),
      wallNow: () => '2026-09-02T00:00:00.000Z',
      logger,
    });
    const result = await runner.run({
      options: {
        mode: 'suite', requestedFamily: 'all', token: 'run', defineValue: 3,
        explicitToken: true, coldShaderRunIgnored: false,
      },
      candidates: [
        { material: { id: 2 }, key: 'water', role: 'water:legacy', family: 'water' },
        { material: { id: 1 }, key: 'terrain', role: 'terrain:base', family: 'terrain' },
      ],
    });
    expect(order).toEqual(['terrain', 'water']);
    expect(result.status).toBe('passed');
    expect(result.cases.filter(({ status }) => status === 'skipped')).toHaveLength(3);
    expect(result.aggregate.measuredPrograms).toBe(2);
    expect(result.warning).toContain('do not predict');
    expect(logger.table).toHaveBeenCalledTimes(1);
  });

  it('stops the suite at the first failed program', async () => {
    const compileCase = vi.fn(async () => ({ status: 'failed', contextLost: true }));
    const result = await new ShaderBenchmarkRunner({
      compileCase,
      logger: { info: vi.fn(), table: vi.fn() },
    }).run({
      options: {
        mode: 'suite', requestedFamily: 'all', token: 'run', defineValue: 3,
        explicitToken: true, coldShaderRunIgnored: false,
      },
      candidates: [
        { material: { id: 1 }, key: 'terrain', role: 'terrain:base', family: 'terrain' },
        { material: { id: 2 }, key: 'water', role: 'water:legacy', family: 'water' },
      ],
    });
    expect(compileCase).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'failed', contextLost: true });
  });
});
