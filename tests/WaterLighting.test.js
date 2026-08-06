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

  it('keeps an explicit Legacy compatibility branch and resolves live atmosphere lighting', () => {
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
      'vec3 legacyLight = vec3(0.55 + 0.65 * diff);',
    );
    expect(materials[0].fragmentShader).toContain('col *= resolvedLight;');
    expect(materials[0].fragmentShader).toContain(
      'waterResolveSunLight(vec3(1.0, 0.95, 0.85))',
    );
    expect(materials[0].fragmentShader).toContain(
      'waterResolveSkyLight(vec3(0.30, 0.42, 0.55))',
    );
    expect(materials[1].fragmentShader).toContain(
      'vec3(0.62 + 0.38 * diff)',
    );
    expect(materials[2].fragmentShader).toContain(
      'vec3 legacyLight = vec3(0.55 + 0.65 * diff);',
    );
    expect(materials[2].fragmentShader).toContain('col *= resolvedLight;');
  });

  it('uses the exact terrain field for water visibility in every world shape', () => {
    const uniforms = createTerrainUniforms();
    const legacy = createWaterMaterial(uniforms);
    const realistic = createRealisticWaterMaterial(uniforms);
    const planet = createPlanetWaterMaterial(uniforms);

    for (const material of [legacy, realistic, planet]) {
      expect(material.depthTest).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.fragmentShader).toContain(
        'if (depth <= 0.02) discard;',
      );
    }
    expect(legacy.fragmentShader).toContain(
      'float depth = uSeaLevel - floorH;',
    );
    expect(realistic.fragmentShader).toContain(
      'float depth = uSeaLevel - floorH;',
    );
    expect(planet.fragmentShader).toContain(
      'float depth = waterR - terrainR;',
    );
    expect(planet.polygonOffset).toBe(false);

    legacy.dispose();
    realistic.dispose();
    planet.dispose();
  });

  it('lights Legacy and Planet foam with the same resolved atmosphere', () => {
    const uniforms = createTerrainUniforms();
    const legacy = createWaterMaterial(uniforms);
    const planet = createPlanetWaterMaterial(uniforms);

    for (const material of [legacy, planet]) {
      expect(material.fragmentShader).toContain(
        'vec3 legacyLight = vec3(0.55 + 0.65 * diff);',
      );
      expect(material.fragmentShader).toContain('col *= resolvedLight;');
      expect(material.fragmentShader).toContain(
        'vec3 litFoamColor = waterResolveFoamColor(uColFoam, resolvedLight);',
      );
      expect(material.fragmentShader).toContain(
        'col = mix(col, litFoamColor, foam * 0.75);',
      );
      material.dispose();
    }
  });

  it('lights Realistic foam from the resolved sky while retaining its readability control', () => {
    const material = createRealisticWaterMaterial(createTerrainUniforms());

    expect(material.fragmentShader).toContain(
      'vec3 litFoamColor = waterResolveFoamColor(uColFoam, waterLight);',
    );
    expect(material.fragmentShader).toContain(
      'premultipliedColor = mix(premultipliedColor, litFoamColor, foam);',
    );
    material.dispose();
  });

  it('uses a tinted low-light floor instead of an unlit white foam contribution', () => {
    const material = createWaterMaterial(createTerrainUniforms());

    expect(material.fragmentShader).toContain(
      'vec3 environmentTint = environmentPeak > 0.0001',
    );
    expect(material.fragmentShader).toContain(
      'float readabilityFloor = mix(',
    );
    expect(material.fragmentShader).not.toContain(
      'foamColor * mix(\n    vec3(1.0)',
    );
    material.dispose();
  });

  it('uses spherical local up for Planet fresnel lighting', () => {
    const material = createPlanetWaterMaterial(createTerrainUniforms());

    expect(material.fragmentShader).toContain(
      'max(dot(viewDir, up), 0.0)',
    );
    material.dispose();
  });
});
