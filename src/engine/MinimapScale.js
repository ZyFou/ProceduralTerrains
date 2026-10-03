const EARTH_RADIUS = 6371008.8;
const RAD = Math.PI / 180;

export function formatMapDistance(value, unit = 'm') {
  if (unit === 'u') return `${Number(value.toPrecision(3))} u`;
  const distance = value >= 1000 ? value / 1000 : value;
  return `${Number(distance.toPrecision(3))} ${value >= 1000 ? 'km' : 'm'}`;
}

/** Horizontal ground scale at the latitude of the ruler, using the same
 * Mercator latitude mapping as the imported terrain. */
export function createMinimapScale(view, reference, width = 256) {
  const span = view.halfSpan * 2;
  if (!Number.isFinite(span) || span <= 0 || width <= 0) return null;
  let unitsPerPixel = span / width, unit = 'u';
  const bbox = reference?.bbox;
  if (bbox && reference.cellSize > 0) {
    const north = Math.asinh(Math.tan(bbox.maxLat * RAD));
    const south = Math.asinh(Math.tan(bbox.minLat * RAD));
    const rulerZ = view.centerZ + view.halfSpan * 0.85;
    const mercator = north + (south - north) * (rulerZ / reference.cellSize + 0.5);
    const latitude = Math.atan(Math.sinh(mercator));
    unitsPerPixel *= EARTH_RADIUS * Math.cos(latitude) * (bbox.maxLon - bbox.minLon) * RAD / reference.cellSize;
    unit = 'm';
  }
  if (!Number.isFinite(unitsPerPixel) || unitsPerPixel <= 0) return null;
  const maxDistance = unitsPerPixel * width * 0.42;
  const power = 10 ** Math.floor(Math.log10(maxDistance));
  const distance = [5, 2, 1].find((step) => step * power <= maxDistance) * power;
  return { distance, pixels: distance / unitsPerPixel, unit, label: formatMapDistance(distance, unit), spanLabel: formatMapDistance(unitsPerPixel * width, unit) };
}

/** Shared drawing path for the local renderer and render-worker presenter. */
export function drawMinimapScale(ctx, scale, width = 256, height = 256) {
  if (!scale) return;
  ctx.save();
  const x = 12, y = height - 14;
  ctx.fillStyle = 'rgba(9,12,18,0.82)';
  ctx.fillRect(6, height - 44, width - 12, 38);
  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left';
  ctx.fillText('0', x, y - 10);
  ctx.textAlign = 'right';
  ctx.fillText(scale.label, x + scale.pixels, y - 10);
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.fillText(`${scale.unit === 'm' ? '≈ ' : ''}${scale.spanLabel} wide`, width - 12, y + 1);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + scale.pixels, y);
  for (let i = 0; i <= 4; i++) {
    const tickX = x + scale.pixels * i / 4;
    ctx.moveTo(tickX, y - (i === 0 || i === 4 ? 6 : 3)); ctx.lineTo(tickX, y + 2);
  }
  ctx.stroke(); ctx.restore();
}
