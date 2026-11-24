// ============================================================================
// Realistic water wave field: a peaked wind sea of 20 Gerstner trains.
//
// The 12 longest trains carry the swell and can displace geometry (Cinematic);
// the 8 shortest exist only for shading. Every train contributes analytic
// derivatives, so one pass yields the normal, the fold Jacobian (where the
// surface pinches into whitecaps) and the wave height. Trains shorter than
// the pixel footprint fade out and hand their slope variance to the roughness
// instead of aliasing. Gradient-noise ripples add the capillary detail.
// ============================================================================

export const WATER_WAVE_SCALE_COMPATIBILITY = Object.freeze({
  domainScale: 0.055,
  largeMultiplier: 3.2,
  mediumMultiplier: 7.4,
  tertiaryMultiplier: 13.0,
});

/**
 * Approximate crest-to-trough spacing in world units. The primary swell keeps
 * the wavenumber of the pre-Gerstner surface, so Wave Scale reads the same.
 */
export function getWaterWaveFeatureSpacing(waveScale = 1) {
  const scale = Math.max(Number.isFinite(waveScale) ? waveScale : 1, 0.2);
  const domain = WATER_WAVE_SCALE_COMPATIBILITY.domainScale * scale;
  return {
    large: Math.PI / (domain * WATER_WAVE_SCALE_COMPATIBILITY.largeMultiplier),
    medium: Math.PI / (domain * WATER_WAVE_SCALE_COMPATIBILITY.mediumMultiplier),
    tertiary: Math.PI / (domain * WATER_WAVE_SCALE_COMPATIBILITY.tertiaryMultiplier),
  };
}

// Wavelengths relative to the primary swell, steepness (wavenumber x
// amplitude) and heading offset from the wind for each train.
const TRAIN_WAVELENGTH = [137, 109, 89, 71, 57, 45, 35, 27, 20.5, 15.5, 11.5, 8.3,
  5.9, 4.2, 3.0, 2.15, 1.55, 1.1, 0.8, 0.56];
const TRAIN_STEEPNESS = [0.030, 0.044, 0.058, 0.066, 0.068, 0.068, 0.066, 0.064, 0.062, 0.060, 0.058, 0.056,
  0.052, 0.050, 0.047, 0.044, 0.042, 0.040, 0.038, 0.036];
const TRAIN_HEADING = [-0.12, 0.31, -0.47, 0.07, 0.58, -0.29, 0.41, -0.66, 0.19, 0.83, -0.92, -0.05,
  0.95, -1.05, 0.55, -0.6, 1.25, -1.35, 0.2, -0.3];

/** Trains that displace Cinematic geometry (the rest only shade). */
export const WATER_GERSTNER_GEOMETRY_TRAINS = 8;
/** Wave gain at Wave Strength 1 (the reference sea state). */
export const WATER_GERSTNER_REFERENCE_GAIN = 1.15;

export const WATER_GERSTNER_TRAINS = (() => {
  let seed = 1337;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  return TRAIN_WAVELENGTH.map((wavelength, index) => ({
    index,
    kRatio: TRAIN_WAVELENGTH[0] / wavelength,
    steepness: TRAIN_STEEPNESS[index],
    heading: TRAIN_HEADING[index],
    phase: random() * Math.PI * 2,
  }));
})();

const STEEPNESS_SUM = TRAIN_STEEPNESS.reduce((sum, value) => sum + value, 0);
// wavenumber of the reference primary swell, per reference metre
const REFERENCE_PRIMARY_K = (2 * Math.PI) / TRAIN_WAVELENGTH[0];

const glslFloat = (value) => {
  const text = Number(value).toFixed(6);
  return text.includes('.') ? text : `${text}.0`;
};

const trainArguments = (train) => [
  glslFloat(train.kRatio),
  glslFloat(Math.sqrt(train.kRatio)),
  glslFloat(Math.cos(train.heading)),
  glslFloat(Math.sin(train.heading)),
  glslFloat(train.steepness),
  glslFloat(train.phase),
].join(', ');

// Train energy follows the Large / Small wave sliders and the regional sea
// state: swell uses the large patches, chop the medium ones, capillaries the
// gust-driven small patch (and the quality / distance detail fade).
const shadeCall = (train) => {
  const energy = train.index < 5
    ? (train.index % 2 ? 'largeGainB' : 'largeGainA')
    : train.index < 12
      ? (train.index % 2 ? 'mediumGainB' : 'mediumGainA')
      : 'smallGain';
  return `  waterGerstnerShade(slope, fold, height, lost, waveXZ, primary, kBase, t, omegaBase, footprint, ${energy}, chop, ${trainArguments(train)});`;
};

const displaceCall = (train) =>
  `  waterGerstnerDisplace(offset, waveXZ, primary, kBase, t, omegaBase, gain, chop, ${trainArguments(train)});`;

// Shared by the vertex and fragment stages (and by any material that only
// includes WATER_WAVES_GLSL), hence the include guard.
const WATER_GERSTNER_CORE_GLSL = /* glsl */ `
#ifndef WATER_GERSTNER_CORE
#define WATER_GERSTNER_CORE
vec2 waterGerstnerRotate(vec2 direction, float c, float s) {
  return vec2(direction.x * c - direction.y * s, direction.x * s + direction.y * c);
}

// Bend the wave fronts over broad, incommensurate regions so crest lines
// curve instead of tiling as parallel rulings. Analytic, so displaced
// geometry and per-pixel shading read exactly the same field.
vec2 waterGerstnerDomain(vec2 xz, float t) {
  float speed = max(uWaveSpeed, 0.0);
  float macroA = sin(dot(xz, vec2(0.00417, 0.00531)) + t * speed * 0.027);
  float macroB = sin(dot(xz, vec2(-0.00613, 0.00377)) - t * speed * 0.019 + macroA * 0.43);
  float macroC = cos(dot(xz, vec2(0.00289, -0.00719)) + t * speed * 0.013 - macroB * 0.37);
  return xz + vec2(macroA + macroC * 0.46, macroB - macroA * 0.38) * 8.0;
}

// Horizontal pinch that keeps the summed steepness just below self-intersection.
float waterGerstnerChop(float gain) {
  return min(1.0, 0.95 / max(${glslFloat(STEEPNESS_SUM)} * gain, 1e-3));
}
#endif
`;

// Vertex displacement for the Cinematic tier: the longest trains of the same
// sea the fragment shades.
export const WATER_GEOMETRY_WAVES_GLSL = /* glsl */ `
${WATER_GERSTNER_CORE_GLSL}

void waterGerstnerDisplace(
  inout vec3 offset,
  vec2 p,
  vec2 primary,
  float kBase,
  float t,
  float omegaBase,
  float gain,
  float chop,
  float kRatio,
  float omegaRatio,
  float headingCos,
  float headingSin,
  float steepness,
  float phase0
) {
  float k = kBase * kRatio;
  vec2 dir = waterGerstnerRotate(primary, headingCos, headingSin);
  float phase = k * dot(dir, p) - omegaBase * omegaRatio * t + phase0;
  float amplitude = steepness * gain / k;
  offset.xz += dir * (chop * amplitude * cos(phase));
  offset.y += amplitude * sin(phase);
}

vec3 waterCinematicDisplacement(vec2 xz, float t, out float crest) {
  vec2 primary = normalize(uWaveDir);
  float kBase = ${WATER_WAVE_SCALE_COMPATIBILITY.domainScale} * max(uWaveScale, 0.2)
    * ${WATER_WAVE_SCALE_COMPATIBILITY.largeMultiplier};
  float omegaBase = 1.25 * uWaveSpeed;
  float seaState = ${glslFloat(WATER_GERSTNER_REFERENCE_GAIN)} * uWaveStrength * uWaveComplexity;
  float chop = waterGerstnerChop(seaState);
  // geometry carries the mean regional energy of the swell
  float gain = seaState * uLargeWaveStr * 0.8;
  vec2 waveXZ = waterGerstnerDomain(xz, t);
  vec3 offset = vec3(0.0);
${WATER_GERSTNER_TRAINS.slice(0, WATER_GERSTNER_GEOMETRY_TRAINS).map(displaceCall).join('\n')}
  float reference = max(gain, 0.05) * 1.6 * ${glslFloat(REFERENCE_PRIMARY_K)} / kBase;
  crest = clamp(0.5 + 0.5 * offset.y / reference, 0.0, 1.0);
  return offset;
}
`;

export const WATER_WAVES_GLSL = /* glsl */ `
${WATER_GERSTNER_CORE_GLSL}

// Slope variance removed by footprint filtering in waterDirectionalNormal().
// waterFilteredRoughness() folds it back into GGX roughness (LEAN-style), so
// sub-pixel waves become broad glitter instead of moire bands.
float waterNormalLostVariance = 0.0;
// Set by the caller before waterDirectionalNormal(): 0 = sheltered / shoaling
// water where the sea state dies down, 1 = open water.
float waterWaveShelter = 1.0;
// Results of waterDirectionalNormal() besides the normal itself:
// fold Jacobian (1 = flat, towards 0 = the surface pinches into a breaking
// crest) and the resolved wave height remapped to 0 (trough) .. 1 (crest).
float waterWaveFold = 1.0;
float waterWaveCrest = 0.5;

// 1 while a wave band's wavenumber (rad / world unit) is resolvable at this
// pixel footprint, fading to 0 well before the Nyquist limit.
float waterBandFilter(float wavenumber, float footprint) {
  return 1.0 - smoothstep(0.45, 1.6, wavenumber * footprint);
}

float waterFilteredRoughness(float roughness, float normalStrength) {
  float alpha = roughness * roughness;
  float alpha2 = alpha * alpha
    + 2.0 * waterNormalLostVariance * normalStrength * normalStrength;
  return clamp(sqrt(sqrt(alpha2)), roughness, 1.0);
}

vec2 waterRotateDirection(vec2 direction, float radians) {
  float c = cos(radians);
  float s = sin(radians);
  return vec2(
    direction.x * c - direction.y * s,
    direction.x * s + direction.y * c
  );
}

// Sine-free hash: stable at large world coordinates.
float waterWaveHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Quintic value noise with its analytic gradient: x = value, yz = d/dp.
// Non-periodic, so ripples built from it never line up into a visible grid.
vec3 waterNoiseD(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = waterWaveHash(i);
  float b = waterWaveHash(i + vec2(1.0, 0.0));
  float c = waterWaveHash(i + vec2(0.0, 1.0));
  float d = waterWaveHash(i + vec2(1.0, 1.0));
  float k1 = b - a;
  float k2 = c - a;
  float k4 = a - b - c + d;
  return vec3(
    a + k1 * u.x + k2 * u.y + k4 * u.x * u.y,
    du * vec2(k1 + k4 * u.y, k2 + k4 * u.x)
  );
}

// Wind gusts ("cat's paws"): drifting patches where the wind roughens the
// surface, separated by glassy slicks. Stretched along the wind so slicks form
// streaks. 0 = calm slick, 1 = full gust.
float waterGustMask(vec2 xz, vec2 primary, float t, float speed, float scale) {
  vec2 across = vec2(-primary.y, primary.x);
  vec2 windFrame = vec2(dot(xz, primary), dot(xz, across));
  vec2 gp = windFrame * vec2(0.0042, 0.0105) * mix(1.0, scale, 0.5)
    - vec2(t * max(speed, 0.0) * 0.045, 0.0);
  float broad = vnoise(gp);
  float fine = vnoise(gp * 2.7 + vec2(13.7, -7.3));
  return smoothstep(0.30, 0.78, broad * 0.68 + fine * 0.32);
}

// Capillary ripples from rotated gradient-noise octaves. Each octave lives in
// its own wind-aligned, anisotropic frame (crests run across the wind) and
// drifts downwind, filling the gaps between the analytic trains.
void waterRippleOctave(
  inout vec2 slope,
  inout float lost,
  vec2 xz,
  vec2 primary,
  float angle,
  float frequency,
  float amp,
  float drift,
  float t,
  float footprint,
  vec2 seed
) {
  vec2 along = waterRotateDirection(primary, angle);
  vec2 across = vec2(-along.y, along.x);
  vec2 stretch = vec2(1.0, 0.42) * frequency;
  vec2 q = vec2(dot(xz, along), dot(xz, across)) * stretch
    - vec2(t * drift * frequency, 0.0) + seed;
  vec3 noise = waterNoiseD(q);
  // Chain rule back to world XZ: grad_xz = M^T * grad_q.
  vec2 gradQ = noise.yz * stretch;
  vec2 gradXZ = along * gradQ.x + across * gradQ.y;
  float f = waterBandFilter(6.2831853 * frequency, footprint);
  slope += gradXZ / max(frequency, 0.0001) * amp * f;
  lost += amp * amp * 0.35 * (1.0 - f * f);
}

// One Gerstner train: slope, fold terms (second derivatives of the horizontal
// pinch) and height. Deep-water dispersion: short waves travel slower. A
// train below the pixel footprint only adds its variance to the roughness.
void waterGerstnerShade(
  inout vec2 slope,
  inout vec3 fold,
  inout float height,
  inout float lost,
  vec2 p,
  vec2 primary,
  float kBase,
  float t,
  float omegaBase,
  float footprint,
  float gain,
  float chop,
  float kRatio,
  float omegaRatio,
  float headingCos,
  float headingSin,
  float steepness,
  float phase0
) {
  float k = kBase * kRatio;
  float ka = steepness * gain;
  float f = waterBandFilter(k, footprint);
  lost += 0.5 * ka * ka * (1.0 - f * f);
  if (f > 0.0) {
    vec2 dir = waterGerstnerRotate(primary, headingCos, headingSin);
    float phase = k * dot(dir, p) - omegaBase * omegaRatio * t + phase0;
    float s = sin(phase);
    float c = cos(phase);
    ka *= f;
    slope += dir * (ka * c);
    fold += vec3(dir.x * dir.x, dir.y * dir.y, dir.x * dir.y) * (chop * ka * s);
    height += ka / k * s;
  }
}

vec3 waterDirectionalNormal(vec2 xz, float t, float cameraDistance, float roughness) {
  vec2 primary = normalize(uWaveDir);
  vec2 mediumB = waterRotateDirection(primary, 1.3089969);   // 75 degrees
  float scale = max(uWaveScale, 0.2);
  float speed = uWaveSpeed;

  // The primary swell keeps the original shader's 0.055 world-to-wave domain
  // (about 36 world units per wavelength at Wave Scale 1), so existing Wave
  // Scale values retain their visual size.
  float legacyDomainScale = ${WATER_WAVE_SCALE_COMPATIBILITY.domainScale} * scale;
  float kBase = legacyDomainScale
    * ${WATER_WAVE_SCALE_COMPATIBILITY.largeMultiplier};
  float omegaBase = 1.25 * speed;

  // Curved wave fronts (same analytic warp as the displaced geometry).
  vec2 macroWarp = waterGerstnerDomain(xz, t) - xz;
  vec2 waveXZ = xz + macroWarp;

  // Regional sea state: smooth hash noise keeps the energy patches aperiodic.
  // Two decorrelated fields feed alternate trains, so no single wave family
  // stays dominant across the whole water body (wave groups).
  vec2 regionalP = xz * (legacyDomainScale * 0.065)
    + primary * t * speed * 0.012;
  vec2 regionalQ = waterRotateDirection(xz, 1.1170107)
    * (legacyDomainScale * 0.093)
    - mediumB * t * speed * 0.009;
  float regionalA = smoothstep(0.08, 0.92, vnoise(regionalP));
  float regionalB = smoothstep(0.08, 0.92, vnoise(regionalQ));
  float largePatchA = mix(0.35, 1.30, regionalA);
  float largePatchB = mix(0.35, 1.30, regionalB);
  float mediumPatchA = mix(0.65, 1.15, regionalB * 0.6 + regionalA * 0.4);
  float mediumPatchB = mix(0.65, 1.15, regionalA * 0.6 + (1.0 - regionalB) * 0.4);
  float smallPatch = mix(0.72, 1.0, (regionalA + regionalB) * 0.5);

  // Gusts modulate the chop far more than the swell: slicks stay glassy while
  // the long waves keep rolling through them.
  float gust = waterGustMask(xz, primary, t, speed, scale);
  largePatchA *= mix(0.82, 1.0, gust);
  largePatchB *= mix(0.82, 1.0, gust);
  mediumPatchA *= mix(0.45, 1.08, gust);
  mediumPatchB *= mix(0.45, 1.08, gust);
  smallPatch *= mix(0.22, 1.12, gust);

  float footprint = max(length(fwidth(xz)), 0.0001);
  float microFade = 1.0 - smoothstep(320.0, 1900.0, cameraDistance);
  microFade *= 1.0 - clamp(roughness, 0.0, 1.0) * 0.55;
  float detail = uWaterDetail * uMicroWaveDetail * step(0.5, uWaterQuality);
  float mediumWeight = mix(uLargeWaveStr, uSmallWaveStr, 0.65);

  // Sea state: the reference wind sea at Wave Strength 1, calmed where the
  // caller reports sheltered or shoaling water.
  float seaState = ${glslFloat(WATER_GERSTNER_REFERENCE_GAIN)} * uWaveStrength * uWaveComplexity;
  float chop = waterGerstnerChop(seaState);
  float shelteredGain = seaState * waterWaveShelter;
  float largeGainA = shelteredGain * uLargeWaveStr * largePatchA;
  float largeGainB = shelteredGain * uLargeWaveStr * largePatchB;
  float mediumGainA = shelteredGain * mediumWeight * mediumPatchA;
  float mediumGainB = shelteredGain * mediumWeight * mediumPatchB;
  float smallGain = shelteredGain * uSmallWaveStr * smallPatch * detail * microFade;

  vec2 slope = vec2(0.0);
  vec3 fold = vec3(0.0);
  float height = 0.0;
  float lost = 0.0;
  // Straight-line train calls, no loop: ANGLE/FXC on Windows stalls for
  // minutes unrolling long transcendental loops.
${WATER_GERSTNER_TRAINS.map(shadeCall).join('\n')}

  // Analytic Gerstner normal and fold Jacobian.
  float foldX = 1.0 - fold.x;
  float foldZ = 1.0 - fold.y;
  float jacobian = foldX * foldZ - fold.z * fold.z;
  vec2 gerstnerSlope = vec2(
    slope.x * foldZ + slope.y * fold.z,
    slope.y * foldX + slope.x * fold.z
  );

  // Capillary ripples between the analytic trains: aperiodic, short-crested
  // and wind-aligned. Wavelengths ~6, ~2.6 and ~1.1 units at Wave Scale 1.
  vec2 rippleSlope = vec2(0.0);
  float rippleEnergy = uSmallWaveStr * smallPatch * detail * microFade
    * mix(0.4, 1.0, waterWaveShelter);
  waterRippleOctave(rippleSlope, lost, waveXZ, primary, 0.31, 0.16 * scale, 0.034 * mix(mediumWeight, uSmallWaveStr, 0.5) * mix(0.45, 1.0, gust) * mix(0.4, 1.0, waterWaveShelter), 1.25 * speed, t, footprint, vec2(17.31, -4.77));
  waterRippleOctave(rippleSlope, lost, waveXZ, primary, -0.47, 0.38 * scale, 0.030 * rippleEnergy, 0.85 * speed, t, footprint, vec2(-31.9, 11.4));
  waterRippleOctave(rippleSlope, lost, waveXZ, primary, 0.83, 0.88 * scale, 0.026 * rippleEnergy, 0.55 * speed, t, footprint, vec2(5.2, 47.6));

  waterNormalLostVariance = lost;
  waterWaveFold = jacobian;
  float heightReference = (1.6 * shelteredGain + 0.05) * ${glslFloat(REFERENCE_PRIMARY_K)} / kBase;
  waterWaveCrest = clamp(0.5 + 0.5 * height / heightReference, 0.0, 1.0);

  float strength = uNormalIntensity;
  return normalize(vec3(
    -(gerstnerSlope.x + rippleSlope.x) * strength,
    max(jacobian, 0.2),
    -(gerstnerSlope.y + rippleSlope.y) * strength
  ));
}
`;
