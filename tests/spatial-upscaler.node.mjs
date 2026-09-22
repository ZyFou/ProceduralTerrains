import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeSpatialUpscaler, resolveCameraReconstruction, SPATIAL_UPSCALE_GLSL } from '../src/engine/render/SpatialUpscaler.js';
import { resolveCameraRenderPlan } from '../src/engine/render/CameraRenderPlan.js';

const plan = (scale = 0.75, extras = {}) => resolveCameraRenderPlan({
  outputWidth: 1600, outputHeight: 1000, renderScale: scale, ...extras,
});
const sharp = { spatialUpscaler: 'sharp', spatialUpscaleSharpness: 0.35 };

test('old and malformed settings keep the experiment opt-in; sharpness zero survives', () => {
  assert.deepEqual(normalizeSpatialUpscaler(), { spatialUpscaler: 'off', spatialUpscaleSharpness: 0.35 });
  for (const value of [undefined, null, '', NaN, Infinity, 'no']) {
    assert.equal(normalizeSpatialUpscaler({ spatialUpscaleSharpness: value }).spatialUpscaleSharpness, 0.35);
  }
  assert.equal(normalizeSpatialUpscaler({ spatialUpscaleSharpness: 0 }).spatialUpscaleSharpness, 0);
  assert.equal(normalizeSpatialUpscaler({ spatialUpscaleSharpness: -2 }).spatialUpscaleSharpness, 0);
  assert.equal(normalizeSpatialUpscaler({ spatialUpscaleSharpness: 2 }).spatialUpscaleSharpness, 1);
  assert.equal(normalizeSpatialUpscaler({ spatialUpscaler: 'invalid' }).spatialUpscaler, 'off');
});

test('native and supersampled images never select a spatial or clean upscaler', () => {
  for (const scale of [1, 1.5, 2]) {
    const result = resolveCameraReconstruction(plan(scale), {}, sharp);
    assert.equal(result.mode, 0);
    assert.equal(result.upscale, false);
  }
});

test('invalid and mixed-axis dimensions fall back safely', () => {
  assert.equal(resolveCameraReconstruction({}, {}, sharp).mode, 0);
  assert.equal(resolveCameraReconstruction({ ...plan(), sceneWidth: NaN }, {}, sharp).mode, 0);
  assert.equal(resolveCameraReconstruction({ ...plan(), sceneWidth: 1700 }, {}, sharp).mode, 0);
});

for (const scale of [0.4, 0.5, 0.67, 0.75, 0.8, 0.95]) {
  test(`filter selection agrees with uniforms and defines at ${scale} scale`, () => {
    const p = plan(scale);
    assert.equal(resolveCameraReconstruction(p).mode, 1);
    assert.equal(resolveCameraReconstruction(p, {}, { spatialUpscaler: 'linear' }).mode, 0);
    const r = resolveCameraReconstruction(p, {}, sharp);
    assert.equal(r.mode, 3); assert.equal(r.label, 'spatial-sharp');
    assert.deepEqual(r.defines, { USE_PIXELATED: 0, USE_CLEAN_RECONSTRUCTION: 0, USE_SPATIAL_RECONSTRUCTION: 1 });
  });
}

test('artistic and performance pixelated settings override the experiment', () => {
  for (const spatialUpscaler of ['off', 'linear', 'sharp']) {
    const r = resolveCameraReconstruction(plan(), {}, { spatialUpscaler, resolutionDenoiseMode: 'pixelated' });
    assert.equal(r.mode, 2); assert.equal(r.defines.USE_PIXELATED, 1);
    const artistic = resolveCameraReconstruction(plan(), { visualsPixelatedEnabled: true }, { spatialUpscaler });
    assert.equal(artistic.mode, 2); assert.equal(artistic.label, 'pixelated-artistic');
  }
});

test('render scale changes scene pixels, not output resolution or geometry settings', () => {
  const p = plan();
  assert.equal(p.sceneWidth * p.sceneHeight / (p.outputWidth * p.outputHeight), 0.5625);
  assert.equal(p.outputWidth, 1600); assert.equal(p.outputHeight, 1000);
});

// Execute the real pass implementation with small Three-shaped test doubles.
// These tests cover pass orchestration/defines, not driver compilation or speed.
class Vector2 { constructor(x = 0, y = 0) { this.set(x, y); } set(x, y) { this.x = x; this.y = y; return this; } }
class Disposable { dispose() { this.disposed = true; } }
class ShaderMaterial extends Disposable {
  constructor(options) { super(); Object.assign(this, options); this.userData = {}; this.version = 0; }
  set needsUpdate(value) { if (value) this.version++; }
}
class BufferGeometry extends Disposable { setAttribute() {} }
class Scene { constructor() { this.children = []; } add(value) { this.children.push(value); } }
class WebGLRenderTarget extends Disposable {
  constructor(width, height, options) { super(); Object.assign(this, { width, height, texture: {}, ...options }); }
}
const THREE = {
  Vector2, ShaderMaterial, BufferGeometry, Scene, WebGLRenderTarget,
  BufferAttribute: class {}, OrthographicCamera: class {},
  Color: class { copy() {} }, DepthTexture: class {},
  Mesh: class { constructor(geometry, material) { Object.assign(this, { geometry, material }); } },
};
const file = readFileSync(new URL('../src/engine/render/VisualPostProcess.js', import.meta.url), 'utf8');
const body = file.replace(/^import .*;\n/gm, '').replace('export class VisualPostProcess', 'class VisualPostProcess');
const VisualPostProcess = new Function('THREE', 'resolveCameraRenderPlan', 'resolveCameraReconstruction', 'SPATIAL_UPSCALE_GLSL', `${body}\nreturn VisualPostProcess;`)(THREE, resolveCameraRenderPlan, resolveCameraReconstruction, SPATIAL_UPSCALE_GLSL);
function fixture() {
  const pass = new VisualPostProcess();
  const renderer = {
    calls: [], target: null,
    getDrawingBufferSize(v) { return v.set(1600, 1000); },
    setRenderTarget(target) { this.target = target; },
    render(scene) { this.calls.push({ material: scene.children[0].material, target: this.target }); },
  };
  return { pass, renderer };
}
function prepare(pass, renderer, perf = sharp, params = {}, renderScale = 0.75, extras = {}) {
  return pass.prepare(renderer, { perf, params, renderScale, worldMode: 'studio', ...extras });
}

test('actual camera pass selects sharp shader and matching uniform; no new render target', () => {
  const { pass, renderer } = fixture(); prepare(pass, renderer); pass.finish(renderer);
  assert.equal(pass._cameraMaterial.defines.USE_SPATIAL_RECONSTRUCTION, 1);
  assert.equal(pass._cameraMaterial.uniforms.uReconstructionMode.value, 3);
  assert.equal(pass._cameraMaterial.uniforms.uSpatialSharpness.value, 0.35);
  assert.equal(renderer.calls.length, 2); // Existing look + final camera, nothing added.
  assert.equal(renderer.calls[1].target, null);
  assert.equal(pass.diagnostics().spatialUpscaler.active, true);
});

test('clean and pixelated reconstruction now compile their actual selected variants', () => {
  const { pass, renderer } = fixture();
  prepare(pass, renderer, {}); pass.finish(renderer);
  assert.equal(pass._cameraMaterial.defines.USE_CLEAN_RECONSTRUCTION, 1);
  assert.equal(pass._cameraMaterial.uniforms.uReconstructionMode.value, 1);
  prepare(pass, renderer, { ...sharp, resolutionDenoiseMode: 'pixelated' }); pass.finish(renderer);
  assert.equal(pass._cameraMaterial.defines.USE_PIXELATED, 1);
  assert.equal(pass._cameraMaterial.defines.USE_SPATIAL_RECONSTRUCTION, 0);
  assert.equal(pass._cameraMaterial.uniforms.uReconstructionMode.value, 2);
});

test('changing only sharpness neither recompiles the pass nor reallocates its targets', () => {
  const { pass, renderer } = fixture(); prepare(pass, renderer); pass.finish(renderer);
  const version = pass._cameraMaterial.version, scene = pass._sceneRT, look = pass._lookRT;
  for (const spatialUpscaleSharpness of [0, 0.6, 1]) {
    prepare(pass, renderer, { ...sharp, spatialUpscaleSharpness }); pass.finish(renderer);
    assert.equal(pass._cameraMaterial.version, version);
    assert.equal(pass._sceneRT, scene); assert.equal(pass._lookRT, look);
    assert.equal(pass._cameraMaterial.uniforms.uSpatialSharpness.value, spatialUpscaleSharpness);
  }
});

test('return to native disables the shader variant, with and without a depth requirement', () => {
  const { pass, renderer } = fixture(); prepare(pass, renderer);
  prepare(pass, renderer, sharp, { visualsPostEnabled: false }, 1);
  assert.equal(pass.plan.usesSceneTarget, false);
  assert.equal(pass._cameraMaterial.defines.USE_SPATIAL_RECONSTRUCTION, 0);
  prepare(pass, renderer, sharp, {}, 1, { requireSceneDepth: true }); pass.finish(renderer);
  assert.equal(pass._cameraMaterial.uniforms.uReconstructionMode.value, 0);
  assert.equal(pass.diagnostics().reconstruction, 'native');
});

test('shared depth and cached presentation keep the selected reconstruction', () => {
  const { pass, renderer } = fixture();
  prepare(pass, renderer, sharp, {}, 0.75, { requireSceneDepth: true, requireSharedOpaque: true });
  assert.ok(pass.inputDepthTexture); assert.ok(pass.opaqueTarget);
  const texture = { cached: true }; pass.setInputTexture(texture);
  assert.equal(pass.presentCached(renderer), true);
  assert.equal(pass._lookMaterial.uniforms.tDiffuse.value, texture);
  assert.equal(pass._cameraMaterial.uniforms.uReconstructionMode.value, 3);
  const scene = pass._sceneRT; pass.dispose(); assert.equal(scene.disposed, true);
});

test('spatial mode does not accidentally switch dithering to the pixel-art grid', () => {
  assert.match(file, /uReconstructionMode > 1\.5 && uReconstructionMode < 2\.5/);
  assert.ok(!file.includes('plan.reconstructionMode'));
});

const settingsSource = readFileSync(new URL('../src/engine/render/PerformanceSettings.js', import.meta.url), 'utf8');
const settingsBody = settingsSource.replace(/^import[\s\S]*?;\n/gm, '').replace(/export /g, '');
const settingsAPI = new Function('sanitizeGpuPreference', 'sanitizeRendererBackend', 'normalizeSpatialUpscaler', `${settingsBody}\nreturn {createPerfSettings, sanitizePerfSettings, loadPerfSettings, savePerfSettings};`)(
  (value) => value || 'default', (value) => value || 'auto', normalizeSpatialUpscaler,
);

test('new and old performance settings contain keys accepted by Engine.setPerfSetting', () => {
  for (const preset of ['performance', 'balanced', 'high', 'ultra']) {
    const settings = settingsAPI.createPerfSettings(preset);
    assert.ok('spatialUpscaler' in settings);
    assert.ok('spatialUpscaleSharpness' in settings);
    assert.equal(settings.spatialUpscaler, 'off');
  }
  assert.equal(settingsAPI.sanitizePerfSettings({ spatialUpscaler: 'sharp', spatialUpscaleSharpness: 0 }).spatialUpscaleSharpness, 0);
});

test('saved experiment survives reload; corrupted storage and reset default to off', () => {
  const previous = globalThis.localStorage;
  let stored = null;
  globalThis.localStorage = { getItem: () => stored, setItem: (_key, value) => { stored = value; } };
  try {
    settingsAPI.savePerfSettings({ ...settingsAPI.createPerfSettings(), ...sharp });
    assert.equal(settingsAPI.loadPerfSettings().spatialUpscaler, 'sharp');
    stored = 'not JSON'; assert.equal(settingsAPI.loadPerfSettings().spatialUpscaler, 'off');
    assert.equal(settingsAPI.createPerfSettings().spatialUpscaler, 'off');
  } finally {
    if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous;
  }
});
