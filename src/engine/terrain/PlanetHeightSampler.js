// ============================================================================
// CPU-side planet height sampler — f32-exact JS port of the planet GLSL height
// field (planetGLSL.js: 3D noise + planetClimateAt + heightAt3D), in the same
// spirit as TerrainHeightSampler. Reads the LIVE shared uniform objects so it
// matches what the GPU renders for any seed / style / octave count.
//
// Every step goes through Math.fround to emulate GPU float32 rounding (the
// Dave-Hoskins hash depends on fract() of large products, so double precision
// drifts the surface away from the rendered mesh).
//
// Used by the spherical player controller for ground detection: given a world
// position it returns the surface radius along that direction and the surface
// normal. A handful of samples per frame — no mesh raycasts.
// ============================================================================

const f = Math.fround;
function fract32(v) { return f(v - Math.floor(v)); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function mix32(a, b, t) { return f(a + f(f(b - a) * t)); }
function smoothstep32(e0, e1, x) {
  const t = clamp(f(f(x - e0) / f(e1 - e0)), 0, 1);
  return f(f(t * t) * f(3 - f(2 * t)));
}

// GLSL mat3(0,0.80,0.60, -0.80,0.36,-0.48, -0.60,-0.48,0.64) is column-major;
// ROT3 * p =>  (cols dotted with p).
function rot3x(x, y, z) { return f(f(0.0 * x) + f(f(-0.80 * y) + f(-0.60 * z))); }
function rot3y(x, y, z) { return f(f(0.80 * x) + f(f(0.36 * y) + f(-0.48 * z))); }
function rot3z(x, y, z) { return f(f(0.60 * x) + f(f(-0.48 * y) + f(0.64 * z))); }

// --- 3D hash (port of hash13) ----------------------------------------------
function hash13(px, py, pz) {
  let x = fract32(f(px * 0.1031));
  let y = fract32(f(py * 0.1031));
  let z = fract32(f(pz * 0.1031));
  // dot(p3, p3.zyx + 31.32)
  const d = f(
    f(f(x * f(z + 31.32)) + f(y * f(y + 31.32))) + f(z * f(x + 31.32))
  );
  x = f(x + d); y = f(y + d); z = f(z + d);
  return fract32(f(f(x + y) * z));
}

// --- quintic trilinear value noise (port of vnoise3) ------------------------
function vnoise3(px, py, pz) {
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  const fx = f(px - ix), fy = f(py - iy), fz = f(pz - iz);
  const ux = f(f(f(fx * fx) * fx) * f(f(fx * f(f(fx * 6) - 15)) + 10));
  const uy = f(f(f(fy * fy) * fy) * f(f(fy * f(f(fy * 6) - 15)) + 10));
  const uz = f(f(f(fz * fz) * fz) * f(f(fz * f(f(fz * 6) - 15)) + 10));
  const x0 = ix, x1 = f(ix + 1), y0 = iy, y1 = f(iy + 1), z0 = iz, z1 = f(iz + 1);
  const n000 = hash13(x0, y0, z0), n100 = hash13(x1, y0, z0);
  const n010 = hash13(x0, y1, z0), n110 = hash13(x1, y1, z0);
  const n001 = hash13(x0, y0, z1), n101 = hash13(x1, y0, z1);
  const n011 = hash13(x0, y1, z1), n111 = hash13(x1, y1, z1);
  const a = mix32(mix32(n000, n100, ux), mix32(n010, n110, ux), uy);
  const b = mix32(mix32(n001, n101, ux), mix32(n011, n111, ux), uy);
  return mix32(a, b, uz);
}

import { evalStack3D } from './noise/noiseStackCodegen.js';
import { isLegacyStack } from './noise/NoiseStack.js';

export class PlanetHeightSampler {
  /**
   * @param {object} uniforms  shared terrain uniform objects (live references)
   * @param {function} getEnv  () => ({ octaves:number })
   * @param {object} [stack]   live NoiseStack (custom stacks use the f64 evaluator)
   */
  constructor(uniforms, getEnv, stack = null) {
    this.u = uniforms;
    this.getEnv = getEnv;
    this.stack = stack;
  }

  setStack(stack) { this.stack = stack; }

  _ctx() {
    if (!this._ctxObj) {
      this._ctxObj = { uniforms: this.u, legacy3d: (dx, dy, dz) => this._legacyShape3D(dx, dy, dz) };
    }
    return this._ctxObj;
  }

  _fbm3D(px, py, pz, octaves) {
    const pers = f(this.u.uPersistence.value);
    const lac = f(this.u.uLacunarity.value);
    let amp = 0.5, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum = f(sum + f(amp * vnoise3(px, py, pz)));
      norm = f(norm + amp);
      amp = f(amp * pers);
      const nx = f(rot3x(px, py, pz) * lac);
      const ny = f(rot3y(px, py, pz) * lac);
      const nz = f(rot3z(px, py, pz) * lac);
      px = nx; py = ny; pz = nz;
    }
    return f(sum / Math.max(norm, 1e-4));
  }

  _fbm3D4(px, py, pz) { return this._fbm3D(px, py, pz, 4); }

  _fbm3Dc(px, py, pz) {
    let v = f(vnoise3(px, py, pz) * 0.55);
    let nx = f(rot3x(px, py, pz) * 2.13), ny = f(rot3y(px, py, pz) * 2.13), nz = f(rot3z(px, py, pz) * 2.13);
    v = f(v + f(vnoise3(nx, ny, nz) * 0.30));
    const mx = f(rot3x(nx, ny, nz) * 2.13), my = f(rot3y(nx, ny, nz) * 2.13), mz = f(rot3z(nx, ny, nz) * 2.13);
    v = f(v + f(vnoise3(mx, my, mz) * 0.15));
    return v;
  }

  _ridgedFBM3D(px, py, pz, octaves) {
    const pers = f(this.u.uPersistence.value);
    const lac = f(this.u.uLacunarity.value);
    let amp = 0.5, sum = 0, norm = 0, carry = 1;
    for (let i = 0; i < octaves; i++) {
      let v = f(1 - Math.abs(f(f(vnoise3(px, py, pz) * 2) - 1)));
      v = f(v * v);
      sum = f(sum + f(f(amp * v) * carry));
      carry = clamp(f(v * 1.4), 0, 1);
      norm = f(norm + amp);
      amp = f(amp * pers);
      const nx = f(rot3x(px, py, pz) * lac);
      const ny = f(rot3y(px, py, pz) * lac);
      const nz = f(rot3z(px, py, pz) * lac);
      px = nx; py = ny; pz = nz;
    }
    return f(sum / Math.max(norm, 1e-4));
  }

  // domain point for a unit direction
  _domain(dx, dy, dz) {
    const u = this.u;
    const s = f(f(u.uPlanetRadius.value) * f(u.uFrequency.value));
    const sx = f(u.uSeedOffset.value.x), sy = f(u.uSeedOffset.value.y);
    return [f(f(dx * s) + sx), f(f(dy * s) + sy), f(f(dz * s) + f(sy - sx))];
  }

  _climate(dx, dy, dz) {
    const u = this.u;
    const [px, py, pz] = this._domain(dx, dy, dz);
    const bs = f(u.uBiomeScale.value);
    const bx = f(px * bs), by = f(py * bs), bz = f(pz * bs);
    const cont = this._fbm3Dc(f(f(bx * 0.085) + 211.3), f(f(by * 0.085) + 57.9), f(f(bz * 0.085) + 113.4));
    const lat = f(1 - Math.abs(dy));
    const tNoise = f(f(this._fbm3Dc(f(f(bx * 0.150) + 71.7), f(f(by * 0.150) + 313.1), f(f(bz * 0.150) + 47.2)) * 1.5) - 0.25);
    const temp = clamp(f(mix32(tNoise, f(f(lat * 1.15) - 0.15), 0.6) + f(u.uTempBias.value)), 0, 1);
    const ms = f(0.130 * f(u.uMoistScale.value));
    const moist = clamp(f(f(f(this._fbm3Dc(f(f(bx * ms) + 91.7), f(f(by * ms) + 53.9), f(f(bz * ms) + 7.3)) * 1.5) - 0.25) + f(u.uMoistBias.value)), 0, 1);
    const erosion = this._fbm3Dc(f(f(bx * 0.190) + 157.1), f(f(by * 0.190) + 423.7), f(f(bz * 0.190) + 91.6));
    const region = this._fbm3Dc(f(f(px * 0.700) + 631.4), f(f(py * 0.700) + 199.2), f(f(pz * 0.700) + 77.1));
    return { temp, moist, cont, erosion, region };
  }

  _biomeWeights(c) {
    const j = f(f(c.region - 0.5) * 0.16);
    const hot = smoothstep32(0.52, 0.74, f(c.temp + j));
    const dry = smoothstep32(0.55, 0.30, f(c.moist - j));
    const wet = smoothstep32(0.55, 0.78, f(c.moist + j));
    const lowC = smoothstep32(0.55, 0.32, c.cont);
    const eroded = smoothstep32(0.40, 0.70, f(c.erosion + f(j * 0.5)));
    return {
      desert: f(f(hot * dry) * f(1 - f(eroded * 0.55))),
      canyon: f(f(dry * eroded) * smoothstep32(0.30, 0.55, c.cont)),
      wetland: f(f(wet * lowC) * f(1 - f(hot * 0.4))),
      mountains: f(smoothstep32(0.38, 0.62, c.cont) * f(1 - f(eroded * 0.7))),
    };
  }

  _terrace(h, steps) {
    const t = f(h * steps);
    const s = smoothstep32(0.20, 0.80, fract32(t));
    return f(f(Math.floor(t) + s) / steps);
  }

  /** Terrain height (world units) above the base radius, for a unit direction. */
  heightAt3D(dx, dy, dz) {
    const u = this.u;
    const h = (this.stack && !isLegacyStack(this.stack))
      ? evalStack3D(this.stack, dx, dy, dz, this._ctx())
      : f(this._legacyShape3D(dx, dy, dz) * f(u.uAmplitude.value));
    return f(clamp(h, 0, 1.35) * f(u.uHeightScale.value));
  }

  /** Legacy biome-coupled recipe (layers 1-6), h in ~0..1.35 (pre scale). */
  _legacyShape3D(dx, dy, dz) {
    const u = this.u;
    const oct = this.getEnv().octaves;
    const [px, py, pz] = this._domain(dx, dy, dz);
    const c = this._climate(dx, dy, dz);
    const bw = this._biomeWeights(c);

    // layer 1: domain warp
    const wx = this._fbm3D4(f(px + 13.7), f(py + 41.3), f(pz + 7.2));
    const wy = this._fbm3D4(f(px + 87.2), f(py + 9.1), f(pz + 55.1));
    const wz = this._fbm3D4(f(px + 31.7), f(py + 5.3), f(pz + 91.4));
    const warp = f(f(u.uWarp.value) * f(1 - f(bw.canyon * 0.5)));
    const qx = f(px + f(f(wx - 0.5) * warp));
    const qy = f(py + f(f(wy - 0.5) * warp));
    const qz = f(pz + f(f(wz - 0.5) * warp));

    // layer 2: rolling base
    const base = this._fbm3D(qx, qy, qz, oct);
    const baseAmp = f(f(0.30 * f(1 - f(bw.desert * 0.45))) * f(1 - f(bw.wetland * 0.75)));
    let h = f(f(base * baseAmp) + 0.06);

    // layer 3: desert dunes
    const dnx = f(f(f(qx * 2.2) + f(qy * 0.4)) + 311.7);
    const dny = f(f(qy * 0.8) + 89.1);
    const dnz = f(f(qz * 1.3) + 17.3);
    const dune = f(1 - Math.abs(f(f(vnoise3(dnx, dny, dnz) * 2) - 1)));
    h = f(h + f(f(f(dune * dune) * 0.05) * bw.desert));

    // layer 4: ridged mountain chains
    const ridge = this._ridgedFBM3D(f(f(qx * 1.7) + 31.4), f(f(qy * 1.7) + 27.2), f(f(qz * 1.7) + 11.9), oct);
    const chain = smoothstep32(0.34, 0.66, this._fbm3D4(f(f(qx * 0.35) + 5.1), f(f(qy * 0.35) + 17.7), f(f(qz * 0.35) + 9.4)));
    const mountains = f(f(f(chain * mix32(0.35, 1.0, bw.mountains)) * f(1 - f(bw.desert * 0.85))) * f(1 - bw.wetland));
    h = f(h + f(f(f(Math.pow(ridge, 1.35)) * mountains) * f(f(u.uRidge.value) * 1.15)));

    // layer 5: wetlands settle just above sea level
    const sea01 = f(f(u.uSeaLevel.value) / Math.max(f(u.uHeightScale.value), 1));
    h = mix32(h, f(f(sea01 + 0.012) + f(base * 0.03)), f(bw.wetland * 0.85));

    // layer 6: canyon strata terracing
    h = mix32(h, this._terrace(h, 14.0), f(bw.canyon * 0.75));

    return h;
  }

  /** Surface radius (planet radius + terrain height) along a world direction. */
  surfaceRadius(dx, dy, dz) {
    const len = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / len, uy = dy / len, uz = dz / len;
    return this.u.uPlanetRadius.value + this.heightAt3D(ux, uy, uz);
  }

  /**
   * Outward surface normal at a world direction, via tangent finite
   * differences (matches the shader's analytic normal).
   * @returns {{x,y,z}} normalized
   */
  normalAt(dx, dy, dz, eps = 0.0015) {
    const len = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / len, uy = dy / len, uz = dz / len;
    // tangent basis
    const ax = Math.abs(uy) < 0.99 ? 0 : 1;
    const ay = Math.abs(uy) < 0.99 ? 1 : 0;
    // t1 = normalize(cross(ref, u)); ref=(ax,ay,0)
    let t1x = ay * uz - 0 * uy;
    let t1y = 0 * ux - ax * uz;
    let t1z = ax * uy - ay * ux;
    let l1 = Math.hypot(t1x, t1y, t1z) || 1; t1x /= l1; t1y /= l1; t1z /= l1;
    // t2 = cross(u, t1)
    const t2x = uy * t1z - uz * t1y;
    const t2y = uz * t1x - ux * t1z;
    const t2z = ux * t1y - uy * t1x;

    const dirA = [ux + t1x * eps, uy + t1y * eps, uz + t1z * eps];
    const dirB = [ux + t2x * eps, uy + t2y * eps, uz + t2z * eps];
    const la = Math.hypot(...dirA), lb = Math.hypot(...dirB);
    const aN = [dirA[0] / la, dirA[1] / la, dirA[2] / la];
    const bN = [dirB[0] / lb, dirB[1] / lb, dirB[2] / lb];

    const rC = this.u.uPlanetRadius.value + this.heightAt3D(ux, uy, uz);
    const rA = this.u.uPlanetRadius.value + this.heightAt3D(aN[0], aN[1], aN[2]);
    const rB = this.u.uPlanetRadius.value + this.heightAt3D(bN[0], bN[1], bN[2]);

    const pC = [ux * rC, uy * rC, uz * rC];
    const pA = [aN[0] * rA, aN[1] * rA, aN[2] * rA];
    const pB = [bN[0] * rB, bN[1] * rB, bN[2] * rB];
    const e1 = [pA[0] - pC[0], pA[1] - pC[1], pA[2] - pC[2]];
    const e2 = [pB[0] - pC[0], pB[1] - pC[1], pB[2] - pC[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1];
    let ny = e1[2] * e2[0] - e1[0] * e2[2];
    let nz = e1[0] * e2[1] - e1[1] * e2[0];
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    if (nx * ux + ny * uy + nz * uz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    return { x: nx, y: ny, z: nz };
  }
}
