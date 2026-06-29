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
    this.chunks = [];          // { mesh, center: Vector3, lod, cellKey }
    this._cells = [];          // occupied tile cells currently owned by chunks/queue
    this.lodCounts = [0, 0, 0, 0];
    this.chunkCount = 0;
    this.chunkSize = 0;
    this.boardSize = 0;
    this.activeChunkCount = 0;
    this.targetChunkCount = 0;
    this.lodThresholds = [0, 0, 0];
    this.lodSegments = [...LOD_RESOLUTIONS];

    this._distanceScale = 1.0;
    this._maxHeight = 0;
    this._skirtDepth = 0;

    // Gradual LOD geometry rebuild (one level per updateLOD call)
    this._lodRebuildQueue = [];
    this._targetSegments = null;
    this._buildQueue = [];
    this._building = false;

    this.cullingEnabled = true;
    this.behindCameraCulling = true;
    this.cullingAggressiveness = 1.0;
    this.visibleChunkCount = 0;
    this.culledChunkCount = 0;

    this._tmp = new THREE.Vector3();
  }

  // (Re)build the chunk grid. Only called when chunk count / size changes or a
  // full reset is requested. Tile-only changes use syncCells() so already-built
  // cells stay alive and only added/removed cells are touched.
  build({ chunkCount, chunkSize, maxHeight, skirtDepth, lodSegments, cells, progressive = false, initialBatchSize = 64 }) {
    this.dispose();
    this._setLayout({ chunkCount, chunkSize, maxHeight, skirtDepth, lodSegments });
    this._createSharedGeometries();
    this._applyCellDiff({ cells, progressive, initialBatchSize });
  }

  // Incrementally match the occupied tile-cell list. If the chunk layout itself
  // changed, fall back to build(); otherwise preserve existing chunks.
  syncCells({ chunkCount, chunkSize, maxHeight, skirtDepth, lodSegments, cells, progressive = true, initialBatchSize = 64 }) {
    const needsFullBuild = !this.geometries.length
      || this.chunkCount !== chunkCount
      || this.chunkSize !== chunkSize;
    if (needsFullBuild) {
      this.build({ chunkCount, chunkSize, maxHeight, skirtDepth, lodSegments, cells, progressive, initialBatchSize });
      return { rebuilt: true, added: this._cells.length, removed: 0 };
    }

    this._maxHeight = maxHeight;
    this._skirtDepth = skirtDepth;
    if (lodSegments && !this._sameSegments(lodSegments)) this.setLodSegments(lodSegments);
    this._recalcThresholds();
    this.updateBounds(maxHeight, skirtDepth);
    return this._applyCellDiff({ cells, progressive, initialBatchSize });
  }

  _setLayout({ chunkCount, chunkSize, maxHeight, skirtDepth, lodSegments }) {
    this.chunkCount = chunkCount;
    this.chunkSize = chunkSize;
    this.boardSize = chunkCount * chunkSize;   // one cell
    this._maxHeight = maxHeight;
    this._skirtDepth = skirtDepth;
    if (lodSegments) this.lodSegments = [...lodSegments];
    this._recalcThresholds();
  }

  _createSharedGeometries() {
    this.geometries = this.lodSegments.map((res, lodIndex) => {
      const geo = buildChunkGeometry(res, lodIndex);
      setChunkBounds(geo, this.chunkSize, this._maxHeight, this._skirtDepth);
      return geo;
    });
  }

  _sameSegments(segments) {
    return segments.length === this.lodSegments.length
      && segments.every((s, i) => s === this.lodSegments[i]);
  }

  _cellKey(cell) {
    return `${cell.cx},${cell.cz}`;
  }

  _normalizeCells(cells) {
    const list = (cells && cells.length) ? cells : [{ cx: 0, cz: 0 }];
    const out = [];
    const seen = new Set();
    for (const cell of list) {
      const cx = Math.trunc(Number(cell?.cx));
      const cz = Math.trunc(Number(cell?.cz));
      if (!Number.isFinite(cx) || !Number.isFinite(cz)) continue;
      const key = `${cx},${cz}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ cx, cz });
    }
    return out.length ? out : [{ cx: 0, cz: 0 }];
  }

  _jobsForCell(cell) {
    const jobs = [];
    const half = this.boardSize / 2;
    const cellKey = this._cellKey(cell);
    // cell (cx,cz) center sits at (cx*cellSize, cz*cellSize); its min corner
    // is that minus half. Chunks tile the cell from the corner.
    const originX = cell.cx * this.boardSize - half;
    const originZ = cell.cz * this.boardSize - half;
    for (let cz = 0; cz < this.chunkCount; cz++) {
      for (let cx = 0; cx < this.chunkCount; cx++) {
        const x = originX + cx * this.chunkSize;
        const z = originZ + cz * this.chunkSize;
        jobs.push({
          x,
          z,
          centerX: x + this.chunkSize / 2,
          centerZ: z + this.chunkSize / 2,
          cellCx: cell.cx,
          cellCz: cell.cz,
          cellKey,
        });
      }
    }
    return jobs;
  }

  _sortJobsNearestFirst(jobs) {
    jobs.sort((a, b) =>
      Math.hypot(a.centerX, a.centerZ) - Math.hypot(b.centerX, b.centerZ)
    );
  }

  _applyCellDiff({ cells, progressive = true, initialBatchSize = 64 }) {
    const nextCells = this._normalizeCells(cells);
    const nextKeys = new Set(nextCells.map((cell) => this._cellKey(cell)));
    const prevKeys = new Set(this._cells.map((cell) => this._cellKey(cell)));
    const removeKeys = new Set([...prevKeys].filter((key) => !nextKeys.has(key)));
    const addedCells = nextCells.filter((cell) => !prevKeys.has(this._cellKey(cell)));

    if (removeKeys.size) {
      this._buildQueue = this._buildQueue.filter((job) => !removeKeys.has(job.cellKey));
      const kept = [];
      for (const chunk of this.chunks) {
        if (removeKeys.has(chunk.cellKey)) {
          this.group.remove(chunk.mesh);
        } else {
          kept.push(chunk);
        }
      }
      this.chunks = kept;
    }

    if (addedCells.length) {
      const jobs = addedCells.flatMap((cell) => this._jobsForCell(cell));
      // Build nearest chunks first so the first visible board is useful, then
      // stream the edges in behind it.
      this._sortJobsNearestFirst(jobs);
      this._buildQueue.push(...jobs);
    }

    this._cells = nextCells;
    this.targetChunkCount = nextCells.length * this.chunkCount * this.chunkCount;
    this.activeChunkCount = this.chunks.length;
    this._building = this._buildQueue.length > 0;

    if (addedCells.length && this._buildQueue.length) {
      const batchSize = progressive && this._buildQueue.length > initialBatchSize
        ? initialBatchSize
        : this._buildQueue.length;
      this.processBuildQueue({ maxItems: batchSize, maxMs: Infinity });
    }

    return { rebuilt: false, added: addedCells.length, removed: removeKeys.size };
  }

  get isBuilding() { return this._building; }
  get remainingChunks() { return this._buildQueue.length; }
  get buildProgress() {
    return this.targetChunkCount
      ? this.activeChunkCount / this.targetChunkCount
      : 1;
  }

  processBuildQueue({ maxItems = 16, maxMs = 6 } = {}) {
    if (!this._buildQueue.length) {
      this._building = false;
      return 0;
    }
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let created = 0;
    while (this._buildQueue.length && created < maxItems) {
      if (maxMs !== Infinity) {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (created > 0 && now - start >= maxMs) break;
      }
      this._createChunk(this._buildQueue.shift());
      created++;
    }
    this.activeChunkCount = this.chunks.length;
    this._building = this._buildQueue.length > 0;
    return created;
  }

  _createChunk(job) {
    const mesh = new THREE.Mesh(this.geometries[3], this.material);
    mesh.position.set(job.x, 0, job.z);
    mesh.scale.setScalar(this.chunkSize);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);
    this.group.add(mesh);
    this.chunks.push({
      mesh,
      center: new THREE.Vector3(job.centerX, 0, job.centerZ),
      lod: 3,
      cellCx: job.cellCx,
      cellCz: job.cellCz,
      cellKey: job.cellKey,
    });
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
    this._cells = [];
    this.geometries = [];
    this._lodRebuildQueue = [];
    this._buildQueue = [];
    this._building = false;
    this.activeChunkCount = 0;
    this.targetChunkCount = 0;
    this.visibleChunkCount = 0;
    this.culledChunkCount = 0;
    this.lodCounts = [0, 0, 0, 0];
  }
}
