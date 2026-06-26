import * as THREE from 'three';
import { chooseCandidate, fillChance, hashInt } from './PropPlacement.js';
import { grassTint } from './propCatalog.js';
import { createWindUniforms } from './windGLSL.js';
import { makeWindMaterial } from './GrassMaterial.js';

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function makeGrassTuftGeometry({ bladeCount = 14, segments = 4, height = 1, radius = 0.22 } = {}) {
  const positions = [];
  const colors = [];
  const bends = [];
  const indices = [];
  const bottom = new THREE.Color(0x245f2d);
  const mid = new THREE.Color(0x4f9d42);
  const tip = new THREE.Color(0x9fcb5b);

  const pushVertex = (x, y, z, t, shade) => {
    positions.push(x, y, z);
    bends.push(t);   // 0 at the rooted base → 1 at the tip (wind bend weight)
    const col = (t < 0.68 ? bottom.clone().lerp(mid, t / 0.68) : mid.clone().lerp(tip, (t - 0.68) / 0.32));
    col.multiplyScalar(shade);
    colors.push(col.r, col.g, col.b);
  };

  for (let b = 0; b < bladeCount; b++) {
    const bladeSeed = b * 12.9898;
    const angle = (b / bladeCount) * Math.PI * 2 + Math.sin(bladeSeed) * 0.45;
    const baseR = radius * (0.18 + 0.82 * Math.abs(Math.sin(bladeSeed * 1.7)));
    const baseX = Math.cos(angle) * baseR;
    const baseZ = Math.sin(angle) * baseR;
    const h = height * (0.68 + 0.48 * Math.abs(Math.sin(bladeSeed * 2.31)));
    const width = 0.026 + 0.032 * Math.abs(Math.cos(bladeSeed * 0.77));
    const lean = 0.10 + 0.24 * Math.abs(Math.sin(bladeSeed * 0.41));
    const leanAngle = angle + Math.sin(bladeSeed * 3.1) * 0.9;
    const sideX = Math.cos(angle + Math.PI * 0.5);
    const sideZ = Math.sin(angle + Math.PI * 0.5);
    const start = positions.length / 3;
    const shade = 0.78 + 0.28 * Math.abs(Math.sin(bladeSeed * 5.3));

    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const bend = t * t;
      const taper = Math.pow(1 - t, 1.25);
      const curl = Math.sin(t * Math.PI) * 0.035 * Math.sin(bladeSeed);
      const cx = baseX + Math.cos(leanAngle) * lean * bend + Math.cos(angle) * curl;
      const cy = h * t;
      const cz = baseZ + Math.sin(leanAngle) * lean * bend + Math.sin(angle) * curl;
      const w = width * taper;
      pushVertex(cx - sideX * w, cy, cz - sideZ * w, t, shade);
      pushVertex(cx + sideX * w, cy, cz + sideZ * w, t, shade);
    }

    for (let s = 0; s < segments; s++) {
      const a = start + s * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('aBend', new THREE.Float32BufferAttribute(bends, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// A few flower "species" — each builds a proper stem + radial petals + center.
// Geometry base sits at y = 0 so instances anchor cleanly on the terrain.
function makeFlowerKinds() {
  return [
    { // daisy — many slim white petals, yellow disk
      stemHeight: 0.95, stemWidth: 0.022, leafLen: 0.26,
      petalCount: 12, petalLen: 0.30, petalWidth: 0.05, tilt: 0.22,
      petalColor: 0xf3f1e8, centerColor: 0xf2c044, centerRadius: 0.11,
    },
    { // poppy — few broad red petals, dark cup
      stemHeight: 0.82, stemWidth: 0.024, leafLen: 0.22,
      petalCount: 5, petalLen: 0.34, petalWidth: 0.17, tilt: 0.55,
      petalColor: 0xd83a30, centerColor: 0x241f18, centerRadius: 0.09,
    },
    { // cornflower — blue/violet star
      stemHeight: 0.90, stemWidth: 0.020, leafLen: 0.24,
      petalCount: 7, petalLen: 0.30, petalWidth: 0.08, tilt: 0.40,
      petalColor: 0x6a78d8, centerColor: 0x3a3f73, centerRadius: 0.07,
    },
    { // buttercup — bright yellow cup
      stemHeight: 0.70, stemWidth: 0.022, leafLen: 0.20,
      petalCount: 5, petalLen: 0.26, petalWidth: 0.15, tilt: 0.45,
      petalColor: 0xf4c224, centerColor: 0xe6951f, centerRadius: 0.07,
    },
    { // pink aster — medium petals
      stemHeight: 0.88, stemWidth: 0.020, leafLen: 0.24,
      petalCount: 9, petalLen: 0.28, petalWidth: 0.06, tilt: 0.30,
      petalColor: 0xe46fa6, centerColor: 0xf2d24b, centerRadius: 0.08,
    },
  ];
}

function makeFlowerGeometry(kind) {
  const positions = [];
  const colors = [];
  const bends = [];
  const indices = [];
  const invSh = 1 / Math.max(kind.stemHeight, 1e-3);

  const addTri = (a, b, c, col) => {
    const i = positions.length / 3;
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (const v of [a, b, c]) bends.push(Math.max(0, Math.min(1, v[1] * invSh)));
    for (let k = 0; k < 3; k++) colors.push(col.r, col.g, col.b);
    indices.push(i, i + 1, i + 2);
  };
  const addQuad = (a, b, c, d, col) => { addTri(a, b, c, col); addTri(a, c, d, col); };

  const stemColor = new THREE.Color(0x3c7d2e);
  const leafColor = new THREE.Color(0x4f9d42);
  const petalColor = new THREE.Color(kind.petalColor);
  const centerColor = new THREE.Color(kind.centerColor);

  const sh = kind.stemHeight;
  const sw = kind.stemWidth;

  // Stem: two crossed tapered quads so it reads from any angle.
  addQuad([-sw, 0, 0], [sw, 0, 0], [sw * 0.5, sh, 0], [-sw * 0.5, sh, 0], stemColor);
  addQuad([0, 0, -sw], [0, 0, sw], [0, sh, sw * 0.5], [0, sh, -sw * 0.5], stemColor);

  // A single leaf partway up the stem.
  const ll = kind.leafLen;
  addTri([0, sh * 0.38, 0], [ll, sh * 0.46, ll * 0.35], [ll * 0.25, sh * 0.62, 0], leafColor);

  // Petals radiating from the top of the stem.
  const cx = 0, cy = sh, cz = 0;
  const n = kind.petalCount;
  const pl = kind.petalLen;
  const pw = kind.petalWidth;
  const tilt = kind.tilt;
  for (let p = 0; p < n; p++) {
    const ang = (p / n) * Math.PI * 2;
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const sx = Math.cos(ang + Math.PI / 2), sz = Math.sin(ang + Math.PI / 2);
    const mid = [cx + dx * pl * 0.5, cy + tilt * pl * 0.55, cz + dz * pl * 0.5];
    const tip = [cx + dx * pl, cy + tilt * pl, cz + dz * pl];
    const center = [cx, cy, cz];
    const left = [mid[0] + sx * pw, mid[1], mid[2] + sz * pw];
    const right = [mid[0] - sx * pw, mid[1], mid[2] - sz * pw];
    addTri(center, left, tip, petalColor);
    addTri(center, tip, right, petalColor);
  }

  // Center disk.
  const cr = kind.centerRadius;
  const seg = 7;
  const top = cy + tilt * 0.04 + 0.02;
  for (let s = 0; s < seg; s++) {
    const a0 = (s / seg) * Math.PI * 2;
    const a1 = ((s + 1) / seg) * Math.PI * 2;
    addTri(
      [cx, top, cz],
      [cx + Math.cos(a0) * cr, top, cz + Math.sin(a0) * cr],
      [cx + Math.cos(a1) * cr, top, cz + Math.sin(a1) * cr],
      centerColor,
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('aBend', new THREE.Float32BufferAttribute(bends, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export class ProceduralPropsManager {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'procedural-props';
    this.scene.add(this.group);

    // Dense, short clusters so grass reads as a planted lawn near the camera
    // rather than tall isolated spikes (which look detached on coarse LOD).
    this.grassNearGeometry = makeGrassTuftGeometry({ bladeCount: 18, segments: 4, height: 0.85, radius: 0.5 });
    this.grassMidGeometry = makeGrassTuftGeometry({ bladeCount: 9, segments: 3, height: 0.78, radius: 0.62 });
    this.flowerKinds = makeFlowerKinds();
    this.flowerGeometries = this.flowerKinds.map((k) => makeFlowerGeometry(k));

    // Shared wind block (one uTime tick animates everything that uses it).
    this.windUniforms = createWindUniforms();
    this.grassNearMaterial = makeWindMaterial(this.windUniforms, { strengthMul: 1.0, name: 'grass-near' });
    this.grassMidMaterial = makeWindMaterial(this.windUniforms, { strengthMul: 1.0, name: 'grass-mid' });
    this.flowerMaterial = makeWindMaterial(this.windUniforms, { strengthMul: 0.6, name: 'flower' });

    this.meshes = [];
    this._lastKey = '';
    this._lastPaintRevision = -1;
    this._lastUpdateAt = 0;
    this._lastCenter = new THREE.Vector3(Infinity, Infinity, Infinity);
    this._tmpMat = new THREE.Matrix4();
    this._tmpPos = new THREE.Vector3();
    this._tmpScale = new THREE.Vector3();
    this._qAlign = new THREE.Quaternion();
    this._qFull = new THREE.Quaternion();
    this._qYaw = new THREE.Quaternion();
    this._qIdentity = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);
    this._tmpColor = new THREE.Color();
  }

  update({ mode, camera, params, boardSize, sampler, planetSampler, paintLayers }) {
    const enabled = !!params.propsEnabled;
    this.group.visible = enabled;
    if (!enabled || !camera) return;

    const now = performance.now();
    const paintRevision = paintLayers?.revision ?? -1;
    const center = this._resolveCenter(mode, camera, boardSize);
    const moved = center.distanceToSquared(this._lastCenter) > Math.pow(Math.max(60, params.propsCullDistance * 0.22), 2);
    const key = [
      mode, params.seed, params.propsDensity, params.propsGrass, params.propsFlowers,
      params.propsCullDistance, params.propsLodDistance, params.seaLevel, boardSize,
    ].join('|');

    if (key === this._lastKey && paintRevision === this._lastPaintRevision && !moved && now - this._lastUpdateAt < 700) return;
    this._lastKey = key;
    this._lastPaintRevision = paintRevision;
    this._lastUpdateAt = now;
    this._lastCenter.copy(center);

    if (mode === 'planet') {
      this._buildPlanet({ camera, params, planetSampler });
    } else {
      this._buildFlat({ mode, center, params, boardSize, sampler });
    }
  }

  _resolveCenter(mode, camera, boardSize) {
    if (mode === 'studio') {
      const half = boardSize / 2;
      return new THREE.Vector3(
        clamp(camera.position.x, -half, half),
        0,
        clamp(camera.position.z, -half, half)
      );
    }
    return camera.position.clone();
  }

  _clearMeshes() {
    for (const mesh of this.meshes) {
      this.group.remove(mesh);
      mesh.dispose?.();
    }
    this.meshes = [];
  }

  _buildFlat({ mode, center, params, boardSize, sampler }) {
    if (!sampler) return;
    // Center the faceted-surface readback on the build area so every sample in
    // this rebuild hits one cached GPU tile.
    sampler.prime?.(center.x, center.z);
    const radius = params.propsCullDistance;
    const density = clamp(params.propsDensity, 0, 2);
    const cell = lerp(56, 14, Math.sqrt(density / 2));
    const minX = Math.floor((center.x - radius) / cell);
    const maxX = Math.ceil((center.x + radius) / cell);
    const minZ = Math.floor((center.z - radius) / cell);
    const maxZ = Math.ceil((center.z + radius) / cell);
    const half = boardSize / 2;
    const grassNear = [];
    const grassMid = [];
    const flowers = [];
    const maxInstances = Math.round(900 + density * 1800);

    for (let gz = minZ; gz <= maxZ; gz++) {
      for (let gx = minX; gx <= maxX; gx++) {
        if (grassNear.length + grassMid.length + flowers.length >= maxInstances) break;
        const h0 = hashInt(gx, gz, params.seed);
        const h1 = hashInt(gx + 91, gz - 37, params.seed);
        const x = gx * cell + (h0 - 0.5) * cell;
        const z = gz * cell + (h1 - 0.5) * cell;
        if (Math.hypot(x - center.x, z - center.z) > radius) continue;
        if (mode === 'studio' && (Math.abs(x) > half || Math.abs(z) > half)) continue;

        // Cheap density pre-gate BEFORE the expensive terrain sample.
        const paintD = sampler.paintDensityAt ? sampler.paintDensityAt(x, z) : 0;
        if (hashInt(gx - 17, gz + 53, params.seed) > fillChance(params, paintD)) continue;

        const sample = sampler.sampleAt(x, z);
        const desc = chooseCandidate(sample, params, { pick: hashInt(gx + 131, gz + 89, params.seed) });
        if (!desc) continue;

        const item = this._composeItem(desc, sample, gx, gz, params, h0);
        const dist = Math.hypot(x - center.x, z - center.z);
        this._bucketItem(desc, item, dist, params, grassNear, grassMid, flowers);
      }
    }

    this._replaceMeshes(grassNear, grassMid, flowers);
  }

  // Build a render item (position/normal/yaw/scale/alignment) from a chosen
  // descriptor + terrain sample. No per-instance "bury" — anchor at the sampled
  // surface and apply the descriptor's small fixed rootDepth to hide the LOD
  // facet gap uniformly.
  _composeItem(desc, sample, gx, gz, params, h0) {
    const scaleRand = hashInt(gx + 29, gz + 11, params.seed);
    let scale = lerp(desc.scaleRange[0], desc.scaleRange[1], scaleRand);
    if (desc.id === 'grass') scale *= clamp(params.propsGrass, 0.2, 2);
    const [px, py, pz] = sample.position;
    return {
      render: desc.render,
      pos: [px, py - (desc.rootDepth || 0), pz],
      normal: [sample.normal.x, sample.normal.y, sample.normal.z],
      yaw: h0 * Math.PI * 2,
      scale,
      alignAmount: desc.alignAmount ?? (desc.alignMode === 'normal' ? 1 : 0),
      tint: desc.render === 'grass' ? grassTint(sample) : null,
      variant: desc.render === 'flower'
        ? Math.floor(hashInt(gx + 3, gz + 41, params.seed) * this.flowerGeometries.length)
        : 0,
    };
  }

  _bucketItem(desc, item, dist, params, grassNear, grassMid, flowers) {
    if (desc.render === 'flower') { flowers.push(item); return; }
    // Grass renders near-camera only: on coarse far LOD the flat mesh dips below
    // the smooth height and isolated blades read as floating. Keep it close.
    const grassMax = Math.min(params.propsCullDistance, Math.max(160, params.propsLodDistance * 1.5));
    if (dist > grassMax) return;
    if (dist < params.propsLodDistance) grassNear.push(item);
    else grassMid.push(item);
  }

  /** Advance the shared wind animation. Call once per frame from the engine. */
  tickWind(timeSeconds, params) {
    const u = this.windUniforms;
    u.uTime.value = timeSeconds;
    const strength = params?.propsWind == null ? 0.6 : params.propsWind;
    u.uWindStrength.value = 0.30 * Math.max(0, strength);
  }

  _buildPlanet({ camera, params, planetSampler }) {
    if (!planetSampler) return;
    const camDir = camera.position.clone().normalize();
    const ref = Math.abs(camDir.y) < 0.96 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const t1 = new THREE.Vector3().crossVectors(ref, camDir).normalize();
    const t2 = new THREE.Vector3().crossVectors(camDir, t1).normalize();
    const radius = params.propsCullDistance;
    const density = clamp(params.propsDensity, 0, 2);
    const cell = lerp(70, 22, Math.sqrt(density / 2));
    const min = Math.floor(-radius / cell);
    const max = Math.ceil(radius / cell);
    const grassNear = [];
    const grassMid = [];
    const flowers = [];
    const maxInstances = Math.round(700 + density * 1300);

    for (let gy = min; gy <= max; gy++) {
      for (let gx = min; gx <= max; gx++) {
        if (grassNear.length + grassMid.length + flowers.length >= maxInstances) break;
        const h0 = hashInt(gx, gy, params.seed);
        const h1 = hashInt(gx + 43, gy - 71, params.seed);
        const ox = gx * cell + (h0 - 0.5) * cell;
        const oy = gy * cell + (h1 - 0.5) * cell;
        const dist = Math.hypot(ox, oy);
        if (dist > radius) continue;

        // Cheap density pre-gate BEFORE the expensive terrain sample (no paint on planet).
        if (hashInt(gx - 17, gy + 53, params.seed) > fillChance(params, 0)) continue;

        const dir = camDir.clone().multiplyScalar(params.planetRadius)
          .addScaledVector(t1, ox)
          .addScaledVector(t2, oy)
          .normalize();
        const sample = planetSampler.sampleAt3D(dir.x, dir.y, dir.z);
        const desc = chooseCandidate(sample, params, { pick: hashInt(gx + 131, gy + 89, params.seed) });
        if (!desc) continue;

        const scaleRand = hashInt(gx + 29, gy + 11, params.seed);
        let scale = lerp(desc.scaleRange[0], desc.scaleRange[1], scaleRand);
        if (desc.id === 'grass') scale *= clamp(params.propsGrass, 0.2, 2);
        const surfaceRadius = sample.surfaceRadius - (desc.rootDepth || 0);
        const item = {
          render: desc.render,
          pos: [dir.x * surfaceRadius, dir.y * surfaceRadius, dir.z * surfaceRadius],
          normal: [sample.normal.x, sample.normal.y, sample.normal.z],
          yaw: h0 * Math.PI * 2,
          scale,
          alignAmount: desc.alignAmount ?? (desc.alignMode === 'normal' ? 1 : 0),
          tint: desc.render === 'grass' ? grassTint(sample) : null,
          variant: desc.render === 'flower'
            ? Math.floor(hashInt(gx + 3, gy + 41, params.seed) * this.flowerGeometries.length)
            : 0,
        };
        this._bucketItem(desc, item, dist, params, grassNear, grassMid, flowers);
      }
    }

    this._replaceMeshes(grassNear, grassMid, flowers);
  }

  _replaceMeshes(grassNear, grassMid, flowers) {
    this._clearMeshes();
    this._addInstanced('grass-near', this.grassNearGeometry, this.grassNearMaterial, grassNear);
    this._addInstanced('grass-mid', this.grassMidGeometry, this.grassMidMaterial, grassMid);
    // Group flowers by species so each variant gets its own instanced mesh.
    const byVariant = [];
    for (const f of flowers) {
      const v = f.variant || 0;
      (byVariant[v] || (byVariant[v] = [])).push(f);
    }
    for (let v = 0; v < this.flowerGeometries.length; v++) {
      if (byVariant[v]) this._addInstanced(`flowers-${v}`, this.flowerGeometries[v], this.flowerMaterial, byVariant[v]);
    }
  }

  _addInstanced(name, geometry, material, items) {
    if (!items.length) return;
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    mesh.name = `procedural-${name}`;
    mesh.frustumCulled = false;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      this._tmpPos.set(item.pos[0], item.pos[1], item.pos[2]);
      const normal = new THREE.Vector3(item.normal[0], item.normal[1], item.normal[2]).normalize();
      this._qFull.setFromUnitVectors(this._up, normal);
      // partial alignment: slerp from upright (identity) toward full normal-align
      const amount = item.alignAmount == null ? 1 : item.alignAmount;
      this._qAlign.copy(this._qIdentity).slerp(this._qFull, amount);
      this._qYaw.setFromAxisAngle(this._up, item.yaw);
      const q = this._qAlign.clone().multiply(this._qYaw);
      this._tmpScale.setScalar(item.scale);
      this._tmpMat.compose(this._tmpPos, q, this._tmpScale);
      mesh.setMatrixAt(i, this._tmpMat);
      if (item.tint) {
        // per-instance biome tint, multiplied onto the vertex-color gradient
        this._tmpColor.setRGB(item.tint[0], item.tint[1], item.tint[2]);
        mesh.setColorAt(i, this._tmpColor);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
    this.meshes.push(mesh);
  }

  dispose() {
    this._clearMeshes();
    this.scene.remove(this.group);
    this.grassNearGeometry.dispose();
    this.grassMidGeometry.dispose();
    this.flowerGeometries.forEach((g) => g.dispose());
    this.grassNearMaterial.dispose();
    this.grassMidMaterial.dispose();
    this.flowerMaterial.dispose();
  }
}
