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
uniform float uTerrainDetailDebug;          // 0 off, 1 slope, 2 rock, 3 shore, 4 fade, 5 detail, 6 albedo, 7 normal

float terrainDetailEnabled() {
  return step(0.5, uTerrainDetailQuality);
}

float terrainDetailFadeAt(vec3 worldPos) {
  float d = length(cameraPosition - worldPos);
  float fade = 1.0 - smoothstep(uTerrainDetailNear, max(uTerrainDetailNear + 1.0, uTerrainDetailFar), d);
  return fade * terrainDetailEnabled();
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

float terrainRockMask(float slope, float jitter) {
  float width = max(0.04, uTerrainRockSharpness);
  return smoothstep(uTerrainRockSlope - width, uTerrainRockSlope + width, slope + jitter * 0.06);
}

float terrainShoreMask(float hRel) {
  return 1.0 - smoothstep(0.0, max(uTerrainShoreRange, 0.01), abs(hRel));
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

  float fine = terrainDetailNoise(worldPos, normalGeo, scale);
  float coarse = terrainDetailNoise(worldPos + vec3(53.0, 17.0, 29.0), normalGeo, scale * 0.33);
  float grain = clamp(fine * 0.72 + coarse * 0.28, 0.0, 1.0);
  float signedGrain = grain * 2.0 - 1.0;

  float rockMask = max(tc.rockBlend, terrainRockMask(slope, jitter));
  float shoreMask = terrainShoreMask(hRel);
  float desertGround = clamp(max(bw.desert, tc.sandBand > 0.0 ? 1.0 - smoothstep(tc.sandBand * 0.4, tc.sandBand, hRel) : 0.0), 0.0, 1.0);
  float wetGround = clamp(max(bw.wetland, shoreMask * 0.65), 0.0, 1.0);
  float vegGround = clamp((1.0 - desertGround) * (1.0 - bw.canyon) * (1.0 - tc.snow) * tc.flatness * smoothstep(0.20, 0.72, cl.moist), 0.0, 1.0);

  float canyonBands = 0.5 + 0.5 * sin(h01 * 210.0 + coarse * 5.0);
  vec3 sandTint = mix(uColSand * 0.78, uColDune * 1.12, grain);
  vec3 grassTint = mix(uColDryGrass * 0.82, uColForest * 0.92, grain) * mix(0.96, 1.08, coarse);
  vec3 mudTint = mix(uColSwamp * 0.62, uColSand * 0.55, grain);
  vec3 rockTint = mix(uColRock * 0.68, uColRockHi * 1.10, grain);
  vec3 canyonTint = mix(uColRedRock * 0.70, uColRedRock2 * 1.12, canyonBands);
  vec3 snowTint = mix(uColSnow * 0.84, vec3(0.90, 0.97, 1.0), grain);

  vec3 materialTint = mix(tc.albedo, grassTint, vegGround * 0.40);
  materialTint = mix(materialTint, sandTint, desertGround * (1.0 - rockMask) * 0.48);
  materialTint = mix(materialTint, mudTint, wetGround * (1.0 - rockMask) * 0.38);
  materialTint = mix(materialTint, mix(rockTint, canyonTint, bw.canyon), rockMask * 0.62);
  materialTint = mix(materialTint, snowTint, tc.snow * 0.42);

  float crack = smoothstep(0.18, 0.02, abs(signedGrain)) * rockMask;
  float fleck = (vnoise(worldPos.xz * scale * 3.8 + uSeedOffset.yx) - 0.5) * 2.0;
  vec3 detailed = materialTint;
  detailed *= 1.0 + signedGrain * (0.050 + 0.075 * rockMask + 0.025 * vegGround);
  detailed *= 1.0 - crack * 0.18;
  detailed += fleck * 0.025 * (desertGround + vegGround * 0.5) * (1.0 - rockMask);
  detailed = mix(detailed, detailed * mix(0.74, 0.92, grain), shoreMask * uTerrainShoreWetness);

  float strength = clamp(uTerrainDetailStrength, 0.0, 2.0) * fade;
  outD.albedo = mix(tc.albedo, max(detailed, vec3(0.0)), strength);
  outD.detail = grain;
  outD.fade = fade;
  outD.rockMask = rockMask;
  outD.shoreMask = shoreMask;
  return outD;
}
`;
