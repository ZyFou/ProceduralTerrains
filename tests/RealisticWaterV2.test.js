import { describe, expect, it } from 'vitest';
import { createTerrainUniforms } from '../src/engine/terrain/TerrainMaterial.js';
import { createProceduralSkyUniforms } from '../src/engine/sky/proceduralSkyGLSL.js';
import {
  applyRealisticWaterUniforms,
  createRealisticWaterMaterial,
  waterReflectionTraceSteps,
} from '../src/engine/water/RealisticWaterMaterial.js';
import { WATER_PRESETS } from '../src/engine/water/WaterPresets.js';
import {
  getWaterWaveFeatureSpacing,
  WATER_GERSTNER_GEOMETRY_TRAINS,
  WATER_GERSTNER_TRAINS,
  WATER_WAVE_SCALE_COMPATIBILITY,
  WATER_WAVES_GLSL,
} from '../src/engine/water/waterWavesGLSL.js';

describe('Realistic Water Surface V2', () => {
  it('uses the live procedural-sky uniform objects for reflection and sunlight', () => {
    const skyUniforms = createProceduralSkyUniforms();
    const material = createRealisticWaterMaterial(
      createTerrainUniforms(),
      7,
      undefined,
      skyUniforms,
    );

    expect(material.uniforms.uSkyZenith).toBe(skyUniforms.uSkyZenith);
    expect(material.uniforms.uSkySunDir).toBe(skyUniforms.uSkySunDir);
    expect(material.uniforms.uSkySunColor).toBe(skyUniforms.uSkySunColor);
    expect(material.fragmentShader).toContain('evaluateProceduralSkyLinear');
    expect(material.fragmentShader).toContain('reflect(-viewDir, n)');
    material.dispose();
  });

  it('contains RGB Beer–Lambert optics, animated-normal Fresnel, and directional waves', () => {
    const material = createRealisticWaterMaterial(createTerrainUniforms());

    expect(material.premultipliedAlpha).toBe(true);
    expect(material.forceSinglePass).toBe(true);
    expect(material.fragmentShader).toContain('vec3 waterBeerLambert');
    expect(material.fragmentShader).toContain('exp(-absorptionRGB');
    expect(material.fragmentShader).toContain('waterSchlickFresnel(n, viewDir');
    expect(material.fragmentShader).toContain('waterDirectionalNormal(xz, t');
    expect(material.fragmentShader).toContain('float microFade');
    expect(material.fragmentShader).not.toContain('vec3(0.30, 0.42, 0.55)');
    expect(material.fragmentShader).not.toContain('transmittanceV1');
    material.dispose();
  });

  it('contains depth-rejected scene refraction for higher water tiers', () => {
    const material = createRealisticWaterMaterial(createTerrainUniforms());

    expect(material.uniforms.uSceneRefractionEnabled.value).toBe(0);
    expect(material.fragmentShader).toContain('textureLod(uSceneColor');
    expect(material.fragmentShader).toContain('textureLod(uSceneDepth');
    expect(material.fragmentShader).toContain('float silhouetteReject');
    expect(material.fragmentShader).toContain('refractedVolume');
    expect(material.fragmentShader).toContain(
      'float sceneRefractionWeight = sceneCaptureEnabled * visibleFloor',
    );
    expect(material.fragmentShader).toContain(
      'vec3 sceneTransmittance = transmittance * 0.82',
    );
    expect(material.fragmentShader).toContain(
      'float depth = uSeaLevel - floorH',
    );
    expect(material.fragmentShader).toContain('if (depth <= 0.02) discard;');
    expect(material.fragmentShader).toContain(
      'if (uUseWaterTerrainBiomeTex > 0.5)',
    );
    expect(material.fragmentShader).toContain(
      'Climate climate = climateAt(xz * uFrequency + uSeedOffset)',
    );
    expect(material.fragmentShader).toContain(
      'vec2 screenUv = gl_FragCoord.xy * uSceneViewportInv',
    );
    expect(material.fragmentShader).not.toContain('vClipPosition');

    applyRealisticWaterUniforms(material, {
      waterRefractionQuality: 0.8,
    }, 'volumetric');
    expect(material.uniforms.uWaterTier.value).toBe(2);
    expect(material.uniforms.uRefractionQual.value).toBe(0.8);
    material.dispose();
  });

  it('varies palette water colors smoothly from local biome climate', () => {
    const uniforms = createTerrainUniforms();
    const material = createRealisticWaterMaterial(uniforms);

    expect(uniforms.uWaterTerrainBiomeTex.value).toBeNull();
    expect(uniforms.uUseWaterTerrainBiomeTex.value).toBe(0);
    expect(material.fragmentShader).toContain(
      'textureLod(uWaterTerrainBiomeTex, waterBakedUvAt(xz), 0.0)',
    );
    expect(material.fragmentShader).toContain(
      'vec4 waterBiomeWeights(vec2 xz, out float canyon, out float strength)',
    );
    expect(material.fragmentShader).toContain(
      'shallowColor = mix(shallowColor, naturalShallow, naturalColor)',
    );
    expect(material.fragmentShader).toContain(
      'shallowColor *= biomeColorMultiplier',
    );

    applyRealisticWaterUniforms(material, {
      waterBiomeColorEnabled: true,
      waterBiomeColorStrength: 0.85,
    }, 'realistic');
    expect(material.uniforms.uBiomeColorEnabled.value).toBe(1);
    expect(material.uniforms.uBiomeColorStrength.value).toBe(0.85);
    expect(material.uniforms.uWaterNaturalColor.value).toBe(0.7);

    applyRealisticWaterUniforms(material, { waterNaturalColor: 0 }, 'realistic');
    expect(material.uniforms.uWaterNaturalColor.value).toBe(0);

    applyRealisticWaterUniforms(material, {
      waterBiomeColorEnabled: false,
    }, 'volumetric');
    expect(material.uniforms.uBiomeColorEnabled.value).toBe(0);
    material.dispose();
  });

  it('contains Cinematic planar reflection with analytical-sky fallback', () => {
    const material = createRealisticWaterMaterial(createTerrainUniforms());

    expect(material.uniforms.uPlanarReflectionEnabled.value).toBe(0);
    expect(material.fragmentShader).toContain(
      'uPlanarReflectionMatrix * vec4(vWorldPos, 1.0)',
    );
    expect(material.fragmentShader).toContain(
      'textureLod(uPlanarReflection',
    );
    expect(material.fragmentShader).toContain(
      'reflectedSurface = mix(reflectedSky, planarLinear, planarBlend)',
    );
    expect(material.fragmentShader).toContain(
      'step(2.5, uWaterTier)',
    );

    applyRealisticWaterUniforms(material, {
      waterReflectionQuality: 1.4,
    }, 'cinematic');
    expect(material.uniforms.uWaterTier.value).toBe(3);
    expect(material.uniforms.uReflectionQuality.value).toBe(1.4);
    material.dispose();
  });

  it('uses camera-focused Gerstner geometry and fold-driven whitecaps', () => {
    const material = createRealisticWaterMaterial(createTerrainUniforms());

    expect(material.vertexShader).toContain('waterConcentratedGridAxis');
    expect(material.vertexShader).toContain('waterCinematicDisplacement');
    expect(material.vertexShader).toMatch(
      /uGeometryDisplacementEnabled\s*\*\s*step\(2\.5,\s*uWaterTier\)/,
    );
    // Geometry displaces the longest trains of the sea the fragment shades.
    expect(material.vertexShader).toContain('waterGerstnerDomain(xz, t)');
    expect(material.vertexShader.match(/waterGerstnerDisplace\(offset/g))
      .toHaveLength(WATER_GERSTNER_GEOMETRY_TRAINS);
    // Whitecaps follow the fold of the same Gerstner sea on every tier and
    // break into cellular lace; sheltered water calms the sea state.
    expect(material.fragmentShader).toContain('smoothstep(0.30, 0.82, waterWaveFold)');
    expect(material.fragmentShader).toContain('float whitecap');
    expect(material.fragmentShader).toContain('float waterFoamCells(vec2 p, float time)');
    expect(material.fragmentShader).toContain('waterWaveShelter = mix(0.30, 1.0, shoaling)');
    expect(material.fragmentShader).not.toContain('waterCinematicCrest');

    applyRealisticWaterUniforms(material, {}, 'cinematic');
    expect(material.uniforms.uGeometryDisplacementEnabled.value).toBe(1);
    applyRealisticWaterUniforms(material, {}, 'volumetric');
    expect(material.uniforms.uGeometryDisplacementEnabled.value).toBe(0);
    material.dispose();
  });

  it('keeps caustics visible through the shallow-water band', () => {
    const material = createRealisticWaterMaterial(createTerrainUniforms());

    expect(material.fragmentShader).not.toContain('float minDepthMask = smoothstep');
    expect(material.fragmentShader).toContain(
      'uWaterTier > 1.5 && sceneCaptureEnabled < 0.5',
    );
    expect(material.fragmentShader).toContain(
      'float caust = pow(max(c1 * c2, 0.0), 2.2) * shallowMask;',
    );
    applyRealisticWaterUniforms(material, {
      waterUnderwaterCausticMinDepth: 2.5,
      waterUnderwaterCausticMinDepthFalloff: 1.75,
    }, 'cinematic');
    expect(material.uniforms.uCausticMinDepth.value).toBe(2.5);
    expect(material.uniforms.uCausticMinDepthFalloff.value).toBe(1.75);
    material.dispose();
  });

  it('applies roughness and sky-reflection settings without recompiling', () => {
    const material = createRealisticWaterMaterial(createTerrainUniforms());
    const fragmentShader = material.fragmentShader;

    applyRealisticWaterUniforms(material, {
      waterRoughness: 0.61,
      waterReflectionQuality: 0.7,
      waterNormalResolution: 1.25,
      skyboxEnabled: false,
    }, 'realistic');

    expect(material.uniforms.uRoughness.value).toBe(0.61);
    expect(material.uniforms.uReflectionQuality.value).toBe(0.7);
    expect(material.uniforms.uMicroWaveDetail.value).toBe(1.25);
    expect(material.uniforms.uSkyReflectionEnabled.value).toBe(0);
    expect(material.fragmentShader).toBe(fragmentShader);
    material.dispose();
  });

  it('tunes the realistic presets for distinct optical densities and roughness', () => {
    expect(WATER_PRESETS.tropical.patch.waterOpacity)
      .toBeLessThan(WATER_PRESETS.ocean.patch.waterOpacity);
    expect(WATER_PRESETS.ocean.patch.waterRoughness)
      .toBeLessThan(WATER_PRESETS.lake.patch.waterRoughness);
    expect(WATER_PRESETS.swamp.patch.waterOpacity)
      .toBeGreaterThan(WATER_PRESETS.balanced.patch.waterOpacity);
  });

  it('preserves the pre-V2 world-space wave feature scale', () => {
    const spacing = getWaterWaveFeatureSpacing(1);
    const doubleScale = getWaterWaveFeatureSpacing(2);

    expect(WATER_WAVE_SCALE_COMPATIBILITY.domainScale).toBe(0.055);
    expect(spacing.large).toBeCloseTo(17.85, 1);
    expect(spacing.medium).toBeCloseTo(7.72, 1);
    expect(doubleScale.large).toBeCloseTo(spacing.large * 0.5, 5);
    expect(doubleScale.medium).toBeCloseTo(spacing.medium * 0.5, 5);
    // The spectrum starts at the legacy large-wave wavenumber.
    expect(WATER_WAVES_GLSL).toContain(
      `* ${WATER_WAVE_SCALE_COMPATIBILITY.largeMultiplier};`,
    );
  });

  it('breaks up large-scale repetition without changing local wavelengths', () => {
    expect(WATER_WAVES_GLSL).toContain('vec2 macroWarp');
    expect(WATER_WAVES_GLSL).toContain('float regionalA');
    expect(WATER_WAVES_GLSL).toContain('float regionalB');
    expect(WATER_WAVES_GLSL).toContain('vec2 waveXZ = xz + macroWarp');
    expect(WATER_WAVES_GLSL).toContain('void waterGerstnerShade(');
    // One straight-line call per train: ANGLE/FXC stalls unrolling long
    // transcendental loops.
    expect(WATER_WAVES_GLSL).not.toMatch(/\bfor \(|\bbreak;/);
    expect(WATER_WAVES_GLSL.match(/  waterGerstnerShade\(slope, fold, height, lost/g))
      .toHaveLength(WATER_GERSTNER_TRAINS.length);
    expect(WATER_WAVES_GLSL).toContain('float chop = waterGerstnerChop(seaState);');
    expect(WATER_WAVES_GLSL).toContain('waterBandFilter(k, footprint)');
    expect(WATER_WAVES_GLSL).toContain('float largePatchA');
    expect(WATER_WAVES_GLSL).toContain('float largePatchB');
    expect(WATER_WAVES_GLSL).toContain('float mediumPatchA');
    expect(WATER_WAVES_GLSL).toContain('float mediumPatchB');
    expect(WATER_WAVES_GLSL).toContain('float smallPatch');
    expect(WATER_WAVES_GLSL).toContain(
      `float legacyDomainScale = ${WATER_WAVE_SCALE_COMPATIBILITY.domainScale} * scale`,
    );
  });

  it('lights the water body from the flat surface, not the wave normal', () => {
    const material = createRealisticWaterMaterial(createTerrainUniforms());

    expect(material.fragmentShader).toContain('vec3 bodyAlbedo = deepColor * 0.45;');
    expect(material.fragmentShader).toContain(
      'vec3 inScatter = scatteringColor * (vec3(1.0) - transmittance);',
    );
    expect(material.fragmentShader).not.toContain('float diff = max(dot(n, uSunDir), 0.0);');
    expect(material.fragmentShader).toContain('waterRefractedCosine(');
    material.dispose();
  });

  it('traces terrain reflections through the baked height field on every tier', () => {
    const material = createRealisticWaterMaterial(createTerrainUniforms());

    expect(material.uniforms.uWaterTraceSteps.value).toBe(0);
    expect(material.fragmentShader).toContain('float waterTraceTerrain(');
    expect(material.fragmentShader).toContain('for (int i = 0; i < uWaterTraceSteps; i++)');
    expect(material.fragmentShader).toContain(
      'reflectedSky = mix(reflectedSky, terrainReflectionColor, terrainReflection);',
    );

    applyRealisticWaterUniforms(material, { waterReflectionQuality: 1 }, 'realistic');
    expect(material.uniforms.uWaterTraceSteps.value).toBe(20);
    applyRealisticWaterUniforms(material, { waterReflectionQuality: 1 }, 'volumetric');
    expect(material.uniforms.uWaterTraceSteps.value).toBe(32);
    expect(waterReflectionTraceSteps(3, 1.4)).toBe(50);
    expect(waterReflectionTraceSteps(2, 0.1)).toBe(0);
    material.dispose();
  });

  it('adds aperiodic gust-modulated ripples to the analytic sea', () => {
    expect(WATER_WAVES_GLSL).toContain('float waterGustMask(');
    expect(WATER_WAVES_GLSL).toContain('vec3 waterNoiseD(vec2 p)');
    expect(WATER_WAVES_GLSL).toContain('void waterRippleOctave(');
    expect(WATER_WAVES_GLSL).toContain('smallPatch *= mix(0.22, 1.12, gust);');
  });

  it('describes a peaked wind sea: 20 trains from swell to capillary chop', () => {
    expect(WATER_GERSTNER_TRAINS).toHaveLength(20);
    expect(WATER_GERSTNER_GEOMETRY_TRAINS).toBeLessThanOrEqual(12);
    // strictly shortening wavelengths, deterministic phases, bounded steepness
    for (let i = 1; i < WATER_GERSTNER_TRAINS.length; i++) {
      expect(WATER_GERSTNER_TRAINS[i].kRatio).toBeGreaterThan(WATER_GERSTNER_TRAINS[i - 1].kRatio);
    }
    expect(WATER_GERSTNER_TRAINS[0].kRatio).toBe(1);
    expect(WATER_GERSTNER_TRAINS[0].phase).toBeCloseTo(4.738939, 5);
    const steepness = WATER_GERSTNER_TRAINS.reduce((sum, train) => sum + train.steepness, 0);
    expect(steepness).toBeGreaterThan(0.9);
    expect(steepness).toBeLessThan(1.2);
    // the pinch stays below self-intersection at the reference sea state
    expect(0.95 / (steepness * 1.15)).toBeLessThan(1);
    expect(WATER_WAVES_GLSL).toContain('float waterWaveFold = 1.0;');
    expect(WATER_WAVES_GLSL).toContain('float waterWaveCrest = 0.5;');
  });
});
