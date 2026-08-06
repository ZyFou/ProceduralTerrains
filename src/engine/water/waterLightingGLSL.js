// ============================================================================
// Shared atmospheric lighting for every water renderer.
//
// The terrain lighting uniforms are shared objects, so procedural-sky updates
// and manual Lighting settings reach water without a separate CPU sync path.
// ============================================================================

export const WATER_LIGHTING_UNIFORMS_GLSL = /* glsl */ `
uniform float uWaterAtmosphereInfluence;
uniform float uWaterSunResponse;
uniform float uWaterAmbientResponse;
uniform float uWaterFoamLighting;

vec3 waterResolveLighting(
  vec3 normal,
  vec3 localUp,
  float diffuse,
  vec3 legacyLight
) {
  float upFacing = clamp(
    dot(normalize(normal), normalize(localUp)),
    -1.0,
    1.0
  );
  float skyFacing = upFacing * 0.5 + 0.5;

  vec3 directLight = uTerrainSunCol
    * uTerrainSunIntensity
    * diffuse
    * uWaterSunResponse;
  vec3 ambientLight = uTerrainSkyAmb
    * 0.50
    * skyFacing
    * uWaterAmbientResponse;
  vec3 bounceLight = uTerrainBounce
    * 0.25
    * (1.0 - upFacing * 0.5)
    * uWaterAmbientResponse;
  vec3 environmentLight = max(
    directLight + ambientLight + bounceLight,
    vec3(0.0)
  );

  return mix(
    legacyLight,
    environmentLight,
    clamp(uWaterAtmosphereInfluence, 0.0, 1.0)
  );
}

vec3 waterResolveSunLight(vec3 legacySunLight) {
  vec3 environmentSunLight = uTerrainSunCol
    * uTerrainSunIntensity
    * uWaterSunResponse;
  return mix(
    legacySunLight,
    environmentSunLight,
    clamp(uWaterAtmosphereInfluence, 0.0, 1.0)
  );
}

vec3 waterResolveSkyLight(vec3 legacySkyLight) {
  vec3 environmentSkyLight = uTerrainSkyAmb
    * 0.50
    * uWaterAmbientResponse;
  return mix(
    legacySkyLight,
    environmentSkyLight,
    clamp(uWaterAtmosphereInfluence, 0.0, 1.0)
  );
}

vec3 waterResolveFoamColor(vec3 foamColor, vec3 resolvedLight) {
  vec3 environmentLight = max(resolvedLight, vec3(0.0));
  float environmentPeak = max(
    max(environmentLight.r, environmentLight.g),
    environmentLight.b
  );

  // Preserve the environment's hue when lifting very dark foam. The previous
  // mix from vec3(1.0) left a large neutral-white term (35% at the default
  // setting), which became a bright emissive-looking outline after gamma.
  vec3 environmentTint = environmentPeak > 0.0001
    ? environmentLight / environmentPeak
    : vec3(0.30, 0.38, 0.50);
  float readabilityFloor = mix(
    0.12,
    0.015,
    clamp(uWaterFoamLighting, 0.0, 1.0)
  );
  vec3 foamLight = max(
    environmentLight,
    environmentTint * readabilityFloor
  );
  return foamColor * foamLight;
}
`;

export function createWaterLightingUniforms() {
  return {
    uWaterAtmosphereInfluence: { value: 1.0 },
    uWaterSunResponse: { value: 1.0 },
    uWaterAmbientResponse: { value: 1.0 },
    uWaterFoamLighting: { value: 0.65 },
  };
}

export function applyWaterLightingUniforms(uniforms, params = {}) {
  if (!uniforms) return;
  if (uniforms.uWaterAtmosphereInfluence) {
    uniforms.uWaterAtmosphereInfluence.value =
      params.waterAtmosphereInfluence ?? 1.0;
  }
  if (uniforms.uWaterSunResponse) {
    uniforms.uWaterSunResponse.value = params.waterSunResponse ?? 1.0;
  }
  if (uniforms.uWaterAmbientResponse) {
    uniforms.uWaterAmbientResponse.value =
      params.waterAmbientResponse ?? 1.0;
  }
  if (uniforms.uWaterFoamLighting) {
    uniforms.uWaterFoamLighting.value = params.waterFoamLighting ?? 0.65;
  }
}
