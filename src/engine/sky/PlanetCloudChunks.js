import * as THREE from 'three';
import { createCloudMaterial } from './CloudVolumeShader.js';
import { resolveCloudNoiseVariant, resolveCloudQuality } from './CloudSettings.js';
import { cloudCoverageAt } from './cloudFieldCPU.js';

// ============================================================================
// PlanetCloudChunks: the chunked replacement for PlanetCloudLayer's single
// raymarched shell. The cloud shell is split into a cube-face grid of sector
// chunks (mirrors PlanetWorld.js) so the shell gains frustum + horizon culling,
// empty-space culling (skip sectors with no cloud — the big win for scattered
// skies) and per-chunk distance LOD, while staying visually identical:
//
//   * each chunk's fragment marches ONLY its angular sector (4 origin planes,
//     CLOUD_CHUNK in CloudVolumeShader) so sectors are disjoint,
//   * step length + phase come from the FULL shell + a per-pixel dither (a
//     global lattice shared by every chunk on a ray) so there are no seams,
//   * chunks are transparent at one renderOrder → three sorts them back-to-front
//     and the "over" operator (associative) reconstructs the single march.
//
// All chunk materials share ONE compiled program and the cloud uniform OBJECTS
// (by reference, like PlanetWorld) — only uCellNormals + uCloudStepScale are
// private. Terrain occlusion reuses the depth prepass (uUseDepth / tSceneDepth).
// ============================================================================

const REFERENCE_PLANET_RADIUS = 16000;

// Six cube faces (same as PlanetWorld): origin corner + two edge vectors over [-1,1]².
const FACES = [
  { o: [ 1, -1, -1], u: [0, 2, 0], v: [0, 0, 2] },
  { o: [-1, -1,  1], u: [0, 2, 0], v: [0, 0, -2] },
  { o: [-1,  1, -1], u: [0, 0, 2], v: [2, 0, 0] },
  { o: [-1, -1,  1], u: [0, 0, -2], v: [2, 0, 0] },
  { o: [-1, -1,  1], u: [2, 0, 0], v: [0, 2, 0] },
  { o: [ 1, -1, -1], u: [-2, 0, 0], v: [0, 2, 0] },
];

// cloud uniforms shared across every chunk material (all except the per-chunk
// uCellNormals + uCloudStepScale). Updating one shared entry updates all chunks.
const SHARED_KEYS = [
  'uCloudInner', 'uCloudOuter', 'uCloudCoverage', 'uCloudSoftness', 'uCloudScale',
  'uCloudDetailScale', 'uCloudDetailStrength', 'uCloudErosionScale', 'uCloudErosionStrength',
  'uCloudExtinction', 'uCloudLightAbsorption', 'uCloudShadowStrength', 'uCloudScattering',
  'uCloudColor', 'uCloudShadowColor', 'uCloudWind', 'uCloudRotation', 'uCloudTime',
  'uCloudSelfShadow', 'uCloudSunDir', 'uCloudNoiseVariant', 'uCloudStepScale',
  'tSceneDepth', 'uDepthResolution', 'uProjectionMatrixInverse', 'uViewMatrixInverse',
  'uDepthBias', 'uUseDepth',
];

const _sphere = new THREE.Sphere();

export class PlanetCloudChunks {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.planetRadius = opts.planetRadius || 16000;
    this._compile = opts.compile || null;
    this.faceGrid = opts.faceGrid || 4;

    this._steps = 24; this._lightSteps = 6; this._octaves = 5;
    this._detailOctaves = 4; this._useErosion = true; this._lightMode = 0;
    this._stepLOD = false;
    this._enabled = false; this._inRange = true; this._maxDistance = Infinity;
    this._rotation = 0; this._rotSpeed = 0;
    this._wind = new THREE.Vector3();
    this._lastParams = null;
    this._compileToken = 0; this._pendingCompile = null;

    // depth prepass (terrain occlusion)
    this._depthTarget = null; this._depthTexture = null;
    this._depthSize = new THREE.Vector2(); this._prevClearColor = new THREE.Color();

    this.shared = null;            // shared uniform entry objects (set on 1st material)
    this._boxGeo = new THREE.BoxGeometry(1, 1, 1);

    this.group = new THREE.Group();
    this.group.name = 'planet-cloud-chunks';
    this.group.renderOrder = 20;
    this.group.visible = false;
    this.scene.add(this.group);

    this._frustum = new THREE.Frustum();
    this._projView = new THREE.Matrix4();
    this._tmp = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
    this._coverEvalAt = 0;
    this._terrainChunkMapBuilt = false;
    this._lastPlanetWorld = null;

    this.chunks = [];
    this._buildChunks();

    this.activeChunkCount = this.chunks.length;
    this.visibleChunkCount = 0; this.culledChunkCount = 0;
    this.lodCounts = [0, 0, 0, 0];
  }

  get active() { return this._enabled && this._inRange; }

  // Create a chunk material: shares the cloud uniform OBJECTS, owns its sector
  // planes. The first material's entries become `this.shared`.
  _makeMaterial(cellNormals) {
    const m = createCloudMaterial(
      this._steps, this._lightSteps, this._octaves,
      this._detailOctaves, this._useErosion, this._lightMode, true
    );
    if (!this.shared) {
      this.shared = {};
      for (const k of SHARED_KEYS) this.shared[k] = m.uniforms[k];
    } else {
      for (const k of SHARED_KEYS) m.uniforms[k] = this.shared[k];
    }
    for (let i = 0; i < 4; i++) m.uniforms.uCellNormals.value[i].copy(cellNormals[i]);
    return m;
  }

  _buildChunks() {
    const g = this.faceGrid;
    for (const face of FACES) {
      const o = new THREE.Vector3(...face.o);
      const U = new THREE.Vector3(...face.u);
      const V = new THREE.Vector3(...face.v);
      const cu = U.clone().multiplyScalar(1 / g);
      const cv = V.clone().multiplyScalar(1 / g);
      for (let j = 0; j < g; j++) {
        for (let i = 0; i < g; i++) {
          const origin = o.clone().addScaledVector(U, i / g).addScaledVector(V, j / g);
          // 4 corner directions (un-normalized face coords → normalized dirs)
          const d00 = origin.clone().normalize();
          const d10 = origin.clone().add(cu).normalize();
          const d11 = origin.clone().add(cu).add(cv).normalize();
          const d01 = origin.clone().add(cv).normalize();
          const centerDir = origin.clone().addScaledVector(cu, 0.5).addScaledVector(cv, 0.5).normalize();

          // 4 inward sector planes (normals through the origin), oriented so the
          // sector interior satisfies dot(N, P) >= 0
          const mkN = (a, b) => {
            const n = new THREE.Vector3().crossVectors(a, b);
            if (n.dot(centerDir) < 0) n.multiplyScalar(-1);
            return n;
          };
          const cellNormals = [
            mkN(d00, d01),   // left edge (u = i/g)
            mkN(d10, d11),   // right edge (u = (i+1)/g)
            mkN(d00, d10),   // bottom edge (v = j/g)
            mkN(d01, d11),   // top edge (v = (j+1)/g)
          ];

          const mat = this._makeMaterial(cellNormals);
          const mesh = new THREE.Mesh(this._boxGeo, mat);
          mesh.frustumCulled = false;
          mesh.matrixAutoUpdate = false;
          mesh.renderOrder = 20;
          mesh.visible = true;
          this.group.add(mesh);

          this.chunks.push({
            mesh, material: mat, centerDir,
            cornerDirs: [d00, d10, d11, d01], cellNormals,
            worldCenter: new THREE.Vector3(), boundRadius: 1, covered: true,
          });
        }
      }
    }
  }

  // Place every chunk's enclosing box for the current inner/outer shell radii.
  _layoutChunks(inner, outer) {
    const lo = new THREE.Vector3(), hi = new THREE.Vector3(), c = new THREE.Vector3();
    for (const ch of this.chunks) {
      lo.set(Infinity, Infinity, Infinity);
      hi.set(-Infinity, -Infinity, -Infinity);
      for (const d of ch.cornerDirs) {
        for (const r of [inner, outer]) {
          c.copy(d).multiplyScalar(r);
          lo.min(c); hi.max(c);
        }
      }
      const center = ch.worldCenter.copy(lo).add(hi).multiplyScalar(0.5);
      ch.mesh.position.copy(center);
      ch.mesh.scale.set(
        Math.max(1, hi.x - lo.x), Math.max(1, hi.y - lo.y), Math.max(1, hi.z - lo.z)
      );
      ch.mesh.updateMatrix();
      ch.boundRadius = 0.5 * lo.distanceTo(hi) * 1.05;
    }
  }

  _buildTerrainChunkMap(planetWorld) {
    if (!planetWorld) return;
    const Gt = planetWorld.faceGrid;
    const Gc = this.faceGrid;
    
    for (let f = 0; f < 6; f++) {
      for (let cj = 0; cj < Gc; cj++) {
        for (let ci = 0; ci < Gc; ci++) {
          const cloudFlatIdx = f * Gc * Gc + cj * Gc + ci;
          const cloudChunk = this.chunks[cloudFlatIdx];
          if (!cloudChunk) continue;
          cloudChunk.terrainChunks = [];
          
          const tiStart = Math.floor(ci * Gt / Gc);
          const tiEnd = Math.floor((ci + 1) * Gt / Gc);
          const tjStart = Math.floor(cj * Gt / Gc);
          const tjEnd = Math.floor((cj + 1) * Gt / Gc);
          
          for (let tj = tjStart; tj < tjEnd; tj++) {
            for (let ti = tiStart; ti < tiEnd; ti++) {
              const terrainFlatIdx = f * Gt * Gt + tj * Gt + ti;
              const terrainChunk = planetWorld.chunks[terrainFlatIdx];
              if (terrainChunk) {
                cloudChunk.terrainChunks.push(terrainChunk);
              }
            }
          }
        }
      }
    }
  }

  applyParams(params, planetRadius, perf) {
    this.planetRadius = planetRadius || this.planetRadius;
    this._lastParams = params;

    const config = perf ? { ...params, ...perf } : params;
    const q = resolveCloudQuality(config);
    this._enabled = !!params.cloudsEnabled && !q.disabled;

    const maxDistMult = config.cloudMaxDistance ?? 6;
    this._maxDistance = maxDistMult * this.planetRadius;

    const u = this.shared;
    const r = this.planetRadius;
    const radiusScale = r / REFERENCE_PLANET_RADIUS;
    const inner = r + (params.cloudAltitude ?? 240) * radiusScale;
    const outer = inner + Math.max(20, (params.cloudThickness ?? 620) * radiusScale);
    u.uCloudInner.value = inner;
    u.uCloudOuter.value = outer;
    this._layoutChunks(inner, outer);

    const fScale = 1.0 / r;
    u.uCloudScale.value = (params.cloudScale ?? 2.2) * fScale;
    u.uCloudDetailScale.value = (params.cloudDetailScale ?? 7.0) * fScale;
    u.uCloudErosionScale.value = (params.cloudErosionScale ?? 15.0) * fScale;
    u.uCloudDetailStrength.value = params.cloudDetailStrength ?? 0.35;
    u.uCloudErosionStrength.value = params.cloudErosionStrength ?? 0.30;

    u.uCloudCoverage.value = params.cloudCoverage ?? 0.5;
    u.uCloudSoftness.value = Math.max(0.01, params.cloudSoftness ?? 0.16);

    const thickness = outer - inner;
    u.uCloudExtinction.value = (params.cloudDensity ?? 1.0) * 8.0 / Math.max(thickness, 1);
    u.uCloudLightAbsorption.value = params.cloudLightAbsorption ?? 1.1;
    u.uCloudShadowStrength.value = params.cloudShadowStrength ?? 0.6;
    u.uCloudScattering.value = params.cloudScatteringStrength ?? 1.0;
    u.uCloudSelfShadow.value = q.selfShadow ? 1.0 : 0.0;
    u.uCloudNoiseVariant.value = resolveCloudNoiseVariant(params.cloudNoiseVariant);
    this._stepLOD = q.stepLOD;

    if (params.cloudColor) u.uCloudColor.value.setRGB(...params.cloudColor);
    if (params.cloudShadowColor) u.uCloudShadowColor.value.setRGB(...params.cloudShadowColor);

    const wa = (params.cloudWindDir ?? 45) * Math.PI / 180;
    const wspeed = (params.cloudWindSpeed ?? 1.0) * 0.6 * fScale;
    this._wind.set(Math.cos(wa), 0, Math.sin(wa)).multiplyScalar(wspeed);
    u.uCloudWind.value.copy(this._wind);

    this._rotSpeed = (params.cloudRotationSpeed ?? 0.35) * 0.01;

    if (q.steps !== this._steps || q.lightSteps !== this._lightSteps ||
        q.octaves !== this._octaves || q.detailOctaves !== this._detailOctaves ||
        q.useErosion !== this._useErosion || q.lightMode !== this._lightMode) {
      this._rebuildMaterials(q.steps, q.lightSteps, q.octaves, q.detailOctaves, q.useErosion, q.lightMode);
    }
  }

  // ---- background compile (warm the shared program, swap all chunks when ready)
  _compileRep(repMaterial) {
    const token = ++this._compileToken;
    if (!this._compile) return { token, promise: Promise.resolve() };
    let promise;
    try { promise = Promise.resolve(this._compile([repMaterial])); }
    catch (e) { promise = Promise.reject(e); }
    const done = promise.catch(() => {});
    this._pendingCompile = { promise: done };
    done.finally(() => { if (this._pendingCompile?.promise === done) this._pendingCompile = null; });
    return { token, promise: done };
  }

  warmup() {
    if (this._pendingCompile) return this._pendingCompile.promise;
    return this._compileRep(this.chunks[0].material).promise;
  }

  _rebuildMaterials(steps, lightSteps, octaves, detailOctaves, useErosion, lightMode) {
    this._steps = steps; this._lightSteps = lightSteps; this._octaves = octaves;
    this._detailOctaves = detailOctaves; this._useErosion = useErosion; this._lightMode = lightMode;

    // build the next material for every chunk (all share this.shared + the
    // already-cached program once one is compiled)
    const next = this.chunks.map((ch) => this._makeMaterial(ch.cellNormals));
    const previous = this.chunks.map((ch) => ch.material);
    const { token, promise } = this._compileRep(next[0]);
    promise.then(() => {
      if (token !== this._compileToken) { next.forEach((m) => m.dispose()); return; }
      this.chunks.forEach((ch, i) => { ch.material = next[i]; ch.mesh.material = next[i]; });
      previous.forEach((m) => m.dispose());
    });
  }

  // ---- per-frame: animate (shared, once) + cull + LOD (per chunk)
  update(dt, cameraPos, sunDir, camera, planetWorld, debug = {}) {
    if (!this._enabled) {
      if (this.group.visible) this.group.visible = false;
      return;
    }
    const freezeCulling = !!debug.freezeCulling;
    const freezeLod = !!debug.freezeLod;

    const dist = cameraPos.length();
    if (!freezeCulling) {
      this._inRange = dist <= this._maxDistance;
      this.group.visible = this._inRange;
    }
    if (!this._inRange) return;

    const u = this.shared;
    u.uCloudTime.value += dt;
    this._rotation += dt * (this._rotSpeed || 0);
    u.uCloudRotation.value = this._rotation;
    if (sunDir) u.uCloudSunDir.value.copy(sunDir);

    // step-LOD ramp (shared scalar updated once globally so all chunks share the same lattice)
    if (!freezeLod) {
      const near = this.planetRadius;
      const far = this._maxDistance;
      if (this._stepLOD && Number.isFinite(far)) {
        const f = far > near ? (dist - near) / (far - near) : 0;
        u.uCloudStepScale.value = Math.max(0.4, Math.min(1.0, 1.0 - f * 0.6));
      } else {
        u.uCloudStepScale.value = 1.0;
      }
    }

    if (!freezeCulling && camera) {
      this._projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this._frustum.setFromProjectionMatrix(this._projView);
    }
    const camLen = this._camDir.copy(cameraPos).length();
    this._camDir.multiplyScalar(camLen > 1e-3 ? 1 / camLen : 0);
    const horizonCos = (this.planetRadius / Math.max(camLen, 1)) - 0.12;

    // re-evaluate empty-space coverage at a throttled rate (clouds drift slowly)
    const now = performance.now();
    let evalCover = false;
    if (now - this._coverEvalAt > 180) { this._coverEvalAt = now; evalCover = true; }
    const field = evalCover ? {
      scale: u.uCloudScale.value,
      windX: u.uCloudWind.value.x, windY: u.uCloudWind.value.y, windZ: u.uCloudWind.value.z,
      time: u.uCloudTime.value, rotation: u.uCloudRotation.value,
      coverage: u.uCloudCoverage.value, softness: u.uCloudSoftness.value,
      octaves: this._octaves,
    } : null;
    const midR = 0.5 * (u.uCloudInner.value + u.uCloudOuter.value);

    // Build or update the terrain chunk mapping if necessary
    if (planetWorld && (!this._terrainChunkMapBuilt || this._lastPlanetWorld !== planetWorld)) {
      this._buildTerrainChunkMap(planetWorld);
      this._terrainChunkMapBuilt = true;
      this._lastPlanetWorld = planetWorld;
    }

    let visible = 0, culled = 0;
    const counts = [0, 0, 0, 0];
    for (const ch of this.chunks) {
      if (!freezeCulling) {
        if (evalCover) ch.covered = this._sectorCovered(ch, midR, field);

        let show = true;
        if (planetWorld && ch.terrainChunks && ch.terrainChunks.length > 0) {
          let anyVisible = false;
          for (const tc of ch.terrainChunks) {
            if (tc.mesh.visible) {
              anyVisible = true;
              break;
            }
          }
          show = anyVisible;
          
          // Safety check for surface view: if terrain thinks it's culled,
          // double check if the cloud's own bounding sphere actually intersects the frustum.
          if (!show && camLen <= this.planetRadius * 1.05 && camera) {
            if (this._frustum.intersectsSphere(_sphere.set(ch.worldCenter, ch.boundRadius))) {
              show = true;
            }
          }
        } else {
          // Fallback to standard cloud-only culling logic
          show = ch.covered;
          if (show && camLen > this.planetRadius && this._camDir.dot(ch.centerDir) < horizonCos) show = false;
          if (show && camera && !this._frustum.intersectsSphere(_sphere.set(ch.worldCenter, ch.boundRadius))) show = false;
        }

        ch.mesh.visible = show;
      }
      if (ch.mesh.visible) { visible++; counts[0]++; } else culled++;
    }
    this.visibleChunkCount = visible;
    this.culledChunkCount = culled;
    if (!freezeCulling) {
      this.group.visible = this._inRange && visible > 0;
    }
    this.lodCounts = counts;
  }

  // Is there any cloud in this sector right now? Sample coverage at the center +
  // 4 corners at mid-shell radius (conservative — base FBM only).
  _sectorCovered(ch, midR, f) {
    const pts = [ch.centerDir, ...ch.cornerDirs];
    for (const d of pts) {
      const cov = cloudCoverageAt(d.x * midR, d.y * midR, d.z * midR, f);
      if (cov > 0.005) return true;
    }
    return false;
  }

  // ---- terrain depth occlusion (shared; identical to PlanetCloudLayer)
  renderDepthPrepass(renderer, camera, baseSize = null) {
    if (!this.active) { if (this.shared) this.shared.uUseDepth.value = 0.0; return false; }
    this._ensureDepthTarget(renderer, baseSize);

    const wasVisible = this.group.visible;
    const prevTarget = renderer.getRenderTarget();
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this._prevClearColor);
    try {
      this.group.visible = false;
      renderer.setRenderTarget(this._depthTarget);
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, true, true);
      renderer.render(this.scene, camera);
    } finally {
      this.group.visible = wasVisible;
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(this._prevClearColor, prevClearAlpha);
    }

    const u = this.shared;
    u.tSceneDepth.value = this._depthTexture;
    u.uDepthResolution.value.set(this._depthTarget.width, this._depthTarget.height);
    u.uProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
    u.uViewMatrixInverse.value.copy(camera.matrixWorld);
    u.uUseDepth.value = 1.0;
    return true;
  }

  _ensureDepthTarget(renderer, baseSize = null) {
    const size = baseSize || renderer.getDrawingBufferSize(this._depthSize);
    const w = Math.max(1, Math.round(size.x));
    const h = Math.max(1, Math.round(size.y));
    if (this._depthTarget && this._depthTarget.width === w && this._depthTarget.height === h) return;
    if (this._depthTarget) this._depthTarget.dispose();
    this._depthTexture = new THREE.DepthTexture(w, h);
    this._depthTexture.type = THREE.UnsignedInt248Type;
    this._depthTexture.format = THREE.DepthStencilFormat;
    this._depthTarget = new THREE.WebGLRenderTarget(w, h, {
      depthTexture: this._depthTexture, depthBuffer: true, stencilBuffer: true,
    });
    this._depthTarget.texture.minFilter = THREE.NearestFilter;
    this._depthTarget.texture.magFilter = THREE.NearestFilter;
    this._depthTarget.texture.generateMipmaps = false;
  }

  dispose() {
    if (this._depthTarget) { this._depthTarget.dispose(); this._depthTarget = null; this._depthTexture = null; }
    for (const ch of this.chunks) ch.material.dispose();
    this._boxGeo.dispose();
    this.scene.remove(this.group);
    this.chunks = [];
    this.shared = null;
    this.group = null;
  }
}
