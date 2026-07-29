const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const CLOUD_ADAPTIVE_DEFAULTS = Object.freeze({
  intervalMs: 3000,
  lowFps: 45,
  highFps: 56,
  highChecksToRecover: 3,
  scaleDown: 0.06,
  scaleUp: 0.03,
  minScale: 0.25,
  minStepScale: 0.72,
  stepDown: 0.08,
  stepUp: 0.05,
});

/**
 * Cloud-only adaptive quality. Resolution is degraded before the primary
 * raymarch budget, leaving the full scene resolution untouched until the cloud
 * target has reached its floor.
 */
export class CloudAdaptiveQualityController {
  constructor(options = {}) {
    this.options = { ...CLOUD_ADAPTIVE_DEFAULTS, ...options };
    this.scaleMultiplier = 1;
    this.stepMultiplier = 1;
    this.lastCheckAt = 0;
    this.suspendedUntil = 0;
    this.highChecks = 0;
  }

  effectiveScale(presetScale = 1) {
    return clamp(
      presetScale * this.scaleMultiplier,
      this.options.minScale,
      1,
    );
  }

  atScaleFloor(presetScale = 1) {
    return this.effectiveScale(presetScale) <= this.options.minScale + 1e-4;
  }

  isPristine(presetScale = 1) {
    return this.effectiveScale(presetScale) >= Math.min(1, presetScale) - 1e-4
      && this.stepMultiplier >= 0.999;
  }

  suspend(now, durationMs = 6000) {
    this.suspendedUntil = Math.max(this.suspendedUntil, now + durationMs);
    this.lastCheckAt = now;
    this.highChecks = 0;
  }

  reset(now = 0) {
    const changed = this.scaleMultiplier !== 1 || this.stepMultiplier !== 1;
    this.scaleMultiplier = 1;
    this.stepMultiplier = 1;
    this.lastCheckAt = now;
    this.highChecks = 0;
    return changed;
  }

  update({ now, fps, presetScale = 1, active = true, blocked = false }) {
    const result = {
      changed: false,
      direction: 'none',
      effectiveScale: this.effectiveScale(presetScale),
      stepMultiplier: this.stepMultiplier,
      atScaleFloor: this.atScaleFloor(presetScale),
    };
    if (!active || blocked || now < this.suspendedUntil || !Number.isFinite(fps) || fps <= 0) {
      this.highChecks = 0;
      return result;
    }
    if (this.lastCheckAt && now - this.lastCheckAt < this.options.intervalMs) return result;
    this.lastCheckAt = now;

    if (fps < this.options.lowFps) {
      this.highChecks = 0;
      const effective = this.effectiveScale(presetScale);
      if (effective > this.options.minScale + 1e-4) {
        const target = Math.max(this.options.minScale, effective - this.options.scaleDown);
        this.scaleMultiplier = clamp(target / Math.max(presetScale, 1e-4), 0, 1);
        result.changed = true;
        result.direction = 'down';
      } else if (this.stepMultiplier > this.options.minStepScale + 1e-4) {
        this.stepMultiplier = Math.max(
          this.options.minStepScale,
          this.stepMultiplier - this.options.stepDown,
        );
        result.changed = true;
        result.direction = 'down';
      }
    } else if (fps > this.options.highFps) {
      this.highChecks++;
      if (this.highChecks >= this.options.highChecksToRecover) {
        this.highChecks = 0;
        if (this.stepMultiplier < 0.999) {
          this.stepMultiplier = Math.min(1, this.stepMultiplier + this.options.stepUp);
          result.changed = true;
          result.direction = 'up';
        } else {
          const effective = this.effectiveScale(presetScale);
          const ceiling = Math.min(1, presetScale);
          if (effective < ceiling - 1e-4) {
            const target = Math.min(ceiling, effective + this.options.scaleUp);
            this.scaleMultiplier = clamp(target / Math.max(presetScale, 1e-4), 0, 1);
            result.changed = true;
            result.direction = 'up';
          }
        }
      }
    } else {
      this.highChecks = 0;
    }

    result.effectiveScale = this.effectiveScale(presetScale);
    result.stepMultiplier = this.stepMultiplier;
    result.atScaleFloor = this.atScaleFloor(presetScale);
    return result;
  }
}
