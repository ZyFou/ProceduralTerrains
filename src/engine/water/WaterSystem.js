import * as THREE from 'three';
import { createWaterMaterial, createInfiniteWaterMaterial, rebuildWaterShaderSource } from '../terrain/WaterMaterial.js';
import { rebuildRealisticWaterShaderSource } from './RealisticWaterMaterial.js';
import {
  resolveEffectiveWaterMode,
  isRealisticWaterMode,
  isWaterActive,
  migrateWaterParams,
} from './WaterSettings.js';
import { applyWaterPreset, resetWaterSettings } from './WaterPresets.js';
import {
  createWaterMaterialForMode,
  applyWaterMaterialSettings,
} from './WaterMaterialFactory.js';
import { applyWaterDebugToMaterials } from './WaterDebugViews.js';
import { buildWaterMaskFiles, buildWaterMetadata } from './WaterExport.js';
import { isSceneRefractionMode, WaterSurfacePass } from './WaterSurfacePass.js';
import {
  isPlanarReflectionMode,
  WaterPlanarReflectionPass,
} from './WaterPlanarReflectionPass.js';
import {
  createCinematicWaterGeometry,
  getWaterGeometryDiagnostics,
  resolveCinematicWaterSegments,
  shouldUseCinematicWaterGeometry,
} from './CinematicWaterGeometry.js';

// ============================================================================
// WaterSystem — central controller for the scalable water pipeline.
// Manages renderer switching, uniform updates, visibility, and cleanup.
// ============================================================================

export class WaterSystem {
  constructor(engine) {
    this.engine = engine;
    this._effectiveMode = 'legacy';
    this._usingRealistic = false;
    this._boundsHelper = null;
    this._fpsDowngraded = false;
    this._fpsBelowSince = 0;
    this._fpsAboveSince = 0;
    this._lastFpsTierChangeAt = -Infinity;
    this._disposed = false;
    this._waterCompileGen = 0;
    this._waterCompilePending = false;
    this._waterCompileRetryTimer = null;
    this._waterCompileRetryCount = 0;
    this._waterCompileFailed = false;
    this._surfacePass = new WaterSurfacePass();
    this._planarReflectionPass = new WaterPlanarReflectionPass();
    this._baseStudioGeometry = engine.water?.geometry ?? null;
    this._cinematicGeometry = null;
    this._cinematicSegments = 0;
    this._geometryFocusAnchored = false;
    this._surfaceSubmitStarted = 0;
    this._surfaceSubmitMs = 0;
    this._surfaceSubmitAvgMs = 0;
    this._timedMeshes = new Map();
    this._bindSurfaceTiming(engine.water);

    // Owned transition materials. The legacy Infinite fallback is private and
    // exists only while a realistic replacement is compiling.
    this._realisticStudio = null;
    this._realisticInfinite = null;
    this._realisticInfiniteHeightSig = null;
    this._realisticInfiniteHeightProgram = null;
    this._legacyInfiniteFallback = null;
    this._realisticAttached = false;
  }

  /** Call once after engine scene + water meshes exist. */
  init() {
    this.prepareInitialMaterials(this.engine.params, this.engine.worldMode);
    this.activateInitialMaterials(this.engine.params, this.engine.worldMode);
  }

  /**
   * Create only the material needed by the current effective mode. Boot calls
   * this before compiling so a saved realistic preset never pays to compile
   * the legacy shader first merely as a temporary fallback.
   */
  prepareInitialMaterials(params = this.engine.params, worldMode = this.engine.worldMode) {
    const eng = this.engine;
    const octaves = Math.round(eng.params.octaves);
    this._effectiveMode = resolveEffectiveWaterMode(params, worldMode);
    this._usingRealistic = isRealisticWaterMode(this._effectiveMode);

    if (this._usingRealistic) {
      if (worldMode === 'infinite') {
        this._ensureRealisticInfinite(octaves);
        return [this._realisticInfinite];
      }
      this._ensureRealisticStudio(octaves);
      return [this._realisticStudio];
    }

    if (worldMode === 'infinite') {
      this._ensureLegacyInfiniteMaterial(octaves);
      return [eng._infiniteWaterMat];
    }
    if (worldMode === 'planet') return [eng.planetWaterMat].filter(Boolean);
    return [eng.waterMaterial];
  }

  /** Attach a material only after its program has reported genuinely ready. */
  activateInitialMaterials(params = this.engine.params, worldMode = this.engine.worldMode) {
    const eng = this.engine;
    const p = params ?? eng.params;
    const debug = p.waterDebugView ?? 'off';

    this._waterCompilePending = false;
    this._waterCompileGen++;
    this._waterCompileRetryCount = 0;
    this._waterCompileFailed = false;
    if (this._usingRealistic) {
      this._attachRealisticMaterials(p, debug);
    } else {
      if (eng.water && eng.waterMaterial) eng.water.material = eng.waterMaterial;
      if (eng.infiniteWorld?.waterPlane && eng._infiniteWaterMat) {
        eng.infiniteWorld.waterPlane.material = eng._infiniteWaterMat;
        eng.infiniteWorld.waterMaterial = eng._infiniteWaterMat;
      }
      applyWaterMaterialSettings(eng.waterMaterial, p, 'legacy', 'off');
      applyWaterMaterialSettings(eng._infiniteWaterMat, p, 'legacy', 'off');
      applyWaterMaterialSettings(eng.planetWaterMat, p, 'legacy', 'off');
    }

    this._syncStudioGeometry(p, worldMode);
    this._applyVisibility(p, worldMode);
    this._applyUniforms(p);
    this._applyDebug(p);
    this._updateBoundsHelper(p);
    this.applyPerf(eng.perf);
  }

  migrateParams(params) {
    return migrateWaterParams(params);
  }

  applyPreset(presetKey) {
    return applyWaterPreset(this.engine.params, presetKey);
  }

  resetSettings() {
    return resetWaterSettings(this.engine.params);
  }

  getEffectiveMode() {
    return this._effectiveMode;
  }

  isEnabled() {
    return isWaterActive(this._effectiveMode, this.engine.params.seaLevel);
  }

  needsSceneRefraction() {
    return this._surfacePass.shouldCapture(
      this.engine.params,
      this._effectiveMode,
      this.engine.worldMode,
    );
  }

  /** Main settings sync — call from _applyUniforms and mode changes. */
  sync(params, worldMode) {
    if (worldMode !== 'infinite') this._disposeLegacyInfiniteFallback();
    const prevMode = this._effectiveMode;
    const prevRealistic = this._usingRealistic;
    this._effectiveMode = resolveEffectiveWaterMode(params, worldMode);
    this._usingRealistic = isRealisticWaterMode(this._effectiveMode);
    this._syncStudioGeometry(params, worldMode);

    if (prevMode !== this._effectiveMode || prevRealistic !== this._usingRealistic) {
      this._waterCompileRetryCount = 0;
      this._waterCompileFailed = false;
      if (!this._usingRealistic && prevRealistic) this._disposeRealistic();
      this._swapMaterials(params, worldMode);
      // Material swap may be async — uniforms for the active mesh are applied there.
      if (!this._waterCompilePending) {
        this._applyVisibility(params, worldMode);
        this._applyUniforms(params);
        this._applyDebug(params);
        this._updateBoundsHelper(params);
        this.applyPerf(this.engine.perf);
      }
      return;
    }

    this._applyVisibility(params, worldMode);
    this._applyUniforms(params);
    this._applyDebug(params);
    this._updateBoundsHelper(params);
    this.applyPerf(this.engine.perf);
  }

  applyPerf(perf) {
    const mats = this._allActiveMaterials();
    for (const mat of mats) {
      if (!mat?.uniforms) continue;
      if (mat.uniforms.uWaterQuality) mat.uniforms.uWaterQuality.value = perf.waterQuality;
      if (mat.uniforms.uWaterDetail) mat.uniforms.uWaterDetail.value = perf.waterDetail;
      if (mat.uniforms.uWaterReflection) {
        mat.uniforms.uWaterReflection.value = perf.waterReflection;
      }
      if (mat.uniforms.uWaveComplexity) mat.uniforms.uWaveComplexity.value = perf.waterWaves;
    }
    this._syncStudioGeometry(this.engine.params, this.engine.worldMode);
    this._maybeFpsDowngrade(perf);
  }

  /** Per-frame update — FPS downgrade + bounds helper. */
  update(fps, now = performance.now()) {
    this._maybeFpsDowngrade(this.engine.perf, fps, now);
  }

  /**
   * Capture the water-free scene and bind it to Volumetric/Cinematic water.
   * Allocation remains lazy; Realistic, Legacy, Off, and Planet modes only
   * execute the cheap uniform-disable path.
   */
  captureSceneRefraction(renderer, scene, camera, sceneSize, sourceTarget = null) {
    const eng = this.engine;
    const materials = [
      this._realisticStudio,
      this._realisticInfinite,
    ].filter(Boolean);
    return this._surfacePass.capture(renderer, scene, camera, {
      params: eng.params,
      mode: this._effectiveMode,
      worldMode: eng.worldMode,
      sceneSize,
      hiddenObjects: [
        eng.water,
        eng.infiniteWorld?.waterPlane,
        eng.planetWater,
        this._boundsHelper,
      ],
      materials,
      sourceTarget,
    });
  }

  getRefractionDiagnostics() {
    return this._surfacePass.diagnostics();
  }

  /**
   * Capture the mirrored above-water scene for Cinematic mode. Infinite World
   * never reaches this path while its automatic quality safeguard is enabled.
   */
  capturePlanarReflection(renderer, scene, camera, sceneSize, revision = null) {
    const eng = this.engine;
    const materials = [
      this._realisticStudio,
      this._realisticInfinite,
    ].filter(Boolean);
    return this._planarReflectionPass.capture(renderer, scene, camera, {
      params: eng.params,
      mode: this._effectiveMode,
      worldMode: eng.worldMode,
      sceneSize,
      hiddenObjects: [
        eng.water,
        eng.infiniteWorld?.waterPlane,
        eng.planetWater,
        this._boundsHelper,
      ],
      materials,
      enabled: !this._fpsDowngraded,
      revision,
    });
  }

  getPlanarReflectionDiagnostics() {
    return this._planarReflectionPass.diagnostics();
  }

  getSurfaceDiagnostics() {
    return {
      ...getWaterGeometryDiagnostics(this.engine.water?.geometry),
      displaced: !!(
        this._cinematicGeometry
        && this.engine.water?.geometry === this._cinematicGeometry
        && !this._fpsDowngraded
      ),
      cameraFocused: !!this._cinematicGeometry,
      focusAnchored: this._geometryFocusAnchored,
      surfaceSubmitMs: this._surfaceSubmitMs,
      surfaceSubmitAvgMs: this._surfaceSubmitAvgMs,
      surfaceGpuMs: null,
      gpuTimingScope: 'whole-frame-only',
    };
  }

  getPerformanceDiagnostics() {
    const refraction = this.getRefractionDiagnostics();
    const reflection = this.getPlanarReflectionDiagnostics();
    const surface = this.getSurfaceDiagnostics();
    return {
      surface,
      refraction,
      reflection,
      renderTargetMemoryBytes:
        (refraction.memoryBytes || 0) + (reflection.memoryBytes || 0),
      additionalSceneRenders:
        (refraction.additionalSceneRenders || 0)
        + (reflection.additionalSceneRenders || 0),
    };
  }

  onStackRebuilt(stackGLSL, octaves) {
    const eng = this.engine;
    if (this._realisticStudio) {
      rebuildRealisticWaterShaderSource(this._realisticStudio, stackGLSL);
      this._realisticStudio.defines ||= {};
      this._realisticStudio.defines.OCTAVES = octaves;
      this._realisticStudio.needsUpdate = true;
    }
    // Infinite World always uses the Classic stack. Studio Nodes may call this
    // hook with graph-only GLSL while an Infinite realistic material is retained
    // across mode teardown, so never publish that graph source into this cache.
    const infiniteStack = eng._stackGLSL ?? stackGLSL;
    const infiniteOctaves = Math.round(eng.params?.octaves ?? octaves);
    if (this._realisticInfinite) {
      this._syncRealisticInfiniteHeightSource(infiniteStack, infiniteOctaves);
    }
    // Rebuild every live legacy Infinite material, including the private
    // transition fallback when the realistic shader is still linking.
    const legacyInfiniteMaterials = new Set([
      this._legacyInfiniteFallback,
      eng._infiniteWaterMat,
    ]);
    for (const material of legacyInfiniteMaterials) {
      if (!material
          || material === this._realisticStudio
          || material === this._realisticInfinite) continue;
      rebuildWaterShaderSource(material, infiniteStack);
      material.defines.OCTAVES = infiniteOctaves;
      material.needsUpdate = true;
    }
    if (eng.planetWaterMat) {
      // planet water rebuild handled by engine planet rebuild path
    }
  }

  /**
   * Build a disposable Infinite-water clone matching the currently requested
   * renderer. Engine uses it to warm the exact realistic program before the
   * live source swap; legacy water is warmed directly by Engine.
   */
  createInfiniteStackWarmMaterial(stackGLSL, octaves) {
    if (!this._usingRealistic || !this._realisticInfinite) return null;
    return createWaterMaterialForMode({
      mode: this._effectiveMode,
      sharedUniforms: this.engine.uniforms,
      environmentUniforms: this.engine.proceduralSky?.uniforms,
      octaves,
      stackGLSL,
      infinite: true,
    });
  }

  /** Build a disposable Studio-water clone for an atomic terrain transition. */
  createStudioStackWarmMaterial(stackGLSL, octaves) {
    return createWaterMaterialForMode({
      mode: this._effectiveMode,
      sharedUniforms: this.engine.uniforms,
      environmentUniforms: this.engine.proceduralSky?.uniforms,
      octaves,
      stackGLSL,
      infinite: false,
      materialBackend: this.engine._materialBackend,
    });
  }

  /** Materials for shader warmup / compile lists. */
  getCompileMaterials() {
    const mats = [];
    if (this.engine.waterMaterial) mats.push(this.engine.waterMaterial);
    if (this.engine._infiniteWaterMat) mats.push(this.engine._infiniteWaterMat);
    if (this.engine.planetWaterMat) mats.push(this.engine.planetWaterMat);
    if (this._realisticStudio) mats.push(this._realisticStudio);
    if (this._realisticInfinite) mats.push(this._realisticInfinite);
    return mats;
  }

  getStudioMaterial() {
    return this._activeStudioMaterial();
  }

  getInfiniteMaterial() {
    return this._activeInfiniteMaterial();
  }

  /** Material most recently prepared for a mode, whether attached or not. */
  getRequestedMaterial(worldMode = this.engine.worldMode) {
    if (worldMode === 'planet') return this.engine.planetWaterMat;
    if (this._usingRealistic) {
      return worldMode === 'infinite'
        ? this._realisticInfinite
        : this._realisticStudio;
    }
    return worldMode === 'infinite'
      ? this.engine._infiniteWaterMat
      : this.engine.waterMaterial;
  }

  /** Replace infinite water material reference when entering infinite mode. */
  createInfiniteMaterial() {
    const eng = this.engine;
    const oct = Math.round(eng.params.octaves);
    const mode = resolveEffectiveWaterMode(eng.params, 'infinite');
    if (isRealisticWaterMode(mode)) {
      this._ensureRealisticInfinite(oct);
      return this._realisticInfinite;
    }
    return createWaterMaterialForMode({
      mode: 'legacy',
      sharedUniforms: eng.uniforms,
      octaves: oct,
      stackGLSL: eng._stackGLSL,
      infinite: true,
    });
  }

  /**
   * Build the requested water masks (and optional metadata) as a
   * { filename: Uint8Array } map for inclusion in the export zip. Lazily
   * creates the minimap sampler so masks work even before the minimap renders.
   */
  async exportMasks(options) {
    const eng = this.engine;
    const sampleHeight = (x, z) => {
      if (eng.heightSampler?.cpu) return eng.heightSampler.cpu.heightAt(x, z);
      return eng._getMinimapSampler().heightAt(x, z);
    };
    const size = Number(options.maskSize) || eng.boardSize || eng.params.chunkSize * eng.params.chunkCount;
    const origin = options.maskOrigin ?? { x: 0, z: 0 };
    const files = await buildWaterMaskFiles({
      sampleHeight,
      seaLevel: eng.params.seaLevel,
      size,
      origin,
      resolution: parseInt(options.maskRes ?? '512', 10),
      options: { ...options, waterMode: this._effectiveMode },
    });
    if (options.exportWaterMetadata) {
      files['water/water_metadata.json'] = new TextEncoder().encode(
        JSON.stringify(buildWaterMetadata(eng.params), null, 2),
      );
    }
    return files;
  }

  dispose() {
    this._disposed = true;
    if (this._waterCompileRetryTimer) {
      clearTimeout(this._waterCompileRetryTimer);
      this._waterCompileRetryTimer = null;
    }
    this._waterCompileGen++;
    this._waterCompilePending = false;
    this._surfacePass.dispose();
    this._planarReflectionPass.dispose();
    this._disposeCinematicGeometry();
    this._restoreSurfaceTiming();
    this._disposeRealistic();
    this._disposeLegacyInfiniteFallback();
    if (this._boundsHelper) {
      this.engine.scene.remove(this._boundsHelper);
      this._boundsHelper.geometry?.dispose();
      this._boundsHelper.material?.dispose();
      this._boundsHelper = null;
    }
  }

  // ---- internal ----

  _syncFromParams() {
    this.sync(this.engine.params, this.engine.worldMode);
  }

  _swapMaterials(params, worldMode) {
    const eng = this.engine;
    if (this._waterCompileRetryTimer) {
      clearTimeout(this._waterCompileRetryTimer);
      this._waterCompileRetryTimer = null;
    }
    const oct = Math.round(eng.params.octaves);
    const p = params ?? eng.params;
    const debug = p.waterDebugView ?? 'off';
    const wm = worldMode ?? eng.worldMode;

    if (this._usingRealistic) {
      this._ensureRealisticStudio(oct);
      if (wm === 'infinite') this._ensureRealisticInfinite(oct);

      const mats = [this._realisticStudio];
      if (this._realisticInfinite) mats.push(this._realisticInfinite);

      this._waterCompileGen++;
      const gen = this._waterCompileGen;
      const materialVersions = mats.map((material) => material?.version ?? 0);
      this._waterCompilePending = true;
      // Keep the cheap legacy plane visible while the requested realistic
      // material links. This matters on boot, where water was hidden until init.
      if (eng.water && eng.waterMaterial) {
        eng.water.material = eng.waterMaterial;
        applyWaterMaterialSettings(eng.waterMaterial, p, 'legacy', debug);
        applyWaterDebugToMaterials([eng.waterMaterial], debug);
      }
      if (wm === 'infinite') {
        this._ensureLegacyInfiniteMaterial(oct);
        if (eng.infiniteWorld?.waterPlane && eng._infiniteWaterMat) {
          eng.infiniteWorld.waterPlane.material = eng._infiniteWaterMat;
          eng.infiniteWorld.waterMaterial = eng._infiniteWaterMat;
          applyWaterMaterialSettings(eng._infiniteWaterMat, p, 'legacy', debug);
          applyWaterDebugToMaterials([eng._infiniteWaterMat], debug);
        }
      }
      this._applyVisibility(p, wm);
      this._updateBoundsHelper(p);
      this._realisticAttached = false;
      const compileJob = eng.compileWaterMaterialsAsync(mats, () => {
        if (this._disposed || gen !== this._waterCompileGen) return;
        const currentParams = eng.params;
        const currentWorldMode = eng.worldMode;
        const currentMode = resolveEffectiveWaterMode(
          currentParams,
          currentWorldMode,
        );
        const materialSourceIsCurrent = mats.every(
          (material, index) =>
            (material?.version ?? 0) === materialVersions[index],
        );
        if (!materialSourceIsCurrent
            || currentMode !== this._effectiveMode
            || currentWorldMode !== wm
            || !isRealisticWaterMode(currentMode)) {
          this._waterCompilePending = false;
          if (!materialSourceIsCurrent
              && currentMode === this._effectiveMode
              && isRealisticWaterMode(currentMode)) {
            this._swapMaterials(currentParams, currentWorldMode);
          } else {
            this.sync(currentParams, currentWorldMode);
          }
          return;
        }
        const currentDebug = currentParams.waterDebugView ?? 'off';
        this._waterCompilePending = false;
        this._waterCompileRetryCount = 0;
        this._waterCompileFailed = false;
        this._attachRealisticMaterials(currentParams, currentDebug);
        this._applyVisibility(currentParams, currentWorldMode);
        this._applyUniforms(currentParams);
        this._applyDebug(currentParams);
        this._updateBoundsHelper(currentParams);
        this.applyPerf(eng.perf);
        // Studio renders on demand. The settings change painted the legacy
        // fallback before this async callback ran, so explicitly request the
        // first frame that uses the newly attached realistic material.
        eng._needsRender = true;
      });
      Promise.resolve(compileJob).then((ready) => {
        if (this._disposed || gen !== this._waterCompileGen || ready !== false) return;
        this._waterCompilePending = false;
        this._realisticAttached = false;
        const currentParams = eng.params;
        const currentWorldMode = eng.worldMode;
        const currentDebug = currentParams.waterDebugView ?? 'off';
        if (eng.water && eng.waterMaterial) {
          eng.water.material = eng.waterMaterial;
          applyWaterMaterialSettings(
            eng.waterMaterial,
            currentParams,
            'legacy',
            currentDebug,
          );
        }
        if (currentWorldMode === 'infinite') {
          this._ensureLegacyInfiniteMaterial(Math.round(currentParams.octaves));
          if (eng.infiniteWorld?.waterPlane && eng._infiniteWaterMat) {
            eng.infiniteWorld.waterPlane.material = eng._infiniteWaterMat;
            eng.infiniteWorld.waterMaterial = eng._infiniteWaterMat;
            applyWaterMaterialSettings(
              eng._infiniteWaterMat,
              currentParams,
              'legacy',
              currentDebug,
            );
          }
        }
        this._applyVisibility(currentParams, currentWorldMode);
        this._waterCompileRetryCount++;
        if (this._waterCompileRetryCount >= 3) {
          // Keep the visible legacy material as a terminal degraded fallback.
          // A setting/mode change or a later successful compile resets this.
          this._waterCompileFailed = true;
          return;
        }
        if (!this._waterCompileRetryTimer
            && isRealisticWaterMode(resolveEffectiveWaterMode(
              currentParams,
              currentWorldMode,
            ))) {
          const delay = Math.min(
            15000,
            3000 * (2 ** Math.min(this._waterCompileRetryCount - 1, 2)),
          );
          this._waterCompileRetryTimer = setTimeout(() => {
            this._waterCompileRetryTimer = null;
            if (this._disposed) return;
            this._swapMaterials(eng.params, eng.worldMode);
          }, delay);
        }
      });
      return;
    }

    this._waterCompilePending = false;
    this._waterCompileRetryCount = 0;
    this._waterCompileFailed = false;
    this._realisticAttached = false;
    this._waterCompileGen++;
    this._ensureLegacyInfiniteMaterial(oct);
    if (eng.water && eng.waterMaterial) eng.water.material = eng.waterMaterial;
    if (eng.infiniteWorld?.waterPlane && eng._infiniteWaterMat) {
      eng.infiniteWorld.waterPlane.material = eng._infiniteWaterMat;
      eng.infiniteWorld.waterMaterial = eng._infiniteWaterMat;
    }
    applyWaterMaterialSettings(eng.waterMaterial, p, 'legacy', 'off');
    applyWaterMaterialSettings(eng._infiniteWaterMat, p, 'legacy', 'off');
    applyWaterMaterialSettings(eng.planetWaterMat, p, 'legacy', 'off');
  }

  _attachRealisticMaterials(p, debug) {
    const eng = this.engine;
    if (eng.water) eng.water.material = this._realisticStudio;
    if (eng.infiniteWorld?.waterPlane && this._realisticInfinite) {
      eng.infiniteWorld.waterPlane.material = this._realisticInfinite;
      eng.infiniteWorld.waterMaterial = this._realisticInfinite;
    }
    eng._infiniteWaterMat = this._realisticInfinite ?? eng._infiniteWaterMat;
    // A legacy material may have stayed visible while the realistic program
    // linked. The atomic attachment above releases its final references.
    this._disposeLegacyInfiniteFallback();
    this._realisticAttached = true;
    applyWaterMaterialSettings(this._realisticStudio, p, this._effectiveMode, debug);
    if (this._realisticInfinite) {
      applyWaterMaterialSettings(this._realisticInfinite, p, this._effectiveMode, debug);
    }
  }

  /** Recreate or reattach the owned legacy Infinite transition fallback. */
  _ensureLegacyInfiniteMaterial(octaves) {
    const eng = this.engine;
    const current = eng._infiniteWaterMat;
    if (current && !this.ownsMaterial(current)) return current;
    if (this._legacyInfiniteFallback) {
      eng._infiniteWaterMat = this._legacyInfiniteFallback;
      return this._legacyInfiniteFallback;
    }
    this._legacyInfiniteFallback = createWaterMaterialForMode({
      mode: 'legacy',
      sharedUniforms: eng.uniforms,
      octaves,
      stackGLSL: eng._stackGLSL,
      infinite: true,
    });
    eng._infiniteWaterMat = this._legacyInfiniteFallback;
    return this._legacyInfiniteFallback;
  }

  _disposeLegacyInfiniteFallback() {
    const fallback = this._legacyInfiniteFallback;
    if (!fallback) return;
    const eng = this.engine;
    if (eng.infiniteWorld?.waterPlane?.material === fallback) {
      eng.infiniteWorld.waterPlane.material = null;
    }
    if (eng.infiniteWorld?.waterMaterial === fallback) {
      eng.infiniteWorld.waterMaterial = null;
    }
    if (eng._infiniteWaterMat === fallback) eng._infiniteWaterMat = null;
    fallback.dispose();
    this._legacyInfiniteFallback = null;
  }

  _ensureRealisticStudio(octaves) {
    if (this._realisticStudio) return;
    const eng = this.engine;
    this._realisticStudio = createWaterMaterialForMode({
      mode: this._effectiveMode,
      sharedUniforms: eng.uniforms,
      environmentUniforms: eng.proceduralSky?.uniforms,
      octaves,
      stackGLSL: eng._stackGLSL,
      infinite: false,
      materialBackend: eng._materialBackend,
    });
  }

  _ensureRealisticInfinite(octaves) {
    const eng = this.engine;
    if (this._realisticInfinite) {
      this._syncRealisticInfiniteHeightSource(eng._stackGLSL, octaves);
      return;
    }
    this._realisticInfinite = createWaterMaterialForMode({
      mode: this._effectiveMode,
      sharedUniforms: eng.uniforms,
      environmentUniforms: eng.proceduralSky?.uniforms,
      octaves,
      stackGLSL: eng._stackGLSL,
      infinite: true,
    });
    this._realisticInfiniteHeightSig = eng._stackGLSL?.heightSig
      || eng._stackGLSL?.sig
      || null;
    this._realisticInfiniteHeightProgram = eng._stackGLSL ?? null;
  }

  _syncRealisticInfiniteHeightSource(stackGLSL, octaves) {
    const material = this._realisticInfinite;
    if (!material) return false;
    const sourceSig = stackGLSL?.heightSig || stackGLSL?.sig || null;
    const sourceMatches = sourceSig != null
      ? this._realisticInfiniteHeightSig === sourceSig
      : this._realisticInfiniteHeightProgram === stackGLSL;
    if (sourceMatches && material.defines?.OCTAVES === octaves) return false;
    rebuildRealisticWaterShaderSource(material, stackGLSL);
    material.defines ||= {};
    material.defines.OCTAVES = octaves;
    material.needsUpdate = true;
    this._realisticInfiniteHeightSig = sourceSig;
    this._realisticInfiniteHeightProgram = stackGLSL ?? null;
    return true;
  }

  _disposeRealistic() {
    const eng = this.engine;
    if (eng.water?.material === this._realisticStudio && eng.waterMaterial) {
      eng.water.material = eng.waterMaterial;
    }
    if (eng.infiniteWorld?.waterPlane?.material === this._realisticInfinite) {
      eng.infiniteWorld.waterPlane.material = null;
      eng.infiniteWorld.waterMaterial = null;
    }
    if (eng._infiniteWaterMat === this._realisticInfinite) {
      eng._infiniteWaterMat = null;
    }
    for (const mat of [this._realisticStudio, this._realisticInfinite]) {
      mat?.dispose();
    }
    this._realisticStudio = null;
    this._realisticInfinite = null;
    this._realisticInfiniteHeightSig = null;
    this._realisticInfiniteHeightProgram = null;
    this._realisticAttached = false;
  }

  _activeStudioMaterial() {
    return this._usingRealistic && this._realisticAttached
      ? this._realisticStudio
      : this.engine.waterMaterial;
  }

  _activeInfiniteMaterial() {
    return this._usingRealistic && this._realisticAttached
      ? this._realisticInfinite
      : this.engine._infiniteWaterMat;
  }

  _allActiveMaterials() {
    const mats = [];
    const studio = this._activeStudioMaterial();
    const inf = this._activeInfiniteMaterial();
    if (studio) mats.push(studio);
    if (inf && inf !== studio) mats.push(inf);
    if (this.engine.planetWaterMat) mats.push(this.engine.planetWaterMat);
    return mats;
  }

  _applyVisibility(params, worldMode) {
    const eng = this.engine;
    const active = isWaterActive(this._effectiveMode, params.seaLevel) && !eng._waterDeferred;
    const sea = params.seaLevel;

    if (eng.water) {
      eng.water.position.y = sea;
      eng.water.visible = active && worldMode === 'studio';
    }

    if (eng.infiniteWorld?.waterPlane) {
      this._bindSurfaceTiming(eng.infiniteWorld.waterPlane);
      eng.infiniteWorld.waterPlane.position.y = sea;
      eng.infiniteWorld.waterPlane.visible = active;
      eng.infiniteWorld.updateSettings?.({ seaLevel: sea });
      // updateSettings may force visible from sea level alone — respect water off
      eng.infiniteWorld.waterPlane.visible = active;
    }

    if (eng.planetWater) {
      eng.planetWater.visible = active && worldMode === 'planet';
      eng._updatePlanetWater?.();
    }
  }

  _applyUniforms(params) {
    const debug = params.waterDebugView ?? 'off';
    for (const mat of this._allActiveMaterials()) {
      applyWaterMaterialSettings(mat, params, this._effectiveMode, debug);
    }
    if (!isSceneRefractionMode(this._effectiveMode)) {
      this._surfacePass.deactivate([
        this._realisticStudio,
        this._realisticInfinite,
      ].filter(Boolean));
    }
    if (!isPlanarReflectionMode(this._effectiveMode)) {
      this._planarReflectionPass.deactivate([
        this._realisticStudio,
        this._realisticInfinite,
      ].filter(Boolean));
    }
    this._applyGeometryUniforms();

    // The underwater pass + caustics are driven centrally each frame by
    // Engine._updateUnderwater (UnderwaterController is the single source of
    // truth), so nothing to configure here on a settings change.
  }

  ownsMaterial(mat) {
    return mat === this._realisticStudio
      || mat === this._realisticInfinite
      || mat === this._legacyInfiniteFallback;
  }

  isMaterialTransitionPending() {
    return this._waterCompilePending;
  }

  isRequestedMaterialReady() {
    return !this._usingRealistic
      || this._realisticAttached
      || this._waterCompileFailed;
  }

  _applyDebug(params) {
    applyWaterDebugToMaterials(this._allActiveMaterials(), params.waterDebugView ?? 'off');
  }

  _updateBoundsHelper(params) {
    const eng = this.engine;
    const show = !!params.waterShowMeshBounds && this.isEnabled();
    if (!show) {
      if (this._boundsHelper) this._boundsHelper.visible = false;
      return;
    }
    if (!this._boundsHelper && eng.water) {
      this._boundsHelper = new THREE.BoxHelper(eng.water, 0x44aaff);
      this._boundsHelper.renderOrder = 99;
      eng.scene.add(this._boundsHelper);
    }
    if (this._boundsHelper) {
      this._boundsHelper.visible = true;
      const target = eng.worldMode === 'infinite'
        ? eng.infiniteWorld?.waterPlane
        : eng.worldMode === 'planet'
          ? eng.planetWater
          : eng.water;
      if (target) this._boundsHelper.setFromObject(target);
    }
  }

  _maybeFpsDowngrade(perf, fps = this.engine._fps, now = performance.now()) {
    const threshold = this.engine.params.waterDisableExpensiveBelowFps ?? 42;
    const restoreThreshold = Math.max(
      threshold + 8,
      this.engine.params.waterRestoreExpensiveAboveFps ?? threshold + 12,
    );
    const downgradeDelay = Math.max(0, this.engine.params.waterDowngradeDelayMs ?? 2500);
    const restoreDelay = Math.max(0, this.engine.params.waterRestoreDelayMs ?? 5000);
    const cooldown = Math.max(0, this.engine.params.waterQualityCooldownMs ?? 8000);
    const safeguardEnabled = !!this.engine.params.waterLegacyOnLowFps
      && isRealisticWaterMode(this._effectiveMode);

    if (!safeguardEnabled || fps <= 0) {
      this._fpsBelowSince = 0;
      this._fpsAboveSince = 0;
      if (this._fpsDowngraded && !safeguardEnabled) this._restoreFpsQuality(now);
      return;
    }

    if (fps < threshold) {
      if (!this._fpsBelowSince) this._fpsBelowSince = now;
      this._fpsAboveSince = 0;
    } else if (fps > restoreThreshold) {
      if (!this._fpsAboveSince) this._fpsAboveSince = now;
      this._fpsBelowSince = 0;
    } else {
      // Inside the hysteresis band: neither accumulate a downgrade nor a
      // restore. A brief threshold crossing cannot flip quality.
      this._fpsBelowSince = 0;
      this._fpsAboveSince = 0;
    }

    const cooldownElapsed = now - this._lastFpsTierChangeAt >= cooldown;
    const shouldDowngrade = !this._fpsDowngraded
      && this._fpsBelowSince > 0
      && now - this._fpsBelowSince >= downgradeDelay
      && cooldownElapsed;
    const shouldRestore = this._fpsDowngraded
      && this._fpsAboveSince > 0
      && now - this._fpsAboveSince >= restoreDelay
      && cooldownElapsed;

    if (shouldDowngrade) {
      this._fpsDowngraded = true;
      this._lastFpsTierChangeAt = now;
      this._fpsBelowSince = 0;
      this._syncStudioGeometry(this.engine.params, this.engine.worldMode);
      this._planarReflectionPass.deactivate(
        [this._realisticStudio, this._realisticInfinite].filter(Boolean),
      );
      // temporary visual downgrade via quality uniforms only
      for (const mat of this._allActiveMaterials()) {
        if (mat.uniforms.uWaterTier) mat.uniforms.uWaterTier.value = 1;
        if (mat.uniforms.uCausticsQual) mat.uniforms.uCausticsQual.value *= 0.25;
        if (mat.uniforms.uRefractionQual) mat.uniforms.uRefractionQual.value *= 0.25;
      }
    } else if (shouldRestore) this._restoreFpsQuality(now);
  }

  _restoreFpsQuality(now = performance.now()) {
    this._fpsDowngraded = false;
    this._lastFpsTierChangeAt = now;
    this._fpsBelowSince = 0;
    this._fpsAboveSince = 0;
    this._syncStudioGeometry(this.engine.params, this.engine.worldMode);
    this._applyUniforms(this.engine.params);
  }

  _syncStudioGeometry(params, worldMode) {
    const water = this.engine.water;
    if (!water || !this._baseStudioGeometry) return;
    const useCinematic = shouldUseCinematicWaterGeometry(
      this._effectiveMode,
      worldMode,
      this._fpsDowngraded,
    );
    if (!useCinematic) {
      this._disposeCinematicGeometry();
      this._applyGeometryUniforms();
      return;
    }

    const segments = resolveCinematicWaterSegments(
      this.engine.perf?.waterQuality ?? 2,
    );
    if (!this._cinematicGeometry || this._cinematicSegments !== segments) {
      const previous = this._cinematicGeometry;
      this._cinematicGeometry = createCinematicWaterGeometry(segments);
      this._cinematicSegments = segments;
      this._geometryFocusAnchored = false;
      water.geometry = this._cinematicGeometry;
      previous?.dispose();
    } else if (water.geometry !== this._cinematicGeometry) {
      water.geometry = this._cinematicGeometry;
    }
    // Anchor the density distribution once for this geometry. Continuously
    // following the camera morphs vertex positions and makes the displaced
    // surface wobble while orbiting, even though its wave field is world-space.
    if (!this._geometryFocusAnchored) {
      this._updateGeometryFocus(this.engine.camera);
    }
    this._applyGeometryUniforms();
  }

  _disposeCinematicGeometry() {
    const water = this.engine.water;
    if (water && water.geometry === this._cinematicGeometry) {
      water.geometry = this._baseStudioGeometry;
    }
    this._cinematicGeometry?.dispose();
    this._cinematicGeometry = null;
    this._cinematicSegments = 0;
    this._geometryFocusAnchored = false;
  }

  _applyGeometryUniforms() {
    const enabled = this._cinematicGeometry
      && this.engine.water?.geometry === this._cinematicGeometry
      && this.engine.worldMode === 'studio'
      && this._effectiveMode === 'cinematic'
      && !this._fpsDowngraded;
    for (const material of [
      this._realisticStudio,
      this._realisticInfinite,
    ]) {
      if (material?.uniforms?.uGeometryDisplacementEnabled) {
        material.uniforms.uGeometryDisplacementEnabled.value =
          material === this._realisticStudio && enabled ? 1 : 0;
      }
    }
  }

  _updateGeometryFocus(camera) {
    const water = this.engine.water;
    const uniform = this._realisticStudio?.uniforms?.uGeometryFocus;
    if (!water || !camera || !uniform || !this._cinematicGeometry) return;
    const sx = Math.max(Math.abs(water.scale.x), 1);
    const sz = Math.max(Math.abs(water.scale.z), 1);
    uniform.value.set(
      THREE.MathUtils.clamp((camera.position.x - water.position.x) / sx, -0.42, 0.42),
      THREE.MathUtils.clamp((camera.position.z - water.position.z) / sz, -0.42, 0.42),
    );
    this._geometryFocusAnchored = true;
  }

  _bindSurfaceTiming(mesh) {
    if (!mesh || this._timedMeshes.has(mesh)) return;
    const originalBefore = mesh.onBeforeRender;
    const originalAfter = mesh.onAfterRender;
    mesh.onBeforeRender = (...args) => {
      originalBefore?.apply(mesh, args);
      if (this.engine.params?.waterShowPerfCost) {
        this._surfaceSubmitStarted =
          globalThis.performance?.now?.() ?? Date.now();
      }
    };
    mesh.onAfterRender = (...args) => {
      originalAfter?.apply(mesh, args);
      if (!this._surfaceSubmitStarted) return;
      const ended = globalThis.performance?.now?.() ?? Date.now();
      this._surfaceSubmitMs = Math.max(0, ended - this._surfaceSubmitStarted);
      this._surfaceSubmitAvgMs = this._surfaceSubmitAvgMs
        ? THREE.MathUtils.lerp(
          this._surfaceSubmitAvgMs,
          this._surfaceSubmitMs,
          0.15,
        )
        : this._surfaceSubmitMs;
      this._surfaceSubmitStarted = 0;
    };
    this._timedMeshes.set(mesh, { originalBefore, originalAfter });
  }

  _restoreSurfaceTiming() {
    for (const [mesh, callbacks] of this._timedMeshes) {
      mesh.onBeforeRender = callbacks.originalBefore;
      mesh.onAfterRender = callbacks.originalAfter;
    }
    this._timedMeshes.clear();
  }
}
