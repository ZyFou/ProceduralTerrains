import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  ChunkStreamScheduler,
  getRadialOffsets,
} from '../src/engine/terrain/ChunkStreamScheduler.js';
import { InfiniteTerrainBatches } from '../src/engine/terrain/InfiniteTerrainBatches.js';
import {
  createCullingContext,
  cullChunks,
} from '../src/engine/terrain/InfiniteTerrainCulling.js';

describe('infinite chunk streaming', () => {
  it.each([
    [6, 113],
    [10, 317],
    [12, 441],
    [16, 797],
  ])('caches the %i-chunk radial pattern (%i offsets)', (radius, expected) => {
    const offsets = getRadialOffsets(radius);
    expect(offsets).toHaveLength(expected);
    expect(getRadialOffsets(radius)).toBe(offsets);
    expect(new Set(offsets.map(({ dx, dz }) => `${dx},${dz}`)).size).toBe(expected);
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i].dist2).toBeGreaterThanOrEqual(offsets[i - 1].dist2);
    }
  });

  it('treats zero maxItems as an automatic bounded batch', () => {
    const scheduler = new ChunkStreamScheduler({ autoMaxItems: 3, now: () => 0 });
    scheduler.reset([1, 2, 3, 4, 5]);
    const first = scheduler.process(() => true, { budgetMs: 1, maxItems: 0 });
    expect(first.created).toBe(3);
    expect(first.pendingCount).toBe(2);
  });

  it('stops work at the time budget and replaces obsolete requests', () => {
    let clock = 0;
    const scheduler = new ChunkStreamScheduler({ autoMaxItems: 20, now: () => clock });
    scheduler.reset(['old-a', 'old-b']);
    scheduler.reset(['near', 'far']);
    const seen = [];
    const result = scheduler.process((item) => {
      seen.push(item);
      clock += 0.6;
      return true;
    }, { budgetMs: 1, maxItems: 10 });
    expect(seen).toEqual(['near', 'far']);
    expect(result.elapsedMs).toBeCloseTo(1.2);
  });
});

describe('instanced infinite terrain batches', () => {
  it('compacts visible chunks into one batch per LOD', () => {
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial();
    const geometries = Array.from({ length: 4 }, () => new THREE.PlaneGeometry(1, 1));
    const batches = new InfiniteTerrainBatches({
      group,
      material,
      geometries,
      capacity: 8,
    });

    const counts = batches.commit([
      { cx: 0, cz: 0, lod: 0, visible: true },
      { cx: 2, cz: -1, lod: 2, visible: true },
      { cx: 8, cz: 8, lod: 2, visible: false },
    ], 10);

    expect(group.children).toHaveLength(4);
    expect(counts).toEqual([1, 0, 1, 0]);
    expect(batches.meshes.map((mesh) => mesh.count)).toEqual(counts);

    const matrix = new THREE.Matrix4();
    batches.meshes[2].getMatrixAt(0, matrix);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([20, 0, -10]);

    batches.dispose();
    for (const geometry of geometries) geometry.dispose();
    material.dispose();
  });
});

describe('infinite terrain culling', () => {
  it('reuses one camera context and reports visibility changes', () => {
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
    camera.position.set(0, 1, 0);
    camera.lookAt(0, 1, -1);
    camera.updateMatrixWorld(true);
    const context = createCullingContext(camera, 1, true, 1);
    const items = [
      { centerX: 0, centerZ: -5, visible: false },
      { centerX: 0, centerZ: 5, visible: true },
    ];

    const result = cullChunks(items, camera, 1, 2, true, 1, context);
    expect(result).toEqual({ visibleCount: 1, culledCount: 1, changedCount: 2 });
    expect(items.map((item) => item.visible)).toEqual([true, false]);
  });

  it('never culls the chunk footprint containing the player, regardless of altitude', () => {
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
    camera.position.set(4.9, 80, 4.9);
    camera.lookAt(4.9, 80, 5.9);
    camera.updateMatrixWorld(true);
    const context = createCullingContext(camera, 10, true, 2);
    context.frustum.intersectsSphere = () => false;
    const chunk = { centerX: 0, centerZ: 0, visible: false };

    const result = cullChunks([chunk], camera, 10, 50, true, 2, context);
    expect(result.visibleCount).toBe(1);
    expect(chunk.visible).toBe(true);
  });

  it('keeps a partially visible footprint and culls only a fully-behind one', () => {
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
    camera.position.set(0, 2, 0);
    camera.lookAt(0, 2, -1);
    camera.updateMatrixWorld(true);
    const context = createCullingContext(camera, 1, true, 1);
    context.frustum.intersectsSphere = () => true;
    const crossingCameraPlane = {
      centerX: 5,
      centerZ: 4,
      spanX: 2,
      spanZ: 10,
      visible: false,
    };
    const fullyBehind = {
      centerX: 5,
      centerZ: 20,
      spanX: 2,
      spanZ: 10,
      visible: true,
    };

    const result = cullChunks(
      [crossingCameraPlane, fullyBehind],
      camera,
      1,
      10,
      true,
      1,
      context
    );
    expect(result.visibleCount).toBe(1);
    expect(crossingCameraPlane.visible).toBe(true);
    expect(fullyBehind.visible).toBe(false);
  });

  it('includes the underwater skirt depth in custom culling bounds', () => {
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld(true);
    const context = createCullingContext(camera, 10, false, 1, {}, -30);
    let observedSphere = null;
    context.frustum.intersectsSphere = (sphere) => {
      observedSphere = sphere.clone();
      return true;
    };

    cullChunks(
      [{ centerX: 20, centerZ: -20, visible: true }],
      camera,
      10,
      50,
      false,
      1,
      context
    );

    expect(observedSphere.center.y).toBe(10);
    expect(observedSphere.radius).toBeCloseTo(Math.hypot(5, 40, 5) * 1.05);
  });
});
