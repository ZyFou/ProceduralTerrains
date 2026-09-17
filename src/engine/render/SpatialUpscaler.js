/** Original, single-frame reconstruction experiment; not FSR or temporal AI. */
export const SPATIAL_UPSCALER_DEFAULTS = Object.freeze({
  spatialUpscaler: 'off',
  spatialUpscaleSharpness: 0.35,
});

export function normalizeSpatialUpscaler(settings = {}) {
  const raw = settings.spatialUpscaleSharpness;
  const sharpness = raw == null || raw === '' ? NaN : Number(raw);
  return {
    spatialUpscaler: ['off', 'linear', 'sharp'].includes(settings.spatialUpscaler)
      ? settings.spatialUpscaler : 'off',
    spatialUpscaleSharpness: Number.isFinite(sharpness)
      ? Math.min(1, Math.max(0, sharpness)) : SPATIAL_UPSCALER_DEFAULTS.spatialUpscaleSharpness,
  };
}

/** One source of truth for compile-time defines AND presentation uniforms. */
export function resolveCameraReconstruction(plan = {}, params = {}, perf = {}) {
  const dimensions = [plan.sceneWidth, plan.sceneHeight, plan.outputWidth, plan.outputHeight];
  const valid = dimensions.every((n) => Number.isFinite(n) && n > 0);
  const native = valid && plan.sceneWidth === plan.outputWidth && plan.sceneHeight === plan.outputHeight;
  const upscale = valid && plan.sceneWidth <= plan.outputWidth && plan.sceneHeight <= plan.outputHeight
    && !native;
  const settings = normalizeSpatialUpscaler(perf);
  let mode = 0;
  let label = native ? 'native' : 'linear';
  if (valid && params.visualsPixelatedEnabled) { mode = 2; label = 'pixelated-artistic'; }
  else if (upscale && perf.resolutionDenoiseMode === 'pixelated') { mode = 2; label = 'pixelated'; }
  else if (upscale && settings.spatialUpscaler === 'sharp') { mode = 3; label = 'spatial-sharp'; }
  else if (upscale && settings.spatialUpscaler !== 'linear') { mode = 1; label = 'clean'; }
  return {
    mode, label, upscale,
    sharpness: settings.spatialUpscaleSharpness,
    defines: {
      USE_PIXELATED: mode === 2 ? 1 : 0,
      USE_CLEAN_RECONSTRUCTION: mode === 1 ? 1 : 0,
      USE_SPATIAL_RECONSTRUCTION: mode === 3 ? 1 : 0,
    },
  };
}

// Five bilinear samples with contrast-adaptive, neighbourhood-clamped detail
// recovery. Fused into the existing final camera pass: no extra RT, history,
// motion vectors, jitter, depth dependency, or change of colour-space pipeline.
// This cannot reconstruct information absent from the low-resolution source.
export const SPATIAL_UPSCALE_GLSL = /* glsl */ `
#if USE_SPATIAL_RECONSTRUCTION
vec3 spatialTexel(vec2 uv) {
  vec2 halfTexel = 0.5 / max(uSourceSize, vec2(1.0));
  return texture2D(tDiffuse, clamp(uv, halfTexel, vec2(1.0) - halfTexel)).rgb;
}

vec3 sampleSpatial(vec2 uv) {
  vec2 px = 1.0 / max(uSourceSize, vec2(1.0));
  vec3 c = spatialTexel(uv);
  vec3 n = spatialTexel(uv + vec2(0.0, px.y));
  vec3 s = spatialTexel(uv - vec2(0.0, px.y));
  vec3 e = spatialTexel(uv + vec2(px.x, 0.0));
  vec3 w = spatialTexel(uv - vec2(px.x, 0.0));
  vec3 lo = min(c, min(min(n, s), min(e, w)));
  vec3 hi = max(c, max(max(n, s), max(e, w)));
  float contrast = luma(hi - lo) / max(0.05 + luma(hi), 0.05);
  float gain = clamp(uSpatialSharpness, 0.0, 1.0) * 0.25 / (1.0 + contrast * 4.0);
  return clamp(c + (4.0 * c - n - s - e - w) * gain, lo, hi);
}
#endif
`;
