import * as THREE from 'three';
import { buildChunkGeometry, setChunkBounds } from './ChunkGeometry.js';
import { cullChunks } from './InfiniteTerrainCulling.js';

// ============================================================================
// ONE fixed terrain board. The board never moves, never streams, and is
// never created/destroyed around the camera. It is split into an internal
// N x N chunk grid purely so each chunk can pick a geometry LOD based on
// camera distance. All chunks share 4 geometries (one per LOD) and a single
// shader material; their world position comes from the mesh transform.
// ============================================================================

export const LOD_RESOLUTIONS = [64, 32, 16, 8];   // quads per chunk side
const BASE_DISTANCE_BANDS = [8, 15, 24];          // × chunkSize

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
    this.lodSegments = [...LOD_RESOLUTIONS];

    this._distanceScale = 1.0;
    this._maxHeight = 0;
    this._skirtDepth = 0;

    // Gradual LOD geometry rebuild (one level per updateLOD call)
    this._lodRebuildQueue = [];
    this._targetSegments = null;

    this.cullingEnabled = true;
    this.behindCameraCulling = true;
    this.cullingAggressiveness = 1.0;
    this.visibleChunkCount = 0;
    this.culledChunkCount = 0;

    this._tmp = new THREE.Vector3();
  }

  // (Re)build the chunk grid. Only called when chunk count / size change —
  // every other parameter is a live shader uniform.
  build({ chunkCount, chunkSize, maxHeight, skirtDepth, lodSegments }) {
    this.dispose();

    this.chunkCount = chunkCount;
    this.chunkSize = chunkSize;
    this.boardSize = chunkCount * chunkSize;
    this._maxHeight = maxHeight;
    this._skirtDepth = skirtDepth;
    if (lodSegments) this.lodSegments = [...lodSegments];
    const half = this.boardSize / 2;

    this.geometries = this.lodSegments.map((res, lodIndex) => {
      const geo = buildChunkGeometry(res, lodIndex);
      setChunkBounds(geo, chunkSize, maxHeight, skirtDepth);
      return geo;
    });

    // LOD distance bands scale with chunk size so any board density works
    this._recalcThresholds();

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

  _recalcThresholds() {
    this.lodThresholds = BASE_DISTANCE_BANDS.map(
      (m) => m * this.chunkSize * this._distanceScale
    );
  }

  // Scale the LOD distance bands (performance setting).
  setLodDistanceScale(m) {
    if (m === this._distanceScale) return;
    this._distanceScale = m;
    if (this.chunkSize) this._recalcThresholds();
  }

  // Change per-LOD segment counts. Rebuilds shared geometries gradually —
  // one LOD level per (throttled) updateLOD call, so the UI never freezes.
  setLodSegments(segments) {
    const same = segments.length === this.lodSegments.length
      && segments.every((s, i) => s === this.lodSegments[i])
      && !this._lodRebuildQueue.length;
    if (same) return;
    this._targetSegments = [...segments];
    this._lodRebuildQueue = [3, 2, 1, 0];
  }

  _processLodRebuild() {
    if (!this._lodRebuildQueue.length || !this._targetSegments) return;
    if (!this.geometries.length) { this._lodRebuildQueue = []; return; }
    const lod = this._lodRebuildQueue.shift();
    const res = this._targetSegments[lod];
    if (res === this.lodSegments[lod]) return;

    const geo = buildChunkGeometry(res, lod);
    setChunkBounds(geo, this.chunkSize, this._maxHeight, this._skirtDepth);
    const old = this.geometries[lod];
    this.geometries[lod] = geo;
    this.lodSegments[lod] = res;

    for (const chunk of this.chunks) {
      if (chunk.lod === lod) chunk.mesh.geometry = geo;
    }
    old.dispose();
  }

  // Refresh culling bounds when the max terrain height changes.
  updateBounds(maxHeight, skirtDepth) {
    this._maxHeight = maxHeight;
    this._skirtDepth = skirtDepth;
    for (const geo of this.geometries) {
      setChunkBounds(geo, this.chunkSize, maxHeight, skirtDepth);
    }
  }

  // Pick a LOD per chunk from camera distance. Pure view-dependent detail —
  // the height field itself is never touched by the camera.
  updateLOD(cameraPos) {
    this._processLodRebuild();
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

  // Cull invisible chunks based on the camera frustum and facing direction.
  cull(camera) {
    if (!this.cullingEnabled) {
      let visibleCount = 0;
      for (const chunk of this.chunks) {
        if (!chunk.mesh.visible) {
          chunk.mesh.visible = true;
        }
        visibleCount++;
      }
      this.visibleChunkCount = visibleCount;
      this.culledChunkCount = 0;
      return;
    }

    const result = cullChunks(
      this.chunks,
      camera,
      this.chunkSize,
      this._maxHeight,
      this.behindCameraCulling,
      this.cullingAggressiveness
    );
    this.visibleChunkCount = result.visibleCount;
    this.culledChunkCount = result.culledCount;
  }

  dispose() {
    for (const chunk of this.chunks) this.group.remove(chunk.mesh);
    for (const geo of this.geometries) geo.dispose();
    this.chunks = [];
    this.geometries = [];
    this._lodRebuildQueue = [];
  }
}
