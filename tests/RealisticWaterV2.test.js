import { describe, expect, it } from 'vitest';
import { createTerrainUniforms } from '../src/engine/terrain/TerrainMaterial.js';
import { createProceduralSkyUniforms } from '../src/engine/sky/proceduralSkyGLSL.js';
import {
  applyRealisticWaterUniforms,
  createRealisticWaterMaterial,
} from '../src/engine/water/RealisticWaterMaterial.js';
import { WATER_PRESETS } from '../src/engine/water/WaterPresets.js';
import {
  getWaterWaveFeatureSpacing,
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
    expect(WATER_WAVES_GLSL).toContain('* 13.0');
    expect(WATER_WAVES_GLSL).not.toMatch(/\*\s+13\s*$/m);
  });

  it('breaks up large-scale repetition without changing local wavelengths', () => {
    expect(WATER_WAVES_GLSL).toContain('vec2 macroWarp');
    expect(WATER_WAVES_GLSL).toContain('float regionalA');
    expect(WATER_WAVES_GLSL).toContain('float regionalB');
    expect(WATER_WAVES_GLSL).toContain('vec2 waveXZ = xz + macroWarp');
    expect(WATER_WAVES_GLSL).toContain('float largePatchA');
    expect(WATER_WAVES_GLSL).toContain('float largePatchB');
    expect(WATER_WAVES_GLSL).toContain('float mediumPatchA');
    expect(WATER_WAVES_GLSL).toContain('float mediumPatchB');
    expect(WATER_WAVES_GLSL).toContain('float smallPatch');
    expect(WATER_WAVES_GLSL).toContain(
      `float legacyDomainScale = ${WATER_WAVE_SCALE_COMPATIBILITY.domainScale} * scale`,
    );
  });
});
