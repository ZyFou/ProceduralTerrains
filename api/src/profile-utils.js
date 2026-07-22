import { normalizeUsername } from './auth-utils.js';

export const PROJECT_VISIBILITIES = Object.freeze(['private', 'unlisted', 'public']);
export const MAX_AVATAR_BYTES = 1_048_576;

const USERNAME_PATTERN = /^[a-z0-9_]{3,32}$/;
const AVATAR_DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/]+={0,2})$/;

export function validateProfileUpdate(input) {
  const errors = {};
  const value = {};

  if (Object.hasOwn(input ?? {}, 'username')) {
    value.username = normalizeUsername(input.username);
    if (!USERNAME_PATTERN.test(value.username)) {
      errors.username = 'Use 3-32 letters, numbers, or underscores.';
    }
  }

  if (Object.hasOwn(input ?? {}, 'displayName')) {
    const displayName = String(input.displayName ?? '').trim();
    value.displayName = displayName || null;
    if (displayName.length > 80) errors.displayName = 'Use no more than 80 characters.';
  }

  if (Object.hasOwn(input ?? {}, 'websiteUrl')) {
    const websiteUrl = String(input.websiteUrl ?? '').trim();
    value.websiteUrl = websiteUrl || null;
    if (websiteUrl.length > 2048) {
      errors.websiteUrl = 'Use no more than 2048 characters.';
    } else if (websiteUrl) {
      try {
        const parsed = new URL(websiteUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
      } catch {
        errors.websiteUrl = 'Enter a complete http:// or https:// URL.';
      }
    }
  }

  if (Object.hasOwn(input ?? {}, 'defaultProjectVisibility')) {
    value.defaultProjectVisibility = String(input.defaultProjectVisibility ?? '').toLowerCase();
    if (!PROJECT_VISIBILITIES.includes(value.defaultProjectVisibility)) {
      errors.defaultProjectVisibility = 'Choose private, unlisted, or public.';
    }
  }

  if (Object.keys(value).length === 0) errors.profile = 'Provide at least one profile field.';
  return { ok: Object.keys(errors).length === 0, errors, value };
}

export function validatePasswordChange(input) {
  const currentPassword = String(input?.currentPassword ?? '');
  const newPassword = String(input?.newPassword ?? '');
  const errors = {};
  if (!currentPassword) errors.currentPassword = 'Enter your current password.';
  if (newPassword.length < 10) errors.newPassword = 'Use at least 10 characters.';
  else if (newPassword.length > 128) errors.newPassword = 'Use no more than 128 characters.';
  else if (newPassword === currentPassword) errors.newPassword = 'Choose a different password.';
  return { ok: Object.keys(errors).length === 0, errors, value: { currentPassword, newPassword } };
}

function hasExpectedSignature(mimeType, data) {
  if (mimeType === 'image/png') {
    return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === 'image/jpeg') return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (mimeType === 'image/webp') {
    return data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
  }
  return false;
}

export function parseAvatarDataUrl(dataUrl) {
  const match = AVATAR_DATA_URL.exec(String(dataUrl ?? ''));
  if (!match) return { ok: false, error: 'Choose a PNG, JPEG, or WebP image.' };
  const mimeType = match[1];
  const data = Buffer.from(match[2], 'base64');
  if (!data.length || !hasExpectedSignature(mimeType, data)) {
    return { ok: false, error: 'The image data does not match its file type.' };
  }
  if (data.length > MAX_AVATAR_BYTES) {
    return { ok: false, error: 'Profile pictures must be 1 MB or smaller.' };
  }
  return { ok: true, value: { mimeType, data } };
}
