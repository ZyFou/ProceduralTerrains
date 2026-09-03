import { normalizeProject } from './ProjectStore.js';

export const EDITABLE_PROJECT_FORMAT = 'procedural-terrains-project';

export function createEditableProjectDocument(project) {
  return {
    format: EDITABLE_PROJECT_FORMAT,
    ...normalizeProject(project),
  };
}

export function readEditableProjectDocument(input, { legacy = false } = {}) {
  if (!input || typeof input !== 'object') throw new Error('Could not parse project file.');
  if (input.format === EDITABLE_PROJECT_FORMAT && input.terrain) return normalizeProject(input);
  if (!legacy) {
    if (typeof input.format === 'string' && input.format.includes('terrain')) {
      throw new Error('This .ptrterrain is a runtime export, not an editable project.');
    }
    throw new Error('This .ptrterrain is not an editable Procedural Terrains project.');
  }
  return input.terrain ? normalizeProject(input) : normalizeProject({ terrain: input });
}

export function suggestedProjectFilename(name) {
  const slug = String(name || 'terrain').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'terrain';
  return `${slug}.ptrterrain`;
}
