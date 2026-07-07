import { describe, expect, it } from 'vitest';
import {
  vnoise2, vnoise3, vnoised2, vnoised3,
  fbm2, fbm3, ridged2, ridged3, billow2, billow3,
  rot2, rot3,
} from '../src/engine/terrain/noise/cpuNoise.js';

const close = (a, b) => expect(a).toBeCloseTo(b, 12);

function legacyFbm2(px, py, octaves, pers, lac) {
  let amp = 0.5, sum = 0, norm = 0, x = px, y = py;
  const n = Math.max(1, Math.min(9, octaves | 0));
  for (let i = 0; i < n; i++) {
    sum += amp * vnoise2(x, y);
    norm += amp;
    amp *= pers;
    const r = rot2(x, y); x = r[0] * lac; y = r[1] * lac;
  }
  return sum / Math.max(norm, 1e-4);
}

function legacyBillow2(px, py, octaves, pers, lac) {
  let amp = 0.5, sum = 0, norm = 0, x = px, y = py;
  const n = Math.max(1, Math.min(9, octaves | 0));
  for (let i = 0; i < n; i++) {
    sum += amp * Math.abs(vnoise2(x, y) * 2 - 1);
    norm += amp;
    amp *= pers;
    const r = rot2(x, y); x = r[0] * lac; y = r[1] * lac;
  }
  return sum / Math.max(norm, 1e-4);
}

function legacyRidged2(px, py, octaves, pers, lac, sharp) {
  let amp = 0.5, sum = 0, norm = 0, carry = 1, x = px, y = py;
  const n = Math.max(1, Math.min(9, octaves | 0));
  for (let i = 0; i < n; i++) {
    let v = 1 - Math.abs(vnoise2(x, y) * 2 - 1);
    v = Math.pow(v, sharp);
    sum += amp * v * carry;
    carry = Math.max(0, Math.min(1, v * 1.4));
    norm += amp;
    amp *= pers;
    const r = rot2(x, y); x = r[0] * lac; y = r[1] * lac;
  }
  return sum / Math.max(norm, 1e-4);
}

function legacyFbm3(px, py, pz, octaves, pers, lac) {
  let amp = 0.5, sum = 0, norm = 0, x = px, y = py, z = pz;
  const n = Math.max(1, Math.min(9, octaves | 0));
  for (let i = 0; i < n; i++) {
    sum += amp * vnoise3(x, y, z);
    norm += amp;
    amp *= pers;
    const r = rot3(x, y, z); x = r[0] * lac; y = r[1] * lac; z = r[2] * lac;
  }
  return sum / Math.max(norm, 1e-4);
}

function legacyBillow3(px, py, pz, octaves, pers, lac) {
  let amp = 0.5, sum = 0, norm = 0, x = px, y = py, z = pz;
  const n = Math.max(1, Math.min(9, octaves | 0));
  for (let i = 0; i < n; i++) {
    sum += amp * Math.abs(vnoise3(x, y, z) * 2 - 1);
    norm += amp;
    amp *= pers;
    const r = rot3(x, y, z); x = r[0] * lac; y = r[1] * lac; z = r[2] * lac;
  }
  return sum / Math.max(norm, 1e-4);
}

function legacyRidged3(px, py, pz, octaves, pers, lac, sharp) {
  let amp = 0.5, sum = 0, norm = 0, carry = 1, x = px, y = py, z = pz;
  const n = Math.max(1, Math.min(9, octaves | 0));
  for (let i = 0; i < n; i++) {
    let v = 1 - Math.abs(vnoise3(x, y, z) * 2 - 1);
    v = Math.pow(v, sharp);
    sum += amp * v * carry;
    carry = Math.max(0, Math.min(1, v * 1.4));
    norm += amp;
    amp *= pers;
    const r = rot3(x, y, z); x = r[0] * lac; y = r[1] * lac; z = r[2] * lac;
  }
  return sum / Math.max(norm, 1e-4);
}

describe('derivative value noise compatibility', () => {
  it('keeps the 2D value channel identical to vnoise2', () => {
    for (const [x, y] of [[0.15, 0.75], [12.4, -3.2], [-8.1, 4.6]]) {
      expect(vnoised2(x, y)[0]).toBe(vnoise2(x, y));
    }
  });

  it('keeps the 3D value channel identical to vnoise3', () => {
    for (const [x, y, z] of [[0.15, 0.75, 1.5], [12.4, -3.2, 0.8], [-8.1, 4.6, -2.3]]) {
      expect(vnoised3(x, y, z)[0]).toBe(vnoise3(x, y, z));
    }
  });
});

describe('eroded fractal zero defaults', () => {
  it('matches old 2D fractal outputs when erosion and warp are zero', () => {
    const args = [1.73, -2.41, 5, 0.47, 2.18];
    close(fbm2(...args, 0, 0), legacyFbm2(...args));
    close(billow2(...args, 0, 0), legacyBillow2(...args));
    close(ridged2(...args, 2.35, 0, 0), legacyRidged2(...args, 2.35));
  });

  it('matches old 3D fractal outputs when erosion and warp are zero', () => {
    const args = [1.73, -2.41, 0.92, 5, 0.47, 2.18];
    close(fbm3(...args, 0, 0), legacyFbm3(...args));
    close(billow3(...args, 0, 0), legacyBillow3(...args));
    close(ridged3(...args, 2.35, 0, 0), legacyRidged3(...args, 2.35));
  });
});
