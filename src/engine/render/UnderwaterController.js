// ============================================================================
// UnderwaterController — centralized underwater state detection + transition.
//
// Single source of truth for "is the camera submerged, how deep, and how
// strongly should underwater effects apply right now". It works in all three
// world modes:
//
//   - Tile / Infinite : flat water plane at seaLevel → submersion = seaLevel - camY
//   - Planet          : spherical ocean shell at (planetRadius + seaLevel) from
//                        the planet centre → submersion = oceanRadius - |camPos|
//
// The activation (`blend`) is a smooth ramp across a band around the surface
// plus temporal smoothing, so crossing the waterline cross-fades instead of
// popping. Everything downstream (post-process pass, terrain caustics,
// diagnostics) reads the resolved values from here — nothing recomputes the
// submersion test independently.
// ============================================================================

export class UnderwaterController {
  constructor() {
    // config (driven from settings each frame)
    this.enabled = true;
    this.blendBand = 0.8;        // world units around the surface to fade over
    this.transitionSpeed = 1.0;  // multiplier on the temporal smoothing rate

    // resolved per-frame state (read by the effect + diagnostics)
    this.isUnderwater = false;
    this.underwaterDepth = 0;       // metres below the surface (>= 0)
    this.waterSurfaceDistance = 0;  // |distance to the surface| (above or below)
    this.underwaterBlend = 0;       // smoothed activation 0..1
    this.waterMode = 'off';         // effective water renderer mode
    this.quality = 'off';           // resolved underwater quality: off|lite|high
    this.requestedQuality = 'auto';
    this.fellBackToLite = false;    // High requested but Lite forced

    // optional sub-effects (mirrored from settings for diagnostics + shader)
    this.causticsEnabled = false;
    this.particlesEnabled = false;
    this.lightShaftsEnabled = false;

    // capability flags (set by the engine after the render target exists)
    this.depthTextureAvailable = true;
  }

  /** Effects only run while we are at/below the surface and not Off. */
  get active() {
    return this.underwaterBlend > 0.002 && this.quality !== 'off';
  }

  get highActive() {
    return this.active && this.quality === 'high';
  }

  /**
   * Advance the underwater state. Call once per frame, before render.
   *
   * @param {number} dt   frame delta seconds
   * @param {Object} ctx
   *   worldMode            'studio' | 'infinite' | 'planet'
   *   cameraPos            THREE.Vector3 (world)
   *   seaLevel             current sea level
   *   waterActive          whether water is on at all
   *   waterMode            effective water renderer mode
   *   quality              resolved underwater quality ('off'|'lite'|'high')
   *   requestedQuality     raw setting ('off'|'lite'|'high'|'auto')
   *   fellBack             High requested but Lite forced
   *   planetRadius         planet radius (planet mode only)
   *   blendBand            transition band width (world units)
   *   transitionSpeed      transition speed multiplier
   *   causticsEnabled / particlesEnabled / lightShaftsEnabled
   */
  update(dt, ctx) {
    const {
      worldMode, cameraPos, seaLevel, waterActive,
      waterMode = 'off', quality = 'off', requestedQuality = 'auto',
      fellBack = false, planetRadius = 0,
      blendBand, transitionSpeed,
      causticsEnabled = false, particlesEnabled = false, lightShaftsEnabled = false,
    } = ctx;

    if (blendBand != null) this.blendBand = Math.max(0.2, blendBand);
    if (transitionSpeed != null) this.transitionSpeed = Math.max(0.1, transitionSpeed);

    this.waterMode = waterMode;
    this.quality = quality;
    this.requestedQuality = requestedQuality;
    this.fellBack = fellBack;
    this.fellBackToLite = fellBack;
    this.causticsEnabled = causticsEnabled;
    this.particlesEnabled = particlesEnabled;
    this.lightShaftsEnabled = lightShaftsEnabled;

    // ---- submersion test (mode-specific) ----
    let submerge = -1e9;
    if (this.enabled && waterActive && cameraPos) {
      if (worldMode === 'planet') {
        const oceanRadius = (planetRadius || 0) + (seaLevel || 0);
        const camRadius = Math.hypot(cameraPos.x, cameraPos.y, cameraPos.z);
        submerge = oceanRadius - camRadius;
      } else if (Number.isFinite(seaLevel)) {
        submerge = seaLevel - cameraPos.y;
      }
    }

    this.underwaterDepth = Math.max(submerge, 0);
    this.waterSurfaceDistance = Math.abs(submerge);

    // ---- smooth activation ----
    let target = 0;
    if (this.quality !== 'off' && submerge > -1e8) {
      const band = this.blendBand;
      target = clamp((submerge + band * 0.5) / band, 0, 1);
    }

    // temporal smoothing (also catches teleports / mode switches)
    const k = 1 - Math.exp(-dt * 9 * this.transitionSpeed);
    this.underwaterBlend += (target - this.underwaterBlend) * k;
    if (this.underwaterBlend < 0.002 && target === 0) this.underwaterBlend = 0;

    this.isUnderwater = submerge > 0;
    return this;
  }

  /** Read-only snapshot for the performance overlay. */
  snapshot() {
    return {
      active: this.active,
      isUnderwater: this.isUnderwater,
      mode: this.quality,
      requestedMode: this.requestedQuality,
      fellBackToLite: this.fellBackToLite,
      blend: this.underwaterBlend,
      depth: this.underwaterDepth,
      surfaceDistance: this.waterSurfaceDistance,
      waterMode: this.waterMode,
      causticsEnabled: this.causticsEnabled && this.quality !== 'off',
      particlesEnabled: this.particlesEnabled && this.quality === 'high',
      lightShaftsEnabled: this.lightShaftsEnabled && this.quality === 'high',
      depthTextureAvailable: this.depthTextureAvailable,
    };
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
