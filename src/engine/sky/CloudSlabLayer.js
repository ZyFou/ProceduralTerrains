import * as THREE from 'three';
import { createCloudSlabMaterial } from './CloudSlabShader.js';
import { resolveCloudNoiseVariant, resolveCloudQuality } from './CloudSettings.js';
import { buildOccupancyPlanar } from './cloudFieldCPU.js';
import { CloudLowResPass } from './CloudLowResPass.js';

// Resolution of the planar (XZ) occupancy grid for the studio cloud slab.
const OCC_SIZE = 64;

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

    this._steps = 24;
    this._lightSteps = 6;
    this._octaves = 5;
    this._detailOctaves = 4;
    this._useErosion = true;
    this._lightMode = 0;
    this._stepLOD = false;
    this._lowRes = false;       // half/quarter-res cloud render + bilateral upscale
    this._lowResPass = new CloudLowResPass();
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

    // planar occupancy grid (empty-space-skip acceleration), rebuilt on a throttle
    this._occData = new Uint8Array(OCC_SIZE * OCC_SIZE);
    this._occTex = new THREE.DataTexture(this._occData, OCC_SIZE, OCC_SIZE, THREE.RedFormat, THREE.UnsignedByteType);
    this._occTex.minFilter = THREE.LinearFilter;
    this._occTex.magFilter = THREE.LinearFilter;
    this._occTex.wrapS = THREE.ClampToEdgeWrapping;
    this._occTex.wrapT = THREE.ClampToEdgeWrapping;
    this._occTex.generateMipmaps = false;
    this._occTex.needsUpdate = true;
    this._occBuiltAt = 0;

    this.material = createCloudSlabMaterial(
      this._steps,
      this._lightSteps,
      this._octaves,
      this._detailOctaves,
      this._useErosion,
      this._lightMode
    );
    this._applyOccupancyUniforms();

    // a unit box that ENCLOSES the slab volume (scaled in applyParams). Drawn
    // BackSide so its far faces always cover the volume's screen footprint from
    // any angle — a flat plane clipped the clouds at grazing views from below.
    const geo = new THREE.BoxGeometry(1, 1, 1);
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
   * @param {number} boardSize world size of ONE cell (drives noise feature size)
   * @param {object} [perf] centralized performance settings
   * @param {object} [layout] tile-assembly coverage: { extent, center:{x,z} }.
   *   extent = world span the clouds must cover (union of cells); center =
   *   world-space middle of that span. Defaults to a single origin-centred cell.
   */
  applyParams(params, maxHeight, boardSize, perf, layout = {}) {
    this._boardSize = boardSize || this._boardSize;
    // Coverage tracks the whole tile assembly; feature size stays per-cell so a
    // slider value keeps the same look as the assembly grows.
    const extent = layout.extent || this._boardSize;
    const cx = layout.center?.x ?? 0;
    const cz = layout.center?.z ?? 0;
    this._coverSize = extent;
    this._center = { x: cx, z: cz };

    const config = perf ? { ...params, ...perf } : params;
    const q = resolveCloudQuality(config);
    this._enabled = !!params.cloudsEnabled && !q.disabled;

    const maxDistMult = config.cloudMaxDistance ?? 6;
    this._maxDistance = maxDistMult * extent;

    const u = this.material.uniforms;
    // Altitude is an ABSOLUTE world height (y=0 is the ground/sea base), so the
    // layer can sit anywhere from ground level up — not pinned above the peaks.
    const bottom = params.cloudAltitude ?? 240;
    const thickness = Math.max(20, params.cloudThickness ?? 620);
    const top = bottom + thickness;
    u.uCloudBottom.value = bottom;
    u.uCloudTop.value = top;

    const radius = extent * 0.62;
    u.uCloudRadius.value = radius;
    u.uCloudFar.value = extent * 4.0;   // bound horizon marching
    u.uCloudCenter.value.set(cx, 0, cz);

    // occupancy grid maps the square [center ± radius] (clouds are zero past it)
    u.uOccCenter.value.set(cx, cz);
    u.uOccExtent.value = radius;

    // size + place the enclosing box: horizontal extent just past the radial
    // fade (clouds are zero beyond uCloudRadius), height = slab thickness with a
    // hair of margin so the bottom/top planes sit inside the box faces.
    const horiz = radius * 2.1;
    const height = Math.max(1, (top - bottom) * 1.04);
    this.mesh.scale.set(horiz, height, horiz);
    this.mesh.position.set(cx, (bottom + top) * 0.5, cz);

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
    this._stepLOD = q.stepLOD;
    if (!this._stepLOD) u.uCloudStepScale.value = 1.0;

    // low-res cloud render + depth-aware upscale (perf). scale 1.0 = off.
    const lowResScale = config.cloudRenderScale ?? 1.0;
    this._lowRes = lowResScale < 0.999 && !q.disabled;
    this._lowResPass.scale = Math.max(0.25, Math.min(1.0, lowResScale));
    this._lowResPass.setMeshLayer(this.mesh, this._lowRes);

    if (params.cloudColor) u.uCloudColor.value.setRGB(...params.cloudColor);
    if (params.cloudShadowColor) u.uCloudShadowColor.value.setRGB(...params.cloudShadowColor);

    // Wind drift in NOISE-SPACE units/sec (not world units): the pattern lives in
    // baseP = q*uCloudScale + drift, so a drift of ~uCloudScale crosses the whole
    // board. Keeping it board-independent (no fScale) means clouds traverse the
    // visible area in a consistent time at any board size — and, crucially, makes
    // the drift the same order as the evolution so clouds actually MOVE across the
    // sky instead of only morphing in place. The old `0.6 * fScale` was ~100×
    // weaker, so the motion read as static.
    const wa = (params.cloudWindDir ?? 45) * Math.PI / 180;
    const wspeed = (params.cloudWindSpeed ?? 1.0) * 0.045;
    this._wind.set(Math.cos(wa), 0, Math.sin(wa)).multiplyScalar(wspeed);
    u.uCloudWind.value.copy(this._wind);

    this._rotSpeed = (params.cloudRotationSpeed ?? 0.35) * 0.01;

    // evolution rate in noise-space units/sec (form/morph/dissipate in place)
    u.uCloudEvolve.value = (params.cloudEvolveSpeed ?? 1.0) * 0.03;

    // recompile if the step counts or noise settings changed (quality / fallback)
    // We check and rebuild at the end so _rebuildMaterial can copy the fully updated uniforms to the new material.
    const needsRebuild = q.steps !== this._steps ||
        q.lightSteps !== this._lightSteps ||
        q.octaves !== this._octaves ||
        q.detailOctaves !== this._detailOctaves ||
        q.useErosion !== this._useErosion ||
        q.lightMode !== this._lightMode;
    if (needsRebuild) {
      this._rebuildMaterial(q.steps, q.lightSteps, q.octaves, q.detailOctaves, q.useErosion, q.lightMode);
    }

    // warm the program in the background on first enable (no first-frame hang)
    if (this._enabled && !this._ready && !this._warming && this._compile) {
      this._compileCurrentMaterial();
    }
  }

  // Compile a material in the background without touching the _ready/_warming
  // gate (used for live rebuilds, where the OLD material stays visible until the
  // new program is ready). Returns a token to detect superseding rebuilds.
  _compileMaterial(material) {
    const token = ++this._compileToken;
    if (!this._compile) return { token, promise: Promise.resolve() };

    let promise;
    try {
      promise = Promise.resolve(this._compile([material]));
    } catch (e) {
      promise = Promise.reject(e);
    }

    const done = promise.catch(() => {});
    this._pendingCompile = { material, promise: done };
    done.finally(() => {
      if (this._pendingCompile?.promise === done) this._pendingCompile = null;
    });

    return { token, promise: done };
  }

  // Warm the CURRENT material and flip the _ready gate when done (first-enable
  // path — clouds stay hidden until the very first program is compiled so there
  // is no first-frame FXC hang).
  _compileCurrentMaterial() {
    if (!this._compile) {
      this._ready = true;
      this._warming = false;
      return Promise.resolve();
    }

    const material = this.material;
    this._ready = false;
    this._warming = true;
    const { token, promise } = this._compileMaterial(material);

    promise.then(() => {
      if (token === this._compileToken && this.material === material) {
        this._ready = true;
        this._warming = false;
      }
    });

    return promise;
  }

  _disposeWhenSafe(material, pending) {
    if (!material) return;
    if (pending) pending.finally(() => material.dispose());
    else material.dispose();
  }

  /** Point the current material at the occupancy texture (after create/rebuild). */
  _applyOccupancyUniforms() {
    const u = this.material.uniforms;
    if (u.uCloudOccupancy) u.uCloudOccupancy.value = this._occTex;
  }

  /** Rebuild the planar occupancy grid from the current field params (cheap,
   *  throttled by the caller). */
  _rebuildOccupancy() {
    const u = this.material.uniforms;
    const w = u.uCloudWind.value;
    buildOccupancyPlanar(
      this._occData, OCC_SIZE,
      u.uOccCenter.value.x, u.uOccCenter.value.y, u.uOccExtent.value,
      u.uCloudBottom.value, u.uCloudTop.value,
      {
        scale: u.uCloudScale.value,
        windX: w.x, windY: w.y, windZ: w.z,
        time: u.uCloudTime.value,
        rotation: u.uCloudRotation.value,
        coverage: u.uCloudCoverage.value,
        softness: u.uCloudSoftness.value,
        octaves: this._octaves,
        evolve: u.uCloudEvolve.value,
        // conservative upper-bound margin for the detail noise the GPU adds
        boost: (u.uCloudDetailStrength.value || 0) + 0.12,
      }
    );
    this._occTex.needsUpdate = true;
    u.uUseOccupancy.value = 1.0;
  }

  _rebuildMaterial(steps, lightSteps, octaves, detailOctaves, useErosion, lightMode = this._lightMode) {
    this._steps = steps;
    this._lightSteps = lightSteps;
    this._octaves = octaves;
    this._detailOctaves = detailOctaves;
    this._useErosion = useErosion;
    this._lightMode = lightMode;
    const previous = this.material;
    const pendingPrevious = this._pendingCompile?.material === previous
      ? this._pendingCompile.promise
      : null;
    const next = createCloudSlabMaterial(
      steps,
      lightSteps,
      octaves,
      detailOctaves,
      useErosion,
      lightMode
    );
    const a = previous.uniforms, b = next.uniforms;
    for (const k in b) {
      if (!(k in a)) continue;
      const av = a[k].value, bv = b[k].value;
      if (av && av.copy && bv && bv.copy) bv.copy(av);
      else b[k].value = a[k].value;
    }

    if (!this._ready) {
      // First program not shown yet — swap now (nothing visible) and keep
      // warming; the _ready gate reveals the clouds once compiled.
      this.mesh.material = next;
      this.material = next;
      this.mesh.visible = false;
      this._disposeWhenSafe(previous, pendingPrevious);
      this._compileCurrentMaterial();
      return;
    }

    // Clouds are already on screen: compile the new program in the BACKGROUND
    // and keep the old material rendering until it's ready, then swap with no
    // flicker (mirrors PlanetCloudLayer). Changing raymarch steps no longer
    // makes the clouds vanish.
    const { token, promise } = this._compileMaterial(next);
    promise.then(() => {
      if (token !== this._compileToken || this.material !== previous) {
        next.dispose();
        return;
      }
      this.mesh.material = next;
      this.material = next;
      this._applyOccupancyUniforms();
      this._disposeWhenSafe(previous, pendingPrevious);
    });
  }

  update(dt, cameraPos, sunDir) {
    if (!this._enabled || !this._inScene || !this._ready) {
      if (this.mesh.visible) this.mesh.visible = false;
      return;
    }
    const c = this._center || { x: 0, z: 0 };
    const dist = Math.hypot(cameraPos.x - c.x, cameraPos.y, cameraPos.z - c.z);
    this._inRange = dist <= this._maxDistance;
    this.mesh.visible = this._inRange;
    if (!this._inRange) return;

    const u = this.material.uniforms;
    // step-LOD: ramp the effective march steps down to 0.4 toward the cull edge
    if (this._stepLOD && Number.isFinite(this._maxDistance)) {
      const near = this._coverSize || this._boardSize;
      const far = this._maxDistance;
      const f = far > near ? (dist - near) / (far - near) : 0;
      u.uCloudStepScale.value = Math.max(0.4, Math.min(1.0, 1.0 - f * 0.6));
    }
    u.uCloudTime.value += dt;
    this._rotation += dt * (this._rotSpeed || 0);
    u.uCloudRotation.value = this._rotation;
    if (sunDir) u.uCloudSunDir.value.copy(sunDir);

    // refresh the empty-space-skip occupancy grid on a throttle
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - this._occBuiltAt > 150) {
      this._occBuiltAt = now;
      this._rebuildOccupancy();
    }
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

  /** True while low-res cloud mode is active (mesh lives on the offscreen layer
   *  and is composited rather than drawn inline). The engine uses this to know
   *  it must call compositeLowRes after the main render. */
  get usesLowRes() {
    return this._lowRes && this.active;
  }

  /** Render the clouds into the low-res target (call after renderDepthPrepass,
   *  before the main scene render). Returns true if it ran. */
  renderLowRes(renderer, camera) {
    if (!this.usesLowRes) return false;
    this._lowResPass.renderCloud(renderer, this.scene, camera, this.mesh);
    return true;
  }

  /** Composite the low-res clouds over the current target (call after the main
   *  scene render). */
  compositeLowRes(renderer) {
    if (!this.usesLowRes) return;
    this._lowResPass.composite(renderer, this._depthTexture);
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
    if (this._occTex) { this._occTex.dispose(); this._occTex = null; }
    if (this._lowResPass) { this._lowResPass.dispose(); this._lowResPass = null; }
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh = null;
    this.material = null;
  }
}
