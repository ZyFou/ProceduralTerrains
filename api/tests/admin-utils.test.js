import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAdminUserPatch, parseListQuery } from '../src/admin-utils.js';

test('admin user patch accepts only known role and status values', () => {
  assert.deepEqual(parseAdminUserPatch({ status: 'suspended', role: 'admin' }), {
    ok: true,
    value: { status: 'suspended', role: 'admin' },
  });
  assert.equal(parseAdminUserPatch({ status: 'deleted' }).ok, false);
  assert.equal(parseAdminUserPatch({ role: 'owner' }).ok, false);
  assert.equal(parseAdminUserPatch({}).ok, false);
});

test('admin pagination is bounded and search text is trimmed', () => {
  assert.deepEqual(parseListQuery({ page: '-2', limit: '999', q: '  alice  ' }), {
    page: 1,
    limit: 100,
    offset: 0,
    search: 'alice',
  });
});
