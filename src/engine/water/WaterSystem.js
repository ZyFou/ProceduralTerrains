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
    this._disposed = false;
    this._waterCompileGen = 0;
    this._waterCompilePending = false;

    // owned realistic materials (legacy materials stay on engine)
    this._realisticStudio = null;
    this._realisticInfinite = null;
  }

  /** Call once after engine scene + water meshes exist. */
  init() {
    this._syncFromParams();
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

  /** Main settings sync — call from _applyUniforms and mode changes. */
  sync(params, worldMode) {
    const prevMode = this._effectiveMode;
    const prevRealistic = this._usingRealistic;
    this._effectiveMode = resolveEffectiveWaterMode(params, worldMode);
    this._usingRealistic = isRealisticWaterMode(this._effectiveMode);

    if (prevMode !== this._effectiveMode || prevRealistic !== this._usingRealistic) {
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
        const scale = this.engine.params.waterReflectionQuality ?? 1;
        mat.uniforms.uWaterReflection.value = perf.waterReflection * scale;
      }
      if (mat.uniforms.uWaveComplexity) mat.uniforms.uWaveComplexity.value = perf.waterWaves;
    }
    this._maybeFpsDowngrade(perf);
  }

  /** Per-frame update — FPS downgrade + bounds helper. */
  update(fps) {
    if (this.engine.params.waterLegacyOnLowFps) {
      this._maybeFpsDowngrade(this.engine.perf, fps);
    }
  }

  onStackRebuilt(stackGLSL, octaves) {
    const eng = this.engine;
    if (this._realisticStudio) {
      rebuildRealisticWaterShaderSource(this._realisticStudio, stackGLSL);
      this._realisticStudio.defines.OCTAVES = octaves;
      this._realisticStudio.needsUpdate = true;
    }
    if (this._realisticInfinite) {
      rebuildRealisticWaterShaderSource(this._realisticInfinite, stackGLSL);
      this._realisticInfinite.defines.OCTAVES = octaves;
      this._realisticInfinite.needsUpdate = true;
    }
    if (eng.waterMaterial) {
      rebuildWaterShaderSource(eng.waterMaterial, stackGLSL);
      eng.waterMaterial.defines.OCTAVES = octaves;
      eng.waterMaterial.needsUpdate = true;
    }
    if (eng._infiniteWaterMat) {
      rebuildWaterShaderSource(eng._infiniteWaterMat, stackGLSL);
      eng._infiniteWaterMat.defines.OCTAVES = octaves;
      eng._infiniteWaterMat.needsUpdate = true;
    }
    if (eng.planetWaterMat) {
      // planet water rebuild handled by engine planet rebuild path
    }
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
    this._waterCompileGen++;
    this._waterCompilePending = false;
    this._disposeRealistic();
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
      eng.compileWaterMaterialsAsync(mats, () => {
        if (this._disposed || gen !== this._waterCompileGen) return;
        this._waterCompilePending = false;
        this._attachRealisticMaterials(p, debug);
        this._applyVisibility(p, wm);
        this._applyUniforms(p);
        this._applyDebug(p);
        this._updateBoundsHelper(p);
        this.applyPerf(eng.perf);
      });
      return;
    }

    this._waterCompilePending = false;
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
    applyWaterMaterialSettings(this._realisticStudio, p, this._effectiveMode, debug);
    if (this._realisticInfinite) {
      applyWaterMaterialSettings(this._realisticInfinite, p, this._effectiveMode, debug);
    }
  }

  /** Recreate legacy infinite material after disposing realistic instance. */
  _ensureLegacyInfiniteMaterial(octaves) {
    const eng = this.engine;
    if (eng._infiniteWaterMat && !this.ownsMaterial(eng._infiniteWaterMat)) return;
    eng._infiniteWaterMat = createWaterMaterialForMode({
      mode: 'legacy',
      sharedUniforms: eng.uniforms,
      octaves,
      stackGLSL: eng._stackGLSL,
      infinite: true,
    });
  }

  _ensureRealisticStudio(octaves) {
    if (this._realisticStudio) return;
    const eng = this.engine;
    this._realisticStudio = createWaterMaterialForMode({
      mode: this._effectiveMode,
      sharedUniforms: eng.uniforms,
      octaves,
      stackGLSL: eng._stackGLSL,
      infinite: false,
    });
  }

  _ensureRealisticInfinite(octaves) {
    if (this._realisticInfinite) return;
    const eng = this.engine;
    this._realisticInfinite = createWaterMaterialForMode({
      mode: this._effectiveMode,
      sharedUniforms: eng.uniforms,
      octaves,
      stackGLSL: eng._stackGLSL,
      infinite: true,
    });
  }

  _disposeRealistic() {
    for (const mat of [this._realisticStudio, this._realisticInfinite]) {
      mat?.dispose();
    }
    this._realisticStudio = null;
    this._realisticInfinite = null;
  }

  _activeStudioMaterial() {
    return this._usingRealistic ? this._realisticStudio : this.engine.waterMaterial;
  }

  _activeInfiniteMaterial() {
    return this._usingRealistic ? this._realisticInfinite : this.engine._infiniteWaterMat;
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

    // The underwater pass + caustics are driven centrally each frame by
    // Engine._updateUnderwater (UnderwaterController is the single source of
    // truth), so nothing to configure here on a settings change.
  }

  ownsMaterial(mat) {
    return mat === this._realisticStudio || mat === this._realisticInfinite;
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

  _maybeFpsDowngrade(perf, fps = this.engine._fps) {
    const threshold = this.engine.params.waterDisableExpensiveBelowFps ?? 42;
    if (!this.engine.params.waterLegacyOnLowFps || fps <= 0) return;
    const shouldDowngrade = fps < threshold && isRealisticWaterMode(this._effectiveMode);
    if (shouldDowngrade && !this._fpsDowngraded) {
      this._fpsDowngraded = true;
      // temporary visual downgrade via quality uniforms only
      for (const mat of this._allActiveMaterials()) {
        if (mat.uniforms.uWaterTier) mat.uniforms.uWaterTier.value = 1;
        if (mat.uniforms.uCausticsQual) mat.uniforms.uCausticsQual.value *= 0.25;
        if (mat.uniforms.uRefractionQual) mat.uniforms.uRefractionQual.value *= 0.25;
      }
    } else if (!shouldDowngrade && this._fpsDowngraded) {
      this._fpsDowngraded = false;
      this._applyUniforms(this.engine.params);
    }
  }
}
