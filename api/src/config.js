import 'dotenv/config';

function integer(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function boolean(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new Error(`${name} must be true or false`);
}

function list(name, fallback = []) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(',').map((value) => value.trim()).filter(Boolean);
}

function choice(name, fallback, values) {
  const value = String(process.env[name] ?? fallback).toLowerCase();
  if (!values.includes(value)) throw new Error(`${name} must be one of: ${values.join(', ')}`);
  return value;
}

const environment = process.env.NODE_ENV ?? 'development';
const developmentPrivacySecret = 'three-terrain-development-privacy-secret';

export const config = Object.freeze({
  environment,
  host: process.env.API_HOST ?? '0.0.0.0',
  port: integer('API_PORT', 6062, { max: 65535 }),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  trustProxy: boolean('TRUST_PROXY', environment === 'production'),
  bodyLimit: integer('API_BODY_LIMIT_BYTES', 1_048_576),
  frontendOrigins: list('FRONTEND_ORIGINS', ['http://localhost:6061']),
  databaseUrl: process.env.DATABASE_URL || null,
  database: Object.freeze({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: integer('DB_PORT', 3306, { max: 65535 }),
    database: process.env.DB_NAME ?? 'procedural_terrains',
    user: process.env.DB_USER ?? 'terrain',
    password: process.env.DB_PASSWORD ?? '',
    connectionLimit: integer('DB_POOL_SIZE', 10, { max: 100 }),
  }),
  session: Object.freeze({
    cookieName: process.env.SESSION_COOKIE_NAME ?? 'terrain_session',
    ttlDays: integer('SESSION_TTL_DAYS', 30, { max: 365 }),
    secureCookie: boolean('COOKIE_SECURE', environment === 'production'),
    cookieDomain: process.env.COOKIE_DOMAIN || undefined,
    sameSite: choice('COOKIE_SAME_SITE', 'lax', ['lax', 'strict', 'none']),
  }),
  password: Object.freeze({
    scryptCost: integer('AUTH_SCRYPT_COST', 65_536, { min: 16_384, max: 1_048_576 }),
  }),
  adminEmails: list('ADMIN_EMAILS').map((value) => value.toLowerCase()),
  privacyHashSecret: process.env.PRIVACY_HASH_SECRET || developmentPrivacySecret,
});

if (environment === 'production') {
  if (!config.databaseUrl && !config.database.password) {
    throw new Error('DB_PASSWORD or DATABASE_URL is required in production');
  }
  if (config.frontendOrigins.length === 0) {
    throw new Error('FRONTEND_ORIGINS must contain at least one trusted origin in production');
  }
  if (!config.session.secureCookie) {
    throw new Error('COOKIE_SECURE must be true in production');
  }
  if (config.adminEmails.length === 0) {
    throw new Error('ADMIN_EMAILS must contain at least one trusted administrator in production');
  }
  if (!process.env.PRIVACY_HASH_SECRET || process.env.PRIVACY_HASH_SECRET.length < 32) {
    throw new Error('PRIVACY_HASH_SECRET must be at least 32 characters in production');
  }
}

if (config.session.sameSite === 'none' && !config.session.secureCookie) {
  throw new Error('COOKIE_SECURE must be true when COOKIE_SAME_SITE=none');
}

export function mysqlOptions(overrides = {}) {
  if (config.databaseUrl) {
    const url = new URL(config.databaseUrl);
    if (url.protocol !== 'mysql:') throw new Error('DATABASE_URL must use the mysql:// protocol');
    const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (!database) throw new Error('DATABASE_URL must include a database name');
    return {
      host: url.hostname,
      port: Number(url.port || 3306),
      database,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      ...(url.searchParams.get('ssl') === 'true' ? { ssl: { rejectUnauthorized: true } } : {}),
      ...overrides,
    };
  }
  return {
    host: config.database.host,
    port: config.database.port,
    database: config.database.database,
    user: config.database.user,
    password: config.database.password,
    ...overrides,
  };
}
