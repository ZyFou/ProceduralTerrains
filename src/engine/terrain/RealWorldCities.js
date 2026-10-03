// Named settlement centers from OpenStreetMap's place nodes.
// https://wiki.openstreetmap.org/wiki/Key:place
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const cache = new Map();
export function parseCityMarkers(payload, bbox) {
  if (payload?.remark) throw new Error('The city query could not finish. Try a smaller area.');
  const seen = new Set();
  const priority = { city: 0, town: 1, village: 2 };
  return (payload?.elements || [])
    .filter((p) => p.type === 'node' && p.tags?.name && Object.hasOwn(priority, p.tags.place)
      && Number.isFinite(p.lat) && Number.isFinite(p.lon)
      && p.lat >= bbox.minLat && p.lat <= bbox.maxLat && p.lon >= bbox.minLon && p.lon <= bbox.maxLon)
    .sort((a, b) => priority[a.tags.place] - priority[b.tags.place] || String(a.tags.name).localeCompare(String(b.tags.name)))
    .filter((p) => { const key = `${p.tags.name}:${p.lat.toFixed(3)}:${p.lon.toFixed(3)}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .slice(0, 200)
    .map((p) => ({ id: `city/node/${p.id}`, name: String(p.tags.name).slice(0, 80), lat: p.lat, lon: p.lon, visible: true, source: 'city' }));
}
export async function fetchCityMarkers(bbox, { signal } = {}) {
  if (!bbox || !Object.values(bbox).every(Number.isFinite) || bbox.minLat < -85.051 || bbox.maxLat > 85.051
    || bbox.minLon < -180 || bbox.maxLon > 180 || bbox.minLat >= bbox.maxLat || bbox.minLon >= bbox.maxLon) throw new Error('Invalid city search area.');
  const key = JSON.stringify(bbox), saved = cache.get(key);
  if (saved && Date.now() - saved.time < 600000) return saved.points;
  const query = `[out:json][timeout:20];node["place"~"^(city|town|village)$"]["name"](${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon});out body 2000;`;
  let error;
  for (const endpoint of ENDPOINTS) {
    const timeout = new AbortController();
    const abort = () => timeout.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 25000);
    try {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const response = await fetch(endpoint, { method: 'POST', body: new URLSearchParams({ data: query }), signal: timeout.signal });
      if (!response.ok) throw new Error(`City service unavailable (${response.status}).`);
      const points = parseCityMarkers(await response.json(), bbox);
      cache.set(key, { time: Date.now(), points });
      if (cache.size > 24) cache.delete(cache.keys().next().value);
      return points;
    } catch (e) {
      if (signal?.aborted) throw e;
      error = timeout.signal.aborted ? new Error('City service timed out. Try refreshing the markers.') : e;
    }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  throw error;
}
