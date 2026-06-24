// ============================================================================
// Real-world heightmap source: fetches public elevation tiles for a curated
// list of famous locations and decodes them into a normalized height field that
// the existing Tile-mode import pipeline can consume (Engine.loadRealWorldLocation
// → importedMaps.height.floatData → _rebuildImportedTexture).
//
// Source: AWS Open Data "Terrain Tiles" in Terrarium encoding — public, no API
// key, CORS-enabled, derived from SRTM/NED/etc. Elevation is packed across RGB:
//     elevation_m = (R * 256 + G + B / 256) - 32768
//
// This module is intentionally THREE-free and side-effect-free: it only touches
// <canvas>/<img> for decoding and returns plain data.
// ============================================================================

const TILE = 256;
// Single swappable endpoint — if CORS ever breaks, only this line changes.
const ENDPOINT = 'https://elevation-tiles-prod.s3.dualstack.us-east-1.amazonaws.com/terrarium';
const MAX_TILES_PER_AXIS = 6;          // safety cap: at most 6×6 = 36 tile fetches
const SEA_FILL = 'rgb(128,0,0)';       // Terrarium encoding of 0 m (decodes to elevation 0)

export const ELEVATION_SOURCE = 'Elevation: Terrain Tiles (Terrarium) via AWS Open Data — Mapzen, SRTM & others';

// Curated, roughly-square bounding boxes around recognizable terrain.
export const CURATED_LOCATIONS = [
  { id: 'grand-canyon', name: 'Grand Canyon', blurb: 'Carved gorge, Arizona USA',
    bbox: { minLat: 35.95, maxLat: 36.35, minLon: -112.45, maxLon: -111.95 }, zoom: 11 },
  { id: 'everest', name: 'Mount Everest', blurb: 'Himalaya, Nepal / Tibet',
    bbox: { minLat: 27.80, maxLat: 28.18, minLon: 86.70, maxLon: 87.10 }, zoom: 11 },
  { id: 'fuji', name: 'Mount Fuji', blurb: 'Stratovolcano, Japan',
    bbox: { minLat: 35.21, maxLat: 35.55, minLon: 138.55, maxLon: 138.93 }, zoom: 11 },
  { id: 'matterhorn', name: 'Matterhorn', blurb: 'Pennine Alps, Switzerland / Italy',
    bbox: { minLat: 45.83, maxLat: 46.13, minLon: 7.46, maxLon: 7.86 }, zoom: 11 },
  { id: 'grand-teton', name: 'Grand Teton', blurb: 'Teton Range, Wyoming USA',
    bbox: { minLat: 43.58, maxLat: 43.92, minLon: -110.98, maxLon: -110.62 }, zoom: 11 },
  { id: 'crater-lake', name: 'Crater Lake', blurb: 'Caldera, Oregon USA',
    bbox: { minLat: 42.83, maxLat: 43.07, minLon: -122.27, maxLon: -121.97 }, zoom: 11 },
  { id: 'yosemite', name: 'Yosemite Valley', blurb: 'Sierra Nevada, California USA',
    bbox: { minLat: 37.62, maxLat: 37.88, minLon: -119.70, maxLon: -119.40 }, zoom: 11 },
  { id: 'big-island', name: 'Hawaii (Big Island)', blurb: 'Mauna Loa & Mauna Kea',
    bbox: { minLat: 19.30, maxLat: 19.90, minLon: -155.90, maxLon: -155.20 }, zoom: 10 },
  { id: 'vatnajokull', name: 'Vatnajökull', blurb: 'Glacial highlands, Iceland',
    bbox: { minLat: 64.20, maxLat: 64.62, minLon: -17.25, maxLon: -16.45 }, zoom: 10 },

  // --- Swiss Alps (specific peaks) ---
  { id: 'eiger', name: 'Eiger & Jungfrau', blurb: 'Bernese Alps north face, Switzerland',
    bbox: { minLat: 46.50, maxLat: 46.62, minLon: 7.93, maxLon: 8.07 }, zoom: 12 },
  { id: 'monte-rosa', name: 'Monte Rosa', blurb: 'Highest Swiss massif, Pennine Alps',
    bbox: { minLat: 45.86, maxLat: 46.00, minLon: 7.80, maxLon: 7.94 }, zoom: 12 },
  { id: 'piz-bernina', name: 'Piz Bernina', blurb: 'Bernina Range glaciers, Engadin',
    bbox: { minLat: 46.32, maxLat: 46.44, minLon: 9.84, maxLon: 9.98 }, zoom: 12 },
  { id: 'mont-blanc', name: 'Mont Blanc', blurb: 'Highest Alps summit, France / Italy',
    bbox: { minLat: 45.78, maxLat: 45.92, minLon: 6.79, maxLon: 6.95 }, zoom: 12 },

  // --- Iceland (more regions) ---
  { id: 'landmannalaugar', name: 'Landmannalaugar', blurb: 'Rhyolite highlands, Iceland',
    bbox: { minLat: 63.92, maxLat: 64.10, minLon: -19.20, maxLon: -18.95 }, zoom: 11 },
  { id: 'askja', name: 'Askja', blurb: 'Caldera & lava desert, Highlands of Iceland',
    bbox: { minLat: 65.00, maxLat: 65.12, minLon: -16.85, maxLon: -16.65 }, zoom: 11 },
  { id: 'snaefellsjokull', name: 'Snæfellsjökull', blurb: 'Glacier-capped volcano, W Iceland',
    bbox: { minLat: 64.74, maxLat: 64.86, minLon: -23.88, maxLon: -23.70 }, zoom: 11 },

  // --- New Zealand (geothermal & alpine) ---
  { id: 'taupo-volcanic', name: 'Taupō Volcanic Zone', blurb: 'Geothermal field & craters, NZ',
    bbox: { minLat: -39.30, maxLat: -39.06, minLon: 175.55, maxLon: 175.82 }, zoom: 11 },
  { id: 'mount-cook', name: 'Aoraki / Mount Cook', blurb: 'Southern Alps, New Zealand',
    bbox: { minLat: -43.66, maxLat: -43.52, minLon: 170.05, maxLon: 170.23 }, zoom: 11 },
  { id: 'fiordland', name: 'Milford Sound', blurb: 'Fiordland glacial valleys, NZ',
    bbox: { minLat: -44.72, maxLat: -44.54, minLon: 167.78, maxLon: 168.02 }, zoom: 11 },

  // --- Patagonia ---
  { id: 'fitz-roy', name: 'Monte Fitz Roy', blurb: 'Granite spires, Patagonia, Argentina',
    bbox: { minLat: -49.36, maxLat: -49.20, minLon: -73.10, maxLon: -72.92 }, zoom: 11 },
  { id: 'torres-del-paine', name: 'Torres del Paine', blurb: 'Massif & lakes, Chilean Patagonia',
    bbox: { minLat: -51.10, maxLat: -50.90, minLon: -73.10, maxLon: -72.80 }, zoom: 11 },

  // --- Other famous ranges & volcanoes ---
  { id: 'denali', name: 'Denali', blurb: 'Highest peak in North America, Alaska USA',
    bbox: { minLat: 63.00, maxLat: 63.20, minLon: -151.18, maxLon: -150.80 }, zoom: 11 },
  { id: 'kilimanjaro', name: 'Kilimanjaro', blurb: 'Highest peak in Africa, Tanzania',
    bbox: { minLat: -3.15, maxLat: -2.97, minLon: 37.27, maxLon: 37.47 }, zoom: 11 },
  { id: 'k2', name: 'K2', blurb: 'Karakoram, Pakistan / China',
    bbox: { minLat: 35.79, maxLat: 35.97, minLon: 76.41, maxLon: 76.61 }, zoom: 11 },
  { id: 'aconcagua', name: 'Aconcagua', blurb: 'Highest peak in the Americas, Argentina',
    bbox: { minLat: -32.74, maxLat: -32.56, minLon: -70.10, maxLon: -69.90 }, zoom: 11 },
  { id: 'annapurna', name: 'Annapurna', blurb: 'Deep Himalayan massif, Nepal',
    bbox: { minLat: 28.50, maxLat: 28.68, minLon: 83.74, maxLon: 83.94 }, zoom: 11 },
  { id: 'zion', name: 'Zion Canyon', blurb: 'Sandstone canyon, Utah USA',
    bbox: { minLat: 37.18, maxLat: 37.36, minLon: -113.10, maxLon: -112.90 }, zoom: 11 },
  { id: 'monument-valley', name: 'Monument Valley', blurb: 'Sandstone buttes, Arizona / Utah USA',
    bbox: { minLat: 36.94, maxLat: 37.10, minLon: -110.20, maxLon: -110.00 }, zoom: 11 },
  { id: 'dolomites', name: 'Dolomites', blurb: 'Limestone towers, Tre Cime, Italy',
    bbox: { minLat: 46.58, maxLat: 46.70, minLon: 12.25, maxLon: 12.40 }, zoom: 12 },
  { id: 'mount-rainier', name: 'Mount Rainier', blurb: 'Glaciated stratovolcano, Washington USA',
    bbox: { minLat: 46.78, maxLat: 46.92, minLon: -121.83, maxLon: -121.65 }, zoom: 11 },
  { id: 'etna', name: 'Mount Etna', blurb: 'Active volcano, Sicily, Italy',
    bbox: { minLat: 37.68, maxLat: 37.82, minLon: 14.93, maxLon: 15.07 }, zoom: 11 },
];

export function getLocation(id) {
  return CURATED_LOCATIONS.find((l) => l.id === id) || null;
}

// --- Web-Mercator slippy-tile math (fractional tile coordinates) ---
function lonToTileX(lon, z) {
  return ((lon + 180) / 360) * Math.pow(2, z);
}
function latToTileY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * Math.pow(2, z);
}

// Choose the highest zoom whose tile span still fits under the per-axis cap.
function pickZoom(loc) {
  for (let z = loc.zoom; z > 0; z--) {
    const nx = Math.floor(lonToTileX(loc.bbox.maxLon, z)) - Math.floor(lonToTileX(loc.bbox.minLon, z)) + 1;
    const ny = Math.floor(latToTileY(loc.bbox.minLat, z)) - Math.floor(latToTileY(loc.bbox.maxLat, z)) + 1;
    if (nx <= MAX_TILES_PER_AXIS && ny <= MAX_TILES_PER_AXIS) return z;
  }
  return 1;
}

function loadTile(z, x, y, signal) {
  return new Promise((resolve) => {
    const max = Math.pow(2, z);
    const wx = ((x % max) + max) % max;            // wrap longitude
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);             // tolerate a missing tile
    if (signal) signal.addEventListener('abort', () => { img.src = ''; resolve(null); }, { once: true });
    img.src = `${ENDPOINT}/${z}/${wx}/${y}.png`;
  });
}

function makePreview(floatData, W, H, maxSide = 160) {
  const scale = Math.min(1, maxSide / Math.max(W, H));
  const pw = Math.max(1, Math.round(W * scale));
  const ph = Math.max(1, Math.round(H * scale));
  const c = document.createElement('canvas');
  c.width = pw; c.height = ph;
  const cx = c.getContext('2d');
  const out = cx.createImageData(pw, ph);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const sx = Math.min(W - 1, Math.floor(x / scale));
      const sy = Math.min(H - 1, Math.floor(y / scale));
      const b = Math.round(floatData[sy * W + sx] * 255);
      const o = (y * pw + x) * 4;
      out.data[o] = out.data[o + 1] = out.data[o + 2] = b;
      out.data[o + 3] = 255;
    }
  }
  cx.putImageData(out, 0, 0);
  return c.toDataURL('image/png');
}

/**
 * Fetch + decode the elevation field for a curated location.
 * @returns {Promise<{width:number,height:number,floatData:Float32Array,fileName:string,preview:string,meta:object}>}
 * @throws if every tile failed to load (likely CORS or offline).
 */
export async function fetchLocationHeightmap(loc, { onProgress, signal } = {}) {
  const z = pickZoom(loc);
  const fx0 = lonToTileX(loc.bbox.minLon, z);
  const fx1 = lonToTileX(loc.bbox.maxLon, z);
  const fy0 = latToTileY(loc.bbox.maxLat, z);   // north edge → smaller tile-Y
  const fy1 = latToTileY(loc.bbox.minLat, z);   // south edge → larger tile-Y
  const tx0 = Math.floor(fx0), tx1 = Math.floor(fx1);
  const ty0 = Math.floor(fy0), ty1 = Math.floor(fy1);
  const nx = tx1 - tx0 + 1, ny = ty1 - ty0 + 1;

  const stitch = document.createElement('canvas');
  stitch.width = nx * TILE; stitch.height = ny * TILE;
  const sctx = stitch.getContext('2d', { willReadFrequently: true });

  const total = nx * ny;
  let done = 0, ok = 0;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const img = await loadTile(z, tx, ty, signal);
      const dx = (tx - tx0) * TILE, dy = (ty - ty0) * TILE;
      if (img) { sctx.drawImage(img, dx, dy); ok++; }
      else { sctx.fillStyle = SEA_FILL; sctx.fillRect(dx, dy, TILE, TILE); }
      done++; onProgress?.(done / total);
    }
  }
  if (ok === 0) {
    throw new Error('No elevation tiles could be loaded (network or CORS blocked).');
  }

  // Crop the stitched grid to the exact bounding box.
  const cropX = Math.max(0, Math.round((fx0 - tx0) * TILE));
  const cropY = Math.max(0, Math.round((fy0 - ty0) * TILE));
  const cropW = Math.min(stitch.width - cropX, Math.max(1, Math.round((fx1 - fx0) * TILE)));
  const cropH = Math.min(stitch.height - cropY, Math.max(1, Math.round((fy1 - fy0) * TILE)));
  const id = sctx.getImageData(cropX, cropY, cropW, cropH);

  const W = id.width, H = id.height, data = id.data;
  const floatData = new Float32Array(W * H);
  let minE = Infinity, maxE = -Infinity;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const e = data[i] * 256 + data[i + 1] + data[i + 2] / 256 - 32768;
    floatData[p] = e;
    if (e < minE) minE = e;
    if (e > maxE) maxE = e;
  }
  // Normalize to 0..1 for the import texture; real elevation range is in meta.
  const span = maxE > minE ? maxE - minE : 1;
  for (let p = 0; p < floatData.length; p++) floatData[p] = (floatData[p] - minE) / span;

  return {
    width: W,
    height: H,
    floatData,
    fileName: `${loc.name} (real-world)`,
    preview: makePreview(floatData, W, H),
    meta: { name: loc.name, zoom: z, minElev: minE, maxElev: maxE, source: ELEVATION_SOURCE },
  };
}
