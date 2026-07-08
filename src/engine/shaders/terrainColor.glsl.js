// ============================================================================
// Shared terrain color GLSL — palette uniforms + biome albedo computation.
// Included by terrain fragment shader, water shader, and export bake shader.
// ============================================================================

export const PALETTE_UNIFORMS_GLSL = /* glsl */ `
uniform vec3 uColDeep;
uniform vec3 uColShallow;
uniform vec3 uColSand;
uniform vec3 uColDune;
uniform vec3 uColDryGrass;
uniform vec3 uColGrass;
uniform vec3 uColForest;
uniform vec3 uColJungle;
uniform vec3 uColSwamp;
uniform vec3 uColTundra;
uniform vec3 uColRedRock;
uniform vec3 uColRedRock2;
uniform vec3 uColRock;
uniform vec3 uColRockHi;
uniform vec3 uColSnow;
uniform vec3 uColFoam;

uniform float uPaletteSaturation;
uniform float uPaletteContrast;
uniform vec3  uPaletteTint;
uniform vec3  uTerrainSunCol;
uniform float uTerrainSunIntensity;
uniform vec3  uTerrainSkyAmb;
uniform vec3  uTerrainBounce;

// Used by computeTerrainAlbedo — must be declared before TERRAIN_COLOR_FUNCTIONS_GLSL.
uniform float uSnowLine;

// Slope gates (Materials realism). Defaults reproduce the previously hard-coded
// thresholds, so scenes that never touch the sliders render identically.
uniform float uRockSlopeLo;   // slope where rock starts bleeding in   (was 0.42)
uniform float uRockSlopeHi;   // slope of full rock exposure           (was 0.72)
uniform float uSnowSlopeMin;  // slope below which snow holds fully    (was 0.30)
uniform float uSnowSlopeMax;  // slope above which snow sheds entirely (was 0.62)

// Ridge accent: brightens convex crests in the AO term. 0 (default) = off.
uniform float uAORidge;
`;

export const TERRAIN_COLOR_FUNCTIONS_GLSL = /* glsl */ `
vec3 applyPalettePost(vec3 col) {
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(luma), col, uPaletteSaturation);
  col = (col - 0.5) * uPaletteContrast + 0.5;
  col *= uPaletteTint;
  return max(col, vec3(0.0));
}

// Compute terrain albedo from climate, biome weights, height, slope.
// Returns albedo before lighting; also outputs snow/shore/micro helpers.
struct TerrainColorResult {
  vec3 albedo;
  float snow;
  float sandBand;
  float flatness;
  float rockBlend;
};

// microN is the high-frequency albedo grain noise, supplied by the caller so
// the same function serves both the flat board (a plain xz value noise) and the
// planet (triplanar, to avoid sphere stretching) without forking.
TerrainColorResult computeTerrainAlbedo(
  Climate cl, BiomeWeights bw,
  float hC, float hRel, float h01, float slope, float detail, float jitter, float microN
) {
  TerrainColorResult res;
  float tempEff = clamp(cl.temp - h01 * 0.55, 0.0, 1.0);
  float veg = vegetationDensity(cl, h01, slope);
  float jt = jitter * 0.06;

  vec3 hotBand = mix(uColDune,
    mix(uColDryGrass, uColJungle, smoothstep(0.45, 0.75, cl.moist)),
    smoothstep(0.20, 0.50, cl.moist));
  vec3 midBand = mix(uColDryGrass,
    mix(uColGrass, uColForest, veg * (0.5 + 0.5 * smoothstep(0.35, 0.65, detail))),
    smoothstep(0.22, 0.52, cl.moist));
  vec3 coldBand = mix(uColTundra, mix(uColTundra, uColForest * 0.85, veg),
    smoothstep(0.30, 0.60, cl.moist));

  vec3 lowland = mix(coldBand, midBand, smoothstep(0.20, 0.38, tempEff + jt));
  lowland = mix(lowland, hotBand, smoothstep(0.55, 0.72, tempEff + jt));
  lowland = mix(lowland, uColSwamp, bw.wetland * 0.8);

  float sandBand = (mix(3.0, 9.0, smoothstep(0.30, 0.70, tempEff)) + jitter * 4.0)
                 * (1.0 - bw.wetland * 0.85);
  vec3 albedo = mix(uColSand, lowland, smoothstep(sandBand * 0.4, max(sandBand, 0.3), hRel));

  float band = fract(h01 * 14.0 + detail * 0.15);
  vec3 canyonCol = mix(uColRedRock, uColRedRock2, smoothstep(0.25, 0.75, band));
  albedo = mix(albedo, canyonCol, bw.canyon * smoothstep(1.0, 6.0, hRel));

  float highBlend = smoothstep(0.30, 0.62, h01 + jitter * 0.08);
  albedo = mix(albedo, uColRockHi, highBlend * 0.65 * (1.0 - bw.desert * 0.7));

  float rockBlend = smoothstep(uRockSlopeLo, uRockSlopeHi, slope + jitter * 0.06);
  vec3 slopeRock = mix(mix(uColRock, uColRockHi, detail), uColRedRock, bw.canyon * 0.8);
  albedo = mix(albedo, slopeRock, rockBlend);

  float snowLine01 = uSnowLine * (0.40 + 1.20 * cl.temp);
  float flatness = smoothstep(uSnowSlopeMax, uSnowSlopeMin, slope);
  float snow = smoothstep(snowLine01 - 0.03, snowLine01 + 0.05, h01 + jitter * 0.04) * flatness;
  snow = max(snow, smoothstep(0.10, 0.02, tempEff) * smoothstep(0.50, 0.25, slope));
  snow *= 1.0 - bw.desert;
  albedo = mix(albedo, uColSnow, snow);

  if (hRel < 0.0) {
    float depth = clamp(-hRel / 55.0, 0.0, 1.0);
    vec3 floorCol = mix(mix(uColSand, uColSwamp, bw.wetland * 0.7) * 0.65, uColDeep, depth);
    albedo = mix(albedo, floorCol, 0.92);
  }

  float micro = mix(0.20, 0.06, max(bw.desert * (1.0 - rockBlend), bw.wetland * 0.8));
  micro = mix(micro, 0.30, max(rockBlend * 0.6, bw.canyon * 0.4));
  albedo *= (1.0 - micro * 0.5) + micro * microN;

  res.albedo = applyPalettePost(albedo);
  res.snow = snow;
  res.sandBand = sandBand;
  res.flatness = flatness;
  res.rockBlend = rockBlend;
  return res;
}

// Ridge accent: convex is the positive counterpart of the concavity AO term
// (crest sticking up above its neighbours). Brightens crests so alpine ridges
// catch light; capped so lighting never blows out. uAORidge 0 = exact no-op.
float applyRidgeAccent(float ao, float convex) {
  return min(ao * (1.0 + uAORidge * clamp(convex, 0.0, 1.0) * 0.45), 1.25);
}

vec3 terrainBiomeDebugColor(BiomeWeights bw, float h01) {
  vec3 dbg = vec3(0.20, 0.50, 0.25);
  dbg = mix(dbg, uColDune, bw.desert);
  dbg = mix(dbg, uColRedRock, bw.canyon);
  dbg = mix(dbg, uColShallow, bw.wetland);
  dbg = mix(dbg, uColRockHi, bw.mountains * smoothstep(0.3, 0.6, h01));
  return applyPalettePost(dbg);
}

vec3 terrainLighting(vec3 albedo, vec3 n, vec3 sunDir, float ao,
  float snow, float sandBand, float hRel, float flatness, float bwWetland,
  vec3 viewDir) {
  float diff = max(dot(n, sunDir), 0.0);
  vec3 sunCol = uTerrainSunCol * uTerrainSunIntensity;
  vec3 skyAmb = uTerrainSkyAmb * 0.50 * (n.y * 0.5 + 0.5);
  vec3 bounce = uTerrainBounce * 0.25 * (1.0 - n.y * 0.5);
  vec3 col = albedo * (sunCol * diff + skyAmb + bounce) * ao;

  float spec = pow(max(dot(reflect(-sunDir, n), viewDir), 0.0), 32.0);
  float shoreSheen = 1.0 - smoothstep(0.0, max(sandBand, 0.5), abs(hRel));
  col += spec * (snow * 0.30 + shoreSheen * 0.10 + bwWetland * flatness * 0.15);
  return col;
}
`;
