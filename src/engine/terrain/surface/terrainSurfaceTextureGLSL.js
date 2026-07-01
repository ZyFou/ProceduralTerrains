import {
  SURFACE_TEXTURE_LAYERS,
  SURFACE_TEXTURE_ROLE_COUNT,
  SURFACE_TEXTURE_ROWS,
  SURFACE_TEXTURE_VARIANT_COUNT,
} from './SurfaceTextureRoles.js';

export {
  SURFACE_TEXTURE_LAYERS,
  SURFACE_TEXTURE_ROLE_COUNT,
  SURFACE_TEXTURE_ROWS,
  SURFACE_TEXTURE_VARIANT_COUNT,
};

// Palette-driven custom terrain surface textures.
//
// Runtime shader rule:
// - Procedural mode exits before sampling the atlas.
// - Custom mode samples one baked render row per palette role.
// - The atlas builder is responsible for making that row renderable, including
//   diagnostic rows for missing roles and folding uploaded variants into row 0.
//
// Keeping variant selection out of GLSL avoids ANGLE/D3D11 validation failures
// from dynamic uniform-array indexing and nested dynamic variant branches.

export const SURFACE_TEXTURE_UNIFORMS_GLSL = /* glsl */ `
uniform sampler2D uSurfDiffuse;
uniform sampler2D uSurfNormal;
uniform sampler2D uSurfRough;
uniform sampler2D uSurfAO;
uniform float uSurfMode;        // 0 = procedural colours, 1 = custom texture atlas
uniform float uSurfAmount;      // master blend of textures over colour (0..1)
uniform float uSurfTint;        // legacy, unused by the palette-role path
uniform float uSurfPaletteInfluence; // 0 = raw texture, 1 = palette role recolour
uniform float uSurfScale;       // global texture repeat multiplier
uniform float uSurfBreakup;     // stochastic per-tile transform
uniform float uSurfBlend;       // 0 = dominant role, 1 = blend with next strongest role
uniform float uSurfNormalAmt;   // strength of texture normal relief
uniform float uSurfRoughAmt;    // how much sampled roughness drives the sheen
uniform float uSurfAOAmt;       // how much sampled AO darkens crevices
uniform float uSurfTriplanar;   // 1 = triplanar, 0 = planar world-XZ only
uniform float uSurfNear;        // full-texture distance (m)
uniform float uSurfFar;         // texture fades to colour beyond this (m)
uniform float uSurfTile[${SURFACE_TEXTURE_ROLE_COUNT}];
uniform float uSurfRolePresent[${SURFACE_TEXTURE_ROLE_COUNT}];
uniform float uSurfPresent[${SURFACE_TEXTURE_ROWS}]; // legacy/debug metadata
`;

export const SURFACE_TEXTURE_FUNCTIONS_GLSL = /* glsl */ `
const int SURF_ROLE_COUNT = ${SURFACE_TEXTURE_ROLE_COUNT};
const int SURF_VARIANT_COUNT = ${SURFACE_TEXTURE_VARIANT_COUNT};
const float SURF_ROWS = ${SURFACE_TEXTURE_ROWS}.0;
const float SURF_INSET = 0.006;

struct SurfaceTexResult {
  vec3 albedo;
  vec3 normal;
  float ao;
  float rough;
  float amount;
};

struct SurfMaterialSample {
  vec3 albedo;
  vec3 normal;
  float ao;
  float rough;
  float missing;
};

struct SurfRoleWeights {
  float sand;
  float dune;
  float dryGrass;
  float grass;
  float forest;
  float jungle;
  float swamp;
  float tundra;
  float redRock;
  float redRock2;
  float rock;
  float rockHi;
  float snow;
};

float surfRenderRowFi(int roleIndex) {
  return float(roleIndex * SURF_VARIANT_COUNT);
}

vec2 surfAtlasUV(float rowFi, vec2 uv) {
  float v = fract(uv.y);
  v = (rowFi + SURF_INSET + v * (1.0 - 2.0 * SURF_INSET)) / SURF_ROWS;
  return vec2(fract(uv.x), v);
}

float surfTileForRole(int roleIndex) {
  if (roleIndex == 0) return uSurfTile[0];
  if (roleIndex == 1) return uSurfTile[1];
  if (roleIndex == 2) return uSurfTile[2];
  if (roleIndex == 3) return uSurfTile[3];
  if (roleIndex == 4) return uSurfTile[4];
  if (roleIndex == 5) return uSurfTile[5];
  if (roleIndex == 6) return uSurfTile[6];
  if (roleIndex == 7) return uSurfTile[7];
  if (roleIndex == 8) return uSurfTile[8];
  if (roleIndex == 9) return uSurfTile[9];
  if (roleIndex == 10) return uSurfTile[10];
  if (roleIndex == 11) return uSurfTile[11];
  return uSurfTile[12];
}

float surfRoleReady(int roleIndex) {
  if (roleIndex == 0) return uSurfRolePresent[0];
  if (roleIndex == 1) return uSurfRolePresent[1];
  if (roleIndex == 2) return uSurfRolePresent[2];
  if (roleIndex == 3) return uSurfRolePresent[3];
  if (roleIndex == 4) return uSurfRolePresent[4];
  if (roleIndex == 5) return uSurfRolePresent[5];
  if (roleIndex == 6) return uSurfRolePresent[6];
  if (roleIndex == 7) return uSurfRolePresent[7];
  if (roleIndex == 8) return uSurfRolePresent[8];
  if (roleIndex == 9) return uSurfRolePresent[9];
  if (roleIndex == 10) return uSurfRolePresent[10];
  if (roleIndex == 11) return uSurfRolePresent[11];
  return uSurfRolePresent[12];
}

float surfTileInv(float tile) {
  return max(uSurfScale, 0.01) / max(tile, 0.01);
}

vec2 surfRandomizedUV(vec2 uv, float roleFi, float salt) {
  float amt = clamp(uSurfBreakup, 0.0, 1.0);
  if (amt < 0.001) return uv;

  vec2 cell = floor(uv);
  vec2 p = fract(uv);
  vec2 key = cell + vec2(roleFi * 19.17 + salt, roleFi * 5.83 - salt);
  float h0 = hash12(key);
  float h1 = hash12(key + vec2(17.7, 3.1));
  float h2 = hash12(key + vec2(5.9, 41.3));
  float h3 = hash12(key + vec2(29.1, 11.7));
  float h4 = hash12(key + vec2(73.4, 2.6));

  if (h0 < 0.5) p.x = 1.0 - p.x;
  if (h1 < 0.5) p.y = 1.0 - p.y;
  float rot = floor(h2 * 4.0);
  if (rot > 2.5) {
    p = vec2(1.0 - p.y, p.x);
  } else if (rot > 1.5) {
    p = vec2(1.0 - p.x, 1.0 - p.y);
  } else if (rot > 0.5) {
    p = vec2(p.y, 1.0 - p.x);
  }

  float scale = mix(1.0, mix(0.72, 1.36, h3), amt);
  vec2 offset = (vec2(h4, hash12(key + vec2(9.4, 91.2))) - 0.5) * amt;
  p = (p - 0.5) * scale + 0.5 + offset;
  return cell + p;
}

vec3 surfTriRole(sampler2D atlas, int roleIndex, vec3 wp, vec3 blend, float tile) {
  float inv = surfTileInv(tile);
  float roleFi = float(roleIndex);
  float rowFi = surfRenderRowFi(roleIndex);
  vec2 uvX = surfRandomizedUV(wp.zy * inv, roleFi, 1.0);
  vec2 uvY = surfRandomizedUV(wp.xz * inv, roleFi, 2.0);
  vec2 uvZ = surfRandomizedUV(wp.xy * inv, roleFi, 3.0);
  vec3 cx = texture2D(atlas, surfAtlasUV(rowFi, uvX)).rgb;
  vec3 cy = texture2D(atlas, surfAtlasUV(rowFi, uvY)).rgb;
  vec3 cz = texture2D(atlas, surfAtlasUV(rowFi, uvZ)).rgb;
  return cx * blend.x + cy * blend.y + cz * blend.z;
}

vec3 surfTriNormalRole(int roleIndex, vec3 wp, vec3 blend, float tile, vec3 nGeo) {
  float inv = surfTileInv(tile);
  float roleFi = float(roleIndex);
  float rowFi = surfRenderRowFi(roleIndex);
  vec2 uvX = surfRandomizedUV(wp.zy * inv, roleFi, 4.0);
  vec2 uvY = surfRandomizedUV(wp.xz * inv, roleFi, 5.0);
  vec2 uvZ = surfRandomizedUV(wp.xy * inv, roleFi, 6.0);
  vec3 tx = texture2D(uSurfNormal, surfAtlasUV(rowFi, uvX)).rgb * 2.0 - 1.0;
  vec3 ty = texture2D(uSurfNormal, surfAtlasUV(rowFi, uvY)).rgb * 2.0 - 1.0;
  vec3 tz = texture2D(uSurfNormal, surfAtlasUV(rowFi, uvZ)).rgb * 2.0 - 1.0;
  tx.y = -tx.y;
  ty.y = -ty.y;
  tz.y = -tz.y;
  vec3 wX = normalize(nGeo + vec3(0.0, tx.y, tx.x));
  vec3 wY = normalize(nGeo + vec3(ty.x, 0.0, ty.y));
  vec3 wZ = normalize(nGeo + vec3(tz.x, tz.y, 0.0));
  return normalize(wX * blend.x + wY * blend.y + wZ * blend.z);
}

float surfTriScalarRole(sampler2D atlas, int roleIndex, vec3 wp, vec3 blend, float tile, float salt) {
  float inv = surfTileInv(tile);
  float roleFi = float(roleIndex);
  float rowFi = surfRenderRowFi(roleIndex);
  vec2 uvX = surfRandomizedUV(wp.zy * inv, roleFi, salt + 1.0);
  vec2 uvY = surfRandomizedUV(wp.xz * inv, roleFi, salt + 2.0);
  vec2 uvZ = surfRandomizedUV(wp.xy * inv, roleFi, salt + 3.0);
  float cx = texture2D(atlas, surfAtlasUV(rowFi, uvX)).r;
  float cy = texture2D(atlas, surfAtlasUV(rowFi, uvY)).r;
  float cz = texture2D(atlas, surfAtlasUV(rowFi, uvZ)).r;
  return cx * blend.x + cy * blend.y + cz * blend.z;
}

vec3 surfPaletteForRole(int roleIndex) {
  if (roleIndex == 0) return applyPalettePost(uColSand);
  if (roleIndex == 1) return applyPalettePost(uColDune);
  if (roleIndex == 2) return applyPalettePost(uColDryGrass);
  if (roleIndex == 3) return applyPalettePost(uColGrass);
  if (roleIndex == 4) return applyPalettePost(uColForest);
  if (roleIndex == 5) return applyPalettePost(uColJungle);
  if (roleIndex == 6) return applyPalettePost(uColSwamp);
  if (roleIndex == 7) return applyPalettePost(uColTundra);
  if (roleIndex == 8) return applyPalettePost(uColRedRock);
  if (roleIndex == 9) return applyPalettePost(uColRedRock2);
  if (roleIndex == 10) return applyPalettePost(uColRock);
  if (roleIndex == 11) return applyPalettePost(uColRockHi);
  return applyPalettePost(uColSnow);
}

SurfMaterialSample surfMixSamples(SurfMaterialSample a, SurfMaterialSample b, float k) {
  SurfMaterialSample outS;
  outS.albedo = mix(a.albedo, b.albedo, k);
  outS.normal = normalize(mix(a.normal, b.normal, k));
  outS.rough = mix(a.rough, b.rough, k);
  outS.ao = mix(a.ao, b.ao, k);
  outS.missing = mix(a.missing, b.missing, k);
  return outS;
}

SurfMaterialSample surfSampleRole(int roleIndex, vec3 wp, vec3 blend, vec3 nGeo) {
  SurfMaterialSample s;
  float tile = surfTileForRole(roleIndex);
  s.albedo = surfTriRole(uSurfDiffuse, roleIndex, wp, blend, tile);
  s.normal = nGeo;
  if (uSurfNormalAmt > 0.001) {
    s.normal = surfTriNormalRole(roleIndex, wp, blend, tile, nGeo);
  }
  s.rough = surfTriScalarRole(uSurfRough, roleIndex, wp, blend, tile, 7.0);
  s.ao = surfTriScalarRole(uSurfAO, roleIndex, wp, blend, tile, 11.0);
  s.missing = 1.0 - step(0.5, surfRoleReady(roleIndex));

  float tintAmt = clamp(uSurfPaletteInfluence, 0.0, 1.0) * (1.0 - step(0.5, s.missing));
  float lum = dot(s.albedo, vec3(0.299, 0.587, 0.114));
  vec3 palette = surfPaletteForRole(roleIndex);
  vec3 tinted = palette * mix(0.48, 1.55, lum);
  s.albedo = mix(s.albedo, max(tinted, vec3(0.0)), tintAmt);
  return s;
}

SurfRoleWeights surfMaterialWeights(
  TerrainColorResult tc, Climate cl, BiomeWeights bw,
  float slope, float hRel, float h01, float detail, float jitter
) {
  SurfRoleWeights w;
  w.sand = 0.0;
  w.dune = 0.0;
  w.dryGrass = 0.0;
  w.grass = 0.0;
  w.forest = 0.0;
  w.jungle = 0.0;
  w.swamp = 0.0;
  w.tundra = 0.0;
  w.redRock = 0.0;
  w.redRock2 = 0.0;
  w.rock = 0.0;
  w.rockHi = 0.0;
  w.snow = 0.0;

  float tempEff = clamp(cl.temp - h01 * 0.55, 0.0, 1.0);
  float jt = jitter * 0.06;
  float veg = vegetationDensity(cl, h01, slope);
  float snow = clamp(tc.snow, 0.0, 1.0);
  float shore = 1.0 - smoothstep(tc.sandBand * 0.4, max(tc.sandBand, 0.3), max(hRel, 0.0));
  float beach = shore * (1.0 - bw.wetland * 0.85);
  float desert = clamp(bw.desert * 0.95 + beach * 0.25, 0.0, 1.0);

  float highBlend = smoothstep(0.30, 0.62, h01 + jitter * 0.08) * (1.0 - bw.desert * 0.7);
  float slopeRock = smoothstep(0.42, 0.72, slope + jitter * 0.06);
  float canyon = bw.canyon * smoothstep(1.0, 6.0, hRel);
  float rockTake = clamp(max(max(slopeRock, highBlend), canyon), 0.0, 1.0) * (1.0 - snow);
  float lowland = clamp((1.0 - snow) * (1.0 - rockTake * 0.82), 0.0, 1.0);

  float sandW = beach * lowland;
  float duneW = desert * (1.0 - beach * 0.55) * lowland;
  float swampW = bw.wetland * tc.flatness * (1.0 - snow) * (1.0 - rockTake);
  float vegBase = clamp(lowland * (1.0 - clamp(sandW + duneW + swampW * 0.8, 0.0, 0.95)), 0.0, 1.0);

  float cold = 1.0 - smoothstep(0.20, 0.38, tempEff + jt);
  float hot = smoothstep(0.55, 0.72, tempEff + jt);
  float moistLow = smoothstep(0.18, 0.42, cl.moist);
  float moistMid = smoothstep(0.30, 0.62, cl.moist);
  float moistHigh = smoothstep(0.55, 0.78, cl.moist);
  float forestBias = veg * moistMid * (0.5 + 0.5 * smoothstep(0.35, 0.65, detail));

  w.sand = sandW;
  w.dune = duneW;
  w.swamp = swampW;
  w.tundra = vegBase * cold * (1.0 - bw.desert);
  w.jungle = vegBase * hot * moistHigh * max(veg, 0.35);
  w.forest = vegBase * forestBias * (1.0 - hot * 0.35) * (1.0 - cold * 0.55);
  w.grass = vegBase * moistLow * (1.0 - forestBias * 0.55) * (1.0 - cold * 0.35);
  w.dryGrass = vegBase * (1.0 - moistLow * 0.72) * (1.0 - cold * 0.25);

  float band = fract(h01 * 14.0 + detail * 0.15);
  float redMix = smoothstep(0.25, 0.75, band);
  float redTotal = canyon * (1.0 - snow);
  float neutralRock = clamp(rockTake - redTotal * 0.65, 0.0, 1.0);
  w.redRock = redTotal * (1.0 - redMix);
  w.redRock2 = redTotal * redMix;
  w.rock = neutralRock * (1.0 - smoothstep(0.35, 0.78, detail));
  w.rockHi = max(highBlend * (1.0 - snow), neutralRock * smoothstep(0.30, 0.80, detail));
  w.snow = snow;
  return w;
}

void surfCheckRole(int roleIndex, float weight, inout int bestI, inout int secondI, inout float bestW, inout float secondW) {
  float wi = max(weight, 0.0);
  if (wi > bestW) {
    secondW = bestW;
    secondI = bestI;
    bestW = wi;
    bestI = roleIndex;
  } else if (wi > secondW) {
    secondW = wi;
    secondI = roleIndex;
  }
}

SurfaceTexResult applySurfaceMaterials(
  vec3 baseAlbedo, vec3 n, vec3 baseNormal, vec3 nGeo, vec3 wpos, float dist,
  TerrainColorResult tc, Climate cl, BiomeWeights bw, float slope, float hRel, float h01,
  float detail, float jitter
) {
  SurfaceTexResult res;
  res.albedo = baseAlbedo;
  res.normal = n;
  res.ao = 1.0;
  res.rough = 0.8;
  res.amount = 0.0;

  float fade = 1.0 - smoothstep(uSurfNear, uSurfFar, dist);
  float amount = uSurfMode * uSurfAmount * fade;
  if (amount < 0.002) return res;

  vec3 triBlend;
  if (uSurfTriplanar > 0.5) {
    triBlend = pow(abs(nGeo), vec3(4.0));
    triBlend /= max(triBlend.x + triBlend.y + triBlend.z, 1e-4);
  } else {
    triBlend = vec3(0.0, 1.0, 0.0);
  }

  SurfRoleWeights w = surfMaterialWeights(tc, cl, bw, slope, hRel, h01, detail, jitter);
  int bestI = 0;
  int secondI = 0;
  float bestW = 0.0;
  float secondW = 0.0;
  surfCheckRole(0, w.sand, bestI, secondI, bestW, secondW);
  surfCheckRole(1, w.dune, bestI, secondI, bestW, secondW);
  surfCheckRole(2, w.dryGrass, bestI, secondI, bestW, secondW);
  surfCheckRole(3, w.grass, bestI, secondI, bestW, secondW);
  surfCheckRole(4, w.forest, bestI, secondI, bestW, secondW);
  surfCheckRole(5, w.jungle, bestI, secondI, bestW, secondW);
  surfCheckRole(6, w.swamp, bestI, secondI, bestW, secondW);
  surfCheckRole(7, w.tundra, bestI, secondI, bestW, secondW);
  surfCheckRole(8, w.redRock, bestI, secondI, bestW, secondW);
  surfCheckRole(9, w.redRock2, bestI, secondI, bestW, secondW);
  surfCheckRole(10, w.rock, bestI, secondI, bestW, secondW);
  surfCheckRole(11, w.rockHi, bestI, secondI, bestW, secondW);
  surfCheckRole(12, w.snow, bestI, secondI, bestW, secondW);

  if (bestW < 1e-4) return res;

  SurfMaterialSample tex = surfSampleRole(bestI, wpos, triBlend, nGeo);
  float roleBlend = clamp(uSurfBlend, 0.0, 1.0);
  if (roleBlend > 0.001 && secondW > 1e-4 && secondI != bestI) {
    SurfMaterialSample other = surfSampleRole(secondI, wpos, triBlend, nGeo);
    float kRole = roleBlend * secondW / max(bestW + secondW, 1e-4);
    tex = surfMixSamples(tex, other, clamp(kRole, 0.0, 0.85));
  }

  float k = amount;
  res.albedo = mix(baseAlbedo, tex.albedo, k);
  vec3 normalBase = normalize(baseNormal);
  if (uSurfNormalAmt > 0.001) {
    vec3 boostedN = normalize(nGeo + (tex.normal - nGeo) * uSurfNormalAmt);
    res.normal = normalize(mix(normalBase, boostedN, clamp(k, 0.0, 1.0)));
  } else {
    res.normal = normalBase;
  }
  res.ao = mix(1.0, tex.ao, k * uSurfAOAmt);
  res.rough = mix(0.8, tex.rough, clamp(k * uSurfRoughAmt, 0.0, 1.0));
  res.amount = k;
  return res;
}
`;
