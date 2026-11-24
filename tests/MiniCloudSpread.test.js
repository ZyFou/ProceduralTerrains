import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createMiniTerrainState, miniParamsPatch, normalizeMiniTerrainState, resolveMiniCloudLayout, resolveMiniLayout } from '../src/engine/mini/MiniTerrainSettings.js';
import { MiniTerrainController } from '../src/engine/mini/MiniTerrainController.js';
import { CloudSlabLayer } from '../src/engine/sky/CloudSlabLayer.js';
import { CLOUD_DEFAULT_PARAMS } from '../src/engine/sky/CloudSettings.js';

describe('Mini cloud spread', () => {
  it.each([512, 1024, 2048])('matches the circular terrain diameter at width %s', (width) => {
    const state = { ...createMiniTerrainState(), shape: 'circle', width, cloudSpread: 100 };
    expect(resolveMiniCloudLayout(state).radius).toBe(resolveMiniLayout(state).half);
    expect(resolveMiniCloudLayout({ ...state, cloudSpread: 50 }).radius).toBe(width / 4);
  });

  it('preserves the legacy generation radius for saved projects without spread', () => {
    const state = normalizeMiniTerrainState({ recipe: 'procedural', width: 1024, shape: 'circle' });
    expect(resolveMiniCloudLayout(state).radius).toBeCloseTo(1024 * 1.15 * 0.62);
    expect(normalizeMiniTerrainState(JSON.parse(JSON.stringify({ ...state, cloudSpread: 65 }))).cloudSpread).toBe(65);
    expect(normalizeMiniTerrainState({ ...state, cloudSpread: -5 }).cloudSpread).toBe(10);
    expect(normalizeMiniTerrainState({ ...state, cloudSpread: 500 }).cloudSpread).toBe(200);
  });

  it('changes the live volume without changing cloud shapes, culling distance, or terrain', () => {
    const controller = new MiniTerrainController({ worldMode: 'studio' });
    controller.state = { ...createMiniTerrainState(), cloudSpread: 142.6 };
    const plan = controller.planChange({ cloudSpread: 50 });
    expect(plan.composition).toBe(false);
    expect(plan.params).toEqual({});
    const layer = new CloudSlabLayer(new THREE.Scene());
    const params = { ...CLOUD_DEFAULT_PARAMS, cloudsEnabled: true };
    layer.applyParams(params, 100, 1024, {}, controller.cloudLayout());
    const material = layer.material;
    const frequency = material.uniforms.uCloudScale.value;
    const cullDistance = layer._maxDistance;
    controller.state = plan.state;
    layer.applyParams(params, 100, 1024, {}, controller.cloudLayout());
    expect(layer.material).toBe(material);
    expect(material.uniforms.uCloudRadius.value).toBe(256);
    expect(material.uniforms.uOccExtent.value).toBe(256);
    expect(material.uniforms.uCloudScale.value).toBe(frequency);
    expect(layer._maxDistance).toBe(cullDistance);
    expect(layer.mesh.scale.x).toBeCloseTo(256 * 2.1);
    layer.dispose();
  });
  it('switches the cloud footprint between circle (default) and square', () => {
    const state = createMiniTerrainState();
    expect(state.cloudShape).toBe('circle');
    expect(normalizeMiniTerrainState({ recipe: 'procedural' }).cloudShape).toBe('circle');
    expect(normalizeMiniTerrainState({ ...state, cloudShape: 'hexagon' }).cloudShape).toBe('circle');
    expect(resolveMiniCloudLayout(state).shape).toBe('circle');

    const controller = new MiniTerrainController({ worldMode: 'studio' });
    controller.state = state;
    const plan = controller.planChange({ cloudShape: 'square' });
    expect(plan.composition).toBe(false);
    expect(plan.params).toEqual({});
    const layer = new CloudSlabLayer(new THREE.Scene());
    const params = { ...CLOUD_DEFAULT_PARAMS, cloudsEnabled: true };
    layer.applyParams(params, 100, 1024, {}, controller.cloudLayout());
    expect(layer.material.uniforms.uCloudSquare.value).toBe(0);
    controller.state = plan.state;
    layer.applyParams(params, 100, 1024, {}, controller.cloudLayout());
    expect(layer.material.uniforms.uCloudSquare.value).toBe(1);
    expect(layer.material.fragmentShader).toContain('cloudFootprintClip');
    layer.dispose();
  });

  it.each(['procedural', 'cove', 'islet', 'lake'])('enables clouds in a newly created %s Mini', (recipe) => {
    const state = createMiniTerrainState({ recipe });
    expect(state.clouds).toBeGreaterThan(0.04);
    expect(miniParamsPatch(state).cloudsEnabled).toBe(true);
  });

  it('preserves explicitly disabled clouds in an existing Mini document', () => {
    const saved = { ...createMiniTerrainState(), clouds: 0 };
    expect(normalizeMiniTerrainState(JSON.parse(JSON.stringify(saved))).clouds).toBe(0);
    expect(miniParamsPatch(saved).cloudsEnabled).toBe(false);
  });

});
