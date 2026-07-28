import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/engine/Engine.js';
import { CLOUD_DEFAULT_PARAMS } from '../src/engine/sky/CloudSettings.js';
import { CloudSlabLayer } from '../src/engine/sky/CloudSlabLayer.js';
import { createTerrainUniforms } from '../src/engine/terrain/TerrainMaterial.js';

describe('terrain atmosphere lighting', () => {
  it('converts resolved sky radiance into the terrain lighting uniforms', () => {
    const engine = Object.create(Engine.prototype);
    engine.uniforms = createTerrainUniforms();
    engine._skyActive = () => true;

    engine._syncTerrainLighting({
      ambientTopColor: [0.12, 0.24, 0.36],
      ambientBottomColor: [0.30, 0.18, 0.06],
      groundBounceColor: [0.025, 0.05, 0.075],
    }, {
      sunColor: [0.9, 0.45, 0.2],
      lightIntensity: 0.35,
    });

    expect(engine.uniforms.uTerrainSunCol.value.toArray()).toEqual([0.9, 0.45, 0.2]);
    expect(engine.uniforms.uTerrainSunIntensity.value).toBeCloseTo(0.35);
    expect(engine.uniforms.uTerrainSkyAmb.value.toArray()).toEqual([
      (0.12 * 0.7 + 0.30 * 0.3) * 2,
      (0.24 * 0.7 + 0.18 * 0.3) * 2,
      (0.36 * 0.7 + 0.06 * 0.3) * 2,
    ]);
    expect(engine.uniforms.uTerrainBounce.value.toArray()).toEqual([0.1, 0.2, 0.3]);
  });

  it('enables projected cloud shadows only for the live Tile cloud slab', () => {
    const center = new THREE.Vector2(120, -80);
    const wind = new THREE.Vector3(0.04, 0, 0.02);
    const engine = Object.create(Engine.prototype);
    engine.worldMode = 'studio';
    engine.params = {
      cloudsEnabled: true,
      cloudShadowsEnabled: true,
      cloudShadowOpacity: 1,
    };
    engine.uniforms = createTerrainUniforms();
    engine.studioCloud = {
      getTerrainShadowState: () => ({
        center,
        extent: 1800,
        altitude: 720,
        scale: 0.0012,
        coverage: 0.6,
        softness: 0.18,
        wind,
        time: 4.5,
        rotation: 0.2,
        evolve: 0.03,
      }),
    };

    engine._syncTerrainCloudShadows();

    expect(engine.uniforms.uTerrainCloudShadowEnabled.value).toBe(1);
    expect(engine.uniforms.uTerrainCloudShadowStrength.value).toBe(0.85);
    expect(engine.uniforms.uTerrainCloudShadowCenter.value.toArray()).toEqual([120, -80]);
    expect(engine.uniforms.uTerrainCloudShadowAltitude.value).toBe(720);
    expect(engine.uniforms.uTerrainCloudShadowScale.value).toBe(0.0012);
    expect(engine.uniforms.uTerrainCloudShadowWind.value.toArray()).toEqual(wind.toArray());
    expect(engine.uniforms.uTerrainCloudShadowTime.value).toBe(4.5);

    engine.worldMode = 'planet';
    engine._syncTerrainCloudShadows();
    expect(engine.uniforms.uTerrainCloudShadowEnabled.value).toBe(0);
  });

  it('exposes the live animated cloud field used by terrain shadows', () => {
    const layer = new CloudSlabLayer(new THREE.Scene());
    layer.applyParams({
      ...CLOUD_DEFAULT_PARAMS,
      cloudsEnabled: true,
      cloudCoverage: 0.62,
      cloudSoftness: 0.2,
      cloudScale: 2.6,
    }, 1000, 2048, null, {
      extent: 3200,
      center: { x: 160, z: -240 },
    });
    layer._occBuiltAt = performance.now();
    layer.update(0.5, new THREE.Vector3(0, 500, 0), new THREE.Vector3(0, 1, 0));

    const state = layer.getTerrainShadowState();
    expect(state.center.toArray()).toEqual([160, -240]);
    expect(state.extent).toBeCloseTo(3200 * 0.62);
    expect(state.scale).toBeCloseTo(2.6 / 2048);
    expect(state.coverage).toBeCloseTo(0.62);
    expect(state.softness).toBeCloseTo(0.2);
    expect(state.time).toBeCloseTo(0.5);
    expect(state.rotation).toBeGreaterThan(0);

    layer.dispose();
  });
});
