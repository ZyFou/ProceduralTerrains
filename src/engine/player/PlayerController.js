import { DEFAULT_PLAYER_CONFIG } from './PlayerConfig.js';

// ============================================================================
// First-person player physics controller.
//
// Works on top of FPSControls (which keeps owning pointer lock, mouse look
// and the key set): when a PlayerController is active, FPSControls runs in
// `externalMove` mode (orientation only) and this class integrates the
// player body — gravity, terrain collision via TerrainHeightSampler,
// walking/running, jumping (coyote time + jump buffer), slope limiting and
// swimming. The camera is placed at the player's eye height every frame, so
// the existing underwater post effect (driven by camera Y vs sea level)
// activates naturally while swimming.
//
// Terrain collision is analytic: the CPU height sampler evaluates the same
// deterministic height field the GPU renders, so there are no chunk-border
// seams and no raycasts against meshes.
//
// Keys (ZQSD and WASD both work — physical key codes):
//   Z/W forward · S back · Q/A left · D right · Shift run · Space jump/swim up
//   Ctrl or C swim down
// ============================================================================

const STATE = {
  GROUNDED: 'grounded',
  FALLING: 'falling',
  SWIMMING: 'swimming',
  UNDERWATER: 'underwater',
};

export class PlayerController {
  /**
   * @param {object} opts
   * @param {FPSControls} opts.controls     look/input source (pointer-locked)
   * @param {THREE.Camera} opts.camera
   * @param {TerrainHeightSampler} opts.sampler
   * @param {function} opts.getWaterLevel   () => number | null
   * @param {object} [opts.config]          overrides of DEFAULT_PLAYER_CONFIG
   */
  constructor({ controls, camera, sampler, getWaterLevel, config = {} }) {
    this.controls = controls;
    this.camera = camera;
    this.sampler = sampler;
    this.getWaterLevel = getWaterLevel;
    this.cfg = { ...DEFAULT_PLAYER_CONFIG, ...config };

    // player body: position is the FEET position
    this.pos = { x: camera.position.x, y: 0, z: camera.position.z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.state = STATE.FALLING;
    this.speedMultiplier = 1.0;

    this._coyote = 0;        // time since leaving the ground
    this._jumpBuffer = 0;    // time since jump was pressed
    this._jumpHeld = false;

    // spawn standing on the terrain under the current camera position
    // (land immediately — no long initial fall from a fly-cam altitude)
    this.pos.y = sampler.heightAt(this.pos.x, this.pos.z);

    // route the mouse wheel to the speed multiplier instead of fly speed
    controls.externalMove = true;
    controls.onSpeedWheel = (factor) => {
      if (!this.cfg.wheelChangesSpeed) return;
      this.speedMultiplier = Math.min(this.cfg.maxSpeedMultiplier,
        Math.max(this.cfg.minSpeedMultiplier, this.speedMultiplier * factor));
    };

    this._syncCamera();
  }

  dispose() {
    this.controls.externalMove = false;
    this.controls.onSpeedWheel = null;
  }

  /** Place the player feet at a world position. */
  teleport(x, y, z) {
    this.pos.x = x; this.pos.y = y; this.pos.z = z;
    this.vel.x = this.vel.y = this.vel.z = 0;
    this._syncCamera();
  }

  // ------------------------------------------------------------------ update

  update(dt) {
    const cfg = this.cfg;
    const keys = this.controls.keys;
    const locked = this.controls.isLocked;

    // --- input -> wish direction (camera-yaw relative, horizontal) ---
    const yaw = this.controls.yaw;
    const fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);

    let ix = 0, iz = 0;
    if (locked) {
      if (keys.has('KeyW') || keys.has('KeyZ')) { ix += fwdX; iz += fwdZ; }
      if (keys.has('KeyS')) { ix -= fwdX; iz -= fwdZ; }
      if (keys.has('KeyA') || keys.has('KeyQ')) { ix -= rightX; iz -= rightZ; }
      if (keys.has('KeyD')) { ix += rightX; iz += rightZ; }
    }
    const iLen = Math.hypot(ix, iz);
    if (iLen > 1e-6) { ix /= iLen; iz /= iLen; }

    const running = locked && (keys.has('ShiftLeft') || keys.has('ShiftRight'));
    const jumpKey = locked && keys.has('Space');
    const downKey = locked && (keys.has('ControlLeft') || keys.has('KeyC'));

    // jump buffering (so a press just before landing still jumps)
    if (jumpKey && !this._jumpHeld) this._jumpBuffer = cfg.jumpBufferTime;
    else this._jumpBuffer = Math.max(0, this._jumpBuffer - dt);
    this._jumpHeld = jumpKey;

    // --- environment ---
    const ground = this.sampler.heightAt(this.pos.x, this.pos.z);
    const water = this.getWaterLevel();
    const waterDepth = water !== null ? water - ground : -1; // depth of water column
    const swimming = water !== null
      && waterDepth > cfg.swimEnterDepth
      && this.pos.y < water - cfg.surfaceFloatOffset
      && this.pos.y > ground - 0.01;

    if (swimming) {
      this._updateSwim(dt, ix, iz, running, jumpKey, downKey, ground, water);
    } else {
      this._updateWalk(dt, ix, iz, running, ground);
    }

    // never fall through the terrain (re-sample at the post-move position)
    const groundNow = this.sampler.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y < groundNow) {
      this.pos.y = groundNow;
      if (this.vel.y < 0) this.vel.y = 0;
    }

    // --- state for the HUD ---
    const eyeY = this.pos.y + cfg.eyeHeight;
    if (water !== null && eyeY < water) this.state = STATE.UNDERWATER;
    else if (swimming) this.state = STATE.SWIMMING;
    else if (this.pos.y <= groundNow + 0.02) this.state = STATE.GROUNDED;
    else this.state = STATE.FALLING;

    this._syncCamera();
  }

  // ------------------------------------------------------- walking / falling

  _updateWalk(dt, ix, iz, running, ground) {
    const cfg = this.cfg;
    const grounded = this.pos.y <= ground + 0.02 && this.vel.y <= 0.01;

    if (grounded) this._coyote = cfg.coyoteTime;
    else this._coyote = Math.max(0, this._coyote - dt);

    // --- slope handling ---
    let slideX = 0, slideZ = 0;
    if (grounded && (ix !== 0 || iz !== 0 || cfg.steepSlopeSlide)) {
      const n = this.sampler.normalAt(this.pos.x, this.pos.z, 1.0);
      const slopeDeg = Math.acos(Math.min(1, n.y)) * 180 / Math.PI;
      if (slopeDeg > cfg.maxWalkableSlopeDegrees) {
        // block the uphill component of the wish direction
        const downX = n.x, downZ = n.z; // horizontal downhill direction (unnormalized)
        const dLen = Math.hypot(downX, downZ) || 1;
        const dx = downX / dLen, dz = downZ / dLen;
        const uphill = -(ix * dx + iz * dz); // >0 when pushing uphill
        if (uphill > 0) { ix += dx * uphill; iz += dz * uphill; }
        if (cfg.steepSlopeSlide) {
          const over = Math.min(1, (slopeDeg - cfg.maxWalkableSlopeDegrees) / 20);
          slideX = dx * cfg.slopeSlideStrength * over;
          slideZ = dz * cfg.slopeSlideStrength * over;
        }
      }
    }

    // --- horizontal acceleration toward target velocity ---
    const targetSpeed = (running ? cfg.runSpeed : cfg.walkSpeed) * this.speedMultiplier;
    const tx = ix * targetSpeed, tz = iz * targetSpeed;
    const hasInput = ix !== 0 || iz !== 0;
    let accel = hasInput
      ? (running ? cfg.runAcceleration : cfg.acceleration)
      : cfg.deceleration;
    if (!grounded) accel *= cfg.airControl;

    const blend = 1 - Math.exp(-accel / Math.max(targetSpeed, 1) * dt);
    this.vel.x += (tx - this.vel.x) * blend + slideX * dt;
    this.vel.z += (tz - this.vel.z) * blend + slideZ * dt;

    // --- jump (with coyote time + buffer) ---
    if (this._jumpBuffer > 0 && this._coyote > 0) {
      this.vel.y = cfg.jumpVelocity;
      this._jumpBuffer = 0;
      this._coyote = 0;
    }

    // --- gravity ---
    this.vel.y -= cfg.gravity * dt;
    if (this.vel.y < -cfg.terminalVelocity) this.vel.y = -cfg.terminalVelocity;

    // --- integrate ---
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;

    // --- ground collision + snap (re-sample at the new XZ) ---
    const newGround = this.sampler.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y <= newGround) {
      this.pos.y = newGround;
      this.vel.y = 0;
    } else if (
      this.vel.y <= 0 && grounded &&
      this.pos.y - newGround <= cfg.groundSnapDistance
    ) {
      // stick to the ground while walking down gentle slopes / small steps
      this.pos.y = newGround;
      this.vel.y = 0;
    }
  }

  // ---------------------------------------------------------------- swimming

  _updateSwim(dt, ix, iz, running, upKey, downKey, ground, water) {
    const cfg = this.cfg;
    this._coyote = 0;

    const targetSpeed = (running ? cfg.swimRunSpeed : cfg.swimSpeed) * this.speedMultiplier;
    const eyeY = this.pos.y + cfg.eyeHeight;
    const atSurface = eyeY >= water - 0.35;

    // horizontal swim follows the camera yaw; vertical from look pitch when
    // fully underwater (diving feels natural), plus explicit up/down keys
    let vy = 0;
    if (!atSurface && (ix !== 0 || iz !== 0)) {
      vy += Math.sin(this.controls.pitch) * targetSpeed;
    }
    if (upKey) vy += cfg.swimVerticalSpeed;
    if (downKey) vy -= cfg.swimVerticalSpeed;

    // gentle buoyancy toward the surface when idle near the top
    if (!upKey && !downKey && eyeY < water - cfg.surfaceFloatOffset) {
      vy += Math.min(cfg.buoyancy * 0.25, cfg.swimVerticalSpeed); // gentle rise (u/s)
    }

    // exponential drag toward the target velocity (water resistance)
    const blend = 1 - Math.exp(-cfg.waterDrag * dt);
    this.vel.x += (ix * targetSpeed - this.vel.x) * blend;
    this.vel.z += (iz * targetSpeed - this.vel.z) * blend;
    this.vel.y += (vy - this.vel.y) * blend;

    // jump out of the water at the surface (lets the player exit onto land)
    if (atSurface && upKey && this._jumpBuffer > 0) {
      this.vel.y = cfg.jumpVelocity * 0.75;
      this._jumpBuffer = 0;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;

    // don't float above the surface while still in swim mode
    if (this.pos.y + cfg.eyeHeight > water + cfg.surfaceFloatOffset && this.vel.y > 0) {
      this.vel.y = 0;
      this.pos.y = water + cfg.surfaceFloatOffset - cfg.eyeHeight;
    }

    // terrain floor (swimming into a beach walks out of the water)
    const newGround = this.sampler.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y < newGround) {
      this.pos.y = newGround;
      if (this.vel.y < 0) this.vel.y = 0;
    }
  }

  // ------------------------------------------------------------------ camera

  _syncCamera() {
    this.camera.position.set(
      this.pos.x,
      this.pos.y + this.cfg.eyeHeight,
      this.pos.z
    );
  }
}

export const PLAYER_STATE = STATE;
