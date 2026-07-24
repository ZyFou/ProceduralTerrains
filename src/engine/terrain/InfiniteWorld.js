import * as THREE from 'three';
import { buildChunkGeometry, setChunkBounds } from './ChunkGeometry.js';
import { createCullingContext, cullChunks } from './InfiniteTerrainCulling.js';
import { ChunkStreamScheduler, getRadialOffsets } from './ChunkStreamScheduler.js';
import { InfiniteTerrainBatches } from './InfiniteTerrainBatches.js';
import { MergeQuadtree } from './MergeQuadtree.js';

// ============================================================================
// InfiniteWorld: streams terrain chunks around the player camera.
// Chunks are lightweight logical records on an integer grid (cx, cz). Visible
// records are compacted into four InstancedMesh batches, one per LOD, keeping
// terrain draw calls and scene-graph objects constant while the player moves.
// ============================================================================

const LOD_RESOLUTIONS = [64, 32, 16, 8];
const DEFAULT_LOD_DISTANCES = [4, 8, 14];   // × chunkSize
const DEFAULT_MAX_CREATES = 0;

export class InfiniteWorld {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Material} terrainMaterial  — infinite-mode terrain material
   * @param {THREE.Material} waterMaterial    — infinite-mode water material
   * @param {Object} opts
   * @param {number} opts.chunkSize       — world units per chunk side
   * @param {number} opts.viewRadius      — how many chunks outward to load
   * @param {number} opts.maxHeight       — vertical ceiling for bounding boxes
   * @param {number} opts.skirtDepth      — skirt depth for geometry bounds
   * @param {number} opts.seaLevel        — water plane height
   * @param {number[]} [opts.lodSegments]  — per-LOD quads per chunk side
   * @param {number[]} [opts.lodDistances] — LOD thresholds (× chunkSize)
   * @param {number} [opts.waterDistance]  — water extent as fraction of terrain
   */
  constructor(scene, terrainMaterial, waterMaterial, opts) {
    this.scene = scene;
    this.terrainMaterial = terrainMaterial;
    this.waterMaterial = waterMaterial;

    this.chunkSize = opts.chunkSize;
    this.viewRadius = opts.viewRadius || 12;
    this.maxHeight = opts.maxHeight;
    this.skirtDepth = opts.skirtDepth;
    this.seaLevel = opts.seaLevel ?? 42;
    this.maxCreatesPerFrame = DEFAULT_MAX_CREATES;
    this.chunkStreamBudgetMs = 1.5;
    this.lodSegments = opts.lodSegments ? [...opts.lodSegments] : [...LOD_RESOLUTIONS];

    // Culling options
    this.cullingEnabled = true;
    this.behindCameraCulling = true;
    this.cullingAggressiveness = 1.0;

    // Triangle budget: when the rendered triangle count exceeds the budget,
    // LOD thresholds are scaled down progressively (no geometry rebuild)
    // until the scene fits; they recover when there is headroom.
    this.triangleBudget = 0;        // 0 = unlimited
    this._budgetScale = 1.0;
    this._lastTriangles = 0;
    this._budgetCheckAt = 0;

    // Gradual LOD geometry rebuild queue (one LOD level per frame)
    this._lodRebuildQueue = [];
    this._targetSegments = null;

    // Water render distance as a fraction of the terrain render distance
    this._waterDistanceFactor = opts.waterDistance ?? 1.0;

    // group contains all terrain chunks
    this.group = new THREE.Group();
    this.group.name = 'infinite-world';
    this.scene.add(this.group);

    // water plane — follows player, sized to match terrain radius
    this.waterPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      this.waterMaterial
    );
    this.waterPlane.geometry.rotateX(-Math.PI / 2);
    this.waterPlane.renderOrder = 10;
    this.waterPlane.frustumCulled = false;
    this.waterPlane.position.y = this.seaLevel;
    this._updateWaterSize();
    this.scene.add(this.waterPlane);

    // shared geometries per LOD
    this.geometries = this.lodSegments.map((res, lodIndex) => {
      const geo = buildChunkGeometry(res, lodIndex);
      setChunkBounds(geo, this.chunkSize, this.maxHeight, this.skirtDepth);
      return geo;
    });

    // LOD distance thresholds (scale with chunk size and quality)
    this._baseLodThresholds = opts.lodDistances
      ? [...opts.lodDistances]
      : [...DEFAULT_LOD_DISTANCES];           // multiplied by chunkSize
    this._lodMultiplier = 1.0;
    this.lodThresholds = this._baseLodThresholds.map(m => m * this.chunkSize);
    this._lodThresholds2 = this.lodThresholds.map(t => t * t);

    // chunk map: "cx,cz" -> { cx, cz, centerX, centerZ, lod, visible }
    this.chunks = new Map();

    // player chunk tracking
    this._lastPlayerCX = Infinity;
    this._lastPlayerCZ = Infinity;

    // Time-budgeted nearest-first chunk streaming queue.
    this.streamScheduler = new ChunkStreamScheduler({
      budgetMs: this.chunkStreamBudgetMs,
    });

    // Instancing already solves the draw-call problem that MergeQuadtree was
    // built for. Keep the public merge object for settings/diagnostics, but do
    // not build or visit its tree on the instanced path.
    this.merge = new MergeQuadtree(this.group, this.terrainMaterial);
    this.merge.setChunkSize(this.chunkSize);
    this.merge.setOptions({ enabled: false });
    this.mergedGroupCount = 0;
    this.savedDrawCalls = 0;

    this.batches = new InfiniteTerrainBatches({
      group: this.group,
      material: this.terrainMaterial,
      geometries: this.geometries,
      capacity: getRadialOffsets(this.viewRadius + 2).length,
    });
    this._batchesDirty = true;
    this._cullingContext = {};

    // stats
    this.activeChunkCount = 0;
    this.visibleChunkCount = 0;
    this.culledChunkCount = 0;
    this.lodCounts = [0, 0, 0, 0];
    this.pendingChunkCount = 0;
    this.createdChunkCount = 0;
    this.removedChunkCount = 0;
    this.streamTimeMs = 0;
    this.terrainDrawCallCount = 0;
  }

  /** Tune the merge layer (performance settings). */
  setMergeOptions(opts) {
    // Merge meshes and instanced batches solve the same draw-call problem.
    // Building both would add traversal/rebuild cost without reducing draws.
    this.merge.setOptions({ ...opts, enabled: false });
  }

  /** Toggle the merge-debug surface tint (drives the shared uMergeDebug). */
  setMergeDebug(on) {
    const u = this.terrainMaterial?.uniforms?.uMergeDebug;
    if (u) u.value = on ? 1.0 : 0.0;
  }

  /**
   * Update water plane size to match terrain render distance.
   * Water extends exactly to the terrain edge (viewRadius * 2 + 1 chunks)
   * so it never renders beyond where terrain exists.
   */
  _updateWaterSize() {
    const waterSize = this.chunkSize * (this.viewRadius * 2 + 1) * this._waterDistanceFactor;
    this.waterPlane.scale.set(waterSize, 1, waterSize);

    // Update water fade distance uniforms (if available)
    if (this.waterMaterial.uniforms.uWaterFadeStart) {
      const fadeStart = waterSize * 0.42;
      const fadeEnd = waterSize * 0.50;
      this.waterMaterial.uniforms.uWaterFadeStart.value = fadeStart;
      this.waterMaterial.uniforms.uWaterFadeEnd.value = fadeEnd;
    }
  }

  /**
   * Change the view radius at runtime (e.g. quality preset change).
   * Recalculates chunk set, water size, and LOD thresholds without
   * rebuilding chunk geometry.
   */
  setViewRadius(r) {
    if (r === this.viewRadius) return;
    this.viewRadius = r;
    this._recalcLodThresholds();
    this._updateWaterSize();
    if (this.batches.ensureCapacity(getRadialOffsets(this.viewRadius + 2).length)) {
      this._batchesDirty = true;
    }
    // Force recalc on next update
    this._lastPlayerCX = Infinity;
    this._lastPlayerCZ = Infinity;
  }

  /**
   * Change the LOD distance multiplier (quality preset).
   * Lower = chunks drop to low-detail sooner (better perf).
   * Higher = chunks keep high-detail further out (better visuals).
   */
  setLodMultiplier(m) {
    this._lodMultiplier = m;
    this._recalcLodThresholds();
  }

  /**
   * Change the base LOD distance thresholds (in chunk-size units).
   */
  setLodDistances(distances) {
    this._baseLodThresholds = [...distances];
    this._recalcLodThresholds();
  }

  /** Recompute LOD thresholds from base × chunkSize × multiplier × budget. */
  _recalcLodThresholds() {
    this.lodThresholds = this._baseLodThresholds.map(
      m => m * this.chunkSize * this._lodMultiplier * this._budgetScale
    );
    this._lodThresholds2 = this.lodThresholds.map(t => t * t);
  }

  /**
   * Change max chunk creates per frame. 0 selects the automatic time-budgeted
   * scheduler; it no longer means unbounded work in one frame.
   */
  setMaxCreatesPerFrame(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) {
      this.maxCreatesPerFrame = DEFAULT_MAX_CREATES;
    } else if (v <= 0) {
      this.maxCreatesPerFrame = DEFAULT_MAX_CREATES;
    } else {
      this.maxCreatesPerFrame = Math.max(1, Math.round(v));
    }
  }

  setChunkStreamBudget(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value <= 0) return;
    this.chunkStreamBudgetMs = Math.min(8, Math.max(0.25, value));
    this.streamScheduler.budgetMs = this.chunkStreamBudgetMs;
  }

  /**
   * Change per-LOD segment counts. Geometry is rebuilt GRADUALLY — one LOD
   * level per frame in update() — so the app never freezes, and chunks keep
   * their old shared geometry until the replacement is ready.
   */
  setLodSegments(segments) {
    const same = segments.length === this.lodSegments.length
      && segments.every((s, i) => s === this.lodSegments[i])
      && !this._lodRebuildQueue.length;
    if (same) return;
    this._targetSegments = [...segments];
    // Rebuild cheap (far) LODs first so streaming chunks pick them up early
    this._lodRebuildQueue = [3, 2, 1, 0];
  }

  /** Build one queued LOD geometry and swap it on the chunks using it. */
  _processLodRebuild() {
    if (!this._lodRebuildQueue.length || !this._targetSegments) return;
    const lod = this._lodRebuildQueue.shift();
    const res = this._targetSegments[lod];
    if (res === this.lodSegments[lod]) return;   // this level is unchanged

    const geo = buildChunkGeometry(res, lod);
    setChunkBounds(geo, this.chunkSize, this.maxHeight, this.skirtDepth);
    const old = this.geometries[lod];
    this.geometries[lod] = geo;
    this.lodSegments[lod] = res;

    this.batches.updateGeometry(lod, geo);
    this._batchesDirty = true;
    old.dispose();
  }

  /**
   * Set the maximum triangle budget (0 = unlimited). Enforced by scaling
   * LOD thresholds down — cheap LOD swaps only, never a rebuild.
   */
  setTriangleBudget(n) {
    this.triangleBudget = n;
    if (!n) {
      this._budgetScale = 1.0;
      this._recalcLodThresholds();
    }
  }

  /**
   * Feed the renderer's triangle count (called from Engine after render).
   * Adjusts the budget scale at most twice per second.
   */
  notifyTriangles(triangles) {
    this._lastTriangles = triangles;
    if (!this.triangleBudget) return;
    const now = performance.now();
    if (now - this._budgetCheckAt < 500) return;
    this._budgetCheckAt = now;

    if (triangles > this.triangleBudget && this._budgetScale > 0.35) {
      this._budgetScale = Math.max(0.35, this._budgetScale * 0.9);
      this._recalcLodThresholds();
    } else if (triangles < this.triangleBudget * 0.7 && this._budgetScale < 1.0) {
      this._budgetScale = Math.min(1.0, this._budgetScale * 1.05);
      this._recalcLodThresholds();
    }
  }

  /**
   * Set water render distance as a fraction (0.25–1) of terrain distance.
   * Only affects the water plane — terrain is untouched.
   */
  setWaterDistanceFactor(f) {
    const clamped = Math.min(1, Math.max(0.25, f));
    if (clamped === this._waterDistanceFactor) return;
    this._waterDistanceFactor = clamped;
    this._updateWaterSize();
  }

  /**
   * Called each frame from Engine._tick(). Determines which chunks should
   * exist, creates missing ones (throttled), removes distant ones, updates
   * LOD, and culls invisible chunks.
   */
  update(playerPos, camera) {
    const cs = this.chunkSize;
    const pcx = Math.floor(playerPos.x / cs);
    const pcz = Math.floor(playerPos.z / cs);

    // Move water plane to follow player (keeps precision reasonable)
    this.waterPlane.position.x = pcx * cs;
    this.waterPlane.position.z = pcz * cs;

    // If player crossed a chunk boundary, recalculate desired set
    if (pcx !== this._lastPlayerCX || pcz !== this._lastPlayerCZ) {
      this._lastPlayerCX = pcx;
      this._lastPlayerCZ = pcz;
      this._recalcChunkSet(pcx, pcz);
    }

    // Create pending chunks (throttled)
    this._createPending();

    // Process at most one gradual LOD geometry rebuild per frame
    this._processLodRebuild();

    // Select logical LODs, then cull and compact only visible records into the
    // four persistent GPU batches.
    this._updateLOD(playerPos);
    if (camera) this._cull(camera);
    if (this._batchesDirty) {
      const batchCounts = this.batches.commit(this.chunks.values(), this.chunkSize);
      this.terrainDrawCallCount = batchCounts.reduce(
        (total, count) => total + (count > 0 ? 1 : 0),
        0
      );
      this._batchesDirty = false;
    }
  }

  /** Frustum + behind-camera cull for active chunks and folded node meshes. */
  _cull(camera) {
    if (!this.cullingEnabled) {
      let visibleCount = 0;
      for (const chunk of this.chunks.values()) {
        if (chunk.visible === false) {
          chunk.visible = true;
          this._batchesDirty = true;
        }
        visibleCount++;
      }
      this.visibleChunkCount = visibleCount;
      this.culledChunkCount = 0;
      return;
    }

    camera.updateMatrixWorld(true);
    createCullingContext(
      camera,
      this.chunkSize,
      this.behindCameraCulling,
      this.cullingAggressiveness,
      this._cullingContext,
      -this.skirtDepth
    );
    const chunkResult = cullChunks(
      this.chunks, camera, this.chunkSize,
      this.maxHeight, this.behindCameraCulling, this.cullingAggressiveness,
      this._cullingContext
    );
    if (chunkResult.changedCount) this._batchesDirty = true;
    this.visibleChunkCount = chunkResult.visibleCount;
    this.culledChunkCount = chunkResult.culledCount;
  }

  /**
   * Recalculate which chunks should exist around the player chunk.
   * Queue missing chunks for creation, remove ones outside radius.
   */
  _recalcChunkSet(pcx, pcz) {
    const r = this.viewRadius;
    const unloadR2 = (r + 2) * (r + 2);  // hysteresis buffer

    const pending = [];
    for (const { dx, dz, dist2 } of getRadialOffsets(r)) {
      const cx = pcx + dx;
      const cz = pcz + dz;
      const key = `${cx},${cz}`;
      if (!this.chunks.has(key)) pending.push({ cx, cz, dist2 });
    }
    this.streamScheduler.reset(pending);
    this.pendingChunkCount = pending.length;

    // Remove chunks outside unload radius
    let removed = 0;
    for (const [key, chunk] of this.chunks) {
      const dx = chunk.cx - pcx;
      const dz = chunk.cz - pcz;
      if (dx * dx + dz * dz > unloadR2) {
        this.chunks.delete(key);
        removed++;
      }
    }
    this.removedChunkCount = removed;
    if (removed) this._batchesDirty = true;
  }

  /**
   * Create a batch of pending chunks (up to maxCreatesPerFrame).
   */
  _createPending() {
    const result = this.streamScheduler.process(({ cx, cz }) => {
      const key = `${cx},${cz}`;
      if (this.chunks.has(key)) return false;
      this.chunks.set(key, {
        cx, cz,
        centerX: cx * this.chunkSize + this.chunkSize / 2,
        centerZ: cz * this.chunkSize + this.chunkSize / 2,
        lod: 3,
        visible: true,
      });
      return true;
    }, {
      budgetMs: this.chunkStreamBudgetMs,
      maxItems: this.maxCreatesPerFrame,
    });
    this.createdChunkCount = result.created;
    this.pendingChunkCount = result.pendingCount;
    this.streamTimeMs = result.elapsedMs;
    if (result.created) this._batchesDirty = true;
  }

  /**
   * Update LOD level per chunk based on distance from player.
   */
  _updateLOD(playerPos) {
    const [t0, t1, t2] = this._lodThresholds2;
    const counts = [0, 0, 0, 0];

    for (const chunk of this.chunks.values()) {
      const dx = chunk.centerX - playerPos.x;
      const dy = -playerPos.y;
      const dz = chunk.centerZ - playerPos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const lod = d2 < t0 ? 0 : d2 < t1 ? 1 : d2 < t2 ? 2 : 3;
      if (lod !== chunk.lod) {
        chunk.lod = lod;
        this._batchesDirty = true;
      }
      counts[lod]++;
    }

    this.lodCounts = counts;
    this.activeChunkCount = this.chunks.size;
  }

  /**
   * Update settings that can change while infinite mode is active.
   */
  updateSettings({ maxHeight, skirtDepth, seaLevel }) {
    if (maxHeight !== undefined) this.maxHeight = maxHeight;
    if (skirtDepth !== undefined) this.skirtDepth = skirtDepth;
    if (seaLevel !== undefined) {
      this.seaLevel = seaLevel;
      this.waterPlane.position.y = seaLevel;
      this.waterPlane.visible = seaLevel > 0.5;
    }

    // Update geometry bounds
    for (const geo of this.geometries) {
      setChunkBounds(geo, this.chunkSize, this.maxHeight, this.skirtDepth);
    }
  }

  /**
   * Show/hide the entire infinite world.
   */
  setVisible(visible) {
    this.group.visible = visible;
    this.batches.setVisible(visible);
    this.waterPlane.visible = visible && this.seaLevel > 0.5;
  }

  /**
   * Dispose all chunks and remove from scene.
   */
  dispose() {
    this.merge.dispose();
    this.batches.dispose();
    this.chunks.clear();
    this.streamScheduler.clear();
    this._lodRebuildQueue = [];

    for (const geo of this.geometries) {
      geo.dispose();
    }
    this.geometries = [];

    this.scene.remove(this.group);
    this.scene.remove(this.waterPlane);
    this.waterPlane.geometry.dispose();
  }
}
