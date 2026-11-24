import * as THREE from 'three';
import { CLOUD_NOISE_GLSL, CLOUD_FIELD_GLSL, CLOUD_SLAB_GLSL, CLOUD_VOLUME_GLSL } from './cloudGLSL.js';
import { REALISTIC_CLOUD_FIELD_GLSL } from './realistic/realisticCloudGLSL.js';
import { CLOUD_V2_FIELD_GLSL } from './v2/cloudV2GLSL.js';

export const TERRAIN_CLOUD_SHADOW_GLSL = /* glsl */ `
// Tile occupancy occupies R; cloud optical depth uses its otherwise unused G.
// Sharing the map keeps the terrain within the WebGL texture-unit budget.
#define uTerrainCloudShadowTex uTileOccupancy
uniform float uTerrainCloudShadowEnabled;
uniform float uTerrainCloudShadowStrength;
uniform vec2 uTerrainCloudShadowCenter;
uniform float uTerrainCloudShadowExtent;
uniform float uTerrainCloudShadowAltitude;
uniform float uTerrainCloudShadowPlanet;

vec2 cloudShadowOctUV(vec3 d) {
  d /= abs(d.x) + abs(d.y) + abs(d.z);
  vec2 p = d.xy;
  if (d.z < 0.0) p = (1.0 - abs(p.yx)) * mix(vec2(-1.0), vec2(1.0), step(vec2(0.0), p));
  return p * 0.5 + 0.5;
}

float terrainCloudShadow(vec3 worldPos) {
  if (uTerrainCloudShadowEnabled < 0.5) return 0.0;
  vec2 uv;
  if (uTerrainCloudShadowPlanet > 0.5) {
    vec3 up = normalize(worldPos);
    if (dot(up, uSunDir) <= 0.01) return 0.0;
    float b = dot(worldPos, uSunDir);
    float r = uTerrainCloudShadowAltitude;
    float t = max(0.0, -b + sqrt(max(b * b - dot(worldPos, worldPos) + r * r, 0.0)));
    uv = cloudShadowOctUV(normalize(worldPos + uSunDir * t));
  } else {
    if (uSunDir.y <= 0.01 || worldPos.y >= uTerrainCloudShadowAltitude) return 0.0;
    float rise = uTerrainCloudShadowAltitude - worldPos.y;
    vec2 xz = worldPos.xz + uSunDir.xz * rise / max(uSunDir.y, 0.05);
    uv = (xz - uTerrainCloudShadowCenter) / (2.0 * uTerrainCloudShadowExtent) + 0.5;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
  }
  vec2 texel = 1.5 / vec2(textureSize(uTerrainCloudShadowTex, 0));
  float shadow = 0.25 * (
    texture2D(uTerrainCloudShadowTex, uv + texel).g
    + texture2D(uTerrainCloudShadowTex, uv - texel).g
    + texture2D(uTerrainCloudShadowTex, uv + texel * vec2(1.0, -1.0)).g
    + texture2D(uTerrainCloudShadowTex, uv + texel * vec2(-1.0, 1.0)).g);
  return shadow * uTerrainCloudShadowStrength;
}
`;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

function fragment(realistic, planet, v2 = false) {
  return /* glsl */ `
precision highp float;
${v2 ? CLOUD_V2_FIELD_GLSL : realistic ? REALISTIC_CLOUD_FIELD_GLSL : `
#define CLOUD_OCTAVES 3
#define CLOUD_DETAIL_OCTAVES 0
#define CLOUD_USE_EROSION 0
#define CLOUD_LIGHT_STEPS 1
${CLOUD_NOISE_GLSL}
${CLOUD_FIELD_GLSL}
${planet ? CLOUD_VOLUME_GLSL : CLOUD_SLAB_GLSL}`}
varying vec2 vUv;
uniform vec2 uShadowCenter;
uniform float uShadowExtent;
uniform vec3 uShadowSun;
uniform float uShadowBottom;
uniform float uShadowTop;
uniform sampler2D uShadowTileOccupancy;

vec3 shadowOctDir(vec2 p) {
  vec3 d = vec3(p, 1.0 - abs(p.x) - abs(p.y));
  if (d.z < 0.0) d.xy = (1.0 - abs(d.yx)) * mix(vec2(-1.0), vec2(1.0), step(vec2(0.0), d.xy));
  return normalize(d);
}

void main() {
  float tile = texture2D(uShadowTileOccupancy, vUv).r;
  float span = uShadowTop - uShadowBottom;
  vec3 ro;
  float distance;
  ${planet ? `
  vec3 up = shadowOctDir(vUv * 2.0 - 1.0);
  ro = up * uShadowBottom;
  float mu = dot(up, uShadowSun);
  if (mu <= 0.01) { gl_FragColor = vec4(tile, 0.0, 0.0, 1.0); return; }
  float b = dot(ro, uShadowSun);
  distance = -b + sqrt(max(b*b - dot(ro, ro) + uShadowTop*uShadowTop, 0.0));
  ` : `
  vec2 xz = uShadowCenter + (vUv * 2.0 - 1.0) * uShadowExtent;
  ro = vec3(xz.x, uShadowBottom, xz.y);
  distance = span / max(uShadowSun.y, 0.05);
  `}
  float od = 0.0;
  for (int i = 0; i < 12 + uLoopGuard; i++) {
    vec3 p = ro + uShadowSun * (distance * (float(i) + 0.5) / 12.0);
    od += ${v2 ? 'cloudV2Density(p, 1.0, false)' : realistic ? 'cloudDensityAt(p, 0.0)' : 'cloudDensity(p)'};
  }
${v2 ? /* glsl */ `
  // V2 columns are optically thick: let the shadow follow the mean density
  // along the sun ray instead of saturating on the full extinction.
  float shadow = 1.0 - exp(-od / 12.0 * 6.0);` : /* glsl */ `
  float sigma = ${realistic ? '14.0 * uCloudDensity / max(span, 1.0)' : 'uCloudExtinction'};
  float shadow = 1.0 - exp(-od * distance / 12.0 * sigma);`}
  gl_FragColor = vec4(tile, shadow, 0.0, 1.0);
}
`;
}

/** Small GPU map of the visible density integrated toward the sun. */
export class CloudShadowPass {
  constructor({ realistic = false, planet = false, v2 = false } = {}) {
    v2 = v2 && !planet;
    this.planet = planet;
    // The flat map also feeds the cloud reflections on realistic water, where
    // a calm lake shows its texels: 320 keeps a cumulus a few dozen across.
    const size = planet ? 384 : 320;
    this.target = new THREE.WebGLRenderTarget(size, size, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, generateMipmaps: false,
    });
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader: fragment(realistic, planet, v2),
      defines: planet && realistic ? { CLOUD_PLANET: 1 } : {},
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
    this.material.name = `cloud-shadow.${v2 ? 'realisticV2' : realistic ? 'realistic' : 'legacy'}.${planet ? 'planet' : 'flat'}`;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.Camera();
    this.state = { texture: this.target.texture, center: new THREE.Vector2(), extent: 1, altitude: 0, planet };
    this.uniforms = {
      uShadowCenter: { value: this.state.center }, uShadowExtent: { value: 1 },
      uShadowSun: { value: new THREE.Vector3() },
      uShadowBottom: { value: 0 }, uShadowTop: { value: 1 },
      uShadowTileOccupancy: { value: null },
    };
    this._emptyTiles = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
    this._emptyTiles.needsUpdate = true;
  }

  render(renderer, cloudUniforms, sun, tiles) {
    if (!renderer || !sun || (!this.planet && sun.y <= 0.01)) return null;
    const u = this.uniforms;
    const bottom = (cloudUniforms.uCloudBottom || cloudUniforms.uCloudInner).value;
    const top = (cloudUniforms.uCloudTop || cloudUniforms.uCloudOuter).value;
    const center = cloudUniforms.uCloudCenter?.value;
    if (center) this.state.center.set(center.x, center.z ?? center.y);
    const radius = cloudUniforms.uCloudRadius?.value ?? 1;
    this.state.extent = radius + (top - bottom) * Math.min(8, Math.hypot(sun.x, sun.z) / Math.max(sun.y, 0.05));
    this.state.altitude = bottom;
    u.uShadowExtent.value = this.state.extent;
    u.uShadowBottom.value = bottom;
    u.uShadowTop.value = top;
    u.uShadowSun.value.copy(sun).normalize();
    u.uShadowTileOccupancy.value = tiles || this._emptyTiles;
    this.material.uniforms = { ...cloudUniforms, ...u };
    const target = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace?.() ?? 0;
    const mip = renderer.getActiveMipmapLevel?.() ?? 0;
    const xr = renderer.xr.enabled;
    const autoClear = renderer.autoClear;
    try {
      renderer.xr.enabled = false;
      renderer.autoClear = true;
      renderer.setRenderTarget(this.target);
      renderer.render(this.scene, this.camera);
    } finally {
      renderer.setRenderTarget(target, face, mip);
      renderer.xr.enabled = xr;
      renderer.autoClear = autoClear;
    }
    return this.state;
  }

  dispose() {
    this.target.dispose(); this.material.dispose(); this.mesh.geometry.dispose(); this._emptyTiles.dispose();
  }
}

function createShadowPassFor(layer, planet) {
  return new CloudShadowPass({
    realistic: layer.renderMode === 'realistic',
    v2: layer.renderMode === 'realisticV2',
    planet,
  });
}

export function cloudShadowPreparationPass(layer, planet = false) {
  layer._shadowPass ??= createShadowPassFor(layer, planet);
  const pass = layer._shadowPass;
  pass.material.uniforms = { ...layer.material.uniforms, ...pass.uniforms };
  return { material: pass.material, source: pass.mesh, camera: pass.camera,
    targetScene: pass.scene, renderTarget: pass.target };
}

export function renderTerrainCloudShadow(layer, sun, planet = false, tiles = null) {
  if (!layer._renderer || !layer.active) return null;
  if (layer.renderMode === 'realistic' && !layer.material.uniforms.uCloudNoise.value) return null;
  if (layer.renderMode === 'realisticV2' && !layer.material.uniforms.uNoiseV2.value) return null;
  layer._shadowPass ??= createShadowPassFor(layer, planet);
  return layer._shadowPass.render(layer._renderer, layer.material.uniforms, sun, tiles);
}
