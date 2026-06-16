import * as THREE from 'three';
import { createTerrainUniforms, createTerrainMaterial, createInfiniteTerrainMaterial } from './terrain/TerrainMaterial.js';
import { createWaterMaterial, createInfiniteWaterMaterial } from './terrain/WaterMaterial.js';
import { TerrainBoard } from './terrain/TerrainBoard.js';
import { InfiniteWorld } from './terrain/InfiniteWorld.js';
import { PlanetWorld } from './terrain/PlanetWorld.js';
import { PlanetCloudLayer } from './sky/PlanetCloudLayer.js';
import { CloudSlabLayer } from './sky/CloudSlabLayer.js';
import { createPlanetMaterial, createPlanetWaterMaterial } from './terrain/PlanetMaterial.js';
import { PlanetHeightSampler } from './terrain/PlanetHeightSampler.js';
import { PlanetOrbitControls } from './PlanetOrbitControls.js';
import { PlanetController } from './player/PlanetController.js';
import { EditorControls } from './EditorControls.js';
import { FPSControls } from './FPSControls.js';
import { Minimap } from './Minimap.js';
import { DEFAULT_PARAMS, applyPreset } from './presets.js';
import { ProceduralSky } from './sky/ProceduralSky.js';
import { evaluateTimeOfDay } from './sky/TimeOfDay.js';
import { FogManager } from './render/FogManager.js';
import { UnderwaterEffect } from './render/UnderwaterEffect.js';
import {
  applyPerfPreset, createPerfSettings, loadPerfSettings, savePerfSettings,
  sanitizePerfSettings, resolveLodSegments, resolveLodDistances,
} from './render/PerformanceSettings.js';
import { TerrainExporter } from './terrain/TerrainExporter.js';
import { PlanetExporter } from './terrain/PlanetExporter.js';
import { buildBoardPlinthGeometry, createBoardPlinthMaterial } from './terrain/BoardPlinth.js';
import { PlanetStyleManager } from './style/PlanetStyleManager.js';
import { TerrainHeightSampler } from './terrain/TerrainHeightSampler.js';
import { GpuHeightSampler } from './terrain/GpuHeightSampler.js';
import { PlayerController } from './player/PlayerController.js';
import { downloadPlanetStyleJSON, parsePlanetStyleJSON } from './export/TerrainPresetExporter.js';
import { PaintModeManager } from '../paint/PaintModeManager.js';

// ============================================================================
// Terrain Studio engine. Framework-agnostic: owns the renderer/scene, the
// single fixed terrain board, shared shader uniforms and camera controls.
// The React UI talks to it through methods + the `callbacks` object:
//   onParams(params)            full param mirror after any change
//   onStatus(text, busy)        status bar text
//   onStats({fps,triangles,drawCalls})
//   onLod(counts, chunkCount)
//   onCamera({angle,distance})
//   onBoard(boardSize)
//   onToast(message)
//   onFirstInteract()
//   onInfiniteStats(stats)      infinite mode HUD data
//   onQualityChange(key)        quality preset changed
//   onTimeOfDayChange(value)    time-of-day slider changed
// ============================================================================

// Deterministic PRNG used ONLY to derive noise-domain offsets from the seed.
// Terrain itself is a pure GPU function of (worldXZ, uniforms).
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Parameter keys that change the terrain shape (deferred when Auto Update is
// off). Everything else (debug toggles, sun, fog…) always applies instantly.
const SHAPE_KEYS = new Set([
  'seed', 'heightScale', 'seaLevel', 'noiseScale', 'noiseStrength', 'octaves',
  'persistence', 'lacunarity', 'ridge', 'warp', 'falloff',
  'moistScale', 'moistBias', 'biomeScale', 'tempBias', 'snowLine',
  'chunkCount', 'chunkSize',
]);

const REBUILD_KEYS = new Set(['chunkCount', 'chunkSize']);

export class Engine {
  constructor({ canvas, minimapBase, minimapOverlay, callbacks }) {
    this.canvas = canvas;
    this.cb = callbacks;
    this.params = { ...DEFAULT_PARAMS };
    this.appliedChunkCount = 0;
    this.appliedChunkSize = 0;
    this._minimapDirtyAt = 0;
    this._lastLodUpdate = 0;
    this._lastHudUpdate = 0;
    this._frames = 0;
    this._fpsTime = 0;
    this._fps = 0;
    this._clock = new THREE.Clock();
    this._disposed = false;
    // Async shader compilation state (KHR_parallel_shader_compile):
    // while > 0, ticks skip rendering so nothing forces a blocking link.
    this._compiling = 0;
    this._octToken = 0;
    this._matTrash = [];         // warm materials kept alive until programs are acquired
    this._warmGeo = new THREE.PlaneGeometry(1, 1);
    this.planetStyle = new PlanetStyleManager();
    this.paintMode = null;
    this.paintState = null;

    // World mode: 'studio' (single board), 'infinite' (streamed flat grid),
    // or 'planet' (cube-sphere world)
    this.worldMode = 'studio';
    this.infiniteWorld = null;
    this.fpsControls = null;

    // Planet mode systems
    this.planetWorld = null;
    this.planetMaterial = null;
    this.planetWater = null;          // sphere water shell mesh
    this.planetWaterMat = null;
    this.planetControls = null;
    this.planetSampler = null;
    this.planetCloudLayer = null;
    this.planetFaceGrid = 8;
    this._compiledKeys = new Set();   // mode:octave shader sets already compiled

    // First-person player physics (optional, both modes)
    this.player = null;
    this.playerMode = false;
    this.heightSampler = null;
    this._terrainGen = 0;   // bumped whenever the height field changes
    this._infiniteTerrainMat = null;
    this._infiniteWaterMat = null;

    // Infinite mode systems
    this.proceduralSky = null;
    this.fogManager = null;
    this.timeOfDay = 0.38;         // default: morning

    // Centralized performance settings (persisted across sessions)
    this.perf = loadPerfSettings();
    this.qualityPreset = this.perf.preset;
    this._autoScale = 1.0;         // automatic performance mode render scale
    this._autoCheckAt = 0;

    this._initRenderer();
    this._initScene(minimapBase, minimapOverlay);
    this._initControls();
    this._initPaintMode();

    this.applyAll({ force: true });
    this._applyPerformance();
    this.controls.reset(this.boardSize);
    this._syncPlanetStyleToParams();
    this.cb.onStatus('Ready', false);
    this.cb.onParams({ ...this.params });
    if (this.cb.onPerfChange) this.cb.onPerfChange({ ...this.perf });

    this._resizeObserver = new ResizeObserver(() => this._onResize());
    this._resizeObserver.observe(canvas.parentElement);
    this._onResize();

    // Compile all shader programs in the background before the first render.
    // The first frame would otherwise block the main thread for the full
    // FXC/ANGLE compile of the terrain FBM shaders.
    this._warmupInitialShaders();

    this.renderer.setAnimationLoop(() => this._tick());
  }

  // ----------------------------------------------------------------- setup

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setClearColor(0x0b0e14, 1);

    const gl = this.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    let gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'WebGL2';
    const angle = /ANGLE \([^,]+,\s*(.+?),\s*[^,]*\)\s*$/.exec(gpu);
    if (angle) gpu = angle[1];
    gpu = gpu.replace(/\s*\(0x[0-9A-F]+\)/i, '').replace(/\s*Direct3D.*$/i, '').trim();
    if (gpu.length > 42) gpu = gpu.slice(0, 42) + '…';
    this.gpuName = gpu;
  }

  _initScene(minimapBase, minimapOverlay) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0e14);

    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 50000);

    // shared shader uniforms: terrain + water read the same objects
    this.uniforms = createTerrainUniforms();
    this.terrainMaterial = createTerrainMaterial(this.uniforms);
    this.board = new TerrainBoard(this.scene, this.terrainMaterial);

    // water plane at sea level
    this.waterMaterial = createWaterMaterial(this.uniforms);
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.waterMaterial);
    this.water.geometry.rotateX(-Math.PI / 2);
    this.water.renderOrder = 10;
    this.water.frustumCulled = false;
    this.scene.add(this.water);

    // clean diorama base: perimeter walls + flat bottom (no z-fight with chunk skirts)
    this.plinth = new THREE.Mesh(
      buildBoardPlinthGeometry(1, 40),
      createBoardPlinthMaterial()
    );
    this.plinth.renderOrder = 5;
    this.scene.add(this.plinth);

    // lights only affect the plinth (terrain/water have custom shaders)
    this.sunLight = new THREE.DirectionalLight(0xfff2dd, 1.6);
    this.scene.add(this.sunLight);
    this.scene.add(new THREE.AmbientLight(0x4a5568, 0.5));

    this.minimap = new Minimap(this.renderer, this.scene, minimapBase, minimapOverlay);

    // camera-underwater post effect (inactive above water — zero cost)
    this.underwater = new UnderwaterEffect();

    // studio/flat-board volumetric cloud slab (sits above the board; hidden
    // until enabled). Planet mode has its own spherical PlanetCloudLayer.
    this.studioCloud = new CloudSlabLayer(this.scene, {
      compile: (mats) => this._compileMaterialVariants(mats),
    });
  }

  _initControls() {
    this.controls = new EditorControls(this.camera, this.canvas);
    this.controls.onFirstInteract = () => this.cb.onFirstInteract();
  }

  _initPaintMode() {
    this.paintMode = new PaintModeManager({
      scene: this.scene,
      camera: this.camera,
      domElement: this.canvas,
      uniforms: this.uniforms,
      controls: this.controls,
      getBoardSize: () => this.boardSize,
      getParams: () => this.params,
      onChange: (state) => {
        this.paintState = state;
        if (this.cb.onPaintState) this.cb.onPaintState(state);
      },
      onToast: (msg) => this.cb.onToast(msg),
    });
    this.paintState = { ...this.paintMode.state };
  }

  // ------------------------------------------------------------ parameters

  get boardSize() { return this.params.chunkCount * this.params.chunkSize; }

  setParam(key, value) {
    this.params[key] = value;
    this.cb.onParams({ ...this.params });

    // cloud params: live shader updates only (never rebuild terrain/planet,
    // never mix into terrain generation)
    if (key.startsWith('cloud')) {
      this._applyCloudSettings();
      return;
    }

    // planet geometry params: rebuild the cube-sphere (chunk layout / radius)
    if (key === 'planetRadius' || key === 'planetFaceGrid') {
      this._applyUniforms();        // live uniforms (radius, eps)
      if (this.worldMode === 'planet') this._rebuildPlanet();
      return;
    }

    if (SHAPE_KEYS.has(key) && !this.params.autoUpdate) {
      this.cb.onStatus('Pending changes — press Regenerate', true);
      return;
    }
    this._afterParamChange(REBUILD_KEYS.has(key));
  }

  applyPresetByKey(presetKey) {
    this.params = applyPreset(this.params, presetKey);
    this.cb.onParams({ ...this.params });
    this._afterParamChange(true);
  }

  regenerate() { this.applyAll({ force: false }); }

  randomizeSeed() {
    this.setParam('seed', (Math.random() * 0xffffffff) >>> 0);
    this.cb.onToast(`Seed → ${this.params.seed}`);
  }

  newProject() {
    this.params = { ...DEFAULT_PARAMS };
    this.planetStyle.reset();
    this._syncPlanetStyleToParams();
    this.cb.onParams({ ...this.params });
    this.applyAll({ force: true });
    this.controls.reset(this.boardSize);
    this.cb.onToast('New project');
  }

  // ---------------------------------------------------------- planet style

  _syncPlanetStyleToParams() {
    const s = this.planetStyle.getStyle();
    this.params.planetPreset = s.planetPreset;
    this.params.palettePreset = s.palettePreset;
    this.params.noisePreset = s.noisePreset;
    this.params.planetStyle = s;
  }

  /** Fresh params object for React — avoids shared nested references. */
  _paramsSnapshot() {
    const style = this.planetStyle.getStyle();
    return {
      ...this.params,
      planetPreset: style.planetPreset,
      palettePreset: style.palettePreset,
      noisePreset: style.noisePreset,
      planetStyle: style,
    };
  }

  _notifyPlanetStyle() {
    this._syncPlanetStyleToParams();
    this.cb.onParams(this._paramsSnapshot());
    this.planetStyle.applyToUniforms(this.uniforms);
    this._applyStudioFogFromStyle();
    this._applyStudioSunFromStyle();
    this._minimapDirtyAt = performance.now();
    this.minimap.requestRedraw();
  }

  _applyStudioSunFromStyle() {
    if (this.worldMode === 'infinite') return;
    const style = this.planetStyle.getStyle();
    const sunI = style.sunIntensity ?? 1.25;
    if (style.sunColor) {
      this.sunLight.color.setRGB(style.sunColor[0], style.sunColor[1], style.sunColor[2]);
    }
    this.sunLight.intensity = sunI * 1.28;
  }

  _applyStudioFogFromStyle() {
    if (this.worldMode === 'infinite') return;
    const tint = this.planetStyle.getFogTint();
    if (tint) {
      this.uniforms.uFogColor.value.setRGB(tint[0], tint[1], tint[2]);
    }
    const sky = this.planetStyle.getStyle().skyTint;
    if (sky) {
      this.scene.background.setRGB(sky[0], sky[1], sky[2]);
    }
  }

  applyPlanetPresetByKey(key) {
    const { style, params } = this.planetStyle.applyPlanetPreset(key);
    for (const [k, v] of Object.entries(params)) this.params[k] = v;
    this.params.planetPreset = style.planetPreset;
    this.params.palettePreset = style.palettePreset;
    this.params.noisePreset = style.noisePreset;
    this.params.planetStyle = style;
    this.cb.onParams({ ...this.params });
    this._afterParamChange(Object.keys(params).some((k) => REBUILD_KEYS.has(k)));
    this.planetStyle.applyToUniforms(this.uniforms);
    this._applyStudioFogFromStyle();
    this.cb.onToast(`Planet: ${key}`);
  }

  applyPalettePresetByKey(key) {
    const style = this.planetStyle.applyPalettePreset(key);
    this._notifyPlanetStyle();
    this.cb.onToast(`Palette: ${key}`);
    return style;
  }

  applyNoisePresetByKey(key) {
    const { params } = this.planetStyle.applyNoisePreset(key);
    this.params.noisePreset = key;
    for (const [k, v] of Object.entries(params)) this.params[k] = v;
    this.cb.onParams({ ...this.params });
    this._afterParamChange(false);
    this.cb.onToast(`Noise: ${key}`);
  }

  generatePalette(options = {}) {
    const { style, meta } = this.planetStyle.generatePalette(this.params.seed, options);
    this.params.planetStyle = style;
    this._notifyPlanetStyle();
    const label = meta?.typeLabel ?? 'Procedural';
    this.cb.onToast(`Planet generated: ${label}`);
    return style;
  }

  randomizePlanetPreset() {
    const { style, params } = this.planetStyle.randomizePlanetPreset();
    for (const [k, v] of Object.entries(params)) this.params[k] = v;
    this.params.planetPreset = style.planetPreset;
    this.params.palettePreset = style.palettePreset;
    this.params.noisePreset = style.noisePreset;
    this.params.planetStyle = style;
    this.cb.onParams({ ...this.params });
    this._afterParamChange(false);
    this.planetStyle.applyToUniforms(this.uniforms);
    this._applyStudioFogFromStyle();
    this.cb.onToast(`Random planet: ${style.planetPreset}`);
  }

  setPlanetStyleColor(key, rgb) {
    this.planetStyle.setPaletteColor(key, rgb);
    this._notifyPlanetStyle();
  }

  setPlanetStyleTuning(key, value) {
    this.planetStyle.setStyle({ [key]: value, customEdits: true });
    this._notifyPlanetStyle();
  }

  exportPlanetStyle() {
    downloadPlanetStyleJSON(this.planetStyle.getStyle());
    this.cb.onToast('Planet style exported');
  }

  importPlanetStyleJSON(json) {
    const parsed = parsePlanetStyleJSON(json);
    if (!parsed || !this.planetStyle.importJSON({ planetStyle: parsed })) {
      this.cb.onToast('Invalid planet style file');
      return;
    }
    this._notifyPlanetStyle();
    this.cb.onToast('Planet style imported');
  }

  _afterParamChange(needsRebuild) {
    if (needsRebuild) this.applyAll({ force: false });
    else this._applyUniforms();
    this._minimapDirtyAt = performance.now();
    this.minimap.requestRedraw();
  }

  // Push every parameter into uniforms; rebuild the chunk grid if the world
  // layout changed.
  applyAll({ force }) {
    const p = this.params;
    const rebuildNeeded = force
      || p.chunkCount !== this.appliedChunkCount
      || p.chunkSize !== this.appliedChunkSize;

    if (rebuildNeeded) {
      this.cb.onStatus('Rebuilding board…', true);
      const maxHeight = this._maxHeight();
      this.board.build({
        chunkCount: p.chunkCount,
        chunkSize: p.chunkSize,
        maxHeight,
        skirtDepth: this._skirtDepth(),
        lodSegments: resolveLodSegments(this.perf),
      });
      this.appliedChunkCount = p.chunkCount;
      this.appliedChunkSize = p.chunkSize;

      const size = this.boardSize;
      this.water.scale.set(size, 1, size);
      this._updatePlinth();
      this.controls.setBoardSize(size);
      this.minimap.setBoard(size, maxHeight);
      this.cb.onBoard(size);
    }

    this._applyUniforms();
    this._minimapDirtyAt = performance.now();
    this.minimap.requestRedraw();
    this.cb.onStatus('Ready', false);
  }

  _maxHeight() { return this.params.heightScale * 1.35 + 2; }
  _skirtDepth() { return Math.max(24, this.params.heightScale * 0.08); }

  _updatePlinth() {
    const size = this.boardSize;
    if (!size) return;
    const skirtDepth = this._skirtDepth();
    const sea = this.params.seaLevel;
    const topY = sea > 0.5 ? sea : 0;
    const geo = buildBoardPlinthGeometry(size, skirtDepth, topY);
    this.plinth.geometry.dispose();
    this.plinth.geometry = geo;
  }

  _applyUniforms() {
    this._terrainGen++;   // height field may have changed — refresh collision tile
    const p = this.params;
    const u = this.uniforms;
    const size = this.boardSize;

    const rng = mulberry32(p.seed >>> 0);
    u.uSeedOffset.value.set(rng() * 2048 - 1024, rng() * 2048 - 1024);

    u.uFrequency.value = (p.noiseScale * 0.1) / size;
    u.uHeightScale.value = p.heightScale;
    u.uSeaLevel.value = p.seaLevel;
    u.uAmplitude.value = p.noiseStrength;
    u.uPersistence.value = p.persistence;
    u.uLacunarity.value = p.lacunarity;
    u.uRidge.value = p.ridge;
    u.uWarp.value = p.warp;
    u.uFalloff.value = p.falloff;
    u.uBoardHalf.value = size / 2;
    u.uChunkSize.value = p.chunkSize;
    u.uMoistScale.value = p.moistScale;
    u.uMoistBias.value = p.moistBias;
    u.uBiomeScale.value = p.biomeScale;
    u.uTempBias.value = p.tempBias;
    u.uBiomeDebug.value = p.biomeDebug ? 1 : 0;
    u.uSnowLine.value = p.snowLine;
    u.uNormalStrength.value = p.normalStrength;
    u.uAO.value = p.aoStrength;
    u.uGrid.value = p.chunkGrid ? 1 : 0;
    u.uLodDebug.value = p.lodDebug ? 1 : 0;
    u.uEps.value = Math.max(0.35, size / 4096);
    u.uSkirtDepth.value = this._skirtDepth();
    u.uPlanetRadius.value = p.planetRadius;
    // angular epsilon for analytic planet normals ≈ one finest-LOD quad
    u.uPlanetEps.value = 2.0 / (this._planetFaceGrid() * 64);

    // In infinite mode, fog and sun are managed by FogManager + TimeOfDay.
    // Only apply studio fog settings when NOT in infinite mode.
    if (this.worldMode !== 'infinite') {
      const az = p.sunAzimuth * Math.PI / 180;
      const el = p.sunElevation * Math.PI / 180;
      u.uSunDir.value.set(
        Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)
      ).normalize();
      this.sunLight.position.copy(u.uSunDir.value).multiplyScalar(2000);

      // planet is viewed in open space — exp distance fog would swallow the
      // whole globe, so it is disabled there.
      u.uFogDensity.value = this.worldMode === 'planet' ? 0.0 : p.fogDensity * 0.0001;
      this._applyStudioSunFromStyle();
    }

    // octave count is a compile-time constant (keeps loop bounds static for
    // the D3D11 shader compiler) — changing it requires new programs, which
    // are compiled in the background and swapped in when ready (no freeze)
    const oct = Math.round(p.octaves);
    if (this.terrainMaterial.defines.OCTAVES !== oct) {
      this._setOctavesAsync(oct);
    }

    this.terrainMaterial.wireframe = p.wireframe;
    if (this.planetWorld) this.planetWorld.setWireframe(p.wireframe);
    if (this.planetWaterMat) this.planetWaterMat.uniforms.uWaterAnim.value = p.waterAnim ? 1 : 0;
    this._updatePlanetWater();
    this.waterMaterial.uniforms.uWaterAnim.value = p.waterAnim ? 1 : 0;
    this.water.position.y = p.seaLevel;
    this.water.visible = p.seaLevel > 0.5;

    this.board.updateBounds(this._maxHeight(), this._skirtDepth());
    this._updatePlinth();
    this.planetStyle.applyToUniforms(u);
    this._applyStudioFogFromStyle();
    this._applyCloudSettings();   // slab altitude/scale track board height + size
    this._applyPixelRatio();
  }

  _applyPixelRatio() {
    // base = legacy absolute override if set, otherwise device pixel ratio;
    // then scaled by the performance render scale and the auto-perf scale.
    const legacy = this.params?.pixelRatio || 0;
    const base = legacy > 0 ? legacy : Math.min(window.devicePixelRatio, 2);
    const scale = (this.perf?.renderScale ?? 1) * this._autoScale;
    this.renderer.setPixelRatio(Math.min(2, Math.max(0.3, base * scale)));
  }

  // -------------------------------------------------- async shader compiling
  // All heavy shaders (terrain/water FBM) are compiled via compileAsync so
  // the GPU driver links them off the main thread (KHR_parallel_shader_compile)
  // while ticks keep running without rendering. Each shader needs TWO program
  // variants: the canvas one and the render-target one (different program
  // cache key — linear output color space) used by the underwater pass.

  /**
   * Compile materials without blocking. By default compiles BOTH output
   * variants (canvas + underwater render-target), since each has a distinct
   * program cache key (output color space). Pass { canvasOnly: true } for
   * modes that never use the underwater pass (planet) to skip the second,
   * unused program — roughly halving the compile work.
   */
  async _compileMaterialVariants(mats, { canvasOnly = false } = {}) {
    const group = new THREE.Group();
    for (const m of mats) group.add(new THREE.Mesh(this._warmGeo, m));

    // canvas variant (targetScene = real scene so light counts match)
    await this.renderer.compileAsync(group, this.camera, this.scene);

    if (canvasOnly) return;

    // render-target variant (used when the underwater pass is active)
    this.underwater._ensureTarget(this.renderer);
    this.renderer.setRenderTarget(this.underwater._rt);
    const pending = this.renderer.compileAsync(group, this.camera, this.scene);
    this.renderer.setRenderTarget(null);
    await pending;
  }

  /** Initial warmup: everything in the studio scene + the underwater pass. */
  async _warmupInitialShaders() {
    this._compiling++;
    this.cb.onStatus('Compiling shaders…', true);
    try {
      await this.renderer.compileAsync(this.scene, this.camera);

      this.underwater._ensureTarget(this.renderer);
      this.renderer.setRenderTarget(this.underwater._rt);
      const pending = this.renderer.compileAsync(this.scene, this.camera);
      this.renderer.setRenderTarget(null);
      await pending;

      // underwater fullscreen compositing shader
      await this.renderer.compileAsync(
        this.underwater._quadScene, this.underwater._quadCam
      );
    } catch (e) {
      console.warn('Shader warmup failed (falling back to sync compile)', e);
    }
    this._compiling--;
    if (!this._disposed && !this._compiling) this.cb.onStatus('Ready', false);
  }

  /**
   * Recompile terrain + water programs for a new octave count in the
   * background, then swap the define on the live materials — at that point
   * the programs are already in three's cache, so the swap is instant.
   */
  async _setOctavesAsync(oct) {
    const token = ++this._octToken;
    this.cb.onStatus('Compiling shaders…', true);

    const warm = [
      createTerrainMaterial(this.uniforms, oct),
      createWaterMaterial(this.uniforms, oct),
    ];
    if (this.worldMode === 'infinite') {
      warm.push(createInfiniteTerrainMaterial(this.uniforms, oct));
      warm.push(createInfiniteWaterMaterial(this.uniforms, oct));
    }
    const planetMode = this.worldMode === 'planet';
    if (planetMode) {
      warm.push(createPlanetMaterial(this.uniforms, oct));
      warm.push(createPlanetWaterMaterial(this.uniforms, oct));
    }

    try {
      // planet never uses the underwater RT variant — compile canvas-only there
      await this._compileMaterialVariants(warm, { canvasOnly: planetMode });
    } catch (e) {
      console.warn('Octave shader compile failed', e);
    }

    if (token === this._octToken && !this._disposed) {
      const live = [this.terrainMaterial, this.waterMaterial,
        this._infiniteTerrainMat, this._infiniteWaterMat];
      for (const m of live) {
        if (m && m.defines.OCTAVES !== oct) {
          m.defines.OCTAVES = oct;
          m.needsUpdate = true;
        }
      }
      // planet chunk materials share one program — swap the define on all
      if (this.planetWorld) this.planetWorld.setOctaves(oct);
      if (this.planetWaterMat && this.planetWaterMat.defines.OCTAVES !== oct) {
        this.planetWaterMat.defines.OCTAVES = oct;
        this.planetWaterMat.needsUpdate = true;
      }
      if (!this._compiling) this.cb.onStatus('Ready', false);
      this._minimapDirtyAt = performance.now();
      this.minimap.requestRedraw();
    }

    // keep warm materials alive until the live ones acquire the cached
    // programs on a rendered frame — disposing now would delete the programs
    this._matTrash.push({ mats: warm, at: performance.now() + 2000 });
  }

  // ------------------------------------------------------------------ camera

  resetView() { this.controls.reset(this.boardSize); }

  setMinimapCanvases(baseCanvas, overlayCanvas) {
    this.minimap.setCanvases(baseCanvas, overlayCanvas);
    this._minimapDirtyAt = 0;
    this.minimap.renderBase();
  }

  focusCenter() { this.controls.focusCenter(); }
  setCameraMode(mode) { this.controls.setMode(mode); }
  setCameraView(view) { this.controls.setView(view); }
  setFov(fov) {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------- player mode

  _getHeightSampler() {
    if (!this.heightSampler) {
      const cpu = new TerrainHeightSampler(this.uniforms, () => ({
        octaves: Math.round(this.params.octaves),
        infinite: this.worldMode === 'infinite',
      }));
      this.heightSampler = new GpuHeightSampler({
        renderer: this.renderer,
        scene: this.scene,
        uniforms: this.uniforms,
        cpuSampler: cpu,
        isTerrainMaterial: (m) => m === this.terrainMaterial || m === this._infiniteTerrainMat,
        getGeneration: () => this._terrainGen,
        getMaxHeight: () => this._maxHeight(),
      });
    }
    return this.heightSampler;
  }

  _waterLevel() {
    return this.params.seaLevel > 0.5 ? this.params.seaLevel : null;
  }

  /**
   * Toggle Player Physics Mode (gravity / walking / jumping / swimming).
   * Works in Infinite World and in Studio mode (walking on the board).
   * Free camera behavior is fully restored on disable.
   */
  setPlayerMode(enabled) {
    enabled = !!enabled;
    if (enabled && this.paintMode?.state.enabled) this.setPaintMode(false);
    if (enabled === this.playerMode) return;
    this.playerMode = enabled;

    // Planet mode uses a dedicated spherical-gravity walker.
    if (this.worldMode === 'planet') {
      this._setPlanetPlayerMode(enabled);
      if (this.cb.onPlayerMode) this.cb.onPlayerMode(this.playerMode);
      return;
    }

    if (enabled) {
      if (this.worldMode === 'studio') {
        // Studio: editor controls sleep, an FPS look controller takes over
        this.controls.enabled = false;
        if (!this.fpsControls) {
          this.fpsControls = new FPSControls(this.camera, this.canvas);
        }
        // spawn at board center, facing north
        this.camera.position.set(0, this._maxHeight(), 0);
        this.fpsControls.yaw = 0;
        this.fpsControls.pitch = 0;
      }
      this.player = new PlayerController({
        controls: this.fpsControls,
        camera: this.camera,
        sampler: this._getHeightSampler(),
        getWaterLevel: () => this._waterLevel(),
      });
      this.cb.onToast('Player mode — click to lock mouse · Space jump · Shift run');
    } else {
      if (this.player) {
        this.player.dispose();
        this.player = null;
      }
      if (this.worldMode === 'studio') {
        // restore the editor camera
        if (this.fpsControls) {
          this.fpsControls.dispose();
          this.fpsControls = null;
        }
        this.controls.enabled = true;
        this.controls.reset(this.boardSize);
      }
      this.cb.onToast('Free camera');
    }

    if (this.cb.onPlayerMode) this.cb.onPlayerMode(this.playerMode);
  }

  _getPlanetSampler() {
    if (!this.planetSampler) {
      this.planetSampler = new PlanetHeightSampler(this.uniforms, () => ({
        octaves: Math.round(this.params.octaves),
      }));
    }
    return this.planetSampler;
  }

  /** Enter/leave the spherical-gravity walker (orbit camera ↔ surface walk). */
  _setPlanetPlayerMode(enabled) {
    if (enabled) {
      // orbit camera sleeps while walking (frees the click for pointer lock)
      if (this.planetControls) { this.planetControls.dispose(); this.planetControls = null; }
      this.player = new PlanetController({
        camera: this.camera,
        domElement: this.canvas,
        sampler: this._getPlanetSampler(),
      });
      this.cb.onToast('Planet walk — click to lock mouse · Space jump · Shift run');
    } else {
      if (this.player) { this.player.dispose(); this.player = null; }
      // restore the orbit camera at a sensible distance
      this.planetControls = new PlanetOrbitControls(this.camera, this.canvas, this.params.planetRadius);
      this.planetControls.onFirstInteract = () => this.cb.onFirstInteract();
      this.planetControls.update(0.001);
      this.cb.onToast('Orbit camera');
    }
  }

  // -------------------------------------------------------------- paint mode

  setPaintMode(enabled) {
    if (enabled && this.playerMode) this.setPlayerMode(false);
    if (enabled && this.worldMode !== 'studio') {
      this.cb.onToast('Paint Mode is currently available in Studio mode');
      return;
    }
    this.paintMode?.setEnabled(enabled);
  }

  setPaintSetting(key, value) {
    this.paintMode?.setState({ [key]: value });
  }

  clearPaintLayers() {
    this.paintMode?.clear();
  }

  // -------------------------------------------------------------- world mode

  setWorldMode(mode) {
    if (mode === this.worldMode) return;
    if (this.paintMode?.state.enabled) this.setPaintMode(false);
    // player physics is per-mode — always leave it cleanly before switching
    this.setPlayerMode(false);

    // tear down the mode we are leaving
    const prev = this.worldMode;
    if (prev === 'infinite') this._disposeInfinite();
    else if (prev === 'planet') this._disposePlanet();

    this.worldMode = mode;
    this._terrainGen++;   // uFrequency / falloff change with the mode

    if (mode === 'infinite') this._enterInfiniteMode();
    else if (mode === 'planet') this._enterPlanetMode();
    else this._enterStudioMode();
  }

  _enterInfiniteMode() {
    // Infinite exploration stays fully procedural; Studio paint layers are
    // board-local overrides and are restored when returning to Studio mode.
    this.uniforms.uPaintEnabled.value = 0;
    if (this.studioCloud) this.studioCloud.setInScene(false);

    // Hide studio objects
    this.board.group.visible = false;
    this.plinth.visible = false;
    this.water.visible = false;

    // Compute fixed frequency matching the current tile
    const p = this.params;
    const tileFreq = (p.noiseScale * 0.1) / this.boardSize;

    // Create infinite materials (sharing the same uniform objects)
    const oct = Math.round(p.octaves);
    this._infiniteTerrainMat = createInfiniteTerrainMaterial(this.uniforms, oct);
    this._infiniteTerrainMat.wireframe = p.wireframe;
    this._infiniteWaterMat = createInfiniteWaterMaterial(this.uniforms, oct);
    this._infiniteWaterMat.uniforms.uWaterAnim.value = p.waterAnim ? 1 : 0;

    // Store the tile frequency for infinite mode
    this._studioFrequency = this.uniforms.uFrequency.value;
    this.uniforms.uFrequency.value = tileFreq;

    // Create infinite world from the centralized performance settings
    const perf = this.perf;
    this.infiniteWorld = new InfiniteWorld(
      this.scene,
      this._infiniteTerrainMat,
      this._infiniteWaterMat,
      {
        chunkSize: p.chunkSize,
        viewRadius: perf.viewRadius,
        maxHeight: this._maxHeight(),
        skirtDepth: this._skirtDepth(),
        seaLevel: p.seaLevel,
        lodSegments: resolveLodSegments(perf),
        lodDistances: resolveLodDistances(perf),
        waterDistance: perf.waterDistance,
      }
    );
    this.infiniteWorld.setMaxCreatesPerFrame(perf.maxCreatesPerFrame);
    this.infiniteWorld.setTriangleBudget(perf.triangleBudget);
    this.infiniteWorld.cullingAggressiveness = perf.cullingAggressiveness;

    // Create FPS controls
    this.fpsControls = new FPSControls(this.camera, this.canvas);

    // Position camera at world center, above terrain
    this.camera.position.set(0, p.heightScale * 0.6 + 50, 0);
    this.camera.fov = 75;
    this.camera.near = 0.5;
    this.camera.far = 80000;
    this.camera.updateProjectionMatrix();

    // Create procedural sky
    this.proceduralSky = new ProceduralSky(this.scene);

    // Create fog manager
    this.fogManager = new FogManager(this.uniforms, this.scene);
    this.fogManager.setDistanceMultiplier(perf.fogDistance);
    this.fogManager.updateFromViewDistance(perf.viewRadius, p.chunkSize);

    // Apply time of day
    this._applyTimeOfDay();

    // Apply render scale + water quality uniforms to the fresh materials
    this._applyPixelRatio();
    this._applyWaterPerf();

    // Compile the INFINITE_MODE shader variants in the background before the
    // first infinite frame renders (avoids a multi-second freeze on entry).
    this._warmupInfiniteShaders(oct);

    this.cb.onStatus('Infinite World', false);
    if (this.cb.onQualityChange) this.cb.onQualityChange(this.qualityPreset);
    if (this.cb.onTimeOfDayChange) this.cb.onTimeOfDayChange(this.timeOfDay);
  }

  async _warmupInfiniteShaders(oct) {
    this._compiling++;
    this.cb.onStatus('Compiling world shaders…', true);
    // warm clones (not the live materials) so mode exits mid-compile are safe
    const warm = [
      createInfiniteTerrainMaterial(this.uniforms, oct),
      createInfiniteWaterMaterial(this.uniforms, oct),
    ];
    try {
      await this._compileMaterialVariants(warm);
      // sky dome material (already in the scene) — both output variants
      await this.renderer.compileAsync(this.scene, this.camera);
      this.underwater._ensureTarget(this.renderer);
      this.renderer.setRenderTarget(this.underwater._rt);
      const pending = this.renderer.compileAsync(this.scene, this.camera);
      this.renderer.setRenderTarget(null);
      await pending;
    } catch (e) {
      console.warn('Infinite shader warmup failed', e);
    }
    this._matTrash.push({ mats: warm, at: performance.now() + 2000 });
    this._compiling--;
    if (!this._disposed && !this._compiling) {
      this.cb.onStatus(this.worldMode === 'infinite' ? 'Infinite World' : 'Ready', false);
    }
  }

  /** Dispose the infinite-world systems (does not restore studio). */
  _disposeInfinite() {
    if (this.infiniteWorld) {
      this.infiniteWorld.dispose();
      this.infiniteWorld = null;
    }
    if (this.fpsControls) {
      this.fpsControls.dispose();
      this.fpsControls = null;
    }
    if (this.proceduralSky) {
      this.proceduralSky.dispose();
      this.proceduralSky = null;
    }
    this.fogManager = null;
    if (this._infiniteTerrainMat) {
      this._infiniteTerrainMat.dispose();
      this._infiniteTerrainMat = null;
    }
    if (this._infiniteWaterMat) {
      this._infiniteWaterMat.dispose();
      this._infiniteWaterMat = null;
    }
  }

  /** Restore the single-board studio scene + editor camera. */
  _enterStudioMode() {
    this.board.group.visible = true;
    this.plinth.visible = true;
    this.water.visible = this.params.seaLevel > 0.5;
    if (this.studioCloud) {
      this.studioCloud.setInScene(true);
      this._applyCloudSettings();
    }

    this._applyUniforms();
    this.uniforms.uPaintEnabled.value = 1;

    this.scene.background = new THREE.Color(0x0b0e14);
    this._applyStudioFogFromStyle();

    this.camera.fov = 45;
    this.camera.near = 1;
    this.camera.far = 50000;
    this.camera.updateProjectionMatrix();
    this.controls.enabled = true;
    this.controls.reset(this.boardSize);

    this._minimapDirtyAt = 0;
    this.minimap.requestRedraw();
    this.minimap.renderBase();

    this.cb.onStatus('Ready', false);
  }

  // ---------------------------------------------------------------- planet mode

  /** Planet base radius + chunks-per-face from params (sane fallbacks). */
  _planetRadius() { return this.params.planetRadius || 16000; }
  _planetFaceGrid() { return Math.round(this.params.planetFaceGrid) || 8; }

  /** (Re)build the cube-sphere world + water shell from the current params.
   *  Disposes any existing planet world/water first. */
  _buildPlanetWorld() {
    if (this.planetWorld) { this.planetWorld.dispose(); this.planetWorld = null; }
    if (this.planetWater) {
      this.scene.remove(this.planetWater);
      this.planetWater.geometry.dispose();
      this.planetWater = null;
    }
    if (this.planetWaterMat) { this.planetWaterMat.dispose(); this.planetWaterMat = null; }

    const p = this.params;
    const oct = Math.round(p.octaves);
    // each chunk gets its own material instance that shares the engine's
    // uniform objects (so style/palette tweaks propagate) but owns its
    // per-chunk cube-face mapping uniforms
    this.planetWorld = new PlanetWorld(
      this.scene,
      () => createPlanetMaterial(this.uniforms, oct),
      {
        radius: this._planetRadius(),
        maxHeight: this._maxHeight(),
        skirtDepth: this._skirtDepth() * 3,
        faceGrid: this._planetFaceGrid(),
        lodSegments: resolveLodSegments(this.perf),
      }
    );
    this.planetWorld.setWireframe(p.wireframe);
    this.planetWorld.setTriangleBudget(this.perf.triangleBudget);
    this.planetWorld.cullingAggressiveness = this.perf.cullingAggressiveness;

    // water shell: a sphere at radius (planetRadius + seaLevel); the shader
    // discards over land so only basins fill. One mesh, one shared material.
    this.planetWaterMat = createPlanetWaterMaterial(this.uniforms, oct);
    this.planetWaterMat.uniforms.uWaterAnim.value = p.waterAnim ? 1 : 0;
    this.planetWater = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), this.planetWaterMat);
    this.planetWater.frustumCulled = false;
    this.planetWater.renderOrder = 10;
    this._updatePlanetWater();
    this.scene.add(this.planetWater);
    this._applyWaterPerf();
  }

  _enterPlanetMode() {
    const p = this.params;
    // planet is fully procedural — Studio paint layers don't apply
    this.uniforms.uPaintEnabled.value = 0;
    if (this.studioCloud) this.studioCloud.setInScene(false);

    // hide studio objects + sleep the editor camera
    this.board.group.visible = false;
    this.plinth.visible = false;
    this.water.visible = false;
    this.controls.enabled = false;

    // refresh shared uniforms (radius, frequency, sun, fog-off for planet)
    this._applyUniforms();

    this._buildPlanetWorld();

    // volumetric cloud shell (drawn around the globe; raymarched in-shader).
    // Self-contained — never touches the planet world / water / LOD / export.
    this.planetCloudLayer = new PlanetCloudLayer(this.scene, {
      planetRadius: this._planetRadius(),
      compile: (mats) => this._compileMaterialVariants(mats, { canvasOnly: true }),
    });
    this._applyCloudSettings();
    // warm the cloud program in the background so first enable doesn't hang
    this._compileMaterialVariants([this.planetCloudLayer.material], { canvasOnly: true })
      .catch((e) => console.warn('Cloud shader warmup failed', e));

    // open-space backdrop (procedural sky is added in a later pass)
    this.scene.background = new THREE.Color(0x05070d);

    this._applyPlanetCamera();

    this.planetControls = new PlanetOrbitControls(this.camera, this.canvas, this._planetRadius());
    this.planetControls.onFirstInteract = () => this.cb.onFirstInteract();
    this.planetControls.update(0.001);   // place the camera immediately

    this._applyPixelRatio();

    // compile the PLANET_MODE shader variant in the background (no freeze)
    this._warmupPlanetShaders(Math.round(p.octaves));

    this.cb.onStatus('Planet', false);
  }

  /** Camera near/far tuned to the planet scale. */
  _applyPlanetCamera() {
    const r = this._planetRadius();
    this.camera.fov = 60;
    this.camera.near = Math.max(0.5, r * 0.00004);
    this.camera.far = r * 12;
    this.camera.updateProjectionMatrix();
  }

  /** Sync the current cloud params into whichever cloud layer(s) exist (no
   *  rebuild). Both layers read the same cloud* params; each is only visible in
   *  its own world mode. */
  _applyCloudSettings() {
    if (this.planetCloudLayer) {
      this.planetCloudLayer.applyParams(this.params, this._planetRadius(), this.perf);
    }
    if (this.studioCloud) {
      this.studioCloud.applyParams(this.params, this._maxHeight(), this.boardSize, this.perf);
    }
  }

  /** Rebuild the planet for a radius / face-grid change (settings panel). */
  _rebuildPlanet() {
    if (this.worldMode !== 'planet') return;
    this._buildPlanetWorld();
    this._applyCloudSettings();   // inner/outer shell radii track planetRadius
    this._applyPlanetCamera();
    // re-clamp the orbit distance to the new radius without snapping the view
    const c = this.planetControls;
    if (c) {
      const r = this._planetRadius();
      c.planetRadius = r;
      c.minDist = r * 1.02;
      c.maxDist = r * 6.0;
      c.goalDist = Math.min(Math.max(c.goalDist, c.minDist), c.maxDist);
    }
  }

  /** Size + show/hide the water shell from the current radius + sea level. */
  _updatePlanetWater() {
    if (!this.planetWater) return;
    const seaR = this._planetRadius() + this.params.seaLevel;
    // The faceted water sphere chords sag below the ideal radius between
    // vertices; push the mesh out past that sag so it never dips into the
    // terrain at the shoreline and z-fights. The shader's analytic depth
    // still uses the TRUE sea radius (uPlanetRadius + uSeaLevel), so the
    // waterline position is unaffected by this bias.
    const sag = seaR * (1 - Math.cos(Math.PI / 96));   // 96 = height segments
    this.planetWater.scale.setScalar(seaR + sag * 1.5 + 4);
    this.planetWater.visible = this.params.seaLevel > 0.5;
  }

  async _warmupPlanetShaders(oct) {
    const key = `planet:${oct}`;
    if (this._compiledKeys.has(key)) {
      // programs already compiled this session — three's cache makes the live
      // materials link instantly, so skip the redundant background compile
      if (!this._compiling) this.cb.onStatus('Planet', false);
      return;
    }
    this._compiling++;
    this.cb.onStatus('Compiling planet shaders…', true);
    // planet never uses the underwater pass → compile only the canvas variant
    // (skips the second, render-target colour-space program: ~half the work)
    const warm = [
      createPlanetMaterial(this.uniforms, oct),
      createPlanetWaterMaterial(this.uniforms, oct),
    ];
    try {
      await this._compileMaterialVariants(warm, { canvasOnly: true });
      this._compiledKeys.add(key);
    } catch (e) {
      console.warn('Planet shader warmup failed', e);
    }
    this._matTrash.push({ mats: warm, at: performance.now() + 2000 });
    this._compiling--;
    if (!this._disposed && !this._compiling) {
      this.cb.onStatus(this.worldMode === 'planet' ? 'Planet' : 'Ready', false);
    }
  }

  /** Dispose the planet-mode systems (does not restore studio). */
  _disposePlanet() {
    if (this.player) { this.player.dispose(); this.player = null; }
    if (this.planetCloudLayer) { this.planetCloudLayer.dispose(); this.planetCloudLayer = null; }
    if (this.planetWorld) { this.planetWorld.dispose(); this.planetWorld = null; }
    if (this.planetWater) {
      this.scene.remove(this.planetWater);
      this.planetWater.geometry.dispose();
      this.planetWater = null;
    }
    if (this.planetWaterMat) { this.planetWaterMat.dispose(); this.planetWaterMat = null; }
    if (this.planetControls) { this.planetControls.dispose(); this.planetControls = null; }
    if (this.fpsControls) { this.fpsControls.dispose(); this.fpsControls = null; }
    if (this.proceduralSky) { this.proceduralSky.dispose(); this.proceduralSky = null; }
    if (this.planetMaterial) { this.planetMaterial.dispose(); this.planetMaterial = null; }
  }

  // -------------------------------------------------------- infinite controls

  /**
   * Set quality preset (legacy entry point — HUD select). Delegates to the
   * centralized performance settings.
   * @param {string} key — 'performance', 'balanced', 'high', 'ultra'
   */
  setQuality(key) {
    this.setPerfPreset(key);
  }

  // ---------------------------------------------------- performance settings

  /**
   * Apply a performance preset ('performance', 'balanced', 'high', 'ultra',
   * or 'custom' which keeps current values).
   */
  setPerfPreset(key) {
    this.perf = applyPerfPreset(this.perf, key);
    this.qualityPreset = this.perf.preset;
    this._applyPerformance();
    this._notifyPerf();
  }

  /**
   * Change one performance setting; switches the preset to 'custom'.
   * Array settings (lodSegments / lodDistances) take a full replacement array.
   */
  setPerfSetting(key, value) {
    if (!(key in this.perf)) return;
    const next = { ...this.perf, [key]: value };
    // autoPerf / underwater toggles alone don't make the preset custom
    if (key !== 'autoPerf' && key !== 'underwaterEffect') next.preset = 'custom';
    this.perf = sanitizePerfSettings(next);
    if (key === 'autoPerf' && !this.perf.autoPerf) {
      this._autoScale = 1.0;   // leaving auto mode restores full render scale
    }
    this.qualityPreset = this.perf.preset;
    this._applyPerformance();
    this._notifyPerf();
  }

  /** Reset all performance settings to the default High preset. */
  resetPerfSettings() {
    this.perf = createPerfSettings('high');
    this.qualityPreset = this.perf.preset;
    this._autoScale = 1.0;
    this._applyPerformance();
    this._notifyPerf();
    this.cb.onToast('Performance settings reset');
  }

  _notifyPerf() {
    savePerfSettings(this.perf);
    if (this.cb.onPerfChange) this.cb.onPerfChange({ ...this.perf });
    if (this.cb.onQualityChange) this.cb.onQualityChange(this.qualityPreset);
  }

  /**
   * Push the current performance settings into every subsystem. Idempotent
   * and cheap: each setter no-ops when its value is unchanged, and LOD
   * geometry changes rebuild gradually (one LOD level per frame).
   */
  _applyPerformance() {
    const s = this.perf;
    const segments = resolveLodSegments(s);
    const distances = resolveLodDistances(s);

    this._applyPixelRatio();
    this._applyWaterPerf();
    this.underwater.enabled = s.underwaterEffect !== false;

    // Studio board: segment counts + master distance scale
    this.board.setLodSegments(segments);
    this.board.setLodDistanceScale(s.lodDistanceScale);
    this.board.cullingAggressiveness = s.cullingAggressiveness;

    if (this.infiniteWorld) {
      this.infiniteWorld.setViewRadius(s.viewRadius);
      this.infiniteWorld.setMaxCreatesPerFrame(s.maxCreatesPerFrame);
      this.infiniteWorld.setLodSegments(segments);
      this.infiniteWorld.setLodDistances(distances);
      this.infiniteWorld.setWaterDistanceFactor(s.waterDistance);
      this.infiniteWorld.setTriangleBudget(s.triangleBudget);
      this.infiniteWorld.cullingAggressiveness = s.cullingAggressiveness;
    }

    if (this.planetWorld) {
      this.planetWorld.setLodSegments(segments);
      this.planetWorld.setTriangleBudget(s.triangleBudget);
      this.planetWorld.cullingAggressiveness = s.cullingAggressiveness;
    }

    if (this.fogManager) {
      this.fogManager.setDistanceMultiplier(s.fogDistance);
      this.fogManager.updateFromViewDistance(s.viewRadius, this.params.chunkSize);
      if (this.proceduralSky) this._applyTimeOfDay();   // refresh fog color
    }

    this._applyCloudSettings();
  }

  /** Water quality uniforms — per water material, never shared with terrain. */
  _applyWaterPerf() {
    const s = this.perf;
    for (const mat of [this.waterMaterial, this._infiniteWaterMat, this.planetWaterMat]) {
      if (!mat) continue;
      mat.uniforms.uWaterQuality.value = s.waterQuality;
      mat.uniforms.uWaterDetail.value = s.waterDetail;
      mat.uniforms.uWaterReflection.value = s.waterReflection;
      mat.uniforms.uWaveComplexity.value = s.waterWaves;
    }
  }

  /**
   * Automatic performance mode: nudges an internal render-scale factor when
   * FPS stays low, and recovers it when there is headroom. Pixel-ratio only —
   * never rebuilds geometry. Triangle pressure is handled separately by the
   * InfiniteWorld triangle budget.
   */
  _autoPerfTick(now) {
    if (!this.perf.autoPerf || now - this._autoCheckAt < 2000) return;
    this._autoCheckAt = now;
    if (this._fps <= 0) return;

    if (this._fps < 42 && this._autoScale > 0.55) {
      this._autoScale = Math.max(0.55, this._autoScale - 0.1);
      this._applyPixelRatio();
    } else if (this._fps > 70 && this._autoScale < 1.0) {
      this._autoScale = Math.min(1.0, this._autoScale + 0.05);
      this._applyPixelRatio();
    }
  }

  /**
   * Set time of day (0..1).
   * @param {number} value
   */
  setTimeOfDay(value) {
    this.timeOfDay = Math.max(0, Math.min(1, value));
    if (this.worldMode === 'infinite') {
      this._applyTimeOfDay();
    }
    if (this.cb.onTimeOfDayChange) this.cb.onTimeOfDayChange(this.timeOfDay);
  }

  /**
   * Toggle frustum culling globally.
   */
  setCullingEnabled(enabled) {
    this.board.cullingEnabled = enabled;
    if (this.infiniteWorld) {
      this.infiniteWorld.cullingEnabled = enabled;
    }
  }

  /**
   * Toggle behind-camera culling globally.
   */
  setBehindCameraCulling(enabled) {
    if (this.infiniteWorld) {
      this.infiniteWorld.behindCameraCulling = enabled;
    }
    this.board.behindCameraCulling = enabled;
  }

  /**
   * Apply time-of-day to sky, fog, and terrain lighting.
   */
  _applyTimeOfDay() {
    const tod = evaluateTimeOfDay(this.timeOfDay);

    // Update sky dome
    if (this.proceduralSky) {
      this.proceduralSky.updateFromTimeOfDay(tod);

      // Compute sun direction from time-of-day angles
      const az = tod.sunAzimuth * Math.PI / 180;
      const el = tod.sunElevation * Math.PI / 180;
      const sunDir = this.uniforms.uSunDir.value;
      sunDir.set(
        Math.cos(el) * Math.sin(az),
        Math.sin(el),
        Math.cos(el) * Math.cos(az)
      ).normalize();
      this.proceduralSky.setSunDirection(sunDir);
      this.sunLight.position.copy(sunDir).multiplyScalar(2000);
    }

    // Update fog
    if (this.fogManager) {
      this.fogManager.updateFromTimeOfDay(tod);
    }

    // Update terrain sun light intensity and color
    this.sunLight.intensity = tod.lightIntensity;
    this.sunLight.color.setRGB(tod.sunColor[0], tod.sunColor[1], tod.sunColor[2]);
  }

  // ------------------------------------------------------------- save/load

  saveSeed() {
    this._syncPlanetStyleToParams();
    const data = {
      app: 'terrain-studio',
      version: 1,
      savedAt: new Date().toISOString(),
      params: this.params,
      paint: this.paintMode?.serialize(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    this._download(URL.createObjectURL(blob), `terrain-seed-${this.params.seed}.json`);
    this.cb.onToast('Seed saved as JSON');
  }

  loadSeedJSON(json) {
    const src = json?.params && typeof json.params === 'object' ? json.params : json;
    if (!src || typeof src !== 'object' || !('seed' in src)) {
      this.cb.onToast('Not a valid terrain seed file');
      return;
    }
    const next = { ...DEFAULT_PARAMS };
    for (const key of Object.keys(DEFAULT_PARAMS)) {
      if (key in src && typeof src[key] === typeof DEFAULT_PARAMS[key]) next[key] = src[key];
    }
    this.params = next;
    if (src.planetStyle) this.planetStyle.importJSON({ planetStyle: src.planetStyle });
    else if (src.planetPreset) this.planetStyle.applyPlanetPreset(src.planetPreset);
    this._syncPlanetStyleToParams();
    this.cb.onParams({ ...this.params });
    this.applyAll({ force: true });
    if (json?.paint) this.paintMode?.load(json.paint);
    this.cb.onToast(`Loaded seed ${this.params.seed}`);
  }

  // --------------------------------------------------------------- exports

  _download(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  exportScreenshot() {
    // planet renders straight to the canvas (no underwater pass)
    if (this.worldMode === 'planet') this.renderer.render(this.scene, this.camera);
    else this.underwater.render(this.renderer, this.scene, this.camera);
    this.renderer.domElement.toBlob((blob) => {
      if (!blob) return this.cb.onToast('Export failed');
      this._download(URL.createObjectURL(blob), `terrain-${this.params.seed}.png`);
      this.cb.onToast('Screenshot exported');
    });
  }

  exportHeightmap() {
    const SIZE = 1024;
    const rt = new THREE.WebGLRenderTarget(SIZE, SIZE);
    const half = this.boardSize / 2;
    const cam = new THREE.OrthographicCamera(-half, half, half, -half, 1, 20000);
    cam.up.set(0, 0, -1);
    cam.position.set(0, this._maxHeight() + 2000, 0);
    cam.lookAt(0, 0, 0);

    this.uniforms.uColorMode.value = 1;
    const waterWasVisible = this.water.visible;
    this.water.visible = false;
    this.plinth.visible = false;

    this.renderer.setRenderTarget(rt);
    this.renderer.render(this.scene, cam);
    const pixels = new Uint8Array(SIZE * SIZE * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, SIZE, SIZE, pixels);
    this.renderer.setRenderTarget(null);

    this.uniforms.uColorMode.value = 0;
    this.water.visible = waterWasVisible;
    this.plinth.visible = true;
    rt.dispose();

    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(SIZE, SIZE);
    for (let y = 0; y < SIZE; y++) {
      const src = (SIZE - 1 - y) * SIZE * 4;
      img.data.set(pixels.subarray(src, src + SIZE * 4), y * SIZE * 4);
    }
    ctx.putImageData(img, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return this.cb.onToast('Export failed');
      this._download(URL.createObjectURL(blob), `heightmap-${this.params.seed}.png`);
      this.cb.onToast('Heightmap exported');
    });
  }

  async export3DTerrain(options) {
    this.cb.onStatus('Preparing export...', true);
    const onMsg = (msg) => { this.cb.onStatus(msg, true); this.cb.onToast(msg); };
    try {
      if (this.worldMode === 'planet') {
        // export the full cube-sphere planet mesh
        await PlanetExporter.export(this.renderer, this.params, this.uniforms, options, onMsg);
      } else {
        await TerrainExporter.export(
          this.renderer, this.params, this.uniforms, this.boardSize, options, onMsg
        );
      }
    } catch (e) {
      console.error(e);
      this.cb.onToast('Export failed: ' + e.message);
    } finally {
      this.cb.onStatus('Ready', false);
    }
  }

  // ------------------------------------------------------------- main loop

  _onResize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _tick() {
    const dt = Math.min(this._clock.getDelta(), 0.05);
    const now = performance.now();
    this.uniforms.uTime.value += dt;

    // free warm-up materials once the live materials hold their programs
    while (this._matTrash.length && now > this._matTrash[0].at) {
      for (const m of this._matTrash.shift().mats) m.dispose();
    }

    // shaders still compiling in the background: keep input responsive but
    // don't render — that would force a blocking program link
    if (this._compiling) {
      if (this.fpsControls) {
        this.fpsControls.update(dt);
        if (this.player) this.player.update(dt);
      } else if (this.worldMode === 'planet' && this.player) {
        this.player.update(dt);
      } else if (this.planetControls) {
        this.planetControls.update(dt);
      } else {
        this.controls.update(dt);
      }
      return;
    }

    // underwater activation is smoothed inside the effect (no flicker at the
    // surface); inactive when there is no water — works in studio + infinite.
    // Planet has its own ocean shell and a curved "up", so the screen-space
    // underwater pass does not apply there (waterLevel stays null → inactive).
    const waterLevel = (this.worldMode !== 'planet' && this.params.seaLevel > 0.5)
      ? this.params.seaLevel : null;
    this.underwater.update(
      dt, this.uniforms.uTime.value, this.camera.position.y, waterLevel, this.uniforms
    );

    this.paintMode?.update(dt);

    if (this.worldMode === 'infinite') {
      this._tickInfinite(dt, now);
    } else if (this.worldMode === 'planet') {
      this._tickPlanet(dt, now);
    } else {
      this._tickStudio(dt, now);
    }

    this._autoPerfTick(now);
  }

  _tickStudio(dt, now) {
    if (this.playerMode && this.player) {
      this.fpsControls.update(dt);   // mouse look
      this.player.update(dt);        // body physics
    } else {
      this.controls.update(dt);
    }

    if (this.studioCloud) {
      this.studioCloud.update(dt, this.camera.position, this.uniforms.uSunDir.value);
    }

    // Cull invisible chunks based on current camera frustum and facing
    this.board.cull(this.camera);

    // LOD selection: throttled, distance-based, internal to the fixed board
    if (now - this._lastLodUpdate > 150) {
      this._lastLodUpdate = now;
      this.board.updateLOD(this.camera.position);
      this.cb.onLod(
        [...this.board.lodCounts],
        this.params.chunkCount,
        this.board.visibleChunkCount,
        this.board.culledChunkCount
      );
    }

    this.underwater.render(this.renderer, this.scene, this.camera);
    const triangles = this.renderer.info.render.triangles;
    const drawCalls = this.renderer.info.render.calls;

    // minimap: re-render base only after params settle, marker every frame
    if (this.minimap._dirty && now - this._minimapDirtyAt > 280) {
      this.minimap.renderBase();
    }
    this.minimap.drawOverlay(this.controls);

    // HUD updates at ~6 Hz
    this._frames++;
    if (now - this._fpsTime >= 1000) {
      this._fps = this._frames;
      this._frames = 0;
      this._fpsTime = now;
    }
    if (now - this._lastHudUpdate > 160) {
      this._lastHudUpdate = now;
      this.cb.onCamera({
        angle: `${this.controls.azimuthDeg.toFixed(0)}°, ${this.controls.elevationDeg.toFixed(0)}°`,
        distance: this.controls.distance.toFixed(0),
      });
      this.cb.onStats({ fps: this._fps, triangles, drawCalls });
      if (this.cb.onPlayerState) {
        this.cb.onPlayerState(this.player ? this.player.state : null);
      }
    }
  }

  _tickInfinite(dt, now) {
    if (this.fpsControls) this.fpsControls.update(dt);
    if (this.playerMode && this.player) this.player.update(dt);

    // Stream chunks around the camera (with culling)
    if (this.infiniteWorld) {
      this.infiniteWorld.update(this.camera.position, this.camera);
    }

    this.underwater.render(this.renderer, this.scene, this.camera);
    const triangles = this.renderer.info.render.triangles;
    const drawCalls = this.renderer.info.render.calls;

    // Feed the triangle budget controller
    if (this.infiniteWorld) this.infiniteWorld.notifyTriangles(triangles);

    // HUD updates at ~6 Hz
    this._frames++;
    if (now - this._fpsTime >= 1000) {
      this._fps = this._frames;
      this._frames = 0;
      this._fpsTime = now;
    }
    if (now - this._lastHudUpdate > 160) {
      this._lastHudUpdate = now;

      const pos = this.camera.position;
      const fps = this.fpsControls;
      if (this.cb.onInfiniteStats) {
        this.cb.onInfiniteStats({
          x: pos.x.toFixed(0),
          y: pos.y.toFixed(0),
          z: pos.z.toFixed(0),
          speed: this.player
            ? Math.hypot(this.player.vel.x, this.player.vel.y, this.player.vel.z).toFixed(1)
            : (fps ? fps.moveSpeed.toFixed(0) : '0'),
          playerState: this.player ? this.player.state : null,
          chunks: this.infiniteWorld ? this.infiniteWorld.activeChunkCount : 0,
          visibleChunks: this.infiniteWorld ? this.infiniteWorld.visibleChunkCount : 0,
          culledChunks: this.infiniteWorld ? this.infiniteWorld.culledChunkCount : 0,
          lodCounts: this.infiniteWorld ? [...this.infiniteWorld.lodCounts] : [0,0,0,0],
        });
      }
      this.cb.onStats({ fps: this._fps, triangles, drawCalls });
    }
  }

  _tickPlanet(dt, now) {
    if (this.playerMode && this.player) {
      this.player.update(dt);   // PlanetController owns look + spherical physics
    } else if (this.planetControls) {
      this.planetControls.update(dt);
    }

    if (this.planetWorld) this.planetWorld.update(this.camera.position, this.camera);
    if (this.planetCloudLayer) {
      this.planetCloudLayer.update(dt, this.camera.position, this.uniforms.uSunDir.value);
    }

    // feed the studio LOD inspector (throttled) — same callback as studio
    if (this.planetWorld && now - this._lastLodUpdate > 150) {
      this._lastLodUpdate = now;
      this.cb.onLod(
        [...this.planetWorld.lodCounts],
        this._planetFaceGrid(),
        this.planetWorld.visibleChunkCount,
        this.planetWorld.culledChunkCount
      );
    }

    // planet renders straight to the canvas — no underwater render-target pass
    this.renderer.render(this.scene, this.camera);
    const triangles = this.renderer.info.render.triangles;
    const drawCalls = this.renderer.info.render.calls;
    if (this.planetWorld) this.planetWorld.notifyTriangles(triangles);

    this._frames++;
    if (now - this._fpsTime >= 1000) {
      this._fps = this._frames;
      this._frames = 0;
      this._fpsTime = now;
    }
    if (now - this._lastHudUpdate > 160) {
      this._lastHudUpdate = now;
      const pos = this.camera.position;
      if (this.cb.onInfiniteStats) {
        this.cb.onInfiniteStats({
          x: pos.x.toFixed(0),
          y: pos.y.toFixed(0),
          z: pos.z.toFixed(0),
          speed: this.player
            ? Math.hypot(this.player.vel.x, this.player.vel.y, this.player.vel.z).toFixed(1)
            : '0',
          playerState: this.player ? this.player.state : null,
          chunks: this.planetWorld ? this.planetWorld.activeChunkCount : 0,
          visibleChunks: this.planetWorld ? this.planetWorld.visibleChunkCount : 0,
          culledChunks: this.planetWorld ? this.planetWorld.culledChunkCount : 0,
          lodCounts: this.planetWorld ? [...this.planetWorld.lodCounts] : [0, 0, 0, 0],
        });
      }
      this.cb.onStats({ fps: this._fps, triangles, drawCalls });
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._resizeObserver.disconnect();
    this.renderer.setAnimationLoop(null);
    if (this.paintMode) { this.paintMode.dispose(); this.paintMode = null; }
    if (this.player) { this.player.dispose(); this.player = null; }
    if (this.heightSampler) { this.heightSampler.dispose(); this.heightSampler = null; }
    if (this.worldMode === 'infinite') this._disposeInfinite();
    else if (this.worldMode === 'planet') this._disposePlanet();
    else if (this.fpsControls) { this.fpsControls.dispose(); this.fpsControls = null; }
    if (this.studioCloud) { this.studioCloud.dispose(); this.studioCloud = null; }
    this.board.dispose();
    this.minimap.dispose();
    this.underwater.dispose();
    for (const t of this._matTrash) for (const m of t.mats) m.dispose();
    this._matTrash = [];
    this._warmGeo.dispose();
    this.terrainMaterial.dispose();
    this.waterMaterial.dispose();
    this.renderer.dispose();
  }
}
