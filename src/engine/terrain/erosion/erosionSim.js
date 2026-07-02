// ============================================================================
// Pure erosion simulation — no THREE, no DOM, no globals. Safe to run inside a
// Web Worker (see erosion.worker.js) or directly on the main thread for tests.
//
// Operates on a square Float32Array height grid (row-major, world units) and
// returns the eroded grid plus a set of analysis masks the rest of the project
// can consume (flow / erosion / deposition / sediment / slope).
//
//   Base heightmap  ──▶  Hydraulic droplets  ──▶  Thermal relaxation
//                   ──▶  Optional smoothing   ──▶  Master-strength blend
//
// Hydraulic erosion is the droplet model (Hans Beyer / Sebastian Lague): a rain
// drop is dropped on the grid, flows downhill gaining speed, erodes when it has
// spare sediment capacity and deposits when it slows or climbs. Thermal erosion
// slides material off slopes steeper than the talus angle so cliffs and peaks
// relax into believable talus. Everything is deterministic from `seed`.
// ============================================================================

/** Deterministic 32-bit PRNG (mulberry32) → float in [0, 1). Exported so the
 *  WebGPU backend can precompute the exact same droplet start positions. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Precompute the erosion brush: for every cell, the neighbouring indices within
 * `radius` and their normalized falloff weights. Eroding through a brush (rather
 * than a single cell) keeps carved channels smooth instead of pitted.
 * Exported so the WebGPU backend uploads the identical brush.
 */
export function buildBrush(width, height, radius) {
  const offsets = [];
  const weights = [];
  let weightSum = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const sqDist = dx * dx + dy * dy;
      if (sqDist >= radius * radius) continue;
      const w = 1 - Math.sqrt(sqDist) / radius;
      offsets.push([dx, dy]);
      weights.push(w);
      weightSum += w;
    }
  }
  for (let i = 0; i < weights.length; i++) weights[i] /= weightSum || 1;
  return { offsets, weights, width, height };
}

/** Bilinear height + analytic gradient at a fractional cell position. */
function heightAndGradient(map, width, height, posX, posY) {
  const cx = Math.floor(posX);
  const cy = Math.floor(posY);
  const x = posX - cx;
  const y = posY - cy;
  const nw = cy * width + cx;
  const heightNW = map[nw];
  const heightNE = map[nw + 1];
  const heightSW = map[nw + width];
  const heightSE = map[nw + width + 1];
  // gradient of the bilinear surface
  const gradientX = (heightNE - heightNW) * (1 - y) + (heightSE - heightSW) * y;
  const gradientY = (heightSW - heightNW) * (1 - x) + (heightSE - heightNE) * x;
  const value =
    heightNW * (1 - x) * (1 - y) + heightNE * x * (1 - y) +
    heightSW * (1 - x) * y + heightSE * x * y;
  return { value, gradientX, gradientY };
}

/**
 * @param {object} opts
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {Float32Array} opts.heightmap        base heights (world units), row-major
 * @param {object} opts.params                 erosion params (see defaults below)
 * @param {(p:number, phase:string)=>void} [opts.onProgress]
 * @returns {{eroded:Float32Array, flow:Float32Array, erosionMask:Float32Array,
 *            depositionMask:Float32Array, sedimentMap:Float32Array, slopeMap:Float32Array}}
 */
export function erode({ width, height, heightmap, params, onProgress }) {
  const p = { ...DEFAULT_SIM_PARAMS, ...params };
  const N = width * height;
  const base = heightmap;
  const map = Float32Array.from(base);          // mutated in place

  const flow = new Float32Array(N);             // water-path accumulation
  const erosionMask = new Float32Array(N);      // material removed
  const depositionMask = new Float32Array(N);   // material added

  const rand = mulberry32((p.seed | 0) || 1);
  const brush = buildBrush(width, height, Math.max(1, Math.round(p.erosionRadius)));
  const droplets = Math.max(0, Math.round(p.droplets));
  const reportEvery = Math.max(1, Math.floor(droplets / 50));

  // ---------------------------------------------------------- hydraulic pass
  for (let iter = 0; iter < droplets; iter++) {
    let posX = rand() * (width - 1);
    let posY = rand() * (height - 1);
    let dirX = 0, dirY = 0;
    let speed = p.initialSpeed;
    let water = p.initialWater;
    let sediment = 0;

    for (let life = 0; life < p.maxLifetime; life++) {
      const nodeX = Math.floor(posX);
      const nodeY = Math.floor(posY);
      const cellIdx = nodeY * width + nodeX;
      const offX = posX - nodeX;
      const offY = posY - nodeY;

      const hg = heightAndGradient(map, width, height, posX, posY);

      // update direction with inertia, then move one cell
      dirX = dirX * p.inertia - hg.gradientX * (1 - p.inertia);
      dirY = dirY * p.inertia - hg.gradientY * (1 - p.inertia);
      const len = Math.hypot(dirX, dirY);
      if (len !== 0) { dirX /= len; dirY /= len; }
      posX += dirX;
      posY += dirY;

      flow[cellIdx] += water;

      // died: flowed off the map or stopped moving
      if ((dirX === 0 && dirY === 0) ||
          posX < 0 || posX >= width - 1 || posY < 0 || posY >= height - 1) break;

      const newHeight = heightAndGradient(map, width, height, posX, posY).value;
      const deltaHeight = newHeight - hg.value;

      // sediment the drop can hold at this speed/volume
      const capacity = Math.max(-deltaHeight, p.minSlope) * speed * water * p.sedimentCapacity;

      if (sediment > capacity || deltaHeight > 0) {
        // deposit — either back-fill an uphill step, or shed the excess load
        const deposit = deltaHeight > 0
          ? Math.min(deltaHeight, sediment)
          : (sediment - capacity) * p.depositionRate;
        sediment -= deposit;
        // distribute to the 4 surrounding nodes by bilinear weight
        map[cellIdx]             += deposit * (1 - offX) * (1 - offY);
        map[cellIdx + 1]         += deposit * offX * (1 - offY);
        map[cellIdx + width]     += deposit * (1 - offX) * offY;
        map[cellIdx + width + 1] += deposit * offX * offY;
        depositionMask[cellIdx]  += deposit;
      } else {
        // erode — bounded by the local drop so we never dig below the next cell
        const erodeAmt = Math.min((capacity - sediment) * p.erosionRate, -deltaHeight);
        for (let b = 0; b < brush.offsets.length; b++) {
          const [bx, by] = brush.offsets[b];
          const ex = nodeX + bx, ey = nodeY + by;
          if (ex < 0 || ex >= width || ey < 0 || ey >= height) continue;
          const ei = ey * width + ex;
          const w = erodeAmt * brush.weights[b];
          const removed = map[ei] < w ? map[ei] : w;   // don't punch holes
          map[ei] -= removed;
          sediment += removed;
          erosionMask[ei] += removed;
        }
      }

      // gravity accelerates the drop downhill; it evaporates over time
      speed = Math.sqrt(Math.max(0, speed * speed + -deltaHeight * p.gravity));
      water *= (1 - p.evaporation);
    }

    if (onProgress && iter % reportEvery === 0) {
      onProgress(droplets ? iter / droplets : 1, 'hydraulic');
    }
  }

  // ------------------------------------------------------------ thermal pass
  const thermalIters = Math.max(0, Math.round(p.thermalIterations));
  if (thermalIters > 0 && p.thermalStrength > 0) {
    const delta = new Float32Array(N);
    for (let it = 0; it < thermalIters; it++) {
      delta.fill(0);
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const i = y * width + x;
          const h = map[i];
          // steepest lower neighbour (4-connected)
          let maxDiff = 0, target = -1;
          const nb = [i - 1, i + 1, i - width, i + width];
          for (let k = 0; k < 4; k++) {
            const diff = h - map[nb[k]];
            if (diff > maxDiff) { maxDiff = diff; target = nb[k]; }
          }
          if (target >= 0 && maxDiff > p.talus) {
            const move = (maxDiff - p.talus) * 0.5 * p.thermalStrength;
            delta[i] -= move;
            delta[target] += move;
          }
        }
      }
      for (let i = 0; i < N; i++) map[i] += delta[i];
      if (onProgress && (it % Math.max(1, (thermalIters / 25) | 0)) === 0) {
        onProgress(it / thermalIters, 'thermal');
      }
    }
  }

  const result = finalizeErosion({ width, height, base, map, flow, erosionMask, depositionMask, params: p });
  if (onProgress) onProgress(1, 'done');
  return result;
}

/**
 * Shared post-simulation pass: optional smoothing, master-strength blend and
 * mask normalization. Used by the CPU path above AND by the WebGPU backend
 * after readback, so both backends produce identically post-processed output.
 * Mutates `map`, `flow`, `erosionMask`, `depositionMask` in place.
 */
export function finalizeErosion({ width, height, base, map, flow, erosionMask, depositionMask, params }) {
  const p = { ...DEFAULT_SIM_PARAMS, ...params };
  const N = width * height;

  // -------------------------------------------------------------- smoothing
  if (p.smoothing > 0) {
    const src = Float32Array.from(map);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const avg = (src[i] + src[i - 1] + src[i + 1] + src[i - width] + src[i + width]) / 5;
        map[i] = src[i] + (avg - src[i]) * p.smoothing;
      }
    }
  }

  // ------------------------------------------ master-strength blend + masks
  const strength = Math.max(0, Math.min(1, p.strength));
  const eroded = new Float32Array(N);
  const sedimentMap = new Float32Array(N);
  const slopeMap = new Float32Array(N);
  let flowMax = 1e-6, eroMax = 1e-6, depMax = 1e-6, slopeMax = 1e-6;

  for (let i = 0; i < N; i++) {
    eroded[i] = base[i] + (map[i] - base[i]) * strength;
    sedimentMap[i] = depositionMask[i];        // net deposited material
    if (flow[i] > flowMax) flowMax = flow[i];
    if (erosionMask[i] > eroMax) eroMax = erosionMask[i];
    if (depositionMask[i] > depMax) depMax = depositionMask[i];
  }
  // slope from the eroded surface (central differences, normalized later)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const xl = x > 0 ? eroded[i - 1] : eroded[i];
      const xr = x < width - 1 ? eroded[i + 1] : eroded[i];
      const yl = y > 0 ? eroded[i - width] : eroded[i];
      const yr = y < height - 1 ? eroded[i + width] : eroded[i];
      const s = Math.hypot(xr - xl, yr - yl);
      slopeMap[i] = s;
      if (s > slopeMax) slopeMax = s;
    }
  }
  // normalize masks to [0,1] for downstream texture/prop use
  for (let i = 0; i < N; i++) {
    flow[i] /= flowMax;
    erosionMask[i] /= eroMax;
    depositionMask[i] /= depMax;
    slopeMap[i] /= slopeMax;
  }
  let sedMax = 1e-6;
  for (let i = 0; i < N; i++) if (sedimentMap[i] > sedMax) sedMax = sedimentMap[i];
  for (let i = 0; i < N; i++) sedimentMap[i] /= sedMax;

  return { eroded, flow, erosionMask, depositionMask, sedimentMap, slopeMap };
}

// Defaults are expressed in GRID-CELL units (height deltas relative to a cell).
// The engine scales talus/minSlope by the world cell size before calling in so
// the same preset behaves consistently across grid resolutions.
export const DEFAULT_SIM_PARAMS = {
  seed: 1,
  strength: 1.0,
  droplets: 60000,
  maxLifetime: 30,
  inertia: 0.05,
  sedimentCapacity: 4.0,
  minSlope: 0.01,
  depositionRate: 0.3,
  erosionRate: 0.3,
  erosionRadius: 3,
  evaporation: 0.02,
  gravity: 4.0,
  initialSpeed: 1.0,
  initialWater: 1.0,
  thermalIterations: 30,
  thermalStrength: 0.4,
  talus: 0.6,
  smoothing: 0.1,
};
