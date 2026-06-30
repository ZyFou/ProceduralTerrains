import * as THREE from 'three';
import { buildChunkGeometry } from './ChunkGeometry.js';

// ============================================================================
// MergeQuadtree: shared chunked-LOD merge layer for the FLAT GPU-displaced
// terrain modes (Tile board + Infinite world). The host's chunks are the
// leaves of a quadtree on their integer grid; each internal node covers a
// power-of-two square block and folds into ONE flat unit-grid mesh (same
// material) once the camera is far enough for its size. Folding happens 2x2 at
// a time, so the visible set is a smooth cut — fine chunks near the camera,
// progressively larger merged blocks outward — never a hard jump.
//
// A node only folds when it is FULL (its whole square is tiled by existing
// chunks); partial nodes (streaming edge / assembly boundary) never fold, so a
// merged mesh can't paint terrain across a gap. Height is GPU-driven, so a
// merged node is just a bigger unit grid — no baking/cache/async. The win is
// fewer draw calls / matrix updates / frustum checks (CPU), not GPU triangles.
//
// The host owns the chunk objects; the tree only reads { mesh, center } and
// writes { merged, mesh.visible, ix, iz, node }. After update() the host culls:
// skip chunks where `merged`, and cull the meshes in `mergedNodes`.
// ============================================================================

export class MergeQuadtree {
  constructor(group, material) {
    this.group = group;
    this.material = material;

    this.enabled = true;
    this.quadsPerChunk = 8;     // merged grid density per chunk span (8 == LOD3)
    this.mergeDistance = 4;     // a node folds when nearest > spanWorld × this
    this.allowRoot = true;      // allow the whole region to fold to one mesh
    this.distanceScale = 1;     // mirrors the host's LOD distance scale
    this.chunkSize = 1;

    this._geo = new Map();      // "res:aLod" -> shared BufferGeometry
    this._root = null;
    this._dirty = true;
    this._gridOriginX = 0;
    this._gridOriginZ = 0;

    this.mergedNodes = [];      // nodes folded this frame (host culls these)
    this.hiddenCount = 0;       // chunks hidden by folds (for stats)
  }

  setChunkSize(cs) {
    if (cs !== this.chunkSize) { this.chunkSize = cs; this._dirty = true; this._disposeNodeMeshes(); }
  }

  setOptions({ enabled, quadsPerChunk, mergeDistance, allowRoot, distanceScale } = {}) {
    if (enabled !== undefined) this.enabled = !!enabled;
    if (allowRoot !== undefined) this.allowRoot = !!allowRoot;
    if (distanceScale !== undefined && Number.isFinite(+distanceScale)) this.distanceScale = +distanceScale;
    if (mergeDistance !== undefined && Number.isFinite(+mergeDistance)) this.mergeDistance = Math.max(0.5, +mergeDistance);
    if (quadsPerChunk !== undefined) {
      const v = Math.max(2, Math.round(quadsPerChunk));
      if (v !== this.quadsPerChunk) { this.quadsPerChunk = v; this._disposeNodeMeshes(); }
    }
  }

  markDirty() { this._dirty = true; }

  // Walk the tree and fold/unfold nodes for the current camera. `chunks` is any
  // iterable of the host's chunk objects ({ mesh, center, merged }).
  update(chunks, camPos) {
    if (!this.enabled) { this._restore(chunks); return; }
    if (this._dirty) this._rebuild(chunks);

    this.mergedNodes.length = 0;
    this.hiddenCount = 0;
    if (this._root) this._visit(this._root, camPos);
  }

  // --- tree build ----------------------------------------------------------
  _rebuild(chunks) {
    this._dirty = false;
    this._disposeNodeMeshes();
    const list = Array.isArray(chunks) ? chunks : [...chunks];
    if (!list.length) { this._root = null; return; }

    const cs = this.chunkSize;
    let minX = Infinity, minZ = Infinity;
    for (const c of list) {
      const x0 = c.center.x - cs / 2, z0 = c.center.z - cs / 2;
      if (x0 < minX) minX = x0;
      if (z0 < minZ) minZ = z0;
    }
    this._gridOriginX = minX;
    this._gridOriginZ = minZ;

    let gw = 0, gh = 0;
    for (const c of list) {
      c.ix = Math.round((c.center.x - cs / 2 - minX) / cs);
      c.iz = Math.round((c.center.z - cs / 2 - minZ) / cs);
      if (c.ix + 1 > gw) gw = c.ix + 1;
      if (c.iz + 1 > gh) gh = c.iz + 1;
      c.node = null;
      c.merged = false;
      c.mesh.visible = true;
    }

    let size = 1;
    while (size < Math.max(gw, gh, 1)) size *= 2;
    this._root = this._buildNode(list, 0, 0, size, 0);
  }

  _buildNode(chunks, x0, z0, size, level) {
    if (!chunks.length) return null;
    if (size === 1) return this._leafNode(chunks[0], x0, z0, level);

    const half = size / 2;
    const midX = x0 + half, midZ = z0 + half;
    const q = [[], [], [], []];
    for (const c of chunks) {
      const qx = c.ix < midX ? 0 : 1;
      const qz = c.iz < midZ ? 0 : 1;
      q[qz * 2 + qx].push(c);
    }
    const offs = [[x0, z0], [midX, z0], [x0, midZ], [midX, midZ]];
    const children = [];
    for (let i = 0; i < 4; i++) {
      if (!q[i].length) continue;
      const child = this._buildNode(q[i], offs[i][0], offs[i][1], half, level + 1);
      if (child) children.push(child);
    }
    const full = chunks.length === size * size;
    if (!full && children.length === 1) return children[0];
    return this._internalNode(children, chunks, x0, z0, size, level, full);
  }

  _leafNode(chunk, x0, z0, level) {
    const cs = this.chunkSize;
    const minX = this._gridOriginX + x0 * cs, minZ = this._gridOriginZ + z0 * cs;
    const node = {
      leaf: true, chunk, children: null, chunks: [chunk], full: true,
      minX, minZ, spanX: cs, spanZ: cs, spanWorld: cs, spanChunks: 1,
      center: new THREE.Vector3(minX + cs / 2, 0, minZ + cs / 2),
      half: cs * 0.7072, level, mesh: null, merged: false,
    };
    chunk.node = node;
    return node;
  }

  _internalNode(children, chunks, x0, z0, size, level, full) {
    const cs = this.chunkSize;
    const minX = this._gridOriginX + x0 * cs, minZ = this._gridOriginZ + z0 * cs;
    const span = size * cs;
    return {
      leaf: false, chunk: null, children, chunks, full,
      minX, minZ, spanX: span, spanZ: span, spanWorld: span, spanChunks: size,
      center: new THREE.Vector3(minX + span / 2, 0, minZ + span / 2),
      half: 0.5 * Math.SQRT2 * span, level, mesh: null, merged: false,
    };
  }

  // --- traversal -----------------------------------------------------------
  _visit(node, camPos) {
    if (node.leaf) {
      if (node.chunk.merged) { node.chunk.merged = false; node.chunk.mesh.visible = true; }
      return;
    }
    const canFold = node.full && (this.allowRoot || node.level > 0);
    if (canFold) {
      const nearest = Math.hypot(node.center.x - camPos.x, camPos.y, node.center.z - camPos.z) - node.half;
      const foldDist = node.spanWorld * this.mergeDistance * this.distanceScale;
      const want = node.merged ? nearest > foldDist * 0.85 : nearest > foldDist;
      if (want) {
        if (!node.merged) this._fold(node);
        this.mergedNodes.push(node);
        this.hiddenCount += node.chunks.length;
        return;
      }
    }
    if (node.merged) this._unfold(node);
    for (const child of node.children) this._visit(child, camPos);
  }

  _fold(node) {
    node.merged = true;
    if (!node.mesh) {
      const tier = Math.max(1, Math.round(Math.log2(node.spanChunks)));
      const res = Math.min(160, Math.max(8, node.spanChunks * this.quadsPerChunk));
      const aLod = 3 + Math.min(5, tier);
      const mesh = new THREE.Mesh(this._geometry(res, aLod), this.material);
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

  _unfold(node) {
    node.merged = false;
    if (node.mesh) node.mesh.visible = false;
  }

  _geometry(res, aLod) {
    const key = `${res}:${aLod}`;
    let geo = this._geo.get(key);
    if (!geo) {
      geo = buildChunkGeometry(res, aLod);
      this._geo.set(key, geo);
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
    rec(this._root);
  }

  _restore(chunks) {
    for (const c of chunks.values ? chunks.values() : chunks) {
      if (c.merged) { c.merged = false; c.mesh.visible = true; }
    }
    this._forEachInternal((n) => { n.merged = false; if (n.mesh) n.mesh.visible = false; });
    this.mergedNodes.length = 0;
    this.hiddenCount = 0;
  }

  _disposeNodeMeshes() {
    this._forEachInternal((n) => {
      if (n.mesh) { this.group.remove(n.mesh); n.mesh = null; }
      n.merged = false;
    });
    this.mergedNodes.length = 0;
  }

  dispose() {
    this._disposeNodeMeshes();
    for (const geo of this._geo.values()) geo.dispose();
    this._geo.clear();
    this._root = null;
    this._dirty = true;
    this.mergedNodes.length = 0;
    this.hiddenCount = 0;
  }
}
