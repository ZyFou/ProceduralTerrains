// ============================================================================
// Characterization tests for the Noise Stack data model.
//
// These pin the *compatibility contract* that every future refactor must keep:
//  - old / missing / malformed saves migrate to a stack that renders as before
//  - the default project is exactly one Classic Terrain layer (legacy fast path)
//  - structuralSignature only changes when the compiled GLSL would change
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  NOISE_STACK_VERSION, MAX_LAYERS, BLEND_MODES,
  makeLayer, makeStack, cloneStack,
  addLayer, removeLayer, updateLayerParam, moveLayer, duplicateLayer,
  structuralSignature, isLegacyStack, activeLayers,
  migrateStack, defaultLegacyStack,
} from '../src/engine/terrain/noise/NoiseStack.js';
import { generateStackGLSL, packStackUniforms, evalStack2D } from '../src/engine/terrain/noise/noiseStackCodegen.js';
import { COMMON_UNIFORMS_GLSL, buildHeightGLSL } from '../src/engine/terrain/terrainGLSL.js';
import { buildPlanetHeightGLSL } from '../src/engine/terrain/planetGLSL.js';

const TEST_UNIFORMS = {
  uFrequency: { value: 0.01 },
  uSeedOffset: { value: { x: 0, y: 0 } },
  uAmplitude: { value: 1 },
  uHeightScale: { value: 100 },
};

describe('migrateStack (save compatibility)', () => {
  it('synthesizes the default legacy stack for pre-noiseStack saves', () => {
    for (const raw of [undefined, null, 42, 'x', {}, { layers: null }]) {
      const stack = migrateStack(raw);
      expect(stack.version).toBe(NOISE_STACK_VERSION);
      expect(isLegacyStack(stack)).toBe(true);
      expect(stack.layers).toHaveLength(1);
      expect(stack.layers[0].type).toBe('legacy');
      expect(stack.layers[0].blendMode).toBe('replace');
    }
  });

  it('drops unknown layer types but keeps known ones', () => {
    const stack = migrateStack({
      layers: [
        { type: 'not-a-real-noise' },
        { type: 'fbm', id: 'keep-me' },
      ],
    });
    expect(stack.layers).toHaveLength(1);
    expect(stack.layers[0].type).toBe('fbm');
    expect(stack.layers[0].id).toBe('keep-me');
  });

  it('falls back to the legacy stack when every layer is unknown', () => {
    const stack = migrateStack({ layers: [{ type: 'nope' }] });
    expect(isLegacyStack(stack)).toBe(true);
  });

  it('fills missing layer params from current type defaults', () => {
    const fresh = makeLayer('fbm');
    const migrated = migrateStack({ layers: [{ type: 'fbm' }] });
    expect(Object.keys(migrated.layers[0].params).sort())
      .toEqual(Object.keys(fresh.params).sort());
    expect(migrated.layers[0].params.erosion).toBe(0);
    expect(migrated.layers[0].params.warp).toBe(0);
  });

  it('fills new Domain Warp octaves with the current legacy default', () => {
    const migrated = migrateStack({ layers: [{ type: 'domainWarp' }] });
    expect(migrated.layers[0].params.octaves).toBe(4);
  });

  it('preserves explicitly saved param values over defaults', () => {
    const fresh = makeLayer('fbm');
    const key = Object.keys(fresh.params)[0];
    const saved = { layers: [{ type: 'fbm', params: { [key]: 12345 } }] };
    expect(migrateStack(saved).layers[0].params[key]).toBe(12345);
  });

  it('preserves stack-level fields (globalSeed, output range)', () => {
    const stack = migrateStack({
      globalSeed: 7, normalizeOutput: true, outputMin: -1, outputMax: 2,
      layers: [{ type: 'fbm' }],
    });
    expect(stack.globalSeed).toBe(7);
    expect(stack.normalizeOutput).toBe(true);
    expect(stack.outputMin).toBe(-1);
    expect(stack.outputMax).toBe(2);
  });

  it('fills missing stack output fields with legacy-compatible defaults', () => {
    const stack = migrateStack({ layers: [{ type: 'fbm' }] });
    expect(stack.normalizeOutput).toBe(false);
    expect(stack.outputMin).toBe(0);
    expect(stack.outputMax).toBe(1.35);
  });
});

describe('default stack / legacy fast path', () => {
  it('defaultLegacyStack is detected as legacy (f32-exact CPU path)', () => {
    expect(isLegacyStack(defaultLegacyStack())).toBe(true);
  });

  it('adding any layer leaves the legacy fast path', () => {
    const stack = addLayer(defaultLegacyStack(), 'fbm');
    expect(isLegacyStack(stack)).toBe(false);
  });

  it('missing/invalid stacks count as legacy (defensive default)', () => {
    expect(isLegacyStack(null)).toBe(true);
    expect(isLegacyStack({})).toBe(true);
  });
});

describe('structuralSignature (shader recompile key)', () => {
  const base = () => addLayer(defaultLegacyStack(), 'fbm');

  it('is deterministic for a cloned stack', () => {
    const stack = base();
    expect(structuralSignature(cloneStack(stack))).toBe(structuralSignature(stack));
  });

  it('ignores continuous params (strength) — uniforms only, no recompile', () => {
    const stack = base();
    const tweaked = {
      ...stack,
      layers: stack.layers.map((l) => ({ ...l, strength: 0.123 })),
    };
    expect(structuralSignature(tweaked)).toBe(structuralSignature(stack));
  });

  it('ignores eroded-fractal params — uniforms only, no recompile', () => {
    const stack = base();
    const tweaked = {
      ...stack,
      layers: stack.layers.map((l) => (l.type === 'fbm'
        ? { ...l, params: { ...l.params, erosion: 0.6, warp: 0.8 } }
        : l)),
    };
    expect(structuralSignature(tweaked)).toBe(structuralSignature(stack));
  });

  it('ignores output normalization fields (uniforms only, no recompile)', () => {
    const stack = base();
    const tweaked = {
      ...stack,
      normalizeOutput: !stack.normalizeOutput,
      outputMin: -0.25,
      outputMax: 1.8,
    };
    expect(structuralSignature(tweaked)).toBe(structuralSignature(stack));
  });

  it('changes when a slope mask is added', () => {
    const stack = base();
    const withSlope = {
      ...stack,
      layers: stack.layers.map((l, i) => (i === 1
        ? { ...l, masks: [{ type: 'slope', enabled: true, invert: false, params: { min: 0, max: 1, falloff: 0.1 } }] }
        : l)),
    };
    expect(structuralSignature(withSlope)).not.toBe(structuralSignature(stack));
  });

  it('changes when Domain Warp octaves change', () => {
    const warp = makeLayer('domainWarp');
    const detail = makeLayer('fbm');
    const stack = makeStack([warp, detail]);
    const changed = {
      ...stack,
      layers: stack.layers.map((l, i) => (i === 0 ? { ...l, params: { ...l.params, octaves: 6 } } : l)),
    };
    expect(structuralSignature(changed)).not.toBe(structuralSignature(stack));
  });

  it('changes when a layer is disabled', () => {
    const stack = base();
    const disabled = {
      ...stack,
      layers: stack.layers.map((l, i) => (i === 1 ? { ...l, enabled: false } : l)),
    };
    expect(structuralSignature(disabled)).not.toBe(structuralSignature(stack));
  });

  it('changes when a blend mode changes', () => {
    const stack = base();
    const other = BLEND_MODES.find((m) => m !== stack.layers[1].blendMode);
    const changed = {
      ...stack,
      layers: stack.layers.map((l, i) => (i === 1 ? { ...l, blendMode: other } : l)),
    };
    expect(structuralSignature(changed)).not.toBe(structuralSignature(stack));
  });
});

describe('stack mutations (immutable updates)', () => {
  it('addLayer never exceeds MAX_LAYERS', () => {
    let stack = defaultLegacyStack();
    for (let i = 0; i < MAX_LAYERS + 3; i++) stack = addLayer(stack, 'fbm');
    expect(stack.layers.length).toBeLessThanOrEqual(MAX_LAYERS);
  });

  it('addLayer auto-numbers duplicate names', () => {
    let stack = addLayer(defaultLegacyStack(), 'fbm');
    stack = addLayer(stack, 'fbm');
    const names = stack.layers.filter((l) => l.type === 'fbm').map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('mutation helpers return new objects and leave the input untouched', () => {
    const stack = addLayer(defaultLegacyStack(), 'fbm');
    const snapshot = JSON.stringify(stack);
    const id = stack.layers[1].id;
    removeLayer(stack, id);
    updateLayerParam(stack, id, 'anything', 999);
    duplicateLayer(stack, id);
    moveLayer(stack, 1, 0);
    expect(JSON.stringify(stack)).toBe(snapshot);
  });

  it('moveLayer clamps out-of-range targets and ignores bad sources', () => {
    const stack = addLayer(addLayer(defaultLegacyStack(), 'fbm'), 'ridged');
    // clamp happens before removal, so moving the last layer past the end is a no-op
    const moved = moveLayer(stack, 2, 99);
    expect(moved.layers.map((l) => l.type)).toEqual(['legacy', 'fbm', 'ridged']);
    expect(moveLayer(stack, 99, 0)).toBe(stack);
  });

  it('activeLayers skips disabled layers and assigns dense slots', () => {
    let stack = addLayer(addLayer(defaultLegacyStack(), 'fbm'), 'ridged');
    stack = {
      ...stack,
      layers: stack.layers.map((l, i) => (i === 1 ? { ...l, enabled: false } : l)),
    };
    const active = activeLayers(stack);
    expect(active.map((a) => a.layer.type)).toEqual(['legacy', 'ridged']);
    expect(active.map((a) => a.slot)).toEqual([0, 1]);
  });
});

describe('stack output finalization shader contract', () => {
  it('declares output normalization uniforms and helper in the shared include', () => {
    expect(COMMON_UNIFORMS_GLSL).toContain('uniform float uStackNormalize');
    expect(COMMON_UNIFORMS_GLSL).toContain('uniform float uStackOutMin');
    expect(COMMON_UNIFORMS_GLSL).toContain('uniform float uStackOutMax');
    expect(COMMON_UNIFORMS_GLSL).toContain('float finalizeStackHeight(float h)');
  });

  it('uses the shared output finalizer for terrain and planet height', () => {
    const stack2d = 'float stackHeight2D(vec2 xz) { return 0.0; }';
    const stack3d = 'float stackHeight3D(vec3 dir) { return 0.0; }';
    expect(buildHeightGLSL(stack2d)).toContain('finalizeStackHeight(h) * uHeightScale');
    expect(buildPlanetHeightGLSL(stack3d)).toContain('finalizeStackHeight(h) * uHeightScale');
  });
});

describe('slope masks and domain warp codegen', () => {
  it('keeps no-slope stacks on the single-track 2D shader body', () => {
    const stack = makeStack([makeLayer('fbm')]);
    const glsl = generateStackGLSL(stack);
    expect(glsl.body2d).not.toContain('hDX');
    expect(glsl.body2d).not.toContain('uLayerMaskC');
  });

  it('emits the 2D tri-track path only when a slope mask is enabled', () => {
    const layer = makeLayer('fbm', {
      masks: [{ type: 'slope', enabled: true, invert: false, params: { min: 0.2, max: 1.2, falloff: 0.1 } }],
    });
    const glsl = generateStackGLSL(makeStack([layer]));
    expect(glsl.body2d).toContain('stackSlope(h, hDX, hDZ)');
    expect(glsl.body2d).toContain('uLayerMaskC[0]');
    expect(glsl.body3d).not.toContain('uLayerMaskC');
  });

  it('packs slope mask params into mask C', () => {
    const layer = makeLayer('fbm', {
      masks: [{ type: 'slope', enabled: true, invert: true, params: { min: 0.2, max: 1.4, falloff: 0.25 } }],
    });
    const packed = packStackUniforms(makeStack([layer]));
    expect(packed.maskC[0]).toEqual([0.2, 1.4, 0.25, 1]);
  });

  it('applies slope masks in the CPU evaluator', () => {
    const base = makeLayer('constant', { blendMode: 'replace', params: { value: 0.5 } });
    const masked = makeLayer('constant', {
      blendMode: 'add',
      params: { value: 1 },
      masks: [{ type: 'slope', enabled: true, invert: false, params: { min: 0.1, max: 3, falloff: 0.001 } }],
    });
    const inverted = { ...masked, masks: [{ ...masked.masks[0], invert: true }] };
    expect(evalStack2D(makeStack([base, masked]), 0, 0, { uniforms: TEST_UNIFORMS })).toBeCloseTo(0.5, 8);
    expect(evalStack2D(makeStack([base, inverted]), 0, 0, { uniforms: TEST_UNIFORMS })).toBeCloseTo(1.5, 8);
  });

  it('bakes Domain Warp octaves as literal loop bounds', () => {
    const warp = makeLayer('domainWarp', { params: { scale: 1, octaves: 6 } });
    const detail = makeLayer('fbm');
    const glsl = generateStackGLSL(makeStack([warp, detail]));
    expect(glsl.body2d).toContain('for (int i = 0; i < 6; i++)');
  });
});
