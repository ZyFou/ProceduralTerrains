const DEFAULT_TINT = [1.0, 0.98, 0.92];
const DEFAULT_SUN = [1.0, 0.94, 0.82];
const DEFAULT_SKY = [0.36, 0.46, 0.62];
const DEFAULT_BOUNCE = [0.20, 0.16, 0.11];

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function rgb(value, fallback) {
  if (Array.isArray(value)) {
    return [
      Number.isFinite(value[0]) ? value[0] : fallback[0],
      Number.isFinite(value[1]) ? value[1] : fallback[1],
      Number.isFinite(value[2]) ? value[2] : fallback[2],
    ];
  }
  return [...fallback];
}

function multiply(a, b, scale = 1) {
  return [
    a[0] * b[0] * scale,
    a[1] * b[1] * scale,
    a[2] * b[2] * scale,
  ];
}

function scale(a, amount) {
  return [a[0] * amount, a[1] * amount, a[2] * amount];
}

function mix(a, b, amount) {
  const t = clamp01(amount);
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function vectorArray(value, fallback = [0.4, 0.7, 0.5]) {
  if (Array.isArray(value)) return rgb(value, fallback);
  if (value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)) {
    return [value.x, value.y, value.z];
  }
  return [...fallback];
}

/**
 * Resolve the active sky/terrain lighting into the compact radiance state used
 * by every cloud renderer. This stays independent from THREE so it can be
 * validated without a WebGL context.
 */
export function resolveCloudLightingState({
  proceduralSkyActive = false,
  timeOfDay = null,
  params = {},
  sunDirection = null,
  terrainSunColor = DEFAULT_SUN,
  terrainSunIntensity = 1.25,
  terrainSkyAmbient = DEFAULT_SKY,
  terrainGroundBounce = DEFAULT_BOUNCE,
} = {}) {
  const direction = vectorArray(sunDirection);

  if (proceduralSkyActive && timeOfDay) {
    const tint = rgb(params.visualsAtmosphereTint, DEFAULT_TINT);
    const brightness = Math.max(0, params.skyboxBrightness ?? 1.0)
      * Math.max(0, params.visualsSkyIntensity ?? 1.08);
    const ambientScale = Math.max(0, timeOfDay.ambientIntensity ?? 0.5) * brightness;
    const haze = clamp01(params.skyboxHaze ?? 0.55);
    const zenith = rgb(timeOfDay.zenith, DEFAULT_SKY);
    const horizon = rgb(timeOfDay.horizon, DEFAULT_SKY);
    const fog = rgb(timeOfDay.fogColor, horizon);
    const bottomSky = mix(horizon, fog, haze * 0.75);

    return {
      source: 'procedural-sky',
      sunDirection: direction,
      directLightColor: scale(
        rgb(timeOfDay.sunColor, DEFAULT_SUN),
        Math.max(0, timeOfDay.lightIntensity ?? 1),
      ),
      ambientTopColor: multiply(zenith, tint, ambientScale),
      ambientBottomColor: multiply(bottomSky, tint, ambientScale),
      groundBounceColor: multiply(fog, tint, ambientScale * 0.18),
    };
  }

  const sky = rgb(terrainSkyAmbient, DEFAULT_SKY);
  return {
    source: 'terrain-lighting',
    sunDirection: direction,
    directLightColor: scale(
      rgb(terrainSunColor, DEFAULT_SUN),
      Math.max(0, terrainSunIntensity ?? 1.25),
    ),
    // Match the scale used by the terrain shaders so manual Lighting changes
    // affect terrain and clouds in the same direction and approximate amount.
    ambientTopColor: scale(sky, 0.50),
    ambientBottomColor: scale(sky, 0.35),
    groundBounceColor: scale(rgb(terrainGroundBounce, DEFAULT_BOUNCE), 0.25),
  };
}

function setColor(uniform, value) {
  if (uniform?.value?.setRGB && value) uniform.value.setRGB(value[0], value[1], value[2]);
}

/**
 * Copy a resolved state to a cloud material's uniforms.
 */
export function applyCloudLightingState(uniforms, state) {
  if (!uniforms || !state) return;
  setColor(uniforms.uCloudDirectLight, state.directLightColor);
  setColor(uniforms.uCloudAmbientTop, state.ambientTopColor);
  setColor(uniforms.uCloudAmbientBottom, state.ambientBottomColor);
  setColor(uniforms.uCloudGroundBounce, state.groundBounceColor);
  if (uniforms.uCloudSunDir?.value?.set) {
    uniforms.uCloudSunDir.value.set(
      state.sunDirection[0],
      state.sunDirection[1],
      state.sunDirection[2],
    ).normalize();
  }
}
