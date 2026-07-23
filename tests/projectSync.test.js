import { describe, expect, it } from 'vitest';
import { buildUnifiedProjectIndex, getProjectSyncState, syncBindingFor } from '../src/project/projectSync.js';

const local = (id = 'local-1', modified = '2026-07-23T10:00:00.000Z') => ({
  id,
  metadata: { name: 'Alpine lake', description: 'A terrain', modified },
  terrain: { editorMode: 'procedural' },
});
const cloud = (id = 'cloud-1', revision = 1, sourceProjectId = 'local-1') => ({
  id,
  sourceProjectId,
  name: 'Alpine lake',
  description: 'A terrain',
  visibility: 'private',
  shareCode: 'ABCDEFGHJK',
  contentRevision: revision,
  updatedAt: '2026-07-23T10:00:00.000Z',
});

describe('project sync state', () => {
  it('identifies projects that only exist on one side', () => {
    expect(getProjectSyncState({ localProject: local() })).toBe('local-only');
    expect(getProjectSyncState({ cloudProject: cloud() })).toBe('cloud-only');
  });

  it('tracks local, cloud, and two-sided changes against a binding baseline', () => {
    const baseLocal = local();
    const baseCloud = cloud();
    const binding = syncBindingFor(baseLocal, baseCloud);
    expect(getProjectSyncState({ localProject: baseLocal, cloudProject: baseCloud, binding })).toBe('synced');
    expect(getProjectSyncState({ localProject: local('local-1', '2026-07-23T11:00:00.000Z'), cloudProject: baseCloud, binding })).toBe('local-changes');
    expect(getProjectSyncState({ localProject: baseLocal, cloudProject: cloud('cloud-1', 2), binding })).toBe('cloud-changes');
    expect(getProjectSyncState({ localProject: local('local-1', '2026-07-23T11:00:00.000Z'), cloudProject: cloud('cloud-1', 2), binding })).toBe('conflict');
  });

  it('marks legacy source-ID matches for safe first review', () => {
    const [entry] = buildUnifiedProjectIndex({ localProjects: [local()], cloudProjects: [cloud()], bindings: [] });
    expect(entry.state).toBe('needs-review');
    expect(entry.legacyLink).toBe(true);
    expect(entry.action).toBe('Review sync');
  });

  it('adds unmatched cloud projects to the unified library', () => {
    const entries = buildUnifiedProjectIndex({
      localProjects: [local()],
      cloudProjects: [cloud('cloud-remote', 1, 'another-local-project')],
      bindings: [],
    });
    expect(entries).toHaveLength(2);
    expect(entries.find((entry) => entry.cloudProject?.id === 'cloud-remote')?.state).toBe('cloud-only');
  });

  it('marks a missing linked cloud copy as ready to recreate', () => {
    const localProject = local();
    const binding = { ...syncBindingFor(localProject, cloud()), cloudProjectId: 'deleted-cloud-copy' };
    expect(getProjectSyncState({ localProject, binding })).toBe('cloud-missing');
  });
});
