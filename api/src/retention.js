const RETENTION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const DELETE_BATCH_SIZE = 5_000;

// These periods are the source of truth for the retention statements on the
// confidentiality page. Keep any policy copy aligned with these queries.
const RETENTION_QUERIES = Object.freeze([
  'DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP(3) LIMIT 5000',
  'DELETE FROM visit_events WHERE created_at < UTC_TIMESTAMP(3) - INTERVAL 90 DAY LIMIT 5000',
  'DELETE FROM security_events WHERE created_at < UTC_TIMESTAMP(3) - INTERVAL 180 DAY LIMIT 5000',
  'DELETE FROM admin_audit_logs WHERE created_at < UTC_TIMESTAMP(3) - INTERVAL 1 YEAR LIMIT 5000',
]);

async function deleteInBatches(database, query) {
  let affectedRows;
  do {
    const [result] = await database.execute(query);
    affectedRows = result.affectedRows;
  } while (affectedRows === DELETE_BATCH_SIZE);
}

export async function purgeExpiredData(database) {
  for (const query of RETENTION_QUERIES) {
    await deleteInBatches(database, query);
  }
}

export async function startRetentionScheduler({ database, logger }) {
  await purgeExpiredData(database);

  const timer = setInterval(() => {
    purgeExpiredData(database).catch((error) => {
      logger.error({ err: error }, 'retention cleanup failed');
    });
  }, RETENTION_CLEANUP_INTERVAL_MS);
  timer.unref();

  return () => clearInterval(timer);
}
