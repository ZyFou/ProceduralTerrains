// Use the same-origin path by default in every environment. Vite proxies it
// to the local API during development; production can route /api to the API
// service at the edge or override it with VITE_API_URL when hosted separately.
const defaultBase = '/api/v1';
const configuredBase = String(import.meta.env.VITE_API_URL ?? defaultBase).trim();
export const API_BASE_URL = configuredBase.replace(/\/+$/, '') || '/api/v1';

export function avatarUrl(user) {
  if (!user?.id || !user.avatarUpdatedAt) return null;
  return `${API_BASE_URL}/users/${encodeURIComponent(user.id)}/avatar?v=${encodeURIComponent(user.avatarUpdatedAt)}`;
}

export class AuthApiError extends Error {
  constructor(message, { code = 'REQUEST_FAILED', status = 0, fields = {} } = {}) {
    super(message);
    this.name = 'AuthApiError';
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

export async function apiRequest(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      signal,
      credentials: 'include',
      headers: body == null ? undefined : { 'Content-Type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new AuthApiError('The account server is unavailable. Check the API URL or try again later.', {
      code: 'API_UNAVAILABLE',
    });
  }

  if (response.status === 204) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AuthApiError(payload?.error?.message ?? 'The request could not be completed.', {
      code: payload?.error?.code,
      status: response.status,
      fields: payload?.error?.fields,
    });
  }
  return payload;
}

export const authApi = {
  session: (options) => apiRequest('/auth/session', options),
  register: (input) => apiRequest('/auth/register', { method: 'POST', body: input }),
  login: (input) => apiRequest('/auth/login', { method: 'POST', body: input }),
  logout: () => apiRequest('/auth/logout', { method: 'POST' }),
  updateProfile: (input) => apiRequest('/me', { method: 'PATCH', body: input }),
  updateAvatar: (dataUrl) => apiRequest('/me/avatar', { method: 'PUT', body: { dataUrl } }),
  removeAvatar: () => apiRequest('/me/avatar', { method: 'DELETE' }),
  changePassword: (input) => apiRequest('/me/password', { method: 'PUT', body: input }),
};
