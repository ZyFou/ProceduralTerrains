// ============================================================================
// Physically-inspired single-pass water optics used by Realistic Water V2.
// ============================================================================

export const WATER_OPTICS_GLSL = /* glsl */ `
const float WATER_PI = 3.141592653589793;
const float WATER_F0 = 0.02037;

float waterSchlickFresnel(vec3 normal, vec3 viewDir, float strength) {
  float noV = clamp(dot(normal, viewDir), 0.0, 1.0);
  float schlick = WATER_F0 + (1.0 - WATER_F0) * pow(1.0 - noV, 5.0);
  return clamp(WATER_F0 + (schlick - WATER_F0) * max(strength, 0.0), 0.0, 1.0);
}

vec3 waterAbsorptionCoefficients(
  vec3 deepColor,
  float absorptionStrength,
  float density,
  float depthOpacityStrength
) {
  vec3 safeColor = max(deepColor, vec3(0.0001));
  float peak = max(max(safeColor.r, safeColor.g), safeColor.b);
  vec3 penetrationTint = safeColor / max(peak, 0.0001);

  // The palette's strongest channel penetrates farthest. A wavelength bias
  // still removes red first for neutral palettes, matching the underwater pass.
  vec3 wavelengthBias = vec3(0.018, 0.014, 0.010);
  vec3 paletteAbsorption = (vec3(1.0) - penetrationTint)
    * vec3(0.110, 0.055, 0.028);
  float userDensity = mix(0.35, 1.65, clamp(density, 0.0, 1.0));
  return (wavelengthBias + paletteAbsorption)
    * max(absorptionStrength, 0.001)
    * userDensity
    * max(depthOpacityStrength, 0.05);
}

vec3 waterBeerLambert(vec3 absorptionRGB, float opticalDepth) {
  return exp(-absorptionRGB * max(opticalDepth, 0.0));
}

float waterVolumeOpacity(vec3 transmittance) {
  return clamp(1.0 - dot(transmittance, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
}

float waterGgxSunSpecular(
  vec3 normal,
  vec3 viewDir,
  vec3 lightDir,
  float roughness
) {
  float noV = max(dot(normal, viewDir), 0.001);
  float noL = max(dot(normal, lightDir), 0.0);
  if (noL <= 0.0) return 0.0;

  vec3 halfDir = normalize(viewDir + lightDir);
  float noH = max(dot(normal, halfDir), 0.0);
  float voH = max(dot(viewDir, halfDir), 0.0);
  float alpha = max(roughness * roughness, 0.0025);
  float alpha2 = alpha * alpha;
  float denom = noH * noH * (alpha2 - 1.0) + 1.0;
  float distribution = alpha2 / max(WATER_PI * denom * denom, 0.0001);

  float k = (roughness + 1.0);
  k = k * k * 0.125;
  float gv = noV / (noV * (1.0 - k) + k);
  float gl = noL / (noL * (1.0 - k) + k);
  float fresnel = WATER_F0 + (1.0 - WATER_F0) * pow(1.0 - voH, 5.0);
  return distribution * gv * gl * fresnel * noL / max(4.0 * noV * noL, 0.001);
}
`;
