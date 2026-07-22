import { apiRequest } from '../auth/authApi.js';

export const projectApi = {
  listMine: () => apiRequest('/me/projects'),
  create: (input) => apiRequest('/me/projects', { method: 'POST', body: input }),
  getMine: (projectId) => apiRequest(`/me/projects/${encodeURIComponent(projectId)}`),
  update: (projectId, input) => apiRequest(`/me/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', body: input }),
  remove: (projectId) => apiRequest(`/me/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' }),
  rotateShareCode: (projectId) => apiRequest(`/me/projects/${encodeURIComponent(projectId)}/share-code`, { method: 'POST' }),
  community: ({ query = '', page = 1 } = {}) => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (page > 1) params.set('page', String(page));
    const suffix = params.size ? `?${params}` : '';
    return apiRequest(`/community/projects${suffix}`);
  },
  shared: (shareCode) => apiRequest(`/projects/shared/${encodeURIComponent(String(shareCode).trim())}`),
};
