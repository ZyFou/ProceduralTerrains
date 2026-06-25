import * as THREE from 'three';
import { createCloudMaterial } from './CloudVolumeShader.js';
import { resolveCloudNoiseVariant, resolveCloudQuality } from './CloudSettings.js';
import { buildOccupancyOctahedral } from './cloudFieldCPU.js';
import { CloudLowResPass } from './CloudLowResPass.js';

// Resolution of the directional occupancy grid (octahedral). Low-res + dilated
// is enough: it only needs to say "this column has some cloud" so the shader can
// skip the expensive density over empty sky.
const OCC_SIZE = 48;

// The cloud altitude/thickness defaults (and the slider ranges) were tuned for
// the default planet radius. They're world-unit offsets, so on a much smaller
// planet they'd dominate and the cloud shell would balloon far above the
// surface (looking like a second, larger planet). Scale them by the radius
// ratio so the shell stays proportional at any planet size.
const REFERENCE_PLANET_RADIUS = 16000;

// ============================================================================
// PlanetCloudLayer: planet-side manager for the volumetric cloud shell. Owns
// one sphere mesh (sized to the OUTER cloud radius) + the cloud material, and
// keeps everything in sync with the planet radius, the cloud params, the sun
// direction and the animation clock.
//
// The mesh only defines the render area; the visible volume comes from the
// material's raymarch. The layer is fully self-contained — creating/destroying
// it never touches the planet world, water shell, LOD or export logic.
//
// Quality (raymarch step count) is a compile-time #define, so changing it
// rebuilds the material. The caller can pass an async compile hook so the swap
// happens in the background with no frame hang (mirrors the terrain octave
// recompile path in Engine).
// ============================================================================

export class PlanetCloudLayer {
  /**
   * @param {THREE.Scene} scene
   * @param {object} opts
   * @param {number} opts.planetRadius
   * @param {(mats: THREE.Material[]) => Promise<void>} [opts.compile] background warmup hook
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.planetRadius = opts.planetRadius || 16000;
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
    this._inRange = true;
    this._maxDistance = Infinity;
    this._rotation = 0;
    this._wind = new THREE.Vector3();
    this._lastParams = null;
    this._compileToken = 0;
    this._pendingCompile = null;

    // scene-depth prepass (terrain occlusion of the clouds, like the studio slab)
    this._depthTarget = null;
    this._depthTexture = null;
    this._depthSize = new THREE.Vector2();
    this._prevClearColor = new THREE.Color();

    // directional occupancy grid (empty-space-skip acceleration; rebuilt on a
    // throttle since wind/rotation drift the field slowly)
    this._occData = new Uint8Array(OCC_SIZE * OCC_SIZE);
    this._occTex = new THREE.DataTexture(this._occData, OCC_SIZE, OCC_SIZE, THREE.RedFormat, THREE.UnsignedByteType);
    this._occTex.minFilter = THREE.LinearFilter;
    this._occTex.magFilter = THREE.LinearFilter;
    this._occTex.generateMipmaps = false;
    this._occTex.needsUpdate = true;
    this._occBuiltAt = 0;

    this.material = createCloudMaterial(this._steps, this._lightSteps, this._octaves, this._detailOctaves, this._useErosion, this._lightMode);
    this._applyOccupancyUniforms();
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;        // after terrain (default) + water (10)
    this.mesh.visible = false;
    this.scene.add(this.mesh);
  }

  /** True when clouds are enabled, in range, and not in the 'off' fallback. */
  get active() {
    return this._enabled && this._inRange;
  }

  /**
   * Push the full cloud param set into the layer. Cheap and idempotent — call
   * it whenever a cloud param changes or the planet radius changes.
   * @param {object} params engine params (with cloud* keys)
   * @param {number} planetRadius
   * @param {object} [perf] centralized performance settings
   */
  applyParams(params, planetRadius, perf) {
    this.planetRadius = planetRadius || this.planetRadius;
    this._lastParams = params;

    const config = perf ? { ...params, ...perf } : params;
    const q = resolveCloudQuality(config);
    this._enabled = !!params.cloudsEnabled && !q.disabled;

    const maxDistMult = config.cloudMaxDistance ?? 6;
    this._maxDistance = maxDistMult * this.planetRadius;

    const u = this.material.uniforms;
    const r = this.planetRadius;
    // keep the shell proportional to planet size (see REFERENCE_PLANET_RADIUS)
    const radiusScale = r / REFERENCE_PLANET_RADIUS;
    const inner = r + (params.cloudAltitude ?? 240) * radiusScale;
    const outer = inner + Math.max(20, (params.cloudThickness ?? 620) * radiusScale);
    u.uCloudInner.value = inner;
    u.uCloudOuter.value = outer;

    // size the shell mesh to the outer radius (+ a hair so back faces never
    // clip the analytic outer sphere at grazing angles)
    this.mesh.scale.setScalar(outer * 1.001);

    // frequencies are user-relative; scale by radius so a given slider value
    // means the same world-size feature on any planet size.
    const fScale = 1.0 / r;
    u.uCloudScale.value = (params.cloudScale ?? 2.2) * fScale;
    u.uCloudDetailScale.value = (params.cloudDetailScale ?? 7.0) * fScale;
    u.uCloudErosionScale.value = (params.cloudErosionScale ?? 15.0) * fScale;
    u.uCloudDetailStrength.value = params.cloudDetailStrength ?? 0.35;
    u.uCloudErosionStrength.value = params.cloudErosionStrength ?? 0.30;

    u.uCloudCoverage.value = params.cloudCoverage ?? 0.5;
    u.uCloudSoftness.value = Math.max(0.01, params.cloudSoftness ?? 0.16);

    // optical-depth gain folds in the density slider, normalized by thickness
    // so density behaves consistently across shell sizes.
    const thickness = outer - inner;
    u.uCloudExtinction.value = (params.cloudDensity ?? 1.0) * 8.0 / Math.max(thickness, 1);
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

    // wind drift vector in the XZ plane (heading in degrees), scaled by speed.
    // NOISE-SPACE units/sec (not world units, no fScale): drift lives in baseP =
    // q*uCloudScale + drift, so this is radius-independent and the same order as
    // the evolution, making clouds actually traverse the sky rather than only
    // morph in place. (The planet also drifts via uCloudRotation.) The old
    // `0.6 * fScale` was ~100× weaker and read as static.
    const wa = (params.cloudWindDir ?? 45) * Math.PI / 180;
    const wspeed = (params.cloudWindSpeed ?? 1.0) * 0.045;
    this._wind.set(Math.cos(wa), 0, Math.sin(wa)).multiplyScalar(wspeed);
    u.uCloudWind.value.copy(this._wind);

    this._rotSpeed = (params.cloudRotationSpeed ?? 0.35) * 0.01;

    // evolution rate in noise-space units/sec (radius-independent — it scrolls
    // the noise domain, not world space). Drives the form/morph/dissipate motion.
    u.uCloudEvolve.value = (params.cloudEvolveSpeed ?? 1.0) * 0.03;

    // recompile if the step counts or noise settings changed (quality / fallback)
    // We check and rebuild at the end so _rebuildMaterial can copy the fully updated uniforms to the new material.
    if (q.steps !== this._steps ||
        q.lightSteps !== this._lightSteps ||
        q.octaves !== this._octaves ||
        q.detailOctaves !== this._detailOctaves ||
        q.useErosion !== this._useErosion ||
        q.lightMode !== this._lightMode) {
      this._rebuildMaterial(q.steps, q.lightSteps, q.octaves, q.detailOctaves, q.useErosion, q.lightMode);
    }
  }

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

  _compileCurrentMaterial() {
    return this._compileMaterial(this.material).promise;
  }

  warmup() {
    // If a material rebuild is already compiling (e.g. perf settings applied a
    // non-default quality/light mode before warmup ran), defer to it. Starting
    // a fresh compile here would bump _compileToken and make the rebuild's
    // deferred swap bail, discarding the just-built material.
    if (this._pendingCompile) return this._pendingCompile.promise;
    return this._compileCurrentMaterial();
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

  /** Rebuild the directional occupancy grid from the current field params. Cheap
   *  (one FBM sample per texel of a 48² map) and throttled by the caller. */
  _rebuildOccupancy() {
    const u = this.material.uniforms;
    const inner = u.uCloudInner.value, outer = u.uCloudOuter.value;
    const w = u.uCloudWind.value;
    buildOccupancyOctahedral(this._occData, OCC_SIZE, inner, outer, {
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
    });
    this._occTex.needsUpdate = true;
    u.uUseOccupancy.value = 1.0;
  }

  /** Swap the cloud material for a new step count (compile-time #define). */
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
    const next = createCloudMaterial(steps, lightSteps, octaves, detailOctaves, useErosion, lightMode);
    // carry over current uniform values
    const a = previous.uniforms, b = next.uniforms;
    for (const k in b) {
      if (!(k in a)) continue;
      const av = a[k].value, bv = b[k].value;
      if (av && av.copy && bv && bv.copy) bv.copy(av);
      else b[k].value = a[k].value;
    }
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

  /** Per-frame: advance animation, refresh sun + camera-distance culling. */
  update(dt, cameraPos, sunDir) {
    if (!this._enabled) {
      if (this.mesh.visible) this.mesh.visible = false;
      return;
    }
    // distance-based optimization: hide the (expensive) shell when far away
    const dist = cameraPos.length();   // planet centered at origin
    this._inRange = dist <= this._maxDistance;
    this.mesh.visible = this._inRange;
    if (!this._inRange) return;

    const u = this.material.uniforms;
    // step-LOD: full quality near the surface, ramping down to 0.4 at the cull
    // distance so distant frames cost far fewer marched samples.
    if (this._stepLOD && Number.isFinite(this._maxDistance)) {
      const near = this.planetRadius;
      const far = this._maxDistance;
      const f = far > near ? (dist - near) / (far - near) : 0;
      u.uCloudStepScale.value = Math.max(0.4, Math.min(1.0, 1.0 - f * 0.6));
    }
    u.uCloudTime.value += dt;
    this._rotation += dt * (this._rotSpeed || 0);
    u.uCloudRotation.value = this._rotation;
    if (sunDir) u.uCloudSunDir.value.copy(sunDir);

    // refresh the empty-space-skip occupancy grid on a throttle (the field drifts
    // slowly with wind/rotation; the dilation margin absorbs the lag)
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - this._occBuiltAt > 150) {
      this._occBuiltAt = now;
      this._rebuildOccupancy();
    }
  }

  /** Render the opaque scene depth (clouds hidden) so the cloud march can clamp
   *  to the terrain — fixes clouds showing through the surface up close. Mirrors
   *  CloudSlabLayer.renderDepthPrepass. Call once per frame before the main render. */
  renderDepthPrepass(renderer, camera) {
    if (!this.active) {
      this.material.uniforms.uUseDepth.value = 0.0;
      return false;
    }
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
    u.uUseDepth.value = 1.0;
    return true;
  }

  /** True while low-res cloud mode is active (mesh drawn offscreen + composited). */
  get usesLowRes() {
    return this._lowRes && this.active && this._inRange;
  }

  /** March the clouds into the low-res target (after renderDepthPrepass, before
   *  the main scene render). */
  renderLowRes(renderer, camera) {
    if (!this.usesLowRes) return false;
    this._lowResPass.renderCloud(renderer, this.scene, camera, this.mesh);
    return true;
  }

  /** Composite the low-res clouds over the current target (after the main render). */
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
