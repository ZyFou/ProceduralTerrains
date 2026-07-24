import * as THREE from 'three';

// ============================================================================
// Shared visibility context for flat terrain chunks and merged nodes. Hosts
// build it once per frame, then reuse the same projection matrix and frustum
// for every terrain collection.
// ============================================================================

/**
 * Update (or create) a reusable culling context from the camera's latest
 * transform. Call camera.updateMatrixWorld(true) before this function.
 */
export function createCullingContext(
  camera,
  chunkSize,
  behindCameraCulling,
  aggressiveness = 1,
  target = {},
  minHeight = 0
) {
  const context = target;
  context.frustum ||= new THREE.Frustum();
  context.projScreenMatrix ||= new THREE.Matrix4();
  context.sphere ||= new THREE.Sphere();
  context.camFwd ||= new THREE.Vector3();

  context.projScreenMatrix.multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse
  );
  context.frustum.setFromProjectionMatrix(context.projScreenMatrix);
  context.camFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
  context.cameraX = camera.position.x;
  context.cameraY = camera.position.y;
  context.cameraZ = camera.position.z;
  context.behindCameraCulling = !!behindCameraCulling;
  context.minHeight = minHeight;

  // The player neighborhood is measured only in the ground plane. Including
  // altitude here used to remove the chunk directly below a walking/flying
  // camera when its center happened to be behind the view direction.
  const protectionMargin = chunkSize * Math.max(1, 2 - aggressiveness * 0.5);
  context.protectionMargin2 = protectionMargin * protectionMargin;

  // Extra margin behind the camera plane. The item loop projects the complete
  // 3D bounds on that plane, so camera pitch and tall terrain remain safe.
  context.backMargin = chunkSize * Math.max(0.1, 0.7 - aggressiveness * 0.25);
  return context;
}

function setItemVisible(item, visible) {
  const changed = item.visible !== visible;
  item.visible = visible;
  if (item.mesh) item.mesh.visible = visible;
  return changed;
}

/**
 * Cull terrain records or quadtree nodes. spanWorld is honored when present,
 * so a folded 2×2 node and a folded 16×16 node no longer share a world-sized
 * conservative sphere.
 *
 * The optional context keeps the legacy call sites compatible while allowing
 * callers with two collections to build the frustum only once.
 */
export function cullChunks(
  chunks,
  camera,
  chunkSize,
  maxHeight,
  behindCameraCulling,
  aggressiveness = 1,
  sharedContext = null,
  minHeight = 0
) {
  if (!sharedContext) camera.updateMatrixWorld(true);
  const context = sharedContext || createCullingContext(
    camera,
    chunkSize,
    behindCameraCulling,
    aggressiveness,
    {},
    minHeight
  );

  let visibleCount = 0;
  let culledCount = 0;
  let changedCount = 0;
  const values = chunks.values ? chunks.values() : chunks;

  for (const item of values) {
    const centerX = item.centerX ?? item.center?.x ?? 0;
    const centerZ = item.centerZ ?? item.center?.z ?? 0;
    const spanX = item.spanX ?? item.spanWorld ?? chunkSize;
    const spanZ = item.spanZ ?? item.spanWorld ?? chunkSize;
    const halfX = spanX * 0.5;
    const halfZ = spanZ * 0.5;
    const dx = centerX - context.cameraX;
    const dz = centerZ - context.cameraZ;

    // Keep the chunk containing the player and a small ring around it alive,
    // independently of frustum/back tests. Distance is measured to the nearest
    // point of the chunk footprint rather than to its center.
    const outsideX = Math.max(0, Math.abs(dx) - halfX);
    const outsideZ = Math.max(0, Math.abs(dz) - halfZ);
    const protectedByProximity = (
      outsideX * outsideX + outsideZ * outsideZ
    ) <= context.protectionMargin2;
    if (protectedByProximity) {
      if (setItemVisible(item, true)) changedCount++;
      visibleCount++;
      continue;
    }

    const verticalMin = item.minHeight ?? context.minHeight ?? minHeight;
    const verticalMax = item.maxHeight ?? maxHeight;
    const verticalCenter = (verticalMin + verticalMax) * 0.5;
    const verticalHalf = Math.max(0, verticalMax - verticalMin) * 0.5;
    const radius = item.boundingRadius
      ?? Math.hypot(halfX, verticalHalf, halfZ) * 1.05;

    context.sphere.center.set(centerX, verticalCenter, centerZ);
    context.sphere.radius = radius;

    if (!context.frustum.intersectsSphere(context.sphere)) {
      if (setItemVisible(item, false)) changedCount++;
      culledCount++;
      continue;
    }

    if (context.behindCameraCulling) {
      const dy = verticalCenter - context.cameraY;
      const forwardDistance = (
        dx * context.camFwd.x
        + dy * context.camFwd.y
        + dz * context.camFwd.z
      );
      // Project the complete 3D AABB onto the camera-forward axis. Cull only
      // when every point in the terrain bound is safely behind the camera.
      const projectedHalfExtent = (
        Math.abs(context.camFwd.x) * halfX
        + Math.abs(context.camFwd.y) * verticalHalf
        + Math.abs(context.camFwd.z) * halfZ
      );
      if (forwardDistance + projectedHalfExtent < -context.backMargin) {
        if (setItemVisible(item, false)) changedCount++;
        culledCount++;
        continue;
      }
    }

    if (setItemVisible(item, true)) changedCount++;
    visibleCount++;
  }

  return { visibleCount, culledCount, changedCount };
}
