import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { PaintLayerManager } from '../src/paint/PaintLayerManager.js';
import { ManualSurfacePaintField } from '../src/manual/ManualSurfacePaintField.js';
import { ProceduralPropsManager } from '../src/engine/props/ProceduralPropsManager.js';
import { TerrainBoard } from '../src/engine/terrain/TerrainBoard.js';
import { PERF_PRESETS } from '../src/engine/render/PerformanceSettings.js';
import { WaterSystem } from '../src/engine/water/WaterSystem.js';

const paintUniforms = () => ({
  uPaintHeightTexture: { value: null },
  uPaintBiomeTexture: { value: null },
  uPaintPropsTexture: { value: null },
  uPaintResolution: { value: 0 },
  uPaintEnabled: { value: 0 },
});

describe('stage 1 paint upload batching', () => {
  it('bumps only the changed Paint texture once per frame', () => {
    const layers = new PaintLayerManager({
      uniforms: paintUniforms(),
      boardSize: 1024,
      resolution: 64,
    });
    const initial = {
      height: layers.heightTexture.version,
      biome: layers.biomeTexture.version,
      props: layers.propsTexture.version,
    };

    for (let i = 0; i < 4; i++) {
      layers.stamp({
        x: i,
        z: 0,
        radius: 24,
        strength: 0.7,
        falloff: 0.7,
        tool: 'raise',
      });
    }
    expect(layers.heightTexture.version).toBe(initial.height);
    expect(layers.flushUploads()).toBe(true);
    expect(layers.heightTexture.version).toBe(initial.height + 1);
    expect(layers.biomeTexture.version).toBe(initial.biome);
    expect(layers.propsTexture.version).toBe(initial.props);

    layers.stamp({
      x: 0,
      z: 0,
      radius: 24,
      strength: 0.7,
      falloff: 0.7,
      tool: 'biome',
      biome: 'wetland',
    });
    layers.flushUploads();
    expect(layers.heightTexture.version).toBe(initial.height + 1);
    expect(layers.biomeTexture.version).toBe(initial.biome + 1);
    expect(layers.propsTexture.version).toBe(initial.props);
    layers.dispose();
  });

  it('copies only the Smooth brush neighborhood', () => {
    const layers = new PaintLayerManager({
      uniforms: paintUniforms(),
      boardSize: 1024,
      resolution: 128,
    });
    const copy = vi.spyOn(layers, '_copyHeightRegion');
    layers.stamp({
      x: 0,
      z: 0,
      radius: 32,
      strength: 0.7,
      falloff: 0.7,
      tool: 'smooth',
    });
    expect(copy).toHaveBeenCalledOnce();
    expect(copy.mock.results[0].value.data.length).toBeLessThan(layers.heightDelta.length / 10);
    layers.dispose();
  });

  it('uploads only the packed Manual surface map that changed', () => {
    const field = new ManualSurfacePaintField({
      getBounds: () => ({ origin: { x: -512, z: -512 }, span: { x: 1024, z: 1024 } }),
      resolution: 64,
    });
    const versionA = field.textureA.version;
    const versionB = field.textureB.version;
    field.stamp({
      x: 0,
      z: 0,
      radius: 32,
      strength: 1,
      falloff: 0.7,
      tool: 'paint',
      materialChannel: 0,
    });
    expect(field.textureA.version).toBe(versionA);
    field.flushUploads();
    expect(field.textureA.version).toBe(versionA + 1);
    expect(field.textureB.version).toBe(versionB);

    const copy = vi.spyOn(field, '_copyRegion');
    field.stamp({
      x: 0,
      z: 0,
      radius: 32,
      strength: 1,
      falloff: 0.7,
      tool: 'blend',
    });
    expect(copy).toHaveBeenCalledTimes(2);
    expect(copy.mock.results[0].value.data.length).toBeLessThan(field.weightsA.length / 10);
    field.dispose();
  });
});

describe('stage 1 runtime stability', () => {
  it('does not rebuild unchanged props and reuses the instance batches', () => {
    const scene = new THREE.Scene();
    const manager = new ProceduralPropsManager(scene);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    camera.position.set(0, 90, 120);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const sampler = {
      prime: vi.fn(),
      sampleAt: vi.fn((x, z) => ({
        position: [x, 10, z],
        normal: new THREE.Vector3(0, 1, 0),
        slope: 0.1,
        shoreDistance: 20,
        height: 10,
        heightScale: 560,
        temperature: 0.55,
        moisture: 0.8,
        biomeWeights: { desert: 0, canyon: 0, wetland: 0.2, mountains: 0 },
        mask: null,
        excludeProps: 0,
      })),
    };
    const params = {
      propsEnabled: true,
      propsDensity: 1,
      propsGrass: 1,
      propsFlowers: 0.3,
      propsRocks: 0.8,
      propsRockScale: 0.7,
      propsWindSpeed: 1.6,
      propsGust: 0.45,
      propsCullDistance: 120,
      propsLodDistance: 70,
      seaLevel: 0,
      seed: 7,
    };
    const input = {
      mode: 'studio',
      camera,
      params,
      boardSize: 512,
      sampler,
      terrainRevision: 1,
    };

    manager.update(input);
    const firstSampleCount = sampler.sampleAt.mock.calls.length;
    const firstMeshes = [...manager.meshes];
    expect(firstSampleCount).toBeGreaterThan(0);
    expect(firstMeshes.length).toBeGreaterThan(0);

    manager.update(input);
    expect(sampler.sampleAt).toHaveBeenCalledTimes(firstSampleCount);

    manager.update({ ...input, terrainRevision: 2 });
    expect(sampler.sampleAt.mock.calls.length).toBeGreaterThan(firstSampleCount);
    expect(manager.meshes.some((mesh) => firstMeshes.includes(mesh))).toBe(true);
    manager.dispose();
  });

  it('reuses Tile culling scratch objects between frames', () => {
    const scene = new THREE.Scene();
    const material = new THREE.MeshBasicMaterial();
    const board = new TerrainBoard(scene, material);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    camera.position.set(0, 50, 100);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    board.group.add(mesh);
    board.chunkSize = 64;
    board._maxHeight = 200;
    board._skirtDepth = 40;
    board.chunks = [{
      center: new THREE.Vector3(0, 0, 0),
      mesh,
      merged: false,
    }];

    board.cull(camera);
    const first = {
      frustum: board._cullingContext.frustum,
      matrix: board._cullingContext.projScreenMatrix,
      sphere: board._cullingContext.sphere,
      activeArray: board._cullChunks,
    };
    board.cull(camera);
    expect(board._cullingContext.frustum).toBe(first.frustum);
    expect(board._cullingContext.projScreenMatrix).toBe(first.matrix);
    expect(board._cullingContext.sphere).toBe(first.sphere);
    expect(board._cullChunks).toBe(first.activeArray);

    board.dispose();
    mesh.geometry.dispose();
    material.dispose();
  });

  it('keeps circular boundary chunks at a stable configured LOD and prevents boundary nodes from folding', () => {
    const scene = new THREE.Scene();
    const material = new THREE.MeshBasicMaterial();
    const board = new TerrainBoard(scene, material);
    board.build({
      chunkCount: 4,
      chunkSize: 10,
      maxHeight: 100,
      skirtDepth: 20,
      cells: [{ cx: 0, cz: 0 }],
      progressive: false,
    });
    const boundary = { x: 0, z: 0, radius: 15, lod: 2 };
    expect(board.setCircularBoundary(boundary)).toBe(true);
    expect(board.setCircularBoundary({ ...boundary })).toBe(false);
    expect(board.setCircularBoundary({ ...boundary, lod: 1 })).toBe(true);
    expect(board.setCircularBoundary({ ...boundary, lod: 1 })).toBe(false);
    expect(board.setCircularBoundary(boundary)).toBe(true);
    expect(board._circularBoundary.lod).toBe(2);
    board.setMergeOptions({ mergeDistance: 0.5, macroEnabled: true });

    board.updateLOD(new THREE.Vector3(0, 10000, 0));

    const boundaryChunk = board.chunks.find(
      (chunk) => chunk.center.x === 15 && chunk.center.z === 5,
    );
    const interiorChunk = board.chunks.find(
      (chunk) => chunk.center.x === 5 && chunk.center.z === 5,
    );
    expect(boundaryChunk.lod).toBe(2);
    expect(boundaryChunk.mesh.geometry).toBe(board._circularBoundaryGeometry);
    expect(boundaryChunk.mesh.geometry).not.toBe(board.geometries[2]);
    expect(interiorChunk.lod).toBe(3);
    expect(interiorChunk.mesh.geometry).toBe(board.geometries[3]);

    expect(board._root.full).toBe(true);
    expect(board._straddlesCircularBoundary(
      board._root.minX,
      board._root.minZ,
      board._root.spanX,
      board._root.spanZ,
    )).toBe(true);
    expect(board._root.merged).toBe(false);
    expect(board.mergedGroupCount).toBe(0);

    board.dispose();
    material.dispose();
  });

  it('uses sustained FPS hysteresis and a cooldown for water quality', () => {
    const water = Object.create(WaterSystem.prototype);
    const material = {
      uniforms: {
        uWaterTier: { value: 3 },
        uCausticsQual: { value: 1 },
        uRefractionQual: { value: 1 },
      },
    };
    Object.assign(water, {
      engine: {
        params: {
          waterLegacyOnLowFps: true,
          waterDisableExpensiveBelowFps: 42,
        },
        perf: {},
        worldMode: 'studio',
      },
      _effectiveMode: 'cinematic',
      _fpsDowngraded: false,
      _fpsBelowSince: 0,
      _fpsAboveSince: 0,
      _lastFpsTierChangeAt: -Infinity,
      _planarReflectionPass: { deactivate: vi.fn() },
      _realisticStudio: material,
      _realisticInfinite: null,
      _allActiveMaterials: () => [material],
      _syncStudioGeometry: vi.fn(),
      _applyUniforms: vi.fn(),
    });

    water._maybeFpsDowngrade({}, 35, 100);
    water._maybeFpsDowngrade({}, 35, 2400);
    expect(water._fpsDowngraded).toBe(false);
    water._maybeFpsDowngrade({}, 35, 2700);
    expect(water._fpsDowngraded).toBe(true);

    water._maybeFpsDowngrade({}, 58, 6000);
    water._maybeFpsDowngrade({}, 58, 10500);
    expect(water._fpsDowngraded).toBe(true);
    water._maybeFpsDowngrade({}, 58, 11000);
    expect(water._fpsDowngraded).toBe(false);
  });

  it('keeps idle rendering enabled for every visual quality preset', () => {
    expect(PERF_PRESETS.high.onDemandStudio).toBe(true);
    expect(PERF_PRESETS.ultra.onDemandStudio).toBe(true);
  });
});
