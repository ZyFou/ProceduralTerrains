import { apiRequest } from '../auth/authApi.js';

const queryString = (params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== '' && value != null) query.set(key, String(value));
  });
  return query.size ? `?${query}` : '';
};

export const adminApi = {
  overview: () => apiRequest('/admin/overview'),
  users: (params) => apiRequest(`/admin/users${queryString(params)}`),
  updateUser: (userId, input) => apiRequest(`/admin/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: input }),
  revokeSessions: (userId) => apiRequest(`/admin/users/${encodeURIComponent(userId)}/revoke-sessions`, { method: 'POST' }),
  visits: (params) => apiRequest(`/admin/visits${queryString(params)}`),
  terrains: (params) => apiRequest(`/admin/terrains${queryString(params)}`),
  audit: (params) => apiRequest(`/admin/audit${queryString(params)}`),
  security: () => apiRequest('/admin/security'),
  trackVisit: (path) => apiRequest('/analytics/visit', { method: 'POST', body: { path } }),
};
