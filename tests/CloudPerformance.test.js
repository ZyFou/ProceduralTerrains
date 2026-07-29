import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  CloudAdaptiveQualityController,
} from '../src/engine/sky/CloudAdaptiveQualityController.js';
import { CloudOccupancyPass } from '../src/engine/sky/CloudOccupancyPass.js';
import { CloudLowResPass } from '../src/engine/sky/CloudLowResPass.js';
import {
  CLOUD_DEFAULT_PARAMS,
  normalizeCloudFormation,
} from '../src/engine/sky/CloudSettings.js';
import { CloudSlabLayer } from '../src/engine/sky/CloudSlabLayer.js';
import { createCloudSlabMaterial } from '../src/engine/sky/CloudSlabShader.js';
import { createCloudMaterial } from '../src/engine/sky/CloudVolumeShader.js';
import { InfiniteCloudLayer } from '../src/engine/sky/InfiniteCloudLayer.js';

describe('cloud performance pipeline', () => {
  it('normalizes legacy formations to the compiled soft formation', () => {
    expect(normalizeCloudFormation({ cloudNoiseVariant: 'wispy' }).cloudNoiseVariant)
      .toBe('soft');
    expect(normalizeCloudFormation({ cloudNoiseVariant: 'soft' }).cloudNoiseVariant)
      .toBe('soft');
  });

  it('contains no runtime formation uniform or variant branch', () => {
    for (const material of [createCloudSlabMaterial(), createCloudMaterial()]) {
      expect(material.uniforms.uCloudNoiseVariant).toBeUndefined();
      expect(material.fragmentShader).not.toContain('uCloudNoiseVariant');
      expect(material.fragmentShader).not.toContain('float variant =');
      material.dispose();
    }
    const occupancySource = createCloudSlabMaterial();
    const occupancy = new CloudOccupancyPass({}, occupancySource.uniforms);
    expect(occupancy.generateMaterial.fragmentShader).not.toContain('uCloudNoiseVariant');
    expect(occupancy.generateMaterial.fragmentShader).not.toContain('float variant =');
    occupancy.dispose();
    occupancySource.dispose();
  });

  it('uses near-biased intervals and their physical length for extinction', () => {
    for (const material of [createCloudSlabMaterial(), createCloudMaterial()]) {
      expect(material.fragmentShader).toContain('pow(clamp(a, 0.0, 1.0), 1.35)');
      expect(material.fragmentShader).toContain('pow(clamp(b, 0.0, 1.0), 1.35)');
      expect(material.fragmentShader).toContain('dens * stepLength * uCloudExtinction');
      expect(material.fragmentShader).not.toContain('skipped += 1.0');
      material.dispose();
    }
  });

  it('keeps the Studio sampling lattice stable across terrain depth edges', () => {
    const material = createCloudSlabMaterial();
    const source = material.fragmentShader;
    expect(source).toContain('float slabStart = t0;');
    expect(source).toContain('float slabEnd = t1;');
    expect(source).toContain('float segLen = slabEnd - slabStart;');
    expect(source).toContain('max(t1 - t, 0.0)');
    expect(source).not.toContain('whole-ray reject');
    material.dispose();
  });

  it('applies hysteresis, limits, and slow recovery to cloud-only scale', () => {
    const controller = new CloudAdaptiveQualityController({
      intervalMs: 1,
      highChecksToRecover: 3,
    });
    const first = controller.update({ now: 1, fps: 30, presetScale: 0.5 });
    expect(first.effectiveScale).toBeCloseTo(0.44);

    let now = 2;
    while (!controller.atScaleFloor(0.5)) {
      controller.update({ now: now++, fps: 30, presetScale: 0.5 });
    }
    expect(controller.effectiveScale(0.5)).toBe(0.25);

    const beforeRecovery = controller.effectiveScale(0.5);
    controller.update({ now: now++, fps: 60, presetScale: 0.5 });
    controller.update({ now: now++, fps: 60, presetScale: 0.5 });
    expect(controller.effectiveScale(0.5)).toBe(beforeRecovery);
    controller.update({ now: now++, fps: 60, presetScale: 0.5 });
    expect(controller.effectiveScale(0.5)).toBeGreaterThan(beforeRecovery);
  });

  it('resizes only the cloud target and does not rebuild its shader', () => {
    const pass = new CloudLowResPass();
    pass.scale = 0.5;
    pass._ensureRT(null, { x: 1000, y: 600 });
    expect([pass.rt.width, pass.rt.height]).toEqual([500, 300]);
    pass.scale = 0.44;
    pass._ensureRT(null, { x: 1000, y: 600 });
    expect([pass.rt.width, pass.rt.height]).toEqual([440, 264]);
    pass.dispose();

    const layer = new CloudSlabLayer(new THREE.Scene());
    layer.applyParams(
      { ...CLOUD_DEFAULT_PARAMS, cloudsEnabled: true },
      1000,
      2048,
      { cloudRenderScale: 0.5 },
    );
    const material = layer.material;
    layer.setAdaptiveQuality(0.8, 0.9);
    expect(layer.material).toBe(material);
    expect(layer.effectiveRenderScale).toBeCloseTo(0.4);
    layer.dispose();
  });

  it('keeps Infinite clouds bounded and continuous across chunk rebases', () => {
    const layer = new InfiniteCloudLayer(new THREE.Scene(), {
      chunkSize: 256,
      viewRadius: 8,
    });
    layer.applyParams(
      { ...CLOUD_DEFAULT_PARAMS, cloudsEnabled: true },
      1000,
      2048,
      { cloudRenderScale: 0.5, cloudSteps: 12 },
      { chunkSize: 256, viewRadius: 8 },
    );
    const sizeBefore = layer.mesh.scale.clone();
    layer.update(0, new THREE.Vector3(513, 200, -1), new THREE.Vector3(0, 1, 0));

    const u = layer.material.uniforms;
    expect(u.uCloudCenter.value.toArray()).toEqual([512, 0, -256]);
    expect(u.uCloudDomainOrigin.value.toArray()).toEqual([512, 0, -256]);
    expect(layer.mesh.scale.toArray()).toEqual(sizeBefore.toArray());

    const world = new THREE.Vector3(600, 500, -100);
    const local = world.clone().sub(u.uCloudDomainOrigin.value);
    const reconstructedNoisePoint = local.multiplyScalar(u.uCloudScale.value)
      .add(u.uCloudNoiseOffset.value);
    expect(reconstructedNoisePoint.x).toBeCloseTo(world.x * u.uCloudScale.value);
    expect(reconstructedNoisePoint.z).toBeCloseTo(world.z * u.uCloudScale.value);
    layer.dispose();
  });
});
