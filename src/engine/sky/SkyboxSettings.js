// ============================================================================
// SkyboxSettings: the reusable parameter model for the procedural sky dome
// (ProceduralSky). Like the cloud params, these keys live in the engine
// `params` object (merged into DEFAULT_PARAMS) so they serialize with every
// save; old saves without them simply fall back to these defaults on load.
//
// The sky is a SHARED visual system: the exact same params + the shared
// `timeOfDay` value drive the dome in BOTH the studio (Tile) view and the
// infinite world. Nothing about the sky is hardcoded in any renderer / mode —
// ProceduralSky.applyParams() turns these flat keys into shader uniforms and
// the engine toggles dome visibility per world mode.
//
// NOTE: `timeOfDay` itself is NOT duplicated here. It already exists as a
// single engine-owned value (Engine.timeOfDay, mirrored to React) shared by
// the Skybox tab, the Lighting system and the infinite HUD. The Skybox tab is
// simply the new owner of the time-of-day *control* surface.
// ============================================================================

// Flat keys, `skybox*` namespace to avoid collisions with terrain params.
export const SKYBOX_DEFAULT_PARAMS = {
  // Master toggle: when on, the procedural sky dome surrounds the scene and
  // time-of-day drives the sky colours / sun / fog. When off, the scene falls
  // back to the flat studio backdrop + the manual Lighting sun angles.
  skyboxEnabled: true,

  // Overall brightness scale applied to the whole sky dome (sky + sun + glow).
  skyboxBrightness: 1.0,

  // Strength of the warm/cool haze band blended in around the horizon.
  skyboxHaze: 0.55,

  // Render the night-time star field when the sun is below the horizon.
  skyboxStars: true,
};

// True if a key belongs to the skybox model (used by Engine.setParam routing).
export function isSkyboxKey(key) {
  return key.startsWith('skybox');
}
