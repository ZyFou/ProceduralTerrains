import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  CINEMATIC_WATER_SEGMENTS,
  createCinematicWaterGeometry,
  getWaterGeometryDiagnostics,
  resolveCinematicWaterSegments,
  shouldUseCinematicWaterGeometry,
} from '../src/engine/water/CinematicWaterGeometry.js';
import { createTerrainUniforms } from '../src/engine/terrain/TerrainMaterial.js';
import { createRealisticWaterMaterial } from '../src/engine/water/RealisticWaterMaterial.js';
import { WaterSystem } from '../src/engine/water/WaterSystem.js';

describe('Cinematic water geometry', () => {
  it('maps water quality to bounded grid densities', () => {
    expect(resolveCinematicWaterSegments(0)).toBe(CINEMATIC_WATER_SEGMENTS.low);
    expect(resolveCinematicWaterSegments(1)).toBe(CINEMATIC_WATER_SEGMENTS.medium);
    expect(resolveCinematicWaterSegments(2)).toBe(CINEMATIC_WATER_SEGMENTS.high);
    expect(resolveCinematicWaterSegments(99)).toBe(CINEMATIC_WATER_SEGMENTS.high);
  });

  it('keeps the exact legacy unit-plane footprint', () => {
    const geometry = createCinematicWaterGeometry(16);
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;

    expect(bounds.min.x).toBeCloseTo(-0.5);
    expect(bounds.max.x).toBeCloseTo(0.5);
    expect(bounds.min.z).toBeCloseTo(-0.5);
    expect(bounds.max.z).toBeCloseTo(0.5);
    expect(bounds.min.y).toBeCloseTo(0);
    expect(bounds.max.y).toBeCloseTo(0);
    expect(getWaterGeometryDiagnostics(geometry)).toMatchObject({
      mode: 'camera-density-grid',
      segments: 16,
      vertices: 289,
      triangles: 512,
    });
    geometry.dispose();
  });

  it('uses the dense grid only for non-downgraded Cinematic Tile water', () => {
    expect(shouldUseCinematicWaterGeometry('cinematic', 'studio')).toBe(true);
    expect(shouldUseCinematicWaterGeometry('cinematic', 'studio', true)).toBe(false);
    expect(shouldUseCinematicWaterGeometry('volumetric', 'studio')).toBe(false);
    expect(shouldUseCinematicWaterGeometry('cinematic', 'infinite')).toBe(false);
    expect(shouldUseCinematicWaterGeometry('cinematic', 'planet')).toBe(false);
  });

  it('swaps lazily, preserves scale, anchors focus, and disposes on exit', () => {
    const baseGeometry = new THREE.PlaneGeometry(1, 1);
    baseGeometry.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(baseGeometry);
    water.scale.set(2048, 1, 1536);
    water.position.set(120, 80, -40);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(530, 220, -310);
    const engine = {
      water,
      camera,
      params: {
        seaLevel: 80,
        waterEnabled: true,
        waterMode: 'cinematic',
        waterShowPerfCost: false,
      },
      perf: { waterQuality: 1 },
      worldMode: 'studio',
    };
    const system = new WaterSystem(engine);
    system._effectiveMode = 'cinematic';
    system._realisticStudio = createRealisticWaterMaterial(
      createTerrainUniforms(),
    );
    const originalScale = water.scale.clone();

    system._syncStudioGeometry(engine.params, 'studio');
    const cinematicGeometry = water.geometry;
    const dispose = vi.spyOn(cinematicGeometry, 'dispose');

    expect(cinematicGeometry).not.toBe(baseGeometry);
    expect(cinematicGeometry.userData.cinematicWater).toBe(true);
    expect(cinematicGeometry.userData.segments)
      .toBe(CINEMATIC_WATER_SEGMENTS.medium);
    expect(water.scale).toEqual(originalScale);
    expect(system._realisticStudio.uniforms.uGeometryDisplacementEnabled.value)
      .toBe(1);
    expect(system._realisticStudio.uniforms.uGeometryFocus.value.x)
      .toBeCloseTo((camera.position.x - water.position.x) / water.scale.x);
    const anchoredFocus = system._realisticStudio.uniforms.uGeometryFocus.value
      .clone();
    camera.position.set(-760, 180, 690);
    system._syncStudioGeometry(engine.params, 'studio');
    expect(system._realisticStudio.uniforms.uGeometryFocus.value)
      .toEqual(anchoredFocus);
    expect(system.getSurfaceDiagnostics()).toMatchObject({
      mode: 'camera-density-grid',
      displaced: true,
      cameraFocused: true,
      focusAnchored: true,
    });

    system._effectiveMode = 'realistic';
    system._syncStudioGeometry(engine.params, 'studio');
    expect(water.geometry).toBe(baseGeometry);
    expect(water.scale).toEqual(originalScale);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(system._realisticStudio.uniforms.uGeometryDisplacementEnabled.value)
      .toBe(0);

    system.dispose();
    baseGeometry.dispose();
  });

  it('aggregates surface and render-target costs without allocating passes', () => {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const water = new THREE.Mesh(geometry);
    const system = new WaterSystem({
      water,
      params: { waterShowPerfCost: true },
      perf: { waterQuality: 2 },
      worldMode: 'studio',
    });

    expect(system.getPerformanceDiagnostics()).toMatchObject({
      surface: {
        mode: 'single-quad',
        vertices: 4,
        triangles: 2,
        surfaceGpuMs: null,
        gpuTimingScope: 'whole-frame-only',
      },
      refraction: {
        allocated: false,
      },
      reflection: {
        allocated: false,
      },
      renderTargetMemoryBytes: 0,
      additionalSceneRenders: 0,
    });

    system.dispose();
    geometry.dispose();
  });
});
