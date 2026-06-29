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

    // --- Merge layer ---------------------------------------------------------
    // Collapse far chunks into fewer, larger flat-grid meshes to cut draw
    // calls, world-matrix updates and frustum checks. Height is GPU-driven, so
    // a merged mesh is just one bigger unit grid using the same material; no
    // baking, caching or async generation is needed. Merging only kicks in
    // once a whole group is past the LOD3 boundary, so it replaces equal-density
    // geometry — pure draw-call win, no silhouette change.
    this.mergeEnabled = true;
    this.mergeGroupSize = 4;        // GxG chunks per merged mesh
    this.mergeQuadsPerChunk = 8;    // merged grid density (8 == LOD3, lossless)
    this.macroProxyEnabled = true;
    this.macroQuads = 48;           // single full-board proxy resolution
    this._groups = [];
    this._groupsDirty = true;
    this._mergedGeo = new Map();    // res -> shared BufferGeometry
    this._macroMesh = null;
    this._boardMin = new THREE.Vector3();
    this._boardMax = new THREE.Vector3();
    this.macroActive = false;
    this.mergedGroupCount = 0;
    this.savedDrawCalls = 0;

    // Debug: tint folded terrain via the shader's uMergeDebug branch.
    this._mergeDebug = false;

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
      this._groupsDirty = true;
      this._disposeMergedMeshes();
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
      merged: false,
      group: null,
    });
    this._groupsDirty = true;
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

  // Pick a LOD per chunk from camera distance, then (if enabled) collapse far
  // groups into merged meshes and the whole board into a macro proxy. Pure
  // view-dependent detail — the height field itself is never touched.
  updateLOD(cameraPos) {
    this._processLodRebuild();

    if (!this.mergeEnabled) {
      this._updateChunkLOD(cameraPos, false);
      return;
    }
    if (this._groupsDirty) this._rebuildGroups();

    const t2 = this.lodThresholds[2];

    // Macro proxy: a single mesh for the whole board, only once the board's
    // nearest point is well past the LOD3 boundary (with hysteresis). Distance
    // is full 3D — including camera height — so a far overhead view also folds.
    if (this.macroProxyEnabled && this._groups.length) {
      const macroOn = t2 * 2.5;
      const macroOff = t2 * 2.0;
      const cx = (this._boardMin.x + this._boardMax.x) / 2;
      const cz = (this._boardMin.z + this._boardMax.z) / 2;
      const boardHalf = 0.5 * Math.hypot(
        this._boardMax.x - this._boardMin.x,
        this._boardMax.z - this._boardMin.z
      );
      const nearest = Math.hypot(cx - cameraPos.x, cameraPos.y, cz - cameraPos.z) - boardHalf;
      const want = this.macroActive ? nearest > macroOff : nearest > macroOn;
      if (want) { this._activateMacro(); return; }
      this._deactivateMacro();
    }

    // Per-group merge decision: merge once the group's nearest point is past
    // the LOD3 boundary (so it only ever replaces LOD3-density chunks). Uses
    // full 3D distance so it matches per-chunk LOD and folds from overhead too.
    const mergeOn = t2;
    const mergeOff = t2 * 0.85;
    let mergedGroups = 0, hiddenChunks = 0;
    for (const g of this._groups) {
      const nearest = Math.hypot(g.center.x - cameraPos.x, cameraPos.y, g.center.z - cameraPos.z) - g.half;
      const want = g.merged ? nearest > mergeOff : nearest > mergeOn;
      if (want) {
        if (!g.merged) this._mergeGroup(g);
        mergedGroups++;
        hiddenChunks += g.chunks.length;
      } else if (g.merged) {
        this._splitGroup(g);
      }
    }
    this.mergedGroupCount = mergedGroups;
    this.savedDrawCalls = hiddenChunks - mergedGroups;

    this._updateChunkLOD(cameraPos, true);
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

  // Tune the merge layer (performance settings). Layout/resolution changes drop
  // existing merged meshes so they rebuild lazily with the new parameters.
  setMergeOptions({ enabled, groupSize, quadsPerChunk, macroEnabled, macroQuads } = {}) {
    let layoutChanged = false;
    if (enabled !== undefined && enabled !== this.mergeEnabled) {
      this.mergeEnabled = !!enabled;
      if (!this.mergeEnabled) this._restoreAllChunks();
    }
    if (groupSize !== undefined) {
      const v = Math.max(2, Math.round(groupSize));
      if (v !== this.mergeGroupSize) { this.mergeGroupSize = v; layoutChanged = true; }
    }
    if (quadsPerChunk !== undefined) {
      const v = Math.max(2, Math.round(quadsPerChunk));
      if (v !== this.mergeQuadsPerChunk) { this.mergeQuadsPerChunk = v; layoutChanged = true; }
    }
    if (macroEnabled !== undefined) {
      this.macroProxyEnabled = !!macroEnabled;
      if (!this.macroProxyEnabled) this._deactivateMacro();
    }
    if (macroQuads !== undefined) {
      const v = Math.max(8, Math.round(macroQuads));
      if (v !== this.macroQuads) { this.macroQuads = v; this._disposeMacro(); }
    }
    if (layoutChanged) {
      this._groupsDirty = true;
      this._disposeMergedMeshes();
    }
  }

  // Bucket the current chunks into GxG world-space blocks and record each
  // block's world extent plus the whole-board bounding box.
  _rebuildGroups() {
    this._groupsDirty = false;
    const G = this.mergeGroupSize;
    const cs = this.chunkSize;
    const map = new Map();
    const groups = [];
    let bminX = Infinity, bminZ = Infinity, bmaxX = -Infinity, bmaxZ = -Infinity;

    for (const chunk of this.chunks) {
      const x0 = chunk.center.x - cs / 2;
      const z0 = chunk.center.z - cs / 2;
      const bx = Math.floor(Math.round(x0 / cs) / G);
      const bz = Math.floor(Math.round(z0 / cs) / G);
      const key = `${bx},${bz}`;
      let g = map.get(key);
      if (!g) {
        g = {
          chunks: [], merged: false, mesh: null, center: new THREE.Vector3(),
          minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity,
          spanX: 0, spanZ: 0, half: 0,
        };
        map.set(key, g);
        groups.push(g);
      }
      g.chunks.push(chunk);
      chunk.group = g;
      chunk.merged = false;
      if (x0 < g.minX) g.minX = x0;
      if (z0 < g.minZ) g.minZ = z0;
      if (x0 + cs > g.maxX) g.maxX = x0 + cs;
      if (z0 + cs > g.maxZ) g.maxZ = z0 + cs;
    }

    for (const g of groups) {
      g.spanX = g.maxX - g.minX;
      g.spanZ = g.maxZ - g.minZ;
      g.center.set((g.minX + g.maxX) / 2, 0, (g.minZ + g.maxZ) / 2);
      g.half = 0.5 * Math.hypot(g.spanX, g.spanZ);
      if (g.minX < bminX) bminX = g.minX;
      if (g.minZ < bminZ) bminZ = g.minZ;
      if (g.maxX > bmaxX) bmaxX = g.maxX;
      if (g.maxZ > bmaxZ) bmaxZ = g.maxZ;
    }

    this._groups = groups;
    if (groups.length) {
      this._boardMin.set(bminX, 0, bminZ);
      this._boardMax.set(bmaxX, 0, bmaxZ);
    }
  }

  // Shared flat unit-grid geometry (with skirts) for a given resolution. The
  // lodIndex tags the geometry's aLod attribute (4 = merged group, 5 = macro
  // proxy) so the terrain shader can colour folded terrain in the debug views.
  _mergedGeometry(res, lodIndex) {
    const key = `${res}:${lodIndex}`;
    let geo = this._mergedGeo.get(key);
    if (!geo) {
      geo = buildChunkGeometry(res, lodIndex);
      this._mergedGeo.set(key, geo);
    }
    return geo;
  }

  _mergeGroup(g) {
    g.merged = true;
    if (!g.mesh) {
      const cs = this.chunkSize;
      const chunksPerSide = Math.max(1, Math.round(Math.max(g.spanX, g.spanZ) / cs));
      const res = Math.min(192, Math.max(8, chunksPerSide * this.mergeQuadsPerChunk));
      const mesh = new THREE.Mesh(this._mergedGeometry(res, 4), this.material);
      mesh.position.set(g.minX, 0, g.minZ);
      mesh.scale.set(g.spanX, 1, g.spanZ);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      mesh.updateMatrix();
      mesh.updateMatrixWorld(true);
      this.group.add(mesh);
      g.mesh = mesh;
    }
    g.mesh.visible = true;
    for (const chunk of g.chunks) { chunk.merged = true; chunk.mesh.visible = false; }
  }

  _splitGroup(g) {
    g.merged = false;
    if (g.mesh) g.mesh.visible = false;
    // Reveal the chunks in the SAME pass we hide the merged mesh. Waiting for
    // the next frame's cull leaves a one-frame gap where neither is drawn — the
    // flicker. cull re-tightens frustum visibility on the following frame.
    for (const chunk of g.chunks) { chunk.merged = false; chunk.mesh.visible = true; }
  }

  _activateMacro() {
    if (!this._macroMesh) {
      const mesh = new THREE.Mesh(this._mergedGeometry(this.macroQuads, 5), this.material);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this._macroMesh = mesh;
    }
    const spanX = this._boardMax.x - this._boardMin.x;
    const spanZ = this._boardMax.z - this._boardMin.z;
    this._macroMesh.position.set(this._boardMin.x, 0, this._boardMin.z);
    this._macroMesh.scale.set(spanX || 1, 1, spanZ || 1);
    this._macroMesh.updateMatrix();
    this._macroMesh.updateMatrixWorld(true);
    this._macroMesh.visible = true;
    this.macroActive = true;

    for (const chunk of this.chunks) { chunk.merged = true; chunk.mesh.visible = false; }
    for (const g of this._groups) { g.merged = false; if (g.mesh) g.mesh.visible = false; }
    this.mergedGroupCount = 0;
    this.savedDrawCalls = Math.max(0, this.chunks.length - 1);
    this.lodCounts = [0, 0, 0, 0];
  }

  _deactivateMacro() {
    if (!this.macroActive) return;
    this.macroActive = false;
    if (this._macroMesh) this._macroMesh.visible = false;
    // Reveal every chunk now (no one-frame blank); the group loop that runs
    // right after this re-hides the ones that should re-merge.
    for (const chunk of this.chunks) { chunk.merged = false; chunk.mesh.visible = true; }
  }

  _restoreAllChunks() {
    for (const chunk of this.chunks) chunk.merged = false;
    for (const g of this._groups) { g.merged = false; if (g.mesh) g.mesh.visible = false; }
    if (this._macroMesh) this._macroMesh.visible = false;
    this.macroActive = false;
    this.mergedGroupCount = 0;
    this.savedDrawCalls = 0;
  }

  _disposeMergedMeshes() {
    for (const g of this._groups) {
      if (g.mesh) { this.group.remove(g.mesh); g.mesh = null; }
      g.merged = false;
    }
    this._disposeMacro();
  }

  _disposeMacro() {
    if (this._macroMesh) { this.group.remove(this._macroMesh); this._macroMesh = null; }
    this.macroActive = false;
  }

  *_activeChunks() {
    for (const chunk of this.chunks) if (!chunk.merged) yield chunk;
  }

  *_activeMergedMeshes() {
    for (const g of this._groups) if (g.merged && g.mesh) yield g;
  }

  // --- Debug overlay -------------------------------------------------------
  // Tint folded terrain directly on the surface (green = merged group, magenta
  // = macro proxy) via the shared terrain shader. Merged meshes carry aLod 4/5
  // so the shader's uMergeDebug branch can colour them.
  setMergeDebug(on) {
    this._mergeDebug = !!on;
    const u = this.material?.uniforms?.uMergeDebug;
    if (u) u.value = this._mergeDebug ? 1.0 : 0.0;
  }

  // Cull invisible terrain meshes based on the camera frustum and facing
  // direction. Detailed chunks and merged group meshes are culled separately;
  // chunks hidden by an active merge/macro state are skipped (left invisible).
  // visibleChunkCount / culledChunkCount are reported in draw calls (a merged
  // mesh counts as one), which is the figure the merge layer is optimising.
  cull(camera) {
    // Macro proxy: the whole board is one mesh. Keep it visible (its bounding
    // box spans the board, so it is effectively always on screen).
    if (this.macroActive) {
      if (this._macroMesh) this._macroMesh.visible = true;
      this.visibleChunkCount = this._macroMesh ? 1 : 0;
      this.culledChunkCount = this.chunks.length;
      return;
    }

    if (!this.cullingEnabled) {
      let visibleCount = 0;
      for (const chunk of this.chunks) {
        if (chunk.merged) { if (chunk.mesh.visible) chunk.mesh.visible = false; continue; }
        if (!chunk.mesh.visible) chunk.mesh.visible = true;
        visibleCount++;
      }
      for (const g of this._groups) {
        if (g.merged && g.mesh) { g.mesh.visible = true; visibleCount++; }
      }
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

    if (this.mergeEnabled && this.mergedGroupCount) {
      const mergeResult = cullChunks(
        this._activeMergedMeshes(),
        camera,
        this.chunkSize * this.mergeGroupSize,
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
    this._disposeMergedMeshes();
    for (const geo of this._mergedGeo.values()) geo.dispose();
    this._mergedGeo.clear();
    this._groups = [];
    this._groupsDirty = true;
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
