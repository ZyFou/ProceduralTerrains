import * as THREE from 'three';

// ============================================================================
// UnderwaterEffect: camera-underwater post-processing pass.
//
// The project renders directly to the canvas (no composer), so this effect is
// self-contained and strictly opt-in per frame: while the camera is above the
// water surface the scene is rendered directly as before (zero extra cost).
// Only when the camera is at/below water level does the scene get rendered
// into an offscreen target (with depth) and composited through a fullscreen
// underwater shader.
//
// Two quality paths share ONE program (branched on a uniform, so switching
// quality never recompiles):
//   - Lite : tint + exponential fog + cheap distortion + vignette + a single
//            screen-space caustic shimmer. Cheap enough for the legacy water
//            renderer / low-end devices.
//   - High : depth-aware absorption, layered caustic shimmer, sun light shafts,
//            optional suspended particles and a brighter surface when looking
//            up. Paired with the realistic water renderer.
//
// Detection + the smoothed activation `blend` come from the UnderwaterController
// (single source of truth). The underwater colors are derived from the live
// shared uniforms (uColShallow / uColDeep / uPaletteTint) so alien palettes
// produce alien underwater colors automatically.
// ============================================================================

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;

#include <packing>

uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform float uStrength;       // 0 = dry, 1 = fully submerged
uniform float uTime;
uniform float uNear;
uniform float uFar;
uniform vec3  uWaterShallow;   // palette shallow water color (tinted)
uniform vec3  uWaterDeep;      // palette deep water color (tinted)
uniform float uSubmergeDepth;  // how far below the surface the camera is
uniform float uVisibility;     // underwater visibility distance (world units)
uniform float uIntensity;      // user master intensity
uniform float uDistortion;     // user distortion strength
uniform float uHighMode;       // 0 = Lite, 1 = High
uniform float uCausticStr;     // screen-space caustic shimmer strength
uniform float uParticles;      // suspended particle density (High only)
uniform float uLightShafts;    // sun light-shaft strength (High only)
uniform vec2  uSunScreen;      // sun position in screen UV
uniform float uSunVisible;     // 1 if the sun is in front of the camera
uniform float uAspect;         // viewport aspect (w/h)
uniform float uDepthValid;     // 1 if the depth texture is usable

varying vec2 vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// value noise (cheap, self-contained — the post pass has no NOISE include)
float vn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// animated caustic cells (two layers, different scale/speed → not a static tile)
float caustic(vec2 p, float t) {
  float a = vn(p + vec2(t * 0.7, t * 0.5));
  float b = vn(p * 1.7 - vec2(t * 0.45, t * 0.62));
  float c = 1.0 - clamp((abs(a - 0.5) + abs(b - 0.5)) * 2.3, 0.0, 1.0);
  return pow(c, 2.5);
}

float viewDistance(vec2 uv) {
  if (uDepthValid < 0.5) return uFar * 0.5;
  float fragZ = texture2D(tDepth, uv).x;
  float viewZ = perspectiveDepthToViewZ(fragZ, uNear, uFar);
  return min(-viewZ, uFar);
}

void main() {
  float s = uStrength * uIntensity;
  bool high = uHighMode > 0.5;

  // screen-space distortion (scaled by user setting; gentler in Lite)
  vec2 uv = vUv;
  float wob = s * 0.0035 * (0.4 + uDistortion);
  if (high) {
    // higher-frequency, sun-modulated wobble for the realistic renderer
    uv.x += (sin(vUv.y * 30.0 + uTime * 1.9) + sin(vUv.y * 11.0 - uTime * 1.1)) * wob * 0.6;
    uv.y += (cos(vUv.x * 26.0 - uTime * 1.4) + cos(vUv.x * 9.0 + uTime * 0.8)) * wob * 0.55;
  } else {
    uv.x += sin(vUv.y * 28.0 + uTime * 1.7) * wob;
    uv.y += cos(vUv.x * 23.0 - uTime * 1.3) * wob * 0.7;
  }
  uv = clamp(uv, vec2(0.001), vec2(0.999));

  vec3 col = texture2D(tDiffuse, uv).rgb;

  float dist = viewDistance(uv);
  float murk = clamp(uSubmergeDepth / 45.0, 0.0, 1.0);
  vec3 waterCol = mix(uWaterShallow, uWaterDeep, 0.35 + 0.65 * murk);

  // depth-aware fog (denser deeper). High mode shifts color with depth more
  // aggressively (physically-inspired absorption: red goes first).
  float densBase = high ? (1.4 + murk * 1.8) : (1.6 + murk * 1.4);
  float density = densBase / max(uVisibility, 10.0);
  float fogF = clamp(1.0 - exp(-density * density * dist * dist), 0.0, 1.0);

  vec3 uw = col * (0.85 - 0.25 * murk);
  uw = mix(uw, uw * waterCol * 2.2, high ? 0.45 : 0.35);

  if (high) {
    // wavelength-dependent absorption — warm channels attenuate with distance
    vec3 absorb = vec3(0.45, 0.16, 0.07) * (0.6 + 0.9 * murk);
    uw *= exp(-absorb * dist / max(uVisibility, 10.0));
  }

  // desaturation + reduced contrast (soft underwater light)
  float luma = dot(uw, vec3(0.299, 0.587, 0.114));
  uw = mix(uw, vec3(luma), high ? 0.12 : 0.18);
  uw = mix(vec3(0.5 * (uWaterShallow + uWaterDeep) * 0.4 + 0.18), uw, 0.88);

  // NOTE: caustics are projected on the actual sea floor in the terrain shader
  // (world-space, lighting-driven) — NOT faked as a screen overlay here, which
  // read as noise stuck to the lens. The post pass only does water optics.

  // ---- sun light shafts (High only) ----
  if (high && uLightShafts > 0.001 && uSunVisible > 0.5) {
    vec2 d = vUv - uSunScreen;
    d.x *= uAspect;
    float shaft = 0.0;
    float ang = atan(d.y, d.x);
    float r = length(d);
    // streaky radial glow that breaks up with animated noise
    float streak = vn(vec2(ang * 5.0, r * 6.0 - uTime * 0.6));
    shaft = smoothstep(1.1, 0.0, r) * (0.4 + 0.6 * streak);
    shaft *= smoothstep(0.0, 0.25, vUv.y);   // fade toward the seabed
    uw += vec3(1.0, 0.97, 0.85) * shaft * uLightShafts * 0.5;
  }

  // ---- suspended particles (High only, opt-in, kept sparse + subtle) ----
  if (high && uParticles > 0.001) {
    vec2 pp = vec2(vUv.x * uAspect, vUv.y) * 70.0;
    pp.y += uTime * 0.4;                 // slow upward drift
    pp += vec2(sin(uTime * 0.3 + vUv.y * 10.0) * 0.5, 0.0);
    float cell = hash21(floor(pp));
    float spec = smoothstep(0.993, 1.0, cell);   // far fewer specks
    uw += vec3(0.8, 0.9, 1.0) * spec * uParticles * 0.35;
  }

  // ---- brighter surface when looking up (suggest the surface from below) ----
  if (high) {
    float upLook = smoothstep(0.55, 1.0, vUv.y);
    float shimmer = vn(vec2(vUv.x * 10.0 + uTime * 0.7, uTime * 0.4));
    uw += waterCol * upLook * (0.05 + 0.05 * shimmer) * (1.0 - murk * 0.6);
  }

  // fog last so the horizon fully closes into the water color
  uw = mix(uw, waterCol, fogF);

  // vignette
  float vig = smoothstep(1.25, 0.45, length(vUv - 0.5) * 1.6);
  uw *= mix(high ? 0.72 : 0.78, 1.0, vig);

  gl_FragColor = vec4(mix(col, uw, s), 1.0);
}
`;

export class UnderwaterEffect {
  constructor() {
    this.enabled = true;       // settings toggle (perf.underwaterEffect)
    this.intensity = 1.0;      // master strength multiplier
    this.visibility = 140;     // underwater view distance, world units
    this.blendBand = 0.8;      // world units around the surface to fade over
    this.strength = 0;         // mirrored activation 0..1 (from controller)
    this.highMode = false;     // Lite vs High
    this._depthSupported = true;

    this._rt = null;
    this._quadScene = new THREE.Scene();
    this._quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        tDiffuse:       { value: null },
        tDepth:         { value: null },
        uStrength:      { value: 0 },
        uTime:          { value: 0 },
        uNear:          { value: 0.5 },
        uFar:           { value: 80000 },
        uWaterShallow:  { value: new THREE.Vector3(0.1, 0.3, 0.4) },
        uWaterDeep:     { value: new THREE.Vector3(0.02, 0.08, 0.15) },
        uSubmergeDepth: { value: 0 },
        uVisibility:    { value: 140 },
        uIntensity:     { value: 1 },
        uDistortion:    { value: 0.5 },
        uHighMode:      { value: 0 },
        uCausticStr:    { value: 0.4 },
        uParticles:     { value: 0 },
        uLightShafts:   { value: 0 },
        uSunScreen:     { value: new THREE.Vector2(0.5, 0.8) },
        uSunVisible:    { value: 0 },
        uAspect:        { value: 1.7 },
        uDepthValid:    { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    // fullscreen triangle (avoids a diagonal seam, 1 less vertex than a quad)
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -1, -1, 0,   3, -1, 0,   -1, 3, 0,
    ]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
      0, 0,   2, 0,   0, 2,
    ]), 2));
    this._quadScene.add(new THREE.Mesh(geo, this._material));
  }

  get active() { return this.strength > 0.002; }

  /**
   * Sync the pass from the centralized controller + live palette. Call once per
   * frame before render(). Detection/smoothing live in the controller — this
   * just mirrors its resolved state into the shader uniforms.
   *
   * @param {UnderwaterController} controller
   * @param {number} time            shared shader time
   * @param {Object} sharedUniforms  live terrain/water uniforms (palette)
   * @param {Object} [opts]          { distortion, caustics, particles,
   *                                   lightShafts, sunScreen{x,y}, sunVisible }
   */
  update(controller, time, sharedUniforms, opts = {}) {
    this.strength = controller.active ? Math.min(controller.underwaterBlend, 1) : 0;
    this.highMode = controller.quality === 'high';
    if (!this.active) return;

    const u = this._material.uniforms;
    u.uStrength.value = this.strength;
    u.uTime.value = time;
    u.uSubmergeDepth.value = controller.underwaterDepth;
    u.uVisibility.value = this.visibility;
    u.uIntensity.value = this.intensity;
    u.uHighMode.value = this.highMode ? 1 : 0;
    u.uDistortion.value = opts.distortion ?? 0.5;
    u.uCausticStr.value = controller.causticsEnabled ? (opts.caustics ?? 0.4) : 0;
    u.uParticles.value = (this.highMode && controller.particlesEnabled) ? (opts.particles ?? 0.5) : 0;
    u.uLightShafts.value = (this.highMode && controller.lightShaftsEnabled) ? (opts.lightShafts ?? 0.5) : 0;
    if (opts.sunScreen) u.uSunScreen.value.set(opts.sunScreen.x, opts.sunScreen.y);
    u.uSunVisible.value = opts.sunVisible ? 1 : 0;

    // live palette → underwater colors (alien water = alien underwater)
    const tint = sharedUniforms.uPaletteTint.value;
    const sh = sharedUniforms.uColShallow.value;
    const dp = sharedUniforms.uColDeep.value;
    u.uWaterShallow.value.set(sh.x * tint.x, sh.y * tint.y, sh.z * tint.z);
    u.uWaterDeep.value.set(dp.x * tint.x, dp.y * tint.y, dp.z * tint.z);
  }

  /**
   * Render the scene — directly when dry, through the underwater pass when
   * submerged. Drop-in replacement for renderer.render(scene, camera).
   * outputTarget lets Tile-mode visual postprocessing chain after underwater.
   */
  render(renderer, scene, camera, outputTarget = null) {
    if (!this.active) {
      renderer.setRenderTarget(outputTarget);
      renderer.render(scene, camera);
      if (outputTarget) renderer.setRenderTarget(null);
      return;
    }

    const size = outputTarget
      ? new THREE.Vector2(outputTarget.width, outputTarget.height)
      : renderer.getDrawingBufferSize(new THREE.Vector2());
    this._ensureTarget(renderer, size.x, size.y);
    const u = this._material.uniforms;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uAspect.value = size.x / Math.max(size.y, 1);
    u.uDepthValid.value = this._depthSupported ? 1 : 0;

    renderer.setRenderTarget(this._rt);
    renderer.render(scene, camera);

    u.tDiffuse.value = this._rt.texture;
    u.tDepth.value = this._rt.depthTexture;
    renderer.setRenderTarget(outputTarget);
    renderer.render(this._quadScene, this._quadCam);
    if (outputTarget) renderer.setRenderTarget(null);
  }

  _ensureTarget(renderer, width, height) {
    const size = (width && height)
      ? new THREE.Vector2(width, height)
      : renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, Math.round(size.x));
    const h = Math.max(1, Math.round(size.y));
    if (this._rt && this._rt.width === w && this._rt.height === h) return;

    if (this._rt) this._rt.dispose();
    let depthTexture = null;
    try {
      depthTexture = new THREE.DepthTexture(w, h);
      depthTexture.type = THREE.UnsignedInt248Type;
      depthTexture.format = THREE.DepthStencilFormat;
      this._depthSupported = true;
    } catch (e) {
      // No depth-texture support → fall back to a tint/fog-only look (uDepthValid
      // off). The pass still renders; depth-aware fog uses a constant estimate.
      depthTexture = null;
      this._depthSupported = false;
      console.warn('Underwater: depth texture unavailable, using simplified fog', e);
    }
    // no MSAA: with samples > 0, three (r160) resolves depth into a
    // renderbuffer, leaving the sampled depth texture unpopulated. The
    // underwater image is fogged + distorted, so aliasing is not visible.
    this._rt = new THREE.WebGLRenderTarget(w, h, {
      depthTexture: depthTexture || undefined,
      depthBuffer: true,
      stencilBuffer: !!depthTexture,
    });
  }

  dispose() {
    if (this._rt) { this._rt.dispose(); this._rt = null; }
    this._material.dispose();
    this._quadScene.children.forEach((m) => m.geometry?.dispose());
  }
}
