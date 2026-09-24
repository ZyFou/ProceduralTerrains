// ============================================================================
// Coherent directional wave normals: swell + cross-wave + capillary ripple.
// Analytic waves are shaped by two broad noise samples plus micro detail.
// ============================================================================

export const WATER_WAVE_SCALE_COMPATIBILITY = Object.freeze({
  domainScale: 0.055,
  largeMultiplier: 3.2,
  mediumMultiplier: 7.4,
  tertiaryMultiplier: 13.0,
});

/**
 * Approximate crest-to-trough spacing in world units. This is comparable to
 * one lattice transition in the previous value-noise surface.
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

// Shared analytic field for Cinematic vertex displacement and fragment
// whitecaps. It deliberately uses the same legacy domain scale as the normal
// field, so geometry movement does not make the waves look larger.
export const WATER_GEOMETRY_WAVES_GLSL = /* glsl */ `
vec2 waterGeometryRotateDirection(vec2 direction, float radians) {
  float c = cos(radians);
  float s = sin(radians);
  return vec2(
    direction.x * c - direction.y * s,
    direction.x * s + direction.y * c
  );
}

void waterGeometryPhases(
  vec2 xz,
  float t,
  out vec2 dirA,
  out vec2 dirB,
  out vec2 dirC,
  out float phaseA,
  out float phaseB,
  out float phaseC
) {
  dirA = normalize(uWaveDir);
  dirB = waterGeometryRotateDirection(dirA, 0.6108652);
  dirC = waterGeometryRotateDirection(dirA, 0.9250245);
  // Bend the three analytic wave trains over broad, incommensurate regions.
  // This only perturbs phase direction; the legacy-compatible local
  // frequencies below remain unchanged.
  float macroA = sin(
    dot(xz, vec2(0.00417, 0.00531))
      + t * max(uWaveSpeed, 0.0) * 0.027
  );
  float macroB = sin(
    dot(xz, vec2(-0.00613, 0.00377))
      - t * max(uWaveSpeed, 0.0) * 0.019
      + macroA * 0.43
  );
  float macroC = cos(
    dot(xz, vec2(0.00289, -0.00719))
      + t * max(uWaveSpeed, 0.0) * 0.013
      - macroB * 0.37
  );
  vec2 waveXZ = xz + vec2(
    macroA + macroC * 0.46,
    macroB - macroA * 0.38
  ) * 7.0;
  float domain = ${WATER_WAVE_SCALE_COMPATIBILITY.domainScale}
    * max(uWaveScale, 0.2);
  float speed = uWaveSpeed;
  phaseA = dot(waveXZ, dirA) * domain
    * ${WATER_WAVE_SCALE_COMPATIBILITY.largeMultiplier}
    + t * speed * 3.1
    + macroB * 0.42;
  phaseB = dot(waveXZ, dirB) * domain * 4.15
    - t * speed * 2.6
    - macroA * 0.36;
  phaseC = dot(waveXZ, dirC) * domain * 6.1
    + t * speed * 4.3
    + macroC * 0.48;
}

float waterCinematicCrest(vec2 xz, float t) {
  vec2 dirA;
  vec2 dirB;
  vec2 dirC;
  float phaseA;
  float phaseB;
  float phaseC;
  waterGeometryPhases(
    xz,
    t,
    dirA,
    dirB,
    dirC,
    phaseA,
    phaseB,
    phaseC
  );
  float combined = sin(phaseA) * 0.56
    + sin(phaseB) * 0.29
    + sin(phaseC) * 0.15;
  return clamp(combined * 0.5 + 0.5, 0.0, 1.0);
}

vec3 waterCinematicDisplacement(vec2 xz, float t, out float crest) {
  vec2 dirA;
  vec2 dirB;
  vec2 dirC;
  float phaseA;
  float phaseB;
  float phaseC;
  waterGeometryPhases(
    xz,
    t,
    dirA,
    dirB,
    dirC,
    phaseA,
    phaseB,
    phaseC
  );

  float strength = uWaveStrength * uWaveComplexity;
  float mediumWeight = mix(uLargeWaveStr, uSmallWaveStr, 0.65);
  float ampA = 0.52 * uLargeWaveStr * strength;
  float ampB = 0.30 * uLargeWaveStr * strength;
  float ampC = 0.16 * mediumWeight * strength;
  float horizontal = 0.22;
  vec2 xzOffset = dirA * cos(phaseA) * ampA * horizontal;
  xzOffset += dirB * cos(phaseB) * ampB * horizontal;
  xzOffset += dirC * cos(phaseC) * ampC * horizontal;
  float height = sin(phaseA) * ampA
    + sin(phaseB) * ampB
    + sin(phaseC) * ampC;
  crest = clamp(
    (sin(phaseA) * 0.56 + sin(phaseB) * 0.29 + sin(phaseC) * 0.15)
      * 0.5 + 0.5,
    0.0,
    1.0
  );
  return vec3(xzOffset.x, height, xzOffset.y);
}
`;

export const WATER_WAVES_GLSL = /* glsl */ `
// Slope variance removed by footprint filtering in waterDirectionalNormal().
// waterFilteredRoughness() folds it back into GGX roughness (LEAN-style), so
// sub-pixel ripples become broad glitter instead of moire bands.
float waterNormalLostVariance = 0.0;

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

// One wave train of the iterative ocean spectrum. Sharp exp(sin) crests,
// deep-water dispersion (short waves travel slower), a wind-aligned spread
// that widens for small waves, and a drag on the sample point so finer
// chop rides and bunches on the longer waves. Bands below the pixel
// footprint fade out and hand their slope variance to the roughness.
void waterSpectrumBand(
  inout vec2 p,
  inout vec2 slope,
  inout float lost,
  vec2 primary,
  float k,
  float kBase,
  float band,
  float index,
  float t,
  float speed,
  float footprint,
  float fineDetail,
  float mediumWeight,
  float largePatchA,
  float largePatchB,
  float mediumPatchA,
  float mediumPatchB,
  float smallPatch,
  float regionalShift
) {
  float odd = step(0.5, fract(index * 0.5));
  // Golden-ratio direction sequence around the wind, never repeating.
  float spread = mix(0.45, 1.55, band);
  float angle = (fract(index * 0.6180340 + 0.137) * 2.0 - 1.0) * spread;
  vec2 dir = waterRotateDirection(primary, angle);

  float energy = mix(uLargeWaveStr, mediumWeight, smoothstep(0.0, 0.45, band));
  energy = mix(energy, uSmallWaveStr, smoothstep(0.45, 1.0, band));
  float patchA = mix(largePatchA, mediumPatchA, smoothstep(0.0, 0.5, band));
  float patchB = mix(largePatchB, mediumPatchB, smoothstep(0.0, 0.5, band));
  float regional = mix(mix(patchA, patchB, odd), smallPatch, smoothstep(0.5, 1.0, band));
  // Finest chop follows the quality/detail knobs and distance fade.
  float amp = 0.085 * energy * regional
    * mix(1.0, fineDetail, smoothstep(0.55, 1.0, band));

  float f = waterBandFilter(k, footprint);
  float omega = 3.1 * speed * sqrt(k / kBase);
  float phase = dot(dir, p) * k
    + t * omega
    + index * 1.9173
    + regionalShift * (0.6 + band);
  float wave = exp(sin(phase) - 1.0);
  float dWave = wave * cos(phase);
  slope += dir * dWave * amp * f;
  // E[(exp(sin - 1) cos)^2] ~= 0.09
  lost += amp * amp * 0.09 * (1.0 - f * f);
  p -= dir * dWave * 0.42 / k;
}

vec3 waterDirectionalNormal(vec2 xz, float t, float cameraDistance, float roughness) {
  vec2 primary = normalize(uWaveDir);
  vec2 mediumB = waterRotateDirection(primary, 1.3089969);   // 75 degrees
  float scale = max(uWaveScale, 0.2);
  float speed = uWaveSpeed;

  // Preserve the original shader's 0.055 world-to-wave domain. The analytic
  // multipliers reproduce its roughly 18-unit primary and 7-unit secondary
  // feature spacing (half a sine cycle), so existing Wave Scale values retain
  // their previous visual size instead of producing oversized ocean swells.
  float legacyDomainScale = ${WATER_WAVE_SCALE_COMPATIBILITY.domainScale} * scale;

  // Bend the wave fronts and vary their energy over very broad regions. These
  // incommensurate fields are intentionally much larger than the visible wave
  // features: they break up ruler-straight bands without changing ripple size.
  float macroPhaseA = dot(xz, vec2(0.00417, 0.00531))
    + t * speed * 0.027;
  float macroPhaseB = dot(xz, vec2(-0.00613, 0.00377))
    - t * speed * 0.019;
  float macroPhaseC = dot(xz, vec2(0.00289, -0.00719))
    + t * speed * 0.013;
  float macroA = sin(macroPhaseA);
  float macroB = sin(macroPhaseB + macroA * 0.43);
  float macroC = cos(macroPhaseC - macroB * 0.37);
  vec2 macroWarp = vec2(
    macroA + macroC * 0.46,
    macroB - macroA * 0.38
  ) * 8.0;

  // Smooth hash noise keeps the broad energy patches aperiodic. The two
  // samples use different domains so no wave family remains dominant across
  // the full tile.
  vec2 regionalP = xz * (legacyDomainScale * 0.065)
    + primary * t * speed * 0.012;
  vec2 regionalQ = waterRotateDirection(xz, 1.1170107)
    * (legacyDomainScale * 0.093)
    - mediumB * t * speed * 0.009;
  float regionalA = smoothstep(0.08, 0.92, vnoise(regionalP));
  float regionalB = smoothstep(0.08, 0.92, vnoise(regionalQ));
  vec2 regionalWarp = (vec2(regionalA, regionalB) - 0.5) * 9.0;
  vec2 waveXZ = xz + macroWarp + regionalWarp;

  float largePatchA = mix(
    0.44,
    1.0,
    clamp(regionalA * 0.68 + (0.5 + 0.5 * macroA) * 0.32, 0.0, 1.0)
  );
  float largePatchB = mix(
    0.44,
    1.0,
    clamp(regionalB * 0.66 + (0.5 - 0.5 * macroB) * 0.34, 0.0, 1.0)
  );
  float mediumPatchA = mix(
    0.58,
    1.0,
    clamp(
      regionalB * 0.52 + regionalA * 0.18 + (0.5 + 0.5 * macroC) * 0.30,
      0.0,
      1.0
    )
  );
  float mediumPatchB = mix(
    0.58,
    1.0,
    clamp(
      regionalA * 0.48 + (1.0 - regionalB) * 0.22
        + (0.5 - 0.5 * macroA) * 0.30,
      0.0,
      1.0
    )
  );
  float smallPatch = mix(
    0.68,
    1.0,
    clamp(
      (regionalA + regionalB) * 0.33 + (0.5 + 0.5 * macroB) * 0.34,
      0.0,
      1.0
    )
  );

  // Ocean spectrum: 12 wave trains from the legacy ~18-unit swell down to
  // ~1-unit capillary chop (x1.3 wavenumber per band).
  // Each train has a sharp exp(sin) crest profile, deep-water dispersion
  // (short waves travel slower) and a wind-aligned spread that widens for
  // small waves. Each band also drags the sample point for the next one, so
  // short chop rides and bunches on the longer waves instead of forming a
  // uniform grid. Bands below the pixel footprint are faded and their slope
  // variance handed to waterFilteredRoughness().
  float footprint = max(length(fwidth(xz)), 0.0001);
  float microFade = 1.0 - smoothstep(320.0, 1900.0, cameraDistance);
  microFade *= 1.0 - clamp(roughness, 0.0, 1.0) * 0.55;
  float detail = uWaterDetail * uMicroWaveDetail * step(0.5, uWaterQuality);
  float mediumWeight = mix(uLargeWaveStr, uSmallWaveStr, 0.65);
  float kBase = legacyDomainScale
    * ${WATER_WAVE_SCALE_COMPATIBILITY.largeMultiplier};
  vec2 p = waveXZ;
  vec2 slope = vec2(0.0);
  float lost = 0.0;
  // Straight-line band calls, no loop: ANGLE/FXC on Windows stalls for
  // minutes unrolling loops with loop-carried transcendental state.
  waterSpectrumBand(p, slope, lost, primary, kBase * 1.00000, kBase, 0.0000, 0.0, t, speed, footprint, detail * microFade, mediumWeight, largePatchA, largePatchB, mediumPatchA, mediumPatchB, smallPatch, regionalA - regionalB);
  waterSpectrumBand(p, slope, lost, primary, kBase * 1.30000, kBase, 0.0909, 1.0, t, speed, footprint, detail * microFade, mediumWeight, largePatchA, largePatchB, mediumPatchA, mediumPatchB, smallPatch, regionalA - regionalB);
  waterSpectrumBand(p, slope, lost, primary, kBase * 1.69000, kBase, 0.1818, 2.0, t, speed, footprint, detail * microFade, mediumWeight, largePatchA, largePatchB, mediumPatchA, mediumPatchB, smallPatch, regionalA - regionalB);
  waterSpectrumBand(p, slope, lost, primary, kBase * 2.19700, kBase, 0.2727, 3.0, t, speed, footprint, detail * microFade, mediumWeight, largePatchA, largePatchB, mediumPatchA, mediumPatchB, smallPatch, regionalA - regionalB);
  waterSpectrumBand(p, slope, lost, primary, kBase * 2.85610, kBase, 0.3636, 4.0, t, speed, footprint, detail * microFade, mediumWeight, largePatchA, largePatchB, mediumPatchA, mediumPatchB, smallPatch, regionalA - regionalB);
  waterSpectrumBand(p, slope, lost, primary, kBase * 3.71293, kBase, 0.4545, 5.0, t, speed, footprint, detail * microFade, mediumWeight, largePatchA, largePatchB, mediumPatchA, mediumPatchB, smallPatch, regionalA - regionalB);
  waterSpectrumBand(p, slope, lost, primary, kBase * 4.82681, kBase, 0.5455, 6.0, t, speed, footprint, detail * microFade, mediumWeight, largePatchA, largePatchB, mediumPatchA, mediumPatchB, smallPatch, regionalA - regionalB);
  waterSpectrumBand(p, slope, lost, primary, kBase * 6.27485, kBase, 0.6364, 7.0, t, speed, footprint, detail * microFade, mediumWeight, largePatchA, largePatchB, mediumPatchA, mediumPatchB, smallPatch, regionalA - regionalB);
  waterSpectrumBand(p, slope, lost, primary, kBase * 8.15731, kBase, 0.7273, 8.0, t, speed, footprint, detail * microFade, mediumWeight, largePatchA, largePatchB, mediumPatchA, mediumPatchB, smallPatch, regionalA - regionalB);
  waterSpectrumBand(p, slope, lost, primary, kBase * 10.60450, kBase, 0.8182, 9.0, t, speed, footprint, detail * microFade, mediumWeight, largePatchA, largePatchB, mediumPatchA, mediumPatchB, smallPatch, regionalA - regionalB);
  waterSpectrumBand(p, slope, lost, primary, kBase * 13.78585, kBase, 0.9091, 10.0, t, speed, footprint, detail * microFade, mediumWeight, largePatchA, largePatchB, mediumPatchA, mediumPatchB, smallPatch, regionalA - regionalB);
  waterSpectrumBand(p, slope, lost, primary, kBase * 17.92160, kBase, 1.0000, 11.0, t, speed, footprint, detail * microFade, mediumWeight, largePatchA, largePatchB, mediumPatchA, mediumPatchB, smallPatch, regionalA - regionalB);
  waterNormalLostVariance = lost;

  float strength = uNormalIntensity * uWaveStrength * uWaveComplexity;
  return normalize(vec3(-slope.x * strength, 1.0, -slope.y * strength));
}
`;
