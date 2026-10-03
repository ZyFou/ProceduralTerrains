import * as THREE from 'three';

// ============================================================================
// Camera-centred fine level of the Tile-mode height bake (a one-level
// clipmap). The board bake (TerrainHeightBaker) stores the exact field at
// ~1 world unit per texel; pixels nearer than about 0.5 texel / pixel
// footprint still evaluated the full procedural stack, which was most of the
// close-up GPU time. This level bakes a window in front of the camera at half
// that texel size, with the SAME packing and the SAME compiled bake program
// (a second material instance whose origin/span uniforms are private), so the
// live stack only runs for extreme close-ups.
//
// - Origins snap to a 32-texel grid, so texel centres sit on the same world
//   positions in every bake: re-centring never changes a sampled value.
// - Bakes are progressive (row stripes into a back buffer) and the previous
//   window stays published until the new one is complete; its data stays
//   exact, so it keeps serving whatever part of the view it covers.
// - A new window is baked once the camera settles (a moving camera would
//   restart it before it could ever publish), with a larger stripe budget so
//   it lands within a few frames.
// - The window is only maintained while some visible pixel can use it, and
//   the back buffer only exists while a bake is in flight.
// ============================================================================

const SNAP_TEXELS = 32;

export class NearHeightCache {
  constructor({ renderer, uniforms, size = 1024 }) {
    this.renderer = renderer;
    this.uniforms = uniforms;
    this.size = size;
    this.front = null;
    this.back = null;
    this.material = null;
    this._programKey = null;
    this._sourceKey = null;      // board bake generation this window belongs to
    this._job = null;
    this._origin = new THREE.Vector2();
    this._span = 0;
    this._texel = 0;
    this._lastCamera = new THREE.Vector3(Infinity, Infinity, Infinity);
    this._stillFrames = 0;
    this._private = {
      uBakeOrigin: { value: new THREE.Vector2() },
      uBakeSpan: { value: new THREE.Vector2(1, 1) },
      uBakeUvTransform: { value: new THREE.Vector4(0, 0, 1, 1) },
      uBakeSampleCount: { value: 3 },
    };
    this.scene = new THREE.Scene();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.cam = new THREE.Camera();
  }

  get isBaking() { return !!this._job; }
  get active() { return this.uniforms.uUseNearBake?.value > 0.5; }

  _makeTarget() {
    const target = new THREE.WebGLRenderTarget(this.size, this.size, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });
    target.texture.colorSpace = THREE.NoColorSpace;
    target.texture.name = 'TerrainNearHeightNormalRGBA16F';
    return target;
  }

  // Mirror the board baker's published program: identical source + defines,
  // so three.js reuses the already linked program (no compile).
  _syncMaterial(baker) {
    const source = baker?.material;
    const key = baker?.programKey;
    if (!source || !key) return false;
    if (this.material && this._programKey === key) return true;
    this.material?.dispose();
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...source.uniforms, ...this._private },
      defines: { ...source.defines },
      vertexShader: source.vertexShader,
      fragmentShader: source.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh.material = this.material;
    this._programKey = key;
    this.invalidate();
    return true;
  }

  /** Drop the published window (terrain changed or the board bake is gone). */
  invalidate() {
    this._job = null;
    this._sourceKey = null;
    if (this.uniforms.uUseNearBake) this.uniforms.uUseNearBake.value = 0;
  }

  /**
   * @param {object} o
   * @param {object} o.baker          TerrainHeightBaker (published board bake)
   * @param {string} o.sourceKey      generation/layout key of the board bake
   * @param {boolean} o.enabled       board bake in use (uUseTerrainHeightTex)
   * @param {THREE.Camera} o.camera
   * @param {number} o.boardTexel     world size of a board-bake texel
   * @param {number} o.pixelWorldPerDist
   * @param {number} o.groundY        approximate terrain height under the camera
   * @param {number} o.rows           stripe budget per frame once the camera is still
   * @param {number} [o.movingRows]   budget while a started bake finishes under motion
   */
  update({ baker, sourceKey, enabled, camera, boardTexel, pixelWorldPerDist, groundY = 0, rows = 128, movingRows = 32 }) {
    if (!enabled || !baker?.texture || !(boardTexel > 0) || !(pixelWorldPerDist > 0)) {
      this.invalidate();
      return;
    }
    if (!this._syncMaterial(baker)) { this.invalidate(); return; }
    if (sourceKey !== this._sourceKey && this._job?.sourceKey !== sourceKey) {
      // terrain changed: the published window is stale
      if (this.uniforms.uUseNearBake) this.uniforms.uUseNearBake.value = 0;
      this._job = null;
    }

    const texel = boardTexel * 0.5;
    const span = texel * this.size;
    const moved = camera.position.distanceTo(this._lastCamera);
    this._lastCamera.copy(camera.position);
    this._stillFrames = moved > texel * 0.25 ? 0 : this._stillFrames + 1;
    const settled = this._stillFrames >= 3;
    // Pixels need the fine level only while the board bake is magnified:
    // view distance below uBakeBlend.y board texels per pixel footprint.
    const blendHi = this.uniforms.uBakeBlend?.value?.y ?? 0.5;
    const needDistance = blendHi * boardTexel / pixelWorldPerDist;
    const height = Math.max(0, camera.position.y - groundY);
    if (height > needDistance) {
      // every visible pixel is already fully served by the board bake
      if (!this._job && this.uniforms.uUseNearBake) this.uniforms.uUseNearBake.value = 0;
      return;
    }

    // centre the window ahead of the camera (that is where the pixels are)
    camera.getWorldDirection(_dir);
    _dir.y = 0;
    if (_dir.lengthSq() > 1e-8) _dir.normalize();
    const ahead = Math.min(span * 0.3, needDistance * 0.5);
    const cx = camera.position.x + _dir.x * ahead;
    const cz = camera.position.z + _dir.z * ahead;
    const snap = texel * SNAP_TEXELS;
    const ox = Math.round((cx - span / 2) / snap) * snap;
    const oz = Math.round((cz - span / 2) / snap) * snap;

    const published = this.uniforms.uUseNearBake?.value > 0.5 && this._sourceKey === sourceKey;
    const drift = (x, z) => Math.max(Math.abs(x - ox), Math.abs(z - oz));
    if (this._job) {
      // keep finishing the running bake unless it no longer covers the view
      if (this._job.sourceKey !== sourceKey || drift(this._job.ox, this._job.oz) > span * 0.5
          || this._job.texel !== texel) {
        this._job = null;
      }
    }
    if (!this._job) {
      const current = published && this._texel === texel ? drift(this._origin.x, this._origin.y) : Infinity;
      if (current <= span * 0.125) return;   // published window still centred
      if (!settled) return;                  // re-centre once the camera stops
      this._job = { ox, oz, texel, span, sourceKey, row: 0 };
    }
    this._step(settled ? rows : movingRows);
  }

  _step(rows) {
    const job = this._job;
    if (!this.back) this.back = this._makeTarget();
    const n = Math.min(Math.max(1, rows), this.size - job.row);
    const r = this.renderer;
    const u = this._private;
    u.uBakeOrigin.value.set(job.ox, job.oz);
    u.uBakeSpan.value.set(job.span, job.span);
    u.uBakeUvTransform.value.set(0, job.row / this.size, 1, n / this.size);
    const prevTarget = r.getRenderTarget();
    try {
      // Match the board bake in physical texels, independently of canvas DPR.
      // The renderer's viewport/scissor setters multiply by that DPR.
      this.back.viewport.set(0, job.row, this.size, n);
      this.back.scissor.set(0, job.row, this.size, n);
      this.back.scissorTest = true;
      r.setRenderTarget(this.back);
      r.render(this.scene, this.cam);
    } finally {
      r.setRenderTarget(prevTarget);
    }
    job.row += n;
    if (job.row < this.size) return;
    [this.front, this.back] = [this.back, this.front];
    // the previous window is no longer sampled once the uniforms below move on
    this.back?.dispose();
    this.back = null;
    this._origin.set(job.ox, job.oz);
    this._span = job.span;
    this._texel = job.texel;
    this._sourceKey = job.sourceKey;
    this._job = null;
    const s = this.uniforms;
    s.uNearBakeTex.value = this.front.texture;
    s.uNearBakeOrigin.value.set(job.ox, job.oz);
    s.uNearBakeSpan.value.set(job.span, job.span);
    s.uNearBakeTexelWorld.value = job.texel;
    s.uUseNearBake.value = 1;
  }

  /** Free the VRAM (Tile mode left); the program stays cached. */
  releaseTargets() {
    this.invalidate();
    this.front?.dispose();
    this.back?.dispose();
    this.front = null;
    this.back = null;
    if (this.uniforms.uNearBakeTex) this.uniforms.uNearBakeTex.value = null;
  }

  dispose() {
    this.releaseTargets();
    this.material?.dispose();
    this.material = null;
    this.mesh.geometry.dispose();
  }
}

const _dir = new THREE.Vector3();
