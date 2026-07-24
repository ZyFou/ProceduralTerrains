import { afterEach, describe, expect, it } from 'vitest';
import {
  createBootTerrainMaterial,
  createInfiniteTerrainMaterial,
  createTerrainMaterial,
  createTerrainUniforms,
} from '../src/engine/terrain/TerrainMaterial.js';
import { compileTerrainGraph } from '../src/engine/terrain/graph/GraphCompiler.js';
import { createBlankGraph } from '../src/engine/terrain/graph/GraphDocument.js';

const materials = [];

afterEach(() => {
  for (const material of materials.splice(0)) material.dispose();
});

describe('shared Tile and Infinite terrain program', () => {
  it('builds byte-identical full shader programs for both modes', () => {
    const uniforms = createTerrainUniforms();
    const tile = createTerrainMaterial(uniforms, 7);
    const infinite = createInfiniteTerrainMaterial(uniforms, 7);
    materials.push(tile, infinite);

    expect(infinite).not.toBe(tile);
    expect(infinite.uniforms).toBe(tile.uniforms);
    expect(infinite.defines).toEqual(tile.defines);
    expect(infinite.vertexShader).toBe(tile.vertexShader);
    expect(infinite.fragmentShader).toBe(tile.fragmentShader);
    expect(infinite.userData.minimalFragment).not.toBe(true);
    expect(infinite.defines.INFINITE_MODE).toBeUndefined();
    expect(infinite.vertexShader).toContain('#ifdef USE_INSTANCING');
    expect(infinite.vertexShader).toContain('instanceMatrix * localPosition');
  });

  it('uses one runtime mode uniform instead of preprocessor variants', () => {
    const uniforms = createTerrainUniforms();
    const tile = createTerrainMaterial(uniforms, 5);
    const infinite = createInfiniteTerrainMaterial(uniforms, 5);
    materials.push(tile, infinite);

    expect(uniforms.uInfiniteMode.value).toBe(0);
    expect(tile.vertexShader).toContain('uInfiniteMode');
    expect(tile.fragmentShader).toContain('uInfiniteMode');
    expect(tile.vertexShader).not.toContain('INFINITE_MODE');
    expect(tile.fragmentShader).not.toContain('INFINITE_MODE');
  });

  it('keeps the minimal material Tile-only even if legacy callers pass an Infinite option', () => {
    const uniforms = createTerrainUniforms();
    const boot = createBootTerrainMaterial(uniforms, 6, undefined, { infinite: true });
    materials.push(boot);

    expect(boot.userData.minimalFragment).toBe(true);
    expect(boot.defines).toEqual({ OCTAVES: 6 });
    expect(boot.defines.INFINITE_MODE).toBeUndefined();
  });

  it('keeps a no-op terrain color function when a height-only graph has no color shader', () => {
    const uniforms = createTerrainUniforms();
    const heightOnlyGraph = compileTerrainGraph(createBlankGraph('terrain')).program;
    const boot = createBootTerrainMaterial(uniforms, 6, heightOnlyGraph);
    materials.push(boot);

    expect(heightOnlyGraph.colorBody).toBe('');
    expect(boot.fragmentShader).toContain('vec3 applyTerrainGraphColor');
    expect(boot.fragmentShader).toContain('return fallback;');
  });
});
