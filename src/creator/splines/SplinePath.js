import * as THREE from 'three';

const EPS = 1e-4;

export function resampleSpline(points, { interpolation = 'catmull-rom', closed = false, spacing = 8 } = {}) {
  if (!points?.length) return [];
  if (points.length === 1) return [{ ...points[0], distance: 0, t: 0 }];
  const source = points.map((p) => new THREE.Vector3(p.x, p.y || 0, p.z));
  const curve = interpolation === 'linear'
    ? new THREE.CatmullRomCurve3(source, closed, 'catmullrom', 0.0)
    : new THREE.CatmullRomCurve3(source, closed, 'centripetal', 0.5);
  const divisions = Math.max(16, source.length * 24);
  const dense = curve.getSpacedPoints(divisions);
  let length = 0;
  for (let i = 1; i < dense.length; i++) length += dense[i].distanceTo(dense[i - 1]);
  const count = Math.max(2, Math.ceil(length / Math.max(spacing, 1)) + 1);
  const result = curve.getSpacedPoints(count - 1);
  let distance = 0;
  return result.map((p, i) => {
    if (i) distance += p.distanceTo(result[i - 1]);
    return { x: p.x, y: p.y, z: p.z, distance, t: i / Math.max(result.length - 1, 1) };
  });
}

export function nearestSegment(points, x, z) {
  let best = { index: 0, t: 0, distance: Infinity };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const d2 = dx * dx + dz * dz || EPS;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / d2));
    const px = a.x + dx * t, pz = a.z + dz * t;
    const distance = Math.hypot(x - px, z - pz);
    if (distance < best.distance) best = { index: i, t, distance };
  }
  return best;
}
