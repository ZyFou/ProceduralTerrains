// ============================================================================
// CPU-side terrain height sampler — exact JS port of the GLSL height field
// (terrainGLSL.js + biomeGLSL.js). Reads the LIVE shared uniform objects so
// it always matches what the GPU renders, in both studio and infinite mode,
// across chunk borders, for any seed / preset / octave count.
//
// IMPORTANT: every arithmetic step goes through Math.fround to emulate the
// GPU's float32 precision. The Dave Hoskins hash relies on fract() of large
// products, so its output is a function of the exact 32-bit rounding — a
// double-precision evaluation produces different per-cell noise values and
// heights drift tens of units away from the rendered mesh. With f32
// emulation the CPU result tracks the GPU to within rounding noise.
//
// Used by the player physics controller for ground detection. A handful of
// samples per frame — no raycasting against chunk meshes is ever needed.
// ============================================================================

const f = Math.fround;

function fract32(v) { return f(v - Math.floor(v)); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function mix32(a, b, t) { return f(a + f(f(b - a) * t)); }
function smoothstep32(e0, e1, x) {
  const t = clamp(f(f(x - e0) / f(e1 - e0)), 0, 1);
  return f(f(t * t) * f(3 - f(2 * t)));
}

// GLSL: mat2(0.80,-0.60,0.60,0.80) * p  =>  (0.80x + 0.60y, -0.60x + 0.80y)
function rot2x(x, y) { return f(f(0.80 * x) + f(0.60 * y)); }
function rot2y(x, y) { return f(f(-0.60 * x) + f(0.80 * y)); }

// --- hash without sine precision issues (Dave Hoskins) — port of hash12 ----
function hash12(px, py) {
  let p3x = fract32(f(px * 0.1031));
  let p3y = fract32(f(py * 0.1031));
  let p3z = p3x; // vec3(p.xyx)
  // dot(p3, p3.yzx + 33.33)
  const d = f(
    f(f(p3x * f(p3y + 33.33)) + f(p3y * f(p3z + 33.33))) + f(p3z * f(p3x + 33.33))
  );
  p3x = f(p3x + d); p3y = f(p3y + d); p3z = f(p3z + d);
  return fract32(f(f(p3x + p3y) * p3z));
}

// --- quintic value noise ----------------------------------------------------
function vnoise(px, py) {
  const ix = Math.floor(px), iy = Math.floor(py);
  const fx = f(px - ix), fy = f(py - iy);
  // u = f*f*f*(f*(f*6-15)+10)
  const ux = f(f(f(fx * fx) * fx) * f(f(fx * f(f(fx * 6) - 15)) + 10));
  const uy = f(f(f(fy * fy) * fy) * f(f(fy * f(f(fy * 6) - 15)) + 10));
  const a = hash12(ix, iy);
  const b = hash12(f(ix + 1), iy);
  const c = hash12(ix, f(iy + 1));
  const d = hash12(f(ix + 1), f(iy + 1));
  return mix32(mix32(a, b, ux), mix32(c, d, ux), uy);
}

import { evalStack2D } from './noise/noiseStackCodegen.js';
import { isLegacyStack } from './noise/NoiseStack.js';

export class TerrainHeightSampler {
  /**
   * @param {object} uniforms  shared terrain uniform objects (live references)
   * @param {function} getEnv  () => ({ octaves:number, infinite:boolean })
   * @param {object} [stack]   live NoiseStack (custom stacks use the f64 evaluator)
   */
  constructor(uniforms, getEnv, stack = null) {
    this.u = uniforms;
    this.getEnv = getEnv;
    this.stack = stack;
  }

  setStack(stack) { this.stack = stack; }

  _rimFalloff(t) {
    t = clamp(t, 0, 1);
    const island = f(f(t * t) * f(3 - f(2 * t)));
    const mountains = f(Math.pow(t, 1.6));
    return (this.u.uEdgeFalloffMode?.value ?? 0) >= 0.5 ? mountains : island;
  }

  _tileOccAt(cx, cz) {
    const tex = this.u.uTileOccupancy?.value;
    const dim = this.u.uTileGridDim?.value;
    const w = Math.max(1, Math.round(dim?.x ?? 1));
    const h = Math.max(1, Math.round(dim?.y ?? 1));
    if (cx < 0 || cz < 0 || cx >= w || cz >= h) return 0;
    return (tex?.image?.data?.[cz * w + cx] ?? 0) >= 128 ? 1 : 0;
  }

  _tileFalloff(x, z) {
    const cs = f(this.u.uTileCellSize?.value ?? f(this.u.uBoardHalf.value * 2));
    const ox = f(this.u.uTileGridOrigin?.value?.x ?? -f(cs * 0.5));
    const oz = f(this.u.uTileGridOrigin?.value?.y ?? -f(cs * 0.5));
    const rx = f(f(x - ox) / cs), rz = f(f(z - oz) / cs);
    const cx = Math.floor(rx), cz = Math.floor(rz);
    const lx = f(f(rx - cx) * 2 - 1), lz = f(f(rz - cz) * 2 - 1);
    const band = Math.max(f(this.u.uFalloff.value), 1e-3);
    const fXp = mix32(smoothstep32(0, band, f(1 - lx)), 1, this._tileOccAt(cx + 1, cz));
    const fXn = mix32(smoothstep32(0, band, f(1 + lx)), 1, this._tileOccAt(cx - 1, cz));
    const fZp = mix32(smoothstep32(0, band, f(1 - lz)), 1, this._tileOccAt(cx, cz + 1));
    const fZn = mix32(smoothstep32(0, band, f(1 + lz)), 1, this._tileOccAt(cx, cz - 1));
    return f(f(fXp * fXn) * f(fZp * fZn));
  }

  _assemblyFalloff(x, z) {
    if ((this.u.uTileShape?.value ?? 0) >= 0.5) {
      const radius = f(this.u.uTileDiskRadius?.value ?? this.u.uBoardHalf.value);
      const band = f(Math.max(f(this.u.uFalloff.value), 1e-3) * f(this.u.uTileCellSize?.value ?? f(this.u.uBoardHalf.value * 2)));
      return smoothstep32(f(radius + band), f(radius - band), f(Math.hypot(x, z)));
    }
    return this._tileFalloff(x, z);
  }


  _fbm(px, py, octaves) {
    const pers = f(this.u.uPersistence.value);
    const lac = f(this.u.uLacunarity.value);
    let amp = 0.5, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum = f(sum + f(amp * vnoise(px, py)));
      norm = f(norm + amp);
      amp = f(amp * pers);
      const nx = f(rot2x(px, py) * lac), ny = f(rot2y(px, py) * lac);
      px = nx; py = ny;
    }
    return f(sum / Math.max(norm, 1e-4));
  }

  _fbm4(px, py) { return this._fbm(px, py, 4); }

  // 3-octave climate FBM with hardcoded gain/lacunarity (matches fbm3 in GLSL)
  _fbm3(px, py) {
    let v = f(vnoise(px, py) * 0.55);
    const nx = f(rot2x(px, py) * 2.13), ny = f(rot2y(px, py) * 2.13);
    v = f(v + f(vnoise(nx, ny) * 0.30));
    const mx = f(rot2x(nx, ny) * 2.13), my = f(rot2y(nx, ny) * 2.13);
    v = f(v + f(vnoise(mx, my) * 0.15));
    return v;
  }

  _ridgedFBM(px, py, octaves) {
    const pers = f(this.u.uPersistence.value);
    const lac = f(this.u.uLacunarity.value);
    let amp = 0.5, sum = 0, norm = 0, carry = 1;
    for (let i = 0; i < octaves; i++) {
      let v = f(1 - Math.abs(f(f(vnoise(px, py) * 2) - 1)));
      v = f(v * v);
      sum = f(sum + f(f(amp * v) * carry));
      carry = clamp(f(v * 1.4), 0, 1);
      norm = f(norm + amp);
      amp = f(amp * pers);
      const nx = f(rot2x(px, py) * lac), ny = f(rot2y(px, py) * lac);
      px = nx; py = ny;
    }
    return f(sum / Math.max(norm, 1e-4));
  }

  _climateAt(px, py) {
    const u = this.u;
    const bs = f(u.uBiomeScale.value);
    const bx = f(px * bs), by = f(py * bs);
    const cont = this._fbm3(f(f(bx * 0.085) + 211.3), f(f(by * 0.085) + 57.9));
    const temp = clamp(f(f(f(this._fbm3(f(f(bx * 0.150) + 71.7), f(f(by * 0.150) + 313.1)) * 1.5) - 0.25) + f(u.uTempBias.value)), 0, 1);
    const ms = f(0.130 * f(u.uMoistScale.value));
    const moist = clamp(f(f(f(this._fbm3(f(f(bx * ms) + 91.7), f(f(by * ms) + 53.9)) * 1.5) - 0.25) + f(u.uMoistBias.value)), 0, 1);
    const erosion = this._fbm3(f(f(bx * 0.190) + 157.1), f(f(by * 0.190) + 423.7));
    const region = this._fbm3(f(f(px * 0.700) + 631.4), f(f(py * 0.700) + 199.2));
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

  _dominantBiome(weights, overrides = null) {
    const painted = overrides ? {
      desert: clamp((weights.desert ?? 0) + (overrides.desert ?? 0), 0, 1),
      canyon: clamp((weights.canyon ?? 0) + (overrides.canyon ?? 0), 0, 1),
      wetland: clamp((weights.wetland ?? 0) + (overrides.wetland ?? 0), 0, 1),
      mountains: clamp((weights.mountains ?? 0) + (overrides.mountains ?? 0), 0, 1),
    } : weights;
    let label = 'Forest';
    let score = 0.18;
    for (const [key, value] of Object.entries(painted)) {
      if (value > score) {
        score = value;
        label = key[0].toUpperCase() + key.slice(1);
      }
    }
    return { label, weights: painted };
  }

  _terrace(h, steps) {
    const t = f(h * steps);
    const s = smoothstep32(0.20, 0.80, fract32(t));
    return f(f(Math.floor(t) + s) / steps);
  }

  // ctx for the generic f64 stack evaluator. legacy2d delegates back to the
  // exact f32 legacy recipe so a legacy layer inside a custom stack matches.
  _ctx() {
    if (!this._ctxObj) {
      this._ctxObj = { uniforms: this.u, legacy2d: (x, z) => this._legacyShape2D(x, z) };
    }
    return this._ctxObj;
  }

  /** World-space terrain height at world position (x, z). */
  heightAt(x, z) {
    const u = this.u;
    const env = this.getEnv();

    let h = (this.stack && !isLegacyStack(this.stack))
      ? evalStack2D(this.stack, x, z, this._ctx())
      : f(this._legacyShape2D(x, z) * f(u.uAmplitude.value));

    // island falloff (studio board only) + clamp + world height scale
    if (!env.infinite) {
      if ((u.uUseTiles?.value ?? 0) > 0.5) {
        h = f(h * this._assemblyFalloff(x, z));
      } else {
        const half = f(u.uBoardHalf.value);
        const ex = f(Math.abs(f(x)) / half), ey = f(Math.abs(f(z)) / half);
        const edge = mix32(Math.max(ex, ey), f(Math.hypot(ex, ey) * 0.7071), 0.5);
        const t = clamp(f(f(1 - edge) / Math.max(f(u.uFalloff.value), 1e-3)), 0, 1);
        h = f(h * this._rimFalloff(t));
      }
    }
    return f(clamp(h, 0, 1.35) * f(u.uHeightScale.value));
  }

  shapeAt(x, z) {
    const u = this.u;
    return (this.stack && !isLegacyStack(this.stack))
      ? evalStack2D(this.stack, x, z, this._ctx())
      : f(this._legacyShape2D(x, z) * f(u.uAmplitude.value));
  }

  biomeAt(x, z, overrides = null) {
    const u = this.u;
    const freq = f(u.uFrequency.value);
    const px = f(f(f(x) * freq) + f(u.uSeedOffset.value.x));
    const py = f(f(f(z) * freq) + f(u.uSeedOffset.value.y));
    const climate = this._climateAt(px, py);
    const weights = this._biomeWeights(climate);
    return this._dominantBiome(weights, overrides);
  }

  /** Legacy biome-coupled recipe (layers 1-6), h in ~0..1.35 (pre falloff/scale). */
  _legacyShape2D(x, z) {
    const u = this.u;
    const env = this.getEnv();
    const octaves = env.octaves;

    const freq = f(u.uFrequency.value);
    const px = f(f(f(x) * freq) + f(u.uSeedOffset.value.x));
    const py = f(f(f(z) * freq) + f(u.uSeedOffset.value.y));

    const c = this._climateAt(px, py);
    const bw = this._biomeWeights(c);

    // layer 1: domain warp
    const wx = this._fbm4(f(px + 13.7), f(py + 41.3));
    const wy = this._fbm4(f(px + 87.2), f(py + 9.1));
    const warp = f(f(u.uWarp.value) * f(1 - f(bw.canyon * 0.5)));
    const qx = f(px + f(f(wx - 0.5) * warp));
    const qy = f(py + f(f(wy - 0.5) * warp));

    // layer 2: rolling base
    const base = this._fbm(qx, qy, octaves);
    const baseAmp = f(f(0.30 * f(1 - f(bw.desert * 0.45))) * f(1 - f(bw.wetland * 0.75)));
    let h = f(f(base * baseAmp) + 0.06);

    // layer 3: desert dunes
    const dnx = f(f(f(qx * 2.2) + f(qy * 0.4)) + 311.7);
    const dny = f(f(qy * 0.8) + 89.1);
    const dune = f(1 - Math.abs(f(f(vnoise(dnx, dny) * 2) - 1)));
    h = f(h + f(f(f(dune * dune) * 0.05) * bw.desert));

    // layer 4: ridged mountain chains
    const ridge = this._ridgedFBM(f(f(qx * 1.7) + 31.4), f(f(qy * 1.7) + 27.2), octaves);
    const chain = smoothstep32(0.34, 0.66, this._fbm4(f(f(qx * 0.35) + 5.1), f(f(qy * 0.35) + 17.7)));
    const mountains = f(f(f(chain * mix32(0.35, 1.0, bw.mountains))
      * f(1 - f(bw.desert * 0.85)))
      * f(1 - bw.wetland));
    h = f(h + f(f(f(Math.pow(ridge, 1.35)) * mountains) * f(f(u.uRidge.value) * 1.15)));

    // layer 5: wetlands settle just above sea level
    const sea01 = f(f(u.uSeaLevel.value) / Math.max(f(u.uHeightScale.value), 1));
    h = mix32(h, f(f(sea01 + 0.012) + f(base * 0.03)), f(bw.wetland * 0.85));

    // layer 6: canyon strata terracing
    h = mix32(h, this._terrace(h, 14.0), f(bw.canyon * 0.75));

    return h;
  }

  /**
   * Approximate surface normal at (x, z) via central differences.
   * @returns {{x:number, y:number, z:number}} normalized
   */
  normalAt(x, z, eps = 1.0) {
    const hL = this.heightAt(x - eps, z);
    const hR = this.heightAt(x + eps, z);
    const hD = this.heightAt(x, z - eps);
    const hU = this.heightAt(x, z + eps);
    let nx = hL - hR, ny = 2 * eps, nz = hD - hU;
    const len = Math.hypot(nx, ny, nz) || 1;
    return { x: nx / len, y: ny / len, z: nz / len };
  }

  sampleSurfaceInfo(x, z, {
    waterLevel = 0,
    paintHeightOffset = 0,
    paintBiomeWeights = null,
    eps = 2.0,
  } = {}) {
    const baseHeight = this.heightAt(x, z);
    const height = baseHeight + paintHeightOffset;
    const normal = this.normalAt(x, z, eps);
    const slope = clamp(1 - normal.y, 0, 1);
    const biome = this.biomeAt(x, z, paintBiomeWeights);
    return {
      baseHeight,
      height,
      normal,
      slope,
      water: height <= waterLevel + 0.01,
      biome: biome.label,
      biomeWeights: biome.weights,
      noise: this.shapeAt(x, z),
    };
  }
}
