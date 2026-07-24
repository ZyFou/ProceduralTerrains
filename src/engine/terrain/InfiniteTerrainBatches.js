import * as THREE from 'three';

const LOD_COUNT = 4;

/**
 * Render logical Infinite World chunks through one InstancedMesh per LOD.
 * Streaming creates lightweight records only; scene-graph objects and terrain
 * draw calls stay constant as the player moves.
 */
export class InfiniteTerrainBatches {
  constructor({ group, material, geometries, capacity }) {
    this.group = group;
    this.material = material;
    this.geometries = geometries;
    this.capacity = Math.max(1, Math.ceil(capacity));
    this.meshes = [];
    this.counts = [0, 0, 0, 0];
    this._matrix = new THREE.Matrix4();
    this._createMeshes();
  }

  _createMeshes() {
    this.meshes = this.geometries.map((geometry, lod) => {
      const mesh = new THREE.InstancedMesh(geometry, this.material, this.capacity);
      mesh.name = `infinite-terrain-lod-${lod}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      return mesh;
    });
  }

  ensureCapacity(capacity) {
    const required = Math.max(1, Math.ceil(capacity));
    if (required <= this.capacity) return false;

    for (const mesh of this.meshes) this.group.remove(mesh);
    this.capacity = required;
    this._createMeshes();
    return true;
  }

  updateGeometry(lod, geometry) {
    this.geometries[lod] = geometry;
    this.meshes[lod].geometry = geometry;
  }

  /**
   * Compact visible records into their LOD batch. Matrices are uploaded only
   * when InfiniteWorld reports a topology, visibility or LOD change.
   */
  commit(chunks, chunkSize) {
    const counts = [0, 0, 0, 0];
    for (const chunk of chunks) {
      if (chunk.visible === false) continue;
      const lod = Math.min(LOD_COUNT - 1, Math.max(0, chunk.lod | 0));
      const slot = counts[lod]++;
      if (slot >= this.capacity) {
        throw new RangeError(`Infinite terrain batch ${lod} exceeded capacity ${this.capacity}`);
      }
      this._matrix.makeScale(chunkSize, chunkSize, chunkSize);
      this._matrix.setPosition(chunk.cx * chunkSize, 0, chunk.cz * chunkSize);
      this.meshes[lod].setMatrixAt(slot, this._matrix);
    }

    for (let lod = 0; lod < LOD_COUNT; lod++) {
      const mesh = this.meshes[lod];
      mesh.count = counts[lod];
      if (counts[lod] > 0 || this.counts[lod] > 0) {
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    this.counts = counts;
    return counts;
  }

  setVisible(visible) {
    for (const mesh of this.meshes) mesh.visible = visible;
  }

  dispose() {
    for (const mesh of this.meshes) this.group.remove(mesh);
    this.meshes = [];
    this.counts = [0, 0, 0, 0];
  }
}
