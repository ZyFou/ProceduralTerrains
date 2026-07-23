import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { publicUser, requireSession } from './auth-routes.js';
import { createShareCode, normalizeShareCode, validateProjectCreate, validateProjectUpdate } from './project-utils.js';

const PROJECT_BODY_LIMIT = 12 * 1024 * 1024;

const projectSummary = (row) => ({
  id: row.id,
  sourceProjectId: row.source_project_id ?? null,
  name: row.name,
  description: row.description ?? null,
  visibility: row.visibility,
  shareCode: row.share_code,
  contentRevision: Number(row.content_revision ?? 1),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

function validationReply(reply, errors) {
  return reply.code(400).send({
    error: { code: 'VALIDATION_ERROR', message: 'Check the highlighted fields.', fields: errors },
  });
}

function notFound(reply) {
  return reply.code(404).send({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
}

function parseProjectData(row) {
  try { return JSON.parse(row.project_data); }
  catch { return null; }
}

async function insertWithShareCode(values) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const shareCode = createShareCode();
    try {
      await db.execute(
        `INSERT INTO projects (id, user_id, source_project_id, name, description, visibility, share_code, project_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [...values.slice(0, 6), shareCode, values[6]],
      );
      return shareCode;
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
      if (String(error.message).includes('uq_projects_user_source')) throw error;
    }
  }
  throw new Error('Could not allocate a unique share code');
}

export async function registerProjectRoutes(app) {
  app.get('/api/v1/me/projects', async (request, reply) => {
    const user = await requireSession(request, reply);
    if (!user) return;
    const [rows] = await db.execute(
      `SELECT id, source_project_id, name, description, visibility, share_code, content_revision, created_at, updated_at
         FROM projects
        WHERE user_id = ?
        ORDER BY updated_at DESC`,
      [user.id],
    );
    reply.header('Cache-Control', 'no-store');
    return { projects: rows.map(projectSummary) };
  });

  app.post('/api/v1/me/projects', {
    bodyLimit: PROJECT_BODY_LIMIT,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = await requireSession(request, reply);
    if (!user) return;
    const result = validateProjectCreate(request.body, user.default_project_visibility);
    if (!result.ok) return validationReply(reply, result.errors);
    const projectId = randomUUID();
    const { name, description, visibility, projectData, sourceProjectId } = result.value;
    let shareCode;
    try {
      shareCode = await insertWithShareCode([projectId, user.id, sourceProjectId, name, description, visibility, projectData]);
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') {
        return reply.code(409).send({ error: { code: 'PROJECT_ALREADY_SYNCED', message: 'This local project is already synced.' } });
      }
      throw error;
    }
    const [[row]] = await db.execute(
      `SELECT id, source_project_id, name, description, visibility, share_code, content_revision, created_at, updated_at
         FROM projects WHERE id = ? LIMIT 1`,
      [projectId],
    );
    reply.header('Cache-Control', 'no-store');
    return reply.code(201).send({ project: { ...projectSummary(row), shareCode } });
  });

  app.get('/api/v1/me/projects/:projectId', async (request, reply) => {
    const user = await requireSession(request, reply);
    if (!user) return;
    const [[row]] = await db.execute(
      `SELECT id, source_project_id, name, description, visibility, share_code, project_data, content_revision, created_at, updated_at
         FROM projects WHERE id = ? AND user_id = ? LIMIT 1`,
      [String(request.params.projectId ?? '').slice(0, 36), user.id],
    );
    if (!row) return notFound(reply);
    const projectData = parseProjectData(row);
    if (!projectData) throw new Error(`Project ${row.id} contains invalid JSON`);
    reply.header('Cache-Control', 'no-store');
    return { project: { ...projectSummary(row), data: projectData } };
  });

  app.patch('/api/v1/me/projects/:projectId', {
    bodyLimit: PROJECT_BODY_LIMIT,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = await requireSession(request, reply);
    if (!user) return;
    const result = validateProjectUpdate(request.body);
    if (!result.ok) return validationReply(reply, result.errors);
    const columns = { name: 'name', description: 'description', visibility: 'visibility', projectData: 'project_data' };
    const entries = Object.entries(result.value);
    const updatesProjectData = Object.hasOwn(result.value, 'projectData');
    const assignments = entries.map(([key]) => `${columns[key]} = ?`);
    if (updatesProjectData) assignments.push('content_revision = content_revision + 1');
    const expectedClause = result.expectedContentRevision == null ? '' : ' AND content_revision = ?';
    const values = [...entries.map(([, value]) => value), String(request.params.projectId ?? '').slice(0, 36), user.id];
    if (result.expectedContentRevision != null) values.push(result.expectedContentRevision);
    const [update] = await db.execute(
      `UPDATE projects SET ${assignments.join(', ')} WHERE id = ? AND user_id = ?${expectedClause}`,
      values,
    );
    if (!update.affectedRows) {
      if (result.expectedContentRevision != null) {
        const [[existing]] = await db.execute(
          'SELECT id FROM projects WHERE id = ? AND user_id = ? LIMIT 1',
          [String(request.params.projectId ?? '').slice(0, 36), user.id],
        );
        if (existing) return reply.code(409).send({ error: { code: 'PROJECT_SYNC_CONFLICT', message: 'The cloud copy changed before it could be synced.' } });
      }
      return notFound(reply);
    }
    const [[row]] = await db.execute(
      `SELECT id, source_project_id, name, description, visibility, share_code, content_revision, created_at, updated_at
         FROM projects WHERE id = ? AND user_id = ? LIMIT 1`,
      [String(request.params.projectId ?? '').slice(0, 36), user.id],
    );
    reply.header('Cache-Control', 'no-store');
    return { project: projectSummary(row) };
  });

  app.delete('/api/v1/me/projects/:projectId', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = await requireSession(request, reply);
    if (!user) return;
    const [result] = await db.execute(
      'DELETE FROM projects WHERE id = ? AND user_id = ?',
      [String(request.params.projectId ?? '').slice(0, 36), user.id],
    );
    if (!result.affectedRows) return notFound(reply);
    reply.header('Cache-Control', 'no-store');
    return reply.code(204).send();
  });

  app.post('/api/v1/me/projects/:projectId/share-code', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = await requireSession(request, reply);
    if (!user) return;
    const projectId = String(request.params.projectId ?? '').slice(0, 36);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const shareCode = createShareCode();
      try {
        const [result] = await db.execute(
          'UPDATE projects SET share_code = ? WHERE id = ? AND user_id = ?',
          [shareCode, projectId, user.id],
        );
        if (!result.affectedRows) return notFound(reply);
        reply.header('Cache-Control', 'no-store');
        return { shareCode };
      } catch (error) {
        if (error?.code !== 'ER_DUP_ENTRY') throw error;
      }
    }
    throw new Error('Could not allocate a unique share code');
  });

  app.get('/api/v1/community/projects', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const search = String(request.query?.q ?? '').trim().slice(0, 120);
    const page = Math.min(10_000, Math.max(1, Number.parseInt(request.query?.page ?? '1', 10) || 1));
    const limit = 24;
    const offset = (page - 1) * limit;
    const filter = search ? 'AND (p.name LIKE ? OR p.description LIKE ? OR u.username LIKE ?)' : '';
    const values = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : [];
    const [[countRow]] = await db.execute(
      `SELECT COUNT(*) AS total
         FROM projects p JOIN users u ON u.id = p.user_id
        WHERE p.visibility = 'public' AND u.status = 'active' AND u.deleted_at IS NULL ${filter}`,
      values,
    );
    const [rows] = await db.execute(
      `SELECT p.id, p.source_project_id, p.name, p.description, p.visibility, p.share_code, p.content_revision, p.created_at, p.updated_at,
              u.id AS user_id, u.email, u.username, u.display_name, u.website_url,
              u.default_project_visibility, u.avatar_updated_at, u.email_verified_at, u.created_at AS user_created_at
         FROM projects p JOIN users u ON u.id = p.user_id
        WHERE p.visibility = 'public' AND u.status = 'active' AND u.deleted_at IS NULL ${filter}
        ORDER BY p.updated_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      values,
    );
    const projects = rows.map((row) => projectSummary({ ...row, created_at: row.created_at }));
    for (let index = 0; index < projects.length; index += 1) {
      projects[index].author = publicUser({
        ...rows[index],
        id: rows[index].user_id,
        created_at: rows[index].user_created_at,
      });
    }
    reply.header('Cache-Control', 'public, max-age=30');
    return { projects, page, total: Number(countRow.total), pages: Math.ceil(Number(countRow.total) / limit) };
  });

  app.get('/api/v1/projects/shared/:shareCode', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const shareCode = normalizeShareCode(request.params.shareCode);
    if (!shareCode) return notFound(reply);
    const [[row]] = await db.execute(
      `SELECT p.id, p.source_project_id, p.name, p.description, p.visibility, p.share_code, p.project_data, p.content_revision,
              p.created_at, p.updated_at, u.id AS user_id, u.email, u.username,
              u.display_name, u.website_url, u.default_project_visibility,
              u.avatar_updated_at, u.email_verified_at, u.created_at AS user_created_at
         FROM projects p JOIN users u ON u.id = p.user_id
        WHERE p.share_code = ? AND p.visibility IN ('unlisted', 'public')
          AND u.status = 'active' AND u.deleted_at IS NULL
        LIMIT 1`,
      [shareCode],
    );
    if (!row) return notFound(reply);
    const projectData = parseProjectData(row);
    if (!projectData) throw new Error(`Project ${row.id} contains invalid JSON`);
    const author = publicUser({ ...row, id: row.user_id, created_at: row.user_created_at });
    reply.header('Cache-Control', row.visibility === 'public' ? 'public, max-age=30' : 'no-store');
    return { project: { ...projectSummary(row), author, data: projectData } };
  });
}
