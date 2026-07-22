import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAvatarDataUrl, validatePasswordChange, validateProfileUpdate } from '../src/profile-utils.js';

test('profile updates normalize username and optional fields', () => {
  const result = validateProfileUpdate({
    username: ' Terrain_Fan ',
    displayName: ' Terrain Fan ',
    websiteUrl: 'https://example.com/me',
    defaultProjectVisibility: 'PUBLIC',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    username: 'terrain_fan',
    displayName: 'Terrain Fan',
    websiteUrl: 'https://example.com/me',
    defaultProjectVisibility: 'public',
  });
});

test('profile updates reject unsafe URLs and invalid visibility', () => {
  const result = validateProfileUpdate({ websiteUrl: 'javascript:alert(1)', defaultProjectVisibility: 'friends' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.websiteUrl);
  assert.ok(result.errors.defaultProjectVisibility);
});

test('password changes require the current password and a distinct strong password', () => {
  assert.equal(validatePasswordChange({}).ok, false);
  assert.equal(validatePasswordChange({ currentPassword: 'old password', newPassword: 'old password' }).ok, false);
  assert.equal(validatePasswordChange({ currentPassword: 'old password', newPassword: 'a different password' }).ok, true);
});

test('avatar parsing verifies the declared image signature', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const valid = parseAvatarDataUrl(`data:image/png;base64,${png.toString('base64')}`);
  assert.equal(valid.ok, true);
  assert.equal(valid.value.mimeType, 'image/png');
  assert.equal(parseAvatarDataUrl('data:image/png;base64,aGVsbG8=').ok, false);
  assert.equal(parseAvatarDataUrl('data:image/svg+xml;base64,PHN2Zz4=').ok, false);
});
