import * as THREE from 'three';
import { COMMON_UNIFORMS_GLSL, WATER_TILE_MASK_GLSL } from '../terrain/terrainGLSL.js';
import { PALETTE_UNIFORMS_GLSL } from '../shaders/terrainColor.glsl.js';
import {
  PROCEDURAL_SKY_UNIFORMS_GLSL,
  PROCEDURAL_SKY_EVALUATION_GLSL,
  createProceduralSkyUniforms,
} from '../sky/proceduralSkyGLSL.js';
import { generateStackGLSL } from '../terrain/noise/noiseStackCodegen.js';
import { defaultLegacyStack } from '../terrain/noise/NoiseStack.js';
import {
  buildWaterHeightShaderParts,
  WATER_TERRAIN_CACHE_GLSL,
} from './waterShaderGLSL.js';
import { WATER_OPTICS_GLSL } from './waterOpticsGLSL.js';
import {
  WATER_GEOMETRY_WAVES_GLSL,
  WATER_WAVES_GLSL,
} from './waterWavesGLSL.js';
import {
  WATER_LIGHTING_UNIFORMS_GLSL,
  createWaterLightingUniforms,
} from './waterLightingGLSL.js';

const DEFAULT_STACK_GLSL = generateStackGLSL(defaultLegacyStack());

// ============================================================================
// Realistic Water Surface V2 — physical depth absorption, coherent directional
// normals, live procedural-sky reflection, roughness-aware sunlight and foam.
// Volumetric/Cinematic tiers can additionally sample a water-free scene capture
// for real screen-space refraction while the surface itself stays single-pass.
// ============================================================================

const VERTEX = /* glsl */ `
uniform float uTime;
uniform float uWaterAnim;
uniform float uWaterTier;
uniform float uWaveComplexity;
uniform float uWaveSpeed;
uniform float uWaveScale;
uniform float uWaveStrength;
uniform float uSmallWaveStr;
uniform float uLargeWaveStr;
uniform vec2 uWaveDir;
uniform float uAnimSpeed;
uniform vec2 uGeometryFocus;
uniform float uGeometryDisplacementEnabled;

varying vec3 vWorldPos;

${WATER_GEOMETRY_WAVES_GLSL}

float waterConcentratedGridAxis(float coordinate, float focus) {
  float u = coordinate + 0.5;
  float densityPower = 1.72;
  if (u < 0.5) {
    float sideT = u * 2.0;
    return focus - (focus + 0.5)
      * pow(max(1.0 - sideT, 0.0), densityPower);
  }
  float sideT = (u - 0.5) * 2.0;
  return focus + (0.5 - focus)
    * pow(max(sideT, 0.0), densityPower);
}

void main() {
  float geometryEnabled = uGeometryDisplacementEnabled
    * step(2.5, uWaterTier);
  vec3 localPosition = position;
  if (geometryEnabled > 0.5) {
    localPosition.x = waterConcentratedGridAxis(
      position.x,
      clamp(uGeometryFocus.x, -0.42, 0.42)
    );
    localPosition.z = waterConcentratedGridAxis(
      position.z,
      clamp(uGeometryFocus.y, -0.42, 0.42)
    );
  }

  vec4 wp = modelMatrix * vec4(localPosition, 1.0);
  if (geometryEnabled > 0.5) {
    float crest;
    float t = uTime * uWaterAnim * uAnimSpeed;
    vec3 displacement = waterCinematicDisplacement(wp.xz, t, crest);
    float distanceFade = 1.0 - smoothstep(
      900.0,
      2200.0,
      length(cameraPosition.xz - wp.xz)
    );
    wp.xyz += displacement * distanceFade;
  }
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const buildFragment = (stackGLSL, infinite = false) => {
  const { dependencies, terrainHeightFunction } = buildWaterHeightShaderParts(stackGLSL, infinite);
  const biomeClimateFunction = infinite
    ? /* glsl */ `
vec4 waterBiomeClimateAt(vec2 xz) {
  float available = 0.0;
  vec4 field = infiniteFieldSampleAt(xz, available);
  if (available > 0.5) {
    float region = fbm3((xz * uFrequency + uSeedOffset) * 0.700 + vec2(631.4, 199.2));
    return vec4(field.g, field.b, field.a, region);
  }
  Climate climate = climateAt(xz * uFrequency + uSeedOffset);
  return vec4(climate.temp, climate.moist, climate.cont, climate.region);
}

float waterBiomeClimateAvailable() {
  return 1.0;
}
`
    : /* glsl */ `
vec4 waterBiomeClimateAt(vec2 xz) {
  if (uUseWaterTerrainBiomeTex > 0.5) {
    return texture2D(uWaterTerrainBiomeTex, waterBakedUvAt(xz));
  }
  Climate climate = climateAt(xz * uFrequency + uSeedOffset);
  return vec4(climate.temp, climate.moist, climate.cont, climate.region);
}

float waterBiomeClimateAvailable() {
  return 1.0;
}
`;
  return /* glsl */ `
precision highp float;

${COMMON_UNIFORMS_GLSL}
${WATER_TILE_MASK_GLSL}
${dependencies}
${WATER_TERRAIN_CACHE_GLSL}
${PALETTE_UNIFORMS_GLSL}
${terrainHeightFunction}
${PROCEDURAL_SKY_UNIFORMS_GLSL}
${WATER_LIGHTING_UNIFORMS_GLSL}

uniform float uWaterAnim;
uniform float uWaterFadeStart;
uniform float uWaterFadeEnd;

uniform float uWaterQuality;
uniform float uWaterDetail;
uniform float uWaterReflection;
uniform float uWaveComplexity;
uniform float uRoughness;
uniform float uReflectionQuality;
uniform float uMicroWaveDetail;
uniform float uSkyReflectionEnabled;
uniform float uBiomeColorEnabled;
uniform float uBiomeColorStrength;
uniform float uWaterNaturalColor;

// realistic water controls
uniform float uWaterTier;          // 1=realistic, 2=volumetric, 3=cinematic
uniform float uWaterOpacity;
uniform float uFresnelStrength;
uniform float uRefractionStrength;
uniform float uSpecularStrength;
uniform float uDepthColorStr;
uniform float uDepthOpacityStr;
uniform float uMaxVisibleDepth;
uniform float uDepthFalloff;
uniform float uShallowDist;
uniform float uDeepDist;
uniform float uAbsorptionStr;
uniform float uWaveSpeed;
uniform float uWaveScale;
uniform float uWaveStrength;
uniform float uSmallWaveStr;
uniform float uLargeWaveStr;
uniform float uNormalIntensity;
uniform vec2  uWaveDir;
uniform float uAnimSpeed;
uniform float uFoamEnabled;
uniform float uFoamStrength;
uniform float uFoamWidth;
uniform float uFoamSoftness;
uniform float uFoamAnimSpeed;
uniform float uSlopeFoam;
uniform float uCliffFoam;
uniform float uCausticsStr;
uniform float uCausticMinDepth;
uniform float uCausticMinDepthFalloff;
uniform float uRefractionQual;
uniform float uFoamQual;
uniform float uCausticsQual;
uniform sampler2D uSceneColor;
uniform sampler2D uSceneDepth;
uniform vec2 uSceneTexelSize;
uniform vec2 uSceneViewportInv;
uniform float uSceneNear;
uniform float uSceneFar;
uniform float uSceneRefractionEnabled;
uniform sampler2D uPlanarReflection;
uniform mat4 uPlanarReflectionMatrix;
uniform vec2 uPlanarReflectionTexelSize;
uniform float uPlanarReflectionEnabled;
uniform vec2 uGeometryFocus;
uniform float uGeometryDisplacementEnabled;
uniform float uDebugMode;          // see WaterDebugViews / setWaterDebugMode
uniform float uVisualFoamBreakup;
uniform float uVisualWetSandRange;
uniform float uVisualShallowWaterSoftness;

varying vec3 vWorldPos;

${PROCEDURAL_SKY_EVALUATION_GLSL}
${WATER_OPTICS_GLSL}
${WATER_GEOMETRY_WAVES_GLSL}
${WATER_WAVES_GLSL}
${biomeClimateFunction}

float terrainHeightAt(vec2 xz) {
  return waterTerrainHeightAt(xz);
}

vec4 waterPaintedBiomeAt(vec2 xz) {
  if (uPaintEnabled < 0.5) return vec4(0.0);
  vec2 uv = xz / max(uPaintBoardSize, 1.0) + vec2(0.5);
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
    return vec4(0.0);
  }
  return texture2D(uPaintBiomeTexture, uv) * uPaintOpacity;
}

// Broad biome weights for the water above each point. The climate fields and
// filtered Studio bake keep transitions gradual across biome borders.
// x = desert, y = tropical, z = wetland, w = alpine; canyon comes from paint.
vec4 waterBiomeWeights(vec2 xz, out float canyon, out float strength) {
  vec4 climate = waterBiomeClimateAt(xz);
  float borderJitter = (climate.a - 0.5) * 0.16;
  float hot = smoothstep(0.52, 0.76, climate.r + borderJitter);
  float cold = smoothstep(0.34, 0.12, climate.r + borderJitter);
  float dry = smoothstep(0.56, 0.28, climate.g - borderJitter);
  float wet = smoothstep(0.54, 0.80, climate.g + borderJitter);
  float coastal = smoothstep(0.58, 0.30, climate.b);
  float inland = smoothstep(0.42, 0.72, climate.b);

  vec4 painted = waterPaintedBiomeAt(xz);
  vec4 weights = vec4(
    max(hot * dry, painted.r),
    hot * wet,
    max(wet * coastal * (1.0 - hot * 0.35), painted.b),
    max(cold * inland, painted.a)
  );
  canyon = painted.g;

  float paintedAvailable = max(max(painted.r, painted.g), max(painted.b, painted.a));
  float available = max(waterBiomeClimateAvailable(), paintedAvailable);
  strength = uBiomeColorEnabled * clamp(available, 0.0, 1.0);
  return weights;
}

// Relative tint for the palette colours, so custom palettes and water presets
// remain authoritative when Natural Water Color is lowered.
vec3 waterBiomeColorMultiplier(vec4 weights, float canyon, float strength) {
  vec3 tint = vec3(1.0);
  tint = mix(tint, vec3(0.88, 1.07, 1.12), weights.x * 0.70);
  tint = mix(tint, vec3(0.76, 1.12, 1.01), weights.y * 0.78);
  tint = mix(tint, vec3(0.72, 0.99, 0.76), weights.z * 0.82);
  tint = mix(tint, vec3(0.82, 0.94, 1.11), weights.w * 0.72);
  tint = mix(tint, vec3(0.94, 1.03, 0.92), canyon * 0.55);
  return mix(
    vec3(1.0),
    tint,
    clamp(strength * uBiomeColorStrength, 0.0, 1.5)
  );
}

// Physically plausible clear-water colours (linear). Shallow is sunlit sand
// seen through a few metres of water; deep is the open-water body. Each biome
// swaps in its own water: lagoon turquoise, clear desert aqua, murky wetland,
// milky glacial melt and silty canyon rivers.
void waterNaturalColors(
  vec4 weights,
  float canyon,
  float strength,
  out vec3 natShallow,
  out vec3 natDeep
) {
  natShallow = vec3(0.018, 0.360, 0.430);
  natDeep = vec3(0.004, 0.050, 0.170);
  float amount = clamp(strength * uBiomeColorStrength / 0.55, 0.0, 1.0);
  vec4 w = weights * amount;
  float c = canyon * amount;
  natShallow = mix(natShallow, vec3(0.010, 0.520, 0.500), w.y);
  natDeep = mix(natDeep, vec3(0.002, 0.105, 0.215), w.y);
  natShallow = mix(natShallow, vec3(0.030, 0.430, 0.540), w.x);
  natDeep = mix(natDeep, vec3(0.003, 0.060, 0.230), w.x);
  natShallow = mix(natShallow, vec3(0.085, 0.150, 0.055), w.z);
  natDeep = mix(natDeep, vec3(0.018, 0.042, 0.022), w.z);
  natShallow = mix(natShallow, vec3(0.110, 0.330, 0.380), w.w);
  natDeep = mix(natDeep, vec3(0.022, 0.095, 0.140), w.w);
  natShallow = mix(natShallow, vec3(0.120, 0.210, 0.150), c);
  natDeep = mix(natDeep, vec3(0.026, 0.062, 0.058), c);
}

// Cheap cross-kernel smoothing for depth tint. Reuses center sample when provided.
float smoothedFloorHeight(vec2 xz, float centerH) {
  float e = mix(8.0, 16.0, clamp(uVisualShallowWaterSoftness, 0.0, 1.0));
  float h1 = terrainHeightAt(xz + vec2(e, 0.0));
  float h2 = terrainHeightAt(xz - vec2(e, 0.0));
  float h3 = terrainHeightAt(xz + vec2(0.0, e));
  float h4 = terrainHeightAt(xz + vec2(0.0, -e));
  return (centerH + h1 + h2 + h3 + h4) * 0.2;
}

float slopeFromCenter(vec2 xz, float centerH) {
  float e = 4.0;
  float hx = terrainHeightAt(xz + vec2(e, 0.0));
  float hz = terrainHeightAt(xz + vec2(0.0, e));
  return length(vec2(hx - centerH, hz - centerH)) / e;
}

// Sine-free hash (stable at large world coordinates).
float waterGlintHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float waterLinearSceneDepth(float rawDepth) {
  float z = rawDepth * 2.0 - 1.0;
  return (2.0 * uSceneNear * uSceneFar)
    / max(uSceneFar + uSceneNear - z * (uSceneFar - uSceneNear), 0.0001);
}

void main() {
  vec2 xz = vWorldPos.xz;

#ifndef INFINITE_MODE
  if (waterTileOccupiedAt(xz) < 0.5) discard;
#endif

  float floorH = terrainHeightAt(xz);
  // Mean sea level and the exact terrain field are the single shoreline
  // authority. Geometry waves are visual displacement only and cannot turn a
  // dry mountain into water or detach the foam band from the coast.
  float depth = uSeaLevel - floorH;
  if (depth <= 0.02) discard;

  // Smoothed bathymetry for depth tint — 4 extra samples max (not 20+).
  float visualDepth = depth;
  if (uDepthColorStr > 0.05 || uDepthOpacityStr > 0.05) {
    visualDepth = uSeaLevel - smoothedFloorHeight(xz, floorH);
  }
  visualDepth = max(visualDepth, 0.0);

  float camDist = length(cameraPosition - vWorldPos);
  float farWater = smoothstep(700.0, 2400.0, camDist);
  // The wave spectrum now resolves chop down to sub-unit scale, so the
  // Roughness setting only needs to cover the unresolved micro-facets. A low
  // base keeps the sun highlight broken into sharp glints on every wavelet.
  float roughness = clamp(uRoughness * 0.5 + farWater * 0.08, 0.03, 1.0);
  float t = uTime * uWaterAnim * uAnimSpeed;
  vec3 n = waterDirectionalNormal(xz, t, camDist, roughness);
  // Ripples too small for this pixel were filtered out of n; their slope
  // variance widens the sun lobe and reflection blur instead.
  roughness = waterFilteredRoughness(
    roughness,
    uNormalIntensity * uWaveStrength * uWaveComplexity
  );
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  if (dot(n, viewDir) < 0.0) n = -n;

  // depth grading — smoothed bathymetry only (not raw relief)
  float shoreSoft = clamp(uVisualShallowWaterSoftness, 0.0, 1.0);
  float shallowT = smoothstep(0.0, uShallowDist * (1.0 + shoreSoft * 0.85), visualDepth);
  float deepT = smoothstep(uShallowDist, uDeepDist * (1.0 + shoreSoft * 0.45), visualDepth);
  float dGrade = pow(clamp(visualDepth / max(uMaxVisibleDepth, 1.0), 0.0, 1.0), max(uDepthFalloff, 0.1));
  dGrade = mix(shallowT * 0.35, deepT, dGrade) * uDepthColorStr;

  vec3 shallowColor = mix(
    vec3(dot(uColShallow, vec3(0.299, 0.587, 0.114))),
    uColShallow,
    uPaletteSaturation
  ) * uPaletteTint;
  vec3 deepColor = mix(
    vec3(dot(uColDeep, vec3(0.299, 0.587, 0.114))),
    uColDeep,
    uPaletteSaturation
  ) * uPaletteTint;
  float biomeCanyon;
  float biomeStrength;
  vec4 biomeWeights = waterBiomeWeights(xz, biomeCanyon, biomeStrength);
  vec3 biomeColorMultiplier = waterBiomeColorMultiplier(
    biomeWeights,
    biomeCanyon,
    biomeStrength
  );
  shallowColor *= biomeColorMultiplier;
  deepColor *= mix(vec3(1.0), biomeColorMultiplier, 0.68);
  vec3 naturalShallow;
  vec3 naturalDeep;
  waterNaturalColors(
    biomeWeights,
    biomeCanyon,
    biomeStrength,
    naturalShallow,
    naturalDeep
  );
  float naturalColor = clamp(uWaterNaturalColor, 0.0, 1.0);
  shallowColor = mix(shallowColor, naturalShallow, naturalColor);
  deepColor = mix(deepColor, naturalDeep, naturalColor);
  vec3 scatteringColor = mix(shallowColor, deepColor, clamp(dGrade, 0.0, 1.0));

  // Beer–Lambert absorption. Looking across the surface increases the path
  // length, so shallow grazing views naturally become denser than top-down ones.
  float opticalDepth = visualDepth / max(abs(viewDir.y), 0.15);
  vec3 absorptionRGB = waterAbsorptionCoefficients(
    deepColor,
    uAbsorptionStr,
    uWaterOpacity,
    uDepthOpacityStr
  );
  // Real water removes red within a few metres, then green; this is what
  // turns sand turquoise. Murky biome water already absorbs via deepColor.
  absorptionRGB += vec3(0.16, 0.03, 0.0)
    * naturalColor
    * max(uAbsorptionStr, 0.0);
  vec3 transmittance = waterBeerLambert(absorptionRGB, opticalDepth);
  float transmissionExponent = pow(
    0.45 / max(uRefractionStrength, 0.05),
    0.18
  );
  transmittance = pow(
    transmittance,
    vec3(clamp(transmissionExponent, 0.72, 1.45))
  );
  float volumeAlpha = waterVolumeOpacity(transmittance);
  // Single-pass blending can only dim the floor behind the water uniformly.
  // Let the least-transmitted channel through the blend and rebuild the
  // chromatic remainder from the palette sand, so shallow floors pick up the
  // water hue instead of showing through untinted.
  float neutralPass = min(min(transmittance.r, transmittance.g), transmittance.b);
  float chromaSplit = naturalColor * (1.0 - step(1.5, uWaterTier));
  volumeAlpha = mix(volumeAlpha, 1.0 - neutralPass, chromaSplit);
  vec3 chromaTransmission = max(transmittance - vec3(neutralPass), vec3(0.0))
    * chromaSplit;

  // Schlick Fresnel now follows the animated wave normal.
  float fres = waterSchlickFresnel(n, viewDir, uFresnelStrength);

  // Screen-space refraction for Volumetric/Cinematic modes. The water-free
  // capture is decoded back to linear space before optical composition.
  float sceneCaptureEnabled = uSceneRefractionEnabled
    * step(1.5, uWaterTier);
  // Once the floor is no longer visible, refraction should not replace the
  // palette-defined water body. This keeps Medium and High optically matched
  // while retaining true refraction in shallow and medium-depth water.
  float visibleFloor = 1.0 - smoothstep(
    max(uShallowDist * 1.15, 2.0),
    max(uDeepDist * 0.82, uShallowDist * 1.5),
    visualDepth
  );
  float sceneRefractionWeight = sceneCaptureEnabled * visibleFloor;
  // Derive capture UVs from the rasterized pixel. Interpolating clip
  // coordinates across the water plane's two triangles can differ by a few
  // ulps on their shared diagonal, which becomes a visible refraction cut.
  vec2 screenUv = gl_FragCoord.xy * uSceneViewportInv;
  vec2 refractedUv = screenUv;
  vec3 refractedSceneLinear = vec3(0.0);
  if (sceneCaptureEnabled > 0.5) {
    float refractionDetail = clamp(uRefractionQual, 0.0, 1.5) / 1.5;
    float distortionScale = mix(0.018, 0.065, refractionDetail)
      * uRefractionStrength
      * (1.0 - fres);
    vec2 uvMargin = uSceneTexelSize * 1.5;
    vec2 distortedUv = clamp(
      screenUv + n.xz * distortionScale,
      uvMargin,
      vec2(1.0) - uvMargin
    );

    // Reject samples that cross a terrain/prop silhouette. Sampling the
    // undistorted pixel instead prevents cliffs from smearing across the sea.
    float centerDepth = waterLinearSceneDepth(
      texture2D(uSceneDepth, screenUv).r
    );
    float distortedDepth = waterLinearSceneDepth(
      texture2D(uSceneDepth, distortedUv).r
    );
    float rejectStart = max(
      1.5,
      min(centerDepth, distortedDepth) * 0.035
    );
    float silhouetteReject = smoothstep(
      rejectStart,
      rejectStart * 3.0,
      abs(distortedDepth - centerDepth)
    );
    refractedUv = mix(distortedUv, screenUv, silhouetteReject);
    vec3 encodedScene = texture2D(uSceneColor, refractedUv).rgb;
    refractedSceneLinear = pow(
      max(encodedScene, vec3(0.0)),
      vec3(2.2)
    );
  }

  // Evaluate the same live procedural sky as the sky dome. Rough water blends
  // toward a broad reflection direction; distant water trends toward horizon
  // radiance and suppresses micro detail through waterDirectionalNormal().
  vec3 reflectedDirection = reflect(-viewDir, n);
  float reflectionDetail = clamp(uReflectionQuality, 0.0, 1.0);
  float reflectionBlur = clamp(
    roughness * roughness + (1.0 - reflectionDetail) * 0.32,
    0.0,
    1.0
  );
  vec3 broadDirection = normalize(vec3(
    reflectedDirection.x * 0.42,
    max(reflectedDirection.y, 0.08),
    reflectedDirection.z * 0.42
  ));
  vec3 reflectedSkySharp = evaluateProceduralSkyLinear(
    reflectedDirection,
    mix(1.0, 0.12, reflectionBlur),
    mix(0.35, 0.0, reflectionBlur)
  );
  vec3 reflectedSkyBroad = evaluateProceduralSkyLinear(broadDirection, 0.0, 0.0);
  vec3 reflectedSky = mix(
    reflectedSkySharp,
    reflectedSkyBroad,
    reflectionBlur * 0.82
  );
  if (farWater > 0.001) {
    vec3 horizonDirection = normalize(vec3(
      reflectedDirection.x,
      0.06,
      reflectedDirection.z
    ));
    reflectedSky = mix(
      reflectedSky,
      evaluateProceduralSkyLinear(horizonDirection, 0.0, 0.0),
      farWater * 0.42
    );
  }
  // Facets tilted so their mirror ray points below the horizon see the next
  // wave, not the pale below-horizon fog. Darken toward the water body so
  // grazing views keep their colour instead of turning into white stripes.
  float reflectionHorizon = smoothstep(-0.12, 0.05, reflectedDirection.y);
  reflectedSky = mix(
    reflectedSky * mix(vec3(0.55), deepColor * 1.6 + 0.2, 0.5),
    reflectedSky,
    reflectionHorizon
  );
  vec3 fallbackReflection = mix(
    uSkyFogColor,
    vec3(0.12, 0.24, 0.38),
    clamp(reflectedDirection.y, 0.0, 1.0)
  );
  float liveSkyAmount = uSkyReflectionEnabled
    * mix(0.35, 1.0, reflectionDetail);
  reflectedSky = mix(fallbackReflection, reflectedSky, liveSkyAmount);

  // Cinematic planar reflection captures terrain, props, clouds, and the live
  // sky from a sea-level mirrored camera. Roughness broadens the four-tap
  // sample, while invalid projected coordinates retain analytical sky.
  vec3 reflectedSurface = reflectedSky;
  float planarReflectionWeight = uPlanarReflectionEnabled
    * step(2.5, uWaterTier);
  if (planarReflectionWeight > 0.5) {
    vec4 planarProjected = uPlanarReflectionMatrix * vec4(vWorldPos, 1.0);
    vec2 planarUv = planarProjected.xy
      / max(planarProjected.w, 0.0001)
      * 0.5 + 0.5;
    float planarValid = step(0.0001, planarProjected.w)
      * step(0.0, planarUv.x)
      * step(planarUv.x, 1.0)
      * step(0.0, planarUv.y)
      * step(planarUv.y, 1.0);
    float planarDistortion = mix(0.012, 0.045, reflectionDetail)
      * (1.0 - roughness * 0.45);
    vec2 planarMargin = uPlanarReflectionTexelSize * 4.0;
    planarUv = clamp(
      planarUv + n.xz * planarDistortion,
      planarMargin,
      vec2(1.0) - planarMargin
    );
    vec2 blurOffset = uPlanarReflectionTexelSize
      * mix(1.0, 8.0, roughness * roughness);
    vec3 planarEncoded = texture2D(uPlanarReflection, planarUv).rgb * 0.40;
    planarEncoded += texture2D(
      uPlanarReflection,
      planarUv + vec2(blurOffset.x, 0.0)
    ).rgb * 0.15;
    planarEncoded += texture2D(
      uPlanarReflection,
      planarUv - vec2(blurOffset.x, 0.0)
    ).rgb * 0.15;
    planarEncoded += texture2D(
      uPlanarReflection,
      planarUv + vec2(0.0, blurOffset.y)
    ).rgb * 0.15;
    planarEncoded += texture2D(
      uPlanarReflection,
      planarUv - vec2(0.0, blurOffset.y)
    ).rgb * 0.15;
    vec3 planarLinear = pow(max(planarEncoded, vec3(0.0)), vec3(2.2));
    float planarQuality = clamp(
      (uReflectionQuality - 1.0) * 2.0,
      0.0,
      1.0
    );
    float planarBlend = planarReflectionWeight
      * planarValid
      * planarQuality
      * (1.0 - roughness * 0.38);
    reflectedSurface = mix(reflectedSky, planarLinear, planarBlend);
  }

  float reflectionScale = clamp(uWaterReflection, 0.0, 1.5);
  vec3 reflectionTerm = reflectedSurface * fres * reflectionScale;

  // Roughness-aware GGX sunlight uses the current sky sun color/intensity.
  vec3 skySunDir = normalize(uSkySunDir);
  float sunSpecular = waterGgxSunSpecular(n, viewDir, skySunDir, roughness);
  // Sun glitter: on real water individual micro-facets flash the sun, so the
  // highlight is a scatter of sharp glints rather than one smooth blob. A
  // sparse animated mask with mean ~1 redistributes a wider lobe into glints
  // and fades back to the smooth lobe where glints would be sub-pixel.
  // Glints are pinpoint sparkles: each cell holds at most one small, sharp
  // facet at a random spot that twinkles on and off. Two cell sizes cover
  // close-ups and the usual editor distance; each fades before it aliases.
  float glintFootprint = length(fwidth(xz));
  float fineGlints = waterBandFilter(6.0, glintFootprint);
  float coarseGlints = waterBandFilter(1.1, glintFootprint)
    * (1.0 - fineGlints);
  float glitterVisible = fineGlints + coarseGlints;
  if (glitterVisible > 0.001) {
    float cellSize = mix(2.2, 0.45, fineGlints);
    // Glints ride the wave slopes instead of sliding over them.
    vec2 glintUv = (xz + n.xz * cellSize * 3.0) / cellSize;
    vec2 glintCell = floor(glintUv);
    vec2 glintLocal = fract(glintUv);
    float glintSeed = waterGlintHash(glintCell);
    float glintSeedB = waterGlintHash(glintCell + vec2(17.3, 41.9));
    vec2 glintCenter = 0.25 + 0.5 * vec2(glintSeed, glintSeedB);
    float twinkle = fract(glintSeed * 7.13 + t * (0.6 + glintSeedB * 0.9));
    float alive = step(0.35, glintSeedB)
      * smoothstep(0.0, 0.12, twinkle)
      * smoothstep(0.55, 0.3, twinkle);
    float glitterMask = alive
      * (1.0 - smoothstep(0.06, 0.16, length(glintLocal - glintCenter)));
    float wideLobe = waterGgxSunSpecular(
      n,
      viewDir,
      skySunDir,
      max(roughness, 0.3)
    );
    sunSpecular = mix(
      sunSpecular,
      sunSpecular * 0.45 + wideLobe * glitterMask * 40.0,
      glitterVisible * clamp(uSpecularStrength, 0.0, 1.0)
    );
  }
  sunSpecular = min(sunSpecular, 24.0);
  vec3 sunSpecularTerm = waterResolveSunLight(
    uSkySunColor * uSkyLightIntensity
  )
    * sunSpecular
    * uSpecularStrength
    * reflectionScale;

  // Realistic mode keeps the transparent single-pass approximation. Higher
  // tiers overwrite the water pixel with a complete refracted volume composite,
  // because the same opaque scene is already behind the transparent surface.
  float diff = max(dot(n, uSunDir), 0.0);
  vec3 waterLight = waterResolveLighting(
    n,
    vec3(0.0, 1.0, 0.0),
    diff,
    vec3(0.62 + 0.38 * diff)
  );
  // Forward subsurface scattering: sunlight transmitted through thin, steep
  // wave faces toward the viewer gives backlit slopes their turquoise glow.
  vec3 sunLightColor = waterResolveSunLight(
    uSkySunColor * uSkyLightIntensity
  );
  float sunBehind = clamp(dot(-viewDir, skySunDir) * 0.5 + 0.5, 0.0, 1.0);
  float waveThin = clamp((1.0 - n.y) * 14.0, 0.0, 1.0);
  float sssAmount = (sunBehind * sunBehind * sunBehind * (0.35 + waveThin)
      + waveThin * 0.18)
    * (1.0 - abs(viewDir.y) * 0.6)
    * smoothstep(-0.05, 0.25, skySunDir.y);
  float scatterPeak = max(max(shallowColor.r, shallowColor.g), shallowColor.b);
  vec3 scatterHue = shallowColor / max(scatterPeak, 0.0001);
  vec3 subsurface = scatterHue * scatteringColor * sunLightColor
    * sssAmount * 0.55;

  vec3 bodyPremultiplied = (
      (scatteringColor * waterLight + subsurface)
        * (vec3(1.0) - transmittance)
      + uColSand * waterLight * chromaTransmission
    )
    * (1.0 - fres);
  vec3 premultipliedColor = bodyPremultiplied + reflectionTerm + sunSpecularTerm;
  float reflectionAlpha = clamp(fres * reflectionScale, 0.0, 0.98);
  float alpha = 1.0 - (1.0 - volumeAlpha) * (1.0 - reflectionAlpha);
  // Preserve only a restrained amount of wavelength separation in the scene
  // sample. Full RGB transmission made the High tier turn electric blue while
  // the otherwise identical Medium tier remained teal.
  float neutralTransmission = dot(
    transmittance,
    vec3(0.2126, 0.7152, 0.0722)
  );
  vec3 sceneTransmittance = mix(
    vec3(neutralTransmission),
    transmittance,
    0.30
  );
  vec3 refractedVolume = refractedSceneLinear * sceneTransmittance
    + (scatteringColor * waterLight + subsurface)
      * (vec3(1.0) - transmittance);
  vec3 sceneComposite = refractedVolume * (1.0 - fres)
    + reflectionTerm
    + sunSpecularTerm;
  premultipliedColor = mix(
    premultipliedColor,
    sceneComposite,
    sceneRefractionWeight
  );
  alpha = mix(alpha, 1.0, sceneRefractionWeight);

  // shoreline foam — depth-based only; slope foam restricted to very shallow water
  float shoreDist = depth;
  float foamNoise = 0.0;
  if (uFoamEnabled > 0.5 && uFoamQual > 0.1) {
    foamNoise = vnoise(xz * 0.18 + vec2(t * uFoamAnimSpeed * 1.4, -t * uFoamAnimSpeed * 1.1));
  }
  float breakup = clamp(uVisualFoamBreakup, 0.0, 1.0);
  float foamEdgeNoise = foamNoise * mix(1.4, 4.2, breakup);
  float foamPatch = mix(1.0, smoothstep(0.18, 0.82, vnoise(xz * 0.055 + vec2(t * 0.35, t * -0.28))), breakup);
  float shoreFoam = smoothstep(uFoamWidth + uFoamSoftness + uVisualWetSandRange * 0.05, uFoamSoftness, shoreDist + foamEdgeNoise);
  float nearShore = smoothstep(10.0 + uVisualWetSandRange * 0.35, 0.0, shoreDist);
  float slopeFoam = 0.0;
  float cliffFoam = 0.0;
  if (uFoamEnabled > 0.5 && nearShore > 0.01 && (uSlopeFoam > 0.01 || uCliffFoam > 0.01)) {
    float slope = slopeFromCenter(xz, floorH);
    slopeFoam = smoothstep(0.35, 1.1, slope) * uSlopeFoam * nearShore;
    cliffFoam = smoothstep(0.85, 1.8, slope) * uCliffFoam * nearShore;
  }
  // Cinematic whitecaps follow the same Gerstner phases as vertex movement.
  // A delayed sample leaves a short advected trail, approximating temporal
  // foam persistence without another history render target.
  float crestFoam = 0.0;
  float breakingFoam = 0.0;
  if (
    uWaterTier > 2.5
    && uGeometryDisplacementEnabled > 0.5
    && uFoamEnabled > 0.5
    && uFoamQual > 0.75
  ) {
    float crestNow = waterCinematicCrest(xz, t);
    float crestPrevious = waterCinematicCrest(
      xz - normalize(uWaveDir) * 1.8,
      t - 0.42 * uFoamAnimSpeed
    );
    float foamPersistence = max(crestNow, crestPrevious * 0.78);
    float crestAa = max(fwidth(foamPersistence) * 1.35, 0.018);
    crestFoam = smoothstep(
      0.86 - crestAa,
      0.86 + crestAa,
      foamPersistence
    );
    // Break the remaining crests into sparse streaks. Reusing the existing
    // foam fields avoids a new noise lookup and keeps whitecaps from forming
    // repeated rows over a large ocean.
    float crestBreakup = smoothstep(
      0.42,
      0.76,
      foamNoise * 0.62 + foamPatch * 0.38
    );
    crestFoam *= crestBreakup;
    float waveEnergy = smoothstep(
      0.82,
      1.72,
      uWaveStrength * uLargeWaveStr
    );
    float crestDistanceFade = 1.0 - smoothstep(520.0, 1750.0, camDist);
    crestFoam *= waveEnergy * crestDistanceFade;

    float breakingBand = 1.0 - smoothstep(
      max(uFoamWidth * 0.7, 1.0),
      max(uShallowDist * 1.65, uFoamWidth * 2.0),
      visualDepth
    );
    float shoreApproach = smoothstep(0.35, 0.82, foamPatch);
    breakingFoam = crestFoam * breakingBand * shoreApproach;
  }
  float foam = clamp(
    (
      shoreFoam * foamPatch
      + slopeFoam * 0.2
      + cliffFoam * 0.15
      + crestFoam * 0.13
      + breakingFoam * 0.48
    ) * uFoamStrength,
    0.0,
    1.0
  );
  // Keep the authored foam hue, but let its brightness and tint follow the
  // active atmosphere. uWaterFoamLighting retains a readable unlit component
  // at night instead of leaving a pure-white emissive-looking shoreline.
  vec3 litFoamColor = waterResolveFoamColor(uColFoam, waterLight);
  premultipliedColor = mix(premultipliedColor, litFoamColor, foam);
  alpha = mix(alpha, 1.0, foam);

  vec3 refractionTerm = mix(
    transmittance,
    refractedSceneLinear * sceneTransmittance,
    sceneRefractionWeight
  ) * (1.0 - fres);

  // The refracted scene already contains caustics on the terrain. Keep this
  // inexpensive fallback only where that scene sample is unavailable.
  if (uCausticsQual > 0.05 && uWaterTier > 1.5 && sceneCaptureEnabled < 0.5) {
    float shallowMask = 1.0 - smoothstep(uShallowDist * 0.5, uDeepDist, visualDepth);
    float c1 = vnoise(xz * 0.09 + vec2(t * 0.9, -t * 0.7));
    float c2 = vnoise(xz * 0.14 - vec2(t * 0.6, t * 0.5));
    float caust = pow(max(c1 * c2, 0.0), 2.2) * shallowMask;
    premultipliedColor += vec3(0.9, 0.95, 1.0)
      * caust * uCausticsStr * uCausticsQual * 0.28 * alpha;
  }

  float edgeFade = 1.0 - smoothstep(uWaterFadeStart, uWaterFadeEnd, camDist);
  premultipliedColor *= edgeFade;
  alpha *= edgeFade;
  if (alpha < 0.01) discard;

  // debug views
  if (uDebugMode > 0.5) {
    if (uDebugMode < 1.5) {
      float dv = clamp(depth / max(uMaxVisibleDepth, 1.0), 0.0, 1.0);
      gl_FragColor = vec4(vec3(1.0 - dv, dv * 0.5, dv), 1.0);
      return;
    }
    if (uDebugMode < 2.5) {
      float sv = smoothstep(uFoamWidth + 2.0, 0.5, depth);
      gl_FragColor = vec4(vec3(sv), 1.0);
      return;
    }
    if (uDebugMode < 3.5) {
      gl_FragColor = vec4(vec3(foam), 1.0);
      return;
    }
    if (uDebugMode < 4.5) {
      gl_FragColor = vec4(0.1, 0.45, 0.95, 1.0);
      return;
    }
    if (uDebugMode < 5.5) {
      gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
      return;
    }
    if (uDebugMode < 6.5) {
      float od = 1.0 - exp(-opticalDepth / max(uMaxVisibleDepth, 1.0));
      gl_FragColor = vec4(vec3(od), 1.0);
      return;
    }
    if (uDebugMode < 7.5) {
      gl_FragColor = vec4(transmittance, 1.0);
      return;
    }
    if (uDebugMode < 8.5) {
      gl_FragColor = vec4(vec3(fres), 1.0);
      return;
    }
    if (uDebugMode < 9.5) {
      gl_FragColor = vec4(min(reflectedSurface, vec3(1.0)), 1.0);
      return;
    }
    if (uDebugMode < 10.5) {
      gl_FragColor = vec4(clamp(refractionTerm, 0.0, 1.0), 1.0);
      return;
    }
    if (uDebugMode < 11.5) {
      gl_FragColor = vec4(vec3(alpha), 1.0);
      return;
    }
    gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
    return;
  }

  vec3 straightColor = premultipliedColor / max(alpha, 0.001);
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * camDist * camDist);
  fogF *= mix(0.82, 0.68, farWater);
  straightColor = mix(straightColor, uFogColor, clamp(fogF, 0.0, 1.0));
  straightColor = pow(max(straightColor, vec3(0.0)), vec3(1.0 / 2.2));
  gl_FragColor = vec4(straightColor * alpha, alpha);
}
`;
};

function realisticUniforms(sharedUniforms, environmentUniforms) {
  const skyUniforms = environmentUniforms ?? createProceduralSkyUniforms();
  return {
    ...sharedUniforms,
    ...skyUniforms,
    uWaterQuality: { value: 2.0 },
    uWaterDetail: { value: 1.0 },
    uWaterReflection: { value: 1.0 },
    uWaveComplexity: { value: 1.0 },
    uRoughness: { value: 0.35 },
    uReflectionQuality: { value: 1.0 },
    uMicroWaveDetail: { value: 1.0 },
    uSkyReflectionEnabled: { value: 1.0 },
    uBiomeColorEnabled: { value: 1.0 },
    uBiomeColorStrength: { value: 0.55 },
    uWaterNaturalColor: { value: 0.7 },
    ...createWaterLightingUniforms(),
    uWaterAnim: { value: 1.0 },
    uWaterFadeStart: { value: 99999.0 },
    uWaterFadeEnd: { value: 100000.0 },
    uWaterTier: { value: 1.0 },
    uWaterOpacity: { value: 0.72 },
    uFresnelStrength: { value: 1.0 },
    uRefractionStrength: { value: 0.45 },
    uSpecularStrength: { value: 1.0 },
    uDepthColorStr: { value: 1.0 },
    uDepthOpacityStr: { value: 1.0 },
    uMaxVisibleDepth: { value: 120.0 },
    uDepthFalloff: { value: 1.0 },
    uShallowDist: { value: 8.0 },
    uDeepDist: { value: 55.0 },
    uAbsorptionStr: { value: 1.0 },
    uWaveSpeed: { value: 1.0 },
    uWaveScale: { value: 1.0 },
    uWaveStrength: { value: 1.0 },
    uSmallWaveStr: { value: 0.65 },
    uLargeWaveStr: { value: 1.0 },
    uNormalIntensity: { value: 1.0 },
    uWaveDir: { value: new THREE.Vector2(1, 0) },
    uAnimSpeed: { value: 1.0 },
    uFoamEnabled: { value: 1.0 },
    uFoamStrength: { value: 0.75 },
    uFoamWidth: { value: 3.2 },
    uFoamSoftness: { value: 0.6 },
    uFoamAnimSpeed: { value: 1.0 },
    uSlopeFoam: { value: 0.5 },
    uCliffFoam: { value: 0.65 },
    uCausticsStr: { value: 0.4 },
    uCausticMinDepth: { value: 1.0 },
    uCausticMinDepthFalloff: { value: 1.0 },
    uRefractionQual: { value: 0.6 },
    uFoamQual: { value: 1.0 },
    uCausticsQual: { value: 0.5 },
    uSceneColor: { value: null },
    uSceneDepth: { value: null },
    uSceneTexelSize: { value: new THREE.Vector2(1, 1) },
    uSceneViewportInv: { value: new THREE.Vector2(1, 1) },
    uSceneNear: { value: 1.0 },
    uSceneFar: { value: 50000.0 },
    uSceneRefractionEnabled: { value: 0.0 },
    uPlanarReflection: { value: null },
    uPlanarReflectionMatrix: { value: new THREE.Matrix4() },
    uPlanarReflectionTexelSize: { value: new THREE.Vector2(1, 1) },
    uPlanarReflectionEnabled: { value: 0.0 },
    uGeometryFocus: { value: new THREE.Vector2(0, 0) },
    uGeometryDisplacementEnabled: { value: 0.0 },
    uDebugMode: { value: 0.0 },
  };
}

export function createRealisticWaterMaterial(
  sharedUniforms,
  octaves = 7,
  stackGLSL = DEFAULT_STACK_GLSL,
  environmentUniforms = null,
) {
  const mat = new THREE.ShaderMaterial({
    uniforms: realisticUniforms(sharedUniforms, environmentUniforms),
    defines: { OCTAVES: octaves },
    vertexShader: VERTEX,
    fragmentShader: buildFragment(stackGLSL, false),
    transparent: true,
    premultipliedAlpha: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
  });
  return mat;
}

export function createInfiniteRealisticWaterMaterial(
  sharedUniforms,
  octaves = 7,
  stackGLSL = DEFAULT_STACK_GLSL,
  environmentUniforms = null,
) {
  const mat = new THREE.ShaderMaterial({
    uniforms: realisticUniforms(sharedUniforms, environmentUniforms),
    defines: { OCTAVES: octaves, INFINITE_MODE: 1 },
    vertexShader: VERTEX,
    fragmentShader: buildFragment(stackGLSL, true),
    transparent: true,
    premultipliedAlpha: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
  });
  mat.uniforms.uWaterFadeStart.value = 2000.0;
  mat.uniforms.uWaterFadeEnd.value = 2500.0;
  return mat;
}

export function rebuildRealisticWaterShaderSource(mat, stackGLSL) {
  const infinite = Object.hasOwn(mat.defines ?? {}, 'INFINITE_MODE');
  mat.fragmentShader = buildFragment(stackGLSL, infinite);
  mat.needsUpdate = true;
}

export function applyRealisticWaterUniforms(mat, params, mode) {
  if (!mat?.uniforms) return;
  const u = mat.uniforms;
  const tier = mode === 'cinematic' ? 3 : mode === 'volumetric' ? 2 : 1;
  const dirRad = (params.waterWaveDirection ?? 0) * Math.PI / 180;
  u.uWaterTier.value = tier;
  u.uWaterOpacity.value = params.waterOpacity ?? 0.72;
  u.uRoughness.value = params.waterRoughness ?? 0.35;
  u.uReflectionQuality.value = params.waterReflectionQuality ?? 1;
  u.uMicroWaveDetail.value = params.waterNormalResolution ?? 1;
  u.uSkyReflectionEnabled.value = params.skyboxEnabled !== false ? 1 : 0;
  u.uBiomeColorEnabled.value =
    params.waterBiomeColorEnabled !== false ? 1 : 0;
  u.uBiomeColorStrength.value =
    params.waterBiomeColorStrength ?? 0.55;
  u.uWaterNaturalColor.value = params.waterNaturalColor ?? 0.7;
  u.uFresnelStrength.value = params.waterFresnelStrength ?? 1;
  u.uRefractionStrength.value = params.waterRefractionStrength ?? 0.45;
  u.uSpecularStrength.value = params.waterSpecularStrength ?? 1;
  u.uDepthColorStr.value = params.waterDepthColorStrength ?? 1;
  u.uDepthOpacityStr.value = params.waterDepthOpacityStrength ?? 1;
  u.uMaxVisibleDepth.value = params.waterMaxVisibleDepth ?? 120;
  u.uDepthFalloff.value = params.waterDepthFalloff ?? 1;
  u.uShallowDist.value = params.waterShallowDistance ?? 8;
  u.uDeepDist.value = params.waterDeepDistance ?? 55;
  u.uAbsorptionStr.value = params.waterAbsorptionStrength ?? 1;
  u.uWaveSpeed.value = params.waterWaveSpeed ?? 1;
  u.uWaveScale.value = params.waterWaveScale ?? 1;
  u.uWaveStrength.value = params.waterWaveStrength ?? 1;
  u.uSmallWaveStr.value = params.waterSmallWaveStrength ?? 0.65;
  u.uLargeWaveStr.value = params.waterLargeWaveStrength ?? 1;
  u.uNormalIntensity.value = params.waterNormalIntensity ?? 1;
  u.uWaveDir.value.set(Math.cos(dirRad), Math.sin(dirRad));
  u.uAnimSpeed.value = params.waterAnimSpeed ?? 1;
  u.uFoamEnabled.value = params.waterFoamEnabled !== false ? 1 : 0;
  u.uFoamStrength.value = params.waterFoamStrength ?? 0.75;
  u.uFoamWidth.value = params.waterFoamWidth ?? 3.2;
  u.uFoamSoftness.value = params.waterFoamSoftness ?? 0.6;
  u.uFoamAnimSpeed.value = params.waterFoamAnimSpeed ?? 1;
  u.uSlopeFoam.value = params.waterSlopeFoam ?? 0.5;
  u.uCliffFoam.value = params.waterCliffFoam ?? 0.65;
  u.uCausticsStr.value = params.waterUnderwaterCaustics ?? 0.4;
  u.uCausticMinDepth.value =
    params.waterUnderwaterCausticMinDepth ?? 1;
  u.uCausticMinDepthFalloff.value =
    params.waterUnderwaterCausticMinDepthFalloff ?? 1;
  u.uRefractionQual.value = (params.waterRefractionQuality ?? 0.6) * (tier >= 2 ? 1 : 0.5);
  u.uFoamQual.value = params.waterFoamQuality ?? 1;
  u.uCausticsQual.value = (params.waterCausticsQuality ?? 0.5) * (tier >= 2 ? 1 : 0.25);
  u.uGeometryDisplacementEnabled.value = tier >= 3 ? 1 : 0;
}

export function setWaterDebugMode(mat, debugView) {
  if (!mat?.uniforms?.uDebugMode) return;
  const map = {
    off: 0,
    depth: 1,
    shoreline: 2,
    foam: 3,
    mask: 4,
    normal: 5,
    opticalDepth: 6,
    transmittance: 7,
    fresnel: 8,
    reflection: 9,
    refraction: 10,
    opacity: 11,
  };
  mat.uniforms.uDebugMode.value = map[debugView] ?? 0;
}
