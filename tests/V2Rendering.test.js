import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  CLOUD_DEFAULT_PARAMS,
  CLOUD_RENDER_MODES,
  resolveCloudLayerMode,
  resolveCloudRenderMode,
} from '../src/engine/sky/CloudSettings.js';
import { CloudV2SlabLayer, CloudV2InfiniteLayer } from '../src/engine/sky/v2/CloudV2Layers.js';
import { CLOUD_V2_FRAGMENT, CLOUD_V2_FIELD_GLSL } from '../src/engine/sky/v2/cloudV2GLSL.js';
import { CloudShadowPass } from '../src/engine/sky/CloudShadowPass.js';
import {
  NOISE_VOLUME_V2_FRAGMENT,
  CLOUD_WEATHER_V2_FRAGMENT,
} from '../src/engine/render/NoiseVolumeV2.js';
import {
  SURFACE_TEXTURE_SOURCE,
  isProceduralSurfaceSource,
  normalizeSurfaceTextureParams,
  normalizeSurfaceTextureSource,
  sourceUsesTextureAtlas,
} from '../src/engine/terrain/surface/SurfaceTextureSources.js';
import {
  createTerrainMaterial,
  createTerrainUniforms,
  terrainShaderFamily,
} from '../src/engine/terrain/TerrainMaterial.js';
import { countReferencedSamplers, MAX_FRAGMENT_SAMPLERS } from '../src/engine/terrain/terrainGLSL.js';
import { SURFACE_V2_GLSL } from '../src/engine/terrain/surface/terrainSurfaceV2GLSL.js';
import {
  createInfiniteRealisticWaterMaterial,
  createRealisticWaterMaterial,
} from '../src/engine/water/RealisticWaterMaterial.js';
import { WATER_DEFAULT_PARAMS } from '../src/engine/water/WaterSettings.js';
import { DEFAULT_PARAMS } from '../src/engine/presets.js';

describe('Realistic V2 clouds', () => {
  it('is a third render mode that the planet renders as Realistic', () => {
    expect(CLOUD_RENDER_MODES).toEqual(['legacy', 'realistic', 'realisticV2']);
    expect(resolveCloudRenderMode({ cloudRenderMode: 'realisticV2' })).toBe('realisticV2');
    expect(resolveCloudRenderMode({ cloudRenderMode: 'nope' })).toBe('legacy');
    expect(resolveCloudLayerMode({ cloudRenderMode: 'realisticV2' }, 'studio')).toBe('realisticV2');
    expect(resolveCloudLayerMode({ cloudRenderMode: 'realisticV2' }, 'infinite')).toBe('realisticV2');
    expect(resolveCloudLayerMode({ cloudRenderMode: 'realisticV2' }, 'planet')).toBe('realistic');
  });

  it.each([CloudV2SlabLayer, CloudV2InfiniteLayer])('maps the shared cloud params in %s', (Layer) => {
    const layer = new Layer(new THREE.Scene());
    const apply = (patch = {}) => layer.applyParams(
      { ...CLOUD_DEFAULT_PARAMS, cloudsEnabled: true, seed: 12, ...patch }, 100, 2048, {},
    );
    try {
      apply();
      const u = layer.material.uniforms;
      expect(layer.renderMode).toBe('realisticV2');
      expect(u.uCloudBottom.value).toBe(CLOUD_DEFAULT_PARAMS.cloudAltitude);
      expect(u.uCloudTop.value - u.uCloudBottom.value).toBe(CLOUD_DEFAULT_PARAMS.cloudThickness);
      // a full-thickness column keeps the reference optical depth
      expect(u.uCloudSigma.value * CLOUD_DEFAULT_PARAMS.cloudThickness).toBeCloseTo(48.6, 3);
      // defaults reproduce the reference look
      expect(u.uCloudCoverage.value).toBeCloseTo(0.68, 6);
      expect(u.uCloudEdge.value).toBeCloseTo(0.22, 6);
      expect(u.uCloudDetail.value).toBeCloseTo(1, 6);
      expect(u.uCloudTopMin.value).toBeCloseTo(0.42, 6);

      const weather = u.uCloudWeatherFreq.value;
      const noise = u.uCloudNoiseFreq.value;
      const seed = u.uCloudVariationOffset.value.clone();
      apply({ cloudSystemScale: CLOUD_DEFAULT_PARAMS.cloudSystemScale * 2 });
      expect(u.uCloudWeatherFreq.value).toBeCloseTo(weather * 2, 10);
      apply({ cloudBillowSize: 2 });
      expect(u.uCloudNoiseFreq.value).toBeCloseTo(noise / 2, 10);
      expect(u.uCloudWeatherFreq.value).toBeCloseTo(weather, 10);
      // Coverage runs clear sky -> reference field -> overcast
      apply({ cloudCoverage: 0 });
      expect(u.uCloudCoverage.value).toBe(0);
      apply({ cloudCoverage: 1 });
      expect(u.uCloudCoverage.value).toBeCloseTo(1, 6);
      apply({ cloudNoiseSeed: 21 });
      expect(u.uCloudVariationOffset.value.equals(seed)).toBe(false);
      apply();
      expect(u.uCloudVariationOffset.value.equals(seed)).toBe(true);
    } finally { layer.dispose(); }
  });

  it('samples only mip-mapped baked noise with real loops', () => {
    expect(CLOUD_V2_FIELD_GLSL).toContain('textureLod(uWeatherV2, wuv, 0.0)');
    expect(CLOUD_V2_FIELD_GLSL).toContain('textureLod(uNoiseV2, nq, lod)');
    expect(CLOUD_V2_FRAGMENT).toContain('+ uLoopGuard; i++)');
    // equal slices of the layer crossing, growing steps on long grazing rays
    expect(CLOUD_V2_FRAGMENT).toContain('float dtSlice = segLen / steps;');
    expect(CLOUD_V2_FRAGMENT).toContain('float stride = min(dtSlice, max(dtMin, t * 0.032));');
    // the lattice is only dithered when the low-res pass will filter it
    expect(CLOUD_V2_FRAGMENT).toContain('* uCloudJitter');
    // every sampler lookup in the march is explicit LOD (no implicit derivatives)
    expect(CLOUD_V2_FIELD_GLSL).not.toMatch(/texture(2D)?\(u(Noise|Weather)V2/);
    for (const bake of [NOISE_VOLUME_V2_FRAGMENT, CLOUD_WEATHER_V2_FRAGMENT]) {
      expect(bake).toContain('<= 1 + uLoopGuard;');
    }
  });

  it('projects terrain shadows from the V2 field', () => {
    const pass = new CloudShadowPass({ v2: true });
    try {
      expect(pass.material.name).toBe('cloud-shadow.realisticV2.flat');
      expect(pass.material.fragmentShader).toContain('cloudV2Density(p, 1.0, false)');
    } finally { pass.dispose(); }
    // there is no spherical V2 field: a planet pass falls back to its own
    const planet = new CloudShadowPass({ v2: true, realistic: true, planet: true });
    try {
      expect(planet.material.fragmentShader).toContain('cloudDensityAt(p, 0.0)');
    } finally { planet.dispose(); }
  });
});

describe('cloud reflections on realistic water', () => {
  it.each([false, true])('mirrors the cloud map without an extra sampler (infinite=%s)', (infinite) => {
    const uniforms = createTerrainUniforms();
    const material = infinite
      ? createInfiniteRealisticWaterMaterial(uniforms)
      : createRealisticWaterMaterial(uniforms);
    try {
      // shared with the engine: one write reaches every water material
      expect(material.uniforms.uWaterCloudReflection).toBe(uniforms.uWaterCloudReflection);
      expect(material.uniforms.uCloudLayerSpan).toBe(uniforms.uCloudLayerSpan);
      expect(uniforms.uWaterCloudReflection.value).toBe(0);
      const fragment = material.fragmentShader;
      // the map rides in the G channel of the tile-occupancy unit
      expect(fragment).toContain('textureLod(uTileOccupancy, uv, 0.0).g');
      expect(fragment).toContain(
        'vec4 cloudMirror = waterCloudReflection(vWorldPos, reflectedDirection, reflectionBlur);',
      );
      // a cloud between the sun and the water hides the sun glitter
      expect(fragment).toContain('* (1.0 - waterCloudSunCover(vWorldPos));');
      expect(countReferencedSamplers(fragment)).toBeLessThanOrEqual(MAX_FRAGMENT_SAMPLERS);
    } finally { material.dispose(); }
  });

  it('defaults to on for the realistic tiers', () => {
    expect(WATER_DEFAULT_PARAMS.waterCloudReflection).toBe(1);
  });
});

describe('Procedural V2 terrain surface', () => {
  it('lets the biome choose the stone and keeps red strata opt-in', () => {
    const uniforms = createTerrainUniforms();
    expect(uniforms.uSurfV2Sandstone.value).toBe(0);
    expect(uniforms.uSurfV2Variation.value).toBe(1);
    expect(DEFAULT_PARAMS.surfaceV2Sandstone).toBe(0);
    // every material is built from palette colours, never fixed hues
    for (const colour of ['uColRock', 'uColRockHi', 'uColRedRock', 'uColDune', 'uColSand',
      'uColDryGrass', 'uColForest', 'uColJungle', 'uColSnow']) {
      expect(SURFACE_V2_GLSL).toContain(colour);
    }
    // stone type follows the climate; snow and sand stay smooth
    expect(SURFACE_V2_GLSL).toContain('float alpine = clamp(');
    expect(SURFACE_V2_GLSL).toContain('float humid = smoothstep(0.55, 0.80, cl.moist)');
    expect(SURFACE_V2_GLSL).toContain('float softGround = mix(0.42, 0.08, max(snow, sand));');
    expect(SURFACE_V2_GLSL).toContain('if (uSurfV2Sandstone > 0.001) {');
  });

  it('is a shader-only source (no atlas)', () => {
    const source = SURFACE_TEXTURE_SOURCE.PROCEDURAL_V2;
    expect(normalizeSurfaceTextureSource({ surfaceTextureSource: source })).toBe(source);
    expect(isProceduralSurfaceSource(source)).toBe(true);
    expect(sourceUsesTextureAtlas(source)).toBe(false);
    expect(normalizeSurfaceTextureParams({ surfaceTextureSource: source }).surfaceTextureMode).toBe(false);
    expect(sourceUsesTextureAtlas(SURFACE_TEXTURE_SOURCE.PBR)).toBe(true);
  });

  it.each(['studio', 'infinite'])('compiles its own terrain variant within the sampler budget (%s)', (worldMode) => {
    const uniforms = createTerrainUniforms();
    const v2 = createTerrainMaterial(uniforms, 7, undefined, { variant: 'v2', worldMode });
    const base = createTerrainMaterial(uniforms, 7, undefined, { variant: 'base', worldMode });
    try {
      expect(v2.userData.terrainVariant).toBe('v2');
      expect(terrainShaderFamily('v2')).toBe('v2');
      expect(v2.fragmentShader).toContain('SurfaceV2Result v2 = applySurfaceV2(');
      expect(v2.fragmentShader).toContain('uniform highp sampler3D uSurfV2Noise;');
      // the noise volume takes the unit of the page-backed detail layer
      expect(v2.fragmentShader).not.toContain('uDetailPageArray');
      expect(countReferencedSamplers(v2.fragmentShader)).toBeLessThanOrEqual(MAX_FRAGMENT_SAMPLERS);
      expect(countReferencedSamplers(v2.fragmentShader))
        .toBeLessThanOrEqual(countReferencedSamplers(base.fragmentShader));
      // other variants are untouched
      expect(base.fragmentShader).not.toContain('uSurfV2Noise');
      expect(base.fragmentShader).not.toContain('applySurfaceV2');
      expect(uniforms.uSurfV2Amount.value).toBe(0);
    } finally { v2.dispose(); base.dispose(); }
  });
});
