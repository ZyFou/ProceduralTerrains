import { describe, expect, it } from 'vitest';
import { createTerrainUniforms } from '../src/engine/terrain/TerrainMaterial.js';
import {
  createRealisticWaterMaterial,
  setWaterDebugMode,
} from '../src/engine/water/RealisticWaterMaterial.js';
import {
  createWaterBaselineReport,
  getWaterBaselineScene,
  resolveWaterBaselineCamera,
  WATER_BASELINE_SCENES,
} from '../src/engine/water/WaterBaseline.js';
import { WATER_DEBUG_VIEWS } from '../src/engine/water/WaterDebugViews.js';

describe('water visual baselines', () => {
  it('defines the complete fixed comparison set', () => {
    expect(WATER_BASELINE_SCENES.map((scene) => scene.value)).toEqual([
      'deep-ocean-midday',
      'deep-ocean-sunset',
      'shallow-tropical-coast',
      'mountain-lake',
      'infinite-grazing',
      'surface-transition-above',
      'surface-transition-below',
    ]);
    expect(new Set(WATER_BASELINE_SCENES.map((scene) => scene.value)).size)
      .toBe(WATER_BASELINE_SCENES.length);
    expect(WATER_BASELINE_SCENES.every((scene) => (
      scene.worldMode === 'studio' || scene.worldMode === 'infinite'
    ))).toBe(true);
  });

  it('resolves camera transforms relative to sea level and board size', () => {
    const studio = resolveWaterBaselineCamera(
      getWaterBaselineScene('shallow-tropical-coast'),
      { seaLevel: 78, boardSize: 2000 },
    );
    expect(studio.kind).toBe('orbit');
    expect(studio.target).toEqual([280, 78, -160]);
    expect(studio.radius).toBe(680);

    const infinite = resolveWaterBaselineCamera(
      getWaterBaselineScene('infinite-grazing'),
      { seaLevel: 100, boardSize: 2000 },
    );
    expect(infinite.kind).toBe('first-person');
    expect(infinite.position).toEqual([0, 118, 320]);
    expect(infinite.yaw).toBeCloseTo(Math.PI);

    const above = resolveWaterBaselineCamera(
      getWaterBaselineScene('surface-transition-above'),
      { seaLevel: 100, boardSize: 2000 },
    );
    const below = resolveWaterBaselineCamera(
      getWaterBaselineScene('surface-transition-below'),
      { seaLevel: 100, boardSize: 2000 },
    );
    expect(above.target[1] + above.radius * Math.cos(above.phi)).toBeGreaterThan(100);
    expect(below.target[1] + below.radius * Math.cos(below.phi)).toBeLessThan(100);
  });

  it('builds a portable metrics report without unrelated project params', () => {
    const scene = getWaterBaselineScene('deep-ocean-midday');
    const report = createWaterBaselineReport({
      scene,
      params: {
        seed: 42,
        seaLevel: 78,
        waterMode: 'realistic',
        unrelatedProjectValue: 'excluded',
      },
      performance: {
        fps: 60,
        frame: { avg: 16.666 },
        gpu: { supported: true, frameMs: 8.123 },
        render: { calls: 12, triangles: 3456 },
      },
      captureStats: { drawCalls: 10, triangles: 3000 },
      shaderCompile: { totalMs: 22 },
    });

    expect(report.baseline.id).toBe(scene.value);
    expect(report.result).toMatchObject({
      fps: 60,
      cpuFrameMs: 16.67,
      gpuFrameMs: 8.12,
      drawCalls: 10,
      triangles: 3000,
      waterShaderCompile: { totalMs: 22 },
    });
    expect(report.params.unrelatedProjectValue).toBeUndefined();
  });
});

describe('water optical debug views', () => {
  it('maps every UI debug view to a distinct shader mode', () => {
    const material = createRealisticWaterMaterial(createTerrainUniforms());
    const modes = [];
    for (const { value } of WATER_DEBUG_VIEWS) {
      setWaterDebugMode(material, value);
      modes.push(material.uniforms.uDebugMode.value);
    }

    expect(modes).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(material.fragmentShader).toContain('float opticalDepth');
    expect(material.fragmentShader).toContain('vec3 transmittance');
    expect(material.fragmentShader).toContain('vec3 reflectionTerm');
    expect(material.fragmentShader).toContain('vec3 refractionTerm');
    material.dispose();
  });
});
