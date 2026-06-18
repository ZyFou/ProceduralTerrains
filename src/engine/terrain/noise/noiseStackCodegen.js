// ============================================================================
// Noise Stack codegen — turns a NoiseStack into:
//   - generateStackGLSL(stack) -> { sig, body2d, body3d }
//        the GLSL body of stackHeight2D(vec2 xz, Climate c) /
//        stackHeight3D(vec3 dir), inlined per layer with constant loop bounds.
//   - evalStack2D / evalStack3D : the f64 CPU twin used by player physics on
//        custom stacks.
//
// Continuous per-layer params flow through the shared uLayer* uniform arrays
// (declared in COMMON_UNIFORMS_GLSL). Structural params (octaves / enum modes)
// are baked as literals by the type templates, so a structural change alters
// `sig` and forces a shader recompile; continuous edits are pure uniform writes.
// ============================================================================

import { activeLayers, structuralSignature, MAX_LAYERS } from './NoiseStack.js';
import { getNoiseType } from './noiseTypes.js';
import { blendGlslStmt, blendJs } from './blendModes.js';
import { evalMaskGlsl, evalMaskJs } from './masks.js';

// GLSL declarations shared by every material (folded into COMMON_UNIFORMS_GLSL).
export const NOISE_STACK_UNIFORMS_GLSL = /* glsl */ `
#define MAX_NOISE_LAYERS ${MAX_LAYERS}
uniform float uLayerStrength[MAX_NOISE_LAYERS]; // strength * opacity (and solo gate)
uniform float uLayerScale[MAX_NOISE_LAYERS];    // primary frequency lane
uniform float uLayerSeed[MAX_NOISE_LAYERS];     // per-layer domain decorrelation
uniform vec4  uLayerParamsA[MAX_NOISE_LAYERS];  // type-specific continuous lanes
uniform vec4  uLayerParamsB[MAX_NOISE_LAYERS];
uniform vec4  uLayerMaskA[MAX_NOISE_LAYERS];     // mask params (height min/max/falloff, flags)
uniform vec4  uLayerMaskB[MAX_NOISE_LAYERS];     // mask params (noise scale/threshold/soft, flags)
uniform float uNoiseDebug;                       // debug view selector (0 = off)
`;

function layerBlock(layer, slot, is3d) {
  const def = getNoiseType(layer.type);
  if (!def) return '';
  const isMod = def.category === 'modifier';
  const L = [];
  L.push(`  { // ${slot}: ${layer.type} (${layer.name.replace(/[\n*/]/g, ' ')})`);
  L.push(`    float scale = uLayerScale[${slot}];`);
  L.push(`    float eff = uLayerStrength[${slot}];`);
  L.push(`    vec4 pa = uLayerParamsA[${slot}];`);
  L.push(`    vec4 pb = uLayerParamsB[${slot}];`);
  L.push(`    float seed = uLayerSeed[${slot}];`);
  L.push(`    float m = ${evalMaskGlsl(layer, slot, is3d)};`);
  if (isMod) {
    L.push('    ' + (is3d ? def.mod3d(layer) : def.mod2d(layer)));
  } else {
    if (is3d) L.push('    vec3 P = pw * scale + vec3(seed, seed * 1.7 + 3.1, seed * 0.7 - 2.3);');
    else L.push('    vec2 P = pw * scale + vec2(seed, seed * 1.7 + 3.1);');
    L.push('    float val = 0.0;');
    L.push('    ' + (is3d ? def.body3d(layer) : def.body2d(layer)));
    L.push('    ' + blendGlslStmt(layer.blendMode, 'h', '(val * eff * m)'));
  }
  L.push('  }');
  return L.join('\n');
}

export function generateStackGLSL(stack) {
  const layers = activeLayers(stack);
  const body2d = layers.map(({ layer, slot }) => layerBlock(layer, slot, false)).join('\n');
  const body3d = layers.map(({ layer, slot }) => layerBlock(layer, slot, true)).join('\n');
  return { sig: structuralSignature(stack), body2d, body3d };
}

// ----------------------------------------------------------- uniform packing
// Build the per-layer uniform payload from a stack. Engine writes these into the
// shared uniform arrays each param change. `solo` (a layer id or null) gates all
// other layers to zero strength for solo-preview without a recompile.

export function packStackUniforms(stack, { solo = null } = {}) {
  const strength = new Array(MAX_LAYERS).fill(0);
  const scale = new Array(MAX_LAYERS).fill(1);
  const seed = new Array(MAX_LAYERS).fill(0);
  const paramsA = []; const paramsB = [];
  const maskA = []; const maskB = [];
  for (let i = 0; i < MAX_LAYERS; i++) {
    paramsA.push([0, 0, 0, 0]); paramsB.push([0, 0, 0, 0]);
    maskA.push([0, 0, 0, 0]); maskB.push([0, 0, 0, 0]);
  }
  for (const { layer, slot } of activeLayers(stack)) {
    const def = getNoiseType(layer.type);
    const soloActive = solo && solo !== layer.id;
    strength[slot] = (layer.strength ?? 1) * (layer.opacity ?? 1) * (soloActive ? 0 : 1);
    scale[slot] = def.scaleKey ? (layer.params[def.scaleKey] ?? 1) : 1;
    seed[slot] = (layer.seedOffset || 0) * 31.7;
    const pa = paramsA[slot]; const pb = paramsB[slot];
    (def.paKeys || []).forEach((k, j) => { if (k) pa[j] = layer.params[k] ?? 0; });
    (def.pbKeys || []).forEach((k, j) => { if (k) pb[j] = layer.params[k] ?? 0; });
    packMaskUniforms(layer, maskA[slot], maskB[slot]);
  }
  return { strength, scale, seed, paramsA, paramsB, maskA, maskB };
}

function packMaskUniforms(layer, a, b) {
  // First height mask -> A, first noise mask -> B (Phase-1 chain). Flags in .w.
  const masks = layer.masks || [];
  const hm = masks.find((m) => m.type === 'height' && m.enabled !== false);
  const nm = masks.find((m) => m.type === 'noise' && m.enabled !== false);
  const sm = masks.find((m) => m.type === 'slope' && m.enabled !== false);
  if (hm) { a[0] = hm.params.min ?? 0; a[1] = hm.params.max ?? 1; a[2] = hm.params.falloff ?? 0.05; a[3] = (hm.invert ? 1 : 0) + (sm ? 2 : 0); }
  else if (sm) { a[3] = 2; }
  if (sm) { /* slope params packed into A unused lanes is messy; keep slope simple via flag only for Phase 1 */ }
  if (nm) { b[0] = nm.params.scale ?? 1; b[1] = nm.params.threshold ?? 0.5; b[2] = nm.params.softness ?? 0.1; b[3] = nm.invert ? 1 : 0; }
}

// ------------------------------------------------------------- CPU evaluator
// `ctx` supplies legacy delegates + climate/biome lookups for masks.

export function evalStack2D(stack, x, z, ctx) {
  const u = ctx.uniforms;
  const freq = u.uFrequency.value;
  const sx = u.uSeedOffset.value.x, sz = u.uSeedOffset.value.y;
  const state = { px: x * freq + sx, pz: z * freq + sz };
  let h = 0;
  for (const { layer } of activeLayers(stack)) {
    const def = getNoiseType(layer.type);
    const eff = (layer.strength ?? 1) * (layer.opacity ?? 1);
    if (def.category === 'modifier') {
      if (def.modJs2) def.modJs2(state, layer, eff);
      else if (def.modHeightJs) { h = def.modHeightJs(h, layer, eff, 1); }
      continue;
    }
    const seedV = (layer.seedOffset || 0) * 31.7;
    const sc = def.scaleKey ? (layer.params[def.scaleKey] ?? 1) : 1;
    const P0 = state.px * sc + seedV;
    const P1 = state.pz * sc + seedV * 1.7 + 3.1;
    let val = def.eval2d ? def.eval2d(P0, P1, layer, ctx) : 0;
    if (layer.type === 'legacy') val = def.eval2d(x, z, layer, ctx); // legacy works in world space
    const m = evalMaskJs(layer, { h, ctx });
    h = blendJs(layer.blendMode, h, val * eff * m);
  }
  // Apply global amplitude (Noise Strength) as a master multiplier
  return h * (u.uAmplitude?.value ?? 1);
}

export function evalStack3D(stack, dx, dy, dz, ctx) {
  const u = ctx.uniforms;
  const s = u.uPlanetRadius.value * u.uFrequency.value;
  const sx = u.uSeedOffset.value.x, sy = u.uSeedOffset.value.y;
  const state = { px: dx * s + sx, py: dy * s + sy, pz: dz * s + (sy - sx) };
  let h = 0;
  for (const { layer } of activeLayers(stack)) {
    const def = getNoiseType(layer.type);
    const eff = (layer.strength ?? 1) * (layer.opacity ?? 1);
    if (def.category === 'modifier') {
      if (def.modJs3) def.modJs3(state, layer, eff);
      else if (def.modHeightJs) { h = def.modHeightJs(h, layer, eff, 1); }
      continue;
    }
    const seedV = (layer.seedOffset || 0) * 31.7;
    const sc = def.scaleKey ? (layer.params[def.scaleKey] ?? 1) : 1;
    let val;
    if (layer.type === 'legacy') val = def.eval3d(dx, dy, dz, layer, ctx);
    else val = def.eval3d
      ? def.eval3d(state.px * sc + seedV, state.py * sc + seedV * 1.7 + 3.1, state.pz * sc + seedV * 0.7 - 2.3, layer, ctx)
      : 0;
    const m = evalMaskJs(layer, { h, ctx });
    h = blendJs(layer.blendMode, h, val * eff * m);
  }
  // Apply global amplitude (Noise Strength) as a master multiplier
  return h * (u.uAmplitude?.value ?? 1);
}
