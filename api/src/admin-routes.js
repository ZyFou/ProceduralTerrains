import { db } from './db.js';
import { config } from './config.js';
import { findSessionUser, publicUser, requireSession } from './auth-routes.js';
import { parseAdminUserPatch, parseListQuery, USER_ROLES, USER_STATUSES } from './admin-utils.js';
import { recordAdminAudit, requestIpHash, requestUserAgent } from './activity.js';

const noStore = (reply) => reply.header('Cache-Control', 'no-store');
const isBootstrapAdmin = (email) => config.adminEmails.includes(String(email ?? '').toLowerCase());
const effectiveRole = (row) => row.role === 'admin' || isBootstrapAdmin(row.email) ? 'admin' : 'user';
const deviceType = (agent) => /tablet|ipad/i.test(agent ?? '') ? 'Tablet' : /mobile|android|iphone/i.test(agent ?? '') ? 'Mobile' : 'Desktop';
const jsonValue = (value) => {
  if (!value || typeof value === 'object') return value ?? null;
  try { return JSON.parse(value); } catch { return null; }
};

async function requireAdmin(request, reply) {
  const user = await requireSession(request, reply);
  if (!user) return null;
  if (effectiveRole(user) === 'admin') return user;
  noStore(reply).code(403).send({ error: { code: 'ADMIN_REQUIRED', message: 'Administrator access is required.' } });
  return null;
}

const adminUser = (row) => ({
  ...publicUser(row),
  role: effectiveRole(row),
  status: row.status,
  projectCount: Number(row.project_count ?? 0),
  activeSessions: Number(row.active_sessions ?? 0),
  lastSeenAt: row.last_seen_at ?? null,
});

const validationReply = (reply, errors) => reply.code(400).send({
  error: { code: 'VALIDATION_ERROR', message: 'Check the requested changes.', fields: errors },
});

export async function registerAdminRoutes(app) {
  app.post('/api/v1/analytics/visit', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const rawPath = String(request.body?.path ?? '/').trim();
    const path = rawPath.startsWith('/') ? rawPath.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255) : '/';
    let referrerHost = null;
    try {
      const referrer = request.headers.referer ? new URL(request.headers.referer) : null;
      referrerHost = referrer?.host?.slice(0, 255) || null;
    } catch { referrerHost = null; }
    const sessionUser = await findSessionUser(request, { touch: false });
    await db.execute(
      `INSERT INTO visit_events (user_id, ip_hash, path, referrer_host, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
      [sessionUser?.id ?? null, requestIpHash(request), path, referrerHost, requestUserAgent(request)],
    );
    return reply.code(204).send();
  });

  app.get('/api/v1/admin/overview', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;
    const [
      [[counts]],
      [visitTrend],
      [signupTrend],
      [recentTerrains],
      [recentAudit],
    ] = await Promise.all([
      db.execute(
        `SELECT
           (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL) AS users,
           (SELECT COUNT(*) FROM users WHERE status = 'active' AND deleted_at IS NULL) AS active_users,
           (SELECT COUNT(*) FROM projects) AS terrains,
           (SELECT COUNT(*) FROM visit_events WHERE created_at >= UTC_DATE()) AS visits_today,
           (SELECT COUNT(DISTINCT ip_hash) FROM visit_events WHERE created_at >= UTC_DATE()) AS unique_today,
           (SELECT COUNT(*) FROM sessions WHERE expires_at > UTC_TIMESTAMP(3)) AS open_sessions`,
      ),
      db.execute(
        `SELECT DATE(created_at) AS day, COUNT(*) AS visits, COUNT(DISTINCT ip_hash) AS unique_visitors
           FROM visit_events
          WHERE created_at >= UTC_DATE() - INTERVAL 13 DAY
          GROUP BY DATE(created_at)
          ORDER BY day`,
      ),
      db.execute(
        `SELECT DATE(created_at) AS day, COUNT(*) AS signups
           FROM users
          WHERE created_at >= UTC_DATE() - INTERVAL 13 DAY
          GROUP BY DATE(created_at)
          ORDER BY day`,
      ),
      db.execute(
        `SELECT p.id, p.name, p.visibility, p.updated_at, u.username
           FROM projects p JOIN users u ON u.id = p.user_id
          ORDER BY p.updated_at DESC LIMIT 5`,
      ),
      db.execute(
        `SELECT a.id, a.action, a.target_type, a.target_id, a.metadata, a.created_at,
                COALESCE(u.username, 'System') AS actor
           FROM admin_audit_logs a LEFT JOIN users u ON u.id = a.admin_user_id
          ORDER BY a.created_at DESC LIMIT 6`,
      ),
    ]);
    noStore(reply);
    return {
      counts: {
        users: Number(counts.users),
        activeUsers: Number(counts.active_users),
        terrains: Number(counts.terrains),
        visitsToday: Number(counts.visits_today),
        uniqueToday: Number(counts.unique_today),
        openSessions: Number(counts.open_sessions),
      },
      visitTrend: visitTrend.map((row) => ({ day: row.day, visits: Number(row.visits), uniqueVisitors: Number(row.unique_visitors) })),
      signupTrend: signupTrend.map((row) => ({ day: row.day, signups: Number(row.signups) })),
      recentTerrains: recentTerrains.map((row) => ({
        id: row.id, name: row.name, visibility: row.visibility, username: row.username, updatedAt: row.updated_at,
      })),
      recentAudit: recentAudit.map((row) => ({
        id: row.id, action: row.action, targetType: row.target_type, targetId: row.target_id,
        metadata: jsonValue(row.metadata), actor: row.actor, createdAt: row.created_at,
      })),
    };
  });

  app.get('/api/v1/admin/users', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;
    const { page, limit, offset, search } = parseListQuery(request.query);
    const status = USER_STATUSES.has(request.query?.status) ? request.query.status : '';
    const role = USER_ROLES.has(request.query?.role) ? request.query.role : '';
    const filters = ['u.deleted_at IS NULL'];
    const values = [];
    if (search) {
      filters.push('(u.email LIKE ? OR u.username LIKE ? OR u.display_name LIKE ?)');
      values.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status) { filters.push('u.status = ?'); values.push(status); }
    if (role === 'admin') {
      if (config.adminEmails.length) {
        filters.push(`(u.role = 'admin' OR u.email IN (${config.adminEmails.map(() => '?').join(', ')}))`);
        values.push(...config.adminEmails);
      } else filters.push("u.role = 'admin'");
    }
    if (role === 'user') {
      if (config.adminEmails.length) {
        filters.push(`(u.role = 'user' AND u.email NOT IN (${config.adminEmails.map(() => '?').join(', ')}))`);
        values.push(...config.adminEmails);
      } else filters.push("u.role = 'user'");
    }
    const where = filters.join(' AND ');
    const [[countRow]] = await db.execute(`SELECT COUNT(*) AS total FROM users u WHERE ${where}`, values);
    const [rows] = await db.execute(
      `SELECT u.id, u.email, u.username, u.display_name, u.website_url, u.default_project_visibility,
              u.avatar_updated_at, u.email_verified_at, u.created_at, u.status, u.role,
              COUNT(DISTINCT p.id) AS project_count,
              COUNT(DISTINCT CASE WHEN s.expires_at > UTC_TIMESTAMP(3) THEN s.id END) AS active_sessions,
              MAX(s.last_seen_at) AS last_seen_at
         FROM users u
         LEFT JOIN projects p ON p.user_id = u.id
         LEFT JOIN sessions s ON s.user_id = u.id
        WHERE ${where}
        GROUP BY u.id
        ORDER BY u.created_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      values,
    );
    noStore(reply);
    return { users: rows.map(adminUser), page, total: Number(countRow.total), pages: Math.max(1, Math.ceil(Number(countRow.total) / limit)) };
  });

  app.patch('/api/v1/admin/users/:userId', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;
    const result = parseAdminUserPatch(request.body);
    if (!result.ok) return validationReply(reply, result.errors);
    const userId = String(request.params.userId ?? '').slice(0, 36);
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [[target]] = await connection.execute(
        `SELECT id, email, username, display_name, website_url, default_project_visibility,
                avatar_updated_at, email_verified_at, created_at, status, role
           FROM users WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
        [userId],
      );
      if (!target) {
        await connection.rollback();
        return reply.code(404).send({ error: { code: 'USER_NOT_FOUND', message: 'User not found.' } });
      }
      if (target.id === admin.id && (result.value.status === 'suspended' || result.value.role === 'user')) {
        await connection.rollback();
        return reply.code(409).send({ error: { code: 'SELF_LOCKOUT_BLOCKED', message: 'You cannot suspend or demote your own administrator account.' } });
      }
      if (isBootstrapAdmin(target.email) && result.value.role === 'user') {
        await connection.rollback();
        return reply.code(409).send({ error: { code: 'BOOTSTRAP_ADMIN', message: 'This account is protected by the administrator allowlist.' } });
      }
      if (target.role === 'admin' && result.value.role === 'user') {
        const [activeAdmins] = await connection.execute(
          `SELECT id FROM users
            WHERE (role = 'admin'${config.adminEmails.length ? ` OR email IN (${config.adminEmails.map(() => '?').join(', ')})` : ''})
              AND status = 'active' AND deleted_at IS NULL FOR UPDATE`,
          config.adminEmails,
        );
        if (activeAdmins.length <= 1) {
          await connection.rollback();
          return reply.code(409).send({ error: { code: 'LAST_ADMIN', message: 'At least one active administrator must remain.' } });
        }
      }
      const entries = Object.entries(result.value);
      await connection.execute(
        `UPDATE users SET ${entries.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ?`,
        [...entries.map(([, value]) => value), userId],
      );
      if (result.value.status === 'suspended') await connection.execute('DELETE FROM sessions WHERE user_id = ?', [userId]);
      await recordAdminAudit({
        request,
        adminUserId: admin.id,
        action: 'user.updated',
        targetType: 'user',
        targetId: userId,
        metadata: { changes: result.value, username: target.username },
        connection,
      });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    const [[updated]] = await db.execute(
      `SELECT u.id, u.email, u.username, u.display_name, u.website_url, u.default_project_visibility,
              u.avatar_updated_at, u.email_verified_at, u.created_at, u.status, u.role,
              (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS project_count,
              (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > UTC_TIMESTAMP(3)) AS active_sessions,
              (SELECT MAX(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at
         FROM users u WHERE u.id = ?`,
      [userId],
    );
    noStore(reply);
    return { user: adminUser(updated) };
  });

  app.post('/api/v1/admin/users/:userId/revoke-sessions', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;
    const userId = String(request.params.userId ?? '').slice(0, 36);
    if (userId === admin.id) {
      return reply.code(409).send({ error: { code: 'SELF_REVOKE_BLOCKED', message: 'Use logout to close your own current session.' } });
    }
    const [[target]] = await db.execute('SELECT id, username FROM users WHERE id = ? AND deleted_at IS NULL', [userId]);
    if (!target) return reply.code(404).send({ error: { code: 'USER_NOT_FOUND', message: 'User not found.' } });
    const [result] = await db.execute('DELETE FROM sessions WHERE user_id = ?', [userId]);
    await recordAdminAudit({
      request, adminUserId: admin.id, action: 'user.sessions_revoked', targetType: 'user',
      targetId: userId, metadata: { username: target.username, sessions: result.affectedRows },
    });
    noStore(reply);
    return { revoked: Number(result.affectedRows) };
  });

  app.get('/api/v1/admin/visits', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;
    const { page, limit, offset } = parseListQuery(request.query, { maxLimit: 100 });
    const days = Math.max(1, Math.min(90, Number.parseInt(request.query?.days ?? '30', 10) || 30));
    const [[countRow]] = await db.execute('SELECT COUNT(*) AS total FROM visit_events WHERE created_at >= UTC_DATE() - INTERVAL ? DAY', [days - 1]);
    const [rows] = await db.execute(
      `SELECT v.id, v.path, v.referrer_host, v.user_agent, v.created_at, u.username
         FROM visit_events v LEFT JOIN users u ON u.id = v.user_id
        WHERE v.created_at >= UTC_DATE() - INTERVAL ? DAY
        ORDER BY v.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      [days - 1],
    );
    const [trend] = await db.execute(
      `SELECT DATE(created_at) AS day, COUNT(*) AS visits, COUNT(DISTINCT ip_hash) AS unique_visitors
         FROM visit_events WHERE created_at >= UTC_DATE() - INTERVAL ? DAY
        GROUP BY DATE(created_at) ORDER BY day`,
      [days - 1],
    );
    noStore(reply);
    return {
      visits: rows.map((row) => ({
        id: String(row.id), path: row.path, referrerHost: row.referrer_host,
        username: row.username ?? null, device: deviceType(row.user_agent), createdAt: row.created_at,
      })),
      trend: trend.map((row) => ({ day: row.day, visits: Number(row.visits), uniqueVisitors: Number(row.unique_visitors) })),
      page, total: Number(countRow.total), pages: Math.max(1, Math.ceil(Number(countRow.total) / limit)),
    };
  });

  app.get('/api/v1/admin/terrains', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;
    const { page, limit, offset, search } = parseListQuery(request.query);
    const visibility = ['private', 'unlisted', 'public'].includes(request.query?.visibility) ? request.query.visibility : '';
    const filters = [];
    const values = [];
    if (search) {
      filters.push('(p.name LIKE ? OR p.description LIKE ? OR u.username LIKE ?)');
      values.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (visibility) { filters.push('p.visibility = ?'); values.push(visibility); }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const [[countRow]] = await db.execute(
      `SELECT COUNT(*) AS total FROM projects p JOIN users u ON u.id = p.user_id ${where}`,
      values,
    );
    const [rows] = await db.execute(
      `SELECT p.id, p.name, p.description, p.visibility, p.content_revision, p.created_at, p.updated_at,
              u.id AS user_id, u.username
         FROM projects p JOIN users u ON u.id = p.user_id
         ${where} ORDER BY p.updated_at DESC LIMIT ${limit} OFFSET ${offset}`,
      values,
    );
    noStore(reply);
    return {
      terrains: rows.map((row) => ({
        id: row.id, name: row.name, description: row.description, visibility: row.visibility,
        contentRevision: Number(row.content_revision), createdAt: row.created_at, updatedAt: row.updated_at,
        owner: { id: row.user_id, username: row.username },
      })),
      page, total: Number(countRow.total), pages: Math.max(1, Math.ceil(Number(countRow.total) / limit)),
    };
  });

  app.get('/api/v1/admin/audit', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;
    const { page, limit, offset, search } = parseListQuery(request.query, { maxLimit: 100 });
    const filter = search ? 'WHERE a.action LIKE ? OR u.username LIKE ? OR a.target_id LIKE ?' : '';
    const values = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : [];
    const [[countRow]] = await db.execute(
      `SELECT COUNT(*) AS total FROM admin_audit_logs a LEFT JOIN users u ON u.id = a.admin_user_id ${filter}`,
      values,
    );
    const [rows] = await db.execute(
      `SELECT a.id, a.action, a.target_type, a.target_id, a.metadata, a.created_at,
              COALESCE(u.username, 'System') AS actor
         FROM admin_audit_logs a LEFT JOIN users u ON u.id = a.admin_user_id
         ${filter} ORDER BY a.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      values,
    );
    noStore(reply);
    return {
      events: rows.map((row) => ({
        id: row.id, action: row.action, targetType: row.target_type, targetId: row.target_id,
        metadata: jsonValue(row.metadata), actor: row.actor, createdAt: row.created_at,
      })),
      page, total: Number(countRow.total), pages: Math.max(1, Math.ceil(Number(countRow.total) / limit)),
    };
  });

  app.get('/api/v1/admin/security', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;
    const adminPredicate = config.adminEmails.length
      ? `(role = 'admin' OR email IN (${config.adminEmails.map(() => '?').join(', ')}))`
      : "role = 'admin'";
    const [[[summary]], [events]] = await Promise.all([
      db.execute(
        `SELECT
           (SELECT COUNT(*) FROM security_events WHERE outcome = 'failure' AND created_at >= UTC_TIMESTAMP(3) - INTERVAL 24 HOUR) AS failed_logins,
           (SELECT COUNT(*) FROM sessions WHERE expires_at > UTC_TIMESTAMP(3)) AS open_sessions,
           (SELECT COUNT(*) FROM users WHERE status = 'suspended' AND deleted_at IS NULL) AS suspended_users,
           (SELECT COUNT(*) FROM users WHERE ${adminPredicate} AND status = 'active' AND deleted_at IS NULL) AS admins`,
        config.adminEmails,
      ),
      db.execute(
        `SELECT e.id, e.event_type, e.outcome, e.created_at, u.username
           FROM security_events e LEFT JOIN users u ON u.id = e.user_id
          ORDER BY e.created_at DESC LIMIT 50`,
      ),
    ]);
    noStore(reply);
    return {
      summary: {
        failedLogins: Number(summary.failed_logins),
        openSessions: Number(summary.open_sessions),
        suspendedUsers: Number(summary.suspended_users),
        admins: Number(summary.admins),
      },
      events: events.map((row) => ({
        id: String(row.id), type: row.event_type, outcome: row.outcome,
        username: row.username ?? null, createdAt: row.created_at,
      })),
    };
  });
}
