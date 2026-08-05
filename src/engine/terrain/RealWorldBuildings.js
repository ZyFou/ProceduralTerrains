// OpenStreetMap building footprints for the real-world terrain pipeline.
// The fetch/parse half stays THREE-free so it can be tested independently.

export const BUILDING_SOURCE = '© OpenStreetMap contributors (ODbL)';
export const BUILDING_SOURCE_URL = 'https://www.openstreetmap.org/copyright';

// Rotate between public global instances. A single Overpass host can reject a
// burst of slippy-map-style requests with 429/504 even when every query is
// valid, so retries deliberately move to another instance.
const OVERPASS_ENDPOINTS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const MAX_BUILDING_AREA_KM2 = 2500; // Public Overpass is for bounded, interactive queries.
const MAX_FEATURES_PER_CELL = 6000;
const QUERY_SENTINEL_LIMIT = MAX_FEATURES_PER_CELL + 1;
const MAX_SUBDIVISION_DEPTH = 2;
// Dense European city centres can time out on a single 4×4 km geometry query.
// Keep individual requests near 2×2 km; sparse larger cells are still merged
// transparently into one terrain-cell result.
const MAX_SINGLE_QUERY_AREA_KM2 = 10;
const MAX_REQUEST_ATTEMPTS = 3;
const EARTH_RADIUS_KM = 6371.0088;

let activeRequests = 0;
let nextEndpoint = 0;
const requestQueue = [];
const inFlightBboxes = new Map();

function runQueued(job) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ job, resolve, reject });
    drainQueue();
  });
}

function drainQueue() {
  while (activeRequests < 2 && requestQueue.length) {
    const next = requestQueue.shift();
    activeRequests++;
    Promise.resolve()
      .then(next.job)
      .then(next.resolve, next.reject)
      .finally(() => {
        activeRequests--;
        drainQueue();
      });
  }
}

const radians = (degrees) => degrees * Math.PI / 180;

export function bboxDimensionsKm(bbox) {
  const midLat = radians((bbox.minLat + bbox.maxLat) * 0.5);
  const latKm = radians(bbox.maxLat - bbox.minLat) * EARTH_RADIUS_KM;
  const lonKm = radians(bbox.maxLon - bbox.minLon) * EARTH_RADIUS_KM * Math.cos(midLat);
  return { width: Math.abs(lonKm), height: Math.abs(latKm), area: Math.abs(lonKm * latKm) };
}

function numberWithUnit(value) {
  if (value == null) return null;
  const text = String(value).trim().toLowerCase().split(';')[0].trim();
  const match = text.match(/^([+-]?\d+(?:\.\d+)?)\s*(m|meter|meters|metre|metres|ft|feet|'|′)?$/);
  if (!match) return null;
  let number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  if (match[2] === 'ft' || match[2] === 'feet' || match[2] === "'" || match[2] === '′') number *= 0.3048;
  return number;
}

function positiveNumber(value) {
  const number = Number(String(value ?? '').split(';')[0]);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function buildingDimensions(tags = {}) {
  const levels = positiveNumber(tags['building:levels'] ?? tags.levels);
  const minLevels = positiveNumber(tags['building:min_level']);
  const explicitHeight = numberWithUnit(tags.height ?? tags['building:height']);
  const explicitMin = numberWithUnit(tags.min_height ?? tags['building:min_height']);
  const kind = tags.building ?? tags['building:part'] ?? 'yes';
  const fallback = ['garage', 'garages', 'shed', 'carport', 'hut'].includes(kind) ? 3.2
    : ['industrial', 'warehouse', 'hangar'].includes(kind) ? 7
      : 7.5;
  const height = Math.max(1.8, explicitHeight ?? (levels != null ? levels * 3 : fallback));
  const minHeight = Math.max(0, Math.min(height - 0.5, explicitMin ?? (minLevels != null ? minLevels * 3 : 0)));
  return { height, minHeight, levels };
}

function samePoint(a, b) {
  return Math.abs(a.lat - b.lat) < 1e-10 && Math.abs(a.lon - b.lon) < 1e-10;
}

function normalizeRing(geometry) {
  const ring = (geometry || [])
    .filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lon))
    .map((point) => ({ lat: Number(point.lat), lon: Number(point.lon) }));
  if (ring.length > 1 && samePoint(ring[0], ring[ring.length - 1])) ring.pop();
  if (ring.length < 3) return null;
  return ring;
}

function featureFromGeometry(id, tags, geometry) {
  const ring = normalizeRing(geometry);
  if (!ring) return null;
  return {
    id,
    ring,
    tags: { ...tags },
    ...buildingDimensions(tags),
  };
}

/** Convert an Overpass JSON response into simple outer building rings. */
export function parseOverpassBuildings(payload, { limit = MAX_FEATURES_PER_CELL } = {}) {
  const features = [];
  const seen = new Set();
  const returnedWayIds = new Set((payload?.elements || [])
    .filter((element) => element.type === 'way')
    .map((element) => Number(element.id)));
  for (const element of payload?.elements || []) {
    if (features.length >= limit) break;
    if (element.type === 'way') {
      const key = `way/${element.id}`;
      if (seen.has(key)) continue;
      const feature = featureFromGeometry(key, element.tags || {}, element.geometry);
      if (feature) { seen.add(key); features.push(feature); }
      continue;
    }
    if (element.type !== 'relation') continue;
    for (let i = 0; i < (element.members || []).length && features.length < limit; i++) {
      const member = element.members[i];
      if (member.type !== 'way' || (member.role && member.role !== 'outer')) continue;
      if (returnedWayIds.has(Number(member.ref))) continue;
      const key = `relation/${element.id}/outer/${member.ref ?? i}`;
      if (seen.has(key)) continue;
      const feature = featureFromGeometry(key, element.tags || {}, member.geometry);
      if (feature) { seen.add(key); features.push(feature); }
    }
  }
  return features;
}

function overpassQuery(bbox) {
  const bounds = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
  // Building parts describe architectural sub-volumes and can multiply a city
  // query several-fold. The terrain layer needs complete outer footprints, so
  // query buildings themselves and keep the request small enough to finish.
  return `[out:json][timeout:25];(way["building"](${bounds});relation["building"](${bounds}););out tags geom ${QUERY_SENTINEL_LIMIT};`;
}

function bboxKey(bbox) {
  return [bbox.minLat, bbox.minLon, bbox.maxLat, bbox.maxLon]
    .map((value) => Number(value).toFixed(7))
    .join(',');
}

function splitBbox(bbox) {
  const midLat = (bbox.minLat + bbox.maxLat) * 0.5;
  const midLon = (bbox.minLon + bbox.maxLon) * 0.5;
  return [
    { minLat: bbox.minLat, minLon: bbox.minLon, maxLat: midLat, maxLon: midLon },
    { minLat: bbox.minLat, minLon: midLon, maxLat: midLat, maxLon: bbox.maxLon },
    { minLat: midLat, minLon: bbox.minLon, maxLat: bbox.maxLat, maxLon: midLon },
    { minLat: midLat, minLon: midLon, maxLat: bbox.maxLat, maxLon: bbox.maxLon },
  ];
}

function waitForRetry(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const finish = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function requestOverpass(bbox, { signal } = {}) {
  const endpointOffset = nextEndpoint++;
  let lastError = null;
  for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const endpoint = OVERPASS_ENDPOINTS[(endpointOffset + attempt) % OVERPASS_ENDPOINTS.length];
    try {
      return await runQueued(async () => {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, 35000);
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
              Accept: 'application/json',
            },
            body: `data=${encodeURIComponent(overpassQuery(bbox))}`,
            signal: controller.signal,
          });
          if (!response.ok) {
            const error = new Error(`Overpass request failed (${response.status})`);
            error.status = response.status;
            throw error;
          }
          const payload = await response.json();
          if (payload?.remark) throw new Error(`Overpass query failed: ${payload.remark}`);
          return payload;
        } catch (error) {
          if (timedOut && !signal?.aborted) throw new Error('Overpass request timed out');
          throw error;
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
        }
      });
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      lastError = error;
      if (error?.status === 400 || attempt === MAX_REQUEST_ATTEMPTS - 1) break;
      await waitForRetry(350 * Math.pow(2, attempt), signal);
    }
  }
  throw lastError ?? new Error('Overpass request failed');
}

function mergeBuildings(groups) {
  const merged = [];
  const seen = new Set();
  for (const group of groups) {
    for (const building of group) {
      if (seen.has(building.id)) continue;
      seen.add(building.id);
      merged.push(building);
    }
  }
  return merged;
}

async function fetchCompleteBbox(bbox, options, depth = 0) {
  // Large building+building:part geometry queries can time out even when the
  // final feature count is modest. Split them before asking Overpass rather
  // than waiting for a 504, especially for expanded terrain cells.
  if (depth < MAX_SUBDIVISION_DEPTH && bboxDimensionsKm(bbox).area > MAX_SINGLE_QUERY_AREA_KM2) {
    return fetchSubdividedBbox(bbox, options, depth);
  }
  const payload = await requestOverpass(bbox, options);
  const buildings = parseOverpassBuildings(payload, { limit: QUERY_SENTINEL_LIMIT });
  const saturated = buildings.length >= QUERY_SENTINEL_LIMIT;
  if (!saturated) return { buildings, subdivided: false, truncated: false };
  if (depth >= MAX_SUBDIVISION_DEPTH) {
    return {
      buildings: buildings.slice(0, MAX_FEATURES_PER_CELL),
      subdivided: false,
      truncated: true,
    };
  }
  return fetchSubdividedBbox(bbox, options, depth);
}

async function fetchSubdividedBbox(bbox, options, depth) {
  const parts = await Promise.allSettled(splitBbox(bbox)
    .map((part) => fetchCompleteBbox(part, options, depth + 1)));
  const loaded = parts
    .filter((part) => part.status === 'fulfilled')
    .map((part) => part.value);
  if (!loaded.length) {
    const failed = parts.find((part) => part.status === 'rejected');
    throw failed?.reason ?? new Error('All subdivided Overpass requests failed');
  }
  return {
    buildings: mergeBuildings(loaded.map((part) => part.buildings)),
    subdivided: true,
    truncated: loaded.some((part) => part.truncated),
    incomplete: loaded.some((part) => part.incomplete) || loaded.length !== parts.length,
  };
}

/** Fetch OSM footprints, retrying busy instances and subdividing dense bboxes. */
export async function fetchBboxBuildings(bbox, { signal } = {}) {
  const dimensions = bboxDimensionsKm(bbox);
  if (dimensions.area > MAX_BUILDING_AREA_KM2) {
    return { buildings: [], dimensions, skipped: 'area-too-large' };
  }
  const key = bboxKey(bbox);
  if (!signal && inFlightBboxes.has(key)) return inFlightBboxes.get(key);
  const request = fetchCompleteBbox(bbox, { signal }).then((result) => ({
    ...result,
    dimensions,
    source: BUILDING_SOURCE,
  }));
  if (!signal) {
    inFlightBboxes.set(key, request);
    request.then(
      () => inFlightBboxes.delete(key),
      () => inFlightBboxes.delete(key),
    );
  }
  return request;
}

function mercatorTileY(lat, zoom) {
  const clamped = Math.max(-85.051, Math.min(85.051, lat));
  const r = radians(clamped);
  return ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * Math.pow(2, zoom);
}

/** Project a WGS84 point into the exact world rect used by a real-world cell. */
export function geoPointToCellWorld(point, bbox, zoom, cx, cz, cellSize) {
  const u = (point.lon - bbox.minLon) / Math.max(1e-12, bbox.maxLon - bbox.minLon);
  const north = mercatorTileY(bbox.maxLat, zoom);
  const south = mercatorTileY(bbox.minLat, zoom);
  const v = (mercatorTileY(point.lat, zoom) - north) / Math.max(1e-12, south - north);
  return {
    x: (cx - 0.5 + u) * cellSize,
    z: (cz - 0.5 + v) * cellSize,
  };
}
