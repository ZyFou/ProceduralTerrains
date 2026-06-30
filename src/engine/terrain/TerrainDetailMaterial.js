// ============================================================================
// Close-range terrain detail layer.
// Procedural world-space/triplanar detail enriches the existing biome albedo
// near the camera without replacing the global procedural terrain identity.
// ============================================================================

export const TERRAIN_DETAIL_GLSL = /* glsl */ `
uniform float uTerrainDetailQuality;        // 0 off, 1 low, 2 medium, 3 high
uniform float uTerrainDetailScale;          // world-space noise frequency
uniform float uTerrainDetailStrength;       // albedo detail strength
uniform float uTerrainDetailNormalStrength; // procedural normal strength
uniform float uTerrainDetailNear;
uniform float uTerrainDetailFar;
uniform float uTerrainRockSlope;
uniform float uTerrainRockSharpness;
uniform float uTerrainTriplanar;
uniform float uTerrainShoreRange;
uniform float uTerrainShoreWetness;
uniform float uTerrainDetailOpacity;        // 0..1 master mix over the whole detail layer
uniform float uTerrainMicroDetail;          // 0..1 high-frequency close-up grain amount
uniform float uTerrainMacroVariation;       // 0..1 large-scale weathering / patch breakup
uniform float uTerrainDetailDebug;          // 0 off, 1 slope, 2 rock, 3 shore, 4 fade, 5 detail, 6 albedo, 7 normal
uniform float uVisualTerrainColorVariation;
uniform float uVisualTerrainHeightDetail;
uniform float uVisualWetShoreStrength;
uniform float uVisualRockDetail;
uniform float uVisualSoilDetail;
uniform float uVisualSandDetail;
uniform float uVisualWetSandRange;

float terrainDetailEnabled() {
  return step(0.5, uTerrainDetailQuality);
}

float terrainDetailFadeAt(vec3 worldPos) {
  float d = length(cameraPosition - worldPos);
  float fade = 1.0 - smoothstep(uTerrainDetailNear, max(uTerrainDetailNear + 1.0, uTerrainDetailFar), d);
  // master opacity scales the whole layer — albedo strength and the normal pass
  // both gate on this fade, so one dial fades the entire detail contribution.
  return fade * terrainDetailEnabled() * clamp(uTerrainDetailOpacity, 0.0, 1.0);
}

float terrainDetailQualityFactor() {
  return clamp(uTerrainDetailQuality / 3.0, 0.0, 1.0);
}

vec3 terrainTriBlend(vec3 n) {
  vec3 b = pow(abs(n), vec3(4.0));
  return b / max(b.x + b.y + b.z, 1e-4);
}

float terrainTriNoise(vec3 p, vec3 blend) {
  return vnoise(p.yz) * blend.x + vnoise(p.zx) * blend.y + vnoise(p.xy) * blend.z;
}

float terrainDetailNoise2D(vec2 xz, float scale) {
  vec2 p = xz * max(scale, 0.0001) + uSeedOffset * 0.37;
  float a = vnoise(p);
  float b = vnoise(ROT2 * p * 2.73 + vec2(19.7, 41.1));
  float c = vnoise(ROT2 * p * 6.10 + vec2(83.2, 11.4));
  return clamp(a * 0.50 + b * 0.32 + c * 0.18, 0.0, 1.0);
}

float terrainDetailNoiseTri(vec3 worldPos, vec3 n, float scale) {
  vec3 p = worldPos * max(scale, 0.0001) + vec3(uSeedOffset, uSeedOffset.x - uSeedOffset.y) * 0.37;
  vec3 b = terrainTriBlend(n);
  float a = terrainTriNoise(p, b);
  float q = terrainTriNoise(vec3(ROT2 * p.xy, p.z) * 2.73 + vec3(19.7, 41.1, 7.3), b);
  float r = terrainTriNoise(vec3(ROT2 * p.xz, p.y).xzy * 6.10 + vec3(83.2, 11.4, 31.9), b);
  return clamp(a * 0.50 + q * 0.32 + r * 0.18, 0.0, 1.0);
}

float terrainDetailNoise(vec3 worldPos, vec3 n, float scale) {
  float planar = terrainDetailNoise2D(worldPos.xz, scale);
  float tri = terrainDetailNoiseTri(worldPos, n, scale);
  return mix(planar, tri, clamp(uTerrainTriplanar, 0.0, 1.0));
}

// Relief height for the normal pass — the broad fine band plus an optional
// crisp micro band so close-up bumps gain high-frequency structure on top of
// the larger shape. Shared by both the flat-board and planet normal helpers so
// they read identical surface detail. Sampled 3x by the caller (center + 2
// neighbours) to derive the gradient.
float terrainDetailRelief(vec3 worldPos, vec3 n, float scale) {
  float fine = terrainDetailNoise(worldPos, n, scale);
  float micro = clamp(uTerrainMicroDetail, 0.0, 1.0);
  float heightDetail = clamp(uVisualTerrainHeightDetail, 0.0, 1.0);
  if (micro <= 0.001 && heightDetail <= 0.001) return fine;
  float coarse = terrainDetailNoise(worldPos + vec3(53.0, 17.0, 29.0), n, scale * 0.42);
  float hi = terrainDetailNoise(worldPos + vec3(11.3, 5.7, 23.9), n, scale * 3.0);
  return fine
    + (hi - 0.5) * micro * 0.55
    + (coarse - 0.5) * heightDetail * 0.42;
}

// Multi-octave detail sample: four decorrelated frequency bands reused across
// every biome path so albedo variation has both crisp grain and large organic
// patches without recomputing noise per material.
struct DetailSample {
  float fine;    // primary close grain
  float coarse;  // broad clumping
  float micro;   // high-frequency speckle / crisp detail
  float macro;   // very low frequency weathering patches
};

DetailSample terrainDetailSampleAt(vec3 worldPos, vec3 n, float scale) {
  DetailSample d;
  d.fine   = terrainDetailNoise(worldPos, n, scale);
  d.coarse = terrainDetailNoise(worldPos + vec3(53.0, 17.0, 29.0), n, scale * 0.33);
  d.micro  = terrainDetailNoise(worldPos + vec3(11.3, 5.7, 23.9), n, scale * 3.0);
  d.macro  = terrainDetailNoise(worldPos + vec3(127.0, 0.0, 211.0), n, scale * 0.085);
  return d;
}

float terrainRockMask(float slope, float jitter) {
  float width = max(0.04, uTerrainRockSharpness);
  return smoothstep(uTerrainRockSlope - width, uTerrainRockSlope + width, slope + jitter * 0.06);
}

float terrainShoreMask(float hRel) {
  float shoreRange = max(uTerrainShoreRange + uVisualWetSandRange * 0.35, 0.01);
  return 1.0 - smoothstep(0.0, shoreRange, abs(hRel));
}

struct TerrainDetailResult {
  vec3 albedo;
  float detail;
  float fade;
  float rockMask;
  float shoreMask;
};

TerrainDetailResult applyTerrainDetailLayer(
  TerrainColorResult tc,
  Climate cl,
  BiomeWeights bw,
  vec3 worldPos,
  vec3 normalGeo,
  float hC,
  float hRel,
  float h01,
  float slope,
  float jitter
) {
  TerrainDetailResult outD;
  float fade = terrainDetailFadeAt(worldPos);
  float quality = terrainDetailQualityFactor();
  float scale = uTerrainDetailScale * mix(0.55, 1.25, quality);

  DetailSample ds = terrainDetailSampleAt(worldPos, normalGeo, scale);
  float fine = ds.fine;
  float coarse = ds.coarse;
  float micro = clamp(uTerrainMicroDetail, 0.0, 1.0);
  float macroAmt = clamp(uTerrainMacroVariation + uVisualTerrainColorVariation * 0.45, 0.0, 1.35);

  // close bands form the base grain; the micro band adds crisp speckle that
  // the Micro Detail slider dials up for sharper close-up texture.
  float grain = clamp(fine * 0.60 + coarse * 0.26 + ds.micro * (0.14 + 0.10 * micro), 0.0, 1.0);
  float signedGrain = grain * 2.0 - 1.0;
  float microSigned = ds.micro * 2.0 - 1.0;
  float macroSigned = ds.macro * 2.0 - 1.0;   // -1..1 large weathering patch field

  float rockMask = max(tc.rockBlend, terrainRockMask(slope, jitter));
  float shoreMask = terrainShoreMask(hRel);
  float desertGround = clamp(max(bw.desert, tc.sandBand > 0.0 ? 1.0 - smoothstep(tc.sandBand * 0.4, tc.sandBand, hRel) : 0.0), 0.0, 1.0);
  float wetGround = clamp(max(bw.wetland, shoreMask * 0.65), 0.0, 1.0);
  float vegGround = clamp((1.0 - desertGround) * (1.0 - bw.canyon) * (1.0 - tc.snow) * tc.flatness * smoothstep(0.20, 0.72, cl.moist), 0.0, 1.0);

  // desert wind ripples: anisotropic crests along a fixed wind axis, meandered
  // by the coarse/macro bands so they curve organically instead of striping.
  vec2 windDir = normalize(vec2(0.86, 0.51));
  float ripplePhase = dot(worldPos.xz, windDir) * scale * 7.5 + coarse * 6.5 + ds.macro * 3.0;
  float ripple = sin(ripplePhase) * 0.5 + 0.5;
  ripple *= ripple;                                   // sharpen crests
  float dunes = (ripple - 0.5) * desertGround * (1.0 - rockMask);

  // rock stratification + canyon banding driven by height with macro warble
  float strata = 0.5 + 0.5 * sin(h01 * 120.0 + coarse * 4.0 + macroSigned * 2.0);
  float canyonBands = 0.5 + 0.5 * sin(h01 * 210.0 + coarse * 5.0);

  // large-scale weathering: sign carries a faint hue drift, magnitude the value
  float weather = macroSigned * macroAmt;

  float sandDetail = 1.0 + clamp(uVisualSandDetail, 0.0, 1.0) * 0.45;
  float soilDetail = 1.0 + clamp(uVisualSoilDetail, 0.0, 1.0) * 0.40;
  float rockDetail = 1.0 + clamp(uVisualRockDetail, 0.0, 1.0) * 0.55;

  vec3 sandTint = mix(uColSand * 0.78, uColDune * 1.12, clamp((grain - 0.5) * sandDetail + 0.5, 0.0, 1.0));
  sandTint *= 1.0 + dunes * 0.22;                     // ripple crest/trough shading
  vec3 grassTint = mix(uColDryGrass * 0.82, uColForest * 0.92, clamp((grain - 0.5) * soilDetail + 0.5, 0.0, 1.0)) * mix(0.96, 1.08, coarse);
  grassTint = mix(grassTint, mix(uColDryGrass, uColGrass, grain),
    smoothstep(0.40, 0.70, ds.macro) * 0.35);         // dry vs. lush clumps
  vec3 mudTint = mix(uColSwamp * 0.62, uColSand * 0.55, clamp((grain - 0.5) * soilDetail + 0.5, 0.0, 1.0));
  vec3 rockTint = mix(uColRock * 0.68, uColRockHi * 1.10, clamp((grain - 0.5) * rockDetail + 0.5, 0.0, 1.0));
  rockTint = mix(rockTint, rockTint * mix(0.82, 1.12, strata), 0.55);  // strata banding
  vec3 canyonTint = mix(uColRedRock * 0.70, uColRedRock2 * 1.12, canyonBands);
  vec3 snowTint = mix(uColSnow * 0.84, vec3(0.90, 0.97, 1.0), grain);

  vec3 materialTint = mix(tc.albedo, grassTint, vegGround * 0.42);
  materialTint = mix(materialTint, sandTint, desertGround * (1.0 - rockMask) * 0.52);
  materialTint = mix(materialTint, mudTint, wetGround * (1.0 - rockMask) * 0.38);
  materialTint = mix(materialTint, mix(rockTint, canyonTint, bw.canyon), rockMask * 0.66);
  materialTint = mix(materialTint, snowTint, tc.snow * 0.42);

  // weathering breakup so each biome shows organic patches, not a flat wash
  materialTint *= 1.0 + weather * (0.16 + 0.10 * rockMask);
  materialTint *= vec3(1.0 + weather * 0.05, 1.0, 1.0 - weather * 0.04);

  float crack = smoothstep(0.16, 0.0, abs(microSigned)) * rockMask;
  float fleck = (vnoise(worldPos.xz * scale * 3.8 + uSeedOffset.yx) - 0.5) * 2.0;
  vec3 detailed = materialTint;
  detailed *= 1.0 + signedGrain * (0.055 + 0.085 * rockMask + 0.030 * vegGround);
  detailed *= 1.0 + microSigned * micro * (0.05 + 0.06 * rockMask);   // crisp close grain
  detailed *= 1.0 - crack * 0.22;
  detailed += fleck * 0.028 * (desertGround + vegGround * 0.5) * (1.0 - rockMask);
  float wetShore = clamp(uTerrainShoreWetness + uVisualWetShoreStrength * 0.55, 0.0, 1.4);
  detailed = mix(detailed, detailed * mix(0.68, 0.92, grain), shoreMask * wetShore);

  float strength = clamp(uTerrainDetailStrength, 0.0, 2.0) * fade;
  outD.albedo = mix(tc.albedo, max(detailed, vec3(0.0)), strength);
  outD.detail = grain;
  outD.fade = fade;
  outD.rockMask = rockMask;
  outD.shoreMask = shoreMask;
  return outD;
}
`;
