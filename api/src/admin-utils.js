export const USER_STATUSES = new Set(['active', 'suspended']);
export const USER_ROLES = new Set(['user', 'admin']);

export function parseAdminUserPatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: { request: 'Provide user settings to update.' } };
  }
  const value = {};
  const errors = {};
  if (Object.hasOwn(input, 'status')) {
    if (!USER_STATUSES.has(input.status)) errors.status = 'Status must be active or suspended.';
    else value.status = input.status;
  }
  if (Object.hasOwn(input, 'role')) {
    if (!USER_ROLES.has(input.role)) errors.role = 'Role must be user or admin.';
    else value.role = input.role;
  }
  if (!Object.keys(value).length && !Object.keys(errors).length) {
    errors.request = 'Provide a status or role to update.';
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

export function parseListQuery(query = {}, { maxLimit = 100 } = {}) {
  const page = Math.max(1, Math.min(10_000, Number.parseInt(query.page ?? '1', 10) || 1));
  const limit = Math.max(1, Math.min(maxLimit, Number.parseInt(query.limit ?? '20', 10) || 20));
  return {
    page,
    limit,
    offset: (page - 1) * limit,
    search: String(query.q ?? '').trim().slice(0, 120),
  };
}
