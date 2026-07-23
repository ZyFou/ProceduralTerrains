import { createHmac, randomUUID } from 'node:crypto';
import { config } from './config.js';
import { db } from './db.js';

const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);

export function privacyHash(value, scope = 'general') {
  return createHmac('sha256', config.privacyHashSecret)
    .update(`${scope}\0${String(value ?? '')}`)
    .digest();
}

export function requestIpHash(request) {
  return privacyHash(request.ip || 'unknown', `ip:${new Date().toISOString().slice(0, 7)}`);
}

export function requestUserAgent(request) {
  return text(request.headers['user-agent'], 512) || null;
}

export async function recordSecurityEvent({
  request,
  userId = null,
  eventType,
  outcome,
  identifier = null,
  connection = db,
}) {
  await connection.execute(
    `INSERT INTO security_events
       (user_id, event_type, outcome, ip_hash, identifier_hash, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      userId,
      text(eventType, 48),
      outcome,
      requestIpHash(request),
      identifier ? privacyHash(String(identifier).toLowerCase(), 'account-identifier') : null,
      requestUserAgent(request),
    ],
  );
}

export async function recordAdminAudit({
  request,
  adminUserId,
  action,
  targetType,
  targetId = null,
  metadata = null,
  connection = db,
}) {
  await connection.execute(
    `INSERT INTO admin_audit_logs
       (id, admin_user_id, action, target_type, target_id, metadata, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      adminUserId,
      text(action, 64),
      text(targetType, 32),
      targetId ? text(targetId, 64) : null,
      metadata ? JSON.stringify(metadata) : null,
      requestIpHash(request),
    ],
  );
}
