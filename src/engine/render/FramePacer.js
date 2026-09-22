/** Activity-based frame admission. No renderer, browser, or GPU-name dependency. */
export const ENERGY_DEFAULTS = Object.freeze({ energyMode: 'balanced', energyMaxFps: 60 });
export const ENERGY_IDLE_DELAY_MS = 1500;
const FPS_CHOICES = [30, 60, 90, 120];

export function normalizeEnergySettings(settings = {}) {
  return {
    energyMode: ['off', 'balanced', 'eco'].includes(settings.energyMode)
      ? settings.energyMode : ENERGY_DEFAULTS.energyMode,
    energyMaxFps: FPS_CHOICES.includes(Number(settings.energyMaxFps))
      ? Number(settings.energyMaxFps) : ENERGY_DEFAULTS.energyMaxFps,
  };
}

export function resolveFramePolicy(settings, {
  now = 0, lastActivityAt = now, visible = true, interactive = false,
  busy = false, force = false, landing = false,
} = {}) {
  const { energyMode, energyMaxFps } = normalizeEnergySettings(settings);
  // Visibility wins over debugging and saved quality settings.
  if (!visible) return { state: 'hidden', targetFps: 0 };
  if (force || busy || energyMode === 'off') return { state: 'unlimited', targetFps: Infinity };
  const idle = !interactive && now - lastActivityAt >= ENERGY_IDLE_DELAY_MS;
  const activeFps = energyMode === 'eco' ? Math.min(30, energyMaxFps) : energyMaxFps;
  const targetFps = Math.min(activeFps, idle || landing ? (energyMode === 'eco' ? 24 : 30) : activeFps);
  return { state: landing ? 'showcase' : idle ? 'idle' : 'active', targetFps };
}

export class FramePacer {
  constructor() {
    this.state = 'unlimited';
    this.targetFps = Infinity;
    this.nextAt = -Infinity;
    this.lastAt = -Infinity;
    this.accepted = 0;
    this.skipped = 0;
    this.resumed = false;
  }

  admit(now, policy) {
    this.resumed = this.state === 'hidden' && policy.state !== 'hidden';
    const changed = this.state !== policy.state || this.targetFps !== policy.targetFps;
    this.state = policy.state;
    this.targetFps = policy.targetFps;
    if (this.targetFps === 0) {
      this.nextAt = -Infinity;
      this.skipped++;
      return false;
    }
    // A new interaction wakes an idle viewport immediately. Repeated pointer
    // events in an already active viewport do not bypass the FPS ceiling.
    if (changed || now < this.lastAt) this.nextAt = now;
    if (Number.isFinite(this.targetFps) && now + 0.25 < this.nextAt) {
      this.skipped++;
      return false;
    }
    if (Number.isFinite(this.targetFps)) {
      const interval = 1000 / this.targetFps;
      // Carry the fractional deadline across display refreshes (e.g. 144 Hz).
      // Never submit a burst of catch-up frames after a stall.
      const late = now - this.nextAt;
      this.nextAt = !Number.isFinite(late) || late >= interval
        ? now + interval : this.nextAt + interval;
    } else this.nextAt = now;
    this.lastAt = now;
    this.accepted++;
    return true;
  }

  snapshot() {
    return {
      state: this.state,
      targetFps: Number.isFinite(this.targetFps) ? this.targetFps : null,
      acceptedTicks: this.accepted,
      skippedTicks: this.skipped,
    };
  }
}
