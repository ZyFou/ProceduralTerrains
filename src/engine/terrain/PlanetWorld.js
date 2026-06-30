import * as THREE from 'three';
import { buildChunkGeometry, setChunkBounds } from './ChunkGeometry.js';

// ============================================================================
// PlanetWorld: a cube-sphere terrain. Six cube faces, each subdivided into a
// faceGrid×faceGrid grid of chunks. Every chunk reuses one of the shared
// unit-grid LOD geometries (with radial skirts) from ChunkGeometry.js.
//
// Each chunk owns its OWN planet material instance: the material's terrain /
// palette uniforms are the engine's shared uniform OBJECTS (passed by
// reference, so every style tweak still applies everywhere), but its cube-face
// mapping uniforms (uFaceOrigin / uFaceU / uFaceV) are private and baked once
// at creation. A single shared material can't work here — three.js only
// uploads a material's uniforms once per render, so per-mesh uniform mutation
// (onBeforeRender) would collapse every chunk onto one cube cell. All chunk
// materials share ONE compiled program (identical source + defines), so the
// cost is just a handful of extra uniform uploads.
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
      const geo = buildChunkGeometry(res, lod);
      setChunkBounds(geo, 1, this.maxHeight, this.skirtDepth);
      return geo;
    });

    this.chunks = [];
    this.materials = [];
    this._buildChunks();

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

          // per-chunk material: shares the engine uniform objects, owns its
          // face mapping uniforms (baked once here)
          const mat = this.makeMaterial();
          mat.uniforms.uFaceOrigin.value.copy(origin);
          mat.uniforms.uFaceU.value.copy(cu);
          mat.uniforms.uFaceV.value.copy(cv);
          mat.wireframe = this.wireframe;
          this.materials.push(mat);

          const mesh = new THREE.Mesh(this.geometries[3], mat);
          mesh.frustumCulled = false;          // we cull manually (shader transform)
          mesh.matrixAutoUpdate = false;
          mesh.updateMatrix();

          const worldCenter = centerDir.clone().multiplyScalar(this.radius + this.maxHeight * 0.5);
          const boundRadius = this._patchBoundRadius(origin, cu, cv, worldCenter);

          this.group.add(mesh);
          const chunk = { mesh, centerDir, worldCenter, boundRadius, lod: 3, merged: false };
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
      spanWorld: size * this.chunkSpan, mesh: null, material: null, merged: false,
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

    const geo = buildChunkGeometry(res, lod);
    setChunkBounds(geo, 1, this.maxHeight, this.skirtDepth);
    const old = this.geometries[lod];
    this.geometries[lod] = geo;
    this.lodSegments[lod] = res;
    for (const c of this.chunks) {
      if (c.lod === lod) c.mesh.geometry = geo;
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
    for (const c of this.chunks) {
      if (c.merged) { if (c.mesh.visible) c.mesh.visible = false; continue; }
      const d = this._tmp.copy(c.worldCenter).sub(cameraPos).length();
      const lod = d < t0 ? 0 : d < t1 ? 1 : d < t2 ? 2 : 3;
      if (!freezeLod) {
        if (lod !== c.lod) { c.lod = lod; c.mesh.geometry = this.geometries[lod]; }
      }
      counts[c.lod]++;

      let show = c.mesh.visible;
      if (!freezeCulling) {
        show = this._isVisible(c.centerDir, c.worldCenter, c.boundRadius, camLen, horizonCos, camera);
      }
      c.mesh.visible = show;
      if (show) visible++; else culled++;
    }

    // 3. Cull the folded patch meshes (LOD is fixed for a patch).
    for (const p of this._mergedPatches) {
      let show = p.mesh.visible;
      if (!freezeCulling) {
        show = this._isVisible(p.centerDir, p.worldCenter, p.boundRadius, camLen, horizonCos, camera);
      }
      p.mesh.visible = show;
      if (show) visible++; else culled++;
    }

    this.lodCounts = counts;
    this.activeChunkCount = this.chunks.length;
    this.visibleChunkCount = visible;
    this.culledChunkCount = culled;
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
    if (node.leaf) { if (node.chunk.merged) node.chunk.merged = false; return; }
    const canFold = node.full && (this.allowRootMerge || node.level > 0);
    if (canFold) {
      const nearest = this._tmp.copy(node.worldCenter).sub(camPos).length() - node.boundRadius;
      const foldDist = node.spanWorld * this.mergeDistance * this._budgetScale;
      const want = node.merged ? nearest > foldDist * 0.85 : nearest > foldDist;
      if (want) {
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
    if (!node.mesh) {
      const tier = Math.max(1, Math.round(Math.log2(node.n)));
      const res = Math.min(160, Math.max(8, node.n * this.mergeQuadsPerChunk));
      const aLod = 3 + Math.min(5, tier);
      const mat = this.makeMaterial();
      mat.uniforms.uFaceOrigin.value.copy(node.faceOrigin);
      mat.uniforms.uFaceU.value.copy(node.faceU);
      mat.uniforms.uFaceV.value.copy(node.faceV);
      mat.wireframe = this.wireframe;
      // match the current octave count (makeMaterial captured the count at
      // planet creation; setOctaves only updates materials that already exist)
      const liveOct = this.materials[0]?.defines?.OCTAVES;
      if (liveOct !== undefined && mat.defines.OCTAVES !== liveOct) {
        mat.defines.OCTAVES = liveOct;
        mat.needsUpdate = true;
      }
      this.materials.push(mat);   // so wireframe / octave updates reach it
      node.material = mat;
      const mesh = new THREE.Mesh(this._mergeGeometry(res, aLod), mat);
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
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

  _unfoldPatch(node) {
    node.merged = false;
    if (node.mesh) node.mesh.visible = false;
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
    this._forEachInternal((n) => { n.merged = false; if (n.mesh) n.mesh.visible = false; });
    this._mergedPatches.length = 0;
    this.mergedGroupCount = 0;
    this.savedDrawCalls = 0;
  }

  _disposePatchMeshes() {
    this._forEachInternal((n) => {
      if (n.mesh) { this.group.remove(n.mesh); n.mesh = null; }
      if (n.material) { const i = this.materials.indexOf(n.material); if (i >= 0) this.materials.splice(i, 1); n.material.dispose(); n.material = null; }
      n.merged = false;
    });
    this._mergedPatches.length = 0;
  }

  dispose() {
    for (const geo of this._mergeGeo.values()) geo.dispose();
    this._mergeGeo.clear();
    this._faceTrees = [];
    this._mergedPatches.length = 0;
    for (const c of this.chunks) this.group.remove(c.mesh);
    this.chunks = [];
    for (const m of this.materials) m.dispose();
    this.materials = [];
    for (const geo of this.geometries) geo.dispose();
    this.geometries = [];
    this.scene.remove(this.group);
  }
}

const _sphere = new THREE.Sphere();
