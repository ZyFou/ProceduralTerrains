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

    // Occupancy of the tile assembly, mirrored from Engine so the CPU merge
    // layer matches the shader's tileOccupiedAt discard. Without it the
    // quadtree would fold the axis-aligned bbox of a non-rectangular assembly
    // (e.g. an L shape) into one rectangular mesh that covers empty cells.
    this._occupiedCells = new Set();   // "cx,cz"
    this._tileShape = 'square';        // 'square' | 'circle'
    this._diskRadiusWorld = 0;         // circle clip radius in world units
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

    // --- Merge layer (quadtree chunked-LOD) ---------------------------------
    // The chunks are the leaves of a quadtree. Each internal node covers a
    // square block of chunks and can fold into ONE flat-grid mesh once the
    // camera is far enough for its size. Folding happens 2x2 at a time as you
    // descend/ascend the tree, so the visible set is always a smooth "cut":
    // fine chunks near the camera, progressively larger merged blocks outward,
    // never a hard jump from one mesh to many. Height is GPU-driven, so a
    // merged node is just a bigger unit grid using the same material — no
    // baking/cache/async needed. Cuts draw calls / matrix updates / frustum
    // checks (the CPU cost), not GPU triangles.
    this.mergeEnabled = true;
    this.mergeQuadsPerChunk = 8;    // merged grid density per chunk span (8 == LOD3)
    this.mergeDistance = 4;         // a node folds when nearest > spanWorld × this
    this.macroProxyEnabled = true;  // allow the root (whole board) to fold to 1 mesh
    this._mergedGeo = new Map();    // "res:aLod" -> shared BufferGeometry
    this._root = null;
    this._treeDirty = true;
    this._mergedNodes = [];         // nodes folded this frame (for culling/stats)
    this._hiddenByMerge = 0;
    this._boardMin = new THREE.Vector3();
    this._boardMax = new THREE.Vector3();
    this.mergedGroupCount = 0;
    this.savedDrawCalls = 0;

    // Debug: tint folded terrain by merge level via the shader's uMergeDebug.
    this._mergeDebug = false;

    this._tmp = new THREE.Vector3();
  }

  // (Re)build the chunk grid. Only called when chunk count / size changes or a
  // full reset is requested. Tile-only changes use syncCells() so already-built
  // cells stay alive and only added/removed cells are touched.
  build({ chunkCount, chunkSize, maxHeight, skirtDepth, lodSegments, cells, tileShape, diskRadiusWorld, progressive = false, initialBatchSize = 64 }) {
    this.dispose();
    this._setLayout({ chunkCount, chunkSize, maxHeight, skirtDepth, lodSegments });
    this._setTileLayout({ cells, tileShape, diskRadiusWorld });
    this._createSharedGeometries();
    this._applyCellDiff({ cells, progressive, initialBatchSize });
  }

  // Incrementally match the occupied tile-cell list. If the chunk layout itself
  // changed, fall back to build(); otherwise preserve existing chunks.
  syncCells({ chunkCount, chunkSize, maxHeight, skirtDepth, lodSegments, cells, tileShape, diskRadiusWorld, progressive = true, initialBatchSize = 64 }) {
    const needsFullBuild = !this.geometries.length
      || this.chunkCount !== chunkCount
      || this.chunkSize !== chunkSize;
    if (needsFullBuild) {
      this.build({ chunkCount, chunkSize, maxHeight, skirtDepth, lodSegments, cells, tileShape, diskRadiusWorld, progressive, initialBatchSize });
      return { rebuilt: true, added: this._cells.length, removed: 0 };
    }

    this._maxHeight = maxHeight;
    this._skirtDepth = skirtDepth;
    if (lodSegments && !this._sameSegments(lodSegments)) this.setLodSegments(lodSegments);
    this._recalcThresholds();
    this.updateBounds(maxHeight, skirtDepth);
    this._setTileLayout({ cells, tileShape, diskRadiusWorld });
    return this._applyCellDiff({ cells, progressive, initialBatchSize });
  }

  // Mirror the Engine's tile occupancy so the merge layer (and chunk creation)
  // knows which world positions actually render terrain.
  _setTileLayout({ cells, tileShape, diskRadiusWorld }) {
    const list = this._normalizeCells(cells);
    this._occupiedCells = new Set(list.map((cell) => `${cell.cx},${cell.cz}`));
    if (tileShape !== undefined) this._tileShape = tileShape === 'circle' ? 'circle' : 'square';
    if (diskRadiusWorld !== undefined) this._diskRadiusWorld = Number(diskRadiusWorld) || 0;
    this._treeDirty = true;
  }

  // CPU mirror of the shader's tileOccupiedAt: true only where terrain is
  // actually rendered. Folding a merged proxy over any non-renderable point
  // would paint ghost terrain (or punch a rectangular hole over hidden chunks).
  _isTerrainRenderable(x, z) {
    if (!this.boardSize) return true;
    const half = this.boardSize / 2;
    const cx = Math.floor((x + half) / this.boardSize);
    const cz = Math.floor((z + half) / this.boardSize);
    if (!this._occupiedCells.has(`${cx},${cz}`)) return false;
    if (this._tileShape === 'circle') {
      return Math.hypot(x, z) <= this._diskRadiusWorld + 1e-4;
    }
    return true;
  }

  // A node may fold only when every tile cell its bbox spans is occupied. The
  // proxy is one rectangular mesh, so a single empty cell inside the bbox (e.g.
  // the diagonal corner of an L assembly) would paint ghost terrain in square
  // mode (no shader discard there). Iterate cell CENTERS rather than the bbox
  // corners — corners sit exactly on cell boundaries and would otherwise leak
  // into the empty diagonal neighbour. In circle mode the shader's disk discard
  // handles sub-cell clipping, so cell occupancy is the only thing to check.
  _nodeFullyRenderable(node) {
    if (!this.boardSize) return true;
    const half = this.boardSize / 2;
    const eps = this.boardSize * 1e-3;
    const c0x = Math.floor((node.minX + eps + half) / this.boardSize);
    const c1x = Math.floor((node.minX + node.spanX - eps + half) / this.boardSize);
    const c0z = Math.floor((node.minZ + eps + half) / this.boardSize);
    const c1z = Math.floor((node.minZ + node.spanZ - eps + half) / this.boardSize);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        if (!this._occupiedCells.has(`${cx},${cz}`)) return false;
      }
    }
    return true;
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
        const job = {
          x,
          z,
          centerX: x + this.chunkSize / 2,
          centerZ: z + this.chunkSize / 2,
          cellCx: cell.cx,
          cellCz: cell.cz,
          cellKey,
        };
        if (this._chunkIntersectsRenderable(job)) jobs.push(job);
      }
    }
    return jobs;
  }

  // Skip chunks whose footprint is non-renderable. Square mode: any corner
  // inside an occupied cell is enough. Circle mode: require the chunk centre
  // (or most of the footprint) inside the disk so corner-only slivers don't
  // paint blocky stair-steps past the circular silhouette.
  _chunkIntersectsRenderable(job) {
    const h = this.chunkSize / 2;
    const pts = [
      [job.centerX - h, job.centerZ - h],
      [job.centerX + h, job.centerZ - h],
      [job.centerX - h, job.centerZ + h],
      [job.centerX + h, job.centerZ + h],
      [job.centerX, job.centerZ],
    ];
    if (this._tileShape !== 'circle') {
      return pts.some(([x, z]) => this._isTerrainRenderable(x, z));
    }
    if (this._isTerrainRenderable(job.centerX, job.centerZ)) return true;
    let inside = 0;
    for (const [x, z] of pts) if (this._isTerrainRenderable(x, z)) inside++;
    return inside >= 3;
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
      this._treeDirty = true;
      this._disposeNodeMeshes();
    }

    if (addedCells.length) {
      const jobs = addedCells.flatMap((cell) => this._jobsForCell(cell));
      // Build nearest chunks first so the first visible board is useful, then
      // stream the edges in behind it.
      this._sortJobsNearestFirst(jobs);
      this._buildQueue.push(...jobs);
    }

    this._cells = nextCells;
    // Count real chunks + queued jobs (some are filtered out as non-renderable
    // in circle mode) so build progress can actually reach 1.
    this.targetChunkCount = this.chunks.length + this._buildQueue.length;
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
      merged: false,
      node: null,
    });
    this._treeDirty = true;
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

  // Pick a LOD per chunk from camera distance, then (if enabled) walk the
  // quadtree and fold far blocks into single meshes. Pure view-dependent
  // detail — the height field itself is never touched.
  updateLOD(cameraPos) {
    this._processLodRebuild();

    if (!this.mergeEnabled) {
      this._updateChunkLOD(cameraPos, false);
      return;
    }
    if (this._treeDirty) this._rebuildTree();

    this._mergedNodes.length = 0;
    this._hiddenByMerge = 0;
    if (this._root) this._visitNode(this._root, cameraPos);

    this.mergedGroupCount = this._mergedNodes.length;
    this.savedDrawCalls = Math.max(0, this._hiddenByMerge - this._mergedNodes.length);

    this._updateChunkLOD(cameraPos, true);
  }

  // Recursively decide, per node, whether to fold it into one mesh or descend
  // into its 4 children. A node folds once the camera's nearest distance to it
  // exceeds its world span × mergeDistance (3D distance, so overhead views fold
  // too), with hysteresis so it doesn't flicker at the boundary.
  _visitNode(node, camPos) {
    if (node.leaf) {
      // single detailed chunk — hand it back to the per-chunk LOD pass
      if (node.chunk.merged) { node.chunk.merged = false; node.chunk.mesh.visible = true; }
      return;
    }
    // Never fold a block whose bbox straddles empty/clipped space — its single
    // rectangular proxy would render ghost terrain over unoccupied cells.
    const canFold = (this.macroProxyEnabled || node.level > 0) && this._nodeFullyRenderable(node);
    const nearest = Math.hypot(node.center.x - camPos.x, camPos.y, node.center.z - camPos.z) - node.half;
    const foldDist = node.spanWorld * this.mergeDistance * this._distanceScale;
    const want = canFold && (node.merged ? nearest > foldDist * 0.85 : nearest > foldDist);

    if (want) {
      if (!node.merged) this._foldNode(node);
      this._mergedNodes.push(node);
      this._hiddenByMerge += node.chunks.length;
    } else {
      if (node.merged) this._unfoldNode(node);
      for (const child of node.children) this._visitNode(child, camPos);
    }
  }

  // Distance-based geometry LOD for the detailed chunks. When skipMerged is
  // true, chunks hidden by an active merge/macro state are left untouched.
  _updateChunkLOD(cameraPos, skipMerged) {
    const [t0, t1, t2] = this.lodThresholds;
    const counts = [0, 0, 0, 0];
    for (const chunk of this.chunks) {
      if (skipMerged && chunk.merged) continue;
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

  // Tune the merge layer (performance settings).
  setMergeOptions({ enabled, quadsPerChunk, mergeDistance, macroEnabled } = {}) {
    if (enabled !== undefined && enabled !== this.mergeEnabled) {
      this.mergeEnabled = !!enabled;
      if (!this.mergeEnabled) this._restoreAll();
    }
    if (quadsPerChunk !== undefined) {
      const v = Math.max(2, Math.round(quadsPerChunk));
      if (v !== this.mergeQuadsPerChunk) {
        this.mergeQuadsPerChunk = v;
        this._disposeNodeMeshes();   // node resolution changed → rebuild lazily
      }
    }
    if (mergeDistance !== undefined) {
      const v = Number(mergeDistance);
      if (Number.isFinite(v)) this.mergeDistance = Math.max(0.5, v);
    }
    if (macroEnabled !== undefined) this.macroProxyEnabled = !!macroEnabled;
  }

  // --- Quadtree ------------------------------------------------------------
  // Build a spatial quadtree over the current chunks. Leaves are single chunks;
  // internal nodes cover a square block and own a lazily-built merged mesh.
  _rebuildTree() {
    this._treeDirty = false;
    this._disposeNodeMeshes();
    if (!this.chunks.length) { this._root = null; return; }

    const cs = this.chunkSize;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const c of this.chunks) {
      const x0 = c.center.x - cs / 2, z0 = c.center.z - cs / 2;
      if (x0 < minX) minX = x0;
      if (z0 < minZ) minZ = z0;
      if (x0 + cs > maxX) maxX = x0 + cs;
      if (z0 + cs > maxZ) maxZ = z0 + cs;
      c.node = null;
      c.merged = false;
      c.mesh.visible = true;   // folds below re-hide as needed; avoids a gap
    }
    this._boardMin.set(minX, 0, minZ);
    this._boardMax.set(maxX, 0, maxZ);
    const size = Math.max(maxX - minX, maxZ - minZ);
    this._root = this._buildNode(this.chunks, minX, minZ, size, 0);
  }

  _buildNode(chunks, minX, minZ, size, level) {
    if (chunks.length === 1) return this._leafNode(chunks[0], level);

    const cs = this.chunkSize;
    const half = size / 2;
    if (half < cs * 0.75) {
      // chunk scale reached: children are the individual chunks
      return this._internalNode(chunks.map((c) => this._leafNode(c, level + 1)), chunks, level);
    }

    const midX = minX + half, midZ = minZ + half;
    const q = [[], [], [], []];
    for (const c of chunks) {
      const ix = c.center.x < midX ? 0 : 1;
      const iz = c.center.z < midZ ? 0 : 1;
      q[iz * 2 + ix].push(c);
    }
    const offs = [[minX, minZ], [midX, minZ], [minX, midZ], [midX, midZ]];
    const children = [];
    for (let i = 0; i < 4; i++) {
      if (!q[i].length) continue;
      const child = this._buildNode(q[i], offs[i][0], offs[i][1], half, level + 1);
      if (child) children.push(child);
    }
    if (children.length === 1) return children[0];   // collapse degenerate (sparse) node
    return this._internalNode(children, chunks, level);
  }

  _leafNode(chunk, level) {
    const cs = this.chunkSize;
    const x0 = chunk.center.x - cs / 2, z0 = chunk.center.z - cs / 2;
    const node = {
      leaf: true, chunk, children: null, chunks: [chunk],
      minX: x0, minZ: z0, spanX: cs, spanZ: cs, spanWorld: cs, spanChunks: 1,
      center: new THREE.Vector3(chunk.center.x, 0, chunk.center.z),
      half: cs * 0.7072, level, mesh: null, merged: false,
    };
    chunk.node = node;
    return node;
  }

  _internalNode(children, chunks, level) {
    const cs = this.chunkSize;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const c of chunks) {
      const x0 = c.center.x - cs / 2, z0 = c.center.z - cs / 2;
      if (x0 < minX) minX = x0;
      if (z0 < minZ) minZ = z0;
      if (x0 + cs > maxX) maxX = x0 + cs;
      if (z0 + cs > maxZ) maxZ = z0 + cs;
    }
    const spanX = maxX - minX, spanZ = maxZ - minZ;
    const spanWorld = Math.max(spanX, spanZ);
    return {
      leaf: false, chunk: null, children, chunks,
      minX, minZ, spanX, spanZ, spanWorld,
      spanChunks: Math.max(2, Math.round(spanWorld / cs)),
      center: new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2),
      half: 0.5 * Math.hypot(spanX, spanZ), level, mesh: null, merged: false,
    };
  }

  // Shared flat unit-grid geometry (with skirts) for a given resolution. aLod
  // encodes the merge tier so the shader can colour folded terrain by level.
  _mergedGeometry(res, aLod) {
    const key = `${res}:${aLod}`;
    let geo = this._mergedGeo.get(key);
    if (!geo) {
      geo = buildChunkGeometry(res, aLod);
      this._mergedGeo.set(key, geo);
    }
    return geo;
  }

  // Fold a node into one mesh: show its merged mesh, hide every descendant
  // (chunks + deeper node meshes). Tier (log2 of span in chunks) drives both
  // mesh resolution and the debug colour.
  _foldNode(node) {
    node.merged = true;
    if (!node.mesh) {
      const tier = Math.max(1, Math.round(Math.log2(node.spanChunks)));
      const res = Math.min(160, Math.max(8, node.spanChunks * this.mergeQuadsPerChunk));
      const aLod = 3 + Math.min(5, tier);   // 4..8 → colour ramp in shader
      const mesh = new THREE.Mesh(this._mergedGeometry(res, aLod), this.material);
      mesh.position.set(node.minX, 0, node.minZ);
      mesh.scale.set(node.spanX, 1, node.spanZ);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      mesh.updateMatrix();
      mesh.updateMatrixWorld(true);
      this.group.add(mesh);
      node.mesh = mesh;
    }
    node.mesh.visible = true;
    for (const c of node.chunks) { c.merged = true; c.mesh.visible = false; }
    this._forEachDescendantInternal(node, (d) => {
      d.merged = false;
      if (d.mesh) d.mesh.visible = false;
    });
  }

  // Unfold a node: hide its mesh. Children are re-evaluated in the same
  // updateLOD pass (so chunks/child meshes reappear with no one-frame blank).
  _unfoldNode(node) {
    node.merged = false;
    if (node.mesh) node.mesh.visible = false;
  }

  _forEachDescendantInternal(node, fn) {
    if (!node.children) return;
    for (const child of node.children) {
      if (child.leaf) continue;
      fn(child);
      this._forEachDescendantInternal(child, fn);
    }
  }

  _forEachInternal(fn) {
    const rec = (n) => {
      if (!n || n.leaf) return;
      fn(n);
      for (const c of n.children) rec(c);
    };
    rec(this._root);
  }

  _restoreAll() {
    for (const c of this.chunks) { c.merged = false; c.mesh.visible = true; }
    this._forEachInternal((n) => { n.merged = false; if (n.mesh) n.mesh.visible = false; });
    this._mergedNodes.length = 0;
    this.mergedGroupCount = 0;
    this.savedDrawCalls = 0;
  }

  _disposeNodeMeshes() {
    this._forEachInternal((n) => {
      if (n.mesh) { this.group.remove(n.mesh); n.mesh = null; }
      n.merged = false;
    });
    this._mergedNodes.length = 0;
  }

  *_activeChunks() {
    for (const chunk of this.chunks) if (!chunk.merged) yield chunk;
  }

  // --- Debug overlay -------------------------------------------------------
  // Colour folded terrain by merge level (green = small 2x2 fold → magenta =
  // whole board) via the shared terrain shader's uMergeDebug branch. Merged
  // meshes carry aLod 4..8 (the tier) so the shader can ramp the colour.
  setMergeDebug(on) {
    this._mergeDebug = !!on;
    const u = this.material?.uniforms?.uMergeDebug;
    if (u) u.value = this._mergeDebug ? 1.0 : 0.0;
  }

  // Cull invisible terrain meshes based on the camera frustum and facing
  // direction. Detailed chunks and folded node meshes are culled separately;
  // chunks hidden by an active fold are skipped (left invisible).
  // visibleChunkCount / culledChunkCount are reported in draw calls (a folded
  // node counts as one), which is the figure the merge layer is optimising.
  cull(camera) {
    if (!this.cullingEnabled) {
      let visibleCount = 0;
      for (const chunk of this.chunks) {
        if (chunk.merged) { if (chunk.mesh.visible) chunk.mesh.visible = false; continue; }
        if (!chunk.mesh.visible) chunk.mesh.visible = true;
        visibleCount++;
      }
      for (const node of this._mergedNodes) { node.mesh.visible = true; visibleCount++; }
      this.visibleChunkCount = visibleCount;
      this.culledChunkCount = 0;
      return;
    }

    const chunkResult = cullChunks(
      this._activeChunks(),
      camera,
      this.chunkSize,
      this._maxHeight,
      this.behindCameraCulling,
      this.cullingAggressiveness
    );
    let visible = chunkResult.visibleCount;
    let culled = chunkResult.culledCount;

    if (this._mergedNodes.length) {
      // Folded nodes vary in size; use the board span as a conservative
      // bounding-sphere radius so big folded blocks are never wrongly culled.
      const mergeResult = cullChunks(
        this._mergedNodes,
        camera,
        this.boardSize,
        this._maxHeight,
        this.behindCameraCulling,
        this.cullingAggressiveness
      );
      visible += mergeResult.visibleCount;
      culled += mergeResult.culledCount;
    }

    this.visibleChunkCount = visible;
    this.culledChunkCount = culled;
  }

  dispose() {
    this._disposeNodeMeshes();
    for (const geo of this._mergedGeo.values()) geo.dispose();
    this._mergedGeo.clear();
    this._root = null;
    this._treeDirty = true;
    this.mergedGroupCount = 0;
    this.savedDrawCalls = 0;
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
