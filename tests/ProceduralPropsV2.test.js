import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_PARAMS } from '../src/engine/presets.js';
import { PROPS_RESET_KEYS, patchParamsFromDefaults } from '../src/engine/panelResets.js';
import {
  createPerfSettings,
  PERF_PRESETS,
  sanitizePerfSettings,
} from '../src/engine/render/PerformanceSettings.js';
import { GpuHeightSampler } from '../src/engine/terrain/GpuHeightSampler.js';
import {
  ProceduralPropsManager,
  PROP_QUALITY_BUDGETS,
} from '../src/engine/props/ProceduralPropsManager.js';
import { macroDensity, shouldPlaceType } from '../src/engine/props/PropPlacement.js';
import { getPropType, PROP_TYPES, scoreProp } from '../src/engine/props/propCatalog.js';

function sampleAt(x = 0, z = 0, patch = {}) {
  return {
    position: [x, 12, z],
    normal: new THREE.Vector3(0, 1, 0),
    slope: 0.08,
    shoreDistance: 20,
    water: false,
    height: 12,
    heightScale: 560,
    temperature: 0.55,
    moisture: 0.8,
    biomeWeights: { desert: 0, canyon: 0, wetland: 0, mountains: 0.05 },
    mask: null,
    excludeProps: 0,
    ...patch,
  };
}

function propParams(patch = {}) {
  return {
    propsEnabled: true,
    propsDensity: 1,
    propsGrassDensity: 1,
    propsGrass: 1,
    propsFlowers: 1,
    propsRocks: 1,
    propsRockScale: 1,
    propsTreeDensity: 1,
    propsTreeScale: 1,
    propsWind: 0.6,
    propsWindSpeed: 1.6,
    propsGust: 0.45,
    propsCullDistance: 120,
    propsLodDistance: 70,
    chunkSize: 128,
    planetRadius: 16000,
    seaLevel: 0,
    seed: 7,
    ...patch,
  };
}

function makeSampler() {
  return {
    beginBatch: vi.fn(),
    endBatch: vi.fn(),
    paintDensityAt: vi.fn(() => 0),
    sampleAt: vi.fn((x, z) => sampleAt(x, z)),
  };
}

function triangleCount(geometry) {
  return geometry.index
    ? geometry.index.count / 3
    : geometry.getAttribute('position').count / 3;
}

describe('optimized procedural prop catalog', () => {
  it('defines independent grass, flower, rock, broadleaf, and conifer layers', () => {
    expect(PROP_TYPES.map((type) => type.id)).toEqual([
      'grass', 'flower', 'rock', 'broadleaf', 'conifer',
    ]);
    expect(new Set(PROP_TYPES.map((type) => type.cellSize)).size).toBe(5);

    const sample = sampleAt();
    const params = propParams();
    expect(shouldPlaceType(getPropType('grass'), sample, params, { roll: 0, macro: 1 })).toBe(true);
    expect(shouldPlaceType(getPropType('broadleaf'), sample, params, { roll: 0, macro: 1 })).toBe(true);
  });

  it('is deterministic and changes macro patches only when the seed changes', () => {
    const a = macroDensity(137.5, -89.25, 42, 31);
    expect(macroDensity(137.5, -89.25, 42, 31)).toBe(a);
    expect(macroDensity(137.5, -89.25, 43, 31)).not.toBe(a);
  });

  it('applies water, shoreline, slope, biome, and spline exclusions before spawning', () => {
    const grass = getPropType('grass');
    const broadleaf = getPropType('broadleaf');
    const rock = getPropType('rock');
    expect(scoreProp(grass, sampleAt(0, 0, { water: true, shoreDistance: -1 }))).toBe(0);
    expect(scoreProp(grass, sampleAt(0, 0, { shoreDistance: 0.1 }))).toBe(0);
    expect(scoreProp(broadleaf, sampleAt(0, 0, { slope: 0.8 }))).toBe(0);
    expect(scoreProp(rock, sampleAt(0, 0, { excludeProps: 1 }))).toBe(0);
    expect(scoreProp(broadleaf, sampleAt(0, 0, {
      moisture: 0.05,
      biomeWeights: { desert: 1, canyon: 0, wetland: 0, mountains: 0 },
    }))).toBe(0);
  });

  it('keeps default physical scales in the intended world-unit ranges', () => {
    const manager = new ProceduralPropsManager(new THREE.Scene());
    const params = propParams();
    for (let i = 0; i < 64; i++) {
      const grass = manager._composeItem(getPropType('grass'), sampleAt(), i, i * 3, params, 0.5);
      const flower = manager._composeItem(getPropType('flower'), sampleAt(), i, i * 3, params, 0.5);
      const rock = manager._composeItem(getPropType('rock'), sampleAt(), i, i * 3, params, 0.5);
      const broadleaf = manager._composeItem(getPropType('broadleaf'), sampleAt(), i, i * 3, params, 0.5);
      const conifer = manager._composeItem(getPropType('conifer'), sampleAt(), i, i * 3, params, 0.5);
      expect(grass.scale[1]).toBeGreaterThanOrEqual(0.25);
      expect(grass.scale[1]).toBeLessThanOrEqual(0.75);
      expect(flower.scale).toBeGreaterThanOrEqual(0.25);
      expect(flower.scale).toBeLessThanOrEqual(0.9);
      expect(rock.scale[0] * 2).toBeGreaterThanOrEqual(0.6);
      expect(rock.scale[0] * 2).toBeLessThanOrEqual(6);
      expect(rock.scale[2] * 2).toBeGreaterThanOrEqual(0.56);
      expect(rock.scale[2] * 2).toBeLessThanOrEqual(6);
      expect(broadleaf.scale).toBeGreaterThanOrEqual(8);
      expect(broadleaf.scale).toBeLessThanOrEqual(18);
      expect(conifer.scale).toBeGreaterThanOrEqual(10);
      expect(conifer.scale).toBeLessThanOrEqual(24);
      expect(rock.pos[1]).toBeLessThan(12);
      expect(broadleaf.pos[1]).toBeLessThan(12);
    }
    manager.dispose();
  });

  it('keeps neighboring tree grid winners separated', () => {
    const manager = new ProceduralPropsManager(new THREE.Scene());
    for (let z = -12; z <= 12; z++) {
      for (let x = -12; x <= 12; x++) {
        if (!manager._treeSpacingWinner(x, z, 91, 334)) continue;
        expect(manager._treeSpacingWinner(x + 1, z, 91, 334)).toBe(false);
        expect(manager._treeSpacingWinner(x, z + 1, 91, 334)).toBe(false);
      }
    }
    manager.dispose();
  });
});

describe('optimized prop performance architecture', () => {
  it('maps renderer presets to the specified quality budgets', () => {
    expect(PROP_QUALITY_BUDGETS).toEqual([
      expect.objectContaining({ grass: 900, flowers: 80, rocks: 180, trees: 440, distanceScale: 0.65, buildMs: 1.5 }),
      expect.objectContaining({ grass: 1800, flowers: 180, rocks: 320, trees: 900, distanceScale: 1, buildMs: 2.5 }),
      expect.objectContaining({ grass: 2800, flowers: 260, rocks: 480, trees: 1400, distanceScale: 1.15, buildMs: 3 }),
      expect.objectContaining({ grass: 5000, flowers: 450, rocks: 800, trees: 2500, distanceScale: 1.35, buildMs: 4 }),
    ]);
    expect(['performance', 'balanced', 'high', 'ultra'].map((key) => PERF_PRESETS[key].propQuality))
      .toEqual([0, 1, 2, 3]);
    expect(sanitizePerfSettings({ ...createPerfSettings('balanced'), propQuality: undefined }).propQuality).toBe(1);
  });

  it('stays under the geometry and nine-batch ceilings', () => {
    const manager = new ProceduralPropsManager(new THREE.Scene());
    expect(triangleCount(manager.rockNearGeometry)).toBeLessThanOrEqual(96);
    expect(triangleCount(manager.rockFarGeometry)).toBeLessThanOrEqual(20);
    expect(triangleCount(manager.broadleafNearGeometry)).toBeLessThan(240);
    expect(triangleCount(manager.coniferNearGeometry)).toBeLessThan(240);
    expect(manager.grassNearMaterial.transparent).toBe(false);
    expect(manager.grassNearMaterial.depthWrite).toBe(true);

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    camera.position.set(0, 80, 120);
    const sampler = makeSampler();
    const input = {
      mode: 'studio', camera, params: propParams(), perf: createPerfSettings('balanced'),
      boardSize: 512, sampler, terrainRevision: 1, centerOverride: { x: 0, z: 0 },
    };
    do manager.update(input); while (manager.getDiagnostics().queuedSectors > 0);
    const diagnostics = manager.getDiagnostics();
    expect(diagnostics.drawCalls).toBeLessThanOrEqual(9);
    expect(diagnostics.triangles).toBeLessThanOrEqual(65_000);
    expect(diagnostics.instances.grass).toBeLessThanOrEqual(PROP_QUALITY_BUDGETS[1].grass);
    expect(diagnostics.instances.flowers).toBeLessThanOrEqual(PROP_QUALITY_BUDGETS[1].flowers);
    expect(diagnostics.instances.rocks).toBeLessThanOrEqual(PROP_QUALITY_BUDGETS[1].rocks);
    expect(diagnostics.instances.trees).toBeLessThanOrEqual(PROP_QUALITY_BUDGETS[1].trees);
    manager.dispose();
  });

  it('does no terrain sampling when only the camera rotates', () => {
    const manager = new ProceduralPropsManager(new THREE.Scene());
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    camera.position.set(0, 80, 120);
    const sampler = makeSampler();
    const input = {
      mode: 'studio', camera, params: propParams(), boardSize: 512,
      sampler, terrainRevision: 1, centerOverride: { x: 0, z: 0 },
    };
    manager.update(input);
    const samples = sampler.sampleAt.mock.calls.length;
    camera.rotation.y += 1.2;
    camera.updateMatrixWorld(true);
    manager.update(input);
    expect(sampler.sampleAt).toHaveBeenCalledTimes(samples);
    expect(sampler.beginBatch).toHaveBeenCalledOnce();
    expect(sampler.endBatch).toHaveBeenCalledOnce();
    manager.dispose();
  });

  it('samples only newly entered sectors during movement', () => {
    const manager = new ProceduralPropsManager(new THREE.Scene());
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    const sampler = makeSampler();
    const base = {
      mode: 'infinite', camera, params: propParams(), boardSize: 512,
      sampler, terrainRevision: 1,
    };
    manager.update(base);
    const initial = sampler.sampleAt.mock.calls.length;
    camera.position.x = 192;
    manager.update(base);
    const delta = sampler.sampleAt.mock.calls.length - initial;
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThan(initial);
    manager.dispose();
  });

  it('invalidates only sectors intersecting dirty paint bounds', () => {
    const manager = new ProceduralPropsManager(new THREE.Scene());
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    const sampler = makeSampler();
    const base = {
      mode: 'studio', camera, params: propParams(), boardSize: 512,
      sampler, terrainRevision: 1, centerOverride: { x: 0, z: 0 },
      paintLayers: { revision: 0 },
    };
    manager.update(base);
    const initial = sampler.sampleAt.mock.calls.length;
    manager.update({
      ...base,
      paintLayers: { revision: 1 },
      dirtyBounds: { minX: 4, maxX: 20, minZ: 4, maxZ: 20 },
    });
    const delta = sampler.sampleAt.mock.calls.length - initial;
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThan(initial);
    manager.dispose();
  });

  it('clips candidates before terrain sampling', () => {
    const manager = new ProceduralPropsManager(new THREE.Scene());
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    const sampler = makeSampler();
    manager.update({
      mode: 'studio', camera, params: propParams(), boardSize: 512,
      sampler, terrainRevision: 1, centerOverride: { x: 0, z: 0 },
      containsPoint: (x, z) => Math.hypot(x, z) <= 60,
    });
    for (const [x, z] of sampler.sampleAt.mock.calls) expect(Math.hypot(x, z)).toBeLessThanOrEqual(60);
    manager.dispose();
  });

  it('locks one GPU surface tile and falls back outside it during a batch', () => {
    const cpu = { heightAt: vi.fn(() => 17) };
    const sampler = new GpuHeightSampler({
      renderer: {}, scene: new THREE.Scene(), uniforms: { uHeightScale: { value: 100 } },
      cpuSampler: cpu, isTerrainMaterial: () => true, getGeneration: () => 3,
      getMaxHeight: () => 100, tileSize: 8, tileWorld: 64, edgeMargin: 8,
    });
    const renderTile = vi.spyOn(sampler, '_renderTile').mockImplementation((x, z) => {
      sampler._cx = x;
      sampler._cz = z;
      sampler._valid = true;
    });
    sampler.beginBatch(0, 0);
    expect(sampler.heightAt(1000, 1000)).toBe(17);
    expect(sampler.heightAt(-1000, -1000)).toBe(17);
    sampler.endBatch();
    expect(renderTile).toHaveBeenCalledOnce();
    expect(cpu.heightAt).toHaveBeenCalledTimes(2);
  });

  it('uses radial up and buried roots for Planet placement', () => {
    const manager = new ProceduralPropsManager(new THREE.Scene());
    const desc = getPropType('broadleaf');
    const dir = new THREE.Vector3(0, 0, 1);
    const item = manager._composeItem(
      desc,
      sampleAt(0, 0, { surfaceRadius: 16040, normal: new THREE.Vector3(0.1, 0, 0.995).normalize() }),
      2, 5, propParams(), 0.8, dir,
    );
    expect(item.normal).toEqual([0, 0, 1]);
    expect(item.pos[2]).toBeLessThan(16040);
    expect(item.pos[0]).toBe(0);
    expect(item.pos[1]).toBe(0);
    manager.dispose();
  });

  it('skips invisible orbit scatter and rebuilds progressively on Planet descent', () => {
    const manager = new ProceduralPropsManager(new THREE.Scene());
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100000);
    const planetSampler = {
      sampleAt3D: vi.fn((x, y, z) => sampleAt(x, z, {
        position: [x * 16012, y * 16012, z * 16012],
        normal: new THREE.Vector3(x, y, z),
        surfaceRadius: 16012,
      })),
    };
    const input = {
      mode: 'planet', camera, params: propParams(), perf: createPerfSettings('balanced'),
      boardSize: 512, planetSampler, terrainRevision: 1,
    };
    camera.position.set(0, 0, 40000);
    manager.update(input);
    expect(planetSampler.sampleAt3D).not.toHaveBeenCalled();
    expect(manager.getDiagnostics().drawCalls).toBe(0);

    camera.position.set(0, 0, 16020);
    do manager.update(input); while (manager.getDiagnostics().queuedSectors > 0);
    expect(planetSampler.sampleAt3D).toHaveBeenCalled();
    expect(Object.values(manager.getDiagnostics().instances).reduce((sum, count) => sum + count, 0))
      .toBeGreaterThan(0);
    manager.dispose();
  });

  it('keeps lower-quality survivors as a stable subset and resets new keys', () => {
    const manager = new ProceduralPropsManager(new THREE.Scene());
    const items = Array.from({ length: 1000 }, (_, index) => ({
      render: 'grass', pos: [index * 0.05, 0, 0], normal: [0, 1, 0],
      yaw: 0, scale: 1, alignAmount: 0, tint: [1, 1, 1], priority: index / 1000,
    }));
    const empty = { flower: [], rock: [], broadleaf: [], conifer: [] };
    const positions = () => {
      const result = new Set();
      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      for (const mesh of manager.meshes.filter((entry) => entry.name.startsWith('procedural-grass'))) {
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix);
          position.setFromMatrixPosition(matrix);
          result.add(position.x.toFixed(4));
        }
      }
      return result;
    };
    manager._qualityBudget = PROP_QUALITY_BUDGETS[0];
    manager._commitBuckets({ grass: items, ...empty }, new THREE.Vector3(), 1000, propParams(), false);
    const performance = positions();
    manager._qualityBudget = PROP_QUALITY_BUDGETS[2];
    manager._commitBuckets({ grass: items, ...empty }, new THREE.Vector3(), 1000, propParams(), false);
    const high = positions();
    expect(performance.size).toBe(900);
    expect([...performance].every((position) => high.has(position))).toBe(true);

    expect(PROPS_RESET_KEYS).toEqual(expect.arrayContaining([
      'propsGrassDensity', 'propsTreeDensity', 'propsTreeScale',
    ]));
    const reset = patchParamsFromDefaults({
      propsGrassDensity: 0, propsTreeDensity: 0, propsTreeScale: 2,
    }, PROPS_RESET_KEYS);
    expect(reset).toMatchObject({
      propsGrassDensity: DEFAULT_PARAMS.propsGrassDensity,
      propsTreeDensity: DEFAULT_PARAMS.propsTreeDensity,
      propsTreeScale: DEFAULT_PARAMS.propsTreeScale,
    });
    manager.dispose();
  });
});
