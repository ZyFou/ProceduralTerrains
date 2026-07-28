import { describe, expect, it } from 'vitest';
import { evaluateTimeOfDay } from '../src/engine/sky/TimeOfDay.js';
import {
  applyCloudLightingState,
  resolveCloudLightingState,
} from '../src/engine/sky/CloudLightingState.js';
import { createCloudSlabMaterial } from '../src/engine/sky/CloudSlabShader.js';
import { createCloudMaterial } from '../src/engine/sky/CloudVolumeShader.js';
import { PlanetCloudChunks } from '../src/engine/sky/PlanetCloudChunks.js';
import * as THREE from 'three';

function luminance(rgb) {
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

describe('cloud atmospheric lighting', () => {
  it('makes procedural night ambience much darker than noon', () => {
    const common = {
      proceduralSkyActive: true,
      params: {
        skyboxBrightness: 1,
        visualsSkyIntensity: 1.08,
        visualsAtmosphereTint: [1, 1, 1],
      },
      sunDirection: [0, 1, 0],
    };
    const night = resolveCloudLightingState({
      ...common,
      timeOfDay: evaluateTimeOfDay(0),
    });
    const noon = resolveCloudLightingState({
      ...common,
      timeOfDay: evaluateTimeOfDay(0.5),
    });

    expect(night.source).toBe('procedural-sky');
    expect(luminance(night.ambientTopColor)).toBeLessThan(
      luminance(noon.ambientTopColor) * 0.08,
    );
    expect(luminance(night.directLightColor)).toBeLessThan(
      luminance(noon.directLightColor) * 0.03,
    );
  });

  it('passes atmosphere tint and sky brightness into procedural ambience', () => {
    const state = resolveCloudLightingState({
      proceduralSkyActive: true,
      timeOfDay: evaluateTimeOfDay(0.5),
      params: {
        skyboxBrightness: 2,
        visualsSkyIntensity: 1,
        visualsAtmosphereTint: [0.25, 1, 0.5],
        skyboxHaze: 1,
      },
    });

    expect(state.ambientTopColor[1]).toBeGreaterThan(state.ambientTopColor[0]);
    expect(state.ambientTopColor[2]).toBeGreaterThan(state.ambientTopColor[0]);
    expect(state.ambientBottomColor).not.toEqual(state.ambientTopColor);
  });

  it('uses the terrain lighting model when the procedural sky is inactive', () => {
    const state = resolveCloudLightingState({
      proceduralSkyActive: false,
      sunDirection: [1, 0, 0],
      terrainSunColor: [0.8, 0.4, 0.2],
      terrainSunIntensity: 2,
      terrainSkyAmbient: [0.2, 0.4, 0.6],
      terrainGroundBounce: [0.4, 0.2, 0.1],
    });

    expect(state.source).toBe('terrain-lighting');
    expect(state.directLightColor).toEqual([1.6, 0.8, 0.4]);
    expect(state.ambientTopColor).toEqual([0.1, 0.2, 0.3]);
    expect(state.groundBounceColor).toEqual([0.1, 0.05, 0.025]);
  });

  it('exposes and updates the atmospheric uniforms on both cloud materials', () => {
    const state = {
      sunDirection: [0, -1, 0],
      directLightColor: [0.8, 0.4, 0.2],
      ambientTopColor: [0.1, 0.2, 0.3],
      ambientBottomColor: [0.3, 0.2, 0.1],
      groundBounceColor: [0.02, 0.03, 0.04],
    };
    const materials = [createCloudSlabMaterial(8, 1, 2, 0, false, 1), createCloudMaterial()];

    for (const material of materials) {
      applyCloudLightingState(material.uniforms, state);
      expect(material.uniforms.uCloudDirectLight.value.toArray()).toEqual(state.directLightColor);
      expect(material.uniforms.uCloudAmbientTop.value.toArray()).toEqual(state.ambientTopColor);
      expect(material.uniforms.uCloudSunDir.value.toArray()).toEqual([0, -1, 0]);
      expect(material.fragmentShader).toContain('cl_sunVisibility');
      expect(material.fragmentShader).toContain('uCloudAtmosphereInfluence');
      material.dispose();
    }
  });

  it('shares the atmospheric uniforms across chunked planet clouds', () => {
    const scene = new THREE.Scene();
    const chunks = new PlanetCloudChunks(scene, { planetRadius: 16000, faceGrid: 1 });
    const state = {
      sunDirection: [1, 0, 0],
      directLightColor: [0.7, 0.3, 0.1],
      ambientTopColor: [0.1, 0.15, 0.2],
      ambientBottomColor: [0.2, 0.1, 0.05],
      groundBounceColor: [0.03, 0.02, 0.01],
    };

    chunks.setLighting(state);
    for (const chunk of chunks.chunks) {
      expect(chunk.material.uniforms.uCloudDirectLight).toBe(chunks.shared.uCloudDirectLight);
      expect(chunk.material.uniforms.uCloudAmbientTop).toBe(chunks.shared.uCloudAmbientTop);
      expect(chunk.material.uniforms.uCloudDirectLight.value.toArray()).toEqual(state.directLightColor);
    }

    chunks.dispose();
  });
});
