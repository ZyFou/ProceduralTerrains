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
});
