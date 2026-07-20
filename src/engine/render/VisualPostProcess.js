import * as THREE from 'three';
import { resolveCameraRenderPlan } from './CameraRenderPlan.js';

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Existing Tile look pass. It stays separate from the final camera pass so
// pixelation and dithering affect bloom, grading, and sun rays as one image.
const LOOK_FRAGMENT = /* glsl */ `
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

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

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
    col += vec3(1.0, 0.92, 0.72) * shaft * streak * smoothstep(1.15, 0.0, dist) * uSunRaysStrength * 0.035;
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

const CAMERA_FRAGMENT = /* glsl */ `
precision highp float;

uniform sampler2D tDiffuse;
uniform vec2 uSourceSize;
uniform vec2 uOutputSize;
uniform float uReconstructionMode; // 0 linear/downsample, 1 clean, 2 pixelated
uniform float uDithering;
uniform float uDitherStrength;
uniform float uDitherLevels;
uniform float uDitherScale;
uniform float uCrt;
uniform float uCrtStrength;
uniform float uCrtLensBend;
uniform float uCrtLineWidth;
uniform float uChromatic;
uniform float uChromaticStrength;
uniform float uTime;

varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec3 sampleClean(vec2 uv) {
  vec2 p = uv * uSourceSize - 0.5;
  vec2 base = floor(p);
  vec2 f = fract(p);
  vec3 guide = texture2D(tDiffuse, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
  vec3 acc = vec3(0.0);
  float total = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cell = base + vec2(float(x), float(y));
      vec2 suv = (cell + 0.5) / uSourceSize;
      vec3 c = texture2D(tDiffuse, clamp(suv, vec2(0.001), vec2(0.999))).rgb;
      vec2 delta = vec2(float(x), float(y)) - f;
      float spatial = exp(-dot(delta, delta) * 0.85);
      float edge = 1.0 / (1.0 + abs(luma(c) - luma(guide)) * 28.0);
      float w = spatial * edge + 0.0001;
      acc += c * w;
      total += w;
    }
  }
  return acc / total;
}

vec3 sampleSource(vec2 uv) {
  uv = clamp(uv, vec2(0.001), vec2(0.999));
  vec3 result = texture2D(tDiffuse, uv).rgb;
  if (uReconstructionMode > 1.5) {
    vec2 snapped = (floor(uv * uSourceSize) + 0.5) / uSourceSize;
    result = texture2D(tDiffuse, snapped).rgb;
  } else if (uReconstructionMode > 0.5) {
    result = sampleClean(uv);
  }
  return result;
}

float bayer4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float x = q.x;
  float y = q.y;
  if (y < 0.5) {
    if (x < 0.5) return 0.0; if (x < 1.5) return 8.0; if (x < 2.5) return 2.0; return 10.0;
  }
  if (y < 1.5) {
    if (x < 0.5) return 12.0; if (x < 1.5) return 4.0; if (x < 2.5) return 14.0; return 6.0;
  }
  if (y < 2.5) {
    if (x < 0.5) return 3.0; if (x < 1.5) return 11.0; if (x < 2.5) return 1.0; return 9.0;
  }
  if (x < 0.5) return 15.0; if (x < 1.5) return 7.0; if (x < 2.5) return 13.0; return 5.0;
}

void main() {
  float crtStrength = uCrt * uCrtStrength;
  vec2 centered = vUv * 2.0 - 1.0;
  float r2 = dot(centered, centered);
  vec2 warped = centered * (1.0 + crtStrength * uCrtLensBend * 0.18 * r2);
  vec2 uv = warped * 0.5 + 0.5;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);

  vec3 col = sampleSource(uv);
  float chromaPixels = uChromatic * uChromaticStrength + crtStrength * 1.25;
  if (chromaPixels > 0.001) {
    vec2 chroma = centered * chromaPixels / max(uOutputSize, vec2(1.0));
    col.r = sampleSource(uv + chroma).r;
    col.b = sampleSource(uv - chroma).b;
  }

  if (uDithering > 0.5 && uDitherStrength > 0.001) {
    vec2 ditherCoord = uReconstructionMode > 1.5 ? floor(uv * uSourceSize) : gl_FragCoord.xy;
    ditherCoord = floor(ditherCoord / max(uDitherScale, 1.0));
    float threshold = bayer4(ditherCoord) / 16.0 - 0.5;
    float steps = clamp(floor(uDitherLevels + 0.5), 2.0, 32.0) - 1.0;
    vec3 quantized = floor(clamp(col, 0.0, 1.0) * steps + threshold + 0.5) / steps;
    col = mix(col, quantized, uDitherStrength);
  }

  if (crtStrength > 0.001) {
    float lineWidth = max(uCrtLineWidth, 1.0);
    float scanPhase = mod(gl_FragCoord.y, lineWidth * 2.0) / lineWidth;
    float scanWave = 0.5 + 0.5 * cos(scanPhase * 3.14159265);
    float scan = mix(0.76, 1.0, scanWave);
    float maskCell = mod(floor(gl_FragCoord.x), 3.0);
    vec3 mask = maskCell < 1.0 ? vec3(1.0, 0.86, 0.86)
      : (maskCell < 2.0 ? vec3(0.86, 1.0, 0.86) : vec3(0.86, 0.86, 1.0));
    float noise = (hash21(gl_FragCoord.xy + floor(uTime * 30.0)) - 0.5) * 0.035;
    float edge = smoothstep(1.25, 0.38, length(centered));
    col *= mix(vec3(1.0), mask * scan, crtStrength);
    col += noise * crtStrength;
    col *= mix(1.0, edge, crtStrength * 0.45);
  }

  gl_FragColor = vec4(max(col, vec3(0.0)) * inside, 1.0);
}
`;

function fullscreenGeometry() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -1, -1, 0, 3, -1, 0, -1, 3, 0,
  ]), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
    0, 0, 2, 0, 0, 2,
  ]), 2));
  return geo;
}

export class VisualPostProcess {
  constructor() {
    this._sceneRT = null;
    this._lookRT = null;
    this._plan = null;
    this._params = null;
    this._perf = null;
    this._worldMode = 'studio';

    this._quadScene = new THREE.Scene();
    this._quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._lookMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: LOOK_FRAGMENT,
      uniforms: {
        tDiffuse: { value: null },
        uTexel: { value: new THREE.Vector2(1, 1) },
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
    this._cameraMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: CAMERA_FRAGMENT,
      uniforms: {
        tDiffuse: { value: null },
        uSourceSize: { value: new THREE.Vector2(1, 1) },
        uOutputSize: { value: new THREE.Vector2(1, 1) },
        uReconstructionMode: { value: 0 },
        uDithering: { value: 0 },
        uDitherStrength: { value: 0.65 },
        uDitherLevels: { value: 8 },
        uDitherScale: { value: 2 },
        uCrt: { value: 0 },
        uCrtStrength: { value: 0.5 },
        uCrtLensBend: { value: 0.35 },
        uCrtLineWidth: { value: 2 },
        uChromatic: { value: 0 },
        uChromaticStrength: { value: 1.5 },
        uTime: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this._quad = new THREE.Mesh(fullscreenGeometry(), this._lookMaterial);
    this._quad.frustumCulled = false;
    this._quadScene.add(this._quad);
  }

  get inputTarget() { return this._sceneRT; }
  get plan() { return this._plan; }

  lookEnabled(params, worldMode) {
    return worldMode === 'studio' && params?.visualsPostEnabled !== false;
  }

  cameraEffectsEnabled(params) {
    return !!(
      params?.visualsPixelatedEnabled
      || params?.visualsDitheringEnabled
      || params?.visualsCrtEnabled
      || params?.visualsChromaticAberrationEnabled
    );
  }

  enabled(params, worldMode, renderScale = 1) {
    return this.lookEnabled(params, worldMode)
      || this.cameraEffectsEnabled(params)
      || Math.abs(renderScale - 1) > 0.001;
  }

  prepare(renderer, { params, perf, worldMode, renderScale = 1, time = 0, sunScreen = null } = {}) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const plan = resolveCameraRenderPlan({
      outputWidth: size.x,
      outputHeight: size.y,
      renderScale,
      worldMode,
      visualsPostEnabled: params?.visualsPostEnabled,
      pixelatedEnabled: params?.visualsPixelatedEnabled,
      pixelResolution: params?.visualsPixelResolution,
      ditheringEnabled: params?.visualsDitheringEnabled,
      crtEnabled: params?.visualsCrtEnabled,
      chromaticAberrationEnabled: params?.visualsChromaticAberrationEnabled,
    });
    this._plan = plan;
    this._params = params || {};
    this._perf = perf || {};
    this._worldMode = worldMode;

    if (plan.usesSceneTarget) this._sceneRT = this._ensureTarget(this._sceneRT, plan.sceneWidth, plan.sceneHeight, true);
    if (plan.lookEnabled && plan.needsFinalPass) {
      this._lookRT = this._ensureTarget(this._lookRT, plan.sceneWidth, plan.sceneHeight, false);
    }
    this.update(params || {}, time, sunScreen);
    return plan;
  }

  update(params, time, sunScreen) {
    const u = this._lookMaterial.uniforms;
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

    const c = this._cameraMaterial.uniforms;
    c.uDithering.value = params.visualsDitheringEnabled ? 1 : 0;
    c.uDitherStrength.value = params.visualsDitheringStrength ?? 0.65;
    c.uDitherLevels.value = params.visualsDitheringLevels ?? 8;
    c.uDitherScale.value = params.visualsDitheringScale ?? 2;
    c.uCrt.value = params.visualsCrtEnabled ? 1 : 0;
    c.uCrtStrength.value = params.visualsCrtStrength ?? 0.5;
    c.uCrtLensBend.value = params.visualsCrtLensBend ?? 0.35;
    c.uCrtLineWidth.value = params.visualsCrtLineWidth ?? 2;
    c.uChromatic.value = params.visualsChromaticAberrationEnabled ? 1 : 0;
    c.uChromaticStrength.value = params.visualsChromaticAberrationStrength ?? 1.5;
    c.uTime.value = time;
  }

  finish(renderer) {
    const plan = this._plan;
    if (!plan?.usesSceneTarget || !this._sceneRT) return;
    let sourceTexture = this._sceneRT.texture;

    if (plan.lookEnabled) {
      this._lookMaterial.uniforms.tDiffuse.value = sourceTexture;
      this._lookMaterial.uniforms.uTexel.value.set(1 / plan.sceneWidth, 1 / plan.sceneHeight);
      if (plan.needsFinalPass) {
        this._renderMaterial(renderer, this._lookMaterial, this._lookRT);
        sourceTexture = this._lookRT.texture;
      } else {
        this._renderMaterial(renderer, this._lookMaterial, null);
        return;
      }
    }

    if (plan.needsFinalPass) {
      const artisticPixel = !!this._params.visualsPixelatedEnabled;
      const isUpscale = plan.sceneWidth < plan.outputWidth || plan.sceneHeight < plan.outputHeight;
      let mode = 0;
      if (artisticPixel || (isUpscale && this._perf.resolutionDenoiseMode === 'pixelated')) mode = 2;
      else if (isUpscale) mode = 1;
      const u = this._cameraMaterial.uniforms;
      u.tDiffuse.value = sourceTexture;
      u.uSourceSize.value.set(plan.sceneWidth, plan.sceneHeight);
      u.uOutputSize.value.set(plan.outputWidth, plan.outputHeight);
      u.uReconstructionMode.value = mode;
      this._renderMaterial(renderer, this._cameraMaterial, null);
    }
  }

  diagnostics() {
    if (!this._plan) return null;
    return {
      output: { w: this._plan.outputWidth, h: this._plan.outputHeight },
      scene: { w: this._plan.sceneWidth, h: this._plan.sceneHeight },
      reconstruction: this._params?.visualsPixelatedEnabled
        ? 'pixelated-artistic'
        : (this._plan.needsReconstruction ? (this._perf?.resolutionDenoiseMode || 'clean') : 'native'),
      pixelated: !!this._params?.visualsPixelatedEnabled,
      dithering: this._params?.visualsDitheringEnabled ? {
        strength: this._params.visualsDitheringStrength ?? 0.65,
        levels: this._params.visualsDitheringLevels ?? 8,
        scale: this._params.visualsDitheringScale ?? 2,
      } : false,
      crt: this._params?.visualsCrtEnabled ? {
        strength: this._params.visualsCrtStrength ?? 0.5,
        lensBend: this._params.visualsCrtLensBend ?? 0.35,
        lineWidth: this._params.visualsCrtLineWidth ?? 2,
      } : false,
      chromaticAberration: this._params?.visualsChromaticAberrationEnabled
        ? (this._params.visualsChromaticAberrationStrength ?? 1.5)
        : false,
    };
  }

  _renderMaterial(renderer, material, target) {
    this._quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this._quadScene, this._quadCam);
    if (target) renderer.setRenderTarget(null);
  }

  _ensureTarget(target, width, height, depthBuffer) {
    if (target && target.width === width && target.height === height) return target;
    target?.dispose();
    const next = new THREE.WebGLRenderTarget(width, height, {
      depthBuffer,
      stencilBuffer: false,
    });
    next.texture.minFilter = THREE.LinearFilter;
    next.texture.magFilter = THREE.LinearFilter;
    next.texture.generateMipmaps = false;
    return next;
  }

  dispose() {
    this._sceneRT?.dispose();
    this._lookRT?.dispose();
    this._sceneRT = null;
    this._lookRT = null;
    this._lookMaterial.dispose();
    this._cameraMaterial.dispose();
    this._quad.geometry.dispose();
  }
}
