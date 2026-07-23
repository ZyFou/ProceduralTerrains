import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { closeDatabase, db } from './db.js';
import { registerAuthRoutes } from './auth-routes.js';
import { registerProjectRoutes } from './project-routes.js';
import { registerAdminRoutes } from './admin-routes.js';
import { startRetentionScheduler } from './retention.js';

const app = Fastify({
  logger: { level: config.logLevel },
  trustProxy: config.trustProxy,
  bodyLimit: config.bodyLimit,
});

const allowedOrigins = new Set(config.frontendOrigins);

await app.register(cookie);
await app.register(cors, {
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(null, false);
  },
});
await app.register(rateLimit, { global: false });

app.addHook('onRequest', async (request, reply) => {
  const origin = request.headers.origin;
  if (origin && !allowedOrigins.has(origin)) {
    return reply.code(403).send({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Origin is not allowed.' } });
  }
  const fetchSite = request.headers['sec-fetch-site'];
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && fetchSite === 'cross-site') {
    return reply.code(403).send({ error: { code: 'CROSS_SITE_REQUEST', message: 'Cross-site requests are not allowed.' } });
  }
});

app.addHook('onSend', async (request, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return payload;
});

app.get('/health', async () => {
  await db.query('SELECT 1');
  return { ok: true, service: 'procedural-terrains-api' };
});

app.get('/api/v1/health', async () => {
  await db.query('SELECT 1');
  return { ok: true, service: 'procedural-terrains-api' };
});

await registerAuthRoutes(app);
await registerProjectRoutes(app);
await registerAdminRoutes(app);
const stopRetentionScheduler = await startRetentionScheduler({ database: db, logger: app.log });
app.addHook('onClose', async () => stopRetentionScheduler());

app.setNotFoundHandler((request, reply) => {
  reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
});

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, 'request failed');
  if (reply.sent) return;
  const status = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
  reply.code(status).send({
    error: {
      code: status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
      message: status === 500 ? 'The server could not complete the request.' : error.message,
    },
  });
});

async function shutdown(signal) {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await closeDatabase();
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await closeDatabase();
  process.exit(1);
}
