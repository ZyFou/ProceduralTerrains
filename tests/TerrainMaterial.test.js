import { afterEach, describe, expect, it } from 'vitest';
import {
  createBootTerrainMaterial,
  createInfiniteTerrainMaterial,
  createTerrainMaterial,
  createTerrainUniforms,
} from '../src/engine/terrain/TerrainMaterial.js';
import { createPlanetMaterial } from '../src/engine/terrain/PlanetMaterial.js';
import { compileTerrainGraph } from '../src/engine/terrain/graph/GraphCompiler.js';
import { createBlankGraph } from '../src/engine/terrain/graph/GraphDocument.js';
import { TerrainHeightBaker } from '../src/engine/terrain/TerrainHeightBaker.js';

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

  it('projects the live cloud mask into both Tile terrain shader variants', () => {
    const uniforms = createTerrainUniforms();
    const full = createTerrainMaterial(uniforms, 5);
    const boot = createBootTerrainMaterial(uniforms, 5);
    materials.push(full, boot);

    expect(uniforms.uTerrainCloudShadowEnabled.value).toBe(0);
    expect(uniforms.uTerrainCloudShadowStrength.value).toBeCloseTo(0.45);
    expect(uniforms.uTerrainCloudShadowTex).toBeUndefined();
    expect(full.fragmentShader).toContain('float terrainCloudShadow(vec3 worldPos)');
    expect(full.fragmentShader).toContain('float terrainCloudFbm(vec3 p)');
    expect(full.fragmentShader).toContain('float cloudShadow = terrainCloudShadow(vWorldPos)');
    expect(boot.fragmentShader).toContain('diff *= 1.0 - terrainCloudShadow(vWorldPos)');
  });

  it('keeps terrain caustics clear of the water surface with a smooth falloff', () => {
    const uniforms = createTerrainUniforms();
    const material = createTerrainMaterial(uniforms, 5);
    materials.push(material);

    expect(uniforms.uCausticMinDepth.value).toBe(1);
    expect(uniforms.uCausticMinDepthFalloff.value).toBe(1);
    expect(material.fragmentShader).toContain(
      'uCausticMinDepth + max(uCausticMinDepthFalloff, 0.001)',
    );
    expect(material.fragmentShader).toContain(
      'depthFade = depthFade * depthFade * minDepthMask',
    );
  });

  it('keeps terrain-coloured skirts on multi-cell LOD boundaries', () => {
    const uniforms = createTerrainUniforms();
    const full = createTerrainMaterial(uniforms, 5);
    const boot = createBootTerrainMaterial(uniforms, 5);
    materials.push(full, boot);

    expect(full.vertexShader).toContain('skirt = aSkirt;');
    expect(full.vertexShader).not.toContain(
      'aSkirt * (1.0 - interiorSeam)',
    );
    for (const material of [full, boot]) {
      expect(material.fragmentShader).toContain(
        'uInfiniteMode < 0.5 && uUseTiles > 0.5',
      );
      expect(material.fragmentShader).toContain('skirtDarken = 0.0');
    }
  });

  it('shares an optional baked climate texture with realistic Studio water', () => {
    const uniforms = createTerrainUniforms();
    const baker = new TerrainHeightBaker({ renderer: null, uniforms });

    expect(uniforms.uTerrainBiomeTex.value).toBeNull();
    expect(uniforms.uUseTerrainBiomeTex.value).toBe(0);
    expect(baker.biomeMaterial.defines).toEqual({ OCTAVES: 1 });
    baker.dispose();
  });

  it('exposes manual surface weight maps and blends painted material roles', () => {
    const uniforms = createTerrainUniforms();
    const tile = createTerrainMaterial(uniforms, 5);
    materials.push(tile);

    expect(uniforms.uManualSurfaceMode.value).toBe(0);
    expect(uniforms.uManualSurfaceOrigin.value.toArray()).toEqual([-512, -512]);
    expect(uniforms.uManualSurfaceSpan.value.toArray()).toEqual([1024, 1024]);
    expect(tile.fragmentShader).toContain('manualSurfaceWeightsAAt(wpos.xz)');
    expect(tile.fragmentShader).toContain('manualSurfaceWeightsBAt(wpos.xz)');
    const fragmentSamplers = [...tile.fragmentShader.matchAll(/uniform\s+sampler(?:2D|Cube)\s+([A-Za-z0-9_]+)/g)];
    // Four rolling field samplers were added: three Infinite cache levels and
    // the Studio climate bake.
    expect(fragmentSamplers).toHaveLength(20);
    expect(tile.fragmentShader).toContain('uniform sampler2D uSurfProps');
    expect(tile.fragmentShader).not.toContain('uniform sampler2D uSurfAO');
    expect(tile.fragmentShader).toContain('manualCoverage');
    expect(tile.fragmentShader).toContain('(manualMode ? 1.0 : roleBlend)');
  });

  it('keeps the dedicated Manual Terrain shader below the 16 texture-unit limit', () => {
    const uniforms = createTerrainUniforms();
    const manual = createTerrainMaterial(uniforms, 5, undefined, { variant: 'manual' });
    materials.push(manual);

    const samplerNames = (source) => [
      ...source.matchAll(/uniform\s+sampler(?:2D|Cube)\s+([A-Za-z0-9_]+)/g),
    ].map((match) => match[1]);
    const fragmentSamplers = samplerNames(manual.fragmentShader);
    const vertexSamplers = samplerNames(manual.vertexShader);

    expect(manual.userData.terrainVariant).toBe('manual');
    expect(fragmentSamplers).toEqual([
      'uPaintBiomeTexture',
      'uPaintPropsTexture',
      'uManualHeightTexture',
      'uTileOccupancy',
      'uSurfDiffuse',
      'uSurfProps',
    ]);
    expect(vertexSamplers).toEqual([
      'uPaintBiomeTexture',
      'uPaintPropsTexture',
      'uManualHeightTexture',
      'uTileOccupancy',
    ]);
    expect(fragmentSamplers.length).toBeLessThanOrEqual(16);
    expect(manual.fragmentShader).toContain('manualSurfaceWeightsAAt(wpos.xz)');
    expect(manual.fragmentShader).not.toContain('uniform sampler2D uInfiniteFieldTex0');
    expect(manual.fragmentShader).not.toContain('uniform sampler2D uImportImageryTex');
  });

  it('defines manual surface samplers before the planet surface material uses them', () => {
    const uniforms = createTerrainUniforms();
    const planet = createPlanetMaterial(uniforms, 5);
    materials.push(planet);

    const definitionA = planet.fragmentShader.indexOf('vec4 manualSurfaceWeightsAAt(vec2 xz)');
    const definitionB = planet.fragmentShader.indexOf('vec4 manualSurfaceWeightsBAt(vec2 xz)');
    const callA = planet.fragmentShader.indexOf('vec4 manualA = manualSurfaceWeightsAAt(wpos.xz)');
    const callB = planet.fragmentShader.indexOf('vec4 manualB = manualSurfaceWeightsBAt(wpos.xz)');

    expect(definitionA).toBeGreaterThan(-1);
    expect(definitionB).toBeGreaterThan(-1);
    expect(definitionA).toBeLessThan(callA);
    expect(definitionB).toBeLessThan(callB);
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
