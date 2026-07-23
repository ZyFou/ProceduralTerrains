import test from 'node:test';
import assert from 'node:assert/strict';
import { purgeExpiredData } from '../src/retention.js';

test('retention cleanup removes expired sessions and every documented event category', async () => {
  const queries = [];
  const database = {
    async execute(query) {
      queries.push(query);
      return [{ affectedRows: 0 }];
    },
  };

  await purgeExpiredData(database);

  assert.deepEqual(queries, [
    'DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP(3) LIMIT 5000',
    'DELETE FROM visit_events WHERE created_at < UTC_TIMESTAMP(3) - INTERVAL 90 DAY LIMIT 5000',
    'DELETE FROM security_events WHERE created_at < UTC_TIMESTAMP(3) - INTERVAL 180 DAY LIMIT 5000',
    'DELETE FROM admin_audit_logs WHERE created_at < UTC_TIMESTAMP(3) - INTERVAL 1 YEAR LIMIT 5000',
  ]);
});

test('retention cleanup continues deleting a category until it is fully cleared', async () => {
  let visitDeletes = 0;
  const database = {
    async execute(query) {
      if (query.includes('visit_events')) {
        visitDeletes += 1;
        return [{ affectedRows: visitDeletes === 1 ? 5000 : 4 }];
      }
      return [{ affectedRows: 0 }];
    },
  };

  await purgeExpiredData(database);

  assert.equal(visitDeletes, 2);
});
