import * as THREE from 'three';
import { CloudSlabLayer } from '../CloudSlabLayer.js';
import { PlanetCloudLayer } from '../PlanetCloudLayer.js';
import { resolveCloudQuality, CLOUD_DEFAULT_PARAMS, cloudNoiseOffset, resolveCloudNoiseType } from '../CloudSettings.js';
import { REALISTIC_CLOUD_VERTEX, REALISTIC_CLOUD_FRAGMENT, REALISTIC_MAX_STEPS } from './realisticCloudGLSL.js';
import {
  getRealisticNoiseVolumes,
  realisticNoisePreparationPass,
  retainRealisticNoiseVolumes,
  seedOffset,
  WEATHER_SIZE,
  CubeWeatherField,
  FlatWeatherField,
} from './RealisticCloudResources.js';

// ============================================================================
// Realistic cloud layers: the Procedural Planets cloud renderer on the
// existing layer plumbing. They subclass the legacy layers, so the bounding
// mesh, scene-depth occlusion, low-res bilateral upscale, background shader
// warmup and adaptive quality are shared; only the material, the per-frame
// bakes (noise volumes + weather keyframes) and the uniform mapping differ.
// ============================================================================

const SUN_E = 6.0;      // sun irradiance at intensity 1 (Procedural Planets HDR units)
const SKY_GAIN = 1.2;   // engine ambient colours -> sky irradiance
const REFERENCE_PLANET_RADIUS = 16000;

const _v2 = new THREE.Vector2();

function param(params, key) {
  return params[key] ?? CLOUD_DEFAULT_PARAMS[key];
}

function applyFormationFrequencies(u, params, billow, cellSpan) {
  // System Scale is a frequency, like legacy Cloud Scale: increasing it must
  // shrink individual clouds as well as the weather systems. Keep the default
  // appearance, and let Billow Size control their size within each system.
  const systemFrequency = Math.max(0.1, param(params, 'cloudSystemScale'))
    / CLOUD_DEFAULT_PARAMS.cloudSystemScale;
  const billowSize = Math.max(0.1, param(params, 'cloudBillowSize'));
  u.uCloudShapeFreq.value = systemFrequency / (billow * 1.6 * billowSize);
  u.uCloudDetailFreq.value = u.uCloudShapeFreq.value * 4.1;
  u.uCloudCellFreq.value = 0.33 * systemFrequency / (cellSpan * billowSize);
}

export function createRealisticCloudMaterial({ planet = false } = {}) {
  const uniforms = {
    uLoopGuard:        { value: 0 },
    uCloudNoise:       { value: null },
    uCloudErosion:     { value: null },
    uWeatherMap:       { value: null },
    uWeatherMapNext:   { value: null },
    uWeatherBlend:     { value: 0 },
    uCloudShapeFreq:   { value: 1e-3 },
    uCloudDetailFreq:  { value: 4e-3 },
    uCloudCellFreq:    { value: 3e-4 },
    uCloudWind:        { value: new THREE.Vector3() },
    uCloudVariationOffset: { value: new THREE.Vector3() },
    uCloudNoiseType: { value: 0 },
    uCloudCoverage:    { value: 0.5 },
    uCloudSoftness:    { value: 0.18 },
    uCloudDensity:     { value: 0.8 },
    uCloudDetail:      { value: 0.7 },
    uCloudTowering:    { value: 0.55 },
    uCloudShear:       { value: 0 },
    uCloudBottom:      { value: 240 },
    uCloudTop:         { value: 860 },
    uCloudSilver:      { value: 1 },
    uCloudColor:       { value: new THREE.Vector3(1, 1, 1) },
    uCloudSkyTint:     { value: new THREE.Vector3(0.78, 0.84, 0.95) },
    uCloudSteps:       { value: 64 },
    uExposure:         { value: 1 },
    uSunDir:           { value: new THREE.Vector3(0.4, 0.7, 0.5).normalize() },
    uSunLight:         { value: new THREE.Vector3(SUN_E, SUN_E * 0.94, SUN_E * 0.82) },
    uSkyTop:           { value: new THREE.Vector3(0.22, 0.28, 0.37) },
    uSkyBottom:        { value: new THREE.Vector3(0.16, 0.19, 0.26) },
    tSceneDepth:       { value: null },
    uDepthResolution:  { value: new THREE.Vector2(1, 1) },
    uProjectionMatrixInverse: { value: new THREE.Matrix4() },
    uViewMatrixInverse: { value: new THREE.Matrix4() },
    uDepthBias:        { value: 2.0 },
    uUseDepth:         { value: 0 },
  };
  if (planet) {
    uniforms.uCloudRotCS = { value: new THREE.Vector2(1, 0) };
    uniforms.uGroundRadius = { value: REFERENCE_PLANET_RADIUS };
  } else {
    uniforms.uFieldShift = { value: new THREE.Vector2() };
    uniforms.uWeatherCenter = { value: new THREE.Vector2() };
    uniforms.uWeatherInvSpan = { value: 1e-3 };
    uniforms.uWeatherSize = { value: WEATHER_SIZE };
    uniforms.uShearDir = { value: new THREE.Vector2(1, 0) };
    uniforms.uCloudCenter = { value: new THREE.Vector2() };
    uniforms.uCloudRadius = { value: 1500 };
    uniforms.uCloudFar = { value: 9000 };
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    defines: planet ? { CLOUD_PLANET: 1 } : {},
    vertexShader: REALISTIC_CLOUD_VERTEX,
    fragmentShader: REALISTIC_CLOUD_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: false,          // occlusion comes from tSceneDepth per pixel
    side: THREE.BackSide,      // the bounding mesh's far faces cover the volume
  });
  material.name = planet ? 'clouds.realistic.planet' : 'clouds.realistic.flat';
  return material;
}

/** Resolved engine lighting -> the realistic material's HDR sun / sky inputs. */
export function applyRealisticLighting(u, state) {
  if (!u || !state) return;
  const d = state.sunDirection;
  if (d) u.uSunDir.value.set(d[0], d[1], d[2]).normalize();
  const sun = state.directLightColor;
  if (sun) u.uSunLight.value.set(sun[0] * SUN_E, sun[1] * SUN_E, sun[2] * SUN_E);
  const top = state.ambientTopColor;
  const bottom = state.ambientBottomColor;
  if (top) u.uSkyTop.value.set(top[0] * SKY_GAIN, top[1] * SKY_GAIN, top[2] * SKY_GAIN);
  if (bottom) u.uSkyBottom.value.set(bottom[0] * SKY_GAIN, bottom[1] * SKY_GAIN, bottom[2] * SKY_GAIN);
}

/** Uniforms shared by both geometries (shape, look, quality). */
function applySharedParams(u, params, config, q) {
  u.uCloudVariationOffset.value.fromArray(cloudNoiseOffset(params.cloudNoiseSeed));
  u.uCloudNoiseType.value = resolveCloudNoiseType(params);
  u.uCloudCoverage.value = param(params, 'cloudCoverage');
  u.uCloudSoftness.value = Math.max(0.01, param(params, 'cloudSoftness'));
  u.uCloudDensity.value = param(params, 'cloudDensity');
  u.uCloudDetail.value = param(params, 'cloudErosion');
  u.uCloudTowering.value = param(params, 'cloudTowering');
  u.uCloudSilver.value = param(params, 'cloudForwardScatter');
  u.uCloudColor.value.fromArray(param(params, 'cloudColor'));
  u.uCloudSkyTint.value.fromArray(param(params, 'cloudSkyTint'));
  u.uExposure.value = param(params, 'cloudExposure');
  let steps = config.cloudRealisticSteps ?? 64;
  if (config.cloudFallback === 'lite') steps = Math.min(steps, 32);
  return Math.max(12, Math.min(REALISTIC_MAX_STEPS, steps)) * (q.disabled ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Flat (studio board): slab between two world-Y planes over a disc
// ---------------------------------------------------------------------------
export class RealisticCloudSlabLayer extends CloudSlabLayer {
  constructor(scene, opts = {}) {
    super(scene, opts);
    this.renderMode = 'realistic';
    this._releaseNoiseVolumes = retainRealisticNoiseVolumes(opts.renderer);
    this._lowResPass.smooth = true;
    this._weather = new FlatWeatherField();
    this._fieldShift = new THREE.Vector2();
    this._windDir = new THREE.Vector2(1, 0);
    this._windSpeed = 0;
    this._noiseWind = new THREE.Vector3();
    this._noiseWindRate = new THREE.Vector3();
    this._weatherTime = 0;
    this._weatherRate = 0;
    this._weatherScale = 1e-3;
    this._seed = new THREE.Vector3();
    this._windowHalf = 1;
    this._baseSteps = 64;
  }

  preparationPasses(renderTarget = null) {
    const noise = realisticNoisePreparationPass(this._renderer);
    return [
      ...super.preparationPasses(renderTarget), noise,
      { ...noise, material: this._weather.material, renderTarget: this._weather.targets[0] },
    ];
  }

  // The camera pipeline keys its target on this. Asking for scene depth from
  // the moment the layer is enabled (not only once its program is linked)
  // keeps the target stable while a mode transition compiles the program.
  get wantsSceneDepth() {
    return this._enabled && this._inScene && this._inRange;
  }

  get _usesOccupancy() { return false; }
  _createMaterial() { return createRealisticCloudMaterial({ planet: false }); }
  _applyOccupancyUniforms() {}
  _rebuildOccupancy() {}
  getTerrainShadowState() { return this._shadowPass?.state ?? null; }

  applyParams(params, maxHeight, boardSize, perf, layout = {}) {
    this._boardSize = boardSize || this._boardSize;
    const extent = layout.extent || this._boardSize;
    const cx = layout.center?.x ?? 0;
    const cz = layout.center?.z ?? 0;
    this._coverSize = extent;
    this._center = { x: cx, z: cz };

    const config = perf ? { ...params, ...perf } : params;
    const q = resolveCloudQuality(config);
    this._enabled = !!params.cloudsEnabled && !q.disabled;
    this._maxDistance = (config.cloudMaxDistance ?? 6) * extent;

    const u = this.material.uniforms;
    const bottom = param(params, 'cloudAltitude');
    const thickness = Math.max(20, param(params, 'cloudThickness'));
    const top = bottom + thickness;
    u.uCloudBottom.value = bottom;
    u.uCloudTop.value = top;

    const radius = Math.max(1, layout.radius ?? extent * 0.62);
    u.uCloudRadius.value = radius;
    u.uCloudFar.value = extent * 4.0;
    u.uCloudCenter.value.set(cx, cz);
    const horiz = radius * 2.1;
    this.mesh.scale.set(horiz, Math.max(1, thickness * 1.04), horiz);
    this.mesh.position.set(cx, (bottom + top) * 0.5, cz);

    // Billows grow with the square root of the layer thickness (a thicker
    // layer stacks more of them into taller towers); the reference length is
    // tied to the board so a slider value means the same look at any size.
    const board = Math.max(this._boardSize, 1);
    const billow = Math.sqrt(thickness * board * 0.3);
    // Tower cells twice as wide as on a planet: the slab is mostly seen from
    // the side, where narrow cells of different heights read as streaks.
    applyFormationFrequencies(u, params, billow, thickness * 3.2);
    // shear: how far the layer top is carried downstream (world units)
    u.uCloudShear.value = param(params, 'cloudShear') * thickness * 2.2;
    this._baseSteps = applySharedParams(u, params, config, q);

    // Bound weather detail to the visible board instead of sampling one
    // nearly constant weather value across an entire Tile or Mini.
    const systemScale = param(params, 'cloudSystemScale');
    const weatherFrequency = Math.max(1, systemScale / CLOUD_DEFAULT_PARAMS.cloudSystemScale);
    // A bounded board must sample several weather cells. The former /34
    // baseline could put its entire disc in one clear cell for a variation seed.
    const minimumWeatherFrequency = 2.0 * systemScale / CLOUD_DEFAULT_PARAMS.cloudSystemScale;
    this._weatherScale = Math.max(systemScale * weatherFrequency * weatherFrequency / 34.0,
      minimumWeatherFrequency) / board;
    this._seed.copy(seedOffset(params.seed ?? 0)).add(u.uCloudVariationOffset.value);
    this._windowHalf = radius * 1.3 + u.uCloudShear.value;

    const wa = param(params, 'cloudWindDir') * Math.PI / 180;
    const windSpeed = param(params, 'cloudWindSpeed');
    this._windDir.set(Math.cos(wa), Math.sin(wa));
    u.uShearDir.value.copy(this._windDir);
    this._windSpeed = windSpeed * board * 0.02;
    this._noiseWindRate.set(1, 0.3, -0.6).multiplyScalar(windSpeed * 0.004);
    this._weatherRate = param(params, 'cloudEvolveSpeed') * 0.0021;

    this._baseRenderScale = config.cloudRenderScale ?? 1.0;
    this.setAdaptiveQuality(this._adaptiveScaleMultiplier, this._adaptiveStepScale);

    if (this._enabled && !this._ready && !this._warming && this._compile) {
      this._compileCurrentMaterial();
    }
  }

  setLighting(lightingState) {
    applyRealisticLighting(this.material?.uniforms, lightingState);
  }

  update(dt, cameraPos, sunDir) {
    if (!this._enabled || !this._inScene || !this._ready || !this._renderer) {
      if (this.mesh.visible) this.mesh.visible = false;
      return;
    }
    const c = this._center || { x: 0, z: 0 };
    const dist = Math.hypot(cameraPos.x - c.x, cameraPos.y, cameraPos.z - c.z);
    this._inRange = dist <= this._maxDistance;
    this.mesh.visible = this._inRange;
    if (!this._inRange) return;

    const u = this.material.uniforms;
    const vols = getRealisticNoiseVolumes(this._renderer);
    u.uCloudNoise.value = vols.noise;
    u.uCloudErosion.value = vols.erosion;

    this._fieldShift.addScaledVector(this._windDir, dt * this._windSpeed);
    u.uFieldShift.value.copy(this._fieldShift);
    this._noiseWind.addScaledVector(this._noiseWindRate, dt);
    u.uCloudWind.value.copy(this._noiseWind);
    this._weatherTime += dt * this._weatherRate;

    // the window covers the disc in field space (it drifts with the wind)
    _v2.set(c.x - this._fieldShift.x, c.z - this._fieldShift.y);
    this._weather.configure(this._weatherScale, this._seed);
    this._weather.update(this._renderer, vols.blitter, this._weatherTime, _v2, this._windowHalf);
    u.uWeatherMap.value = this._weather.current;
    u.uWeatherMapNext.value = this._weather.next;
    u.uWeatherBlend.value = this._weather.blend;
    u.uWeatherCenter.value.copy(this._weather.center);
    u.uWeatherInvSpan.value = 1 / (2 * this._weather.half);

    u.uCloudSteps.value = this._baseSteps * this._adaptiveStepScale;
    if (sunDir) u.uSunDir.value.copy(sunDir).normalize();
  }

  dispose() {
    this._releaseNoiseVolumes?.();
    this._weather?.dispose();
    this._weather = null;
    super.dispose();
  }
}

// ---------------------------------------------------------------------------
// Infinite world: the bounded slab follows the camera on chunk boundaries. The
// weather lives in field space, so re-centring never changes the clouds.
// ---------------------------------------------------------------------------
export class RealisticInfiniteCloudLayer extends RealisticCloudSlabLayer {
  constructor(scene, opts = {}) {
    super(scene, opts);
    this.mesh.name = 'infinite-cloud-layer';
    this._chunkSize = Math.max(1, opts.chunkSize || 256);
    this._viewRadius = Math.max(1, opts.viewRadius || 8);
    this._logicalCenter = new THREE.Vector2();
  }

  applyParams(params, maxHeight, boardSize, perf, layout = {}) {
    this._chunkSize = Math.max(1, layout.chunkSize || this._chunkSize);
    this._viewRadius = Math.max(1, layout.viewRadius || this._viewRadius);
    const cloudRadius = this._chunkSize * (this._viewRadius + 1) * 1.15;
    super.applyParams(params, maxHeight, boardSize, perf, {
      extent: cloudRadius / 0.62,
      center: { x: this._logicalCenter.x, z: this._logicalCenter.y },
    });
    this._maxDistance = Infinity;
    this.material.uniforms.uCloudFar.value = cloudRadius * 2.5;
  }

  _recenter(cameraPos) {
    const x = Math.floor(cameraPos.x / this._chunkSize) * this._chunkSize;
    const z = Math.floor(cameraPos.z / this._chunkSize) * this._chunkSize;
    if (x === this._logicalCenter.x && z === this._logicalCenter.y) return;
    this._logicalCenter.set(x, z);
    this._center = { x, z };
    this.material.uniforms.uCloudCenter.value.set(x, z);
    this.mesh.position.x = x;
    this.mesh.position.z = z;
  }

  update(dt, cameraPos, sunDir) {
    this._recenter(cameraPos);
    super.update(dt, cameraPos, sunDir);
  }
}

// ---------------------------------------------------------------------------
// Planet: spherical shell, weather cubemap that drifts around the pole axis
// ---------------------------------------------------------------------------
export class RealisticPlanetCloudLayer extends PlanetCloudLayer {
  constructor(scene, opts = {}) {
    super(scene, opts);
    this.renderMode = 'realistic';
    this._releaseNoiseVolumes = retainRealisticNoiseVolumes(opts.renderer);
    this._lowResPass.smooth = true;
    this._weather = new CubeWeatherField();
    this._noiseWind = new THREE.Vector3();
    this._noiseWindRate = new THREE.Vector3();
    this._weatherTime = 0;
    this._weatherRate = 0;
    this._systemScale = 3.2;
    this._seed = new THREE.Vector3();
    this._baseSteps = 64;
  }

  get _usesOccupancy() { return false; }
  _createMaterial() { return createRealisticCloudMaterial({ planet: true }); }
  _applyOccupancyUniforms() {}
  _rebuildOccupancy() {}

  applyParams(params, planetRadius, perf) {
    this.planetRadius = planetRadius || this.planetRadius;
    this._lastParams = params;
    const config = perf ? { ...params, ...perf } : params;
    const q = resolveCloudQuality(config);
    this._enabled = !!params.cloudsEnabled && !q.disabled;
    const R = this.planetRadius;
    this._maxDistance = (config.cloudMaxDistance ?? 6) * R;

    const u = this.material.uniforms;
    const radiusScale = R / REFERENCE_PLANET_RADIUS;
    const inner = R + param(params, 'cloudAltitude') * radiusScale;
    const outer = inner + Math.max(20, param(params, 'cloudThickness') * radiusScale);
    const thick = outer - inner;
    u.uCloudBottom.value = inner;
    u.uCloudTop.value = outer;
    u.uGroundRadius.value = R;
    this.mesh.scale.setScalar(outer * 1.001);

    // noise frequencies in world units, tied to the shell thickness exactly
    // as in Procedural Planets (billows grow with sqrt of the thickness)
    const billow = Math.sqrt(thick * R * 0.009);
    applyFormationFrequencies(u, params, billow, thick * 1.6);
    // shear in direction units: how far the shell top is carried downstream
    u.uCloudShear.value = param(params, 'cloudShear') * (thick / R) * 2.2;
    this._baseSteps = applySharedParams(u, params, config, q);

    this._systemScale = param(params, 'cloudSystemScale');
    this._seed.copy(seedOffset(params.seed ?? 0)).add(u.uCloudVariationOffset.value);
    this._rotSpeed = param(params, 'cloudRotationSpeed') * 0.01;
    const windSpeed = param(params, 'cloudWindSpeed');
    this._noiseWindRate.set(1, 0.3, -0.6).multiplyScalar(windSpeed * 0.004);
    this._weatherRate = param(params, 'cloudEvolveSpeed') * 0.0021;

    this._baseRenderScale = config.cloudRenderScale ?? 1.0;
    this.setAdaptiveQuality(this._adaptiveScaleMultiplier, this._adaptiveStepScale);
  }

  setLighting(lightingState) {
    applyRealisticLighting(this.material?.uniforms, lightingState);
  }

  update(dt, cameraPos, sunDir) {
    if (!this._enabled || !this._renderer) {
      if (this.mesh.visible) this.mesh.visible = false;
      return;
    }
    this._inRange = cameraPos.length() <= this._maxDistance;
    this.mesh.visible = this._inRange;
    if (!this._inRange) return;

    const u = this.material.uniforms;
    const vols = getRealisticNoiseVolumes(this._renderer);
    u.uCloudNoise.value = vols.noise;
    u.uCloudErosion.value = vols.erosion;

    this._rotation = (this._rotation + dt * (this._rotSpeed || 0)) % (Math.PI * 2);
    u.uCloudRotCS.value.set(Math.cos(this._rotation), Math.sin(this._rotation));
    this._noiseWind.addScaledVector(this._noiseWindRate, dt);
    u.uCloudWind.value.copy(this._noiseWind);
    this._weatherTime += dt * this._weatherRate;

    this._weather.configure(this._systemScale, this._seed);
    this._weather.update(this._renderer, vols.blitter, this._weatherTime);
    u.uWeatherMap.value = this._weather.current;
    u.uWeatherMapNext.value = this._weather.next;
    u.uWeatherBlend.value = this._weather.blend;

    u.uCloudSteps.value = this._baseSteps * this._adaptiveStepScale;
    if (sunDir) u.uSunDir.value.copy(sunDir).normalize();
  }

  dispose() {
    this._releaseNoiseVolumes?.();
    this._weather?.dispose();
    this._weather = null;
    super.dispose();
  }
}
