import * as THREE from 'three';
import { chooseCandidate, fillChance, hashInt } from './PropPlacement.js';
import { grassTint, terrainRockTint } from './propCatalog.js';
import { createWindUniforms } from './windGLSL.js';
import { makeWindMaterial } from './GrassMaterial.js';

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function makeGrassTuftGeometry({ bladeCount = 14, segments = 4, height = 1, radius = 0.22, clusters = 1, carpetCount = 18 } = {}) {
  const positions = [];
  const colors = [];
  const bends = [];
  const indices = [];
  const bottom = new THREE.Color(0x1f5529);
  const mid = new THREE.Color(0x4a9340);
  const tip = new THREE.Color(0x92bc58);

  const pushVertex = (x, y, z, t, shade) => {
    positions.push(x, y, z);
    bends.push(t);   // 0 at the rooted base → 1 at the tip (wind bend weight)
    const col = (t < 0.68 ? bottom.clone().lerp(mid, t / 0.68) : mid.clone().lerp(tip, (t - 0.68) / 0.32));
    col.multiplyScalar(shade);
    colors.push(col.r, col.g, col.b);
  };

  for (let b = 0; b < bladeCount; b++) {
    const bladeSeed = b * 12.9898;
    const clusterSeed = Math.floor(b * clusters / Math.max(1, bladeCount));
    const clusterAng = clusterSeed * 2.39996 + Math.sin(clusterSeed * 17.17) * 0.4;
    const clusterR = clusters <= 1 ? 0 : radius * (0.12 + 0.68 * Math.abs(Math.sin(clusterSeed * 3.31)));
    const clusterX = Math.cos(clusterAng) * clusterR;
    const clusterZ = Math.sin(clusterAng) * clusterR;
    const localRadius = radius * (clusters <= 1 ? 1 : 0.34);
    const angle = (b / bladeCount) * Math.PI * 2 + Math.sin(bladeSeed) * 0.45;
    const baseR = localRadius * (0.18 + 0.82 * Math.abs(Math.sin(bladeSeed * 1.7)));
    const baseX = Math.cos(angle) * baseR;
    const baseZ = Math.sin(angle) * baseR;
    const tall = Math.abs(Math.sin(bladeSeed * 9.19)) > 0.82 ? 1.0 : 0.62;
    const h = height * tall * (0.55 + 0.42 * Math.abs(Math.sin(bladeSeed * 2.31)));
    const width = 0.034 + 0.05 * Math.abs(Math.cos(bladeSeed * 0.77));
    const lean = 0.16 + 0.34 * Math.abs(Math.sin(bladeSeed * 0.41));
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
      const cx = clusterX + baseX + Math.cos(leanAngle) * lean * bend + Math.cos(angle) * curl;
      const cy = h * t;
      const cz = clusterZ + baseZ + Math.sin(leanAngle) * lean * bend + Math.sin(angle) * curl;
      const w = width * taper;
      pushVertex(cx - sideX * w, cy, cz - sideZ * w, t, shade);
      pushVertex(cx + sideX * w, cy, cz + sideZ * w, t, shade);
    }

    for (let s = 0; s < segments; s++) {
      const a = start + s * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  for (let l = 0; l < carpetCount; l++) {
    const seed = l * 19.191;
    const angle = seed * 2.39996 + Math.sin(seed * 2.7) * 0.6;
    const r = radius * (0.18 + 0.82 * Math.abs(Math.sin(seed * 1.31)));
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const len = radius * (0.32 + 0.38 * Math.abs(Math.sin(seed * 0.73)));
    const wid = 0.06 + 0.06 * Math.abs(Math.cos(seed * 1.71));
    const lift = 0.025 + 0.04 * Math.abs(Math.sin(seed * 4.1));
    const sx = Math.cos(angle + Math.PI * 0.5);
    const sz = Math.sin(angle + Math.PI * 0.5);
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const shade = 0.62 + 0.30 * Math.abs(Math.sin(seed * 3.33));
    const start = positions.length / 3;
    const carpet = bottom.clone().lerp(mid, 0.38 + 0.34 * Math.abs(Math.sin(seed)));
    carpet.multiplyScalar(shade);
    const verts = [
      [x - sx * wid, lift, z - sz * wid, 0.05],
      [x + sx * wid, lift, z + sz * wid, 0.05],
      [x + dx * len + sx * wid * 0.35, lift + height * 0.08, z + dz * len + sz * wid * 0.35, 0.25],
      [x + dx * len - sx * wid * 0.35, lift + height * 0.08, z + dz * len - sz * wid * 0.35, 0.25],
    ];
    for (const v of verts) {
      positions.push(v[0], v[1], v[2]);
      bends.push(v[3]);
      colors.push(carpet.r, carpet.g, carpet.b);
    }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('aBend', new THREE.Float32BufferAttribute(bends, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function makeRockGeometry({ radius = 1, detail = 0, squash = 0.55 } = {}) {
  const geo = new THREE.DodecahedronGeometry(radius, detail);
  const pos = geo.getAttribute('position');
  const colors = [];
  const base = new THREE.Color(0x8a8277);
  const hi = new THREE.Color(0xb2aa9c);
  const lo = new THREE.Color(0x4d4943);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const shade = clamp(0.58 + y * 0.22 + Math.sin(x * 7.1 + z * 4.7) * 0.16, 0, 1);
    const col = shade < 0.5
      ? lo.clone().lerp(base, shade / 0.5)
      : base.clone().lerp(hi, (shade - 0.5) / 0.5);
    colors.push(col.r, col.g, col.b);
    pos.setY(i, Math.max(-radius * 0.46, y * squash));
    pos.setX(i, x * (0.82 + 0.22 * Math.sin(z * 3.7)));
    pos.setZ(i, z * (0.86 + 0.18 * Math.cos(x * 4.1)));
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
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
    this.grassNearGeometry = makeGrassTuftGeometry({ bladeCount: 34, segments: 3, height: 0.58, radius: 1.2, clusters: 6, carpetCount: 34 });
    this.grassMidGeometry = makeGrassTuftGeometry({ bladeCount: 16, segments: 2, height: 0.48, radius: 1.3, clusters: 4, carpetCount: 18 });
    this.rockGeometries = [
      makeRockGeometry({ radius: 1.0, detail: 0, squash: 0.48 }),
      makeRockGeometry({ radius: 1.0, detail: 0, squash: 0.62 }),
      makeRockGeometry({ radius: 1.0, detail: 1, squash: 0.42 }),
    ];
    this.flowerKinds = makeFlowerKinds();
    this.flowerGeometries = this.flowerKinds.map((k) => makeFlowerGeometry(k));

    // Shared wind block (one uTime tick animates everything that uses it).
    this.windUniforms = createWindUniforms();
    this.grassNearMaterial = makeWindMaterial(this.windUniforms, { strengthMul: 1.0, name: 'grass-near' });
    this.grassMidMaterial = makeWindMaterial(this.windUniforms, { strengthMul: 1.0, name: 'grass-mid' });
    this.flowerMaterial = makeWindMaterial(this.windUniforms, { strengthMul: 0.6, name: 'flower' });
    this.rockMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

    this.meshes = [];
    this._lastKey = '';
    this._lastPaintRevision = -1;
    this._lastUpdateAt = 0;
    this._lastCenter = new THREE.Vector3(Infinity, Infinity, Infinity);
    this._lastForward = new THREE.Vector3(0, 0, 0);
    this._tmpMat = new THREE.Matrix4();
    this._tmpPos = new THREE.Vector3();
    this._tmpScale = new THREE.Vector3();
    this._qAlign = new THREE.Quaternion();
    this._qFull = new THREE.Quaternion();
    this._qYaw = new THREE.Quaternion();
    this._qIdentity = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);
    this._tmpColor = new THREE.Color();
    this._cameraDir = new THREE.Vector3();
  }

  update({ mode, camera, params, boardSize, sampler, planetSampler, paintLayers }) {
    const enabled = !!params.propsEnabled;
    this.group.visible = enabled;
    if (!enabled || !camera) return;

    const now = performance.now();
    const paintRevision = paintLayers?.revision ?? -1;
    const center = this._resolveCenter(mode, camera, boardSize);
    const moved = center.distanceToSquared(this._lastCenter) > Math.pow(Math.max(60, params.propsCullDistance * 0.22), 2);
    const viewForward = camera.getWorldDirection(new THREE.Vector3()).normalize();
    const turned = this._lastForward.lengthSq() < 0.5 || viewForward.dot(this._lastForward) < 0.92;
    const key = [
      mode, params.seed, params.propsDensity, params.propsGrass, params.propsFlowers,
      params.propsRocks, params.propsRockScale, params.propsWindSpeed, params.propsGust,
      params.propsCullDistance, params.propsLodDistance, params.seaLevel, boardSize,
    ].join('|');

    if (key === this._lastKey && paintRevision === this._lastPaintRevision && !moved && !turned && now - this._lastUpdateAt < 700) return;
    this._lastKey = key;
    this._lastPaintRevision = paintRevision;
    this._lastUpdateAt = now;
    this._lastCenter.copy(center);
    this._lastForward.copy(viewForward);

    if (mode === 'planet') {
      this._buildPlanet({ camera, params, planetSampler });
    } else {
      this._buildFlat({ mode, center, camera, params, boardSize, sampler });
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

  _flatViewForward(camera) {
    camera.getWorldDirection(this._cameraDir);
    this._cameraDir.y = 0;
    if (this._cameraDir.lengthSq() < 0.03) return null;
    return this._cameraDir.normalize().clone();
  }

  _buildFlat({ mode, center, camera, params, boardSize, sampler }) {
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
    const rocks = [];
    const maxInstances = Math.round(900 + density * 1800);
    const forward = this._flatViewForward(camera);

    for (let gz = minZ; gz <= maxZ; gz++) {
      for (let gx = minX; gx <= maxX; gx++) {
        if (grassNear.length + grassMid.length + flowers.length + rocks.length >= maxInstances) break;
        const h0 = hashInt(gx, gz, params.seed);
        const h1 = hashInt(gx + 91, gz - 37, params.seed);
        const x = gx * cell + (h0 - 0.5) * cell;
        const z = gz * cell + (h1 - 0.5) * cell;
        if (Math.hypot(x - center.x, z - center.z) > radius) continue;
        if (forward) {
          const vx = x - camera.position.x;
          const vz = z - camera.position.z;
          if (vx * forward.x + vz * forward.z < -cell * 2.0) continue;
        }
        if (mode === 'studio' && (Math.abs(x) > half || Math.abs(z) > half)) continue;

        // Cheap density pre-gate BEFORE the expensive terrain sample.
        const paintD = sampler.paintDensityAt ? sampler.paintDensityAt(x, z) : 0;
        if (hashInt(gx - 17, gz + 53, params.seed) > fillChance(params, paintD)) continue;

        const sample = sampler.sampleAt(x, z);
        const desc = chooseCandidate(sample, params, { pick: hashInt(gx + 131, gz + 89, params.seed) });
        if (!desc) continue;

        const item = this._composeItem(desc, sample, gx, gz, params, h0);
        const dist = Math.hypot(x - center.x, z - center.z);
        this._bucketItem(desc, item, dist, params, grassNear, grassMid, flowers, rocks);
      }
    }

    this._replaceMeshes(grassNear, grassMid, flowers, rocks);
  }

  // Build a render item (position/normal/yaw/scale/alignment) from a chosen
  // descriptor + terrain sample. No per-instance "bury" — anchor at the sampled
  // surface and apply the descriptor's small fixed rootDepth to hide the LOD
  // facet gap uniformly.
  _composeItem(desc, sample, gx, gz, params, h0) {
    const scaleRand = hashInt(gx + 29, gz + 11, params.seed);
    let scale = lerp(desc.scaleRange[0], desc.scaleRange[1], scaleRand);
    if (desc.id === 'grass') scale *= clamp(params.propsGrass, 0.2, 2);
    if (desc.id === 'rock') scale *= clamp(params.propsRockScale ?? 1, 0.2, 2.5);
    const [px, py, pz] = sample.position;
    const stretch = desc.id === 'rock' ? [
      scale * lerp(0.75, 1.45, hashInt(gx + 61, gz - 23, params.seed)),
      scale * lerp(0.45, 0.95, hashInt(gx - 19, gz + 67, params.seed)),
      scale * lerp(0.70, 1.35, hashInt(gx + 101, gz + 7, params.seed)),
    ] : scale;
    return {
      render: desc.render,
      pos: [px, py - (desc.rootDepth || 0), pz],
      normal: [sample.normal.x, sample.normal.y, sample.normal.z],
      yaw: h0 * Math.PI * 2,
      scale: stretch,
      alignAmount: desc.alignAmount ?? (desc.alignMode === 'normal' ? 1 : 0),
      tint: desc.render === 'grass' ? grassTint(sample) : (desc.render === 'rock' ? terrainRockTint(sample) : null),
      variant: desc.render === 'flower'
        ? Math.floor(hashInt(gx + 3, gz + 41, params.seed) * this.flowerGeometries.length)
        : desc.render === 'rock'
          ? Math.floor(hashInt(gx + 5, gz + 73, params.seed) * this.rockGeometries.length)
        : 0,
    };
  }

  _bucketItem(desc, item, dist, params, grassNear, grassMid, flowers, rocks) {
    if (desc.render === 'flower') { flowers.push(item); return; }
    if (desc.render === 'rock') { rocks.push(item); return; }
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
    u.uWindSpeed.value = params?.propsWindSpeed == null ? 1.6 : params.propsWindSpeed;
    u.uGustIntensity.value = params?.propsGust == null ? 0.45 : params.propsGust;
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
    const rocks = [];
    const maxInstances = Math.round(700 + density * 1300);
    const cameraForward = camera.getWorldDirection(new THREE.Vector3()).normalize();
    const probe = new THREE.Vector3();

    for (let gy = min; gy <= max; gy++) {
      for (let gx = min; gx <= max; gx++) {
        if (grassNear.length + grassMid.length + flowers.length + rocks.length >= maxInstances) break;
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
        probe.copy(dir).multiplyScalar(params.planetRadius);
        if (probe.sub(camera.position).dot(cameraForward) < -cell * 2.0) continue;
        const sample = planetSampler.sampleAt3D(dir.x, dir.y, dir.z);
        const desc = chooseCandidate(sample, params, { pick: hashInt(gx + 131, gy + 89, params.seed) });
        if (!desc) continue;

        const scaleRand = hashInt(gx + 29, gy + 11, params.seed);
        let scale = lerp(desc.scaleRange[0], desc.scaleRange[1], scaleRand);
        if (desc.id === 'grass') scale *= clamp(params.propsGrass, 0.2, 2);
        if (desc.id === 'rock') scale *= clamp(params.propsRockScale ?? 1, 0.2, 2.5);
        const surfaceRadius = sample.surfaceRadius - (desc.rootDepth || 0);
        const stretch = desc.id === 'rock' ? [
          scale * lerp(0.75, 1.45, hashInt(gx + 61, gy - 23, params.seed)),
          scale * lerp(0.45, 0.95, hashInt(gx - 19, gy + 67, params.seed)),
          scale * lerp(0.70, 1.35, hashInt(gx + 101, gy + 7, params.seed)),
        ] : scale;
        const item = {
          render: desc.render,
          pos: [dir.x * surfaceRadius, dir.y * surfaceRadius, dir.z * surfaceRadius],
          normal: [sample.normal.x, sample.normal.y, sample.normal.z],
          yaw: h0 * Math.PI * 2,
          scale: stretch,
          alignAmount: desc.alignAmount ?? (desc.alignMode === 'normal' ? 1 : 0),
          tint: desc.render === 'grass' ? grassTint(sample) : (desc.render === 'rock' ? terrainRockTint(sample) : null),
          variant: desc.render === 'flower'
            ? Math.floor(hashInt(gx + 3, gy + 41, params.seed) * this.flowerGeometries.length)
            : desc.render === 'rock'
              ? Math.floor(hashInt(gx + 5, gy + 73, params.seed) * this.rockGeometries.length)
            : 0,
        };
        this._bucketItem(desc, item, dist, params, grassNear, grassMid, flowers, rocks);
      }
    }

    this._replaceMeshes(grassNear, grassMid, flowers, rocks);
  }

  _replaceMeshes(grassNear, grassMid, flowers, rocks) {
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
    const rocksByVariant = [];
    for (const r of rocks) {
      const v = r.variant || 0;
      (rocksByVariant[v] || (rocksByVariant[v] = [])).push(r);
    }
    for (let v = 0; v < this.rockGeometries.length; v++) {
      if (rocksByVariant[v]) this._addInstanced(`rocks-${v}`, this.rockGeometries[v], this.rockMaterial, rocksByVariant[v]);
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
      if (Array.isArray(item.scale)) this._tmpScale.set(item.scale[0], item.scale[1], item.scale[2]);
      else this._tmpScale.setScalar(item.scale);
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
    this.rockGeometries.forEach((g) => g.dispose());
    this.grassNearMaterial.dispose();
    this.grassMidMaterial.dispose();
    this.flowerMaterial.dispose();
    this.rockMaterial.dispose();
  }
}
