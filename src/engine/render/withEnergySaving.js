import { FramePacer, normalizeEnergySettings, resolveFramePolicy } from './FramePacer.js';

/**
 * Explicit engine extension used by BOTH transports. Keeping the scheduling
 * adapter separate leaves boot, exports, physics and the camera passes owned
 * by Engine. A rejected tick never enters its expensive simulation/render body.
 */
export function withEnergySaving(BaseEngine) {
  return class EnergySavingEngine extends BaseEngine {
    constructor(...args) {
      super(...args);
      this._energyPacer ??= new FramePacer();
      this._energyVisible = globalThis.document?.visibilityState !== 'hidden';
      this._energyActivityAt = performance.now();
      this._energyKeys = new Map();
      this._energyPointers = new Set();
      this._energyListeners = [];
      const listen = (target, type, handler) => {
        target?.addEventListener?.(type, handler, { passive: true });
        this._energyListeners.push(() => target?.removeEventListener?.(type, handler));
      };
      const pointer = (event) => {
        if (event.type === 'pointerdown') this._energyPointers.add(event.pointerId ?? 0);
        if (event.type === 'pointerup' || event.type === 'pointercancel') {
          this._energyPointers.delete(event.pointerId ?? 0);
        }
        // Plain hovering is not activity, except when it moves a brush preview.
        if (event.type !== 'pointermove' || event.buttons || this.paintState?.enabled
            || this.manualTerrain?.sculpt?.enabled || this.manualTerrain?.texturePaint?.enabled) {
          this._wakeEnergy();
        }
      };
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
        listen(this.canvas, type, pointer);
      }
      listen(this.canvas, 'wheel', () => this._wakeEnergy());
      for (const type of ['pointerup', 'pointercancel']) {
        listen(globalThis.window, type, (event) => {
          if (this._energyPointers.delete(event.pointerId ?? 0)) this._wakeEnergy();
        });
      }
      listen(globalThis.document, 'keydown', (event) => {
        this._energyKeys.set(event.code || event.key, { code: event.code, key: event.key });
        this._wakeEnergy();
      });
      listen(globalThis.document, 'keyup', (event) => {
        this._energyKeys.delete(event.code || event.key);
        this._wakeEnergy();
      });
      listen(globalThis.document, 'visibilitychange', () => {
        this._setEnergyVisibility(globalThis.document?.visibilityState !== 'hidden');
      });
      listen(globalThis.window, 'blur', () => this._releaseEnergyInput());
    }

    _wakeEnergy() {
      this._energyActivityAt = performance.now();
      // The worker DOM facade does not bubble canvas events to window, where
      // the base engine tracks activity. Keep its deferred-work policy in sync.
      this._lastUserActivityAt = this._energyActivityAt;
    }

    _releaseEnergyInput() {
      const keyEvents = [...(this._energyKeys?.values() || [])].map((key) => ({ type: 'keyup', ...key }));
      this._energyKeys?.clear();
      this._energyPointers?.clear();
      if (keyEvents.length) super.applyInputFrame({ keyEvents });
    }

    _setEnergyVisibility(visible) {
      if (this._energyVisible === visible) return;
      this._energyVisible = visible;
      if (!visible) this._releaseEnergyInput();
      else {
        this._energyResetClock = true;
        this._needsRender = true;
        this._wakeEnergy();
      }
    }

    setViewport(viewport = {}) {
      const { visible, ...dimensions } = viewport;
      if (typeof visible === 'boolean') this._setEnergyVisibility(visible);
      // Do NOT pass visible:true on every input packet: the base implementation
      // invokes _onVisibility and resets its clock even without a transition.
      if (Number.isFinite(dimensions.width) && Number.isFinite(dimensions.height)) {
        return super.setViewport(dimensions);
      }
    }

    _onResize(...args) {
      this._wakeEnergy();
      return super._onResize(...args);
    }

    _afterParamChange(...args) {
      this._wakeEnergy();
      return super._afterParamChange(...args);
    }

    setTouchInput(...args) {
      this._wakeEnergy();
      return super.setTouchInput(...args);
    }

    setPerfSetting(key, value) {
      if (key !== 'energyMode' && key !== 'energyMaxFps') return super.setPerfSetting(key, value);
      Object.assign(this.perf, normalizeEnergySettings({ ...this.perf, [key]: value }));
      this._wakeEnergy();
      this._needsRender = true;
      // A scheduling preference must not rebuild LOD meshes or compile shaders.
      this._notifyPerf();
    }

    _applyPerformance(...args) {
      // The base sanitizer preserves extension keys. This also supplies defaults
      // after reset/preset/history operations and before the first UI snapshot.
      Object.assign(this.perf, normalizeEnergySettings(this.perf));
      this._wakeEnergy();
      return super._applyPerformance(...args);
    }

    _tick() {
      if (this._disposed) return;
      const now = performance.now();
      const pacer = this._energyPacer ??= new FramePacer();
      const visible = this._energyVisible !== false
        && globalThis.document?.visibilityState !== 'hidden';
      const policy = resolveFramePolicy(this.perf, {
        now,
        visible,
        lastActivityAt: Math.max(this._energyActivityAt ?? now, this._lastUserActivityAt ?? 0),
        interactive: this.exploreMode !== 'none' || !!this._debug?.freeCamNoClip
          || !!this.controls?.isSettling || !!this.planetControls?.isSettling
          || (this._energyKeys?.size ?? 0) > 0 || (this._energyPointers?.size ?? 0) > 0,
        busy: !!this._bootPending || !!this._modeTransitionCoordinator?.active
          || !!this._compiling || !!this._exporting,
        force: !!this._debug?.forceRender || !!this._shaderBenchmarkRunner?.running,
        landing: !!this._landingShowcase,
      });
      if (!pacer.admit(now, policy)) return;
      if (pacer.resumed || this._energyResetClock) {
        this._energyResetClock = false;
        if (typeof this._clock?.reset === 'function') this._clock.reset();
        else { this._clock?.stop?.(); this._clock?.start?.(); }
        this._needsRender = true;
        this._fpsTime = now;
        this._frames = 0;
        this._autoCheckAt = now;
        this._cloudAdaptive?.suspend(now, 6000);
      }
      return super._tick();
    }

    _continuousRenderInterval(now = performance.now()) {
      if (normalizeEnergySettings(this.perf).energyMode === 'off') {
        return super._continuousRenderInterval(now);
      }
      const fps = this._energyPacer?.targetFps;
      return Number.isFinite(fps) && fps > 0 ? 1000 / fps : 0;
    }

    _renderCadenceDue(now) {
      // Admission already occurred before input/streaming/props work. Applying
      // the base cadence again would halve the intended rate on some displays.
      return normalizeEnergySettings(this.perf).energyMode === 'off'
        ? super._renderCadenceDue(now) : true;
    }

    _autoPerfTick(now) {
      const pacer = this._energyPacer;
      if (normalizeEnergySettings(this.perf).energyMode === 'off' || !pacer) {
        return super._autoPerfTick(now);
      }
      // Intentional idle FPS are not evidence of an overloaded GPU. Also avoid
      // spending the saved budget on automatic quality increases while idle.
      if (pacer.state === 'idle' || pacer.state === 'showcase') {
        this._autoCheckAt = now;
        this._cloudAdaptive?.suspend(now, 1000);
        return;
      }
      // Existing quality controllers use a 60-FPS reference. Normalize only
      // during their call; HUD/diagnostics always retain actual rendered FPS.
      const fps = this._fps;
      if (pacer.targetFps > 0 && pacer.targetFps < 60) this._fps = fps * 60 / pacer.targetFps;
      try { return super._autoPerfTick(now); }
      finally { this._fps = fps; }
    }

    getPerfDiagnostics(...args) {
      return { ...super.getPerfDiagnostics(...args), energy: this._energyPacer?.snapshot() || null };
    }

    getClientSnapshot(...args) {
      return { ...super.getClientSnapshot(...args), energy: this._energyPacer?.snapshot() || null };
    }

    dispose(...args) {
      this._energyListeners?.splice(0).forEach((remove) => remove());
      this._energyKeys?.clear();
      this._energyPointers?.clear();
      return super.dispose(...args);
    }
  };
}
