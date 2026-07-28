import { describe, expect, it } from 'vitest';
import { createTerrainUniforms } from '../src/engine/terrain/TerrainMaterial.js';
import {
  createWaterMaterial,
} from '../src/engine/terrain/WaterMaterial.js';
import {
  createPlanetWaterMaterial,
} from '../src/engine/terrain/PlanetMaterial.js';
import {
  createRealisticWaterMaterial,
} from '../src/engine/water/RealisticWaterMaterial.js';
import {
  applyWaterMaterialSettings,
} from '../src/engine/water/WaterMaterialFactory.js';
import {
  WATER_DEFAULT_PARAMS,
  WATER_LIGHTING_PARAM_KEYS,
} from '../src/engine/water/WaterSettings.js';
import { LIGHTING_PARAM_KEYS } from '../src/engine/panelResets.js';

const CUSTOM_LIGHTING = {
  waterAtmosphereInfluence: 0.42,
  waterSunResponse: 1.35,
  waterAmbientResponse: 0.7,
  waterFoamLighting: 0.28,
  waterAnim: true,
};

function expectWaterLightingUniforms(material) {
  expect(material.uniforms.uWaterAtmosphereInfluence.value).toBe(0.42);
  expect(material.uniforms.uWaterSunResponse.value).toBe(1.35);
  expect(material.uniforms.uWaterAmbientResponse.value).toBe(0.7);
  expect(material.uniforms.uWaterFoamLighting.value).toBe(0.28);
}

describe('water atmosphere lighting', () => {
  it('serializes stable defaults and includes them in Lighting reset scope', () => {
    expect(WATER_DEFAULT_PARAMS).toMatchObject({
      waterAtmosphereInfluence: 1,
      waterSunResponse: 1,
      waterAmbientResponse: 1,
      waterFoamLighting: 0.65,
    });
    for (const key of WATER_LIGHTING_PARAM_KEYS) {
      expect(LIGHTING_PARAM_KEYS).toContain(key);
    }
  });

  it('applies the same uniform controls to Legacy, Realistic, and Planet water', () => {
    const uniforms = createTerrainUniforms();
    const legacy = createWaterMaterial(uniforms);
    const realistic = createRealisticWaterMaterial(uniforms);
    const planet = createPlanetWaterMaterial(uniforms);

    expect(legacy.defines.OCTAVES).toBe(7);
    expect(realistic.defines.OCTAVES).toBe(7);
    applyWaterMaterialSettings(legacy, CUSTOM_LIGHTING, 'legacy');
    applyWaterMaterialSettings(realistic, CUSTOM_LIGHTING, 'realistic');
    applyWaterMaterialSettings(planet, CUSTOM_LIGHTING, 'legacy');

    expectWaterLightingUniforms(legacy);
    expectWaterLightingUniforms(realistic);
    expectWaterLightingUniforms(planet);

    legacy.dispose();
    realistic.dispose();
    planet.dispose();
  });

  it('keeps an explicit Legacy compatibility branch in every water shader', () => {
    const uniforms = createTerrainUniforms();
    const materials = [
      createWaterMaterial(uniforms),
      createRealisticWaterMaterial(uniforms),
      createPlanetWaterMaterial(uniforms),
    ];

    for (const material of materials) {
      expect(material.fragmentShader).toContain('waterResolveLighting');
      expect(material.fragmentShader).toContain(
        'clamp(uWaterAtmosphereInfluence, 0.0, 1.0)',
      );
      expect(material.fragmentShader).toContain('waterResolveFoamColor');
      material.dispose();
    }

    expect(materials[0].fragmentShader).toContain(
      'vec3(0.55 + 0.65 * diff)',
    );
    expect(materials[1].fragmentShader).toContain(
      'vec3(0.62 + 0.38 * diff)',
    );
    expect(materials[2].fragmentShader).toContain(
      'vec3(0.55 + 0.65 * diff)',
    );
  });

  it('uses spherical local up for Planet ambient lighting', () => {
    const material = createPlanetWaterMaterial(createTerrainUniforms());

    expect(material.fragmentShader).toMatch(
      /waterResolveLighting\(\s*n,\s*up,\s*diff,/,
    );
    material.dispose();
  });
});
