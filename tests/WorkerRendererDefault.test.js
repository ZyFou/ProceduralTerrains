import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPerfSettings,
  loadPerfSettings,
} from '../src/engine/render/PerformanceSettings.js';

const STORAGE_KEY = 'terrain-studio-perf-v1';

function installStorage(value) {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key) => (key === STORAGE_KEY ? value : null)),
    setItem: vi.fn(),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('worker renderer defaults', () => {
  it('uses the worker for new settings', () => {
    expect(createPerfSettings('high')).toMatchObject({
      useWorker: true,
      workerPreferenceExplicit: false,
    });
  });

  it('migrates the old passive false default to the worker', () => {
    installStorage(JSON.stringify({ preset: 'high', useWorker: false }));
    expect(loadPerfSettings()).toMatchObject({
      useWorker: true,
      workerPreferenceExplicit: false,
    });
  });

  it('preserves an explicit compatibility opt-out', () => {
    installStorage(JSON.stringify({
      preset: 'high',
      useWorker: false,
      workerPreferenceExplicit: true,
    }));
    expect(loadPerfSettings()).toMatchObject({
      useWorker: false,
      workerPreferenceExplicit: true,
    });
  });
});
