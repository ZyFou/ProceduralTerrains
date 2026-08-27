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

  it('uses a frozen formation level for legacy wetland geometry', () => {
    const uniforms = createTerrainUniforms();
    const tile = createTerrainMaterial(uniforms, 5);
    const planet = createPlanetMaterial(uniforms, 5);
    materials.push(tile, planet);

    expect(uniforms.uTerrainFormationSeaLevel.value).toBe(42);
    expect(tile.vertexShader).toContain(
      'float sea01 = uTerrainFormationSeaLevel / max(uHeightScale, 1.0);',
    );
    expect(planet.vertexShader).toContain(
      'float sea01 = uTerrainFormationSeaLevel / max(uHeightScale, 1.0);',
    );
  });

  it('returns fully initialized climate structs on every cache path', () => {
    const uniforms = createTerrainUniforms();
    const material = createTerrainMaterial(uniforms, 5);
    materials.push(material);

    const start = material.fragmentShader.indexOf('Climate terrainCachedClimateAt');
    const end = material.fragmentShader.indexOf('\n}\n', start);
    const helper = material.fragmentShader.slice(start, end + 2);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(helper).toContain('float temp = 0.0;');
    expect(helper).toContain('float cached = 0.0;');
    expect(helper.match(/return Climate\(/g)).toHaveLength(1);
    expect(helper).not.toContain('return climateAt(p);');
    expect(helper).not.toMatch(/Climate result|Climate c;/);
    expect(material.fragmentShader).toContain(
      'Climate c = Climate(0.0, 0.0, 0.0, 0.0, 0.0);',
    );
  });

  it('uses exact climate, packed normals, and rendered height for visible Studio shading', () => {
    const uniforms = createTerrainUniforms();
    const material = createTerrainMaterial(uniforms, 5);
    materials.push(material);

    expect(material.fragmentShader).toContain(
      'Climate cl = climateAt(xz * uFrequency + uSeedOffset);',
    );
    expect(material.fragmentShader).toContain(
      'nGeo = normalize(packedHeightNormal.rgb * 2.0 - 1.0);',
    );
    expect(material.fragmentShader).toContain(
      'hC = packedHeightNormal.a * uHeightScale;',
    );
    expect(material.fragmentShader).toContain(
      'float hRel = vWorldPos.y - uSeaLevel;',
    );
  });

  it('leaves underwater color compositing to the water pipeline', () => {
    const uniforms = createTerrainUniforms();
    const material = createTerrainMaterial(uniforms, 5);
    materials.push(material);

    expect(material.fragmentShader).not.toContain('if (hRel < 0.0)');
    expect(material.fragmentShader).not.toContain('vec3 floorCol = mix');
    expect(material.fragmentShader).not.toContain(
      'albedo = mix(albedo, floorCol, 0.92);',
    );
    expect(material.fragmentShader).toContain(
      'vec3 albedo = mix(uColSand, lowland',
    );
  });

  it('keeps the stable direct-lighting path in both Tile terrain shader variants', () => {
    const uniforms = createTerrainUniforms();
    const full = createTerrainMaterial(uniforms, 5);
    const boot = createBootTerrainMaterial(uniforms, 5);
    materials.push(full, boot);

    expect(uniforms.uTerrainCloudShadowEnabled.value).toBe(0);
    expect(uniforms.uTerrainCloudShadowStrength.value).toBeCloseTo(0.45);
    expect(uniforms.uTerrainCloudShadowTex).toBeUndefined();
    expect(full.fragmentShader).not.toContain('float terrainCloudShadow(vec3 worldPos)');
    expect(full.fragmentShader).not.toContain('float terrainCloudFbm(vec3 p)');
    expect(full.fragmentShader).toContain('vec3 col = terrainLighting(');
    expect(full.fragmentShader).not.toContain('cloudShadow');
    expect(boot.fragmentShader).not.toContain('terrainCloudShadow(vWorldPos)');
  });

  it('lights the lightweight Node preview from the visible terrain slopes', () => {
    const uniforms = createTerrainUniforms();
    const preview = createBootTerrainMaterial(uniforms, 5);
    materials.push(preview);

    expect(preview.vertexShader).toContain('varying vec3 vTerrainPreviewNormal;');
    expect(preview.vertexShader).toContain(
      'float hNormalX = terrainCachedHeightAt(wp.xz + vec2(normalEps, 0.0));',
    );
    expect(preview.vertexShader).toContain(
      'float hNormalZ = terrainCachedHeightAt(wp.xz + vec2(0.0, normalEps));',
    );
    expect(preview.fragmentShader).toContain('nGeo = normalize(vTerrainPreviewNormal);');
    expect(preview.fragmentShader).not.toContain('dFdx(vWorldPos)');
    expect(preview.fragmentShader).not.toContain('nGeo = vec3(0.0, 1.0, 0.0);');
    expect(preview.fragmentShader).toContain('uniform float uNormalStrength;');
    expect(preview.fragmentShader).toContain('nGeo.x * uNormalStrength');
    expect(preview.fragmentShader).toContain(
      'vec3 skyAmb = uTerrainSkyAmb * 0.50 * (n.y * 0.5 + 0.5);',
    );
    expect(preview.fragmentShader).toContain(
      'vec3 bounce = uTerrainBounce * 0.25 * (1.0 - n.y * 0.5);',
    );
  });

  it('restores visible shallow-water terrain caustics', () => {
    const uniforms = createTerrainUniforms();
    const material = createTerrainMaterial(uniforms, 5);
    materials.push(material);

    expect(uniforms.uCausticMinDepth.value).toBe(1);
    expect(uniforms.uCausticMinDepthFalloff.value).toBe(1);
    expect(material.fragmentShader).not.toContain('float minDepthMask = smoothstep');
    expect(material.fragmentShader).toContain('depthFade *= depthFade;');
    expect(material.fragmentShader).toContain(
      'if (vSkirt > 0.0001 || vWallMesh > 0.5) return col;',
    );
    expect(material.fragmentShader).toContain(
      'float below = uSeaLevel - visibleHeight;',
    );
    expect(material.fragmentShader).toContain(
      'applyTerrainCaustics(col, xz, vWorldPos.y, nGeo, n)',
    );
    expect(material.fragmentShader).not.toContain(
      'applyTerrainCaustics(col, xz, hC, nGeo, n)',
    );
  });

  it('retains both terrain-toned crack covers at occupied cell boundaries', () => {
    const uniforms = createTerrainUniforms();
    const full = createTerrainMaterial(uniforms, 5);
    const boot = createBootTerrainMaterial(uniforms, 5);
    materials.push(full, boot);

    for (const material of [full, boot]) {
      expect(material.vertexShader).not.toContain('tileInteriorSkirtOwner');
      expect(material.vertexShader).toContain('skirt = aSkirt;');
      expect(material.vertexShader).toContain('wall = aSkirt * onOuter;');
      expect(material.fragmentShader).toContain('skirtDarken = 0.0');
    }
  });

  it('keeps the circular wall vertex path to one safe height sample', () => {
    const uniforms = createTerrainUniforms();
    const material = createTerrainMaterial(uniforms, 5);
    materials.push(material);

    const vertexMain = material.vertexShader.slice(
      material.vertexShader.indexOf('void main()'),
    );
    expect(vertexMain.match(/terrainCachedHeightAt\(/g)).toHaveLength(1);
    expect(vertexMain).toContain('float h = terrainCachedHeightAt(wp.xz);');
    expect(material.vertexShader).not.toContain('circularBoundaryMeshHeightAt');
    expect(material.uniforms.uCircleBoundarySegments).toBeUndefined();
    expect(vertexMain).not.toContain('rotateCircularWallSample');
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
    // Rolling caches plus the independent Destruction Lab height/scorch field.
    expect(fragmentSamplers).toHaveLength(23);
    expect(tile.fragmentShader).toContain('destructionScorchAt(xz)');
    expect(tile.fragmentShader).toContain('uniform sampler2D uSurfProps');
    expect(tile.fragmentShader).not.toContain('uniform sampler2D uSurfAO');
    expect(tile.fragmentShader).toContain('manualCoverage');
    expect(tile.fragmentShader).toContain('(useManualWeights ? 1.0 : roleBlend)');
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
      'uManualSurfaceTextureA',
      'uManualSurfaceTextureB',
      'uManualHeightTexture',
      'uDestructionTexture',
      'uTileOccupancy',
      'uSurfDiffuse',
      'uSurfProps',
    ]);
    expect(vertexSamplers).toEqual([
      'uManualSurfaceTextureA',
      'uManualSurfaceTextureB',
      'uManualHeightTexture',
      'uDestructionTexture',
      'uTileOccupancy',
    ]);
    expect(fragmentSamplers.length).toBeLessThanOrEqual(16);
    expect(manual.fragmentShader).toContain('manualSurfaceWeightsAAt(wpos.xz)');
    expect(manual.fragmentShader).not.toContain('uniform sampler2D uInfiniteFieldTex0');
    expect(manual.fragmentShader).not.toContain('uniform sampler2D uImportImageryTex');
  });

  it('omits the atlas graph for an empty Manual surface without changing its height/detail path', () => {
    const uniforms = createTerrainUniforms();
    const manual = createTerrainMaterial(uniforms, 5, undefined, { variant: 'manual-empty' });
    materials.push(manual);

    expect(manual.userData.terrainVariant).toBe('manual-empty');
    expect(manual.vertexShader).toContain('manualHeightOffsetAt');
    expect(manual.fragmentShader).toContain('applyTerrainDetailLayer');
    expect(manual.fragmentShader).not.toContain('uniform sampler2D uSurfDiffuse');
    expect(manual.fragmentShader).not.toContain('manualCoverage');
  });

  it('removes Infinite World cache samplers from the Tile-only hybrid shader', () => {
    const uniforms = createTerrainUniforms();
    const hybrid = createTerrainMaterial(uniforms, 5, undefined, { variant: 'hybrid' });
    materials.push(hybrid);

    expect(hybrid.userData.terrainVariant).toBe('hybrid');
    expect(hybrid.vertexShader).not.toContain('uniform sampler2D uInfiniteFieldTex0');
    expect(hybrid.fragmentShader).not.toContain('uniform sampler2D uInfiniteFieldTex0');
    expect(hybrid.fragmentShader).not.toContain('uniform sampler2D uTerrainBiomeTex');
    expect(hybrid.fragmentShader).not.toContain('infiniteFieldSampleAt');
    expect(hybrid.fragmentShader).toContain('return heightAt(xz);');
    expect(hybrid.fragmentShader).toContain('manualSurfaceWeightsAAt(wpos.xz)');
    expect(hybrid.fragmentShader).toContain('if (amount < 0.002) return res;');
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
