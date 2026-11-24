// Integer lattice hashes are bit-identical in JavaScript and GLSL. Floating
// point hash differences can otherwise put a CPU erosion droplet on the wrong
// side of a narrow divide on GPUs that fuse multiply-adds.
function gradient(ix, iz, dx, dz) {
  let h = Math.imul(ix, 1597334677) ^ Math.imul(iz, 3812015801);
  h = Math.imul(h ^ (h >>> 16), 2246822519);
  h ^= h >>> 13;
  return ((h & 1) ? dx : -dx) + ((h & 2) ? dz : -dz);
}

function canyonNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const dx = x - ix, dz = z - iz;
  const sx = dx * dx * (3 - 2 * dx), sz = dz * dz * (3 - 2 * dz);
  const a = gradient(ix, iz, dx, dz), b = gradient(ix + 1, iz, dx - 1, dz);
  const c = gradient(ix, iz + 1, dx, dz - 1), d = gradient(ix + 1, iz + 1, dx - 1, dz - 1);
  return 0.5 + 0.5 * ((a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz);
}

// Channel distances are in tile-width units. Feeder channels rise away from
// their confluence, so the network has a continuous downhill route to the outlet.
export function canyonDomain(x, z, seed) {
  const n = (scale, offset) => canyonNoise(Math.fround(x * scale + seed.x + offset), Math.fround(z * scale + seed.y));
  return { x, z, seed, broad: n(3, 0), folds: n(13, 11), ribs: n(37, 27), grain: n(95, 71) };
}

export function canyonMainWash(domain, warp, meander) {
  const { x, z, seed, broad, folds, ribs } = domain;
  const cross = x + z * 0.16 + Math.sin(z * 9 + seed.x * 0.07) * meander
    + warp * ((broad - 0.5) * 0.23 + (folds - 0.5) * 0.058 + (ribs - 0.5) * 0.018);
  const side = Math.abs(cross);
  const along = z + side * (cross < 0 ? 0.81 : 0.61) + (broad - 0.5) * 0.17;
  return { domain, cross, along, distance: side };
}

export function canyonTributaries(channel, leftSpacing, rightSpacing) {
  const { cross, along } = channel;
  const spacing = cross < 0 ? leftSpacing : rightSpacing;
  const phase = along / spacing + (cross < 0 ? 0.19 : 0.64);
  const feeder = Math.abs(phase - Math.round(phase)) * spacing;
  return { ...channel, distance: Math.min(channel.distance, feeder * 1.18 + Math.abs(cross) * 0.25) };
}

export function canyonHeadwall({ z, broad }, setback, rise) {
  // Close the upper catchment against a scalloped headwall. Small feeder
  // valleys die out at different elevations across the back of the tile.
  return Math.max(0, (-z - setback) * rise + (broad - 0.5) * 0.14);
}

export function canyonBasinRelief(channel, head, ridge, fluting) {
  const { z, broad, folds, ribs, grain } = channel.domain;
  const { along, cross } = channel;
  const side = Math.abs(cross);
  const distance = Math.hypot(channel.distance, head);
  const ramp = Math.min(1, distance * 5.8);
  const lip = Math.min(1, Math.max(0, (distance - 0.084 - broad * 0.034) * 26));
  const flute = Math.sin(155 * (along + side * 0.28 + head * 1.3) + broad * 10 + folds * 4 + ribs * 1.6);
  const incision = Math.pow(0.5 + 0.5 * flute, 3) * ramp * (1 - 0.78 * lip);
  return 0.09 + 0.085 * (0.5 - z) + 0.39 * ramp + ridge * 0.15 * lip * lip * (3 - 2 * lip)
    + (0.025 + 0.13 * ramp) * broad + ramp * (folds * 0.077 + ribs * 0.045 + grain * 0.021) - incision * fluting;
}

export function dryCanyonHeight(x, z, seed, warp, ridge) {
  const domain = canyonDomain(x, z, seed);
  const wash = canyonMainWash(domain, warp, 0.064);
  return canyonBasinRelief(canyonTributaries(wash, 0.29, 0.37), canyonHeadwall(domain, 0.21, 0.95), ridge, 0.095);
}

export const DRY_CANYON_HEIGHT_GLSL = /* glsl */ `
float canyonGradient(ivec2 cell, vec2 offset) {
  uint h = uint(cell.x) * 1597334677u ^ uint(cell.y) * 3812015801u;
  h = (h ^ (h >> 16u)) * 2246822519u;
  h ^= h >> 13u;
  return ((h & 1u) != 0u ? offset.x : -offset.x) + ((h & 2u) != 0u ? offset.y : -offset.y);
}
float canyonNoise(vec2 p) {
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p), w = f * f * (3.0 - 2.0 * f);
  float a = canyonGradient(i, f), b = canyonGradient(i+ivec2(1,0), f-vec2(1,0));
  float c = canyonGradient(i+ivec2(0,1), f-vec2(0,1)), d = canyonGradient(i+ivec2(1), f-vec2(1));
  return 0.5 + 0.5 * mix(mix(a,b,w.x),mix(c,d,w.x),w.y);
}
struct CanyonDomain { vec2 p; vec2 seed; vec4 noiseBands; };
struct CanyonChannel { CanyonDomain domain; float crossDist; float along; float valleyDist; };
CanyonDomain canyonDomain(vec2 p, vec2 seed) {
  float broad = canyonNoise(p * 3.0 + seed);
  float folds = canyonNoise(p * 13.0 + seed + vec2(11,0));
  float ribs = canyonNoise(p * 37.0 + seed + vec2(27,0));
  float grain = canyonNoise(p * 95.0 + seed + vec2(71,0));
  return CanyonDomain(p, seed, vec4(broad, folds, ribs, grain));
}
CanyonChannel canyonMainWash(CanyonDomain domain, float warp, float meander) {
  vec2 p = domain.p;
  float broad = domain.noiseBands.x, folds = domain.noiseBands.y, ribs = domain.noiseBands.z;
  float c = p.x + p.y * 0.16 + sin(p.y * 9.0 + domain.seed.x * 0.07) * meander
    + warp * dot(vec3(broad, folds, ribs) - 0.5, vec3(0.23, 0.058, 0.018));
  float side = abs(c);
  float along = p.y + side * (c < 0.0 ? 0.81 : 0.61) + (broad - 0.5) * 0.17;
  return CanyonChannel(domain, c, along, side);
}
CanyonChannel canyonTributaries(CanyonChannel channel, float leftSpacing, float rightSpacing) {
  float spacing = channel.crossDist < 0.0 ? leftSpacing : rightSpacing;
  float feeder = abs(fract(channel.along / spacing + (channel.crossDist < 0.0 ? 0.19 : 0.64) + 0.5) - 0.5) * spacing;
  channel.valleyDist = min(channel.valleyDist, feeder * 1.18 + abs(channel.crossDist) * 0.25);
  return channel;
}
float canyonHeadwall(CanyonDomain domain, float setback, float rise) {
  return max(0.0, (-domain.p.y - setback) * rise + (domain.noiseBands.x - 0.5) * 0.14);
}
float canyonBasinRelief(CanyonChannel channel, float head, float ridge, float fluting) {
  vec2 p = channel.domain.p;
  vec4 bands = channel.domain.noiseBands;
  float broad = bands.x, folds = bands.y, ribs = bands.z, grain = bands.w;
  float along = channel.along, side = abs(channel.crossDist);
  float d = length(vec2(channel.valleyDist, head));
  float ramp = min(1.0, d * 5.8);
  float lip = clamp((d - 0.084 - broad * 0.034) * 26.0, 0.0, 1.0);
  float flute = sin(155.0 * (along + side * 0.28 + head * 1.3) + broad * 10.0 + folds * 4.0 + ribs * 1.6);
  float incision = pow(0.5 + 0.5 * flute, 3.0) * ramp * (1.0 - 0.78 * lip);
  return 0.09 + 0.085 * (0.5 - p.y) + 0.39 * ramp + ridge * 0.15 * lip * lip * (3.0 - 2.0 * lip)
    + (0.025 + 0.13 * ramp) * broad + ramp * (folds * 0.077 + ribs * 0.045 + grain * 0.021) - incision * fluting;
}
float dryCanyonHeight(vec2 p, vec2 seed, float warp, float ridge) {
  CanyonDomain domain = canyonDomain(p, seed);
  CanyonChannel wash = canyonMainWash(domain, warp, 0.064);
  return canyonBasinRelief(canyonTributaries(wash, 0.29, 0.37), canyonHeadwall(domain, 0.21, 0.95), ridge, 0.095);
}
`;

export const CANYON_MATERIAL_FUNCTIONS = /* glsl */ `
#ifndef CANYON_MATERIAL_FUNCTIONS
#define CANYON_MATERIAL_FUNCTIONS
vec2 canyonGrain(vec2 p, float h) {
  float fleck = vnoise(p * 0.33 + h * vec2(0.21,-0.09));
  float mottling = vnoise(p * 0.019) * 0.50 + vnoise(p * 0.09) * 0.32 + fleck * 0.18;
  return vec2(fleck, mottling);
}
float canyonRockExposure(float h01, float slope, float erosion, float mottling) {
  float exposure = smoothstep(0.17, 0.61, slope + sqrt(erosion) * 0.70 + (mottling - 0.5) * 0.37);
  float caprock = smoothstep(0.32, 0.69, h01 + (mottling - 0.5) * 0.19);
  return exposure * mix(0.26, 1.0, max(caprock, smoothstep(0.32,0.77,erosion)));
}
float canyonWashCoverage(float slope, float flow, float deposition) {
  return smoothstep(0.11, 0.56, sqrt(deposition) + flow * 0.85) * (1.0 - smoothstep(0.08, 0.48, slope));
}
vec3 canyonScrubSoil(vec2 p, float slope, float deposits, vec2 grain) {
  float fleck = grain.x, mottling = grain.y;
  float crowns = vnoise(p * 0.23) * 0.74 + vnoise(p * 0.58) * 0.26;
  float cover = smoothstep(0.30, 0.48, crowns + (mottling - 0.5) * 0.65)
    * (1.0 - smoothstep(0.21,0.62,slope)) * (1.0 - deposits);
  vec3 soil = mix(vec3(0.085,0.075,0.045), vec3(0.35,0.30,0.205), mottling);
  soil = mix(soil, vec3(0.035,0.036,0.023) * (0.7 + 0.7 * fleck), cover);
  return soil * (0.80 + 0.35 * fleck);
}
vec3 canyonBeddedRock(vec2 p, float h, vec2 grain) {
  float bedding = sin(h * 0.42 + vnoise(p * 0.012) * 2.6) * 0.5 + 0.5;
  return mix(vec3(0.30,0.216,0.145), vec3(0.69,0.58,0.415), bedding * 0.39 + grain.y * 0.61) * (0.80 + 0.35 * grain.x);
}
vec3 canyonWashGravel(vec2 grain) {
  return mix(vec3(0.32,0.265,0.18), vec3(0.62,0.54,0.40), grain.x) * (0.80 + 0.35 * grain.x);
}
#endif
`;

export const DRY_CANYON_SURFACE_GLSL = /* glsl */ `
${CANYON_MATERIAL_FUNCTIONS}
void applyDryCanyonSurface(inout TerrainColorResult tc, vec2 xz, float h, float slope) {
  if (uDryCanyon < 0.5 || uInfiniteMode > 0.5) return;
  vec3 masks = erosionSampleAt(xz).gba;
  vec2 p = xz + uSeedOffset;
  vec2 grain = canyonGrain(p, h);
  float exposure = canyonRockExposure(h / max(uHeightScale,1.0), slope, masks.x, grain.y);
  float deposits = canyonWashCoverage(slope, masks.z, masks.y);
  tc.albedo = mix(mix(canyonScrubSoil(p, slope, deposits, grain), canyonBeddedRock(p, h, grain), exposure), canyonWashGravel(grain), deposits);
  tc.rockBlend = exposure * (1.0 - deposits);
  tc.snow = 0.0;
}
`;
