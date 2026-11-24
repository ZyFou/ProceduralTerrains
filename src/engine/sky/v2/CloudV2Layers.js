import * as THREE from 'three';
import { CloudSlabLayer } from '../CloudSlabLayer.js';
import {
  resolveCloudQuality,
  CLOUD_DEFAULT_PARAMS,
  cloudNoiseOffset,
  resolveCloudNoiseType,
} from '../CloudSettings.js';
import { applyRealisticLighting } from '../realistic/RealisticCloudLayers.js';
import { seedOffset } from '../realistic/RealisticCloudResources.js';
import { CLOUD_V2_VERTEX, CLOUD_V2_FRAGMENT, CLOUD_V2_MAX_STEPS } from './cloudV2GLSL.js';
import {
  getNoiseVolumeV2,
  noiseVolumeV2PreparationPasses,
  retainNoiseVolumeV2,
} from '../../render/NoiseVolumeV2.js';

// ============================================================================
// Realistic V2 cloud layers: billowy weather-map cumulus on the existing layer
// plumbing (bounding mesh, scene-depth occlusion, low-res render + depth-aware
// upscale, background shader warmup, adaptive quality, terrain shadows). Only
// the material, the baked inputs and the uniform mapping are new.
//
// The reference look is authored in metres over a 12 km landscape with a
// 1350 m thick layer. `unit` rescales it to the engine: formations follow the
// geometric mean of the board and layer scale, so the same sliders read the
// same on a Mini, a Tile assembly or the Infinite World.
// ============================================================================

const REFERENCE_THICKNESS = 1350;
// Board size, in reference metres, that maps one weather cell (1/6 of the
// weather tile) onto a quarter of the board.
const REFERENCE_BOARD = 17333;
// Tile size the default Thickness is one natural cloud depth on.
const REFERENCE_TILE = 2048;
// Reference coverage (the authored sky) that the default Coverage maps to.
const REFERENCE_COVERAGE = 0.68;
const REFERENCE_NOISE_TILE = 4300;
const REFERENCE_WEATHER_TILE = 26000;
const REFERENCE_WARP = 1500;
// optical depth of a full-thickness column at density 1
const REFERENCE_OPTICAL_DEPTH = 0.036 * REFERENCE_THICKNESS;

// Noise type presets: [erosion gain, lowest top, base contrast]
const NOISE_TYPE_LOOK = [
  [1.0, 0.42, 0.78],   // soft: the reference cumulus
  [0.8, 0.58, 0.70],   // billowy: fuller bodies, taller domes
  [1.45, 0.30, 0.86],  // wispy: thin, strongly eroded
];

function param(params, key) {
  return params[key] ?? CLOUD_DEFAULT_PARAMS[key];
}

export function createCloudV2Material() {
  const uniforms = {
    uLoopGuard:        { value: 0 },
    uNoiseV2:          { value: null },
    uWeatherV2:        { value: null },
    uCloudOffset:      { value: new THREE.Vector3() },
    uCloudVariationOffset: { value: new THREE.Vector3() },
    uCloudWeatherFreq: { value: 1e-4 },
    uCloudNoiseFreq:   { value: 1e-3 },
    uCloudWarp:        { value: 0.05 },
    uCloudCoverage:    { value: 0.5 },
    uCloudEdge:        { value: 0.22 },
    uCloudDetail:      { value: 1.0 },
    uCloudTopMin:      { value: 0.42 },
    uCloudContrast:    { value: 0.78 },
    uCloudShear:       { value: 0 },
    uShearDir:         { value: new THREE.Vector2(1, 0) },
    uCloudBottom:      { value: 240 },
    uCloudTop:         { value: 860 },
    uCloudRefDepth:    { value: 620 },
    uCloudMinStep:     { value: 25 },
    uCloudCenter:      { value: new THREE.Vector2() },
    uCloudRadius:      { value: 1500 },
    uCloudSquare:      { value: 0 },
    uCloudFar:         { value: 9000 },
    uCloudSigma:       { value: 0.05 },
    uCloudSteps:       { value: 64 },
    uCloudJitter:      { value: 0 },
    uCloudSilver:      { value: 1 },
    uCloudColor:       { value: new THREE.Vector3(1, 1, 1) },
    uCloudSkyTint:     { value: new THREE.Vector3(0.78, 0.84, 0.95) },
    uExposure:         { value: 1 },
    uSunDir:           { value: new THREE.Vector3(0.4, 0.7, 0.5).normalize() },
    uSunLight:         { value: new THREE.Vector3(6, 5.64, 4.92) },
    uSkyTop:           { value: new THREE.Vector3(0.22, 0.28, 0.37) },
    uSkyBottom:        { value: new THREE.Vector3(0.16, 0.19, 0.26) },
    tSceneDepth:       { value: null },
    uDepthResolution:  { value: new THREE.Vector2(1, 1) },
    uProjectionMatrixInverse: { value: new THREE.Matrix4() },
    uViewMatrixInverse: { value: new THREE.Matrix4() },
    uDepthBias:        { value: 2.0 },
    uUseDepth:         { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: CLOUD_V2_VERTEX,
    fragmentShader: CLOUD_V2_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: false,          // occlusion comes from tSceneDepth per pixel
    side: THREE.BackSide,      // the bounding box's far faces cover the volume
  });
  material.name = 'clouds.realisticV2.flat';
  return material;
}

// ---------------------------------------------------------------------------
// Flat (studio board): slab between two world-Y planes over a disc
// ---------------------------------------------------------------------------
export class CloudV2SlabLayer extends CloudSlabLayer {
  constructor(scene, opts = {}) {
    super(scene, opts);
    this.renderMode = 'realisticV2';
    this._releaseNoise = retainNoiseVolumeV2(opts.renderer);
    this._lowResPass.smooth = true;
    this._drift = new THREE.Vector3();
    this._driftRate = new THREE.Vector3();
    this._baseSteps = 64;
  }

  preparationPasses(renderTarget = null) {
    return [
      ...super.preparationPasses(renderTarget),
      ...noiseVolumeV2PreparationPasses(this._renderer),
    ];
  }

  // Ask for scene depth from the moment the layer is enabled (not only once
  // its program is linked): the camera pipeline keys its target on this, and
  // it must not flip while a mode transition compiles the program.
  get wantsSceneDepth() {
    return this._enabled && this._inScene && this._inRange;
  }

  get _usesOccupancy() { return false; }
  _createMaterial() { return createCloudV2Material(); }
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
    u.uCloudSquare.value = layout.shape === 'square' ? 1 : 0;
    u.uCloudFar.value = extent * 4.0;
    u.uCloudCenter.value.set(cx, cz);
    const horiz = radius * 2.1;
    this.mesh.scale.set(horiz, Math.max(1, thickness * 1.04), horiz);
    this.mesh.position.set(cx, (bottom + top) * 0.5, cz);

    // World units per reference metre. Formations follow the board: at System
    // Scale 1 a weather cell (one cumulus) spans about a quarter of a tile,
    // so a bounded board still reads as a cloudscape rather than one cloud.
    // Nothing here depends on Thickness: the slider only gives the same
    // clouds more (or less) room to grow, it never moves or rescales them.
    const board = Math.max(this._boardSize, 1);
    const unit = board / REFERENCE_BOARD;
    // natural depth of one cloud at this board size (the default Thickness
    // on a default tile)
    const refDepth = CLOUD_DEFAULT_PARAMS.cloudThickness * board / REFERENCE_TILE;
    u.uCloudRefDepth.value = refDepth;
    // System Scale is a frequency (higher = smaller formations); Billow Size
    // scales the shape noise inside each formation.
    const systemFrequency = Math.max(0.1, param(params, 'cloudSystemScale'))
      / CLOUD_DEFAULT_PARAMS.cloudSystemScale;
    const billowSize = Math.max(0.1, param(params, 'cloudBillowSize'));
    const weatherFreq = systemFrequency / (REFERENCE_WEATHER_TILE * unit);
    u.uCloudWeatherFreq.value = weatherFreq;
    u.uCloudNoiseFreq.value = systemFrequency / (REFERENCE_NOISE_TILE * unit * billowSize);
    u.uCloudWarp.value = REFERENCE_WARP * unit * billowSize / systemFrequency * weatherFreq;

    const look = NOISE_TYPE_LOOK[resolveCloudNoiseType(params)] ?? NOISE_TYPE_LOOK[0];
    // Coverage 0 = clear sky, the default = the reference cumulus field,
    // 1 = overcast (piecewise linear through the reference).
    const coverage = THREE.MathUtils.clamp(param(params, 'cloudCoverage'), 0, 1);
    const defaultCoverage = CLOUD_DEFAULT_PARAMS.cloudCoverage;
    u.uCloudCoverage.value = coverage <= defaultCoverage
      ? coverage / defaultCoverage * REFERENCE_COVERAGE
      : REFERENCE_COVERAGE + (coverage - defaultCoverage) / (1 - defaultCoverage) * (1 - REFERENCE_COVERAGE);
    u.uCloudEdge.value = THREE.MathUtils.clamp(
      0.22 * param(params, 'cloudSoftness') / CLOUD_DEFAULT_PARAMS.cloudSoftness, 0.04, 0.6,
    );
    u.uCloudDetail.value = Math.min(1.9,
      look[0] * param(params, 'cloudErosion') / CLOUD_DEFAULT_PARAMS.cloudErosion);
    // Towering lifts the lowest tops toward full height
    u.uCloudTopMin.value = THREE.MathUtils.clamp(
      look[1] + (param(params, 'cloudTowering') - CLOUD_DEFAULT_PARAMS.cloudTowering) * 0.8,
      0.15, 0.98,
    );
    u.uCloudContrast.value = look[2];
    // Extinction per world unit is fixed by the natural depth: a thicker
    // layer holds more cloud, it does not dilute the same amount over more
    // height. (A thinner one keeps its clouds opaque.)
    const opticalDepthSpan = Math.min(thickness, refDepth);
    u.uCloudSigma.value = REFERENCE_OPTICAL_DEPTH / opticalDepthSpan * param(params, 'cloudDensity');
    u.uCloudSilver.value = param(params, 'cloudForwardScatter');
    u.uCloudColor.value.fromArray(param(params, 'cloudColor'));
    u.uCloudSkyTint.value.fromArray(param(params, 'cloudSkyTint'));
    u.uExposure.value = param(params, 'cloudExposure');

    // Seed: weather-map offset (xy) + shape-noise offset. Both textures tile,
    // so any offset is a different, equally valid sky.
    const seed = seedOffset(params.seed ?? 0);
    const variation = cloudNoiseOffset(params.cloudNoiseSeed);
    u.uCloudVariationOffset.value.set(
      (seed.x + variation[0]) * 0.0137,
      (seed.y + variation[1]) * 0.0171,
      (seed.z + variation[2]) * 0.0113,
    );

    const wa = param(params, 'cloudWindDir') * Math.PI / 180;
    const windSpeed = param(params, 'cloudWindSpeed');
    u.uShearDir.value.set(Math.cos(wa), Math.sin(wa));
    u.uCloudShear.value = param(params, 'cloudShear') * thickness * 1.2;
    // reference drift: 17.5 m/s horizontally, 2.2 m/s through the evolution axis
    this._driftRate.set(
      -Math.cos(wa) * 17.5 * unit * windSpeed,
      2.2 * unit * param(params, 'cloudEvolveSpeed'),
      -Math.sin(wa) * 17.5 * unit * windSpeed,
    );

    let steps = config.cloudRealisticSteps ?? 64;
    if (config.cloudFallback === 'lite') steps = Math.min(steps, 32);
    steps = Math.max(12, Math.min(CLOUD_V2_MAX_STEPS, steps));
    u.uCloudMinStep.value = opticalDepthSpan / (steps * 0.383);
    // a thicker layer gets proportionally more slices (up to 2x), so its
    // clouds are sampled as finely as the default ones
    const depthSteps = steps * THREE.MathUtils.clamp(thickness / refDepth, 1, 2);
    this._baseSteps = Math.min(CLOUD_V2_MAX_STEPS, depthSteps) * (q.disabled ? 0 : 1);

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
    const noise = getNoiseVolumeV2(this._renderer);
    u.uNoiseV2.value = noise.volume;
    u.uWeatherV2.value = noise.weather;

    this._drift.addScaledVector(this._driftRate, dt);
    u.uCloudOffset.value.copy(this._drift);
    u.uCloudSteps.value = this._baseSteps * this._adaptiveStepScale;
    // the dithered lattice needs the low-res pass's tent filter to resolve
    u.uCloudJitter.value = this._lowRes ? 1 : 0;
    if (sunDir) u.uSunDir.value.copy(sunDir).normalize();
  }

  dispose() {
    this._releaseNoise?.();
    super.dispose();
  }
}

// ---------------------------------------------------------------------------
// Infinite world: the bounded slab follows the camera on chunk boundaries. The
// field is a pure function of world position, so re-centring never changes it.
// ---------------------------------------------------------------------------
export class CloudV2InfiniteLayer extends CloudV2SlabLayer {
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
