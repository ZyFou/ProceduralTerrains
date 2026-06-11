// ============================================================================
// Central config for the first-person player physics controller.
// All units are world units / seconds / degrees.
// ============================================================================

export const DEFAULT_PLAYER_CONFIG = {
  enabled: false,

  // Movement keys: ZQSD (AZERTY) and WASD both work — handled by key codes.
  inputLayout: 'AZERTY',

  height: 1.8,
  radius: 0.35,
  eyeHeight: 1.65,

  walkSpeed: 8.0,
  runSpeed: 15.0,
  airControl: 0.35,

  acceleration: 45.0,
  deceleration: 35.0,
  runAcceleration: 55.0,

  gravity: 32.0,
  terminalVelocity: 90.0,

  jumpVelocity: 12.0,
  coyoteTime: 0.12,
  jumpBufferTime: 0.12,

  maxStepHeight: 0.65,
  groundSnapDistance: 0.45,

  maxWalkableSlopeDegrees: 50,
  steepSlopeSlide: true,
  slopeSlideStrength: 6.0,

  // swimming
  swimEnterDepth: 1.1,        // water depth above ground needed to swim
  swimSpeed: 5.0,
  swimRunSpeed: 8.0,
  swimVerticalSpeed: 4.0,
  waterDrag: 4.0,
  buoyancy: 6.0,
  surfaceFloatOffset: 0.25,   // eye floats this far above surface when idle

  // mouse-wheel speed multiplier (wheel keeps controlling speed in player mode)
  wheelChangesSpeed: true,
  minSpeedMultiplier: 0.25,
  maxSpeedMultiplier: 4.0,
};
