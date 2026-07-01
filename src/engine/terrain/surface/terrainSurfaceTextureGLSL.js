// ============================================================================
// Terrain surface textures — replaces (or tints) the procedural biome COLOR
// with real material textures, blended by the SAME height/slope/climate signals
// the color path already computes (shore->sand, slope->rock, peaks->snow,
// wetland->mud, else grass).
//
// GLSL ES 1.00 (texture2D) to stay compatible with the rest of the terrain
// shader (shared includes are GLSL1). Textures live in 4 vertical ATLAS
// textures (diffuse/normal/rough/ao), one 5-row strip each — row order:
//   0 grass, 1 rock, 2 sand, 3 snow, 4 mud.
// Using 4 atlases (not 20 samplers, not a GLSL3 sampler2DArray) keeps us well
// inside the fragment texture-unit budget without a shader-version bump.
//
// Sampling is triplanar (blend X/Y/Z projections by the geometric normal) so
// cliffs don't stretch. The whole block is a constant-bounded loop with no
// break/dynamic bounds — safe for the D3D11/ANGLE FXC compiler on this machine.
// It early-outs (no texture fetches) when the mode is off or the camera is far,
// and falls back to procedural colour per-material when a texture is absent.
// ============================================================================

export const SURFACE_TEXTURE_LAYERS = ['grass', 'rock', 'sand', 'snow', 'mud'];
export const SURFACE_TEXTURE_ROWS = SURFACE_TEXTURE_LAYERS.length;

export const SURFACE_TEXTURE_UNIFORMS_GLSL = /* glsl */ `
uniform sampler2D uSurfDiffuse;
uniform sampler2D uSurfNormal;
uniform sampler2D uSurfRough;
uniform sampler2D uSurfAO;
uniform float uSurfMode;        // 0 = procedural colours, 1 = textures
uniform float uSurfAmount;      // master blend of textures over colour (0..1)
uniform float uSurfTint;        // 0 = raw texture colour, 1 = recolour by biome palette
uniform float uSurfNormalAmt;   // strength of texture normal relief
uniform float uSurfRoughAmt;    // how much sampled roughness drives the sheen
uniform float uSurfAOAmt;       // how much sampled AO darkens crevices
uniform float uSurfTriplanar;   // 1 = triplanar, 0 = planar world-XZ only
uniform float uSurfNear;        // full-texture distance (m)
uniform float uSurfFar;         // texture fades to colour beyond this (m)
uniform float uSurfTile[${SURFACE_TEXTURE_ROWS}];    // world units per repeat, per material
uniform float uSurfPresent[${SURFACE_TEXTURE_ROWS}]; // 1 if that material's textures are loaded
`;

export const SURFACE_TEXTURE_FUNCTIONS_GLSL = /* glsl */ `
const float SURF_ROWS = ${SURFACE_TEXTURE_ROWS}.0;
const float SURF_INSET = 0.008; // keep the linear kernel inside a row (no bleed)

struct SurfaceTexResult {
  vec3 albedo;
  vec3 normal;
  float ao;
  float rough;
  float amount;   // effective texture influence at this fragment (0 = pure colour)
};

// Map a tiled UV into atlas row fi. wrapS=Repeat handles U in hardware; V is
// packed into the row with a small inset so linear filtering never reads across
// the row boundary. No mips on the atlas -> no coarse-mip cross-row bleed.
vec2 surfAtlasUV(float fi, vec2 uv) {
  float v = fract(uv.y);
  v = (fi + SURF_INSET + v * (1.0 - 2.0 * SURF_INSET)) / SURF_ROWS;
  return vec2(uv.x, v);
}

vec3 surfTri(sampler2D atlas, float fi, vec3 wp, vec3 blend, float tile) {
  float inv = 1.0 / max(tile, 0.01);
  vec3 cx = texture2D(atlas, surfAtlasUV(fi, wp.zy * inv)).rgb;
  vec3 cy = texture2D(atlas, surfAtlasUV(fi, wp.xz * inv)).rgb;
  vec3 cz = texture2D(atlas, surfAtlasUV(fi, wp.xy * inv)).rgb;
  return cx * blend.x + cy * blend.y + cz * blend.z;
}

// Triplanar tangent-space (DirectX) normal -> world normal, reoriented per plane
// with a UDN-style blend. Green is flipped (DX convention).
vec3 surfTriNormal(float fi, vec3 wp, vec3 blend, float tile, vec3 nGeo) {
  float inv = 1.0 / max(tile, 0.01);
  vec3 tx = texture2D(uSurfNormal, surfAtlasUV(fi, wp.zy * inv)).rgb * 2.0 - 1.0;
  vec3 ty = texture2D(uSurfNormal, surfAtlasUV(fi, wp.xz * inv)).rgb * 2.0 - 1.0;
  vec3 tz = texture2D(uSurfNormal, surfAtlasUV(fi, wp.xy * inv)).rgb * 2.0 - 1.0;
  tx.y = -tx.y; ty.y = -ty.y; tz.y = -tz.y; // DX -> GL
  // UDN blend: perturb the geometric normal by each plane's tangent normal
  // (swizzled into that plane) and combine by the triplanar weights.
  vec3 wX = normalize(nGeo + vec3(0.0, tx.y, tx.x));
  vec3 wY = normalize(nGeo + vec3(ty.x, 0.0, ty.y));
  vec3 wZ = normalize(nGeo + vec3(tz.x, tz.y, 0.0));
  return normalize(wX * blend.x + wY * blend.y + wZ * blend.z);
}

float surfTriScalar(sampler2D atlas, float fi, vec3 wp, vec3 blend, float tile) {
  float inv = 1.0 / max(tile, 0.01);
  float cx = texture2D(atlas, surfAtlasUV(fi, wp.zy * inv)).r;
  float cy = texture2D(atlas, surfAtlasUV(fi, wp.xz * inv)).r;
  float cz = texture2D(atlas, surfAtlasUV(fi, wp.xy * inv)).r;
  return cx * blend.x + cy * blend.y + cz * blend.z;
}

// Canonical material weights (grass, rock, sand, snow, mud) derived from the
// same signals the colour path uses, so textured regions line up with the
// colour regions they replace.
void surfMaterialWeights(
  TerrainColorResult tc, BiomeWeights bw, float slope, float hRel, float h01,
  out float w[${SURFACE_TEXTURE_ROWS}]
) {
  float snow = clamp(tc.snow, 0.0, 1.0);
  float highRock = smoothstep(0.32, 0.62, h01) * (1.0 - bw.desert * 0.7);
  float rock = clamp(max(tc.rockBlend, max(bw.canyon, highRock)), 0.0, 1.0);
  float shore = 1.0 - smoothstep(tc.sandBand * 0.4, max(tc.sandBand, 0.3), max(hRel, 0.0));
  float sand = clamp(max(shore, bw.desert * 0.9), 0.0, 1.0);
  float mud = clamp(bw.wetland, 0.0, 1.0);

  // Layer priority (matches the colour path's paint order): grass is the base,
  // then sand/mud overlay lowland, rock overlays slopes/peaks, snow caps.
  float g = 1.0;
  g *= (1.0 - sand);
  float mu = mud * g; g -= mu;
  float sd = sand;
  float rk = rock * (1.0 - snow);
  // rock and snow take over the surface regardless of the lowland split
  float lowland = (1.0 - rk) * (1.0 - snow);
  w[0] = g * lowland;          // grass
  w[2] = sd * lowland;         // sand
  w[4] = mu * lowland;         // mud
  w[1] = rk;                   // rock
  w[3] = snow;                 // snow
}

SurfaceTexResult applySurfaceMaterials(
  vec3 baseAlbedo, vec3 n, vec3 nGeo, vec3 wpos, float dist,
  TerrainColorResult tc, BiomeWeights bw, float slope, float hRel, float h01
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

  // triplanar plane weights (sharpened); planar-XZ only when triplanar is off
  vec3 blend;
  if (uSurfTriplanar > 0.5) {
    blend = pow(abs(nGeo), vec3(4.0));
    blend /= max(blend.x + blend.y + blend.z, 1e-4);
  } else {
    blend = vec3(0.0, 1.0, 0.0);
  }

  float w[${SURFACE_TEXTURE_ROWS}];
  surfMaterialWeights(tc, bw, slope, hRel, h01, w);

  float wsum = 0.0;
  float psum = 0.0;
  vec3 texAlb = vec3(0.0);
  vec3 texNrm = vec3(0.0);
  float texAO = 0.0;
  float texRough = 0.0;

  for (int i = 0; i < ${SURFACE_TEXTURE_ROWS}; i++) {
    float fi = float(i);
    float wi = w[i];
    wsum += wi;
    float pw = wi * uSurfPresent[i];
    if (pw > 0.0015) {
      float tile = uSurfTile[i];
      texAlb += surfTri(uSurfDiffuse, fi, wpos, blend, tile) * pw;
      texNrm += surfTriNormal(fi, wpos, blend, tile, nGeo) * pw;
      texRough += surfTriScalar(uSurfRough, fi, wpos, blend, tile) * pw;
      texAO += surfTriScalar(uSurfAO, fi, wpos, blend, tile) * pw;
      psum += pw;
    }
  }

  if (psum < 1e-4) return res;   // no textured material here -> stay procedural

  texAlb /= psum;
  texNrm = normalize(texNrm);
  texRough /= psum;
  texAO /= psum;

  // coverage = fraction of this fragment's material mix that actually has
  // textures, so a partly-untextured blend eases back to colour rather than
  // popping.
  float coverage = psum / max(wsum, 1e-4);
  float k = amount * coverage;

  // recolour: at uSurfTint=1 the biome palette colour drives hue and the texture
  // supplies only luminance detail; at 0 the raw texture colour shows through.
  float tl = dot(texAlb, vec3(0.299, 0.587, 0.114));
  vec3 recolored = mix(texAlb, baseAlbedo * (0.35 + tl), uSurfTint);

  res.albedo = mix(baseAlbedo, recolored, k);
  res.normal = normalize(mix(n, texNrm, clamp(k * uSurfNormalAmt, 0.0, 1.0)));
  res.ao = mix(1.0, texAO, k * uSurfAOAmt);
  res.rough = texRough;
  res.amount = k;
  return res;
}
`;
