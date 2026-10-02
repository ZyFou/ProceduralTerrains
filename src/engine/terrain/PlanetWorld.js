import * as THREE from 'three';
import { buildChunkGeometry, setChunkBounds } from './ChunkGeometry.js';
import { stepTemporalLod } from './LodMorph.js';

// ============================================================================
// PlanetWorld: a cube-sphere terrain. Six cube faces, each subdivided into a
// faceGrid×faceGrid grid of chunks. Every chunk reuses one of the shared
// unit-grid LOD geometries (with radial skirts) from ChunkGeometry.js.
//
// Visible leaf chunks are packed into four instanced LOD batches. Per-instance
// cube-face origin/U/V attributes replace hundreds of mesh/material objects;
// all four batches share the same shader program. Folded quadtree patches keep
// their rare standalone meshes because they use variable topology.
//
// The chunk count is bounded (6 * faceGrid²) so they are all created once —
// no streaming. LOD is chosen per frame by distance to the camera; chunks are
// culled by the sphere horizon and the view frustum.
// ============================================================================

// Six cube faces: origin corner + two edge vectors spanning [-1,1]². For each
// face U×V points outward, so front-facing winding is correct with FrontSide.
const FACES = [
  { o: [ 1, -1, -1], u: [0, 2, 0], v: [0, 0, 2] }, // +X
  { o: [-1, -1,  1], u: [0, 2, 0], v: [0, 0, -2] }, // -X
  { o: [-1,  1, -1], u: [0, 0, 2], v: [2, 0, 0] }, // +Y
  { o: [-1, -1,  1], u: [0, 0, -2], v: [2, 0, 0] }, // -Y
  { o: [-1, -1,  1], u: [2, 0, 0], v: [0, 2, 0] }, // +Z
  { o: [ 1, -1, -1], u: [-2, 0, 0], v: [0, 2, 0] }, // -Z
];

const DEFAULT_LOD_DISTANCES = [1.4, 2.6, 4.2]; // × chunk world span

export class PlanetWorld {
  /**
   * @param {THREE.Scene} scene
   * @param {() => THREE.ShaderMaterial} makeMaterial  — per-chunk material factory
   * @param {Object} opts
   * @param {number} opts.radius       — planet base radius (world units)
   * @param {number} opts.maxHeight    — terrain ceiling for bounds
   * @param {number} opts.skirtDepth   — radial skirt depth
   * @param {number} [opts.faceGrid]   — chunks per face side (default 8)
   * @param {number[]} [opts.lodSegments]  — per-LOD quads per chunk side
   * @param {number[]} [opts.lodDistances] — LOD thresholds (× chunk span)
   */
  constructor(scene, makeMaterial, opts) {
    this.scene = scene;
    this.makeMaterial = makeMaterial;

    this.radius = opts.radius;
    this.maxHeight = opts.maxHeight;
    this.skirtDepth = opts.skirtDepth;
    this.faceGrid = opts.faceGrid || 8;
    this.lodSegments = opts.lodSegments ? [...opts.lodSegments] : [64, 32, 16, 8];
    this.wireframe = false;

    this.cullingEnabled = true;
    this.horizonCulling = true;
    this.cullingAggressiveness = 1.0;

    // --- Merge layer (per-face quadtree) ------------------------------------
    // Each cube face is a faceGrid² grid of cells = the leaves of a quadtree.
    // A full square block folds into ONE curved patch mesh (a unit grid mapped
    // across the block's face rectangle via uFaceOrigin/U/V — same shader path
    // as a chunk, just spanning N cells). Folding is 2×2 at a time so the cut
    // is smooth: fine patches near the camera, larger ones toward the limb.
    this.mergeEnabled = true;
    this.mergeQuadsPerChunk = 8;
    this.mergeDistance = 4;
    this.allowRootMerge = true;
    this._faceTrees = [];
    this._mergedPatches = [];       // patch nodes folded this frame
    this._mergeGeo = new Map();     // "res:aLod" -> shared BufferGeometry
    // Folded patches draw as instanced batches (one InstancedMesh per patch
    // grid size) sharing ONE material, through the same instanced program as
    // the chunk batches. A material per patch (269 uniforms, 24 arrays) made
    // three.js re-upload every uniform for each of ~70 patch draws (~1 ms CPU
    // per frame in orbit) and kept a second, non-instanced program alive.
    this._patchBatches = new Map(); // "res:aLod" -> instanced batch
    this._patchMaterial = null;
    this._patchUploadKey = '';
    this._patchSerial = 0;
    this._instancesDirty = true;
    this._mergeDebug = false;
    this.mergedGroupCount = 0;
    this.savedDrawCalls = 0;

    // chunk world span ≈ arc length of one cell at the equator
    this.chunkSpan = (this.radius * 2) / this.faceGrid;

    this._baseLodThresholds = opts.lodDistances
      ? [...opts.lodDistances]
      : [...DEFAULT_LOD_DISTANCES];
    this.lodThresholds = this._baseLodThresholds.map(m => m * this.chunkSpan);

    // gradual LOD geometry rebuild queue (one level per frame)
    this._lodRebuildQueue = [];
    this._targetSegments = null;

    // triangle budget (scales LOD thresholds down under pressure)
    this.triangleBudget = 0;
    this._budgetScale = 1.0;
    this._budgetCheckAt = 0;

    this.group = new THREE.Group();
    this.group.name = 'planet-world';
    this.scene.add(this.group);

    // shared per-LOD geometries (unit grid + skirt ring)
    this.geometries = this.lodSegments.map((res, lod) => {
      const geo = buildChunkGeometry(res, lod, { morph: true });
      setChunkBounds(geo, 1, this.maxHeight, this.skirtDepth);
      return geo;
    });

    this.chunks = [];
    this.materials = [];
    this._buildChunks();
    this._buildInstancedBatches();

    // stats (mirror InfiniteWorld so the HUD keeps working)
    this.activeChunkCount = this.chunks.length;
    this.visibleChunkCount = this.chunks.length;
    this.culledChunkCount = 0;
    this.lodCounts = [0, 0, 0, 0];

    this._frustum = new THREE.Frustum();
    this._projView = new THREE.Matrix4();
    this._tmp = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
  }

  _buildChunks() {
    const g = this.faceGrid;
    this._faceTrees = [];
    for (const face of FACES) {
      const o = new THREE.Vector3(...face.o);
      const U = new THREE.Vector3(...face.u);
      const V = new THREE.Vector3(...face.v);
      const cu = U.clone().multiplyScalar(1 / g);  // per-chunk edge vectors
      const cv = V.clone().multiplyScalar(1 / g);
      const cells = Array.from({ length: g }, () => new Array(g).fill(null));
      for (let j = 0; j < g; j++) {
        for (let i = 0; i < g; i++) {
          const origin = o.clone()
            .addScaledVector(U, i / g)
            .addScaledVector(V, j / g);
          const centerDir = origin.clone()
            .addScaledVector(cu, 0.5)
            .addScaledVector(cv, 0.5)
            .normalize();

          const worldCenter = centerDir.clone().multiplyScalar(this.radius + this.maxHeight * 0.5);
          const boundRadius = this._patchBoundRadius(origin, cu, cv, worldCenter);

          const chunk = {
            origin, faceU: cu.clone(), faceV: cv.clone(), centerDir, worldCenter,
            boundRadius, lod: 3, merged: false, visible: true,
            morph: 0, fresh: true, forceLod3: false,
          };
          this.chunks.push(chunk);
          cells[j][i] = chunk;
        }
      }
      // quadtree over this face's cell grid (leaves are the chunks above)
      let size = 1;
      while (size < g) size *= 2;
      const root = this._buildFaceNode(o, U, V, cells, 0, 0, size, 0);
      if (root) this._faceTrees.push(root);
    }
  }

  _buildInstancedBatches() {
    const capacity = Math.max(1, this.chunks.length);
    this.batches = this.geometries.map((geometry, lod) => {
      const instancedGeometry = geometry.clone();
      const origins = new Float32Array(capacity * 3);
      const faceUs = new Float32Array(capacity * 3);
      const faceVs = new Float32Array(capacity * 3);
      instancedGeometry.setAttribute('aFaceOrigin', new THREE.InstancedBufferAttribute(origins, 3));
      instancedGeometry.setAttribute('aFaceU', new THREE.InstancedBufferAttribute(faceUs, 3));
      instancedGeometry.setAttribute('aFaceV', new THREE.InstancedBufferAttribute(faceVs, 3));
      const morphs = new Float32Array(capacity);
      instancedGeometry.setAttribute('aMorphK', new THREE.InstancedBufferAttribute(morphs, 1));
      const material = this.makeMaterial();
      material.wireframe = this.wireframe;
      this.materials.push(material);
      const mesh = new THREE.InstancedMesh(instancedGeometry, material, capacity);
      mesh.name = `planet-lod-${lod}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.group.add(mesh);
      return { mesh, geometry: instancedGeometry, material, origins, faceUs, faceVs, morphs };
    });
    this._uploadInstancedBatches();
  }

  _uploadInstancedBatches() {
    if (!this.batches) return;
    this._instancesDirty = false;
    const counts = new Uint32Array(this.batches.length);
    for (const chunk of this.chunks) {
      if (chunk.merged || !chunk.visible) continue;
      const batch = this.batches[chunk.lod];
      const index = counts[chunk.lod]++;
      chunk.origin.toArray(batch.origins, index * 3);
      chunk.faceU.toArray(batch.faceUs, index * 3);
      chunk.faceV.toArray(batch.faceVs, index * 3);
      batch.morphs[index] = chunk.morph;
    }
    for (let lod = 0; lod < this.batches.length; lod++) {
      const batch = this.batches[lod];
      batch.mesh.count = counts[lod];
      batch.mesh.visible = counts[lod] > 0;
      for (const name of ['aFaceOrigin', 'aFaceU', 'aFaceV', 'aMorphK']) {
        const attribute = batch.geometry.getAttribute(name);
        attribute.needsUpdate = true;
        attribute.clearUpdateRanges?.();
        attribute.addUpdateRange?.(0, counts[lod] * attribute.itemSize);
      }
    }
  }

  // Conservative world-space bounding-sphere radius for a face rectangle
  // spanning [origin, origin+u, origin+v] projected to the displaced sphere.
  _patchBoundRadius(origin, u, v, worldCenter) {
    let br = 0;
    const cornerR = this.radius + this.maxHeight;
    for (let cy = 0; cy <= 1; cy++) {
      for (let cx = 0; cx <= 1; cx++) {
        const cw = origin.clone()
          .addScaledVector(u, cx)
          .addScaledVector(v, cy)
          .normalize()
          .multiplyScalar(cornerR);
        br = Math.max(br, cw.distanceTo(worldCenter));
      }
    }
    return br * 1.05;
  }

  // Build a quadtree node over face cells [x0,x0+size)×[z0,z0+size). Leaves wrap
  // the existing chunk; internal nodes own a lazily-built curved patch mesh.
  _buildFaceNode(O, U, V, cells, x0, z0, size, level) {
    const g = this.faceGrid;
    if (size === 1) {
      const chunk = (z0 < g && x0 < g) ? cells[z0][x0] : null;
      if (!chunk) return null;
      chunk.merged = false;
      return {
        leaf: true, chunk, children: null, chunks: [chunk], level, full: true,
        centerDir: chunk.centerDir, worldCenter: chunk.worldCenter,
        boundRadius: chunk.boundRadius, spanWorld: this.chunkSpan,
        mesh: null, material: null, merged: false,
      };
    }
    const half = size / 2;
    const offs = [[x0, z0], [x0 + half, z0], [x0, z0 + half], [x0 + half, z0 + half]];
    const children = [];
    const chunks = [];
    for (const [ox, oz] of offs) {
      const child = this._buildFaceNode(O, U, V, cells, ox, oz, half, level + 1);
      if (child) { children.push(child); for (const c of child.chunks) chunks.push(c); }
    }
    if (!children.length) return null;
    const full = (x0 + size <= g) && (z0 + size <= g);
    if (!full && children.length === 1) return children[0];

    const g_ = g;
    const faceOrigin = O.clone().addScaledVector(U, x0 / g_).addScaledVector(V, z0 / g_);
    const faceU = U.clone().multiplyScalar(size / g_);
    const faceV = V.clone().multiplyScalar(size / g_);
    const centerDir = faceOrigin.clone().addScaledVector(faceU, 0.5).addScaledVector(faceV, 0.5).normalize();
    const worldCenter = centerDir.clone().multiplyScalar(this.radius + this.maxHeight * 0.5);
    return {
      leaf: false, chunk: null, children, chunks, level, full, n: size,
      faceOrigin, faceU, faceV, centerDir, worldCenter,
      boundRadius: this._patchBoundRadius(faceOrigin, faceU, faceV, worldCenter),
      spanWorld: size * this.chunkSpan, merged: false, visible: false,
      patchKey: null, patchRes: 0, patchLod: 0, serial: null,
    };
  }

  setWireframe(on) {
    this.wireframe = on;
    for (const m of this.materials) m.wireframe = on;
  }

  /** Swap the compile-time octave count on every chunk material (the program
   *  is shared and already cached, so this is instant once warmed). */
  setOctaves(oct) {
    for (const m of this.materials) {
      if (m.defines.OCTAVES !== oct) {
        m.defines.OCTAVES = oct;
        m.needsUpdate = true;
      }
    }
  }

  setLodDistances(distances) {
    this._baseLodThresholds = [...distances];
    this._recalcLodThresholds();
  }

  _recalcLodThresholds() {
    this.lodThresholds = this._baseLodThresholds.map(
      m => m * this.chunkSpan * this._budgetScale
    );
  }

  // --- temporal geomorph -----------------------------------------------------
  // LOD decisions are unchanged; each change is animated instead of popping.
  // chunk.lod is the rendered grid, chunk.morph (0..1) how far its odd vertices
  // have slid onto the next-coarser grid (uploaded as the aMorphK attribute).
  setMorphEnabled(enabled) {
    this.morphEnabled = !!enabled;
  }

  _stepChunkLod(chunk, target, step) {
    stepTemporalLod(chunk, target, step, this.lodSegments, this.morphEnabled !== false);
  }

  _publishMorph() {
    const u = this.materials[0]?.uniforms?.uLodGridSegments;
    if (u) u.value.set(this.lodSegments[0], this.lodSegments[1], this.lodSegments[2], this.lodSegments[3]);
  }

  /** Change per-LOD segment counts — rebuilt gradually (one level/frame). */
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
    const lod = this._lodRebuildQueue.shift();
    const res = this._targetSegments[lod];
    if (res === this.lodSegments[lod]) return;

    const geo = buildChunkGeometry(res, lod, { morph: true });
    setChunkBounds(geo, 1, this.maxHeight, this.skirtDepth);
    const old = this.geometries[lod];
    this.geometries[lod] = geo;
    this.lodSegments[lod] = res;
    if (this.batches?.[lod]) {
      const batch = this.batches[lod];
      const instancedGeometry = geo.clone();
      instancedGeometry.setAttribute('aFaceOrigin', new THREE.InstancedBufferAttribute(batch.origins, 3));
      instancedGeometry.setAttribute('aFaceU', new THREE.InstancedBufferAttribute(batch.faceUs, 3));
      instancedGeometry.setAttribute('aFaceV', new THREE.InstancedBufferAttribute(batch.faceVs, 3));
      instancedGeometry.setAttribute('aMorphK', new THREE.InstancedBufferAttribute(batch.morphs, 1));
      batch.geometry.dispose();
      batch.geometry = instancedGeometry;
      batch.mesh.geometry = instancedGeometry;
      this._instancesDirty = true;
    }
    old.dispose();
  }

  setTriangleBudget(n) {
    this.triangleBudget = n;
    if (!n) { this._budgetScale = 1.0; this._recalcLodThresholds(); }
  }

  notifyTriangles(triangles) {
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

  /** Tune the merge layer (performance settings). */
  setMergeOptions({ enabled, quadsPerChunk, mergeDistance, macroEnabled } = {}) {
    if (enabled !== undefined) {
      this.mergeEnabled = !!enabled;
      if (!this.mergeEnabled) this._restoreMerge();
    }
    if (macroEnabled !== undefined) this.allowRootMerge = !!macroEnabled;
    if (mergeDistance !== undefined && Number.isFinite(+mergeDistance)) {
      this.mergeDistance = Math.max(0.5, +mergeDistance);
    }
    if (quadsPerChunk !== undefined) {
      const v = Math.max(2, Math.round(quadsPerChunk));
      if (v !== this.mergeQuadsPerChunk) { this.mergeQuadsPerChunk = v; this._disposePatchMeshes(); }
    }
  }

  /** Toggle the merge-debug surface tint (drives the shared uMergeDebug). */
  setMergeDebug(on) {
    this._mergeDebug = !!on;
    // shared uniform object → every chunk/patch material sees it at once
    const u = this.materials[0]?.uniforms?.uMergeDebug;
    if (u) u.value = this._mergeDebug ? 1.0 : 0.0;
  }

  update(cameraPos, camera, debug = {}) {
    this._processLodRebuild();
    this._publishMorph();
    const nowMs = performance.now();
    const dt = this._lastUpdateAt == null ? 0 : Math.min(0.1, Math.max(0, (nowMs - this._lastUpdateAt) / 1000));
    this._lastUpdateAt = nowMs;
    const morphStep = dt / Math.max(0.05, this.morphDuration ?? 0.4);
    for (const c of this.chunks) c.forceLod3 = false;

    const [t0, t1, t2] = this.lodThresholds;
    const counts = [0, 0, 0, 0];
    const freezeCulling = !!debug.freezeCulling;
    const freezeLod = !!debug.freezeLod;

    // camera direction from planet center + altitude drive the horizon test.
    const camLen = this._camDir.copy(cameraPos).length();
    this._camDir.multiplyScalar(camLen > 1e-3 ? 1 / camLen : 0);
    const base = this.radius / Math.max(camLen, 1);
    const margin = 0.08 + (1 - this.cullingAggressiveness) * 0.10;
    const horizonCos = base - margin;

    if (!freezeCulling && camera) {
      this._projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this._frustum.setFromProjectionMatrix(this._projView);
    }

    // 1. Fold pass: decide which face blocks collapse into patches (distance
    // only). Skipped while LOD is frozen so the fold layout holds.
    if (this.mergeEnabled && !freezeLod) {
      this._mergedPatches.length = 0;
      this._hiddenByMerge = 0;
      for (const root of this._faceTrees) this._foldPass(root, cameraPos);
      this.mergedGroupCount = this._mergedPatches.length;
      this.savedDrawCalls = Math.max(0, this._hiddenByMerge - this._mergedPatches.length);
    }

    // 2. Per-chunk LOD + cull (folded chunks are hidden, skip them).
    let visible = 0, culled = 0;
    let morphing = 0;
    let dirty = this._instancesDirty;
    for (const c of this.chunks) {
      if (c.merged) {
        if (c.visible) { c.visible = false; dirty = true; }
        continue;
      }
      const d = this._tmp.copy(c.worldCenter).sub(cameraPos).length();
      const lod = c.forceLod3 ? 3 : (d < t0 ? 0 : d < t1 ? 1 : d < t2 ? 2 : 3);
      const prevLod = c.lod;
      const prevMorph = c.morph;
      if (!freezeLod) this._stepChunkLod(c, lod, morphStep);
      if (c.morph > 0 || c.lod !== lod) morphing++;
      counts[c.lod]++;

      let show = c.visible;
      if (!freezeCulling) {
        show = this._isVisible(c.centerDir, c.worldCenter, c.boundRadius, camLen, horizonCos, camera);
      }
      if (show !== c.visible || c.lod !== prevLod || c.morph !== prevMorph) dirty = true;
      c.visible = show;
      if (show) visible++; else culled++;
    }
    // instance data only changes with visibility / LOD / morph
    if (dirty) this._uploadInstancedBatches();

    // 3. Cull the folded patches (LOD is fixed for a patch).
    for (const p of this._mergedPatches) {
      let show = p.visible;
      if (!freezeCulling) {
        show = this._isVisible(p.centerDir, p.worldCenter, p.boundRadius, camLen, horizonCos, camera);
      }
      p.visible = show;
      if (show) visible++; else culled++;
    }
    this._uploadPatchBatches();

    this.lodCounts = counts;
    this.activeChunkCount = this.chunks.length;
    this.visibleChunkCount = visible;
    this.culledChunkCount = culled;
    this.morphingChunkCount = morphing;
  }

  // Horizon (back-of-planet) + frustum visibility test for one patch/chunk.
  _isVisible(centerDir, worldCenter, boundRadius, camLen, horizonCos, camera) {
    if (!this.cullingEnabled) return true;
    if (this.horizonCulling && camLen > this.radius && this._camDir.dot(centerDir) < horizonCos) {
      return false;
    }
    if (camera && !this._frustum.intersectsSphere(_sphere.set(worldCenter, boundRadius))) {
      return false;
    }
    return true;
  }

  // --- merge traversal -----------------------------------------------------
  _foldPass(node, camPos) {
    if (node.leaf) {
      if (node.chunk.merged) { node.chunk.merged = false; this._instancesDirty = true; }
      return;
    }
    const canFold = node.full && (this.allowRootMerge || node.level > 0);
    if (canFold) {
      const nearest = this._tmp.copy(node.worldCenter).sub(camPos).length() - node.boundRadius;
      const foldDist = node.spanWorld * this.mergeDistance * this._budgetScale;
      const want = node.merged ? nearest > foldDist * 0.85 : nearest > foldDist;
      // Temporal geomorph: a patch only folds once every chunk under it has
      // morphed down to the LOD3 grid (= patch density); until then they are
      // steered there, so the fold itself changes nothing on screen.
      const ready = node.merged || this.morphEnabled === false
        || node.chunks.every((c) => c.lod === 3 && c.morph === 0);
      if (want && !ready) {
        for (const c of node.chunks) c.forceLod3 = true;
      }
      if (want && ready) {
        if (!node.merged) this._foldPatch(node);
        this._mergedPatches.push(node);
        this._hiddenByMerge += node.chunks.length;
        return;
      }
    }
    if (node.merged) this._unfoldPatch(node);
    for (const child of node.children) this._foldPass(child, camPos);
  }

  _foldPatch(node) {
    node.merged = true;
    if (!node.patchKey) {
      const tier = Math.max(1, Math.round(Math.log2(node.n)));
      node.patchRes = Math.min(160, Math.max(8, node.n * this.mergeQuadsPerChunk));
      node.patchLod = 3 + Math.min(5, tier);
      node.patchKey = `${node.patchRes}:${node.patchLod}`;
    }
    node.visible = true;
    this._instancesDirty = true;   // its chunks leave the chunk batches
    for (const c of node.chunks) { c.merged = true; c.visible = false; }
    this._forEachDescendantInternal(node, (d) => {
      d.merged = false;
      d.visible = false;
    });
  }

  _unfoldPatch(node) {
    node.merged = false;
    node.visible = false;
    this._instancesDirty = true;
  }

  _ensurePatchMaterial() {
    if (this._patchMaterial) return this._patchMaterial;
    const mat = this.makeMaterial();
    mat.wireframe = this.wireframe;
    // match the live octave count (makeMaterial captured the count at planet
    // creation; setOctaves only updates materials that already exist)
    const liveOct = this.materials[0]?.defines?.OCTAVES;
    if (liveOct !== undefined && mat.defines.OCTAVES !== liveOct) {
      mat.defines.OCTAVES = liveOct;
      mat.needsUpdate = true;
    }
    this.materials.push(mat);   // so wireframe / octave / source updates reach it
    this._patchMaterial = mat;
    return mat;
  }

  // Upper bound of simultaneously folded patches sharing one grid size.
  _patchCapacity(key) {
    let n = 0;
    this._forEachInternal((node) => {
      if (!node.full) return;
      const tier = Math.max(1, Math.round(Math.log2(node.n)));
      const res = Math.min(160, Math.max(8, node.n * this.mergeQuadsPerChunk));
      if (`${res}:${3 + Math.min(5, tier)}` === key) n++;
    });
    return Math.max(1, n);
  }

  _ensurePatchBatch(node) {
    let batch = this._patchBatches.get(node.patchKey);
    if (batch) return batch;
    const capacity = this._patchCapacity(node.patchKey);
    const geometry = this._mergeGeometry(node.patchRes, node.patchLod).clone();
    const origins = new Float32Array(capacity * 3);
    const faceUs = new Float32Array(capacity * 3);
    const faceVs = new Float32Array(capacity * 3);
    geometry.setAttribute('aFaceOrigin', new THREE.InstancedBufferAttribute(origins, 3));
    geometry.setAttribute('aFaceU', new THREE.InstancedBufferAttribute(faceUs, 3));
    geometry.setAttribute('aFaceV', new THREE.InstancedBufferAttribute(faceVs, 3));
    // patches never geomorph: explicit zeros instead of whatever generic
    // attribute value the driver holds for the missing slots
    geometry.setAttribute('aMorph', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count), 1));
    geometry.setAttribute('aMorphK', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
    const mesh = new THREE.InstancedMesh(geometry, this._ensurePatchMaterial(), capacity);
    mesh.name = `planet-patch-${node.patchKey}`;
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    batch = { mesh, geometry, origins, faceUs, faceVs, capacity };
    this._patchBatches.set(node.patchKey, batch);
    return batch;
  }

  _uploadPatchBatches() {
    // Re-upload only when the set of visible patches changed.
    let key = '';
    for (const p of this._mergedPatches) {
      if (!p.visible) continue;
      if (p.serial == null) p.serial = ++this._patchSerial;
      key += `${p.serial},`;
    }
    if (key === this._patchUploadKey) return;
    this._patchUploadKey = key;
    const counts = new Map();
    for (const p of this._mergedPatches) {
      if (!p.visible) continue;
      const batch = this._ensurePatchBatch(p);
      const index = counts.get(batch) || 0;
      if (index >= batch.capacity) continue;
      counts.set(batch, index + 1);
      p.faceOrigin.toArray(batch.origins, index * 3);
      p.faceU.toArray(batch.faceUs, index * 3);
      p.faceV.toArray(batch.faceVs, index * 3);
    }
    for (const batch of this._patchBatches.values()) {
      const count = counts.get(batch) || 0;
      batch.mesh.count = count;
      batch.mesh.visible = count > 0;
      for (const name of ['aFaceOrigin', 'aFaceU', 'aFaceV']) {
        const attribute = batch.geometry.getAttribute(name);
        attribute.needsUpdate = true;
        attribute.clearUpdateRanges?.();
        attribute.addUpdateRange?.(0, count * attribute.itemSize);
      }
    }
  }

  _hidePatchBatches() {
    for (const batch of this._patchBatches.values()) {
      batch.mesh.count = 0;
      batch.mesh.visible = false;
    }
    this._patchUploadKey = '';
  }

  _disposePatchBatches() {
    for (const batch of this._patchBatches.values()) {
      this.group.remove(batch.mesh);
      batch.geometry.dispose();
    }
    this._patchBatches.clear();
    this._patchUploadKey = '';
  }

  _mergeGeometry(res, aLod) {
    const key = `${res}:${aLod}`;
    let geo = this._mergeGeo.get(key);
    if (!geo) {
      geo = buildChunkGeometry(res, aLod);
      setChunkBounds(geo, 1, this.maxHeight, this.skirtDepth);
      this._mergeGeo.set(key, geo);
    }
    return geo;
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
    for (const root of this._faceTrees) rec(root);
  }

  _restoreMerge() {
    for (const c of this.chunks) { c.merged = false; }
    this._forEachInternal((n) => { n.merged = false; n.visible = false; });
    this._mergedPatches.length = 0;
    this._hidePatchBatches();
    this._instancesDirty = true;
    this.mergedGroupCount = 0;
    this.savedDrawCalls = 0;
  }

  _disposePatchMeshes() {
    this._disposePatchBatches();
    this._forEachInternal((n) => {
      n.merged = false;
      n.visible = false;
      n.patchKey = null;
    });
    for (const c of this.chunks) c.merged = false;
    this._mergedPatches.length = 0;
    this._instancesDirty = true;
  }

  dispose() {
    this._disposePatchBatches();
    this._patchMaterial = null;
    for (const geo of this._mergeGeo.values()) geo.dispose();
    this._mergeGeo.clear();
    this._faceTrees = [];
    this._mergedPatches.length = 0;
    for (const batch of this.batches || []) {
      this.group.remove(batch.mesh);
      batch.geometry.dispose();
    }
    this.batches = [];
    this.chunks = [];
    for (const m of this.materials) m.dispose();
    this.materials = [];
    for (const geo of this.geometries) geo.dispose();
    this.geometries = [];
    this.scene.remove(this.group);
  }
}

const _sphere = new THREE.Sphere();
