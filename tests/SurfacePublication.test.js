import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../src/engine/Engine.js';
import { createTerrainMaterial, createTerrainUniforms } from '../src/engine/terrain/TerrainMaterial.js';
import { generateStackGLSL } from '../src/engine/terrain/noise/noiseStackCodegen.js';
import { defaultLegacyStack } from '../src/engine/terrain/noise/NoiseStack.js';

function harness() {
  const engine = Object.create(Engine.prototype);
  const uniforms = createTerrainUniforms();
  const program = generateStackGLSL(defaultLegacyStack());
  let finish;
  Object.assign(engine, {
    uniforms, worldMode: 'studio', params: { octaves: 7, surfaceTextureSource: 'pbrLibrary' },
    terrainMaterial: createTerrainMaterial(uniforms, 7, program, { variant: 'base' }),
    _activeHeightProgram: () => program,
    _targetTerrainVariant: () => 'full',
    _surfaceBuildKey: () => 'current',
    _resolveCameraCompileTarget: () => ({ renderTarget: null }),
    _sameCameraCompileTarget: () => true,
    _bgWorkStart: vi.fn(), _bgWorkEnd: vi.fn(),
    _scheduleTerrainVariantRetry: vi.fn(),
    _queueWarmMaterials: vi.fn(),
    _compileMaterialVariants: vi.fn(() => new Promise((resolve) => { finish = resolve; })),
  });
  const atlas = {
    backend: 'array', source: 'pbrLibrary', budget: { contributions: 4 },
    diffuse: { dispose: vi.fn() }, props: { dispose: vi.fn() },
    mapping: [], tints: [], sizes: [], present: [], tile: [],
  };
  return { engine, atlas, finish: (result = { ready: true }) => finish(result) };
}

describe('atomic surface publication', () => {
  it('keeps the visible shader and samplers unchanged while PBR compiles', async () => {
    const { engine, atlas, finish } = harness();
    const live = engine.terrainMaterial;
    const before = { source: live.fragmentShader, version: live.version, texture: engine.uniforms.uSurfDiffuse.value };
    const task = engine.setSurfaceAtlas(atlas);
    const warm = engine._compileMaterialVariants.mock.calls[0][0][0];
    expect(warm.uniforms.uSurfaceArrayMode.value).toBe(1);
    expect(warm.defines.SURFACE_ARRAYS).toBe(1);
    expect(engine.uniforms.uSurfaceArrayMode.value).toBe(0);
    live.onBeforeRender();
    expect(live.version).toBe(before.version);
    expect(live.fragmentShader).toBe(before.source);
    expect(engine.uniforms.uSurfDiffuse.value).toBe(before.texture);
    finish();
    await task;
    expect(engine.uniforms.uSurfDiffuse.value).toBe(atlas.diffuse);
    expect(live.fragmentShader).toBe(warm.fragmentShader);
    expect(live.defines).toEqual(warm.defines);
    const publishedVersion = live.version;
    live.onBeforeRender();
    expect(live.version).toBe(publishedVersion);
  });

  it('leaves the old atlas alive and installed when shader preparation fails', async () => {
    const { engine, atlas, finish } = harness();
    const old = { diffuse: { dispose: vi.fn() }, props: { dispose: vi.fn() } };
    engine._surfaceAtlas = old;
    engine._surfaceAtlasCache = { pbrLibrary: old };
    const task = engine.setSurfaceAtlas(atlas);
    finish({ ready: false });
    await expect(task).rejects.toThrow('did not become ready');
    expect(engine._surfaceAtlas).toBe(old);
    expect(engine._surfaceAtlasCache.pbrLibrary).toBe(old);
    expect(old.diffuse.dispose).not.toHaveBeenCalled();
    expect(engine.uniforms.uSurfaceArrayMode.value).toBe(0);
  });

  it('does not publish a surface after the user switches back to procedural', async () => {
    const { engine, atlas, finish } = harness();
    const task = engine.setSurfaceAtlas(atlas);
    engine.params.surfaceTextureSource = 'procedural';
    finish();
    await expect(task).rejects.toMatchObject({ code: 'SURFACE_ATLAS_SUPERSEDED' });
    expect(engine.uniforms.uSurfaceArrayMode.value).toBe(0);
    expect(engine._surfaceAtlas).toBeUndefined();
  });
});
