import { rot2, vnoise2 } from '../noise/cpuNoise.js';

export const DETAIL_PAGE_SIZE = 256;
export const DETAIL_PAGE_SPAN = 128;
export const DETAIL_PAGE_CACHE_LIMIT = 32;

const clamp01 = (value) => Math.min(1, Math.max(0, value));

// Matches the planar noise bands in TerrainDetailMaterial. Each page is
// world-aligned so changing camera position never changes the pattern.
export function detailNoise2D(x, y, scale, seedX, seedY) {
  const px = x * Math.max(scale, 0.0001) + seedX * 0.37;
  const py = y * Math.max(scale, 0.0001) + seedY * 0.37;
  const [rx, ry] = rot2(px, py);
  return clamp01(
    vnoise2(px, py) * 0.50
    + vnoise2(rx * 2.73 + 19.7, ry * 2.73 + 41.1) * 0.32
    + vnoise2(rx * 6.10 + 83.2, ry * 6.10 + 11.4) * 0.18,
  );
}

export function bakeDetailPage({ x, y, scale, seedX, seedY }) {
  const bytes = new Uint8Array(DETAIL_PAGE_SIZE * DETAIL_PAGE_SIZE * 4);
  for (let py = 0; py < DETAIL_PAGE_SIZE; py++) {
    const wy = (y + (py + 0.5) / DETAIL_PAGE_SIZE) * DETAIL_PAGE_SPAN;
    for (let px = 0; px < DETAIL_PAGE_SIZE; px++) {
      const wx = (x + (px + 0.5) / DETAIL_PAGE_SIZE) * DETAIL_PAGE_SPAN;
      const offset = (py * DETAIL_PAGE_SIZE + px) * 4;
      bytes[offset] = Math.round(detailNoise2D(wx, wy, scale, seedX, seedY) * 255);
      bytes[offset + 1] = Math.round(detailNoise2D(wx + 53, wy + 29, scale * 0.33, seedX, seedY) * 255);
      bytes[offset + 2] = Math.round(detailNoise2D(wx + 11.3, wy + 23.9, scale * 3, seedX, seedY) * 255);
      bytes[offset + 3] = Math.round(detailNoise2D(wx + 127, wy + 211, scale * 0.085, seedX, seedY) * 255);
    }
  }
  return bytes;
}
