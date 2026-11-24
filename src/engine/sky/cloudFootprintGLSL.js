// Horizontal footprint of a bounded (studio / Mini) cloud slab: a disc of
// radius uCloudRadius, or — when uCloudSquare > 0.5 — an axis-aligned square of
// half-size uCloudRadius. Both fit the same [center ± radius] square, so the
// enclosing box, occupancy grid, weather window and shadow map need no change.
// The includer declares `uniform float uCloudRadius;` before this snippet.
export const CLOUD_FOOTPRINT_GLSL = /* glsl */ `
uniform float uCloudSquare;

// footprint "distance" from the centre: Euclidean (disc) or Chebyshev (square)
float cloudFootprintDist(vec2 d) {
  return uCloudSquare > 0.5 ? max(abs(d.x), abs(d.y)) : length(d);
}

// clamp [t0,t1] to one axis slab |o + d t| <= R; false when the ray misses it
bool cloudFootprintAxis(float o, float d, float R, inout float t0, inout float t1) {
  if (abs(d) < 1e-8) return abs(o) <= R;
  float ta = (-R - o) / d;
  float tb = (R - o) / d;
  t0 = max(t0, min(ta, tb));
  t1 = min(t1, max(ta, tb));
  return true;
}

// Clamp the ray segment [t0,t1] to the footprint column (oc = ray origin XZ
// relative to the centre, dc = ray direction XZ). Returns false when the ray
// never crosses it. The caller still checks t1 <= t0.
bool cloudFootprintClip(vec2 oc, vec2 dc, inout float t0, inout float t1) {
  float R = uCloudRadius;
  if (uCloudSquare > 0.5) {
    if (!cloudFootprintAxis(oc.x, dc.x, R, t0, t1)) return false;
    return cloudFootprintAxis(oc.y, dc.y, R, t0, t1);
  }
  float A = dot(dc, dc);
  if (A <= 1e-8) return dot(oc, oc) <= R * R;
  float B = dot(oc, dc);
  float C = dot(oc, oc) - R * R;
  float disc = B * B - A * C;
  if (disc < 0.0) return false;
  float sq = sqrt(disc);
  t0 = max(t0, (-B - sq) / A);
  t1 = min(t1, (-B + sq) / A);
  return true;
}
`;
