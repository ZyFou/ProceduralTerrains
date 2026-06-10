import * as THREE from 'three';
import { buildChunkGeometry, setChunkBounds } from './ChunkGeometry.js';

// ============================================================================
// ONE fixed terrain board. The board never moves, never streams, and is
// never created/destroyed around the camera. It is split into an internal
// N x N chunk grid purely so each chunk can pick a geometry LOD based on
// camera distance. All chunks share 4 geometries (one per LOD) and a single
// shader material; their world position comes from the mesh transform.
// ============================================================================

export const LOD_RESOLUTIONS = [64, 32, 16, 8];   // quads per chunk side

export class TerrainBoard {
  constructor(scene, material) {
    this.scene = scene;
    this.material = material;
    this.group = new THREE.Group();
    this.group.name = 'terrain-board';
    this.scene.add(this.group);

    this.geometries = [];      // one per LOD, shared by all chunks
    this.chunks = [];          // { mesh, center: Vector3, lod }
    this.lodCounts = [0, 0, 0, 0];
    this.chunkCount = 0;
    this.chunkSize = 0;
    this.boardSize = 0;
    this.lodThresholds = [0, 0, 0];

    this._tmp = new THREE.Vector3();
  }

  // (Re)build the chunk grid. Only called when chunk count / size change —
  // every other parameter is a live shader uniform.
  build({ chunkCount, chunkSize, maxHeight, skirtDepth }) {
    this.dispose();

    this.chunkCount = chunkCount;
    this.chunkSize = chunkSize;
    this.boardSize = chunkCount * chunkSize;
    const half = this.boardSize / 2;

    this.geometries = LOD_RESOLUTIONS.map((res, lodIndex) => {
      const geo = buildChunkGeometry(res, lodIndex);
      setChunkBounds(geo, chunkSize, maxHeight, skirtDepth);
      return geo;
    });

    // LOD distance bands scale with chunk size so any board density works
    this.lodThresholds = [chunkSize * 8, chunkSize * 15, chunkSize * 24];

    for (let cz = 0; cz < chunkCount; cz++) {
      for (let cx = 0; cx < chunkCount; cx++) {
        const mesh = new THREE.Mesh(this.geometries[3], this.material);
        mesh.position.set(cx * chunkSize - half, 0, cz * chunkSize - half);
        mesh.scale.setScalar(chunkSize);
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.updateMatrixWorld(true);
        this.group.add(mesh);
        this.chunks.push({
          mesh,
          center: new THREE.Vector3(
            mesh.position.x + chunkSize / 2, 0, mesh.position.z + chunkSize / 2
          ),
          lod: 3,
        });
      }
    }
  }

  // Refresh culling bounds when the max terrain height changes.
  updateBounds(maxHeight, skirtDepth) {
    for (const geo of this.geometries) {
      setChunkBounds(geo, this.chunkSize, maxHeight, skirtDepth);
    }
  }

  // Pick a LOD per chunk from camera distance. Pure view-dependent detail —
  // the height field itself is never touched by the camera.
  updateLOD(cameraPos) {
    const [t0, t1, t2] = this.lodThresholds;
    const counts = [0, 0, 0, 0];
    for (const chunk of this.chunks) {
      const d = this._tmp.copy(chunk.center).sub(cameraPos).length();
      const lod = d < t0 ? 0 : d < t1 ? 1 : d < t2 ? 2 : 3;
      if (lod !== chunk.lod) {
        chunk.lod = lod;
        chunk.mesh.geometry = this.geometries[lod];
      }
      counts[lod]++;
    }
    this.lodCounts = counts;
  }

  dispose() {
    for (const chunk of this.chunks) this.group.remove(chunk.mesh);
    for (const geo of this.geometries) geo.dispose();
    this.chunks = [];
    this.geometries = [];
  }
}
