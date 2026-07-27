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
vec2 waterRotateDirection(vec2 direction, float radians) {
  float c = cos(radians);
  float s = sin(radians);
  return vec2(
    direction.x * c - direction.y * s,
    direction.x * s + direction.y * c
  );
}

vec3 waterDirectionalNormal(vec2 xz, float t, float cameraDistance, float roughness) {
  vec2 primary = normalize(uWaveDir);
  vec2 primaryB = waterRotateDirection(primary, 0.6108652);  // 35 degrees
  vec2 mediumA = waterRotateDirection(primary, 0.9250245);   // 53 degrees
  vec2 mediumB = waterRotateDirection(primary, 1.3089969);   // 75 degrees
  vec2 smallA = waterRotateDirection(primary, -0.8203047);   // -47 degrees
  vec2 smallB = waterRotateDirection(primary, 2.1467550);    // 123 degrees
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

  float bend = sin(
    dot(waveXZ, mediumA) * legacyDomainScale * 1.37
    - t * speed * 0.65
    + macroC * 0.34
  );
  float largePhaseA = dot(waveXZ, primary) * legacyDomainScale
    * ${WATER_WAVE_SCALE_COMPATIBILITY.largeMultiplier}
    + t * speed * 3.1
    + bend * 0.62
    + macroB * 0.48
    + (regionalB - 0.5) * 0.86;
  float largePhaseB = dot(waveXZ, primaryB) * legacyDomainScale * 4.15
    - t * speed * 2.6
    - bend * 0.38
    - macroA * 0.42
    - (regionalA - 0.5) * 0.74;
  float mediumPhaseA = dot(waveXZ, mediumA) * legacyDomainScale * 6.1
    + t * speed * 4.3
    + sin(largePhaseB * 0.41) * 0.28
    + macroC * 0.55
    + (regionalA - regionalB) * 0.46;
  float mediumPhaseB = dot(waveXZ, mediumB) * legacyDomainScale
    * ${WATER_WAVE_SCALE_COMPATIBILITY.mediumMultiplier}
    - t * speed * 3.7
    - sin(largePhaseA * 0.37) * 0.24
    - macroB * 0.38
    + (regionalA + regionalB - 1.0) * 0.39;
  float smallPhaseA = dot(waveXZ, smallA) * legacyDomainScale * 9.6
    + t * speed * 5.6
    + macroA * 0.29;
  float smallPhaseB = dot(waveXZ, smallB) * legacyDomainScale
    * ${WATER_WAVE_SCALE_COMPATIBILITY.tertiaryMultiplier.toFixed(1)}
    - t * speed * 6.8
    - macroC * 0.33;

  float mediumWeight = mix(uLargeWaveStr, uSmallWaveStr, 0.65);
  vec2 slope = primary * cos(largePhaseA) * 0.060
    * uLargeWaveStr * largePatchA;
  slope += primaryB * cos(largePhaseB) * 0.050
    * uLargeWaveStr * largePatchB;
  slope += mediumA * cos(mediumPhaseA) * 0.045
    * mediumWeight * mediumPatchA;
  slope += mediumB * cos(mediumPhaseB) * 0.035
    * mediumWeight * mediumPatchB;
  slope += smallA * cos(smallPhaseA) * 0.025
    * uSmallWaveStr * smallPatch;
  slope += smallB * cos(smallPhaseB) * 0.018
    * uSmallWaveStr * smallPatch;

  float microFade = 1.0 - smoothstep(320.0, 1900.0, cameraDistance);
  microFade *= 1.0 - clamp(roughness, 0.0, 1.0) * 0.55;
  if (uWaterQuality > 0.5 && microFade > 0.001) {
    vec2 microXZ = xz + macroWarp * 0.35;
    vec2 microP = microXZ * (legacyDomainScale * 2.6)
      + primary * t * speed * 0.75
      - mediumA * t * speed * 0.35;
    float epsilon = 0.18;
    float center = vnoise(microP);
    float dx = vnoise(microP + vec2(epsilon, 0.0)) - center;
    float dz = vnoise(microP + vec2(0.0, epsilon)) - center;
    slope += vec2(dx, dz) * (0.20 / epsilon)
      * uSmallWaveStr * uWaterDetail * uMicroWaveDetail
      * smallPatch * microFade;
  }

  float strength = uNormalIntensity * uWaveStrength * uWaveComplexity;
  return normalize(vec3(-slope.x * strength, 1.0, -slope.y * strength));
}
`;
