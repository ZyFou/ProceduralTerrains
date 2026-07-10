import { describe, expect, it } from 'vitest';
import { normalizeProject, projectStats } from '../src/project/ProjectStore.js';

describe('project document migration', () => {
  it('wraps legacy terrain JSON in a versioned project document', () => {
    const project = normalizeProject({ params: { seed: 42, chunkCount: 16, chunkSize: 128 } });
    expect(project.schemaVersion).toBe(1);
    expect(project.metadata.name).toBe('Untitled terrain');
    expect(project.terrain.params.seed).toBe(42);
  });

  it('preserves supplied metadata and reports terrain size', () => {
    const project = normalizeProject({ metadata: { name: 'Ridge', tags: ['alpine'], thumbnail: 'data:image/webp;base64,thumb' }, terrain: { params: { seed: 7, chunkCount: 32, chunkSize: 128 }, tiles: [{}, {}] } });
    expect(project.metadata.name).toBe('Ridge');
    expect(project.metadata.thumbnail).toBe('data:image/webp;base64,thumb');
    expect(projectStats(project)).toMatchObject({ seed: 7, tiles: 2, worldSize: 4096 });
  });
});
