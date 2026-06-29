// ============================================================================
// GpuTier: classify the user's GPU into low | medium | high from the WebGL
// renderer string and a couple of capability probes. Used once on first run to
// pick a sensible starting performance preset for weak hardware — never to
// override a returning user's saved settings.
//
// Heuristics are deliberately conservative: when unsure we return 'medium' so
// we neither cripple a capable machine nor overwhelm a weak one.
// ============================================================================

const STORAGE_KEY = 'terrain-studio-gpu-tier-v1';

// Substrings (lowercased) that strongly indicate a weak / software renderer.
const LOW_HINTS = [
  'swiftshader', 'llvmpipe', 'software', 'basic render',  // CPU fallbacks
  'microsoft basic', 'gdi generic',
  'mali', 'adreno 3', 'adreno 4', 'adreno 5',             // older mobile
  'powervr', 'videocore', 'tegra',
  'intel hd graphics', 'intel(r) hd graphics',            // older Intel iGPUs
  'uhd graphics 6',                                        // entry UHD 6xx
];

// Substrings that indicate a clearly HIGH-END, modern GPU. Kept deliberately
// narrow: a generic "geforce gtx" match used to bucket a weak GTX 1050 into the
// same 'high' preset as an RTX 4090, which left low-end discrete cards running
// the heaviest LOD/cloud/bake settings. Anything not matched here falls through
// to 'medium' (Balanced) — a safer starting point that the user can raise.
const HIGH_HINTS = [
  'rtx', 'quadro rtx', 'titan',                            // NVIDIA high-end
  'radeon pro', 'rx 6', 'rx 7', 'rx 9',                    // AMD RDNA2/3+
  'arc a', 'arc b', 'intel arc',                           // Intel Arc discrete
  'apple m1', 'apple m2', 'apple m3', 'apple m4',         // Apple Silicon
];

/**
 * Raw renderer string from the WebGL context (unmasked when available).
 * @param {WebGLRenderingContext|WebGL2RenderingContext} gl
 * @returns {string}
 */
export function readRendererString(gl) {
  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) return String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
    return String(gl.getParameter(gl.RENDERER) || '');
  } catch {
    return '';
  }
}

/**
 * Classify the GPU into a tier.
 * @param {WebGLRenderingContext|WebGL2RenderingContext} gl
 * @returns {'low'|'medium'|'high'}
 */
export function detectGpuTier(gl) {
  if (!gl) return 'medium';
  const r = readRendererString(gl).toLowerCase();

  // Capability tiebreakers: tiny texture limits / no high-precision floats in
  // the fragment shader are a strong "weak GPU" signal regardless of name.
  let maxTex = 4096;
  try { maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096; } catch { /* ignore */ }
  let highpOk = true;
  try {
    const fmt = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    highpOk = !!fmt && fmt.precision > 0;
  } catch { /* ignore */ }

  if (r && LOW_HINTS.some((h) => r.includes(h))) return 'low';
  if (!highpOk || maxTex < 8192) return 'low';
  if (r && HIGH_HINTS.some((h) => r.includes(h))) return 'high';
  return 'medium';
}

/** Map a detected GPU tier to a starting performance preset key. */
export function presetForTier(tier) {
  if (tier === 'low') return 'performance';
  if (tier === 'high') return 'high';
  return 'balanced';
}

export function loadStoredGpuTier() {
  try { return localStorage.getItem(STORAGE_KEY) || null; } catch { return null; }
}

export function saveGpuTier(tier) {
  try { localStorage.setItem(STORAGE_KEY, tier); } catch { /* non-fatal */ }
}
