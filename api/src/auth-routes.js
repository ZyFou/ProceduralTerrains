import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { config } from './config.js';
import { db } from './db.js';
import { hashPassword, validateLogin, validateRegistration, verifyPassword } from './auth-utils.js';

const SESSION_COOKIE_OPTIONS = {
  path: '/',
  httpOnly: true,
  sameSite: config.session.sameSite,
  secure: config.session.secureCookie,
  domain: config.session.cookieDomain,
  maxAge: config.session.ttlDays * 24 * 60 * 60,
};

const publicUser = (row) => ({
  id: row.id,
  email: row.email,
  username: row.username,
  displayName: row.display_name ?? null,
  websiteUrl: row.website_url ?? null,
  emailVerified: !!row.email_verified_at,
  createdAt: row.created_at,
});

const tokenHash = (token) => createHash('sha256').update(token).digest();
const dummyPasswordHash = hashPassword(randomBytes(32).toString('base64url'));

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

async function findSessionUser(request) {
  const token = request.cookies[config.session.cookieName];
  if (!token || token.length > 128) return null;
  const [rows] = await db.execute(
    `SELECT u.id, u.email, u.username, u.display_name, u.website_url,
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
  return rows[0] ?? null;
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
      `SELECT id, email, username, display_name, website_url, email_verified_at, created_at
         FROM users WHERE id = ? LIMIT 1`,
      [userId],
    );
    reply.header('Cache-Control', 'no-store');
    return reply.code(201).send({ user: publicUser(rows[0]) });
  });

  app.post('/api/v1/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const result = validateLogin(request.body);
    if (!result.ok) return validationReply(reply, result.errors);

    const { identifier, password } = result.value;
    const [rows] = await db.execute(
      `SELECT id, email, username, password_hash, display_name, website_url,
              email_verified_at, created_at, status, deleted_at
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
      return reply.code(401).send({
        error: { code: 'INVALID_CREDENTIALS', message: 'Email, username, or password is incorrect.' },
      });
    }

    await createSession(user.id, request, reply);
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
    if (token && token.length <= 128) {
      await db.execute('DELETE FROM sessions WHERE token_hash = ?', [tokenHash(token)]);
    }
    clearSessionCookie(reply);
    reply.header('Cache-Control', 'no-store');
    return reply.code(204).send();
  });
}
