// ============================================================================
// Noise type registry — the single source of truth tying together, per type:
//   - params         : editable schema (UI + serialization + defaults)
//   - scaleKey/paKeys/pbKeys : how continuous params map to the GLSL uniform
//                      lanes  uLayerScale / uLayerParamsA.xyzw / uLayerParamsB.xyzw
//   - body2d/body3d  : GLSL that sets `val` from P/pa/pb/scale/seed (height types)
//   - mod2d/mod3d    : GLSL that mutates `pw` or `h` (modifier types)
//   - eval2d/eval3d  : f64 CPU evaluator (close-enough player physics)
//
// Structural params (octaves, enum modes) carry `structural:true`; they bake
// into the generated GLSL as literals and changing them recompiles the shader.
// Continuous params flow through uniforms (live, no recompile).
//
// The `legacy` type IS the current hard-coded terrain recipe (see legacyShape2D
// / legacyShape3D injected by terrainGLSL / planetGLSL). The default stack is a
// single legacy layer, so default projects stay bit-identical to before.
// ============================================================================

import {
  vnoise2, vnoise3, fbm2, fbm3, ridged2, ridged3, billow2, billow3,
  hash12, hash13, smoothstep, clamp01,
} from './cpuNoise.js';

const clampOct = (v) => Math.max(1, Math.min(8, Math.round(v || 1)));
const clampWarpOct = (v) => Math.max(1, Math.min(6, Math.round(v || 1)));

// fract for JS terrace
const fract = (v) => v - Math.floor(v);

// ---- shared GLSL fragments for the per-octave fractal loops -----------------
const fbmLoop2 = (oct) => `
  if (pb.x <= 0.0 && pb.y <= 0.0) {
    float amp = 0.5, sum = 0.0, norm = 0.0; vec2 q = P;
    for (int i = 0; i < ${oct}; i++) { sum += amp * vnoise(q); norm += amp; amp *= pa.x; q = ROT2 * q * pa.y; }
    val = sum / max(norm, 1e-4);
  } else {
    float amp = 0.5, sum = 0.0, norm = 0.0; vec2 q = P, dsum = vec2(0.0);
    float erosionAmt = max(pb.x, 0.0), selfWarp = max(pb.y, 0.0);
    for (int i = 0; i < ${oct}; i++) {
      vec3 n = vnoised2(q + dsum * selfWarp);
      float damp = 1.0 / (1.0 + erosionAmt * 4.0 * dot(dsum, dsum));
      sum += amp * n.x * damp; norm += amp * damp;
      dsum += n.yz * amp;
      amp *= pa.x; q = ROT2 * q * pa.y;
    }
    val = sum / max(norm, 1e-4);
  }`;
const fbmLoop3 = (oct) => `
  if (pb.x <= 0.0 && pb.y <= 0.0) {
    float amp = 0.5, sum = 0.0, norm = 0.0; vec3 q = P;
    for (int i = 0; i < ${oct}; i++) { sum += amp * vnoise3(q); norm += amp; amp *= pa.x; q = ROT3 * q * pa.y; }
    val = sum / max(norm, 1e-4);
  } else {
    float amp = 0.5, sum = 0.0, norm = 0.0; vec3 q = P, dsum = vec3(0.0);
    float erosionAmt = max(pb.x, 0.0), selfWarp = max(pb.y, 0.0);
    for (int i = 0; i < ${oct}; i++) {
      vec4 n = vnoised3(q + dsum * selfWarp);
      float damp = 1.0 / (1.0 + erosionAmt * 4.0 * dot(dsum, dsum));
      sum += amp * n.x * damp; norm += amp * damp;
      dsum += n.yzw * amp;
      amp *= pa.x; q = ROT3 * q * pa.y;
    }
    val = sum / max(norm, 1e-4);
  }`;
const ridgedLoop2 = (oct) => `
  if (pb.x <= 0.0 && pb.y <= 0.0) {
    float amp = 0.5, sum = 0.0, norm = 0.0, carry = 1.0; vec2 q = P;
    for (int i = 0; i < ${oct}; i++) { float v = 1.0 - abs(vnoise(q) * 2.0 - 1.0); v = pow(v, pa.z); sum += amp * v * carry; carry = clamp(v * 1.4, 0.0, 1.0); norm += amp; amp *= pa.x; q = ROT2 * q * pa.y; }
    val = sum / max(norm, 1e-4);
  } else {
    float amp = 0.5, sum = 0.0, norm = 0.0, carry = 1.0; vec2 q = P, dsum = vec2(0.0);
    float erosionAmt = max(pb.x, 0.0), selfWarp = max(pb.y, 0.0);
    for (int i = 0; i < ${oct}; i++) {
      vec3 n = vnoised2(q + dsum * selfWarp);
      float raw = n.x * 2.0 - 1.0;
      float ridge = 1.0 - abs(raw);
      float v = pow(max(ridge, 0.0), pa.z);
      float damp = 1.0 / (1.0 + erosionAmt * 4.0 * dot(dsum, dsum));
      sum += amp * v * carry * damp; norm += amp * damp;
      float s = raw < 0.0 ? 1.0 : -1.0;
      vec2 dv = s * 2.0 * n.yz * pa.z * pow(max(ridge, 1e-4), pa.z - 1.0);
      dsum += dv * amp * carry;
      carry = clamp(v * 1.4, 0.0, 1.0);
      amp *= pa.x; q = ROT2 * q * pa.y;
    }
    val = sum / max(norm, 1e-4);
  }`;
const ridgedLoop3 = (oct) => `
  if (pb.x <= 0.0 && pb.y <= 0.0) {
    float amp = 0.5, sum = 0.0, norm = 0.0, carry = 1.0; vec3 q = P;
    for (int i = 0; i < ${oct}; i++) { float v = 1.0 - abs(vnoise3(q) * 2.0 - 1.0); v = pow(v, pa.z); sum += amp * v * carry; carry = clamp(v * 1.4, 0.0, 1.0); norm += amp; amp *= pa.x; q = ROT3 * q * pa.y; }
    val = sum / max(norm, 1e-4);
  } else {
    float amp = 0.5, sum = 0.0, norm = 0.0, carry = 1.0; vec3 q = P, dsum = vec3(0.0);
    float erosionAmt = max(pb.x, 0.0), selfWarp = max(pb.y, 0.0);
    for (int i = 0; i < ${oct}; i++) {
      vec4 n = vnoised3(q + dsum * selfWarp);
      float raw = n.x * 2.0 - 1.0;
      float ridge = 1.0 - abs(raw);
      float v = pow(max(ridge, 0.0), pa.z);
      float damp = 1.0 / (1.0 + erosionAmt * 4.0 * dot(dsum, dsum));
      sum += amp * v * carry * damp; norm += amp * damp;
      float s = raw < 0.0 ? 1.0 : -1.0;
      vec3 dv = s * 2.0 * n.yzw * pa.z * pow(max(ridge, 1e-4), pa.z - 1.0);
      dsum += dv * amp * carry;
      carry = clamp(v * 1.4, 0.0, 1.0);
      amp *= pa.x; q = ROT3 * q * pa.y;
    }
    val = sum / max(norm, 1e-4);
  }`;
const billowLoop2 = (oct) => `
  if (pb.x <= 0.0 && pb.y <= 0.0) {
    float amp = 0.5, sum = 0.0, norm = 0.0; vec2 q = P;
    for (int i = 0; i < ${oct}; i++) { sum += amp * abs(vnoise(q) * 2.0 - 1.0); norm += amp; amp *= pa.x; q = ROT2 * q * pa.y; }
    val = sum / max(norm, 1e-4);
  } else {
    float amp = 0.5, sum = 0.0, norm = 0.0; vec2 q = P, dsum = vec2(0.0);
    float erosionAmt = max(pb.x, 0.0), selfWarp = max(pb.y, 0.0);
    for (int i = 0; i < ${oct}; i++) {
      vec3 n = vnoised2(q + dsum * selfWarp);
      float raw = n.x * 2.0 - 1.0;
      float v = abs(raw);
      float damp = 1.0 / (1.0 + erosionAmt * 4.0 * dot(dsum, dsum));
      sum += amp * v * damp; norm += amp * damp;
      float s = raw < 0.0 ? -1.0 : 1.0;
      dsum += s * 2.0 * n.yz * amp;
      amp *= pa.x; q = ROT2 * q * pa.y;
    }
    val = sum / max(norm, 1e-4);
  }`;
const billowLoop3 = (oct) => `
  if (pb.x <= 0.0 && pb.y <= 0.0) {
    float amp = 0.5, sum = 0.0, norm = 0.0; vec3 q = P;
    for (int i = 0; i < ${oct}; i++) { sum += amp * abs(vnoise3(q) * 2.0 - 1.0); norm += amp; amp *= pa.x; q = ROT3 * q * pa.y; }
    val = sum / max(norm, 1e-4);
  } else {
    float amp = 0.5, sum = 0.0, norm = 0.0; vec3 q = P, dsum = vec3(0.0);
    float erosionAmt = max(pb.x, 0.0), selfWarp = max(pb.y, 0.0);
    for (int i = 0; i < ${oct}; i++) {
      vec4 n = vnoised3(q + dsum * selfWarp);
      float raw = n.x * 2.0 - 1.0;
      float v = abs(raw);
      float damp = 1.0 / (1.0 + erosionAmt * 4.0 * dot(dsum, dsum));
      sum += amp * v * damp; norm += amp * damp;
      float s = raw < 0.0 ? -1.0 : 1.0;
      dsum += s * 2.0 * n.yzw * amp;
      amp *= pa.x; q = ROT3 * q * pa.y;
    }
    val = sum / max(norm, 1e-4);
  }`;

const fbmAssign2 = (name, expr, oct) => `
      float ${name} = 0.0;
      {
        float amp = 0.5, norm = 0.0; vec2 q = ${expr};
        for (int i = 0; i < ${oct}; i++) {
          ${name} += amp * vnoise(q); norm += amp;
          amp *= uPersistence; q = ROT2 * q * uLacunarity;
        }
        ${name} = ${name} / max(norm, 1e-4);
      }`;

const fbmAssign3 = (name, expr, oct) => `
      float ${name} = 0.0;
      {
        float amp = 0.5, norm = 0.0; vec3 q = ${expr};
        for (int i = 0; i < ${oct}; i++) {
          ${name} += amp * vnoise3(q); norm += amp;
          amp *= uPersistence; q = ROT3 * q * uLacunarity;
        }
        ${name} = ${name} / max(norm, 1e-4);
      }`;

const domainWarp2 = (oct, coord = 'pw') => `{
      vec2 WP = ${coord} * scale;
${fbmAssign2('wx', 'WP + vec2(13.7, 41.3)', oct)}
${fbmAssign2('wz', 'WP + vec2(87.2, 9.1)', oct)}
      ${coord} += (vec2(wx, wz) - 0.5) * eff;
    }`;

const domainWarp3 = (oct, coord = 'pw') => `{
      vec3 WP = ${coord} * scale;
${fbmAssign3('wx', 'WP + vec3(13.7, 41.3, 7.2)', oct)}
${fbmAssign3('wy', 'WP + vec3(87.2, 9.1, 55.1)', oct)}
${fbmAssign3('wz', 'WP + vec3(31.7, 5.3, 91.4)', oct)}
      ${coord} += (vec3(wx, wy, wz) - 0.5) * eff;
    }`;

// common param descriptors
const P_OCT = { key: 'octaves', label: 'Octaves', min: 1, max: 8, step: 1, default: 5, structural: true };
const P_WARP_OCT = { key: 'octaves', label: 'Octaves', min: 1, max: 6, step: 1, default: 4, structural: true, settingId: 'noise.layer.domainWarpOctaves' };
const P_PERS = { key: 'persistence', label: 'Persistence', min: 0.15, max: 0.85, step: 0.01, default: 0.5, digits: 2 };
const P_LAC = { key: 'lacunarity', label: 'Lacunarity', min: 1.5, max: 3.5, step: 0.01, default: 2.0, digits: 2 };
const P_SCALE = { key: 'scale', label: 'Scale', min: 0.1, max: 20, step: 0.05, default: 1.0, digits: 2 };
const P_EROSION = { key: 'erosion', label: 'Erosion', min: 0, max: 1, step: 0.01, default: 0, digits: 2, settingId: 'noise.layer.erosion' };
const P_SELF_WARP = { key: 'warp', label: 'Self Warp', min: 0, max: 1.5, step: 0.01, default: 0, digits: 2, settingId: 'noise.layer.selfWarp' };

export const NOISE_TYPES = [
  // ---------------------------------------------------------------- legacy
  {
    id: 'legacy', label: 'Classic Terrain', category: 'height', badge: 'BASE',
    defaultBlend: 'replace', defaultStrength: 1.0,
    desc: 'The original biome-coupled terrain recipe. Driven by the global Terrain/Noise/Biome sliders.',
    scaleKey: null, paKeys: [], pbKeys: [], params: [],
    body2d: () => `val = legacyShape2D(xz, c);`,
    body3d: () => `val = legacyShape3D(dir);`,
    eval2d: (px, pz, layer, ctx) => (ctx && ctx.legacy2d ? ctx.legacy2d(px, pz) : 0),
    eval3d: (dx, dy, dz, layer, ctx) => (ctx && ctx.legacy3d ? ctx.legacy3d(dx, dy, dz) : 0),
  },

  // ---------------------------------------------------------------- fbm
  {
    id: 'fbm', label: 'FBM / Fractal', category: 'height',
    defaultBlend: 'add', defaultStrength: 0.4,
    desc: 'Layered value noise — general terrain variation, rolling hills, natural detail.',
    scaleKey: 'scale', paKeys: ['persistence', 'lacunarity'], pbKeys: ['erosion', 'warp'],
    params: [P_SCALE, P_OCT, P_PERS, P_LAC, P_EROSION, P_SELF_WARP],
    body2d: (l) => fbmLoop2(clampOct(l.params.octaves)),
    body3d: (l) => fbmLoop3(clampOct(l.params.octaves)),
    eval2d: (px, pz, l) => fbm2(px, pz, l.params.octaves, l.params.persistence, l.params.lacunarity, l.params.erosion, l.params.warp),
    eval3d: (px, py, pz, l) => fbm3(px, py, pz, l.params.octaves, l.params.persistence, l.params.lacunarity, l.params.erosion, l.params.warp),
  },

  // ---------------------------------------------------------------- ridged
  {
    id: 'ridged', label: 'Ridged', category: 'height',
    defaultBlend: 'add', defaultStrength: 0.5,
    desc: 'Sharp ridges and mountain chains, alpine terrain, canyon edges.',
    scaleKey: 'scale', paKeys: ['persistence', 'lacunarity', 'sharpness'], pbKeys: ['erosion', 'warp'],
    params: [P_SCALE, P_OCT, P_PERS, P_LAC,
      { key: 'sharpness', label: 'Ridge Sharpness', min: 0.5, max: 4, step: 0.05, default: 2.0, digits: 2 },
      P_EROSION, P_SELF_WARP],
    body2d: (l) => ridgedLoop2(clampOct(l.params.octaves)),
    body3d: (l) => ridgedLoop3(clampOct(l.params.octaves)),
    eval2d: (px, pz, l) => ridged2(px, pz, l.params.octaves, l.params.persistence, l.params.lacunarity, l.params.sharpness, l.params.erosion, l.params.warp),
    eval3d: (px, py, pz, l) => ridged3(px, py, pz, l.params.octaves, l.params.persistence, l.params.lacunarity, l.params.sharpness, l.params.erosion, l.params.warp),
  },

  // ---------------------------------------------------------------- billow
  {
    id: 'billow', label: 'Billow', category: 'height',
    defaultBlend: 'add', defaultStrength: 0.4,
    desc: 'Soft rounded noise — hills, soft dunes, organic/cloud-like surfaces.',
    scaleKey: 'scale', paKeys: ['persistence', 'lacunarity'], pbKeys: ['erosion', 'warp'],
    params: [P_SCALE, P_OCT, P_PERS, P_LAC, P_EROSION, P_SELF_WARP],
    body2d: (l) => billowLoop2(clampOct(l.params.octaves)),
    body3d: (l) => billowLoop3(clampOct(l.params.octaves)),
    eval2d: (px, pz, l) => billow2(px, pz, l.params.octaves, l.params.persistence, l.params.lacunarity, l.params.erosion, l.params.warp),
    eval3d: (px, py, pz, l) => billow3(px, py, pz, l.params.octaves, l.params.persistence, l.params.lacunarity, l.params.erosion, l.params.warp),
  },

  // ---------------------------------------------------------------- value
  {
    id: 'value', label: 'Value', category: 'height',
    defaultBlend: 'add', defaultStrength: 0.3,
    desc: 'Simple blocky base noise — broad masks, biome zones, stylized variation.',
    scaleKey: 'scale', paKeys: [], pbKeys: [],
    params: [P_SCALE,
      { key: 'interp', label: 'Interpolation', type: 'enum', structural: true, default: 2,
        options: [{ value: 0, label: 'Linear' }, { value: 1, label: 'Smooth' }, { value: 2, label: 'Smoother' }] }],
    body2d: (l) => `val = valueNoise2(P, ${l.params.interp | 0});`,
    body3d: (l) => `val = valueNoise3(P, ${l.params.interp | 0});`,
    eval2d: (px, pz) => vnoise2(px, pz),
    eval3d: (px, py, pz) => vnoise3(px, py, pz),
  },

  // ---------------------------------------------------------------- white
  {
    id: 'white', label: 'White / Random', category: 'height',
    defaultBlend: 'add', defaultStrength: 0.06,
    desc: 'Fine random detail — micro variation, roughness, mask breakup.',
    scaleKey: 'scale', paKeys: ['smoothing'], pbKeys: [],
    params: [{ ...P_SCALE, default: 8.0 },
      { key: 'smoothing', label: 'Smoothing', min: 0, max: 1, step: 0.01, default: 0.0, digits: 2 }],
    body2d: () => `val = whiteNoise2(P, pa.x);`,
    body3d: () => `val = whiteNoise3(P, pa.x);`,
    eval2d: (px, pz, l) => {
      const blocky = hash12(Math.floor(px) + 0.5, Math.floor(pz) + 0.5);
      return blocky + (vnoise2(px, pz) - blocky) * clamp01(l.params.smoothing);
    },
    eval3d: (px, py, pz, l) => {
      const blocky = hash13(Math.floor(px) + 0.5, Math.floor(py) + 0.5, Math.floor(pz) + 0.5);
      return blocky + (vnoise3(px, py, pz) - blocky) * clamp01(l.params.smoothing);
    },
  },

  // ---------------------------------------------------------------- constant
  {
    id: 'constant', label: 'Constant', category: 'height',
    defaultBlend: 'add', defaultStrength: 1.0,
    desc: 'A flat constant value — raise/lower the whole terrain, flatten base, water tests.',
    scaleKey: null, paKeys: ['value'], pbKeys: [],
    params: [{ key: 'value', label: 'Value', min: -1, max: 1, step: 0.01, default: 0.1, digits: 2 }],
    body2d: () => `val = pa.x;`,
    body3d: () => `val = pa.x;`,
    eval2d: (px, pz, l) => l.params.value,
    eval3d: (px, py, pz, l) => l.params.value,
  },

  // ---------------------------------------------------------------- voronoi
  {
    id: 'voronoi', label: 'Voronoi / Cellular', category: 'height',
    defaultBlend: 'add', defaultStrength: 0.4,
    desc: 'Cell-based noise — tectonic plates, cracked desert, ice, alien patterns.',
    scaleKey: 'scale', paKeys: ['jitter'], pbKeys: [],
    params: [{ ...P_SCALE, default: 2.0 },
      { key: 'jitter', label: 'Jitter', min: 0, max: 1, step: 0.01, default: 1.0, digits: 2 },
      { key: 'distanceMode', label: 'Distance', type: 'enum', structural: true, default: 0,
        options: [{ value: 0, label: 'Euclidean' }, { value: 1, label: 'Manhattan' }, { value: 2, label: 'Chebyshev' }] },
      { key: 'outputMode', label: 'Output', type: 'enum', structural: true, default: 2,
        options: [{ value: 0, label: 'Cell Value' }, { value: 1, label: 'Dist Center' }, { value: 2, label: 'Dist Edge' }, { value: 3, label: 'Edge Lines' }] }],
    body2d: (l) => `val = voronoi2(P, pa.x, ${l.params.distanceMode | 0}, ${l.params.outputMode | 0});`,
    body3d: (l) => `val = voronoi3(P, pa.x, ${l.params.distanceMode | 0}, ${l.params.outputMode | 0});`,
    eval2d: (px, pz, l) => voronoiJs2(px, pz, l.params.jitter, l.params.distanceMode | 0, l.params.outputMode | 0),
    eval3d: (px, py, pz, l) => voronoiJs3(px, py, pz, l.params.jitter, l.params.distanceMode | 0, l.params.outputMode | 0),
  },

  // ---------------------------------------------------------------- crater
  {
    id: 'crater', label: 'Crater', category: 'height',
    defaultBlend: 'add', defaultStrength: 0.5,
    desc: 'Impact craters — moons, asteroids, dead planets, sci-fi terrain.',
    scaleKey: 'scale', paKeys: ['density', 'depth', 'rim', 'rimWidth'], pbKeys: [],
    params: [{ ...P_SCALE, default: 1.5 },
      { key: 'density', label: 'Density', min: 0, max: 1, step: 0.01, default: 0.55, digits: 2 },
      { key: 'depth', label: 'Depth', min: 0, max: 1.5, step: 0.01, default: 0.6, digits: 2 },
      { key: 'rim', label: 'Rim Height', min: 0, max: 1, step: 0.01, default: 0.3, digits: 2 },
      { key: 'rimWidth', label: 'Rim Width', min: 0.05, max: 1, step: 0.01, default: 0.35, digits: 2 }],
    body2d: () => `val = crater2(P, pa.x, pa.y, pa.z, pa.w);`,
    body3d: () => `val = crater3(P, pa.x, pa.y, pa.z, pa.w);`,
    eval2d: (px, pz, l) => craterJs2(px, pz, l.params.density, l.params.depth, l.params.rim, l.params.rimWidth),
    eval3d: (px, py, pz, l) => craterJs3(px, py, pz, l.params.density, l.params.depth, l.params.rim, l.params.rimWidth),
  },

  // ---------------------------------------------------------------- dune
  {
    id: 'dune', label: 'Dune', category: 'height',
    defaultBlend: 'add', defaultStrength: 0.35,
    desc: 'Directional wind-shaped sand dunes for deserts and dry worlds.',
    scaleKey: 'scale', paKeys: ['windDir', 'sharpness', 'rippleScale', 'rippleStrength'], pbKeys: [],
    params: [{ ...P_SCALE, default: 1.2 },
      { key: 'windDir', label: 'Wind Direction', min: 0, max: 6.283, step: 0.01, default: 0.7, digits: 2 },
      { key: 'sharpness', label: 'Dune Sharpness', min: 0.3, max: 4, step: 0.05, default: 1.4, digits: 2 },
      { key: 'rippleScale', label: 'Ripple Scale', min: 0.5, max: 12, step: 0.1, default: 4.0, digits: 1 },
      { key: 'rippleStrength', label: 'Ripple Strength', min: 0, max: 0.6, step: 0.01, default: 0.12, digits: 2 }],
    body2d: () => `val = dune2(P, pa.x, pa.y, pa.z, pa.w);`,
    body3d: () => `val = dune3(P, pa.x, pa.y, pa.z, pa.w);`,
    eval2d: (px, pz, l) => duneJs(px, pz, l.params),
    eval3d: (px, py, pz, l) => duneJs(px, pz, l.params),
  },

  // ---------------------------------------------------------------- flow
  {
    id: 'flow', label: 'Flow / River', category: 'height',
    defaultBlend: 'subtract', defaultStrength: 0.5,
    desc: 'Directional flow channels — river valleys, erosion streaks, lava flows.',
    scaleKey: 'scale', paKeys: ['flowDir', 'width', 'meander', 'meanderScale'], pbKeys: [],
    params: [{ ...P_SCALE, default: 1.0 },
      { key: 'flowDir', label: 'Flow Direction', min: 0, max: 6.283, step: 0.01, default: 1.2, digits: 2 },
      { key: 'width', label: 'Channel Width', min: 0.02, max: 1.5, step: 0.01, default: 0.3, digits: 2 },
      { key: 'meander', label: 'Meander', min: 0, max: 4, step: 0.05, default: 1.2, digits: 2 },
      { key: 'meanderScale', label: 'Meander Scale', min: 0.05, max: 3, step: 0.05, default: 0.6, digits: 2 }],
    body2d: () => `val = flow2(P, pa.x, pa.y, pa.z, pa.w);`,
    body3d: () => `val = flow3(P, pa.x, pa.y, pa.z, pa.w);`,
    eval2d: (px, pz, l) => flowJs(px, pz, l.params),
    eval3d: (px, py, pz, l) => flowJs(px, pz, l.params),
  },

  // ---------------------------------------------------------------- domainWarp (modifier)
  {
    id: 'domainWarp', label: 'Domain Warp', category: 'modifier', badge: 'MOD',
    defaultBlend: 'add', defaultStrength: 1.0,
    desc: 'Distorts the coordinates of the layers below — breaks artificial patterns, twists terrain.',
    modKind: 'domain',
    scaleKey: 'scale', paKeys: [], pbKeys: [],
    params: [{ key: 'scale', label: 'Warp Scale', min: 0.1, max: 8, step: 0.05, default: 1.0, digits: 2 }, P_WARP_OCT],
    mod2d: (l, coord = 'pw') => domainWarp2(clampWarpOct(l.params.octaves ?? 4), coord),
    mod3d: (l, coord = 'pw') => domainWarp3(clampWarpOct(l.params.octaves ?? 4), coord),
    modJs2: (state, l, eff) => {
      const s = l.params.scale;
      const oct = l.params.octaves ?? 4;
      const wx = fbm2(state.px * s + 13.7, state.pz * s + 41.3, oct, 0.5, 2.0);
      const wz = fbm2(state.px * s + 87.2, state.pz * s + 9.1, oct, 0.5, 2.0);
      state.px += (wx - 0.5) * eff; state.pz += (wz - 0.5) * eff;
    },
    modJs3: (state, l, eff) => {
      const s = l.params.scale;
      const oct = l.params.octaves ?? 4;
      const wx = fbm3(state.px * s + 13.7, state.py * s + 41.3, state.pz * s + 7.2, oct, 0.5, 2.0);
      const wy = fbm3(state.px * s + 87.2, state.py * s + 9.1, state.pz * s + 55.1, oct, 0.5, 2.0);
      const wz = fbm3(state.px * s + 31.7, state.py * s + 5.3, state.pz * s + 91.4, oct, 0.5, 2.0);
      state.px += (wx - 0.5) * eff; state.py += (wy - 0.5) * eff; state.pz += (wz - 0.5) * eff;
    },
  },

  // ---------------------------------------------------------------- terrace (modifier)
  {
    id: 'terrace', label: 'Terrace', category: 'modifier', badge: 'MOD',
    defaultBlend: 'replace', defaultStrength: 1.0,
    desc: 'Quantizes the accumulated height into stepped terraces — plateaus, cliffs, strata.',
    modKind: 'height',
    scaleKey: null, paKeys: ['count', 'smoothness'], pbKeys: [],
    params: [
      { key: 'count', label: 'Terrace Count', min: 2, max: 40, step: 1, default: 12, digits: 0 },
      { key: 'smoothness', label: 'Smoothness', min: 0.02, max: 1, step: 0.01, default: 0.5, digits: 2 }],
    mod2d: (l, heightVar = 'h') => terraceMod(heightVar),
    mod3d: (l, heightVar = 'h') => terraceMod(heightVar),
    modHeightJs: (h, l, eff, m) => {
      const steps = Math.max(1, l.params.count);
      const t = h * steps;
      const s = smoothstep(0.5 - l.params.smoothness * 0.5, 0.5 + l.params.smoothness * 0.5, fract(t));
      const terr = (Math.floor(t) + s) / steps;
      return h + (terr - h) * (eff * m);
    },
  },
];

const terraceMod = (heightVar = 'h') => `{
  float steps = max(pa.x, 1.0);
  float t = ${heightVar} * steps;
  float s = smoothstep(0.5 - pa.y * 0.5, 0.5 + pa.y * 0.5, fract(t));
  float terr = (floor(t) + s) / steps;
  ${heightVar} = mix(${heightVar}, terr, eff * m);
}`;

// ---- CPU helpers for the feature types -------------------------------------
function voronoiJs2(px, pz, jitter, dmode, omode) {
  const ipx = Math.floor(px), ipz = Math.floor(pz);
  const fpx = px - ipx, fpz = pz - ipz;
  let f1 = 8, f2 = 8, cellRnd = 0;
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    const ox = hash12(ipx + x, ipz + y);
    const oy = hash12(ipx + x + 41.3, ipz + y + 13.7);
    const rx = x + ox * jitter - fpx, ry = y + oy * jitter - fpz;
    const d = dmode === 0 ? rx * rx + ry * ry : dmode === 1 ? Math.abs(rx) + Math.abs(ry) : Math.max(Math.abs(rx), Math.abs(ry));
    if (d < f1) { f2 = f1; f1 = d; cellRnd = hash12(ipx + x + 7.1, ipz + y + 91.7); }
    else if (d < f2) { f2 = d; }
  }
  const d1 = dmode === 0 ? Math.sqrt(f1) : f1;
  const d2 = dmode === 0 ? Math.sqrt(f2) : f2;
  if (omode === 0) return clamp01(cellRnd);
  if (omode === 1) return clamp01(d1);
  if (omode === 2) return clamp01(d2 - d1);
  return clamp01(1 - (d2 - d1) * 3);
}
function voronoiJs3(px, py, pz, jitter, dmode, omode) {
  const ipx = Math.floor(px), ipy = Math.floor(py), ipz = Math.floor(pz);
  const fpx = px - ipx, fpy = py - ipy, fpz = pz - ipz;
  let f1 = 8, f2 = 8, cellRnd = 0;
  for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    const ox = hash13(ipx + x, ipy + y, ipz + z);
    const oy = hash13(ipx + x + 41.3, ipy + y + 13.7, ipz + z + 7.1);
    const oz = hash13(ipx + x + 9.2, ipy + y + 57.1, ipz + z + 33.3);
    const rx = x + ox * jitter - fpx, ry = y + oy * jitter - fpy, rz = z + oz * jitter - fpz;
    const d = dmode === 0 ? rx * rx + ry * ry + rz * rz : dmode === 1 ? Math.abs(rx) + Math.abs(ry) + Math.abs(rz) : Math.max(Math.abs(rx), Math.abs(ry), Math.abs(rz));
    if (d < f1) { f2 = f1; f1 = d; cellRnd = hash13(ipx + x + 7.1, ipy + y + 91.7, ipz + z + 3.3); }
    else if (d < f2) { f2 = d; }
  }
  const d1 = dmode === 0 ? Math.sqrt(f1) : f1;
  const d2 = dmode === 0 ? Math.sqrt(f2) : f2;
  if (omode === 0) return clamp01(cellRnd);
  if (omode === 1) return clamp01(d1);
  if (omode === 2) return clamp01(d2 - d1);
  return clamp01(1 - (d2 - d1) * 3);
}
function craterJs2(px, pz, density, depth, rim, rimWidth) {
  const ipx = Math.floor(px), ipz = Math.floor(pz);
  const fpx = px - ipx, fpz = pz - ipz;
  let best = 8, rnd = 0;
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    const ox = hash12(ipx + x, ipz + y), oy = hash12(ipx + x + 23.7, ipz + y + 5.9);
    const dx = x + ox - fpx, dy = y + oy - fpz;
    const d = Math.hypot(dx, dy);
    if (d < best) { best = d; rnd = hash12(ipx + x + 61.1, ipz + y + 7.3); }
  }
  if (rnd > density) return 0;
  const radius = 0.18 + 0.28 * hash12(ipx + rnd * 17, ipz + rnd * 17);
  const t = best / Math.max(radius, 0.02);
  const bowl = -depth * (1 - smoothstep(0, 1, t));
  const rimv = rim * Math.exp(-Math.pow((t - 1) / Math.max(rimWidth, 0.02), 2));
  return bowl + rimv;
}
function craterJs3(px, py, pz, density, depth, rim, rimWidth) {
  const ipx = Math.floor(px), ipy = Math.floor(py), ipz = Math.floor(pz);
  const fpx = px - ipx, fpy = py - ipy, fpz = pz - ipz;
  let best = 8, rnd = 0;
  for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    const ox = hash13(ipx + x, ipy + y, ipz + z), oy = hash13(ipx + x + 23.7, ipy + y + 5.9, ipz + z + 11.1), oz = hash13(ipx + x + 3.1, ipy + y + 47.7, ipz + z + 91.2);
    const dx = x + ox - fpx, dy = y + oy - fpy, dz = z + oz - fpz;
    const d = Math.hypot(dx, dy, dz);
    if (d < best) { best = d; rnd = hash13(ipx + x + 61.1, ipy + y + 7.3, ipz + z + 19.9); }
  }
  if (rnd > density) return 0;
  const radius = 0.18 + 0.28 * hash13(ipx + rnd * 17, ipy + rnd * 17, ipz + rnd * 17);
  const t = best / Math.max(radius, 0.02);
  const bowl = -depth * (1 - smoothstep(0, 1, t));
  const rimv = rim * Math.exp(-Math.pow((t - 1) / Math.max(rimWidth, 0.02), 2));
  return bowl + rimv;
}
function duneJs(px, pz, p) {
  const dirx = Math.cos(p.windDir), diry = Math.sin(p.windDir);
  const across = px * -diry + pz * dirx;
  const along = px * dirx + pz * diry;
  const warp = (vnoise2(px * 0.5, pz * 0.5) - 0.5) * 2;
  let dunes = 1 - Math.abs(Math.sin(across + warp));
  dunes = Math.pow(clamp01(dunes), Math.max(p.sharpness, 0.1));
  const ripples = (vnoise2(across * p.rippleScale, along * 0.3) - 0.5) * p.rippleStrength;
  return clamp01(dunes + ripples);
}
function flowJs(px, pz, p) {
  const dirx = Math.cos(p.flowDir), diry = Math.sin(p.flowDir);
  const along = px * dirx + pz * diry;
  let across = px * -diry + pz * dirx;
  across += (vnoise2(along * p.meanderScale, 13.1) - 0.5) * p.meander;
  return clamp01(Math.exp(-Math.pow(across / Math.max(p.width, 0.02), 2)));
}

// ---------------------------------------------------------------- lookup
const _byId = new Map(NOISE_TYPES.map((t) => [t.id, t]));
export function getNoiseType(id) { return _byId.get(id); }

// Types offered in the "Add Noise Layer" menu (legacy is added via migration,
// not the menu — but allow re-adding it too).
export const ADDABLE_TYPES = NOISE_TYPES.map((t) => t.id);
