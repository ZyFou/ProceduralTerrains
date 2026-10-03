export function normalizeMarkers(input = {}) {
  if (!input || typeof input !== 'object') input = {};
  const points = (Array.isArray(input.points) ? input.points : []).slice(0, 200)
    .filter((p) => p && typeof p.id === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 85.051 && Math.abs(p.lon) <= 180)
    .map((p) => ({ id: p.id.slice(0, 80), name: String(p.name || 'Place').slice(0, 80), lat: p.lat, lon: p.lon, visible: p.visible !== false }));
  const ids = new Set(points.map((p) => p.id));
  const routes = (Array.isArray(input.routes) ? input.routes : []).slice(0, 200)
    .filter((r) => r && typeof r.id === 'string' && ids.has(r.from) && ids.has(r.to) && r.from !== r.to)
    .map((r) => ({ id: r.id.slice(0, 80), from: r.from, to: r.to, visible: r.visible !== false }));
  return { visible: input.visible !== false, labels: input.labels !== false, lift: Number.isFinite(input.lift) ? Math.max(1, Math.min(500, input.lift)) : 30, points, routes };
}
