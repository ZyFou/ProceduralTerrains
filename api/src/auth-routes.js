import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { config } from './config.js';
import { db } from './db.js';
import { hashPassword, validateLogin, validateRegistration, verifyPassword } from './auth-utils.js';
import { parseAvatarDataUrl, validatePasswordChange, validateProfileUpdate } from './profile-utils.js';
import { recordSecurityEvent } from './activity.js';

const SESSION_COOKIE_OPTIONS = {
  path: '/',
  httpOnly: true,
  sameSite: config.session.sameSite,
  secure: config.session.secureCookie,
  domain: config.session.cookieDomain,
  maxAge: config.session.ttlDays * 24 * 60 * 60,
};

export const publicUser = (row) => ({
  id: row.id,
  email: row.email,
  username: row.username,
  displayName: row.display_name ?? null,
  websiteUrl: row.website_url ?? null,
  defaultProjectVisibility: row.default_project_visibility ?? 'private',
  avatarUpdatedAt: row.avatar_updated_at ?? null,
  emailVerified: !!row.email_verified_at,
  createdAt: row.created_at,
  role: row.role === 'admin' || config.adminEmails.includes(String(row.email ?? '').toLowerCase()) ? 'admin' : 'user',
});

const tokenHash = (token) => createHash('sha256').update(token).digest();
const dummyPasswordHash = hashPassword(randomBytes(32).toString('base64url'));
const logSecurityEvent = (details) => recordSecurityEvent(details).catch(() => {});

async function createSession(userId, request, reply, connection = db) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.session.ttlDays * 86_400_000);
  await connection.execute(
    `INSERT INTO sessions (id, user_id, token_hash, user_agent, ip_address, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      userId,
      tokenHash(token),
      String(request.headers['user-agent'] ?? '').slice(0, 512) || null,
      String(request.ip ?? '').slice(0, 45) || null,
      expiresAt,
    ],
  );
  reply.setCookie(config.session.cookieName, token, SESSION_COOKIE_OPTIONS);
}

function clearSessionCookie(reply) {
  reply.clearCookie(config.session.cookieName, {
    path: SESSION_COOKIE_OPTIONS.path,
    domain: SESSION_COOKIE_OPTIONS.domain,
    sameSite: SESSION_COOKIE_OPTIONS.sameSite,
    secure: SESSION_COOKIE_OPTIONS.secure,
  });
}

export async function findSessionUser(request, { touch = true } = {}) {
  const token = request.cookies[config.session.cookieName];
  if (!token || token.length > 128) return null;
  const [rows] = await db.execute(
    `SELECT u.id, u.email, u.username, u.display_name, u.website_url, u.role,
            u.default_project_visibility, u.avatar_updated_at,
            u.email_verified_at, u.created_at, s.id AS session_id
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
        AND s.expires_at > UTC_TIMESTAMP(3)
        AND u.status = 'active'
        AND u.deleted_at IS NULL
      LIMIT 1`,
    [tokenHash(token)],
  );
  const user = rows[0] ?? null;
  if (user && touch) {
    db.execute(
      `UPDATE sessions SET last_seen_at = UTC_TIMESTAMP(3)
        WHERE id = ? AND last_seen_at < UTC_TIMESTAMP(3) - INTERVAL 5 MINUTE`,
      [user.session_id],
    ).catch(() => {});
  }
  return user;
}

export async function requireSession(request, reply) {
  const user = await findSessionUser(request);
  if (user) return user;
  if (request.cookies[config.session.cookieName]) clearSessionCookie(reply);
  reply.header('Cache-Control', 'no-store');
  reply.code(401).send({ error: { code: 'AUTH_REQUIRED', message: 'Sign in to manage your profile.' } });
  return null;
}

function validationReply(reply, errors) {
  return reply.code(400).send({
    error: { code: 'VALIDATION_ERROR', message: 'Check the highlighted fields.', fields: errors },
  });
}

export async function registerAuthRoutes(app) {
  app.post('/api/v1/auth/register', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const result = validateRegistration(request.body);
    if (!result.ok) return validationReply(reply, result.errors);

    const { email, username, password } = result.value;
    const passwordHash = await hashPassword(password);
    const userId = randomUUID();
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `INSERT INTO users (id, email, username, password_hash)
         VALUES (?, ?, ?, ?)`,
        [userId, email, username, passwordHash],
      );
      await createSession(userId, request, reply, connection);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      if (error?.code === 'ER_DUP_ENTRY') {
        const duplicateEmail = String(error.message).includes('uq_users_email');
        return reply.code(409).send({
          error: {
            code: duplicateEmail ? 'EMAIL_TAKEN' : 'USERNAME_TAKEN',
            message: duplicateEmail ? 'An account already uses this email.' : 'This username is already taken.',
            fields: duplicateEmail ? { email: 'Email already registered.' } : { username: 'Username already taken.' },
          },
        });
      }
      throw error;
    } finally {
      connection.release();
    }

    const [rows] = await db.execute(
      `SELECT id, email, username, display_name, website_url, default_project_visibility, role,
              avatar_updated_at, email_verified_at, created_at
         FROM users WHERE id = ? LIMIT 1`,
      [userId],
    );
    reply.header('Cache-Control', 'no-store');
    await logSecurityEvent({ request, userId, eventType: 'account.registered', outcome: 'success', identifier: email });
    return reply.code(201).send({ user: publicUser(rows[0]) });
  });

  app.post('/api/v1/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const result = validateLogin(request.body);
    if (!result.ok) return validationReply(reply, result.errors);

    const { identifier, password } = result.value;
    const [rows] = await db.execute(
      `SELECT id, email, username, password_hash, display_name, website_url, role,
              default_project_visibility, avatar_updated_at, email_verified_at,
              created_at, status, deleted_at
         FROM users
        WHERE email = ? OR username = ?
        LIMIT 1`,
      [identifier, identifier],
    );
    const user = rows[0];
    // Verifying a dummy hash for unknown accounts keeps login timing similar
    // and makes account enumeration less useful.
    const valid = await verifyPassword(password, user?.password_hash ?? await dummyPasswordHash);
    if (!user || !valid || user.status !== 'active' || user.deleted_at) {
      await logSecurityEvent({
        request, userId: user?.id ?? null, eventType: 'auth.login', outcome: 'failure', identifier,
      });
      return reply.code(401).send({
        error: { code: 'INVALID_CREDENTIALS', message: 'Email, username, or password is incorrect.' },
      });
    }

    await createSession(user.id, request, reply);
    await logSecurityEvent({ request, userId: user.id, eventType: 'auth.login', outcome: 'success', identifier });
    // Opportunistic cleanup avoids needing a cron job for the small deployment.
    db.execute('DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP(3) LIMIT 500').catch(() => {});
    reply.header('Cache-Control', 'no-store');
    return { user: publicUser(user) };
  });

  app.get('/api/v1/auth/session', async (request, reply) => {
    const user = await findSessionUser(request);
    if (!user && request.cookies[config.session.cookieName]) clearSessionCookie(reply);
    reply.header('Cache-Control', 'no-store');
    return { user: user ? publicUser(user) : null };
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const token = request.cookies[config.session.cookieName];
    const sessionUser = await findSessionUser(request, { touch: false });
    if (token && token.length <= 128) {
      await db.execute('DELETE FROM sessions WHERE token_hash = ?', [tokenHash(token)]);
    }
    clearSessionCookie(reply);
    if (sessionUser) await logSecurityEvent({ request, userId: sessionUser.id, eventType: 'auth.logout', outcome: 'success' });
    reply.header('Cache-Control', 'no-store');
    return reply.code(204).send();
  });

  app.get('/api/v1/me', async (request, reply) => {
    const user = await requireSession(request, reply);
    if (!user) return;
    reply.header('Cache-Control', 'no-store');
    return { user: publicUser(user) };
  });

  app.patch('/api/v1/me', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = await requireSession(request, reply);
    if (!user) return;
    const result = validateProfileUpdate(request.body);
    if (!result.ok) return validationReply(reply, result.errors);

    const columns = {
      username: 'username',
      displayName: 'display_name',
      websiteUrl: 'website_url',
      defaultProjectVisibility: 'default_project_visibility',
    };
    const entries = Object.entries(result.value);
    try {
      await db.execute(
        `UPDATE users SET ${entries.map(([key]) => `${columns[key]} = ?`).join(', ')} WHERE id = ?`,
        [...entries.map(([, value]) => value), user.id],
      );
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') {
        return reply.code(409).send({
          error: {
            code: 'USERNAME_TAKEN',
            message: 'This username is already taken.',
            fields: { username: 'Username already taken.' },
          },
        });
      }
      throw error;
    }

    const updated = await findSessionUser(request);
    reply.header('Cache-Control', 'no-store');
    return { user: publicUser(updated) };
  });

  app.put('/api/v1/me/avatar', {
    bodyLimit: 1_500_000,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = await requireSession(request, reply);
    if (!user) return;
    const result = parseAvatarDataUrl(request.body?.dataUrl);
    if (!result.ok) return validationReply(reply, { avatar: result.error });
    await db.execute(
      `UPDATE users
          SET avatar_mime_type = ?, avatar_data = ?, avatar_updated_at = UTC_TIMESTAMP(3)
        WHERE id = ?`,
      [result.value.mimeType, result.value.data, user.id],
    );
    const updated = await findSessionUser(request);
    reply.header('Cache-Control', 'no-store');
    return { user: publicUser(updated) };
  });

  app.delete('/api/v1/me/avatar', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = await requireSession(request, reply);
    if (!user) return;
    await db.execute(
      `UPDATE users
          SET avatar_mime_type = NULL, avatar_data = NULL, avatar_updated_at = NULL
        WHERE id = ?`,
      [user.id],
    );
    const updated = await findSessionUser(request);
    reply.header('Cache-Control', 'no-store');
    return { user: publicUser(updated) };
  });

  app.get('/api/v1/users/:userId/avatar', async (request, reply) => {
    const [rows] = await db.execute(
      `SELECT avatar_mime_type, avatar_data
         FROM users
        WHERE id = ? AND status = 'active' AND deleted_at IS NULL
        LIMIT 1`,
      [String(request.params.userId ?? '').slice(0, 36)],
    );
    const avatar = rows[0];
    if (!avatar?.avatar_data || !avatar.avatar_mime_type) {
      return reply.code(404).send({ error: { code: 'AVATAR_NOT_FOUND', message: 'Profile picture not found.' } });
    }
    reply.header('Content-Type', avatar.avatar_mime_type);
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.send(avatar.avatar_data);
  });

  app.put('/api/v1/me/password', {
    config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
  }, async (request, reply) => {
    const user = await requireSession(request, reply);
    if (!user) return;
    const result = validatePasswordChange(request.body);
    if (!result.ok) return validationReply(reply, result.errors);

    const [[account]] = await db.execute('SELECT password_hash FROM users WHERE id = ? LIMIT 1', [user.id]);
    if (!account || !await verifyPassword(result.value.currentPassword, account.password_hash)) {
      return validationReply(reply, { currentPassword: 'Current password is incorrect.' });
    }

    const passwordHash = await hashPassword(result.value.newPassword);
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, user.id]);
      await connection.execute('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [user.id, user.session_id]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    await logSecurityEvent({ request, userId: user.id, eventType: 'account.password_changed', outcome: 'success' });
    reply.header('Cache-Control', 'no-store');
    return { ok: true };
  });
}
