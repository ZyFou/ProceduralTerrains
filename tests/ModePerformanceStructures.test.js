import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ManualPropPaintField } from '../src/manual/ManualPropPaintField.js';
import { ManualSurfacePaintField } from '../src/manual/ManualSurfacePaintField.js';
import { ManualTerrainField } from '../src/manual/ManualTerrainField.js';
import { PlanetWorld } from '../src/engine/terrain/PlanetWorld.js';

const bounds = () => ({ origin: { x: 0, z: 0 }, span: { x: 100, z: 100 } });

describe('mode performance structures', () => {
  it('keeps empty Manual fields neutral until their first authored sample', () => {
    const uniforms = {
      uManualHeightTexture: { value: null },
      uManualOrigin: { value: new THREE.Vector2() },
      uManualSpan: { value: new THREE.Vector2() },
    };
    const height = new ManualTerrainField({ uniforms, getBounds: bounds, resolution: 16 });
    const surface = new ManualSurfacePaintField({ getBounds: bounds, resolution: 16 });
    const props = new ManualPropPaintField({ getBounds: bounds, resolution: 16 });

    expect([height.resolution, surface.resolution, props.resolution]).toEqual([1, 1, 1]);
    expect(height.heightData).toHaveLength(4);
    expect(surface.weightsA).toHaveLength(4);
    expect(props.data).toHaveLength(4);

    height.stamp({ x: 50, z: 50, radius: 8, strength: 0.5, falloff: 0.5, tool: 'raise' });
    surface.stamp({ x: 50, z: 50, radius: 8, strength: 0.5, falloff: 0.5 });
    props.stamp({ x: 50, z: 50, radius: 8, strength: 0.5, falloff: 0.5 });
    expect([height.resolution, surface.resolution, props.resolution]).toEqual([16, 16, 16]);

    height.dispose();
    surface.dispose();
  });

  it('builds Planet leaf terrain as four instanced LOD batches', () => {
    const scene = new THREE.Scene();
    const makeMaterial = () => new THREE.ShaderMaterial({
      uniforms: {
        uFaceOrigin: { value: new THREE.Vector3() },
        uFaceU: { value: new THREE.Vector3() },
        uFaceV: { value: new THREE.Vector3() },
        uMergeDebug: { value: 0 },
      },
    });
    const world = new PlanetWorld(scene, makeMaterial, {
      radius: 16000,
      maxHeight: 1000,
      skirtDepth: 30,
      faceGrid: 8,
      lodSegments: [16, 12, 8, 4],
    });

    expect(world.chunks).toHaveLength(384);
    expect(world.batches).toHaveLength(4);
    expect(world.materials).toHaveLength(4);
    expect(world.batches.every((batch) => batch.mesh.isInstancedMesh)).toBe(true);
    expect(world.batches.reduce((sum, batch) => sum + batch.mesh.count, 0)).toBe(384);

    world.dispose();
    expect(scene.children).not.toContain(world.group);
  });

  it('draws folded planet patches as instanced batches sharing one material', () => {
    const scene = new THREE.Scene();
    const makeMaterial = () => new THREE.ShaderMaterial({
      uniforms: {
        uFaceOrigin: { value: new THREE.Vector3() },
        uFaceU: { value: new THREE.Vector3() },
        uFaceV: { value: new THREE.Vector3() },
        uMergeDebug: { value: 0 },
      },
    });
    const world = new PlanetWorld(scene, makeMaterial, {
      radius: 16000, maxHeight: 1000, skirtDepth: 30, faceGrid: 8, lodSegments: [16, 8, 4, 2],
    });
    const camera = new THREE.PerspectiveCamera(50, 1, 10, 1e6);
    camera.position.set(0, 0, 80000);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    world.update(camera.position, camera);

    const patchMeshes = world.group.children.filter((o) => o.name.startsWith('planet-patch-'));
    expect(world.mergedGroupCount).toBeGreaterThan(0);
    expect(patchMeshes.length).toBeGreaterThan(0);
    expect(patchMeshes.every((m) => m.isInstancedMesh && m.material === patchMeshes[0].material)).toBe(true);
    // 4 chunk-batch materials + one shared patch material, however many patches fold
    expect(world.materials).toHaveLength(5);
    // chunks under a folded patch leave the chunk batches (no hidden double draw)
    const drawnChunks = world.batches.reduce((sum, batch) => sum + batch.mesh.count, 0);
    expect(drawnChunks).toBe(world.chunks.filter((c) => !c.merged && c.visible).length);
    expect(drawnChunks).toBeLessThan(world.chunks.length);
    const drawnPatches = patchMeshes.reduce((sum, m) => sum + m.count, 0);
    expect(drawnPatches).toBe(world._mergedPatches.filter((p) => p.visible).length);

    // a steady camera re-uploads nothing
    const attr = patchMeshes.find((m) => m.count > 0).geometry.getAttribute('aFaceOrigin');
    const version = attr.version;
    world.update(camera.position, camera);
    expect(attr.version).toBe(version);
    world.dispose();
  });
});
