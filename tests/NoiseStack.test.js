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
