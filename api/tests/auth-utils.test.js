import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, validateLogin, validateRegistration, verifyPassword } from '../src/auth-utils.js';

test('registration normalizes account identifiers', () => {
  const result = validateRegistration({ email: ' User@Example.COM ', username: ' Terrain_Fan ', password: 'a useful password' });
  assert.equal(result.ok, true);
  assert.equal(result.value.email, 'user@example.com');
  assert.equal(result.value.username, 'terrain_fan');
});

test('registration reports field errors', () => {
  const result = validateRegistration({ email: 'bad', username: 'x!', password: 'short' });
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result.errors).sort(), ['email', 'password', 'username']);
});

test('login requires both fields', () => {
  assert.equal(validateLogin({}).ok, false);
  assert.equal(validateLogin({ identifier: 'terrain_fan', password: 'secret' }).ok, true);
});

test('password hashes verify without storing the password', async () => {
  const encoded = await hashPassword('correct horse battery staple', { cost: 16_384 });
  assert.equal(encoded.includes('correct horse'), false);
  assert.equal(await verifyPassword('correct horse battery staple', encoded), true);
  assert.equal(await verifyPassword('wrong password', encoded), false);
});
