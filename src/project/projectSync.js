const revisionOf = (project) => Number(project?.contentRevision ?? 1);

export function getProjectSyncState({ localProject = null, cloudProject = null, binding = null } = {}) {
  if (!localProject && cloudProject) return 'cloud-only';
  if (!localProject) return 'unknown';
  if (!cloudProject) return binding ? 'cloud-missing' : 'local-only';
  if (!binding) return 'needs-review';

  const localChanged = localProject.metadata.modified !== binding.lastSyncedLocalModified;
  const cloudChanged = revisionOf(cloudProject) !== binding.cloudContentRevision;
  if (localChanged && cloudChanged) return 'conflict';
  if (localChanged) return 'local-changes';
  if (cloudChanged) return 'cloud-changes';
  return 'synced';
}

export const syncPresentation = {
  'local-only': { label: 'Only on this device', action: 'Sync to cloud' },
  'cloud-missing': { label: 'Cloud copy was removed', action: 'Sync to cloud' },
  'cloud-only': { label: 'Only in the cloud', action: 'Download' },
  'needs-review': { label: 'Needs sync review', action: 'Review sync' },
  synced: { label: 'Synced', action: 'Sync' },
  'local-changes': { label: 'Changes on this device', action: 'Upload changes' },
  'cloud-changes': { label: 'Changes in the cloud', action: 'Download changes' },
  conflict: { label: 'Conflict: choose a version', action: 'Resolve conflict' },
  unknown: { label: 'Sync status unavailable', action: 'Sync' },
};

function latestActivity(item) {
  const value = item.localProject?.metadata?.modified ?? item.cloudProject?.updatedAt;
  const timestamp = Date.parse(value ?? '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function buildUnifiedProjectIndex({ localProjects = [], cloudProjects = [], bindings = [] } = {}) {
  const bindingByLocalId = new Map(bindings.map((binding) => [binding.localProjectId, binding]));
  const cloudById = new Map(cloudProjects.map((project) => [project.id, project]));
  const claimedCloudIds = new Set();

  const entries = localProjects.map((localProject) => {
    const binding = bindingByLocalId.get(localProject.id) ?? null;
    let cloudProject = binding ? cloudById.get(binding.cloudProjectId) ?? null : null;
    let legacyLink = false;

    if (!cloudProject && !binding) {
      cloudProject = cloudProjects.find((project) => project.sourceProjectId === localProject.id && !claimedCloudIds.has(project.id)) ?? null;
      legacyLink = Boolean(cloudProject);
    }
    if (cloudProject) claimedCloudIds.add(cloudProject.id);

    const state = getProjectSyncState({ localProject, cloudProject, binding });
    return {
      id: `local:${localProject.id}`,
      localProject,
      cloudProject,
      binding,
      legacyLink,
      state,
      ...syncPresentation[state],
    };
  });

  cloudProjects.forEach((cloudProject) => {
    if (claimedCloudIds.has(cloudProject.id)) return;
    const state = getProjectSyncState({ cloudProject });
    entries.push({
      id: `cloud:${cloudProject.id}`,
      localProject: null,
      cloudProject,
      binding: null,
      legacyLink: false,
      state,
      ...syncPresentation[state],
    });
  });

  return entries.sort((left, right) => latestActivity(right) - latestActivity(left));
}

export function syncBindingFor(localProject, cloudProject) {
  return {
    localProjectId: localProject.id,
    cloudProjectId: cloudProject.id,
    lastSyncedLocalModified: localProject.metadata.modified,
    cloudContentRevision: revisionOf(cloudProject),
  };
}
