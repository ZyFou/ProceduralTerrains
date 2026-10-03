// Lambert-93 constants and isometric latitude formula from IGN's
// representations-planes_v3-0.pdf (GRS80 / RGF93).
export const COORDINATE_FORMATS = [
  { value: 'degrees', label: 'Decimal degrees (WGS84)' },
  { value: 'dms', label: 'Degrees, minutes, seconds' },
  { value: 'lambert93', label: 'Lambert 93 (EPSG:2154)' },
  { value: 'mercator', label: 'Web Mercator (EPSG:3857)' },
];
const RAD = Math.PI / 180;
const E = 0.08181919112, N = 0.7256077650, C = 11754255.426;
const XS = 700000, YS = 12655612.050, R = 6378137;
export function projectCoordinates({ lat, lon }, format) {
  const phi = lat * RAD;
  if (format === 'mercator') return { x: R * lon * RAD, y: R * Math.asinh(Math.tan(phi)) };
  const sin = Math.sin(phi);
  const iso = Math.log(Math.tan(Math.PI / 4 + phi / 2)) - E / 2 * Math.log((1 + E * sin) / (1 - E * sin));
  const radius = C * Math.exp(-N * iso), angle = N * (lon - 3) * RAD;
  return { x: XS + radius * Math.sin(angle), y: YS - radius * Math.cos(angle) };
}
export function unprojectCoordinates({ x, y }, format) {
  if (format === 'mercator') return { lat: Math.atan(Math.sinh(y / R)) / RAD, lon: x / R / RAD };
  const radius = Math.hypot(x - XS, YS - y);
  const iso = -Math.log(radius / C) / N;
  let phi = 2 * Math.atan(Math.exp(iso)) - Math.PI / 2;
  for (let i = 0; i < 12; i++) {
    const es = E * Math.sin(phi);
    phi = 2 * Math.atan(Math.exp(iso) * ((1 + es) / (1 - es)) ** (E / 2)) - Math.PI / 2;
  }
  return { lat: phi / RAD, lon: 3 + Math.atan2(x - XS, YS - y) / N / RAD };
}
export function parseProjectedCoordinates(text, format) {
  const pair = String(text).trim().match(/^([+-]?\d+(?:\.\d+)?)\s*[,;\s]\s*([+-]?\d+(?:\.\d+)?)$/);
  if (!pair) return null;
  const result = unprojectCoordinates({ x: Number(pair[1]), y: Number(pair[2]) }, format);
  if (!Number.isFinite(result.lat) || !Number.isFinite(result.lon) || Math.abs(result.lat) > 85.051 || Math.abs(result.lon) > 180) return null;
  if (format === 'lambert93' && (result.lat < 41 || result.lat > 52 || result.lon < -10 || result.lon > 11)) return null;
  return result;
}
export function formatDMS(value, positive, negative) {
  const total = Math.round(Math.abs(value) * 3600 * 100) / 100;
  const degrees = Math.floor(total / 3600), minutes = Math.floor((total - degrees * 3600) / 60);
  return `${degrees}° ${minutes}' ${(total - degrees * 3600 - minutes * 60).toFixed(2)}"${value >= 0 ? positive : negative}`;
}
