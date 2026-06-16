import * as THREE from 'three';
import { createCloudSlabMaterial } from './CloudSlabShader.js';
import { resolveCloudNoiseVariant, resolveCloudQuality } from './CloudSettings.js';

// ============================================================================
// CloudSlabLayer: studio/flat-board manager for the planar volumetric cloud
// slab. The twin of PlanetCloudLayer — same cloud params, same quality/fallback
// resolution, but it sits over the board between two horizontal planes.
//
// The mesh is one large horizontal plane that only supplies fragments; the
// volume comes from the slab raymarch. The layer keeps a `_ready` gate so the
// (heavy) program is warmed in the background on first enable and the slab only
// becomes visible once compiled — no first-frame hang.
// ============================================================================

export class CloudSlabLayer {
  /**
   * @param {THREE.Scene} scene
   * @param {object} opts
   * @param {(mats: THREE.Material[]) => Promise<void>} [opts.compile] warmup hook
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    this._compile = opts.compile || null;

    this._steps = 64;
    this._lightSteps = 6;
    this._octaves = 5;
    this._detailOctaves = 4;
    this._useErosion = true;
    this._enabled = false;
    this._inScene = true;       // gated off while another world mode is active
    this._inRange = true;
    this._ready = !this._compile;
    this._warming = false;
    this._maxDistance = Infinity;
    this._rotation = 0;
    this._wind = new THREE.Vector3();
    this._boardSize = 2048;
    this._depthTarget = null;
    this._depthTexture = null;
    this._depthSize = new THREE.Vector2();
    this._prevClearColor = new THREE.Color();
    this._compileToken = 0;
    this._pendingCompile = null;

    this.material = createCloudSlabMaterial(
      this._steps,
      this._lightSteps,
      this._octaves,
      this._detailOctaves,
      this._useErosion
    );

    // a unit plane rotated flat (XZ); scaled to cover the board + sky margin
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
    this.scene.add(this.mesh);
  }

  get active() {
    return this._enabled && this._inScene && this._inRange && this._ready;
  }

  /** Show/hide the slab for the active world mode (studio only). */
  setInScene(on) {
    this._inScene = !!on;
    if (!this._inScene) this.mesh.visible = false;
  }

  /**
   * @param {object} params engine params (cloud* keys)
   * @param {number} maxHeight terrain height ceiling (unused — kept for API parity)
   * @param {number} boardSize world size of the board (drives horizontal scale)
   * @param {object} [perf] centralized performance settings
   */
  applyParams(params, maxHeight, boardSize, perf) {
    this._boardSize = boardSize || this._boardSize;

    const config = perf ? { ...params, ...perf } : params;
    const q = resolveCloudQuality(config);
    this._enabled = !!params.cloudsEnabled && !q.disabled;

    const maxDistMult = config.cloudMaxDistance ?? 6;
    this._maxDistance = maxDistMult * this._boardSize;

    const u = this.material.uniforms;
    // Altitude is an ABSOLUTE world height (y=0 is the ground/sea base), so the
    // layer can sit anywhere from ground level up — not pinned above the peaks.
    const bottom = params.cloudAltitude ?? 240;
    const thickness = Math.max(20, params.cloudThickness ?? 620);
    const top = bottom + thickness;
    u.uCloudBottom.value = bottom;
    u.uCloudTop.value = top;

    const radius = this._boardSize * 0.62;
    u.uCloudRadius.value = radius;
    u.uCloudFar.value = this._boardSize * 4.0;   // bound horizon marching
    u.uCloudCenter.value.set(0, 0, 0);

    // size + place the plane to cover the slab over the board
    const span = this._boardSize * 4.0;
    this.mesh.scale.set(span, 1, span);
    this.mesh.position.set(0, (bottom + top) * 0.5, 0);

    // frequencies are user-relative; scale by board size so a slider value maps
    // to the same world feature size regardless of board dimensions.
    const fScale = 1.0 / Math.max(this._boardSize, 1);
    u.uCloudScale.value = (params.cloudScale ?? 2.2) * fScale;
    u.uCloudDetailScale.value = (params.cloudDetailScale ?? 7.0) * fScale;
    u.uCloudErosionScale.value = (params.cloudErosionScale ?? 15.0) * fScale;
    u.uCloudDetailStrength.value = params.cloudDetailStrength ?? 0.35;
    u.uCloudErosionStrength.value = params.cloudErosionStrength ?? 0.30;

    u.uCloudCoverage.value = params.cloudCoverage ?? 0.5;
    u.uCloudSoftness.value = Math.max(0.01, params.cloudSoftness ?? 0.16);

    u.uCloudExtinction.value = (params.cloudDensity ?? 1.0) * 8.0 / thickness;
    u.uCloudLightAbsorption.value = params.cloudLightAbsorption ?? 1.1;
    u.uCloudShadowStrength.value = params.cloudShadowStrength ?? 0.6;
    u.uCloudScattering.value = params.cloudScatteringStrength ?? 1.0;
    u.uCloudSelfShadow.value = q.selfShadow ? 1.0 : 0.0;
    u.uCloudNoiseVariant.value = resolveCloudNoiseVariant(params.cloudNoiseVariant);

    if (params.cloudColor) u.uCloudColor.value.setRGB(...params.cloudColor);
    if (params.cloudShadowColor) u.uCloudShadowColor.value.setRGB(...params.cloudShadowColor);

    const wa = (params.cloudWindDir ?? 45) * Math.PI / 180;
    const wspeed = (params.cloudWindSpeed ?? 1.0) * 0.6 * fScale;
    this._wind.set(Math.cos(wa), 0, Math.sin(wa)).multiplyScalar(wspeed);
    u.uCloudWind.value.copy(this._wind);

    this._rotSpeed = (params.cloudRotationSpeed ?? 0.35) * 0.01;

    // recompile if the step counts or noise settings changed (quality / fallback)
    // We check and rebuild at the end so _rebuildMaterial can copy the fully updated uniforms to the new material.
    const needsRebuild = q.steps !== this._steps ||
        q.lightSteps !== this._lightSteps ||
        q.octaves !== this._octaves ||
        q.detailOctaves !== this._detailOctaves ||
        q.useErosion !== this._useErosion;
    if (needsRebuild) {
      this._rebuildMaterial(q.steps, q.lightSteps, q.octaves, q.detailOctaves, q.useErosion);
    }

    // warm the program in the background on first enable (no first-frame hang)
    if (this._enabled && !this._ready && !this._warming && this._compile) {
      this._compileCurrentMaterial();
    }
  }

  _compileCurrentMaterial() {
    if (!this._compile) {
      this._ready = true;
      this._warming = false;
      return Promise.resolve();
    }

    const material = this.material;
    const token = ++this._compileToken;
    this._ready = false;
    this._warming = true;

    let promise;
    try {
      promise = Promise.resolve(this._compile([material]));
    } catch (e) {
      promise = Promise.reject(e);
    }

    const done = promise.catch(() => {});
    this._pendingCompile = { material, promise: done };

    done.then(() => {
      if (token === this._compileToken && this.material === material) {
        this._ready = true;
        this._warming = false;
      }
    }).finally(() => {
      if (this._pendingCompile?.promise === done) this._pendingCompile = null;
    });

    return done;
  }

  _disposeWhenSafe(material, pending) {
    if (!material) return;
    if (pending) pending.finally(() => material.dispose());
    else material.dispose();
  }

  _rebuildMaterial(steps, lightSteps, octaves, detailOctaves, useErosion) {
    this._steps = steps;
    this._lightSteps = lightSteps;
    this._octaves = octaves;
    this._detailOctaves = detailOctaves;
    this._useErosion = useErosion;
    const previous = this.material;
    const pendingPrevious = this._pendingCompile?.material === previous
      ? this._pendingCompile.promise
      : null;
    const next = createCloudSlabMaterial(
      steps,
      lightSteps,
      octaves,
      detailOctaves,
      useErosion
    );
    const a = previous.uniforms, b = next.uniforms;
    for (const k in b) {
      if (!(k in a)) continue;
      const av = a[k].value, bv = b[k].value;
      if (av && av.copy && bv && bv.copy) bv.copy(av);
      else b[k].value = a[k].value;
    }
    this.mesh.material = next;
    this.material = next;
    this.mesh.visible = false;
    this._disposeWhenSafe(previous, pendingPrevious);
    this._compileCurrentMaterial();
  }

  update(dt, cameraPos, sunDir) {
    if (!this._enabled || !this._inScene || !this._ready) {
      if (this.mesh.visible) this.mesh.visible = false;
      return;
    }
    const dist = cameraPos.length();
    this._inRange = dist <= this._maxDistance;
    this.mesh.visible = this._inRange;
    if (!this._inRange) return;

    const u = this.material.uniforms;
    u.uCloudTime.value += dt;
    this._rotation += dt * (this._rotSpeed || 0);
    u.uCloudRotation.value = this._rotation;
    if (sunDir) u.uCloudSunDir.value.copy(sunDir);
  }

  renderDepthPrepass(renderer, camera) {
    if (!this.active) return false;

    this._ensureDepthTarget(renderer);

    const wasVisible = this.mesh.visible;
    const prevTarget = renderer.getRenderTarget();
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this._prevClearColor);

    try {
      this.mesh.visible = false;
      renderer.setRenderTarget(this._depthTarget);
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, true, true);
      renderer.render(this.scene, camera);
    } finally {
      this.mesh.visible = wasVisible;
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(this._prevClearColor, prevClearAlpha);
    }

    const u = this.material.uniforms;
    u.tSceneDepth.value = this._depthTexture;
    u.uDepthResolution.value.set(this._depthTarget.width, this._depthTarget.height);
    u.uProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
    u.uViewMatrixInverse.value.copy(camera.matrixWorld);
    return true;
  }

  _ensureDepthTarget(renderer) {
    const size = renderer.getDrawingBufferSize(this._depthSize);
    const w = Math.max(1, Math.round(size.x));
    const h = Math.max(1, Math.round(size.y));
    if (this._depthTarget && this._depthTarget.width === w && this._depthTarget.height === h) return;

    if (this._depthTarget) this._depthTarget.dispose();
    this._depthTexture = new THREE.DepthTexture(w, h);
    this._depthTexture.type = THREE.UnsignedInt248Type;
    this._depthTexture.format = THREE.DepthStencilFormat;
    this._depthTarget = new THREE.WebGLRenderTarget(w, h, {
      depthTexture: this._depthTexture,
      depthBuffer: true,
      stencilBuffer: true,
    });
    this._depthTarget.texture.minFilter = THREE.NearestFilter;
    this._depthTarget.texture.magFilter = THREE.NearestFilter;
    this._depthTarget.texture.generateMipmaps = false;
  }

  dispose() {
    if (this._depthTarget) {
      this._depthTarget.dispose();
      this._depthTarget = null;
      this._depthTexture = null;
    }
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh = null;
    this.material = null;
  }
}
