import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { registerAuthRoutes } from '../src/auth-routes.js';
import { registerProjectRoutes } from '../src/project-routes.js';
import { registerAdminRoutes } from '../src/admin-routes.js';
import { closeDatabase } from '../src/db.js';

// Exercise the actual route registration and plugins without listening on a port
// or connecting to a database. Authenticated workflows need separate DB tests.
test('API routes and malformed URLs with the installed Fastify version', async (t) => {
  const app = Fastify();
  t.after(async () => {
    await app.close();
    await closeDatabase();
  });

  await app.register(cookie);
  await app.register(cors, { credentials: true, origin: true });
  await app.register(rateLimit, { global: false });
  await registerAuthRoutes(app);
  await registerProjectRoutes(app);
  await registerAdminRoutes(app);
  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
  });
  await app.ready();

  for (const url of ['/api/v1/me', '/api/v1/me/projects', '/api/v1/admin/users']) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 401, url);
    assert.equal(response.json().error.code, 'AUTH_REQUIRED', url);
  }

  const session = await app.inject({ method: 'GET', url: '/api/v1/auth/session' });
  assert.equal(session.statusCode, 200);
  assert.equal(session.json().user, null);

  const unknown = await app.inject({ method: 'GET', url: '/api/v1/no-such-route' });
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().error.code, 'NOT_FOUND');

  // A method without a matching route is essential to the advisory's path.
  // 400 confirms rejection before any protected fallback can return data.
  for (const method of ['GET', 'TRACE']) {
    const response = await app.inject({ method, url: '/api/v1/me/projects/%E0%A4%A' });
    assert.equal(response.statusCode, 400, method);
    assert.doesNotMatch(response.body, /AUTH_REQUIRED|PROJECT_NOT_FOUND/);
  }
});
