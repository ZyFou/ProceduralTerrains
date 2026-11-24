// ============================================================================
// Procedural V2 terrain surface. Shader-only texturing layered over the biome
// palette, driven by one shared, mip-mapped 3D noise volume
// (render/NoiseVolumeV2.js). Every material gets its own colours AND its own
// texture, chosen from the same climate / biome signals as the terrain:
//
//   rock   the biome decides the stone: grey bedded rock (temperate), pale
//          jointed granite with lichen (cold / mountains), dark mossy rock
//          (warm + wet), ochre sandstone (desert), red strata (canyon). Thin
//          beds, joints, weathering patches, vertical stains, ledge relief.
//   ground plant cover swings between dry and lush, bare earth breaks it up,
//          plants gather in hollows; steepening slopes turn to scree.
//   sand   two-tone beach and dune sand with wind ripples.
//   snow   a broken snowline, smooth drifts, blue shade in the hollows.
//   shore  pale mineral ring above the waterline, wet darkening at the edge.
//
// All colours are taken from the project palette (so a custom palette stays
// authoritative); the noise only decides tone, pattern and relief.
//
// The look is authored in reference metres; SV2_UNIT maps it to world units.
// Every tap is an explicit-LOD lookup whose level follows the pixel footprint,
// so distant terrain reads pre-filtered noise: no shimmer, no extra octaves,
// and the rock-only and fine-relief taps are skipped where they cannot show.
// ============================================================================

export const SURFACE_V2_GLSL = /* glsl */ `
precision highp sampler3D;
uniform highp sampler3D uSurfV2Noise;   // r Perlin-Worley, gba Worley fbm
uniform float uSurfV2Amount;     // 0 = plain procedural, 1 = full V2 surface
uniform float uSurfV2Scale;      // feature size multiplier
uniform float uSurfV2Relief;     // surface relief (ledges, grain, ripples)
uniform float uSurfV2Strata;     // rock bedding contrast
uniform float uSurfV2Sandstone;  // 0 = biome rock, 1 = sandstone strata hues everywhere
uniform float uSurfV2Variation;  // per-material tone / hue variation
uniform float uSurfV2Breakup;    // bare earth breaking up the plant cover
uniform float uSurfV2Shore;      // mineral ring + wet edge at the waterline

struct SurfaceV2Result {
  vec3 albedo;
  vec3 normal;
};

// World units per reference metre at Scale 1. Sized for how these worlds are
// viewed (a 2048-unit tile seen from hundreds of units away): rock ledges a
// few units thick, ground patches a few hundred units across.
#define SV2_UNIT 1.2
// reference metres spanned by the terrain height range
#define SV2_HEIGHT_SPAN 760.0
// The sandstone column starts above the dark basement at the waterline and
// reaches the pale caprock at the top of the height range.
#define SV2_STRATA_BASE 100.0
#define SV2_STRATA_SPAN 520.0
#define SV2_LUMA vec3(0.299, 0.587, 0.114)

vec4 sv2Noise(vec3 p, float scale, float footprint) {
  float lod = log2(max(footprint * 128.0 / scale, 1.0));
  return textureLod(uSurfV2Noise, p / scale, lod);
}

// Sandstone strata by elevation (reference metres): red beds to pale caprock.
vec3 sv2Strata(float h) {
  vec3 c = vec3(0.088, 0.086, 0.092);
  c = mix(c, vec3(0.205, 0.082, 0.058), smoothstep(20.0, 40.0, h));
  c = mix(c, vec3(0.330, 0.135, 0.082), smoothstep(100.0, 112.0, h));
  c = mix(c, vec3(0.235, 0.098, 0.068), smoothstep(150.0, 158.0, h));
  c = mix(c, vec3(0.410, 0.190, 0.108), smoothstep(250.0, 262.0, h));
  c = mix(c, vec3(0.490, 0.275, 0.160), smoothstep(300.0, 307.0, h));
  c = mix(c, vec3(0.570, 0.385, 0.255), smoothstep(396.0, 404.0, h));
  c = mix(c, vec3(0.440, 0.220, 0.140), smoothstep(440.0, 450.0, h));
  c = mix(c, vec3(0.345, 0.360, 0.265), smoothstep(535.0, 546.0, h));
  c = mix(c, vec3(0.455, 0.440, 0.345), smoothstep(596.0, 606.0, h));
  return c;
}

SurfaceV2Result applySurfaceV2(
  vec3 baseAlbedo, vec3 n, vec3 wp, float dist,
  TerrainColorResult tc, Climate cl, BiomeWeights bw,
  float slope, float hRel, float h01, float concave
) {
  SurfaceV2Result result;
  float unit = SV2_UNIT * max(uSurfV2Scale, 0.05);
  vec3 q = wp / unit;                                   // reference metres
  float footprint = dist * uPixelWorldPerDist / unit;   // metres per pixel
  float variation = uSurfV2Variation;

  vec4 nL = sv2Noise(q, 1500.0, footprint);   // regional patches
  vec4 nM = sv2Noise(q, 230.0, footprint);    // hillside patches
  float c0 = sv2Noise(q, 14.0, footprint).g;  // cells: joints, clumps
  float d0 = sv2Noise(q, 3.3, footprint).r;   // grain

  // ------------------------------------------------------- material masks
  float tempEff = clamp(cl.temp - h01 * 0.55, 0.0, 1.0);   // altitude lapse

  // Rock: the palette slope gates with a noisy edge, plus what the palette
  // already paints as rock (steep faces, bare high ground).
  float rock = smoothstep(
    uRockSlopeLo * 0.52,
    uRockSlopeHi * 0.72,
    slope + (nM.r - 0.72) * 0.12
  );
  float highRock = smoothstep(0.30, 0.62, h01 + (nM.g - 0.45) * 0.08)
    * (1.0 - bw.desert * 0.7);
  rock = max(rock, max(tc.rockBlend, highRock * 0.85));

  // Snow: a broken snowline. Noise pushes the edge around so rock and scree
  // show through it instead of a smooth altitude gradient.
  float snow = smoothstep(
    0.30, 0.58,
    tc.snow + ((nM.g - 0.45) * 0.50 + (c0 - 0.45) * 0.18) * (1.0 - tc.snow)
  );

  // Sand: the beach band of the palette and the dune fields of the desert.
  float beach = (1.0 - smoothstep(tc.sandBand * 0.4, max(tc.sandBand, 0.3), hRel))
    * (1.0 - bw.wetland * 0.6);
  float dune = bw.desert * (1.0 - smoothstep(0.25, 0.50, slope));
  float sand = clamp(max(beach, dune), 0.0, 1.0) * (1.0 - rock);

  // Plant cover: wherever the biome colour is green-dominant.
  float plantCover = clamp(
    (baseAlbedo.g - max(baseAlbedo.r, baseAlbedo.b)) * 9.0, 0.0, 1.0
  ) * (1.0 - sand);

  // Scree: loose gravel where the slope steepens toward rock.
  float scree = smoothstep(
    uRockSlopeLo * 0.30,
    uRockSlopeLo * 0.55,
    slope + (c0 - 0.45) * 0.10
  ) * (1.0 - rock) * (1.0 - sand);

  // --------------------------------------------------------------- relief
  // Noise squashed vertically reads as thin ledges. Rock gets all three
  // scales; ground only the broad one, softened; sand and snow stay smooth.
  // The finer scales vanish with their mip level, so their taps are skipped
  // off rock and once a pixel covers several noise cells (coherent branches).
  vec3 q1 = q * vec3(1.0, 4.5, 1.0);
  float b0 = sv2Noise(q1, 70.0, footprint).r;
  vec3 g = (vec3(
    sv2Noise(q1 + vec3(1.3, 0.0, 0.0), 70.0, footprint).r,
    sv2Noise(q1 + vec3(0.0, 1.3, 0.0), 70.0, footprint).r,
    sv2Noise(q1 + vec3(0.0, 0.0, 1.3), 70.0, footprint).r
  ) - b0) * (4.0 + 7.0 * rock);
  float bareRock = rock * (1.0 - snow);
  if (bareRock > 0.02 && footprint < 2.0) {
    g += (vec3(
      sv2Noise(q + vec3(0.28, 0.0, 0.0), 14.0, footprint).g,
      sv2Noise(q + vec3(0.0, 0.28, 0.0), 14.0, footprint).g,
      sv2Noise(q + vec3(0.0, 0.0, 0.28), 14.0, footprint).g
    ) - c0) * (1.4 + 2.2 * rock);
    if (footprint < 0.5) {
      g += (vec3(
        sv2Noise(q + vec3(0.07, 0.0, 0.0), 3.3, footprint).r,
        sv2Noise(q + vec3(0.0, 0.07, 0.0), 3.3, footprint).r,
        sv2Noise(q + vec3(0.0, 0.0, 0.07), 3.3, footprint).r
      ) - d0) * (0.9 + 0.9 * rock);
    }
  }
  float softGround = mix(0.42, 0.08, max(snow, sand));
  g *= uSurfV2Relief * mix(softGround, 1.0, bareRock);

  // wind ripples on sand (analytic: no taps), only while they are resolved
  float rippleShade = 0.0;
  if (sand > 0.01) {
    vec2 wind = vec2(0.860, 0.510);
    float rippleK = mix(1.9, 0.55, dune);   // dunes carry longer ripples
    float rippleFade = 1.0 - smoothstep(0.30, 1.10, footprint * rippleK);
    if (rippleFade > 0.0) {
      float phase = dot(q.xz, wind) * rippleK + (nM.b - 0.45) * 9.0 + (c0 - 0.45) * 2.5;
      rippleShade = sin(phase) * rippleFade;
      g.xz += wind * (cos(phase) * 0.10 * rippleFade * sand * uSurfV2Relief);
    }
  }
  // bounded tilt: the relief shapes the light, it never flips a face
  g = clamp(g, vec3(-0.9), vec3(0.9));
  result.normal = normalize(n - (g - n * dot(g, n)));

  // ----------------------------------------------------------------- rock
  vec3 plainRock = applyPalettePost(mix(uColRock, uColRockHi, 0.55));
  vec3 rockColor = plainRock;
  if (bareRock > 0.002) {
    // which stone: the same climate that shaped the terrain decides
    float canyon = bw.canyon;
    float desert = bw.desert * (1.0 - canyon);
    float humid = smoothstep(0.55, 0.80, cl.moist) * smoothstep(0.40, 0.65, tempEff)
      * (1.0 - canyon) * (1.0 - desert);
    float alpine = clamp(
      max(bw.mountains * 0.5, 1.0 - smoothstep(0.22, 0.45, tempEff)), 0.0, 1.0
    ) * (1.0 - canyon) * (1.0 - desert) * (1.0 - humid);

    // thin beds along the true height axis (gently undulating) + stains
    float hFine = q.y + (nL.r - 0.72) * 14.0;
    float band = sv2Noise(vec3(hFine, 31.0, 57.0), 48.0, footprint).r * 0.55
      + sv2Noise(vec3(hFine, 7.0, 41.0), 19.0, footprint).g * 0.45;
    float streak = sv2Noise(q * vec3(1.0, 0.10, 1.0), 36.0, footprint).g;

    // Sedimentary rock is bedded, granite is blocky: bedding sets how much
    // of the tone comes from the beds versus the cell grain.
    float bedding = clamp(0.45 + canyon * 0.55 + desert * 0.35 - alpine * 0.30, 0.10, 1.0)
      * uSurfV2Strata;
    // (the cell grain only enters where the stone is not bedded: mixed into
    // bedded rock it chops every layer into dashes)
    float blocky = (1.0 - min(bedding, 1.0)) * (1.0 - min(bedding, 1.0));
    float tone = clamp(
      0.5 + (band - 0.60) * 1.25 * bedding
        + (nM.g - 0.45) * 0.40 * variation
        + (c0 - 0.45) * 0.55 * blocky,
      0.10, 1.0
    );
    vec3 stone = mix(uColRock, uColRockHi, tone);
    stone = mix(stone, mix(uColRock * 1.04, uColRockHi * 1.10, tone) * vec3(0.96, 0.99, 1.04), alpine);
    stone = mix(stone, mix(uColRock * 0.72, uColRockHi * 0.80, tone), humid);
    stone = mix(stone, mix(mix(uColRock, uColDune, 0.55), mix(uColRockHi, uColDune, 0.75), tone), desert);
    stone = mix(stone, mix(uColRedRock, uColRedRock2, tone), canyon * 0.85);
    rockColor = applyPalettePost(stone);

    // regional mineral drift, warm to cool
    float drift = (nL.b - 0.45) * variation;
    rockColor *= vec3(1.0 + drift * 0.10, 1.0 + drift * 0.03, 1.0 - drift * 0.08);

    // optional: sandstone strata hues on every rock, at the rock's own
    // brightness (the palette still decides how light the stone is)
    if (uSurfV2Sandstone > 0.001) {
      float hM = SV2_STRATA_BASE + max(wp.y - uSeaLevel, 0.0)
        / max(uHeightScale - uSeaLevel, 1.0) * SV2_STRATA_SPAN;
      vec3 strata = sv2Strata(hM + (nM.r - 0.72) * 22.0);
      rockColor = mix(
        rockColor,
        strata / max(dot(strata, SV2_LUMA), 1e-3) * dot(rockColor, SV2_LUMA),
        uSurfV2Sandstone
      );
    }

    // joints along the cell borders, vertical stains on steep faces, shade
    // under the ledges
    float joints = 1.0 - smoothstep(0.12, 0.30, c0);
    rockColor *= 1.0 - joints * 0.22 * (0.5 + alpine * 0.5 + humid * 0.3);
    rockColor *= mix(1.0, mix(0.84, 1.10, streak), smoothstep(0.25, 0.60, slope) * 0.8);
    rockColor *= mix(1.0, 0.66 + 0.48 * b0, min(uSurfV2Relief, 1.0));

    // moss on damp ledges, pale lichen on cold stone
    float damp = humid * 0.75
      + (1.0 - alpine) * (1.0 - desert) * (1.0 - canyon) * smoothstep(0.40, 0.75, cl.moist) * 0.35;
    float moss = damp * smoothstep(0.50, 0.80, nM.b + (1.0 - slope) * 0.35 + concave * 0.30);
    rockColor = mix(
      rockColor,
      applyPalettePost(mix(uColForest, uColGrass, 0.4)) * 0.8,
      moss * 0.55 * variation
    );
    rockColor *= mix(
      vec3(1.0), vec3(1.12, 1.14, 1.02),
      alpine * smoothstep(0.55, 0.80, nM.b) * 0.5 * variation
    );
  }

  // --------------------------------------------------------------- ground
  vec3 ground = baseAlbedo;
  float patchField = nL.g * 0.6 + nM.r * 0.4;   // mean ~0.56

  // plant cover swings between dry and lush
  float dryness = smoothstep(0.50, 0.75, patchField - (cl.moist - 0.5) * 0.35);
  float lushness = smoothstep(0.45, 0.80, nM.b + concave * 0.5 + (cl.moist - 0.5) * 0.4);
  vec3 lush = applyPalettePost(mix(uColForest, uColJungle, smoothstep(0.50, 0.80, tempEff)));
  ground = mix(ground, applyPalettePost(uColDryGrass), plantCover * dryness * 0.38 * variation);
  ground = mix(ground, lush * 0.92, plantCover * lushness * 0.32 * variation);

  // bare earth breaks the plant cover up; plants gather in the hollows
  vec3 earth = applyPalettePost(mix(uColDryGrass, uColRock, 0.42) * vec3(0.80, 0.70, 0.60));
  float vegetationField = nL.g * 0.62 + nM.b * 0.30
    + concave * 0.35 + (cl.moist - 0.5) * 0.20;
  float bare = (1.0 - smoothstep(0.27, 0.40, vegetationField)) * plantCover * uSurfV2Breakup;
  ground = mix(ground, earth, bare);

  // ground without plants (tundra, steppe, dry flats): tone patches
  ground *= 1.0 + (patchField - 0.56) * 0.30 * variation * (1.0 - plantCover) * (1.0 - sand);

  // sand: two palette tones, ripple shading
  vec3 sandTone = applyPalettePost(
    mix(uColSand, uColDune, clamp(0.5 + (nM.b - 0.45) * 1.6, 0.0, 1.0))
  );
  ground = mix(ground, mix(ground, sandTone, 0.6 * variation) * (1.0 + rippleShade * 0.05), sand);

  // scree between the ground and the rock
  vec3 screeColor = mix(earth, plainRock, 0.6) * (0.80 + 0.45 * d0);
  ground = mix(ground, screeColor, scree * 0.75 * (1.0 - snow));

  vec3 albedo = mix(ground, rockColor, rock);
  // hollows hold moisture and litter
  albedo *= mix(1.0, 0.84, concave * (1.0 - rock));
  // grain: coarse on rock and earth, fine on sand
  albedo *= mix(1.0, (0.86 + 0.28 * c0) * (0.80 + 0.34 * d0), mix(1.0, 0.55, sand));

  // ----------------------------------------------------------------- snow
  // smooth and bright, with wind-packed tone and blue shade in the hollows
  vec3 snowColor = applyPalettePost(uColSnow) * (0.965 + 0.05 * nM.r);
  snowColor = mix(
    snowColor,
    snowColor * vec3(0.84, 0.91, 1.0),
    clamp(concave * 0.55 + (0.72 - nM.r) * 0.25, 0.0, 0.5)
  );
  albedo = mix(albedo, snowColor, snow);

  // ---- shore: pale mineral ring just above the waterline, wet at the edge
  if (uSeaLevel > 0.5 && uSurfV2Shore > 0.001) {
    float seaM = hRel / max(uHeightScale, 1.0) * SV2_HEIGHT_SPAN;
    float ring = (1.0 - smoothstep(1.5, 6.0, seaM)) * smoothstep(0.0, 0.9, seaM);
    albedo = mix(albedo, vec3(0.56, 0.52, 0.47), ring * 0.20 * bareRock * uSurfV2Shore);
    albedo *= mix(1.0, mix(0.50, 1.0, smoothstep(0.1, 1.5, seaM)), uSurfV2Shore);
  }

  result.albedo = max(albedo, vec3(0.0));
  return result;
}
`;
