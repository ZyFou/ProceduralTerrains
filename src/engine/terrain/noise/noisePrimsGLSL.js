// ============================================================================
// Reusable GLSL primitives for the Noise Stack codegen, beyond what
// terrainGLSL / planetGLSL already provide (vnoise, fbm, ridgedFBM, hash12,
// ROT2 / vnoise3, hash13, ROT3, terrace, planetTerrace).
//
// All loop bounds here are hard constants (3 / 9 / 27) — never dynamic — so the
// ANGLE D3D11 compiler can unroll them without hanging. The per-layer FBM /
// ridged / billow stacks with a USER octave count are emitted inline by the
// codegen with the octave count baked as a literal (also constant).
//
// PRIMS2D depends on: hash12, vnoise, ROT2.
// PRIMS3D depends on: hash13, vnoise3, ROT3.
// ============================================================================

export const NOISE_STACK_PRIMS2D_GLSL = /* glsl */ `
// value noise plus analytic derivatives. The .x channel intentionally matches
// vnoise(p): same hash corners, same quintic interpolant, same mix order.
vec3 vnoised2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f - 1.0) * (f - 1.0);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  float top = mix(a, b, u.x);
  float bot = mix(c, d, u.x);
  float value = mix(top, bot, u.y);
  vec2 deriv = vec2(
    mix(b - a, d - c, u.y) * du.x,
    (bot - top) * du.y
  );
  return vec3(value, deriv);
}

// value noise with selectable interpolation (0 linear, 1 smooth, 2 quintic)
float valueNoise2(vec2 p, int mode) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = mode == 0 ? f
         : mode == 1 ? f * f * (3.0 - 2.0 * f)
         : f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// blocky white noise, optionally smoothed toward value noise
float whiteNoise2(vec2 p, float smoothAmt) {
  float blocky = hash12(floor(p) + 0.5);
  return mix(blocky, vnoise(p), clamp(smoothAmt, 0.0, 1.0));
}

// Voronoi / cellular. dmode: 0 euclidean, 1 manhattan, 2 chebyshev.
// omode: 0 cell value, 1 dist-to-center(F1), 2 dist-to-edge(F2-F1), 3 edge lines.
float voronoi2(vec2 p, float jitter, int dmode, int omode) {
  vec2 ip = floor(p), fp = fract(p);
  float f1 = 8.0, f2 = 8.0;
  float cellRnd = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(hash12(ip + g), hash12(ip + g + vec2(41.3, 13.7)));
      vec2 r = g + o * jitter - fp;
      float d = dmode == 0 ? dot(r, r)
              : dmode == 1 ? abs(r.x) + abs(r.y)
              : max(abs(r.x), abs(r.y));
      if (d < f1) { f2 = f1; f1 = d; cellRnd = hash12(ip + g + vec2(7.1, 91.7)); }
      else if (d < f2) { f2 = d; }
    }
  }
  float d1 = dmode == 0 ? sqrt(f1) : f1;
  float d2 = dmode == 0 ? sqrt(f2) : f2;
  if (omode == 0) return clamp(cellRnd, 0.0, 1.0);
  if (omode == 1) return clamp(d1, 0.0, 1.0);
  if (omode == 2) return clamp(d2 - d1, 0.0, 1.0);
  return clamp(1.0 - (d2 - d1) * 3.0, 0.0, 1.0);
}

// Impact craters: depressed bowl + raised rim, distributed one-per-cell, gated
// by density. Returns a signed value (~ -depth .. +rim), centered near 0.
float crater2(vec2 p, float density, float depth, float rim, float rimWidth) {
  vec2 ip = floor(p), fp = fract(p);
  float best = 8.0, rnd = 0.0, rad = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(hash12(ip + g), hash12(ip + g + vec2(23.7, 5.9)));
      float d = length(g + o - fp);
      if (d < best) { best = d; rnd = hash12(ip + g + vec2(61.1, 7.3)); }
    }
  }
  if (rnd > density) return 0.0;
  float radius = mix(0.18, 0.46, hash12(ip + vec2(rnd * 17.0)));
  float t = best / max(radius, 0.02);
  float bowl = -depth * (1.0 - smoothstep(0.0, 1.0, t));
  float rimv = rim * exp(-pow((t - 1.0) / max(rimWidth, 0.02), 2.0));
  return bowl + rimv;
}

// Wind-shaped dunes: ridges perpendicular to wind direction + fine ripples.
float dune2(vec2 p, float windDir, float sharp, float rippleScale, float rippleStr) {
  vec2 dir = vec2(cos(windDir), sin(windDir));
  float across = dot(p, vec2(-dir.y, dir.x));
  float along = dot(p, dir);
  float warp = (vnoise(p * 0.5) - 0.5) * 2.0;
  float dunes = 1.0 - abs(sin(across + warp));
  dunes = pow(clamp(dunes, 0.0, 1.0), max(sharp, 0.1));
  float ripples = (vnoise(vec2(across * rippleScale, along * 0.3)) - 0.5) * rippleStr;
  return clamp(dunes + ripples, 0.0, 1.0);
}

// Flow / river channels: gaussian valley along a meandering direction.
// Returns the channel mask 0..1 (1 inside the channel) — pair with subtract/carve.
float flow2(vec2 p, float flowDir, float width, float meander, float meanderScale) {
  vec2 dir = vec2(cos(flowDir), sin(flowDir));
  float across = dot(p, vec2(-dir.y, dir.x));
  float along = dot(p, dir);
  across += (vnoise(vec2(along * meanderScale, 13.1)) - 0.5) * meander;
  return clamp(exp(-pow(across / max(width, 0.02), 2.0)), 0.0, 1.0);
}
`;

export const NOISE_STACK_PRIMS3D_GLSL = /* glsl */ `
vec4 vnoised3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec3 du = 30.0 * f * f * (f - 1.0) * (f - 1.0);
  float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  float x00 = mix(n000, n100, u.x);
  float x10 = mix(n010, n110, u.x);
  float x01 = mix(n001, n101, u.x);
  float x11 = mix(n011, n111, u.x);
  float y0 = mix(x00, x10, u.y);
  float y1 = mix(x01, x11, u.y);
  float value = mix(y0, y1, u.z);
  vec3 deriv = vec3(
    mix(mix(n100 - n000, n110 - n010, u.y), mix(n101 - n001, n111 - n011, u.y), u.z) * du.x,
    mix(x10 - x00, x11 - x01, u.z) * du.y,
    (y1 - y0) * du.z
  );
  return vec4(value, deriv);
}

float valueNoise3(vec3 p, int mode) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = mode == 0 ? f
         : mode == 1 ? f * f * (3.0 - 2.0 * f)
         : f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

float whiteNoise3(vec3 p, float smoothAmt) {
  float blocky = hash13(floor(p) + 0.5);
  return mix(blocky, vnoise3(p), clamp(smoothAmt, 0.0, 1.0));
}

float voronoi3(vec3 p, float jitter, int dmode, int omode) {
  vec3 ip = floor(p), fp = fract(p);
  float f1 = 8.0, f2 = 8.0, cellRnd = 0.0;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 g = vec3(float(x), float(y), float(z));
        vec3 o = vec3(hash13(ip + g), hash13(ip + g + vec3(41.3, 13.7, 7.1)),
                      hash13(ip + g + vec3(9.2, 57.1, 33.3)));
        vec3 r = g + o * jitter - fp;
        float d = dmode == 0 ? dot(r, r)
                : dmode == 1 ? abs(r.x) + abs(r.y) + abs(r.z)
                : max(max(abs(r.x), abs(r.y)), abs(r.z));
        if (d < f1) { f2 = f1; f1 = d; cellRnd = hash13(ip + g + vec3(7.1, 91.7, 3.3)); }
        else if (d < f2) { f2 = d; }
      }
    }
  }
  float d1 = dmode == 0 ? sqrt(f1) : f1;
  float d2 = dmode == 0 ? sqrt(f2) : f2;
  if (omode == 0) return clamp(cellRnd, 0.0, 1.0);
  if (omode == 1) return clamp(d1, 0.0, 1.0);
  if (omode == 2) return clamp(d2 - d1, 0.0, 1.0);
  return clamp(1.0 - (d2 - d1) * 3.0, 0.0, 1.0);
}

float crater3(vec3 p, float density, float depth, float rim, float rimWidth) {
  vec3 ip = floor(p), fp = fract(p);
  float best = 8.0, rnd = 0.0;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 g = vec3(float(x), float(y), float(z));
        vec3 o = vec3(hash13(ip + g), hash13(ip + g + vec3(23.7, 5.9, 11.1)),
                      hash13(ip + g + vec3(3.1, 47.7, 91.2)));
        float d = length(g + o - fp);
        if (d < best) { best = d; rnd = hash13(ip + g + vec3(61.1, 7.3, 19.9)); }
      }
    }
  }
  if (rnd > density) return 0.0;
  float radius = mix(0.18, 0.46, hash13(ip + vec3(rnd * 17.0)));
  float t = best / max(radius, 0.02);
  float bowl = -depth * (1.0 - smoothstep(0.0, 1.0, t));
  float rimv = rim * exp(-pow((t - 1.0) / max(rimWidth, 0.02), 2.0));
  return bowl + rimv;
}

// 3D dunes/flow operate in the noise domain directly (seamless on the sphere).
float dune3(vec3 p, float windDir, float sharp, float rippleScale, float rippleStr) {
  vec3 dir = normalize(vec3(cos(windDir), 0.3, sin(windDir)));
  float across = dot(p, normalize(cross(dir, vec3(0.0, 1.0, 0.0)) + 1e-4));
  float warp = (vnoise3(p * 0.5) - 0.5) * 2.0;
  float dunes = pow(clamp(1.0 - abs(sin(across + warp)), 0.0, 1.0), max(sharp, 0.1));
  float ripples = (vnoise3(p * rippleScale) - 0.5) * rippleStr;
  return clamp(dunes + ripples, 0.0, 1.0);
}

float flow3(vec3 p, float flowDir, float width, float meander, float meanderScale) {
  vec3 dir = normalize(vec3(cos(flowDir), 0.2, sin(flowDir)));
  vec3 side = normalize(cross(dir, vec3(0.0, 1.0, 0.0)) + 1e-4);
  float across = dot(p, side) + (vnoise3(p * meanderScale) - 0.5) * meander;
  return clamp(exp(-pow(across / max(width, 0.02), 2.0)), 0.0, 1.0);
}
`;
