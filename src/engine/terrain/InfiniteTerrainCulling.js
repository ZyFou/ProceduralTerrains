import * as THREE from 'three';

// ============================================================================
// InfiniteTerrainCulling: per-frame visibility culling for infinite-mode
// terrain chunks. Two passes:
//   1. Frustum culling — hides chunks whose bounding sphere is entirely
//      outside the camera frustum.
//   2. Behind-camera culling (optional) — hides chunks whose center is
//      behind the camera AND farther than a safety margin, so chunks
//      directly under / around the player stay visible.
//
// IMPORTANT: culling only sets mesh.visible — it never removes or disposes
// chunks. Streaming (load/unload) remains the responsibility of InfiniteWorld.
// ============================================================================

const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();
const _sphere = new THREE.Sphere();
const _dir = new THREE.Vector3();
const _camFwd = new THREE.Vector3();

/**
 * Cull terrain chunks based on camera frustum and facing direction.
 *
 * @param {Map} chunks  — InfiniteWorld chunk map (key → { mesh, center, … })
 * @param {THREE.PerspectiveCamera} camera
 * @param {number} chunkSize — world units per chunk side
 * @param {number} maxHeight — max terrain height (for bounding sphere)
 * @param {boolean} behindCameraCulling — enable behind-camera culling pass
 * @param {number} [aggressiveness=1] — 0..2; higher culls behind-camera
 *        chunks sooner (smaller safety margin, tighter dot threshold)
 * @returns {{ visibleCount: number, culledCount: number }}
 */
export function cullChunks(chunks, camera, chunkSize, maxHeight, behindCameraCulling, aggressiveness = 1) {
  // Build the frustum from the camera's current projection × view matrices
  _projScreenMatrix.multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse
  );
  _frustum.setFromProjectionMatrix(_projScreenMatrix);

  // Camera forward direction (negative Z in camera local space → world)
  _camFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);

  // Bounding sphere radius for a single chunk (conservative estimate)
  const sphereRadius = Math.hypot(chunkSize * 0.5, maxHeight * 0.5, chunkSize * 0.5) * 1.05;

  // Safety margin for behind-camera culling: chunks within this distance
  // of the camera are never culled even if behind, preventing the ground
  // under the player from disappearing. Aggressiveness shrinks the margin
  // (never below 1 chunk) and tightens the facing threshold.
  const safetyDist = chunkSize * Math.max(1.0, 2.0 - aggressiveness * 0.5);
  const safetyDist2 = safetyDist * safetyDist;
  const dotThreshold = -0.3 + aggressiveness * 0.15;   // aggr 1 → -0.15 (legacy)

  let visibleCount = 0;
  let culledCount = 0;

  for (const chunk of chunks.values()) {
    const mesh = chunk.mesh;

    // Build a world-space bounding sphere for this chunk
    _sphere.center.set(
      chunk.center.x,
      maxHeight * 0.5,    // vertical center of the bounding volume
      chunk.center.z
    );
    _sphere.radius = sphereRadius;

    // Pass 1: frustum test
    if (!_frustum.intersectsSphere(_sphere)) {
      mesh.visible = false;
      culledCount++;
      continue;
    }

    // Pass 2: behind-camera test (optional)
    if (behindCameraCulling) {
      _dir.subVectors(chunk.center, camera.position);
      const dist2 = _dir.lengthSq();

      // Only cull if beyond the safety margin
      if (dist2 > safetyDist2) {
        // Normalize direction and check dot product with camera forward
        _dir.normalize();
        const dot = _dir.dot(_camFwd);

        // Chunk center is behind the camera (dot < threshold)
        // Use a small negative threshold to be slightly generous at edges
        if (dot < dotThreshold) {
          mesh.visible = false;
          culledCount++;
          continue;
        }
      }
    }

    // Chunk is visible
    mesh.visible = true;
    visibleCount++;
  }

  return { visibleCount, culledCount };
}
