import * as THREE from 'three';
import { createCloudMaterial } from './CloudVolumeShader.js';
import { resolveCloudNoiseVariant, resolveCloudQuality } from './CloudSettings.js';

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

    this._steps = 64;
    this._lightSteps = 6;
    this._octaves = 5;
    this._detailOctaves = 4;
    this._useErosion = true;
    this._enabled = false;
    this._inRange = true;
    this._maxDistance = Infinity;
    this._rotation = 0;
    this._wind = new THREE.Vector3();
    this._lastParams = null;
    this._compileToken = 0;
    this._pendingCompile = null;

    this.material = createCloudMaterial(this._steps, this._lightSteps, this._octaves, this._detailOctaves, this._useErosion);
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
    const inner = r + (params.cloudAltitude ?? 240);
    const outer = inner + Math.max(20, params.cloudThickness ?? 620);
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

    if (params.cloudColor) u.uCloudColor.value.setRGB(...params.cloudColor);
    if (params.cloudShadowColor) u.uCloudShadowColor.value.setRGB(...params.cloudShadowColor);

    // wind drift vector in the XZ plane (heading in degrees), scaled by speed
    const wa = (params.cloudWindDir ?? 45) * Math.PI / 180;
    const wspeed = (params.cloudWindSpeed ?? 1.0) * 0.6 * fScale;
    this._wind.set(Math.cos(wa), 0, Math.sin(wa)).multiplyScalar(wspeed);
    u.uCloudWind.value.copy(this._wind);

    this._rotSpeed = (params.cloudRotationSpeed ?? 0.35) * 0.01;

    // recompile if the step counts or noise settings changed (quality / fallback)
    // We check and rebuild at the end so _rebuildMaterial can copy the fully updated uniforms to the new material.
    if (q.steps !== this._steps ||
        q.lightSteps !== this._lightSteps ||
        q.octaves !== this._octaves ||
        q.detailOctaves !== this._detailOctaves ||
        q.useErosion !== this._useErosion) {
      this._rebuildMaterial(q.steps, q.lightSteps, q.octaves, q.detailOctaves, q.useErosion);
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
    return this._compileCurrentMaterial();
  }

  _disposeWhenSafe(material, pending) {
    if (!material) return;
    if (pending) pending.finally(() => material.dispose());
    else material.dispose();
  }

  /** Swap the cloud material for a new step count (compile-time #define). */
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
    const next = createCloudMaterial(steps, lightSteps, octaves, detailOctaves, useErosion);
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
    u.uCloudTime.value += dt;
    this._rotation += dt * (this._rotSpeed || 0);
    u.uCloudRotation.value = this._rotation;
    if (sunDir) u.uCloudSunDir.value.copy(sunDir);
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh = null;
    this.material = null;
  }
}
