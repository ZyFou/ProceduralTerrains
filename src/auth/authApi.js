// The browser keeps the same-origin default used by Vite's development proxy.
// Packaged Electron builds receive VITE_DISTANT_URL at build time and may
// switch between that remote endpoint and a user-run local API at runtime.
export const LOCAL_API_BASE_URL = 'http://localhost:6062/api/v1';
const browserDefault = '/api/v1';
const desktopProxyBase = 'procedural-terrain://app/api/v1';
const configuredRemote = String(
  import.meta.env.VITE_DISTANT_URL ?? import.meta.env.VITE_API_URL ?? browserDefault,
).trim();

function isPackagedDesktopRenderer() {
  return !!globalThis.window?.proceduralTerrainsDesktop
    && globalThis.location?.protocol === 'procedural-terrain:';
}

// AuthContext may check the session before App has restored its saved backend
// preference. Start on the Electron relay immediately so that first request
// cannot escape directly to the remote API and be rejected by CORS.
export let API_BASE_URL = isPackagedDesktopRenderer()
  ? desktopProxyBase
  : (configuredRemote.replace(/\/+$/, '') || browserDefault);

function normalizedUrl(value) {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

export function getApiBaseUrl() {
  return API_BASE_URL;
}

export function resolveBackendUrl({ profile = 'remote', remoteUrl = configuredRemote } = {}) {
  // In the packaged app the custom protocol is the renderer's own origin.
  // Electron's main process forwards that route to the configured endpoint,
  // preserving secure cookies without asking the remote API to trust a custom
  // browser scheme. Development keeps the normal Vite/HTTP behavior.
  if (isPackagedDesktopRenderer()) return desktopProxyBase;
  return profile === 'local' ? LOCAL_API_BASE_URL : normalizedUrl(remoteUrl) || browserDefault;
}

export function setApiBackend(settings) {
  API_BASE_URL = resolveBackendUrl(settings);
  window.dispatchEvent(new CustomEvent('terrain-backend:changed', { detail: { ...settings, baseUrl: API_BASE_URL } }));
  return API_BASE_URL;
}

export function avatarUrl(user) {
  if (!user?.id || !user.avatarUpdatedAt) return null;
  return `${getApiBaseUrl()}/users/${encodeURIComponent(user.id)}/avatar?v=${encodeURIComponent(user.avatarUpdatedAt)}`;
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
    response = await fetch(`${getApiBaseUrl()}${path}`, {
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
