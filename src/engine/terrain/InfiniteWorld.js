import * as THREE from 'three';
import { buildChunkGeometry, setChunkBounds } from './ChunkGeometry.js';

// ============================================================================
// InfiniteWorld: streams terrain chunks around the player camera.
// Chunks are placed on an integer grid (cx, cz). Each chunk is a THREE.Mesh
// using the shared infinite-mode terrain material and one of 4 shared LOD
// geometries. Chunks outside the view radius are disposed.
// ============================================================================

const LOD_RESOLUTIONS = [64, 32, 16, 8];
const MAX_CREATES_PER_FRAME = 6;         // throttle chunk creation

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

    // group contains all terrain chunks
    this.group = new THREE.Group();
    this.group.name = 'infinite-world';
    this.scene.add(this.group);

    // water plane — large, follows player
    this.waterPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      this.waterMaterial
    );
    this.waterPlane.geometry.rotateX(-Math.PI / 2);
    this.waterPlane.renderOrder = 10;
    this.waterPlane.frustumCulled = false;
    this.waterPlane.position.y = this.seaLevel;
    const waterSize = this.chunkSize * (this.viewRadius * 2 + 4);
    this.waterPlane.scale.set(waterSize, 1, waterSize);
    this.scene.add(this.waterPlane);

    // shared geometries per LOD
    this.geometries = LOD_RESOLUTIONS.map((res, lodIndex) => {
      const geo = buildChunkGeometry(res, lodIndex);
      setChunkBounds(geo, this.chunkSize, this.maxHeight, this.skirtDepth);
      return geo;
    });

    // LOD distance thresholds (scale with chunk size)
    this.lodThresholds = [
      this.chunkSize * 4,
      this.chunkSize * 8,
      this.chunkSize * 14,
    ];

    // chunk map: "cx,cz" -> { mesh, cx, cz, lod }
    this.chunks = new Map();

    // player chunk tracking
    this._lastPlayerCX = Infinity;
    this._lastPlayerCZ = Infinity;

    // chunk loading queue
    this._pendingChunks = [];

    // stats
    this.activeChunkCount = 0;
    this.lodCounts = [0, 0, 0, 0];

    this._tmp = new THREE.Vector3();
  }

  /**
   * Called each frame from Engine._tick(). Determines which chunks should
   * exist, creates missing ones (throttled), removes distant ones, and
   * updates LOD for all active chunks.
   */
  update(playerPos) {
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

    // Update LOD for all active chunks
    this._updateLOD(playerPos);
  }

  /**
   * Recalculate which chunks should exist around the player chunk.
   * Queue missing chunks for creation, remove ones outside radius.
   */
  _recalcChunkSet(pcx, pcz) {
    const r = this.viewRadius;
    const r2 = r * r;
    const unloadR2 = (r + 2) * (r + 2);  // hysteresis buffer

    // Build set of desired chunk keys
    const desired = new Set();
    this._pendingChunks = [];

    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r2) continue;  // circular radius
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = `${cx},${cz}`;
        desired.add(key);
        if (!this.chunks.has(key)) {
          // Priority: closer chunks first
          this._pendingChunks.push({ cx, cz, dist2: dx * dx + dz * dz });
        }
      }
    }

    // Sort pending by distance (closest first)
    this._pendingChunks.sort((a, b) => a.dist2 - b.dist2);

    // Remove chunks outside unload radius
    for (const [key, chunk] of this.chunks) {
      const dx = chunk.cx - pcx;
      const dz = chunk.cz - pcz;
      if (dx * dx + dz * dz > unloadR2) {
        this.group.remove(chunk.mesh);
        this.chunks.delete(key);
      }
    }
  }

  /**
   * Create a batch of pending chunks (up to MAX_CREATES_PER_FRAME).
   */
  _createPending() {
    let created = 0;
    while (this._pendingChunks.length > 0 && created < MAX_CREATES_PER_FRAME) {
      const { cx, cz } = this._pendingChunks.shift();
      const key = `${cx},${cz}`;
      if (this.chunks.has(key)) continue;  // already exists (edge case)

      const mesh = new THREE.Mesh(this.geometries[3], this.terrainMaterial);
      mesh.position.set(cx * this.chunkSize, 0, cz * this.chunkSize);
      mesh.scale.setScalar(this.chunkSize);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.updateMatrixWorld(true);

      this.group.add(mesh);
      this.chunks.set(key, {
        mesh,
        cx, cz,
        center: new THREE.Vector3(
          cx * this.chunkSize + this.chunkSize / 2,
          0,
          cz * this.chunkSize + this.chunkSize / 2
        ),
        lod: 3,
      });
      created++;
    }
  }

  /**
   * Update LOD level per chunk based on distance from player.
   */
  _updateLOD(playerPos) {
    const [t0, t1, t2] = this.lodThresholds;
    const counts = [0, 0, 0, 0];

    for (const chunk of this.chunks.values()) {
      const d = this._tmp.copy(chunk.center).sub(playerPos).length();
      const lod = d < t0 ? 0 : d < t1 ? 1 : d < t2 ? 2 : 3;
      if (lod !== chunk.lod) {
        chunk.lod = lod;
        chunk.mesh.geometry = this.geometries[lod];
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
    this.waterPlane.visible = visible && this.seaLevel > 0.5;
  }

  /**
   * Dispose all chunks and remove from scene.
   */
  dispose() {
    for (const chunk of this.chunks.values()) {
      this.group.remove(chunk.mesh);
    }
    this.chunks.clear();
    this._pendingChunks = [];

    for (const geo of this.geometries) {
      geo.dispose();
    }
    this.geometries = [];

    this.scene.remove(this.group);
    this.scene.remove(this.waterPlane);
    this.waterPlane.geometry.dispose();
  }
}
