// ============================================================================
// cloudFieldCPU: a compact CPU mirror of the cloud coverage field used ONLY for
// empty-space culling of cloud chunks (deciding "could this sector contain any
// cloud right now?"). It ports the base-FBM path of cloudShape() from
// cloudGLSL.js (the `soft` variant — a conservative proxy for all variants;
// detail/erosion are intentionally ignored so we never cull a chunk the GPU
// would actually fill). It is NOT used for rendering — the GPU shader stays the
// source of truth for the visible density.
// ============================================================================

const fract = (x) => x - Math.floor(x);

// cl_hash13 (Dave Hoskins) ported from cloudGLSL.js
function hash13(x, y, z) {
  let px = fract(x * 0.1031), py = fract(y * 0.1031), pz = fract(z * 0.1031);
  // dot(p3, p3.zyx + 31.32)
  const s = px * (pz + 31.32) + py * (py + 31.32) + pz * (px + 31.32);
  px += s; py += s; pz += s;
  return fract((px + py) * pz);
}

// quintic trilinear value noise (cl_vnoise)
function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const n000 = hash13(ix, iy, iz);
  const n100 = hash13(ix + 1, iy, iz);
  const n010 = hash13(ix, iy + 1, iz);
  const n110 = hash13(ix + 1, iy + 1, iz);
  const n001 = hash13(ix, iy, iz + 1);
  const n101 = hash13(ix + 1, iy, iz + 1);
  const n011 = hash13(ix, iy + 1, iz + 1);
  const n111 = hash13(ix + 1, iy + 1, iz + 1);
  const mix = (a, b, t) => a + (b - a) * t;
  return mix(
    mix(mix(n000, n100, ux), mix(n010, n110, ux), uy),
    mix(mix(n001, n101, ux), mix(n011, n111, ux), uy),
    uz
  );
}

// CL_ROT * p (column-major mat3 from cloudGLSL.js), result written back into out
function rotMul(px, py, pz, out) {
  out[0] = -0.80 * py - 0.60 * pz;
  out[1] = 0.80 * px + 0.36 * py - 0.48 * pz;
  out[2] = 0.60 * px - 0.48 * py + 0.64 * pz;
}

// base FBM value noise (cl_fbm_base) — `octaves` iterations, *2.02 freq, CL_ROT
function fbmBase(px, py, pz, octaves) {
  let amp = 0.5, sum = 0, norm = 0;
  let x = px, y = py, z = pz;
  const r = [0, 0, 0];
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x, y, z);
    norm += amp;
    amp *= 0.5;
    rotMul(x, y, z, r);
    x = r[0] * 2.02; y = r[1] * 2.02; z = r[2] * 2.02;
  }
  return sum / Math.max(norm, 1e-4);
}

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / Math.max(e1 - e0, 1e-6)));
  return t * t * (3 - 2 * t);
};

/**
 * Coverage fraction in [0,1] at a planet-local world point, mirroring the base
 * path of cloudShape() (domain rotation about Y + wind drift + base FBM + the
 * coverage threshold). Conservative: omits the detail/erosion terms.
 * @param {number} x @param {number} y @param {number} z  world point (planet at origin)
 * @param {object} f  field params (already in shader units):
 *   scale, windX, windY, windZ, time, rotation, coverage, softness, octaves
 */
export function cloudCoverageAt(x, y, z, f) {
  // cl_domain: rotate about Y by f.rotation
  const c = Math.cos(f.rotation), s = Math.sin(f.rotation);
  const qx = c * x + s * z;
  const qy = y;
  const qz = -s * x + c * z;
  // baseP = q * scale + wind * time + evolution scroll (must match cloudShape so
  // the occupancy map tracks the forming/dissipating field and never clips it)
  const dx = f.windX * f.time;
  const dy = f.windY * f.time + (f.evolve || 0) * f.time;
  const dz = f.windZ * f.time;
  // `boost` is an UPPER-BOUND margin (≈ detail strength + softness): the GPU adds
  // detail noise on top of the base FBM, so a column that is empty in the base
  // can still grow cloud from detail. Adding the boost before thresholding makes
  // the occupancy a conservative over-estimate that never skips real cloud.
  const n = fbmBase(qx * f.scale + dx, qy * f.scale + dy, qz * f.scale + dz, f.octaves) + (f.boost || 0);
  const threshold = 1.0 - f.coverage;
  return smoothstep(threshold, threshold + f.softness, n);
}

// Octahedral decode: texel uv in [-1,1]² → unit direction.
function octDecode(u, v, out) {
  let x = u, y = v;
  const z = 1 - Math.abs(x) - Math.abs(y);
  if (z < 0) {
    const ox = x;
    x = (1 - Math.abs(y)) * (ox >= 0 ? 1 : -1);
    y = (1 - Math.abs(ox)) * (y >= 0 ? 1 : -1);
  }
  const len = Math.hypot(x, y, z) || 1;
  out[0] = x / len; out[1] = y / len; out[2] = z / len;
}

/**
 * Build a directional occupancy map (octahedral, `size`×`size`, R8) marking which
 * directions hold any cloud at mid-shell radius. Conservative: a low coverage
 * threshold + a few dilation passes so the GPU march never skips a column that
 * has (or is about to grow) cloud. Reused as an empty-space-skip acceleration
 * grid by the cloud shader.
 * @param {Uint8Array} out  length size*size (reused buffer)
 * @param {number} size
 * @param {number} inner  inner shell radius
 * @param {number} outer  outer shell radius
 * @param {object} field  cloud field params (see cloudCoverageAt)
 * @param {number} [dilate] dilation passes (default 2)
 */
export function buildOccupancyOctahedral(out, size, inner, outer, field, dilate = 2) {
  const d = [0, 0, 0];
  // sample a few radii up the column (the shape field varies with radius) and
  // take the max so a column with cloud only near the inner/outer edge is kept.
  const radii = [inner + (outer - inner) * 0.2, 0.5 * (inner + outer), outer - (outer - inner) * 0.2];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = ((i + 0.5) / size) * 2 - 1;
      const v = ((j + 0.5) / size) * 2 - 1;
      octDecode(u, v, d);
      let cov = 0;
      for (let r = 0; r < radii.length; r++) {
        const R = radii[r];
        cov = Math.max(cov, cloudCoverageAt(d[0] * R, d[1] * R, d[2] * R, field));
      }
      out[j * size + i] = cov > 0.003 ? 255 : 0;
    }
  }
  dilateMax(out, size, dilate);
}

// 3×3 max dilation, `passes` times, in place (grows the occupied region so
// edges/wisps and the rebuild lag never clip a real cloud).
function dilateMax(out, size, passes) {
  if (passes <= 0) return;
  let src = out;
  let tmp = new Uint8Array(size * size);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        let m = 0;
        for (let dj = -1; dj <= 1 && m < 255; dj++) {
          const jj = j + dj; if (jj < 0 || jj >= size) continue;
          for (let di = -1; di <= 1; di++) {
            const ii = i + di; if (ii < 0 || ii >= size) continue;
            if (src[jj * size + ii] > m) m = src[jj * size + ii];
          }
        }
        tmp[j * size + i] = m;
      }
    }
    const swap = src; src = tmp; tmp = swap;
  }
  if (src !== out) out.set(src);
}

/**
 * Build a planar (XZ) occupancy map for the studio cloud slab: `size`×`size` R8
 * over the square [center ± extent], marking which columns hold any cloud
 * between bottom..top. Conservative (low threshold, 3 Y samples, dilation).
 * @param {Uint8Array} out  length size*size (reused buffer)
 * @param {number} size
 * @param {number} cx @param {number} cz  board center XZ
 * @param {number} extent  half-size of the mapped square (= fade radius)
 * @param {number} bottom @param {number} top  slab Y planes
 * @param {object} field  cloud field params (see cloudCoverageAt)
 * @param {number} [dilate]
 */
export function buildOccupancyPlanar(out, size, cx, cz, extent, bottom, top, field, dilate = 2) {
  const ys = [bottom + (top - bottom) * 0.25, 0.5 * (bottom + top), top - (top - bottom) * 0.25];
  for (let j = 0; j < size; j++) {
    const z = cz + (((j + 0.5) / size) * 2 - 1) * extent;
    for (let i = 0; i < size; i++) {
      const x = cx + (((i + 0.5) / size) * 2 - 1) * extent;
      let cov = 0;
      for (let y = 0; y < ys.length; y++) {
        cov = Math.max(cov, cloudCoverageAt(x, ys[y], z, field));
      }
      out[j * size + i] = cov > 0.003 ? 255 : 0;
    }
  }
  dilateMax(out, size, dilate);
}
