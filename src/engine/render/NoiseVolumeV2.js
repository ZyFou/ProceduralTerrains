import * as THREE from 'three';

// ============================================================================
// Shared GPU noise for the "V2" look (Realistic V2 clouds, Procedural V2
// terrain surface):
//
//   volume   128^3 RGBA8, tileable, mip-mapped
//            r = Perlin-Worley (billowy bodies)
//            g / b / a = Worley fbm at 4 / 8 / 16 cells (erosion + detail)
//   weather  512^2 RGBA8, tileable, mip-mapped
//            r = Perlin fbm, g = Worley cells, b = second Perlin fbm
//
// Both are baked once per renderer on first use and shared by every consumer
// (retain / release reference counting). The mip chain is what keeps the V2
// shaders cheap: every tap is an explicit-LOD lookup whose level follows the
// march step or the pixel footprint, so distant samples read a few texels of
// pre-filtered noise instead of aliasing or evaluating procedural octaves.
// ============================================================================

export const NOISE_VOLUME_V2_SIZE = 128;
export const CLOUD_WEATHER_V2_SIZE = 512;

const FULLSCREEN_VERTEX = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Tileable gradient / cellular noise. The zero-valued uLoopGuard keeps the
// cell loops real loops on ANGLE/D3D (FXC otherwise unrolls 243 cell visits).
const NOISE_GEN_GLSL = /* glsl */ `
precision highp float;
uniform int uLoopGuard;

float nv2Sat(float x) { return clamp(x, 0.0, 1.0); }
float nv2Remap(float v, float a, float b, float c, float d) {
  return c + (v - a) / (b - a) * (d - c);
}

uvec3 nv2Pcg3(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

vec3 nv2Hash33(vec3 p) {
  return vec3(nv2Pcg3(uvec3(ivec3(p)))) * (1.0 / 4294967296.0);
}

float nv2Grad(vec3 i, vec3 f, vec3 o, float per) {
  return dot(nv2Hash33(mod(i + o, per) + per * 3.0) * 2.0 - 1.0, f - o);
}

float nv2Perlin(vec3 x, float per) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = mix(
    mix(nv2Grad(i, f, vec3(0.0, 0.0, 0.0), per), nv2Grad(i, f, vec3(1.0, 0.0, 0.0), per), u.x),
    mix(nv2Grad(i, f, vec3(0.0, 1.0, 0.0), per), nv2Grad(i, f, vec3(1.0, 1.0, 0.0), per), u.x),
    u.y);
  float b = mix(
    mix(nv2Grad(i, f, vec3(0.0, 0.0, 1.0), per), nv2Grad(i, f, vec3(1.0, 0.0, 1.0), per), u.x),
    mix(nv2Grad(i, f, vec3(0.0, 1.0, 1.0), per), nv2Grad(i, f, vec3(1.0, 1.0, 1.0), per), u.x),
    u.y);
  return mix(a, b, u.z);
}

float nv2Worley(vec3 x, float per) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  float md = 1e9;
  for (int a = -1; a <= 1 + uLoopGuard; a++)
  for (int b = -1; b <= 1 + uLoopGuard; b++)
  for (int c = -1; c <= 1 + uLoopGuard; c++) {
    vec3 o = vec3(float(a), float(b), float(c));
    vec3 h = nv2Hash33(mod(i + o + per, per) + per * 5.0);
    vec3 r = o + h - f;
    md = min(md, dot(r, r));
  }
  return nv2Sat(1.0 - sqrt(md));
}

float nv2PerlinFbm(vec3 p, float per, int octaves) {
  float amp = 1.0;
  float sum = 0.0;
  for (int i = 0; i < 6 + uLoopGuard; i++) {
    if (i >= octaves) break;
    sum += amp * nv2Perlin(p * per, per);
    per *= 2.0;
    amp *= 0.55;
  }
  return sum;
}

float nv2WorleyFbm(vec3 p, float per) {
  return nv2Worley(p * per, per) * 0.625
    + nv2Worley(p * per * 2.0, per * 2.0) * 0.25
    + nv2Worley(p * per * 4.0, per * 4.0) * 0.125;
}
`;

export const NOISE_VOLUME_V2_FRAGMENT = /* glsl */ `
${NOISE_GEN_GLSL}
uniform float uLayer;
uniform float uSize;

void main() {
  vec3 p = vec3(gl_FragCoord.xy, uLayer + 0.5) / uSize;
  float perlin = nv2Sat(0.5 + 0.62 * nv2PerlinFbm(p, 4.0, 6));
  float w0 = nv2WorleyFbm(p, 4.0);
  float w1 = nv2WorleyFbm(p, 8.0);
  float w2 = nv2WorleyFbm(p, 16.0);
  // Perlin dilated by Worley: connected billowy bodies
  gl_FragColor = vec4(nv2Remap(perlin, 0.0, 1.0, w0, 1.0), w0, w1, w2);
}
`;

export const CLOUD_WEATHER_V2_FRAGMENT = /* glsl */ `
${NOISE_GEN_GLSL}
uniform float uSize;

void main() {
  vec3 p = vec3(gl_FragCoord.xy / uSize, 0.37);
  float perlin = nv2Sat(0.5 + 0.75 * nv2PerlinFbm(p, 3.0, 5));
  float cells = nv2Worley(p * 6.0, 6.0) * 0.50
    + nv2Worley(p * 13.0, 13.0) * 0.32
    + nv2Worley(p * 29.0, 29.0) * 0.18;
  float perlinB = nv2Sat(0.5 + 0.75 * nv2PerlinFbm(p + vec3(0.0, 0.0, 0.5), 5.0, 4));
  gl_FragColor = vec4(perlin, cells, perlinB, 1.0);
}
`;

function bakeMaterial(fragmentShader, uniforms) {
  const material = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader,
    uniforms: { uLoopGuard: { value: 0 }, ...uniforms },
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
  return material;
}

function withBakeState(renderer, fn) {
  const prevTarget = renderer.getRenderTarget();
  const prevFace = renderer.getActiveCubeFace?.() ?? 0;
  const prevMip = renderer.getActiveMipmapLevel?.() ?? 0;
  const prevAutoClear = renderer.autoClear;
  const prevXr = renderer.xr?.enabled;
  try {
    renderer.autoClear = false;
    if (renderer.xr) renderer.xr.enabled = false;
    fn();
  } finally {
    renderer.setRenderTarget(prevTarget, prevFace, prevMip);
    renderer.autoClear = prevAutoClear;
    if (renderer.xr) renderer.xr.enabled = prevXr;
  }
}

const _shared = new WeakMap();
const _owners = new WeakMap();

function entryFor(renderer) {
  let entry = _shared.get(renderer);
  if (entry) return entry;

  const volumeRT = new THREE.WebGL3DRenderTarget(
    NOISE_VOLUME_V2_SIZE, NOISE_VOLUME_V2_SIZE, NOISE_VOLUME_V2_SIZE, { depthBuffer: false },
  );
  const volume = volumeRT.texture;
  volume.name = 'noise-volume-v2';
  volume.format = THREE.RGBAFormat;
  volume.type = THREE.UnsignedByteType;
  volume.minFilter = THREE.LinearMipmapLinearFilter;
  volume.magFilter = THREE.LinearFilter;
  volume.wrapS = volume.wrapT = volume.wrapR = THREE.RepeatWrapping;
  // Mips are generated once, after the last layer (see bake below).
  volume.generateMipmaps = false;

  const weatherRT = new THREE.WebGLRenderTarget(CLOUD_WEATHER_V2_SIZE, CLOUD_WEATHER_V2_SIZE, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: true,
  });
  weatherRT.texture.name = 'cloud-weather-v2';

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);

  entry = {
    volumeRT,
    weatherRT,
    baked: false,
    volumeMaterial: bakeMaterial(NOISE_VOLUME_V2_FRAGMENT, {
      uLayer: { value: 0 }, uSize: { value: NOISE_VOLUME_V2_SIZE },
    }),
    weatherMaterial: bakeMaterial(CLOUD_WEATHER_V2_FRAGMENT, {
      uSize: { value: CLOUD_WEATHER_V2_SIZE },
    }),
    quad,
    scene,
    camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
  };
  _shared.set(renderer, entry);
  return entry;
}

function disposeEntry(entry) {
  entry.volumeRT.dispose();
  entry.weatherRT.dispose();
  entry.volumeMaterial.dispose();
  entry.weatherMaterial.dispose();
  entry.quad.geometry.dispose();
}

/** Keep the shared textures alive; returns the matching release function. */
export function retainNoiseVolumeV2(renderer) {
  if (!renderer) return () => {};
  _owners.set(renderer, (_owners.get(renderer) || 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (_owners.get(renderer) || 1) - 1;
    if (count > 0) { _owners.set(renderer, count); return; }
    _owners.delete(renderer);
    const entry = _shared.get(renderer);
    if (entry) { disposeEntry(entry); _shared.delete(renderer); }
  };
}

/** Bake programs, described for background shader warmup (nothing is drawn). */
export function noiseVolumeV2PreparationPasses(renderer) {
  if (!renderer) return [];
  const entry = entryFor(renderer);
  const base = { source: entry.quad, camera: entry.camera, targetScene: entry.scene };
  return [
    { ...base, material: entry.volumeMaterial, renderTarget: entry.volumeRT },
    { ...base, material: entry.weatherMaterial, renderTarget: entry.weatherRT },
  ];
}

/**
 * Shared V2 noise textures for a renderer, baked on first use. Call outside a
 * scene render (it binds its own targets and restores the previous one).
 * @returns {{ volume: THREE.Data3DTexture, weather: THREE.Texture }}
 */
export function getNoiseVolumeV2(renderer) {
  const entry = entryFor(renderer);
  if (!entry.baked) {
    withBakeState(renderer, () => {
      const material = entry.volumeMaterial;
      const last = NOISE_VOLUME_V2_SIZE - 1;
      for (let layer = 0; layer <= last; layer++) {
        material.uniforms.uLayer.value = layer;
        // One mip build for the whole volume instead of one per layer.
        entry.volumeRT.texture.generateMipmaps = layer === last;
        entry.quad.material = material;
        renderer.setRenderTarget(entry.volumeRT, layer);
        renderer.render(entry.scene, entry.camera);
      }
      entry.volumeRT.texture.generateMipmaps = false;
      entry.quad.material = entry.weatherMaterial;
      renderer.setRenderTarget(entry.weatherRT);
      renderer.render(entry.scene, entry.camera);
    });
    entry.baked = true;
  }
  return { volume: entry.volumeRT.texture, weather: entry.weatherRT.texture };
}
