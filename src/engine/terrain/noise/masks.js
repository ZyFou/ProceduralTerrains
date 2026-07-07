// ============================================================================
// Per-layer masks. A layer's contribution is multiplied by a 0..1 mask chain
// so it only affects part of the terrain. Phase 1 implements the two most
// useful masks — height and noise — in GLSL (full fidelity) and height in the
// CPU evaluator (close-enough for physics). Slope / biome / latitude / water
// masks are added in a later phase.
//
// finalMask = heightMask * noiseMask  (each clamped 0..1, optional invert)
// ============================================================================

export const MASK_TYPES = [
  { id: 'height', label: 'Height' },
  { id: 'noise', label: 'Noise' },
  { id: 'slope', label: 'Slope' },
  { id: 'biome', label: 'Biome', soon: true },
];

export function defaultMask(type) {
  switch (type) {
    case 'height': return { type, enabled: true, invert: false, params: { min: 0.0, max: 1.35, falloff: 0.06 } };
    case 'noise': return { type, enabled: true, invert: false, params: { scale: 1.0, threshold: 0.5, softness: 0.12 } };
    case 'slope': return { type, enabled: true, invert: false, params: { min: 0.0, max: 1.0, falloff: 0.1 } };
    case 'biome': return { type, enabled: true, invert: false, params: { biome: 0 } };
    default: return { type, enabled: true, invert: false, params: {} };
  }
}

// GLSL helpers (included once via NOISE_STACK_MASKS*_GLSL). a/b are the packed
// uLayerMaskA / uLayerMaskB vec4s. a = (min, max, falloff, flags); flags bit0 =
// invert height. b = (noiseScale, threshold, softness, invertNoise).
export const NOISE_STACK_MASKS2D_GLSL = /* glsl */ `
float maskHeight(float h, vec4 a) {
  float lo = smoothstep(a.x - a.z, a.x + a.z, h);
  float hi = smoothstep(a.y + a.z, a.y - a.z, h);
  float mm = clamp(lo * hi, 0.0, 1.0);
  if (a.w >= 0.5) mm = 1.0 - mm;
  return mm;
}
float maskNoise2(vec2 pw, vec4 b) {
  float n = vnoise(pw * b.x + vec2(53.2, 11.7));
  float mm = smoothstep(b.y - b.z, b.y + b.z, n);
  if (b.w >= 0.5) mm = 1.0 - mm;
  return mm;
}
float stackSlope(float h, float hDX, float hDZ) {
  return length(vec2(hDX - h, hDZ - h)) * max(uAmplitude, 0.0) * max(uHeightScale, 1.0) / 8.0;
}
float maskSlope(float slope, vec4 c) {
  float lo = smoothstep(c.x - c.z, c.x + c.z, slope);
  float hi = smoothstep(c.y + c.z, c.y - c.z, slope);
  float mm = clamp(lo * hi, 0.0, 1.0);
  if (c.w >= 0.5) mm = 1.0 - mm;
  return mm;
}
`;

export const NOISE_STACK_MASKS3D_GLSL = /* glsl */ `
float maskNoise3(vec3 pw, vec4 b) {
  float n = vnoise3(pw * b.x + vec3(53.2, 11.7, 31.3));
  float mm = smoothstep(b.y - b.z, b.y + b.z, n);
  if (b.w >= 0.5) mm = 1.0 - mm;
  return mm;
}
`;

/** GLSL expression (string) for this layer's mask product, or '1.0' if none. */
export function evalMaskGlsl(layer, slot, is3d, slopeExpr = '0.0') {
  const masks = (layer.masks || []).filter((m) => m.enabled !== false);
  if (masks.length === 0) return '1.0';
  const parts = [];
  if (masks.some((m) => m.type === 'height')) parts.push(`maskHeight(h, uLayerMaskA[${slot}])`);
  if (masks.some((m) => m.type === 'noise')) {
    parts.push(is3d ? `maskNoise3(pw, uLayerMaskB[${slot}])` : `maskNoise2(pw, uLayerMaskB[${slot}])`);
  }
  if (!is3d && masks.some((m) => m.type === 'slope')) parts.push(`maskSlope(${slopeExpr}, uLayerMaskC[${slot}])`);
  return parts.length ? `clamp(${parts.join(' * ')}, 0.0, 1.0)` : '1.0';
}

/** CPU mask value (Phase 1: height mask only). `state.h` is accumulated height. */
export function evalMaskJs(layer, state) {
  const masks = (layer.masks || []).filter((m) => m.enabled !== false);
  if (masks.length === 0) return 1;
  let m = 1;
  const hm = masks.find((x) => x.type === 'height');
  if (hm) {
    const { min = 0, max = 1.35, falloff = 0.06 } = hm.params;
    const lo = smooth(min - falloff, min + falloff, state.h);
    const hi = smooth(max + falloff, max - falloff, state.h);
    let mm = clamp01(lo * hi);
    if (hm.invert) mm = 1 - mm;
    m *= mm;
  }
  const sm = masks.find((x) => x.type === 'slope');
  if (sm && Number.isFinite(state.slope)) {
    const { min = 0, max = 1, falloff = 0.1 } = sm.params;
    const lo = smooth(min - falloff, min + falloff, state.slope);
    const hi = smooth(max + falloff, max - falloff, state.slope);
    let mm = clamp01(lo * hi);
    if (sm.invert) mm = 1 - mm;
    m *= mm;
  }
  return m;
}

function smooth(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
