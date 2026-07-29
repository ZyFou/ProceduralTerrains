import * as THREE from 'three';
import { CloudSlabLayer } from './CloudSlabLayer.js';

/**
 * Camera-following bounded cloud slab for Infinite mode. The mesh and occupancy
 * region snap on terrain chunk boundaries, while a noise-space offset preserves
 * the same logical procedural field across every rebase.
 */
export class InfiniteCloudLayer extends CloudSlabLayer {
  constructor(scene, opts = {}) {
    super(scene, opts);
    this.mesh.name = 'infinite-cloud-layer';
    this._chunkSize = Math.max(1, opts.chunkSize || 256);
    this._viewRadius = Math.max(1, opts.viewRadius || 8);
    this._logicalCenter = new THREE.Vector2();
    this._rebaseScratch = new THREE.Vector3();
  }

  applyParams(params, maxHeight, boardSize, perf, layout = {}) {
    this._chunkSize = Math.max(1, layout.chunkSize || this._chunkSize);
    this._viewRadius = Math.max(1, layout.viewRadius || this._viewRadius);
    const viewDistance = this._chunkSize * (this._viewRadius + 1);
    const cloudRadius = viewDistance * 1.15;
    const extent = cloudRadius / 0.62;

    super.applyParams(params, maxHeight, boardSize, perf, {
      extent,
      center: { x: this._logicalCenter.x, z: this._logicalCenter.y },
    });

    // The bounded volume follows the camera, so distance culling would only
    // introduce a height-dependent pop and is unnecessary.
    this._maxDistance = Infinity;
    this.material.uniforms.uCloudFar.value = cloudRadius * 2.5;
    this._syncDomainRebase();
  }

  _recenter(cameraPos) {
    const x = Math.floor(cameraPos.x / this._chunkSize) * this._chunkSize;
    const z = Math.floor(cameraPos.z / this._chunkSize) * this._chunkSize;
    if (x === this._logicalCenter.x && z === this._logicalCenter.y) return false;

    this._logicalCenter.set(x, z);
    this._center = { x, z };
    const u = this.material.uniforms;
    u.uCloudCenter.value.set(x, 0, z);
    u.uOccCenter.value.set(x, z);
    this.mesh.position.x = x;
    this.mesh.position.z = z;
    this._occBuiltAt = 0;
    this._syncDomainRebase();
    return true;
  }

  _syncDomainRebase() {
    const u = this.material?.uniforms;
    if (!u?.uCloudDomainOrigin || !u?.uCloudNoiseOffset) return;
    const x = this._logicalCenter.x;
    const z = this._logicalCenter.y;
    const angle = u.uCloudRotation.value;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const scale = u.uCloudScale.value;

    u.uCloudDomainOrigin.value.set(x, 0, z);
    this._rebaseScratch.set(
      c * x + s * z,
      0,
      -s * x + c * z,
    ).multiplyScalar(scale);
    u.uCloudNoiseOffset.value.copy(this._rebaseScratch);
  }

  update(dt, cameraPos, sunDir) {
    this._recenter(cameraPos);
    super.update(dt, cameraPos, sunDir);
  }
}
