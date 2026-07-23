import { randomBytes } from 'node:crypto';
import { PROJECT_VISIBILITIES } from './profile-utils.js';

export const MAX_PROJECT_BYTES = 8 * 1024 * 1024;
const SHARE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SHARE_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{10}$/;

export function createShareCode() {
  const bytes = randomBytes(10);
  return Array.from(bytes, (byte) => SHARE_ALPHABET[byte % SHARE_ALPHABET.length]).join('');
}

export function normalizeShareCode(value) {
  const code = String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '');
  return SHARE_CODE_PATTERN.test(code) ? code : null;
}

function serializeProject(project, errors) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    errors.project = 'Provide a valid terrain project.';
    return null;
  }
  const serialized = JSON.stringify(project);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PROJECT_BYTES) {
    errors.project = 'Projects must be 8 MB or smaller.';
    return null;
  }
  return serialized;
}

function normalizeName(value, fallback, errors) {
  const name = String(value ?? fallback ?? '').trim();
  if (!name) errors.name = 'Enter a project name.';
  else if (name.length > 120) errors.name = 'Use no more than 120 characters.';
  return name;
}

function normalizeDescription(value, fallback, errors) {
  const description = String(value ?? fallback ?? '').trim();
  if (description.length > 1000) errors.description = 'Use no more than 1000 characters.';
  return description || null;
}

export function validateProjectCreate(input, defaultVisibility = 'private') {
  const errors = {};
  const projectData = serializeProject(input?.project, errors);
  const name = normalizeName(input?.name, input?.project?.metadata?.name, errors);
  const description = normalizeDescription(input?.description, input?.project?.metadata?.description, errors);
  const visibility = String(input?.visibility ?? defaultVisibility).toLowerCase();
  const sourceProjectId = String(input?.sourceProjectId ?? input?.project?.id ?? '').trim();
  if (!PROJECT_VISIBILITIES.includes(visibility)) errors.visibility = 'Choose private, unlisted, or public.';
  if (sourceProjectId.length > 128) errors.project = 'The local project identifier is too long.';
  return { ok: Object.keys(errors).length === 0, errors, value: { projectData, name, description, visibility, sourceProjectId: sourceProjectId || null } };
}

export function validateProjectUpdate(input) {
  const errors = {};
  const value = {};
  let expectedContentRevision = null;
  if (Object.hasOwn(input ?? {}, 'project')) value.projectData = serializeProject(input.project, errors);
  if (Object.hasOwn(input ?? {}, 'name')) value.name = normalizeName(input.name, null, errors);
  if (Object.hasOwn(input ?? {}, 'description')) value.description = normalizeDescription(input.description, null, errors);
  if (Object.hasOwn(input ?? {}, 'visibility')) {
    value.visibility = String(input.visibility ?? '').toLowerCase();
    if (!PROJECT_VISIBILITIES.includes(value.visibility)) errors.visibility = 'Choose private, unlisted, or public.';
  }
  if (Object.hasOwn(input ?? {}, 'expectedContentRevision')) {
    expectedContentRevision = Number(input.expectedContentRevision);
    if (!Number.isInteger(expectedContentRevision) || expectedContentRevision < 1) {
      errors.expectedContentRevision = 'Provide a valid cloud content revision.';
    } else if (!Object.hasOwn(input ?? {}, 'project')) {
      errors.expectedContentRevision = 'A cloud content revision can only protect a project update.';
    }
  }
  if (Object.keys(value).length === 0) errors.project = 'Provide at least one project field.';
  return { ok: Object.keys(errors).length === 0, errors, value, expectedContentRevision };
}
