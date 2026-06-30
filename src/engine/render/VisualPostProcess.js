import * as THREE from 'three';

// ============================================================================
// Lightweight single-pass visual post process for Tile mode.
// Runs only when Visuals post FX is enabled. It keeps the same custom render-pass
// style as UnderwaterEffect, avoiding EffectComposer and extra dependencies.
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

uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform float uVignette;
uniform float uBloomStrength;
uniform float uBloomThreshold;
uniform float uSunRaysStrength;
uniform vec2 uSunScreen;
uniform float uSunVisible;
uniform float uTime;

varying vec2 vUv;

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec3 brightSample(vec2 uv) {
  vec3 c = texture2D(tDiffuse, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
  float b = smoothstep(uBloomThreshold, 1.25, luma(c));
  return c * b;
}

void main() {
  vec3 col = texture2D(tDiffuse, vUv).rgb;

  vec2 px = uTexel * 2.0;
  vec3 bloom = vec3(0.0);
  bloom += brightSample(vUv + vec2( px.x,  0.0));
  bloom += brightSample(vUv + vec2(-px.x,  0.0));
  bloom += brightSample(vUv + vec2( 0.0,  px.y));
  bloom += brightSample(vUv + vec2( 0.0, -px.y));
  bloom += brightSample(vUv + vec2( px.x,  px.y) * 1.7);
  bloom += brightSample(vUv + vec2(-px.x,  px.y) * 1.7);
  bloom += brightSample(vUv + vec2( px.x, -px.y) * 1.7);
  bloom += brightSample(vUv + vec2(-px.x, -px.y) * 1.7);
  col += bloom * (uBloomStrength / 8.0);

  if (uSunVisible > 0.5 && uSunRaysStrength > 0.001) {
    vec2 dir = uSunScreen - vUv;
    float dist = length(dir);
    vec2 stepDir = dir / 16.0;
    vec2 uv = vUv;
    float shaft = 0.0;
    float decay = 1.0;
    for (int i = 0; i < 16; i++) {
      uv += stepDir;
      float b = max(luma(texture2D(tDiffuse, clamp(uv, vec2(0.001), vec2(0.999))).rgb) - 0.52, 0.0);
      shaft += b * decay;
      decay *= 0.88;
    }
    float streak = 0.65 + 0.35 * hash21(floor(vec2(atan(dir.y, dir.x) * 20.0, dist * 18.0 - uTime)));
    float falloff = smoothstep(1.15, 0.0, dist);
    col += vec3(1.0, 0.92, 0.72) * shaft * streak * falloff * uSunRaysStrength * 0.035;
  }

  col *= max(uExposure, 0.0);
  col = (col - 0.5) * uContrast + 0.5;
  float y = luma(col);
  col = mix(vec3(y), col, uSaturation);

  float vig = smoothstep(0.95, 0.28, length(vUv - 0.5));
  col *= mix(1.0 - uVignette, 1.0, vig);

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

export class VisualPostProcess {
  constructor() {
    this._rt = null;
    this._quadScene = new THREE.Scene();
    this._quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        tDiffuse: { value: null },
        uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 768) },
        uExposure: { value: 1 },
        uContrast: { value: 1 },
        uSaturation: { value: 1 },
        uVignette: { value: 0 },
        uBloomStrength: { value: 0 },
        uBloomThreshold: { value: 0.75 },
        uSunRaysStrength: { value: 0 },
        uSunScreen: { value: new THREE.Vector2(0.5, 0.8) },
        uSunVisible: { value: 0 },
        uTime: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -1, -1, 0, 3, -1, 0, -1, 3, 0,
    ]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
      0, 0, 2, 0, 0, 2,
    ]), 2));
    this._quadScene.add(new THREE.Mesh(geo, this._material));
  }

  get inputTarget() {
    return this._rt;
  }

  enabled(params, worldMode) {
    return worldMode === 'studio' && params?.visualsPostEnabled !== false;
  }

  update(params, time, sunScreen) {
    const u = this._material.uniforms;
    u.uExposure.value = params.visualsExposure ?? 1;
    u.uContrast.value = params.visualsContrast ?? 1;
    u.uSaturation.value = params.visualsSaturation ?? 1;
    u.uVignette.value = params.visualsVignette ?? 0;
    u.uBloomStrength.value = params.visualsBloomStrength ?? 0;
    u.uBloomThreshold.value = params.visualsBloomThreshold ?? 0.75;
    u.uSunRaysStrength.value = params.visualsSunRaysStrength ?? 0;
    u.uTime.value = time;
    if (sunScreen) {
      u.uSunScreen.value.set(sunScreen.x, sunScreen.y);
      u.uSunVisible.value = sunScreen.visible ? 1 : 0;
    }
  }

  ensureTarget(renderer) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, size.x);
    const h = Math.max(1, size.y);
    this._material.uniforms.uTexel.value.set(1 / w, 1 / h);
    if (this._rt && this._rt.width === w && this._rt.height === h) return;
    if (this._rt) this._rt.dispose();
    this._rt = new THREE.WebGLRenderTarget(w, h, {
      // The Tile scene renders into this target before the fullscreen color
      // pass. It needs depth or backfaces/plinth geometry draw over terrain in
      // submission order.
      depthBuffer: true,
      stencilBuffer: false,
    });
  }

  render(renderer, inputTexture, outputTarget = null) {
    this._material.uniforms.tDiffuse.value = inputTexture;
    renderer.setRenderTarget(outputTarget);
    renderer.render(this._quadScene, this._quadCam);
    if (outputTarget) renderer.setRenderTarget(null);
  }

  dispose() {
    if (this._rt) { this._rt.dispose(); this._rt = null; }
    this._material.dispose();
    this._quadScene.children.forEach((m) => m.geometry?.dispose?.());
  }
}
