import * as THREE from 'three';
import { createTerrainUniforms, createTerrainMaterial, createInfiniteTerrainMaterial, rebuildTerrainShaderSource } from './terrain/TerrainMaterial.js';
import { createWaterMaterial, createInfiniteWaterMaterial, rebuildWaterShaderSource } from './terrain/WaterMaterial.js';
import { TerrainBoard } from './terrain/TerrainBoard.js';
import { InfiniteWorld } from './terrain/InfiniteWorld.js';
import { PlanetWorld } from './terrain/PlanetWorld.js';
import { PlanetCloudChunks } from './sky/PlanetCloudChunks.js';
import { PlanetCloudLayer } from './sky/PlanetCloudLayer.js';
import { CloudSlabLayer } from './sky/CloudSlabLayer.js';
import { CLOUD_QUALITY_PRESETS, CLOUD_LEGACY_PERF_KEYS } from './sky/CloudSettings.js';
import { createPlanetMaterial, createPlanetWaterMaterial } from './terrain/PlanetMaterial.js';
import { PlanetHeightSampler } from './terrain/PlanetHeightSampler.js';
import { PlanetHeightBaker } from './terrain/PlanetHeightBaker.js';
import { TerrainHeightBaker } from './terrain/TerrainHeightBaker.js';
import { fetchLocationHeightmap, getLocation } from './terrain/RealWorldHeightmap.js';
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
  hasStoredPerfSettings,
} from './render/PerformanceSettings.js';
import { detectGpuTier, presetForTier, saveGpuTier } from './render/GpuTier.js';
import { TerrainExporter } from './terrain/TerrainExporter.js';
import { PlanetExporter } from './terrain/PlanetExporter.js';
import { buildBoardPlinthGeometry, buildCircularPlinthGeometry, buildDiskWallGeometry, createBoardPlinthMaterial } from './terrain/BoardPlinth.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PlanetStyleManager } from './style/PlanetStyleManager.js';
import { TerrainHeightSampler } from './terrain/TerrainHeightSampler.js';
import { GpuHeightSampler } from './terrain/GpuHeightSampler.js';
import { PlayerController } from './player/PlayerController.js';
import { PlaneController } from './player/PlaneController.js';
import { defaultLegacyStack, migrateStack, makeLayer, cloneStack } from './terrain/noise/NoiseStack.js';
import {
  TERRAIN_RESET_KEYS, BIOME_RESET_KEYS, PROPS_RESET_KEYS, WORLD_RESET_KEYS,
  LIGHTING_PARAM_KEYS, LIGHTING_STYLE_KEYS, DEBUG_PARAM_KEYS,
  patchParamsFromDefaults, resetWaterParams, resetCloudParams, resetSkyboxParams,
  lightingStyleDefaults, waterColorDefaults, DEFAULT_TIME_OF_DAY, DEFAULT_DEBUG_FLAGS,
} from './panelResets.js';
import { EARTH_PALETTE } from './style/ColorPalette.js';
import { generateStackGLSL, packStackUniforms } from './terrain/noise/noiseStackCodegen.js';
import { downloadPlanetStyleJSON, parsePlanetStyleJSON } from './export/TerrainPresetExporter.js';
import { PaintModeManager } from '../paint/PaintModeManager.js';
import { ProceduralPropsManager } from './props/ProceduralPropsManager.js';
import { WaterSystem } from './water/WaterSystem.js';
import { migrateWaterParams } from './water/WaterSettings.js';
import { createRendererForCanvas, loseRendererContext } from './render/createWebGLRenderer.js';
import {
  detectRendererCapabilities,
  getWebGpuSupport,
  labelGpuPreference,
  labelRendererBackend,
} from './render/RendererCapabilities.js';
import { profiler } from './perf/PerformanceProfiler.js';
import { GPUProfiler } from './perf/GPUProfiler.js';
import { APP_VERSION } from '../constants/app.js';

const IMPORT_MODES = { disabled: 0, preview: 1, replace: 2, blend: 3 };
const DEFAULT_IMPORT_SETTINGS = { mode: 'disabled', blend: 1, invert: false, normalize: false, heightStrength: 1, heightOffset: 0 };

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
  'persistence', 'lacunarity', 'ridge', 'warp', 'falloff', 'edgeFalloffMode',
  'moistScale', 'moistBias', 'biomeScale', 'tempBias', 'snowLine',
  'chunkCount', 'chunkSize',
]);

const REBUILD_KEYS = new Set(['chunkCount', 'chunkSize']);

export class Engine {
  constructor({ canvas, minimapBase, minimapOverlay, callbacks, initialParams }) {
    this.canvas = canvas;
    this.cb = callbacks;
    this.params = migrateWaterParams({ ...DEFAULT_PARAMS, ...initialParams });
    // Live Noise Stack (drives terrain shape). Migrated from params so old saves
    // get the default single Classic-Terrain layer == bit-identical to before.
    this.noiseStack = migrateStack(this.params.noiseStack);
    this.params.noiseStack = this.noiseStack;
    this._stackGLSL = generateStackGLSL(this.noiseStack);
    this._stackSig = this._stackGLSL.sig;
    this._soloLayerId = null;       // solo-preview gate (uniform-only, no recompile)
    this.appliedChunkCount = 0;
    this.appliedChunkSize = 0;
    this._minimapDirtyAt = 0;
    this._lastLodUpdate = 0;
    this._lastHudUpdate = 0;
    this._frames = 0;
    this._fpsTime = 0;
    this._fps = 0;
    // On-demand studio rendering: skip the scene draw when nothing changed
    // (static camera, no animated layers). Saves GPU/heat on weak machines.
    this._needsRender = true;
    this._camPos = new THREE.Vector3();
    this._camQuat = new THREE.Quaternion();
    this._lastTris = 0;
    this._lastDraws = 0;
    this._lastRenderAt = 0;        // heartbeat: redraw at least ~1 Hz when idle
    this._tickErrorLogged = false;
    this._clock = new THREE.Clock();
    this._disposed = false;
    this._bootPending = true;
    // Async shader compilation state (KHR_parallel_shader_compile):
    // while > 0, ticks skip rendering so nothing forces a blocking link.
    this._compiling = 0;
    // The underwater render-target program variants are deferred from boot and
    // warmed lazily on first approach to water (see _warmUnderwaterShaders).
    this._underwaterWarmed = false;
    this._octToken = 0;
    this._matTrash = [];         // warm materials kept alive until programs are acquired
    this._warmGeo = new THREE.PlaneGeometry(1, 1);
    this.planetStyle = new PlanetStyleManager();
    this.paintMode = null;
    this.paintState = null;
    this.propsManager = null;
    this.propsTerrainSampler = null;

    // World mode: 'studio' (single board), 'infinite' (streamed flat grid),
    // or 'planet' (cube-sphere world)
    this.worldMode = 'studio';
    this.infiniteWorld = null;
    this.fpsControls = null;

    // Tile mode: the studio board can grow into a grid of square cells. Each
    // cell is one cellSize (== the single-board size) patch of the SAME
    // continuous noise field, so adjacent cells meet seamlessly; only the
    // assembly's outer rim keeps the diorama edge falloff. tiles always holds
    // origin (0,0). A small R8 occupancy texture drives the shader falloff/wall.
    this.tileAssemblyShape = 'square';
    this.circleRadiusCells = 0;
    this.tiles = [{ cx: 0, cz: 0 }];
    this._tileOccTex = null;
    // hover-to-add interaction (studio only)
    this._tileGhost = null;          // translucent preview mesh for the candidate cell
    this._tileGhostCell = null;      // {cx,cz} currently previewed, or null
    this._tileRay = new THREE.Raycaster();
    this._tileGroundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._tilePointer = new THREE.Vector2();
    this._tileDownAt = null;         // {x,y} pointer-down screen pos for click detection

    // Planet mode systems
    this.planetWorld = null;
    this.planetMaterial = null;
    this.planetWater = null;          // sphere water shell mesh
    this.planetWaterMat = null;
    this.planetControls = null;
    this.planetSampler = null;
    this.planetCloudChunks = null;
    this.planetCloudLayer = null;
    this.planetHeightBaker = null;   // bakes the static height field → cubemap
    this._bakedTerrainGen = -1;      // terrain generation the cubemap was baked at

    // Studio (flat board) height/normal bake: replaces the per-pixel height
    // field in the studio terrain + water shaders with a single texture fetch.
    this.terrainHeightBaker = null;
    this._bakedStudioGen = -1;       // terrain generation the studio texture was baked at
    this._bakedStudioLayout = '';    // tile layout the studio texture was baked at
    this._paintWasEnabled = false;   // detect paint→idle transition to refresh the bake
    this.planetFaceGrid = 8;
    this._compiledKeys = new Set();   // mode:octave shader sets already compiled

    // Explore controllers: walk or plane. playerMode remains a walk-only
    // compatibility flag for existing UI/status paths.
    this.player = null;
    this.playerMode = false;
    this.exploreMode = 'none';
    this.heightSampler = null;
    this._terrainGen = 0;   // bumped whenever the height field changes
    this._infiniteTerrainMat = null;
    this._infiniteWaterMat = null;

    // Infinite mode systems
    this.proceduralSky = null;
    this.fogManager = null;
    this.timeOfDay = 0.38;         // default: morning

    // Centralized performance settings (persisted across sessions)
    this._firstRun = !hasStoredPerfSettings();
    this.perf = loadPerfSettings();
    this.qualityPreset = this.perf.preset;
    this.gpuTier = null;
    this._tierNotice = null;
    this._autoScale = 1.0;         // automatic performance mode render scale
    this._autoCheckAt = 0;

    // Developer debug switches (Debug panel). None of these persist — they are
    // pure inspection aids that never touch saved projects or perf settings.
    this.tileDebug = { view: 'off', showLegend: true, opacity: 1, showPreview: true };
    this.importedMaps = { noise: null, height: null, biome: null };
    this.importedMapState = { noise: null, height: null, biome: null };

    this._debug = {
      freezeCulling: false,   // stop recomputing chunk visibility (fly out to inspect the frustum)
      freezeLod: false,       // stop recomputing per-chunk LOD
      forceRender: false,     // bypass the on-demand gate — draw every frame
      disableHeightBake: false, // force the live per-pixel height field (studio bake off)
      terrainDetailDebug: 'off',
    };
    this._landingShowcase = false;

    this._initRenderer();
    this._autoSelectPresetByGpu();   // first run only: pick a preset for the GPU
    this._initScene(minimapBase, minimapOverlay);
    this._initControls();
    this._initTileInteraction();
    this._initPaintMode();
    this._initProps();
    this._bindMinimapSources();

    this.controls.setBoardSize(this.boardSize);
    this.controls.reset(this.boardSize);
    this.controls.update(1);
    this.camera.updateMatrixWorld(true);

    this.applyAll({ force: true });
    this._applyPerformance();
    this._syncPlanetStyleToParams();
    this.cb.onParams({ ...this.params });
    if (this.cb.onPerfChange) this.cb.onPerfChange({ ...this.perf });

    this._resizeObserver = new ResizeObserver(() => this._onResize());
    this._resizeObserver.observe(canvas.parentElement);
    this._onResize();

    // On returning to the tab, force one redraw (the static studio scene may
    // have been cleared) and drop the accumulated hidden time.
    this._onVisibility = () => {
      if (document.visibilityState === 'visible') {
        this._clock.getDelta();   // discard the long hidden gap
        this._needsRender = true;
      }
    };
    document.addEventListener('visibilitychange', this._onVisibility);

    // Compile all shader programs in the background before the first render.
    // The first frame would otherwise block the main thread for the full
    // FXC/ANGLE compile of the terrain FBM shaders. Defer to idle time so it
    // never competes with the app's first paint.
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1));
    idle(() => { if (!this._disposed) this._warmupInitialShaders(); });

    this.renderer.setAnimationLoop(() => this._tick());
  }

  // ----------------------------------------------------------------- setup

  _initRenderer() {
    const requestedBackend = this.perf?.rendererBackend || 'auto';
    const requestedGpuPreference = this.perf?.gpuPreference || 'default';
    const webgpu = getWebGpuSupport();
    this.renderer = createRendererForCanvas(this.canvas, {
      rendererBackend: requestedBackend,
      gpuPreference: requestedGpuPreference,
    });
    this.renderer.setClearColor(0x0b0e14, 1);

    const gl = this.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    let gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'GPU info hidden by browser';
    const angle = /ANGLE \([^,]+,\s*(.+?),\s*[^,]*\)\s*$/.exec(gpu);
    if (angle) gpu = angle[1];
    gpu = gpu.replace(/\s*\(0x[0-9A-F]+\)/i, '').replace(/\s*Direct3D.*$/i, '').trim();
    if (gpu.length > 42) gpu = gpu.slice(0, 42) + '…';
    this.gpuName = gpu;
    this.gpuNameFull = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'GPU info hidden by browser';
    this.rendererCapabilities = detectRendererCapabilities(this.renderer);
    const actualOptions = this.renderer.userData?.terrainRendererOptions || {};
    this.rendererConfig = {
      requestedBackend,
      requestedBackendLabel: labelRendererBackend(requestedBackend),
      appliedRendererBackend: requestedBackend,
      appliedRendererBackendLabel: labelRendererBackend(requestedBackend),
      activeBackend: 'webgl',
      activeBackendLabel: this.rendererCapabilities.detectedRenderer,
      requestedGpuPreference,
      requestedGpuPreferenceLabel: labelGpuPreference(requestedGpuPreference),
      appliedGpuPreference: requestedGpuPreference,
      appliedGpuPreferenceLabel: labelGpuPreference(requestedGpuPreference),
      activeGpuPreference: actualOptions.powerPreference || 'default',
      activeGpuPreferenceLabel: labelGpuPreference(actualOptions.powerPreference || 'default'),
      webgpuRequestedButUnavailable: requestedBackend === 'webgpu' && !webgpu.supported,
      webgpuRequestedButNotActive: requestedBackend === 'webgpu',
      reloadRequired: false,
    };

    // Shared diagnostics profiler + optional non-blocking GPU timer.
    this.profiler = profiler;
    try { profiler.gpu = new GPUProfiler(this.renderer); } catch { profiler.gpu = null; }
  }

  /**
   * First-run only: detect the GPU tier and pick a starting performance preset
   * (low → Performance, medium → Balanced, high → High). Never runs for a
   * returning user (they have persisted settings). Queues a one-time notice
   * that is surfaced after the boot overlay clears.
   */
  _autoSelectPresetByGpu() {
    this.gpuTier = detectGpuTier(this.renderer.getContext());
    saveGpuTier(this.gpuTier);
    if (!this._firstRun) return;
    const preset = presetForTier(this.gpuTier);
    this.perf = createPerfSettings(preset);
    this.qualityPreset = this.perf.preset;
    savePerfSettings(this.perf);
    if (preset !== 'high') {
      const label = preset === 'performance' ? 'Performance' : 'Balanced';
      this._tierNotice = `Detected ${this.gpuName} — starting on ${label} quality (change in Performance settings)`;
    }
  }

  _initScene(minimapBase, minimapOverlay) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0e14);

    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 50000);

    // shared shader uniforms: terrain + water read the same objects
    this.uniforms = createTerrainUniforms();
    const oct0 = Math.round(this.params.octaves);
    this.terrainMaterial = createTerrainMaterial(this.uniforms, oct0, this._stackGLSL);
    this.board = new TerrainBoard(this.scene, this.terrainMaterial);

    // water plane at sea level
    this.waterMaterial = createWaterMaterial(this.uniforms, oct0, this._stackGLSL);
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.waterMaterial);
    this.water.geometry.rotateX(-Math.PI / 2);
    this.water.renderOrder = 10;
    this.water.frustumCulled = false;
    this.scene.add(this.water);

    this.waterSystem = new WaterSystem(this);
    this.waterSystem.init();

    // clean diorama base: perimeter walls + flat bottom (no z-fight with chunk skirts)
    this.plinth = new THREE.Mesh(
      buildBoardPlinthGeometry(1, 40),
      createBoardPlinthMaterial()
    );
    this.plinth.renderOrder = 5;
    this.scene.add(this.plinth);

    // Dedicated circular outer wall (circle assembly only). Shares the terrain
    // material so its top edge follows the generated island/mountain silhouette;
    // geometry is rebuilt by _updatePlinth and visibility tracks the plinth.
    this.diskWall = new THREE.Mesh(new THREE.BufferGeometry(), this.terrainMaterial);
    this.diskWall.frustumCulled = false;
    this.diskWall.visible = false;
    this.scene.add(this.diskWall);

    // Ghost preview for the hover-to-add tile feature: a translucent accent
    // slab + outline shown over an empty cell adjacent to the assembly. Hidden
    // until the pointer hovers a valid candidate cell in studio mode.
    this._tileGhost = this._buildTileGhost();
    this._tileGhost.visible = false;
    this.scene.add(this._tileGhost);

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

    // Procedural sky dome. Persistent + shared by studio (Tile) and infinite
    // world so both modes show the exact same configured sky (driven by the
    // shared timeOfDay + skybox* params). Visibility is toggled per world mode
    // by _applySkyboxSettings(); planet mode hides it (open-space backdrop).
    this.proceduralSky = new ProceduralSky(this.scene);
    this.proceduralSky.setVisible(false);
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

  _initProps() {
    this.propsManager = new ProceduralPropsManager(this.scene);
  }

  _bindMinimapSources() {
    this.minimap.setSources({
      controls: this.controls,
      sampler: this._getMinimapSampler(),
      getPaintHeightOffset: (x, z) => this._samplePaintHeightOffset(x, z),
      getPaintBiomeWeights: (x, z) => this.paintMode?.layers?.sampleBiomeMask(x, z) ?? null,
      getPropsMask: (x, z) => this.paintMode?.layers?.samplePropsMask(x, z) ?? { grass: 0, flowers: 0, mixed: 0 },
      getWaterLevel: () => this.params.seaLevel,
      getChunkCount: () => this.params.chunkCount,
    });
  }

  _getMinimapSampler() {
    if (!this._minimapSampler) {
      this._minimapSampler = new TerrainHeightSampler(this.uniforms, () => ({
        octaves: Math.round(this.params.octaves),
        infinite: false,
      }), this.noiseStack);
    }
    return this._minimapSampler;
  }

  _samplePaintHeightOffset(x, z) {
    return (this.paintMode?.layers?.sampleHeightOffset(x, z) ?? 0) * (this.paintMode?.state?.layerOpacity ?? 1);
  }

  // ------------------------------------------------------------ parameters

  get boardSize() { return this.params.chunkCount * this.params.chunkSize; }

  // ------------------------------------------------------------------- tiles
  // One cell == the classic single board. The assembly is the union of cells.
  get cellSize() { return this.params.chunkCount * this.params.chunkSize; }

  // Integer bounds over occupied cells, plus span in cells.
  _tileBounds() {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const t of this.tiles) {
      if (t.cx < minX) minX = t.cx;
      if (t.cz < minZ) minZ = t.cz;
      if (t.cx > maxX) maxX = t.cx;
      if (t.cz > maxZ) maxZ = t.cz;
    }
    if (!this.tiles.length) { minX = minZ = maxX = maxZ = 0; }
    return { minX, minZ, maxX, maxZ, cols: maxX - minX + 1, rows: maxZ - minZ + 1 };
  }

  // World-space extent of the whole assembly (single cell when one tile).
  _unionWidth() { return this._tileBounds().cols * this.cellSize; }
  _unionDepth() { return this._tileBounds().rows * this.cellSize; }
  // World center of the union bounding box (origin for a single centered cell).
  _unionCenter() {
    const b = this._tileBounds();
    const cs = this.cellSize;
    return {
      x: (b.minX + b.maxX) * 0.5 * cs,
      z: (b.minZ + b.maxZ) * 0.5 * cs,
    };
  }
  // World XZ of cell (cx,cz) center. Cell (0,0) is centered at the origin so a
  // single tile is identical to the classic board.
  _cellWorldCenter(cx, cz) { return { x: cx * this.cellSize, z: cz * this.cellSize }; }

  // (Re)build the R8 occupancy DataTexture mirroring this.tiles, indexed over
  // the union bounding box. Read by the terrain/water shaders (tileFalloff /
  // tileWall) to fade only the outer rim and wall only outward-facing edges.
  _buildOccupancyTexture() {
    const b = this._tileBounds();
    const w = Math.max(1, b.cols);
    const h = Math.max(1, b.rows);
    const data = new Uint8Array(w * h);
    for (const t of this.tiles) {
      const ix = t.cx - b.minX;
      const iz = t.cz - b.minZ;
      data[iz * w + ix] = 255;
    }
    if (this._tileOccTex) this._tileOccTex.dispose();
    const tex = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    // single-channel rows of arbitrary (non-×4) width need byte alignment
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    this._tileOccTex = tex;
    return { tex, b, w, h };
  }

  // Push tile-mode uniforms. uUseTiles stays 0 for a single tile so that case
  // takes the byte-identical legacy falloff/wall path.
  _applyTileUniforms() {
    const u = this.uniforms;
    const { b, w, h } = this._buildOccupancyTexture();
    const cs = this.cellSize;
    u.uTileOccupancy.value = this._tileOccTex;
    // world XZ of the min-cell's corner. Cell (cx) center is cx*cs, so its
    // min corner is cx*cs - cs/2.
    u.uTileGridOrigin.value.set(b.minX * cs - cs * 0.5, b.minZ * cs - cs * 0.5);
    u.uTileGridDim.value.set(w, h);
    u.uTileCellSize.value = cs;
    u.uUseTiles.value = this.tiles.length > 1 || this.tileAssemblyShape === 'circle' ? 1 : 0;
    u.uTileShape.value = this.tileAssemblyShape === 'circle' ? 1 : 0;
    u.uTileDiskRadius.value = (this.diskRadiusCells + 0.5) * cs;
    // studio height bake spans the whole tile union
    u.uBakeOrigin.value.set(b.minX * cs - cs * 0.5, b.minZ * cs - cs * 0.5);
    u.uBakeSpan.value.set(this._unionWidth(), this._unionDepth());
  }

  _studioBakeLayoutKey() {
    return `${this.tileAssemblyShape}:${this.diskRadiusCells}:` + this.tiles.map((t) => `${t.cx},${t.cz}`).sort().join('|');
  }

  get tileGridSize() { return 5; }           // 5×5 window centred on (0,0)
  get tileGridExtent() { return 2; }         // max |cx| / |cz| from origin (5 = 2+1+2)
  get diskRadiusCells() {
    if (this.tileAssemblyShape === 'circle') return this.circleRadiusCells;
    return this.tiles.reduce((m, t) => Math.max(m, Math.hypot(t.cx, t.cz)), 0);
  }
  _circleTiles(radius) {
    const r = Math.max(0, Math.min(this.tileGridExtent, Math.round(radius)));
    const outer = r + 0.5;
    const out = [];
    for (let cz = -this.tileGridExtent; cz <= this.tileGridExtent; cz++) {
      for (let cx = -this.tileGridExtent; cx <= this.tileGridExtent; cx++) {
        // Include every square chunk whose area intersects the rendered disk.
        // Testing centers alone leaves wedge-shaped holes in diagonal chunks.
        const dx = Math.max(Math.abs(cx) - 0.5, 0);
        const dz = Math.max(Math.abs(cz) - 0.5, 0);
        if (Math.hypot(dx, dz) < outer - 1e-6 || (cx === 0 && cz === 0)) {
          out.push({ cx, cz });
        }
      }
    }
    return out;
  }
  _circleRadiusForTiles(raw) {
    if (!Array.isArray(raw) || !raw.length) return 0;
    const farthest = raw.reduce((m, t) => {
      const cx = Math.trunc(Number(t?.cx));
      const cz = Math.trunc(Number(t?.cz));
      return Number.isFinite(cx) && Number.isFinite(cz) ? Math.max(m, Math.hypot(cx, cz)) : m;
    }, 0);
    return Math.min(this.tileGridExtent, Math.ceil(farthest - 1e-6));
  }
  _inTilePlacementBounds(cx, cz, shape = this.tileAssemblyShape) {
    const e = this.tileGridExtent;
    return shape === 'circle' ? Math.hypot(cx, cz) <= e + 1e-6 : Math.abs(cx) <= e && Math.abs(cz) <= e;
  }
  _hasTile(cx, cz) { return this.tiles.some((t) => t.cx === cx && t.cz === cz); }

  // Validate a loaded/restored tiles array: integer cells, deduped, origin
  // guaranteed, kept inside the 5×5 grid. Falls back to a single origin tile.
  _sanitizeTiles(raw) {
    if (this.tileAssemblyShape === 'circle') {
      return this._circleTiles(this._circleRadiusForTiles(raw));
    }
    const out = [];
    const seen = new Set();
    if (Array.isArray(raw)) {
      for (const t of raw) {
        const cx = Math.trunc(Number(t?.cx));
        const cz = Math.trunc(Number(t?.cz));
        if (!Number.isFinite(cx) || !Number.isFinite(cz)) continue;
        if (!this._inTilePlacementBounds(cx, cz)) continue;
        const key = `${cx},${cz}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ cx, cz });
      }
    }
    if (!out.some((t) => t.cx === 0 && t.cz === 0)) out.unshift({ cx: 0, cz: 0 });
    return out.length ? out : [{ cx: 0, cz: 0 }];
  }

  // A cell can be added if empty, inside the 5×5 grid, and 4-adjacent to an
  // occupied cell (assembly stays connected). No cap on how many are placed.
  canAddTileAt(cx, cz) {
    if (this._landingShowcase || this.worldMode !== 'studio') return false;
    if (!this._inTilePlacementBounds(cx, cz)) return false;
    if (this._hasTile(cx, cz)) return false;
    return this._hasTile(cx - 1, cz) || this._hasTile(cx + 1, cz)
        || this._hasTile(cx, cz - 1) || this._hasTile(cx, cz + 1);
  }

  // List of empty cells adjacent to the assembly (candidate add positions).
  candidateTileCells() {
    const seen = new Set();
    const out = [];
    const consider = (cx, cz) => {
      const key = `${cx},${cz}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (this.canAddTileAt(cx, cz)) out.push({ cx, cz });
    };
    for (const t of this.tiles) {
      consider(t.cx - 1, t.cz); consider(t.cx + 1, t.cz);
      consider(t.cx, t.cz - 1); consider(t.cx, t.cz + 1);
    }
    return out;
  }

  addTile(cx, cz) {
    if (!this.canAddTileAt(cx, cz)) return false;
    this.tiles.push({ cx, cz });
    this._rebuildTiles();
    return true;
  }

  canExpandCircle() {
    return !this._landingShowcase
      && this.worldMode === 'studio'
      && this.tileAssemblyShape === 'circle'
      && this.diskRadiusCells < this.tileGridExtent;
  }

  expandCircle() {
    if (!this.canExpandCircle()) return false;
    this.circleRadiusCells = Math.min(this.tileGridExtent, this.circleRadiusCells + 1);
    this.tiles = this._circleTiles(this.circleRadiusCells);
    this._tileGhostCell = null;
    this._rebuildTiles();
    this._frameCircleExpansion();
    return true;
  }

  _frameCircleExpansion() {
    if (this.tileAssemblyShape !== 'circle') return;
    const previewRadius = this.diskRadiusCells + (this.canExpandCircle() ? 1.5 : 0.5);
    this.controls.blendToDefault(previewRadius * 2 * this.cellSize);
  }

  removeTile(cx, cz) {
    if (this.tileAssemblyShape === 'circle') return false;
    if (this.tiles.length <= 1) return false;
    const i = this.tiles.findIndex((t) => t.cx === cx && t.cz === cz);
    if (i < 0) return false;
    this.tiles.splice(i, 1);
    this._rebuildTiles();
    return true;
  }

  // Rebuild board geometry + plinth/water/camera for the current tile set, then
  // re-center the camera on the assembly and mirror the layout to the UI.
  _rebuildTiles() {
    this._bakedStudioGen = -1;   // union bounds changed — re-bake height texture
    this.applyAll({ force: true });
    const c = this._unionCenter();
    this.controls.goalTarget.set(c.x, 0, c.z);
    this._updateTileGhost();
    this._notifyTiles();
    this._needsRender = true;
  }

  _notifyTiles() {
    this.cb.onTiles?.({
      tiles: this.tiles.map((t) => ({ ...t })),
      tileAssemblyShape: this.tileAssemblyShape,
      diskRadiusCells: this.diskRadiusCells,
    });
  }

  setTileAssemblyShape(shape) {
    const next = shape === 'circle' ? 'circle' : 'square';
    if (next === this.tileAssemblyShape) return;
    const circleRadius = next === 'circle' ? this._circleRadiusForTiles(this.tiles) : 0;
    this.tileAssemblyShape = next;
    this.circleRadiusCells = circleRadius;
    this.tiles = next === 'circle' ? this._circleTiles(circleRadius) : this._sanitizeTiles(this.tiles);
    this._tileGhostCell = null;
    this._rebuildTiles();
    if (next === 'circle') this._frameCircleExpansion();
  }

  // ---------------------------------------------------- hover-to-add tile UI

  _buildTileGhost() {
    const group = new THREE.Group();
    group.name = 'tile-ghost';
    group.renderOrder = 20;

    const square = new THREE.Group();
    square.name = 'tile-ghost-square';
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    const fill = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({
      color: 0x2563eb, transparent: true, opacity: 0.16,
      depthWrite: false, side: THREE.DoubleSide,
    }));
    fill.name = 'tile-ghost-fill';
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(plane),
      new THREE.LineBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.9 })
    );
    edges.name = 'tile-ghost-edge';
    square.add(fill, edges);

    const circle = new THREE.Group();
    circle.name = 'tile-ghost-circle';
    circle.visible = false;
    const ring = new THREE.RingGeometry(0.5, 1, 96);
    ring.rotateX(-Math.PI / 2);
    const ringFill = new THREE.Mesh(ring, fill.material);
    ringFill.name = 'tile-ghost-ring-fill';
    const ringEdges = new THREE.LineSegments(new THREE.EdgesGeometry(ring), edges.material);
    ringEdges.name = 'tile-ghost-ring-edge';
    circle.add(ringFill, ringEdges);

    group.add(square, circle);
    group.userData.square = square;
    group.userData.circle = circle;
    return group;
  }

  _tileInteractionActive() {
    return !this._landingShowcase
      && this.worldMode === 'studio'
      && this.exploreMode === 'none'
      && !this.paintState?.enabled;
  }

  _setCircleGhostGeometry(nextRadius) {
    const circle = this._tileGhost?.userData?.circle;
    if (!circle || circle.userData.radius === nextRadius) return;
    const outerCells = nextRadius + 0.5;
    const innerCells = Math.max(0, nextRadius - 0.5);
    const ring = new THREE.RingGeometry(innerCells / outerCells, 1, 96);
    ring.rotateX(-Math.PI / 2);
    const fill = circle.getObjectByName('tile-ghost-ring-fill');
    const edge = circle.getObjectByName('tile-ghost-ring-edge');
    fill.geometry.dispose();
    edge.geometry.dispose();
    fill.geometry = ring;
    edge.geometry = new THREE.EdgesGeometry(ring);
    circle.userData.radius = nextRadius;
  }

  // Position/show the ghost for the current candidate cell, or hide it.
  _updateTileGhost() {
    const g = this._tileGhost;
    if (!g) return;
    const cell = this._tileGhostCell;
    if (!this._tileInteractionActive() || !cell) {
      if (g.visible) { g.visible = false; this._needsRender = true; }
      return;
    }
    const cs = this.cellSize;
    const y = (this.params.seaLevel > 0.5 ? this.params.seaLevel : 0) + Math.max(2, cs * 0.002);
    const square = g.userData.square;
    const circle = g.userData.circle;
    if (this.tileAssemblyShape === 'circle') {
      this._setCircleGhostGeometry(cell.circleRadius);
      square.visible = false;
      circle.visible = true;
      g.position.set(0, y, 0);
      const outer = (cell.circleRadius + 0.5) * cs;
      g.scale.set(outer, 1, outer);
    } else {
      const c = this._cellWorldCenter(cell.cx, cell.cz);
      square.visible = true;
      circle.visible = false;
      g.position.set(c.x, y, c.z);
      g.scale.set(cs, 1, cs);
    }
    g.visible = true;
    this._needsRender = true;
  }

  _pointerToGround(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this._tilePointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this._tileRay.setFromCamera(this._tilePointer, this.camera);
    const hit = new THREE.Vector3();
    if (!this._tileRay.ray.intersectPlane(this._tileGroundPlane, hit)) return null;
    return hit;
  }

  _pointerToCell(clientX, clientY) {
    const hit = this._pointerToGround(clientX, clientY);
    if (!hit) return null;
    const cs = this.cellSize;
    return { cx: Math.round(hit.x / cs), cz: Math.round(hit.z / cs) };
  }

  _pointerToCircleExpansion(clientX, clientY) {
    if (!this.canExpandCircle()) return null;
    const hit = this._pointerToGround(clientX, clientY);
    if (!hit) return null;
    const currentOuter = (this.diskRadiusCells + 0.5) * this.cellSize;
    const nextRadius = this.diskRadiusCells + 1;
    const nextOuter = (nextRadius + 0.5) * this.cellSize;
    const distance = Math.hypot(hit.x, hit.z);
    return distance >= currentOuter * 0.92 && distance <= nextOuter
      ? { circleRadius: nextRadius }
      : null;
  }

  _initTileInteraction() {
    const c = this.canvas;
    this._onTilePointerMove = (e) => this._tilePointerMove(e);
    this._onTilePointerDown = (e) => this._tilePointerDown(e);
    this._onTilePointerUp = (e) => this._tilePointerUp(e);
    c.addEventListener('pointermove', this._onTilePointerMove);
    c.addEventListener('pointerdown', this._onTilePointerDown);
    c.addEventListener('pointerup', this._onTilePointerUp);
  }

  _tilePointerMove(e) {
    if (e.pointerType === 'touch') return;          // touch pans; add via panel
    if (!this._tileInteractionActive() || e.buttons !== 0) {
      // hide while dragging (camera pan/orbit) or when inactive
      if (this._tileGhostCell) { this._tileGhostCell = null; this._updateTileGhost(); }
      return;
    }
    const cell = this.tileAssemblyShape === 'circle'
      ? this._pointerToCircleExpansion(e.clientX, e.clientY)
      : this._pointerToCell(e.clientX, e.clientY);
    const next = this.tileAssemblyShape === 'circle'
      ? cell
      : ((cell && this.canAddTileAt(cell.cx, cell.cz)) ? cell : null);
    const cur = this._tileGhostCell;
    if ((next?.cx) !== (cur?.cx) || (next?.cz) !== (cur?.cz)
        || (next?.circleRadius) !== (cur?.circleRadius)) {
      this._tileGhostCell = next;
      this._updateTileGhost();
    }
  }

  _tilePointerDown(e) {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    if (!this._tileInteractionActive()) return;
    this._tileDownAt = { x: e.clientX, y: e.clientY };
  }

  _tilePointerUp(e) {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    const down = this._tileDownAt;
    this._tileDownAt = null;
    if (!down || !this._tileInteractionActive()) return;
    // a click (negligible drag) over the ghost adds the tile; a drag pans
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    const cell = this._tileGhostCell;
    if (this.tileAssemblyShape === 'circle' && cell?.circleRadius) {
      this._tileGhostCell = null;
      this.expandCircle();
      return;
    }
    if (cell && this.canAddTileAt(cell.cx, cell.cz)) {
      this._tileGhostCell = null;
      this.addTile(cell.cx, cell.cz);
    }
  }

  setTileDebug(next = {}) {
    this.tileDebug = { ...this.tileDebug, ...next };
    const mode = this.tileDebug.view === 'noise' ? 1 : this.tileDebug.view === 'height' ? 2 : this.tileDebug.view === 'biome' ? 3 : 0;
    this.uniforms.uTileDebugView.value = this.worldMode === 'studio' ? mode : 0;
    this._needsRender = true;
    this.cb.onTileDebug?.({ ...this.tileDebug });
  }

  async importTileMap(type, file) {
    const okTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!file || !okTypes.includes(file.type)) {
      const error = 'Unsupported file type. Use PNG, JPG, or WebP.';
      this._setImportState(type, { error });
      this.cb.onToast(error);
      return;
    }
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.decoding = 'async';
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
      const warning = img.width > 4096 || img.height > 4096 ? 'Large image imported; processing was downscaled for performance.' : '';
      const maxSide = 4096;
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const preview = canvas.toDataURL('image/png');
      URL.revokeObjectURL(url);
      const previous = this.importedMaps[type];
      if (previous?.texture) previous.texture.dispose();
      this.importedMaps[type] = { fileName: file.name, width: w, height: h, originalWidth: img.width, originalHeight: img.height, imageData, preview, settings: { ...DEFAULT_IMPORT_SETTINGS } };
      this._rebuildImportedTexture(type);
      this.cb.onToast(`${type[0].toUpperCase() + type.slice(1)} map imported`);
      if (warning) this.cb.onToast(warning);
    } catch (e) {
      console.error(e);
      const error = 'Image failed to load or contains invalid image data.';
      this._setImportState(type, { error });
      this.cb.onToast(error);
    }
  }

  /**
   * Fetch a curated real-world location's elevation and load it as the height
   * map (Tile mode). Reuses the existing import pipeline — the decoded field is
   * fed in as floatData so it deforms the mesh + GLB export like any height map.
   */
  async loadRealWorldLocation(locationId, { onProgress } = {}) {
    if (this.worldMode !== 'studio') {
      this.cb.onToast('Real-world heightmaps load in Tile (Studio) mode.');
      return false;
    }
    const loc = getLocation(locationId);
    if (!loc) { this.cb.onToast('Unknown location.'); return false; }
    this._setImportState('height', { loading: true, error: '' });
    try {
      const result = await fetchLocationHeightmap(loc, { onProgress });
      const previous = this.importedMaps.height;
      if (previous?.texture) previous.texture.dispose();
      this.importedMaps.height = {
        fileName: result.fileName,
        width: result.width,
        height: result.height,
        originalWidth: result.width,
        originalHeight: result.height,
        floatData: result.floatData,
        preview: result.preview,
        meta: result.meta,
        // default to replacing the procedural shape so the location reads clearly
        settings: { ...DEFAULT_IMPORT_SETTINGS, mode: 'replace', heightStrength: 1 },
      };
      this._rebuildImportedTexture('height');
      this._setImportState('height', { loading: false });
      this.applyAll({ force: false });
      this.cb.onToast(`Loaded ${loc.name}`);
      return true;
    } catch (e) {
      console.error(e);
      const error = e?.name === 'AbortError'
        ? 'Load cancelled.'
        : 'Could not load elevation data (network or CORS blocked).';
      this._setImportState('height', { loading: false, error });
      this.cb.onToast(error);
      return false;
    }
  }

  setTileMapSetting(type, key, value) {
    const entry = this.importedMaps[type];
    if (!entry) { this._setImportState(type, { error: 'Import a map before enabling this mode.' }); return; }
    entry.settings[key] = value;
    if (key === 'invert' || key === 'normalize') this._rebuildImportedTexture(type);
    this._syncImportedMapUniforms();
    this._setImportState(type);
    this.applyAll({ force: false });
  }

  _setImportState(type, patch = {}) {
    const entry = this.importedMaps[type];
    this.importedMapState = { ...this.importedMapState, [type]: entry ? { fileName: entry.fileName, width: entry.width, height: entry.height, preview: entry.preview, settings: { ...entry.settings }, warning: entry.originalWidth > 4096 || entry.originalHeight > 4096 ? 'Large image downscaled for processing.' : '', ...patch } : { ...patch } };
    this.cb.onImportedMaps?.(this.importedMapState);
  }

  _rebuildImportedTexture(type) {
    const entry = this.importedMaps[type];
    if (!entry) return;
    const n = entry.width * entry.height;
    let min = 1, max = 0;
    const vals = new Float32Array(n);
    if (entry.floatData) {
      // Pre-decoded data (e.g. real-world elevation tiles), already normalized 0..1.
      for (let p = 0; p < n; p++) {
        let v = entry.floatData[p];
        if (entry.settings.invert) v = 1 - v;
        vals[p] = v; if (v < min) min = v; if (v > max) max = v;
      }
    } else {
      const data = entry.imageData.data;
      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        let v = (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) / 255;
        if (entry.settings.invert) v = 1 - v;
        vals[p] = v; if (v < min) min = v; if (v > max) max = v;
      }
    }
    // HalfFloat storage: ~11-bit mantissa kills the 8-bit terracing the old
    // Uint8 path produced on real topography. importedMapValue() reads rgb as
    // luminance, so (v,v,v) round-trips exactly — no GLSL change. Half-float +
    // LinearFilter is core in WebGL2 (three r160), no extension guard needed.
    const toHalf = THREE.DataUtils.toHalfFloat;
    const halfOne = toHalf(1);
    const span = max > min ? max - min : 1;
    const out = new Uint16Array(n * 4);
    for (let p = 0; p < n; p++) {
      let v = vals[p];
      if (entry.settings.normalize) v = (v - min) / span;
      const h = toHalf(Math.max(0, Math.min(1, v)));
      const o = p * 4;
      out[o] = out[o + 1] = out[o + 2] = h; out[o + 3] = halfOne;
    }
    entry.texture?.dispose();
    entry.texture = new THREE.DataTexture(out, entry.width, entry.height, THREE.RGBAFormat, THREE.HalfFloatType);
    entry.texture.colorSpace = THREE.NoColorSpace;
    entry.texture.wrapS = entry.texture.wrapT = THREE.ClampToEdgeWrapping;
    entry.texture.minFilter = entry.texture.magFilter = THREE.LinearFilter;
    entry.texture.needsUpdate = true;
    this._syncImportedMapUniforms();
    this._setImportState(type);
  }

  _syncImportedMapUniforms() {
    for (const type of ['noise', 'height', 'biome']) {
      const e = this.importedMaps[type];
      const cap = type[0].toUpperCase() + type.slice(1);
      this.uniforms[`uImport${cap}Tex`].value = e?.texture ?? null;
      this.uniforms[`uImport${cap}Mode`].value = e ? (IMPORT_MODES[e.settings.mode] ?? 0) : 0;
      if (this.uniforms[`uImport${cap}Blend`]) this.uniforms[`uImport${cap}Blend`].value = e?.settings.blend ?? 1;
    }
    const h = this.importedMaps.height;
    this.uniforms.uImportHeightStrength.value = h?.settings.heightStrength ?? 1;
    this.uniforms.uImportHeightOffset.value = h?.settings.heightOffset ?? 0;
    this._bakedStudioGen = -1;
    this._terrainGen++;
    this._needsRender = true;
  }

  setParam(key, value) {
    this.params[key] = value;
    this.cb.onParams({ ...this.params });
    this._needsRender = true;   // any param change → redraw (on-demand studio)

    // Dynamic Noise Modifier Addition:
    // If the active noise stack doesn't have any enabled legacy layer, intercept adjustments
    // to classic sliders and inject/update appropriate modifier/height layers.
    const hasLegacy = this.noiseStack && this.noiseStack.layers.some((l) => l.type === 'legacy' && l.enabled);
    const legacyOnlyKeys = new Set(['warp', 'ridge', 'persistence', 'lacunarity', 'octaves']);

    if (!hasLegacy && legacyOnlyKeys.has(key)) {
      const defaultStack = cloneStack(this.noiseStack);
      let updated = false;

      if (key === 'warp') {
        const layer = defaultStack.layers.find(x => x.type === 'domainWarp');
        if (layer) {
          layer.strength = value;
          updated = true;
        } else if (value > 0.05) {
          const newLayer = makeLayer('domainWarp', { name: 'Domain Warp (Auto)', strength: value });
          defaultStack.layers.unshift(newLayer); // insert at top to affect subsequent layers
          this.cb.onToast('Domain Warp layer added to stack');
          updated = true;
        }
      } else if (key === 'ridge') {
        const layer = defaultStack.layers.find(x => x.type === 'ridged');
        if (layer) {
          layer.strength = value;
          updated = true;
        } else if (value > 0.05) {
          const newLayer = makeLayer('ridged', { name: 'Ridged Mountains (Auto)', strength: value });
          defaultStack.layers.push(newLayer);
          this.cb.onToast('Ridged Mountains layer added to stack');
          updated = true;
        }
      } else if (key === 'persistence' || key === 'lacunarity' || key === 'octaves') {
        let layer = defaultStack.layers.find(x => x.params && key in x.params);
        if (layer) {
          layer.params[key] = value;
          updated = true;
        } else {
          const newLayer = makeLayer('fbm', { name: 'FBM Detail (Auto)' });
          newLayer.params[key] = value;
          defaultStack.layers.push(newLayer);
          this.cb.onToast('FBM Detail layer added to stack');
          updated = true;
        }
      }

      if (updated) {
        this.setNoiseStack(defaultStack);
      }
    }

    // cloud params: live shader updates only (never rebuild terrain/planet,
    // never mix into terrain generation)
    if (key.startsWith('cloud')) {
      this._applyCloudSettings();
      return;
    }

    // skybox params: live sky-dome updates only (never rebuild terrain). The
    // master toggle flips the sky/sun/fog driver, so re-run the uniform pass;
    // appearance knobs are pure uniform writes.
    if (key.startsWith('skybox')) {
      if (key === 'skyboxEnabled') this._applyUniforms();
      else this._applySkyboxSettings();
      return;
    }

    // planet geometry params: rebuild the cube-sphere (chunk layout / radius).
    // These come from discrete dropdowns (one change at a time), so rebuild
    // immediately — App wraps the change in a loading overlay so the brief
    // freeze is covered. _rebuildPlanet refreshes uniforms itself.
    if (key === 'planetRadius' || key === 'planetFaceGrid') {
      if (this.worldMode === 'planet') this._rebuildPlanet();
      else this._applyUniforms();
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
    const defaultStack = migrateStack(undefined);
    this.setNoiseStack(defaultStack);
    this.cb.onParams({ ...this.params });
    this._afterParamChange(true);
  }

  regenerate() { this.applyAll({ force: false }); }

  randomizeSeed() {
    this.setParam('seed', (Math.random() * 0xffffffff) >>> 0);
  }

  newProject() {
    this.params = { ...DEFAULT_PARAMS };
    this.planetStyle.reset();
    this._syncPlanetStyleToParams();
    this.tileAssemblyShape = 'square';
    this.circleRadiusCells = 0;
    this.tiles = [{ cx: 0, cz: 0 }];   // collapse any multi-tile assembly
    this._tileGhostCell = null;
    this.applyAll({ force: true });
    this._notifyTiles();

    const defaultStack = migrateStack(undefined);
    this.setNoiseStack(defaultStack);

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
    this._needsRender = true;
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

  /** Render the top-down minimap base with the sky dome hidden so the map stays
   *  a clean terrain view (the dome would otherwise fill its background). */
  _renderMinimapBase() {
    const sky = this.proceduralSky;
    const wasVisible = !!sky && sky.mesh.visible;
    if (wasVisible) sky.setVisible(false);
    this.minimap.renderBase();
    if (wasVisible) sky.setVisible(true);
  }

  _applyStudioFogFromStyle() {
    if (this.worldMode === 'infinite') return;
    // When the procedural sky is active it owns the fog colour + backdrop
    // (driven by timeOfDay); the dome covers the flat background anyway.
    if (this._skyActive()) return;
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

  // -------------------------------------------------------------- noise stack

  _packNoiseUniforms() {
    const u = this.uniforms;
    const p = packStackUniforms(this.noiseStack, { solo: this._soloLayerId });
    for (let i = 0; i < p.strength.length; i++) {
      u.uLayerStrength.value[i] = p.strength[i];
      u.uLayerScale.value[i] = p.scale[i];
      u.uLayerSeed.value[i] = p.seed[i];
      u.uLayerParamsA.value[i].set(p.paramsA[i][0], p.paramsA[i][1], p.paramsA[i][2], p.paramsA[i][3]);
      u.uLayerParamsB.value[i].set(p.paramsB[i][0], p.paramsB[i][1], p.paramsB[i][2], p.paramsB[i][3]);
      u.uLayerMaskA.value[i].set(p.maskA[i][0], p.maskA[i][1], p.maskA[i][2], p.maskA[i][3]);
      u.uLayerMaskB.value[i].set(p.maskB[i][0], p.maskB[i][1], p.maskB[i][2], p.maskB[i][3]);
    }
  }

  /**
   * Replace the live Noise Stack. Continuous edits = uniform repack (instant).
   * Structural edits (add/remove/reorder/type/blend/mask/octave) regenerate the
   * GLSL and recompile materials in the background, mirroring _setOctavesAsync.
   */
  setNoiseStack(stack, { solo = this._soloLayerId } = {}) {
    this.noiseStack = stack;
    this.params.noiseStack = stack;
    this._soloLayerId = solo;
    if (this.heightSampler?.cpu?.setStack) this.heightSampler.cpu.setStack(stack);
    if (this.planetSampler) this.planetSampler.setStack(stack);
    if (this._minimapSampler?.setStack) this._minimapSampler.setStack(stack);

    const next = generateStackGLSL(stack);
    const structural = next.sig !== this._stackSig;
    this._stackGLSL = next;
    this._stackSig = next.sig;
    this.cb.onParams({ ...this.params });

    if (structural) {
      if (this.worldMode === 'planet') {
        // Planet chunks each own a material built from a factory; rebuild the
        // whole planet (and re-bake the height cubemap) with the new stack.
        this._rebuildPlanet();
      } else {
        this._rebuildStackMaterialsAsync();
      }
    } else {
      this._applyUniforms();
      this._minimapDirtyAt = performance.now();
      this.minimap.requestRedraw();
      if (this.worldMode === 'planet') this._bakedTerrainGen = -1; // force re-bake
      this._needsRender = true;
    }
  }

  setSoloLayer(id) {
    this._soloLayerId = id || null;
    this._packNoiseUniforms();
    this._needsRender = true;
    this._minimapDirtyAt = performance.now();
    this.minimap.requestRedraw();
  }

  /**
   * Recompile the studio/infinite height materials for the new generated stack
   * GLSL in the background, then update the LIVE materials' shader source in
   * place once the identical programs are cached (no freeze, no mesh swap).
   * Same warm-then-swap pattern as _setOctavesAsync.
   */
  async _rebuildStackMaterialsAsync() {
    const token = ++this._octToken;
    this.cb.onStatus('Compiling noise stack…', true);
    const oct = Math.round(this.params.octaves);
    const sg = this._stackGLSL;

    const warm = [
      createTerrainMaterial(this.uniforms, oct, sg),
      createWaterMaterial(this.uniforms, oct, sg),
    ];
    if (this.worldMode === 'infinite') {
      warm.push(createInfiniteTerrainMaterial(this.uniforms, oct, sg));
      warm.push(createInfiniteWaterMaterial(this.uniforms, oct, sg));
    }

    try {
      await this._compileMaterialVariants(warm);
    } catch (e) {
      console.warn('Noise stack shader compile failed', e);
    }
    if (token === this._octToken && !this._disposed) {
      // update live materials in place (programs already cached from `warm`)
      rebuildTerrainShaderSource(this.terrainMaterial, sg);
      rebuildWaterShaderSource(this.waterMaterial, sg);
      if (this._infiniteTerrainMat) rebuildTerrainShaderSource(this._infiniteTerrainMat, sg);
      if (this._infiniteWaterMat && !this.waterSystem?.ownsMaterial(this._infiniteWaterMat)) {
        rebuildWaterShaderSource(this._infiniteWaterMat, sg);
      }
      this.waterSystem?.onStackRebuilt(sg, oct);
      if (this.heightSampler) this.heightSampler.invalidate();
      this._applyUniforms();
      if (!this._compiling) this.cb.onStatus('Ready', false);
      this._minimapDirtyAt = performance.now();
      this.minimap.requestRedraw();
      this._needsRender = true;
    }
    this._matTrash.push({ mats: warm, at: performance.now() + 2000 });
  }

  // Push every parameter into uniforms; rebuild the chunk grid if the world
  // layout changed.
  applyAll({ force }) {
    this._needsRender = true;
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
        cells: this.tiles,
      });
      this.appliedChunkCount = p.chunkCount;
      this.appliedChunkSize = p.chunkSize;

      // The board, plinth and water span the whole tile assembly (= one cell
      // when there is a single tile, keeping the classic centred diorama).
      const wall = this._wallThickness();
      const uw = this._unionWidth();
      const ud = this._unionDepth();
      const c = this._unionCenter();
      // extend the water out to the flared plinth wall so it meets the dark box
      // with no gap (otherwise you see under the map through the strip between
      // the board edge and the outset wall).
      this.water.scale.set(uw + 2 * wall, 1, ud + 2 * wall);
      this.water.position.x = c.x;
      this.water.position.z = c.z;
      this._updatePlinth();
      // Keep the next circular growth ring inside the camera's framing so the
      // all-around hover target is visible and reachable before it is added.
      const circlePreviewSize = this.tileAssemblyShape === 'circle' && this.canExpandCircle()
        ? (this.diskRadiusCells + 1.5) * 2 * this.cellSize
        : 0;
      this.controls.setBoardSize(Math.max(uw, ud, circlePreviewSize), c);
      this.minimap.setBoard(Math.max(uw, ud), maxHeight);
      this.cb.onBoard(this.boardSize);

      // build() starts every chunk at the coarse base LOD; resolve per-chunk
      // LOD + culling NOW so the first rendered frame already shows the finished
      // terrain at full detail. Without this the throttled updateLOD (~150ms
      // later) causes a visible "coarse → detailed" pop when a preset loads.
      this.camera.updateMatrixWorld(true);
      this.board.updateLOD(this.camera.position);
      this.board.cull(this.camera);
      this._lastLodUpdate = performance.now();
    }

    this._applyUniforms();
    this._minimapDirtyAt = performance.now();
    this.minimap.requestRedraw();
    if (!this._bootPending) this.cb.onStatus('Ready', false);
  }

  _maxHeight() { return this.params.heightScale * 1.35 + 2; }
  _skirtDepth() { return Math.max(24, this.params.heightScale * 0.08); }
  // how far the terrain's perimeter wall flares out past the board edge (and how
  // far the plinth box is outset to cap it) — keeps the wall clear of the water.
  _wallThickness() { return Math.max(10, (this.boardSize || 0) * 0.006); }

  // Visibility for the diorama base. The circular radial wall mirrors the
  // plinth but only matters in circle mode.
  _setPlinthVisible(v) {
    this.plinth.visible = v;
    if (this.diskWall) this.diskWall.visible = v && this.tileAssemblyShape === 'circle';
  }

  _updatePlinth() {
    const size = this.boardSize;
    if (!size) return;
    const skirtDepth = this._skirtDepth();
    const sea = this.params.seaLevel;
    const topY = sea > 0.5 ? sea : 0;
    const wall = this._wallThickness();
    let geo;
    if (this.tileAssemblyShape === 'circle') {
      // Disk radius matches the terrain clip (uTileDiskRadius) so the radial
      // wall and the bottom cap line up exactly with the rendered terrain edge.
      const radius = (this.diskRadiusCells + 0.5) * this.cellSize;
      geo = buildCircularPlinthGeometry(radius, skirtDepth);
      // Enough segments that the linear wall top tracks the silhouette without
      // visible facets between mountain peaks at the perimeter.
      const seg = Math.max(96, Math.min(2048,
        Math.round((2 * Math.PI * radius) / Math.max(8, this.params.chunkSize / 16))));
      this.diskWall.geometry.dispose();
      this.diskWall.geometry = buildDiskWallGeometry(radius, seg);
    } else {
      // One diorama box per occupied cell. Shared interior walls are buried
      // between adjacent cells (DoubleSide, invisible); the outer walls cap the
      // assembly rim. Works for any (even L-shaped) layout with no edge tracking.
      const boxes = this.tiles.map((t) =>
        buildBoardPlinthGeometry(size, skirtDepth, topY, wall, this._cellWorldCenter(t.cx, t.cz))
      );
      geo = boxes.length > 1 ? mergeGeometries(boxes) : boxes[0];
      if (boxes.length > 1) for (const b of boxes) b.dispose();
    }
    this.plinth.geometry.dispose();
    this.plinth.geometry = geo;
    if (this.diskWall) this.diskWall.visible = this.plinth.visible && this.tileAssemblyShape === 'circle';
  }

  _applyUniforms() {
    this._needsRender = true;
    this._terrainGen++;   // height field may have changed — refresh collision tile
    const p = this.params;
    const u = this.uniforms;
    this._syncImportedMapUniforms();
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
    u.uEdgeFalloffMode.value = p.edgeFalloffMode === 'mountains' ? 1 : 0;
    u.uBoardHalf.value = size / 2;
    u.uChunkSize.value = p.chunkSize;
    this._applyTileUniforms();
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
    u.uPlinthBaseY.value = -this._skirtDepth();   // perimeter wall drops to plinth base
    u.uWallThickness.value = this._wallThickness();
    u.uPlanetRadius.value = p.planetRadius;
    // angular epsilon for analytic planet normals ≈ one finest-LOD quad
    u.uPlanetEps.value = 2.0 / (this._planetFaceGrid() * 64);

    // Noise Stack: pack per-layer continuous params into the shared uniform
    // arrays (live, no recompile — drives stackHeight2D / stackHeight3D).
    this._packNoiseUniforms();

    // In infinite mode, fog and sun are managed by FogManager + TimeOfDay.
    // Only apply studio fog settings when NOT in infinite mode.
    if (this.worldMode !== 'infinite') {
      if (this._skyActive()) {
        // Procedural sky is active: the shared timeOfDay owns the sun direction,
        // sky/fog colours and light. (studio Tile mode shares this with the
        // infinite world so both look identical.)
        this._applyTimeOfDay();
      } else {
        // Manual Lighting sun angles (planet, or studio with the sky disabled).
        const az = p.sunAzimuth * Math.PI / 180;
        const el = p.sunElevation * Math.PI / 180;
        u.uSunDir.value.set(
          Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)
        ).normalize();
        this.sunLight.position.copy(u.uSunDir.value).multiplyScalar(2000);
        this._applyStudioSunFromStyle();
      }

      // planet is viewed in open space — exp distance fog would swallow the
      // whole globe, so it is disabled there.
      u.uFogDensity.value = this.worldMode === 'planet' ? 0.0 : p.fogDensity * 0.0001;
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
    if (this.waterSystem) this.waterSystem.sync(p, this.worldMode);

    this.board.updateBounds(this._maxHeight(), this._skirtDepth());
    this._updatePlinth();
    this.planetStyle.applyToUniforms(u);
    this._applyStudioFogFromStyle();
    this._applyCloudSettings();   // slab altitude/scale track board height + size
    this._applySkyboxSettings();  // sky dome params + per-mode visibility
    this._applyPixelRatio();
  }

  _applyPixelRatio() {
    // base = legacy absolute override if set, otherwise device pixel ratio;
    // then scaled by the performance render scale and the auto-perf scale.
    // On a low-tier GPU, cap the ceiling lower so a 2× HiDPI panel doesn't make
    // a weak GPU render 4× the pixels.
    const legacy = this.params?.pixelRatio || 0;
    const ceiling = this.gpuTier === 'low' ? 1.25 : 2;
    const base = legacy > 0 ? legacy : Math.min(window.devicePixelRatio, ceiling);
    const scale = (this.perf?.renderScale ?? 1) * this._autoScale;
    this.renderer.setPixelRatio(Math.min(ceiling, Math.max(0.3, base * scale)));
    this._needsRender = true;   // resolution changed → force a redraw
  }

  // -------------------------------------------------- async shader compiling
  // Heavy shaders are compiled via renderer.compile + _waitForMaterialsReady so
  // the GPU driver can link off-thread (KHR_parallel_shader_compile) while ticks
  // keep running. Avoids Three.js compileAsync crashing when currentProgram is
  // still undefined during transparent DoubleSide prepare.

  async _compileMaterialVariants(mats, { canvasOnly = false, timeoutMs, stagger = false } = {}) {
    const list = mats.filter(Boolean);
    if (!list.length) return;

    if (stagger && list.length > 1) {
      for (const m of list) {
        await this._compileMaterialVariants([m], { canvasOnly, timeoutMs });
        await new Promise((r) => requestAnimationFrame(r));
      }
      return;
    }

    const group = new THREE.Group();
    for (const m of list) group.add(new THREE.Mesh(this._warmGeo, m));

    const waitOpts = timeoutMs != null ? { timeoutMs } : undefined;
    const pending = this.renderer.compile(group, this.camera, this.scene);
    await this._waitForMaterialsReady(pending, waitOpts);

    if (canvasOnly) return;

    this.underwater._ensureTarget(this.renderer);
    this.renderer.setRenderTarget(this.underwater._rt);
    const pendingRt = this.renderer.compile(group, this.camera, this.scene);
    this.renderer.setRenderTarget(null);
    await this._waitForMaterialsReady(pendingRt, waitOpts);
  }

  /**
   * Poll until compiled materials report ready. Guards against Three.js
   * compileAsync throwing when currentProgram is still undefined (common for
   * transparent DoubleSide materials mid-prepare).
   */
  _waitForMaterialsReady(materials, { timeoutMs = 45000 } = {}) {
    const pending = materials instanceof Set ? materials : new Set(materials);
    const props = this.renderer.properties;

    return new Promise((resolve) => {
      if (!pending.size) {
        resolve();
        return;
      }
      const start = performance.now();

      const check = () => {
        pending.forEach((material) => {
          const program = props.get(material)?.currentProgram;
          if (program?.isReady?.()) pending.delete(material);
        });

        if (!pending.size) {
          resolve();
          return;
        }
        if (performance.now() - start > timeoutMs) {
          console.warn(`Shader compile wait timed out (${pending.size} material(s) still pending)`);
          resolve();
          return;
        }
        requestAnimationFrame(check);
      };

      requestAnimationFrame(check);
    });
  }

  async _withStudioCloudDetached(task) {
    const mesh = this.studioCloud?.mesh;
    const parent = mesh?.parent || null;
    if (parent) parent.remove(mesh);
    try {
      return await task();
    } finally {
      if (parent && mesh && !mesh.parent) parent.add(mesh);
    }
  }

  /**
   * Compile realistic water shaders without pausing the whole app, then swap.
   * Legacy water stays visible until programs are linked.
   */
  compileWaterMaterialsAsync(materials, onSwap) {
    const mats = materials.filter(Boolean);
    if (!mats.length) {
      onSwap?.();
      return;
    }

    this.cb.onStatus('Compiling water shaders…', false);

    const run = () => {
      this._compileMaterialVariants(mats, {
        canvasOnly: true,
        timeoutMs: 20000,
        stagger: mats.length > 1,
      })
        .catch((e) => console.warn('Water shader compile failed', e))
        .finally(() => {
          if (!this._disposed) {
            onSwap?.();
            this.cb.onStatus('Ready', false);
          }
        });
    };

    // Yield two frames so the UI can paint before kicking off GPU work.
    requestAnimationFrame(() => requestAnimationFrame(run));
  }

  /** Initial warmup: everything in the studio scene + the underwater pass. */
  async _warmupInitialShaders() {
    this._compiling++;
    this.cb.onStatus('Compiling shaders…', true);
    try {
      // Boot compiles ONLY the canvas-variant programs. The underwater
      // render-target variants (a second distinct program — linear output color
      // space — for every heavy terrain/water/sky material) are deferred and
      // warmed lazily when the camera first approaches water. Most sessions
      // never submerge, so this roughly halves the cold-boot compile burst that
      // otherwise saturates Chrome's shared GPU process and stalls other tabs.
      await this._withStudioCloudDetached(async () => {
        const pending = this.renderer.compile(this.scene, this.camera);
        await this._waitForMaterialsReady(pending);
      });
    } catch (e) {
      console.warn('Shader warmup failed (falling back to sync compile)', e);
    }
    this._compiling--;
    if (!this._disposed && !this._compiling) {
      this._bootPending = false;
      this._renderInitialStudioFrame();
      this.cb.onStatus('Ready', false);
      // Surface the first-run GPU-tier notice now that the boot overlay is gone
      // (info toasts are suppressed while a blocking overlay is up).
      if (this._tierNotice) { this.cb.onToast(this._tierNotice); this._tierNotice = null; }
    }
  }

  /**
   * Lazily compile the underwater render-target program variants that were
   * deferred from boot. Runs WITHOUT bumping _compiling, so the scene keeps
   * rendering normally (the canvas programs are already linked) while the driver
   * builds the RT variants on its own threads. Kicked off when the camera nears
   * the surface so the programs are cached before the first submerged frame —
   * no dive hitch, and zero cost for sessions that never touch water.
   */
  async _warmUnderwaterShaders() {
    if (this._underwaterWarmed || this._disposed) return;
    this._underwaterWarmed = true;
    try {
      await this._withStudioCloudDetached(async () => {
        this.underwater._ensureTarget(this.renderer);
        this.renderer.setRenderTarget(this.underwater._rt);
        const pending = this.renderer.compile(this.scene, this.camera);
        this.renderer.setRenderTarget(null);
        await this._waitForMaterialsReady(pending);
      });
      const quadPending = this.renderer.compile(
        this.underwater._quadScene, this.underwater._quadCam
      );
      await this._waitForMaterialsReady(quadPending);
    } catch (e) {
      this._underwaterWarmed = false;   // allow a later retry
      console.warn('Underwater shader warmup failed', e);
    }
  }

  /** Trigger the deferred underwater compile once the camera approaches water. */
  _maybeWarmUnderwater() {
    if (this._underwaterWarmed || this._bootPending || !this.underwater?.enabled) return;
    const wl = this._waterLevel();
    if (wl == null) return;
    if (this.camera.position.y - wl < 120) this._warmUnderwaterShaders();
  }

  _renderInitialStudioFrame() {
    if (this.worldMode !== 'studio' || !this.board?.chunks?.length) return;

    this.controls.update(0.016);
    this.camera.updateMatrixWorld(true);
    this.board.updateLOD(this.camera.position);
    this.board.cull(this.camera);
    this._lastLodUpdate = performance.now();
    this.cb.onLod(
      [...this.board.lodCounts],
      this.params.chunkCount,
      this.board.visibleChunkCount,
      this.board.culledChunkCount
    );

    if (this.studioCloud) {
      this.studioCloud.update(0.016, this.camera.position, this.uniforms.uSunDir.value);
      this.studioCloud.renderDepthPrepass(this.renderer, this.camera);
    }

    this.underwater.render(this.renderer, this.scene, this.camera);
    this._lastTris = this.renderer.info.render.triangles;
    this._lastDraws = this.renderer.info.render.calls;
    this._lastRenderAt = performance.now();
    this._camPos.copy(this.camera.position);
    this._camQuat.copy(this.camera.quaternion);
    this._needsRender = false;
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
      createTerrainMaterial(this.uniforms, oct, this._stackGLSL),
      createWaterMaterial(this.uniforms, oct, this._stackGLSL),
    ];
    if (this.worldMode === 'infinite') {
      warm.push(createInfiniteTerrainMaterial(this.uniforms, oct, this._stackGLSL));
      warm.push(createInfiniteWaterMaterial(this.uniforms, oct, this._stackGLSL));
    }
    const planetMode = this.worldMode === 'planet';
    if (planetMode) {
      warm.push(createPlanetMaterial(this.uniforms, oct, this._stackGLSL));
      warm.push(createPlanetWaterMaterial(this.uniforms, oct, this._stackGLSL));
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

  setLandingShowcase(active) {
    if (this._landingShowcase === active) return;
    this._landingShowcase = active;
    if (active) {
      this._tileGhostCell = null;
      this._updateTileGhost();
    }
    if (this.worldMode !== 'studio' || !this.controls) return;
    if (active) {
      this.controls.autoOrbit = true;
      this.controls.enabled = false;
      this.controls.reset(this.boardSize);
      this._needsRender = true;
    } else {
      this.controls.autoOrbit = false;
      this.controls.enabled = true;
      this.controls.blendToDefault(this.boardSize);
      this._needsRender = true;
    }
  }

  setMinimapCanvases(baseCanvas, overlayCanvas) {
    this.minimap.setCanvases(baseCanvas, overlayCanvas);
    this._minimapDirtyAt = 0;
    this._renderMinimapBase();
  }

  setMinimapConfig(next) {
    this.minimap.setConfig(next);
    this._minimapDirtyAt = 0;
    this._renderMinimapBase();
    this._needsRender = true;
  }

  setMinimapHover(hover) {
    this.minimap.setHover(hover);
    this._needsRender = true;
  }

  getMinimapInfoAt(px, py) {
    return this.minimap.infoAtCanvas(px, py);
  }

  focusCenter() { this.controls.focusCenter(); }
  setCameraMode(mode) { this.controls.setMode(mode); }
  setCameraView(view) { this.controls.setView(view); }
  setFov(fov) {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  setTouchInput(input) {
    if (this.fpsControls) this.fpsControls.setTouchInput(input);
    if (this.player?.setTouchInput) this.player.setTouchInput(input);
  }

  // ---------------------------------------------------------------- debug
  getDebugFlags() { return { ...this._debug }; }

  setDebugFlag(key, value) {
    if (!(key in this._debug)) return;
    if (key === 'terrainDetailDebug') {
      const view = typeof value === 'string' ? value : 'off';
      const modes = { off: 0, slope: 1, rock: 2, shoreline: 3, detailFade: 4, detail: 5, albedo: 6, normal: 7 };
      this._debug.terrainDetailDebug = modes[view] == null ? 'off' : view;
      this.uniforms.uTerrainDetailDebug.value = modes[this._debug.terrainDetailDebug] ?? 0;
      this._needsRender = true;
      return;
    }
    this._debug[key] = !!value;
    this._needsRender = true;
    if (key === 'disableHeightBake') {
      // off → drop to the live field immediately; on → force a fresh bake next tick
      if (this._debug.disableHeightBake) {
        this.uniforms.uUseTerrainHeightTex.value = 0.0;
        this.uniforms.uUsePlanetHeightTex.value = 0.0;
      }
      this._bakedStudioGen = -1;
      this._bakedTerrainGen = -1;
    }
  }

  // ------------------------------------------------------------- player mode

  _getHeightSampler() {
    if (!this.heightSampler) {
      const cpu = new TerrainHeightSampler(this.uniforms, () => ({
        octaves: Math.round(this.params.octaves),
        infinite: this.worldMode === 'infinite',
      }), this.noiseStack);
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
    if (!this.waterSystem?.isEnabled()) return null;
    return this.params.seaLevel > 0.5 ? this.params.seaLevel : null;
  }

  /**
   * Toggle Player Physics Mode (gravity / walking / jumping / swimming).
   * Works in Infinite World and in Studio mode (walking on the board).
   * Free camera behavior is fully restored on disable.
   */
  setExploreMode(mode) {
    mode = mode === 'walk' || mode === 'plane' ? mode : 'none';
    if (mode !== 'none' && this.paintMode?.state.enabled) this.setPaintMode(false);
    if (mode === this.exploreMode) return;

    const prev = this.exploreMode;
    if (prev === 'walk') this._legacySetPlayerMode(false);
    else if (prev === 'plane') this._setPlaneMode(false);

    this.exploreMode = 'none';
    this.playerMode = false;

    if (mode === 'walk') {
      this._legacySetPlayerMode(true);
      this.exploreMode = 'walk';
      this.playerMode = true;
    } else if (mode === 'plane') {
      this._setPlaneMode(true);
      this.exploreMode = 'plane';
      this.playerMode = false;
    }

    if (this.cb.onExploreMode) this.cb.onExploreMode(this.exploreMode);
    if (this.cb.onPlayerMode) this.cb.onPlayerMode(this.playerMode);
  }

  setPlayerMode(enabled) {
    this.setExploreMode(enabled ? 'walk' : 'none');
  }

  _setPlaneMode(enabled) {
    if (enabled) {
      if (this.worldMode === 'studio') {
        this.controls.enabled = false;
      } else if (this.worldMode === 'infinite' && this.fpsControls) {
        this.fpsControls.dispose();
        this.fpsControls = null;
      } else if (this.worldMode === 'planet' && this.planetControls) {
        this.planetControls.dispose();
        this.planetControls = null;
      }

      this.player = new PlaneController({
        camera: this.camera,
        domElement: this.canvas,
        sampler: this.worldMode === 'planet' ? null : this._getHeightSampler(),
        planetSampler: this.worldMode === 'planet' ? this._getPlanetSampler() : null,
        config: {
          gravity: this.worldMode === 'planet' ? 28 : 32,
          spawnClearance: this.worldMode === 'planet' ? 90 : Math.max(28, this._maxHeight() * 0.08),
          terrainClearance: this.worldMode === 'planet' ? 12 : 4,
        },
      });
      this.cb.onToast('Plane mode - click to lock mouse · W throttle · S brake · A/D bank');
      return;
    }

    if (this.player) {
      this.player.dispose();
      this.player = null;
    }
    if (this.worldMode === 'studio') {
      this.controls.enabled = true;
      this.controls.reset(this.boardSize);
    } else if (this.worldMode === 'infinite' && !this.fpsControls) {
      this.fpsControls = new FPSControls(this.camera, this.canvas);
    } else if (this.worldMode === 'planet' && !this.planetControls) {
      this.planetControls = new PlanetOrbitControls(this.camera, this.canvas, this.params.planetRadius);
      this.planetControls.onFirstInteract = () => this.cb.onFirstInteract();
      this.planetControls.update(0.001);
    }
    this.cb.onToast('Free camera');
  }

  _legacySetPlayerMode(enabled) {
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
      // Near chunks are coarse (one quad spans chunkSpan / lodSegments[0] world
      // units), so the flat triangles can sit above the exact sampled point.
      // Tell the controller that quad size so it can keep the body on top of the
      // faceted mesh instead of sinking under it.
      const pw = this.planetWorld;
      const quadSize = pw ? pw.chunkSpan / (pw.lodSegments[0] || 64) : 62.5;
      this.player = new PlanetController({
        camera: this.camera,
        domElement: this.canvas,
        sampler: this._getPlanetSampler(),
        config: { groundSampleSpread: quadSize },
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
    if (enabled && this.exploreMode !== 'none') this.setExploreMode('none');
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
    this._bakedStudioGen = -1;   // paint changed the height field → refresh the bake
    this._needsRender = true;
  }

  // -------------------------------------------------------------- world mode

  setWorldMode(mode) {
    if (mode === this.worldMode) return;
    if (this.paintMode?.state.enabled) this.setPaintMode(false);
    // player physics is per-mode — always leave it cleanly before switching
    this.setExploreMode('none');

    // tear down the mode we are leaving
    const prev = this.worldMode;
    if (prev === 'infinite') this._disposeInfinite();
    else if (prev === 'planet') this._disposePlanet();

    this.worldMode = mode;
    this.uniforms.uTileDebugView.value = mode === 'studio' ? (this.tileDebug.view === 'noise' ? 1 : this.tileDebug.view === 'height' ? 2 : this.tileDebug.view === 'biome' ? 3 : 0) : 0;
    this._terrainGen++;   // uFrequency / falloff change with the mode
    // The new mode's materials need their own underwater RT-variant programs;
    // re-arm the lazy warm so they compile on first approach to water (three's
    // program cache makes the recompile instant if already built this session).
    this._underwaterWarmed = false;

    if (mode === 'infinite') this._enterInfiniteMode();
    else if (mode === 'planet') this._enterPlanetMode();
    else this._enterStudioMode();
  }

  _enterInfiniteMode() {
    // Infinite exploration stays fully procedural; Studio paint layers are
    // board-local overrides and are restored when returning to Studio mode.
    this.uniforms.uPaintEnabled.value = 0;
    this.uniforms.uUseTerrainHeightTex.value = 0.0;   // unbounded world — no fixed bake
    if (this.studioCloud) this.studioCloud.setInScene(false);

    // Hide studio objects
    this.board.group.visible = false;
    this._setPlinthVisible(false);
    this.water.visible = false;
    this._tileGhostCell = null;
    if (this._tileGhost) this._tileGhost.visible = false;

    // Compute fixed frequency matching the current tile
    const p = this.params;
    const tileFreq = (p.noiseScale * 0.1) / this.boardSize;

    // Create infinite materials (sharing the same uniform objects)
    const oct = Math.round(p.octaves);
    this._infiniteTerrainMat = createInfiniteTerrainMaterial(this.uniforms, oct, this._stackGLSL);
    this._infiniteTerrainMat.wireframe = p.wireframe;
    this._infiniteWaterMat = this.waterSystem.createInfiniteMaterial();
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

    // Procedural sky is persistent (created in _initScene + shared with the
    // studio view). Just sync its params + visibility for infinite mode.
    this._applySkyboxSettings();

    // Create fog manager
    this.fogManager = new FogManager(this.uniforms, this.scene);
    this.fogManager.setDistanceMultiplier(perf.fogDistance);
    this.fogManager.updateFromViewDistance(perf.viewRadius, p.chunkSize);

    // Apply time of day
    this._applyTimeOfDay();

    // Apply render scale + water quality uniforms to the fresh materials
    this._applyPixelRatio();
    this._applyTerrainDetailPerf();
    this._applyWaterPerf();

    this.waterSystem.sync(p, 'infinite');

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
    // warm clones (not the live materials) so mode exits mid-compile are safe.
    // Canvas-variant only — the underwater render-target variants are deferred
    // and warmed lazily on first approach to water (see _warmUnderwaterShaders),
    // halving the compile burst that otherwise stalls other tabs on mode switch.
    const warm = [
      createInfiniteTerrainMaterial(this.uniforms, oct),
      createInfiniteWaterMaterial(this.uniforms, oct),
    ];
    try {
      await this._compileMaterialVariants(warm, { canvasOnly: true });
      // sky dome material (already in the scene) — canvas variant only
      await this._withStudioCloudDetached(async () => {
        const pending = this.renderer.compile(this.scene, this.camera);
        await this._waitForMaterialsReady(pending);
      });
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
    // proceduralSky is persistent (shared with studio) — do not dispose here.
    if (this.proceduralSky) this.proceduralSky.setVisible(false);
    this.fogManager = null;
    if (this._infiniteTerrainMat) {
      this._infiniteTerrainMat.dispose();
      this._infiniteTerrainMat = null;
    }
    if (this._infiniteWaterMat && !this.waterSystem?.ownsMaterial(this._infiniteWaterMat)) {
      this._infiniteWaterMat.dispose();
    }
    this._infiniteWaterMat = null;
  }

  /** Restore the single-board studio scene + editor camera. */
  _enterStudioMode() {
    this.board.group.visible = true;
    this._setPlinthVisible(true);
    this.water.visible = this.waterSystem?.isEnabled() && this.params.seaLevel > 0.5;
    if (this.studioCloud) {
      this.studioCloud.setInScene(true);
      this._applyCloudSettings();
    }

    this._applyUniforms();
    this.uniforms.uPaintEnabled.value = 1;
    this._rebuildStackMaterialsAsync();

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
    this._renderMinimapBase();

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
      () => createPlanetMaterial(this.uniforms, oct, this._stackGLSL),
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
    this.planetWorld.cullingEnabled = this.cullingEnabled;

    // water shell: a sphere at radius (planetRadius + seaLevel); the shader
    // discards over land so only basins fill. One mesh, one shared material.
    this.planetWaterMat = createPlanetWaterMaterial(this.uniforms, oct, this._stackGLSL);
    this.planetWaterMat.uniforms.uWaterAnim.value = p.waterAnim ? 1 : 0;
    this.planetWater = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), this.planetWaterMat);
    this.planetWater.frustumCulled = false;
    this.planetWater.renderOrder = 10;
    this._updatePlanetWater();
    this.scene.add(this.planetWater);
    this._applyWaterPerf();
  }

  /**
   * Ensure the planet height/normal cubemap is baked and current. Re-bakes only
   * when the terrain generation counter has advanced (seed / shape / biome
   * edits), so a steady camera costs nothing. Until the first bake completes,
   * uUsePlanetHeightTex stays 0 and the shaders fall back to the live field.
   */
  _ensurePlanetHeightTex() {
    if (this.worldMode !== 'planet') return;
    if (this._debug.disableHeightBake) {
      this.uniforms.uUsePlanetHeightTex.value = 0.0;
      return;
    }
    if (!this.planetHeightBaker) {
      this.planetHeightBaker = new PlanetHeightBaker({
        renderer: this.renderer,
        uniforms: this.uniforms,
        size: 1024,
      });
      this._bakedTerrainGen = -1;
    }
    if (this._bakedTerrainGen === this._terrainGen) return;
    this.planetHeightBaker.bake(Math.round(this.params.octaves), this._stackGLSL);
    this.uniforms.uPlanetHeightTex.value = this.planetHeightBaker.texture;
    this.uniforms.uUsePlanetHeightTex.value = 1.0;
    this._bakedTerrainGen = this._terrainGen;
  }

  /**
   * Ensure the studio height/normal texture is baked and current. Re-bakes only
   * when the terrain generation counter has advanced (seed / shape / biome
   * edits), so a steady camera costs nothing. While painting, the height field
   * changes continuously — sample the live field and refresh the bake once the
   * stroke ends. Until the first bake completes, uUseTerrainHeightTex stays 0
   * and the shaders fall back to the live field.
   */
  _ensureTerrainHeightTex() {
    if (this.worldMode !== 'studio') return;
    if (this._debug.disableHeightBake) {   // debug: force the live per-pixel field
      this.uniforms.uUseTerrainHeightTex.value = 0.0;
      return;
    }
    if (this.paintState?.enabled) {
      this.uniforms.uUseTerrainHeightTex.value = 0.0;
      this._paintWasEnabled = true;
      return;
    }
    if (this._paintWasEnabled) {      // just left paint mode — capture the edits
      this._bakedStudioGen = -1;
      this._paintWasEnabled = false;
    }
    if (!this.terrainHeightBaker) {
      this.terrainHeightBaker = new TerrainHeightBaker({
        renderer: this.renderer,
        uniforms: this.uniforms,
      });
      this._bakedStudioGen = -1;
    }
    const layoutKey = this._studioBakeLayoutKey();
    if (this._bakedStudioGen === this._terrainGen && this._bakedStudioLayout === layoutKey) return;
    const b = this._tileBounds();
    const _t0 = performance.now();
    this.terrainHeightBaker.bake(
      Math.round(this.params.octaves), this._stackGLSL, b.cols, b.rows
    );
    this.profiler.setMetric('lastBakeMs', performance.now() - _t0);
    this.uniforms.uTerrainHeightTex.value = this.terrainHeightBaker.texture;
    this.uniforms.uUseTerrainHeightTex.value = 1.0;
    this._bakedStudioGen = this._terrainGen;
    this._bakedStudioLayout = layoutKey;
  }

  _enterPlanetMode() {
    const p = this.params;
    // planet is fully procedural — Studio paint layers don't apply
    this.uniforms.uPaintEnabled.value = 0;
    this.uniforms.uUseTerrainHeightTex.value = 0.0;   // studio-only bake
    if (this.studioCloud) this.studioCloud.setInScene(false);

    // hide studio objects + sleep the editor camera
    this.board.group.visible = false;
    this._setPlinthVisible(false);
    this.water.visible = false;
    this._tileGhostCell = null;
    if (this._tileGhost) this._tileGhost.visible = false;
    this.controls.enabled = false;

    // refresh shared uniforms (radius, frequency, sun, fog-off for planet)
    this._applyUniforms();

    this._buildPlanetWorld();

    // volumetric cloud shell (seamless single-mesh by default; chunked is opt-in)
    if (p.cloudChunksEnabled === true) {
      this.planetCloudChunks = new PlanetCloudChunks(this.scene, {
        planetRadius: this._planetRadius(),
        faceGrid: 4,
        compile: (mats) => this._compileMaterialVariants(mats, { canvasOnly: true }),
      });
      this.planetCloudChunks.warmup()
        .catch((e) => console.warn('Cloud shader warmup failed', e));
    } else {
      this.planetCloudLayer = new PlanetCloudLayer(this.scene, {
        planetRadius: this._planetRadius(),
        compile: (mats) => this._compileMaterialVariants(mats, { canvasOnly: true }),
      });
      this.planetCloudLayer.warmup()
        .catch((e) => console.warn('Cloud shader warmup failed', e));
    }
    this._applyCloudSettings();

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
    if (this.worldMode === 'planet') {
      const wantChunks = this.params.cloudChunksEnabled === true;
      if (wantChunks && !this.planetCloudChunks) {
        if (this.planetCloudLayer) {
          this.planetCloudLayer.dispose();
          this.planetCloudLayer = null;
        }
        this.planetCloudChunks = new PlanetCloudChunks(this.scene, {
          planetRadius: this._planetRadius(),
          faceGrid: 4,
          compile: (mats) => this._compileMaterialVariants(mats, { canvasOnly: true }),
        });
        this.planetCloudChunks.warmup()
          .catch((e) => console.warn('Cloud shader warmup failed', e));
      } else if (!wantChunks && !this.planetCloudLayer) {
        if (this.planetCloudChunks) {
          this.planetCloudChunks.dispose();
          this.planetCloudChunks = null;
        }
        this.planetCloudLayer = new PlanetCloudLayer(this.scene, {
          planetRadius: this._planetRadius(),
          compile: (mats) => this._compileMaterialVariants(mats, { canvasOnly: true }),
        });
        this.planetCloudLayer.warmup()
          .catch((e) => console.warn('Cloud shader warmup failed', e));
      }
    }

    if (this.planetCloudChunks) {
      this.planetCloudChunks.applyParams(this.params, this._planetRadius(), this.perf);
    }
    if (this.planetCloudLayer) {
      this.planetCloudLayer.applyParams(this.params, this._planetRadius(), this.perf);
    }
    if (this.studioCloud) {
      // Cover the whole tile assembly (union of cells), not just the origin cell.
      this.studioCloud.applyParams(this.params, this._maxHeight(), this.boardSize, this.perf, {
        extent: Math.max(this._unionWidth(), this._unionDepth()),
        center: this._unionCenter(),
      });
    }
  }

  /** Rebuild the planet for a radius / face-grid change (settings panel). */
  _rebuildPlanet() {
    if (this.worldMode !== 'planet') return;
    this._needsRender = true;
    this._applyUniforms();      // radius/grid uniforms must match the rebuilt mesh immediately
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
      c.update(0.001);
    }
  }

  _getPropsTerrainSampler() {
    if (!this.propsTerrainSampler) {
      const cpu = new TerrainHeightSampler(this.uniforms, () => ({
        octaves: Math.round(this.params.octaves),
        infinite: this.worldMode === 'infinite',
      }), this.noiseStack);
      const heightAt = (x, z) => {
        const base = cpu.heightAt(x, z);
        if (this.worldMode !== 'studio') return base;
        return base + (this.paintMode?.layers?.sampleHeightOffset(x, z) ?? 0) * (this.paintMode?.state?.layerOpacity ?? 1);
      };
      this.propsTerrainSampler = {
        heightAt,
        normalAt: (x, z, eps = 2) => {
          const hL = heightAt(x - eps, z);
          const hR = heightAt(x + eps, z);
          const hD = heightAt(x, z - eps);
          const hU = heightAt(x, z + eps);
          const nx = hL - hR, ny = 2 * eps, nz = hD - hU;
          const len = Math.hypot(nx, ny, nz) || 1;
          return { x: nx / len, y: ny / len, z: nz / len };
        },
      };
    }
    return this.propsTerrainSampler;
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
      createPlanetMaterial(this.uniforms, oct, this._stackGLSL),
      createPlanetWaterMaterial(this.uniforms, oct, this._stackGLSL),
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
    if (this.planetCloudChunks) { this.planetCloudChunks.dispose(); this.planetCloudChunks = null; }
    if (this.planetCloudLayer) { this.planetCloudLayer.dispose(); this.planetCloudLayer = null; }
    if (this.planetHeightBaker) { this.planetHeightBaker.dispose(); this.planetHeightBaker = null; }
    // reset the shared cubemap uniforms so studio/infinite never sample a stale
    // (or disposed) planet texture
    this.uniforms.uPlanetHeightTex.value = null;
    this.uniforms.uUsePlanetHeightTex.value = 0.0;
    this._bakedTerrainGen = -1;
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
    // meta toggles that don't change visual quality keep the current preset
    const keepsPreset = key === 'autoPerf'
      || key === 'underwaterEffect'
      || key === 'onDemandStudio'
      || key === 'rendererBackend'
      || key === 'gpuPreference';
    if (!keepsPreset) next.preset = 'custom';
    this.perf = sanitizePerfSettings(next);
    if (key === 'rendererBackend' || key === 'gpuPreference') {
      const cfg = this.rendererConfig || {};
      this.rendererConfig = {
        ...cfg,
        requestedBackend: this.perf.rendererBackend,
        requestedBackendLabel: labelRendererBackend(this.perf.rendererBackend),
        requestedGpuPreference: this.perf.gpuPreference,
        requestedGpuPreferenceLabel: labelGpuPreference(this.perf.gpuPreference),
        reloadRequired: this.perf.rendererBackend !== cfg.appliedRendererBackend
          || this.perf.gpuPreference !== cfg.appliedGpuPreference,
      };
    }
    if (key === 'autoPerf' && !this.perf.autoPerf) {
      this._autoScale = 1.0;   // leaving auto mode restores full render scale
    }
    this.qualityPreset = this.perf.preset;
    this._applyPerformance();
    this._notifyPerf();
  }

  /**
   * Set cloud quality by named tier (low/medium/high/ultra) from the Clouds
   * panel. Writes the underlying raymarch step keys into `perf` (the single
   * source of truth) so the Performance tab and Clouds panel always agree.
   */
  setCloudQuality(key) {
    const preset = CLOUD_QUALITY_PRESETS[key];
    if (!preset) return;
    const next = {
      ...this.perf,
      cloudSteps: preset.steps,
      cloudLightSteps: preset.lightSteps,
      cloudOctaves: preset.octaves,
      cloudDetailOctaves: preset.detailOctaves,
      cloudUseErosion: preset.useErosion,
      preset: 'custom',
    };
    this.perf = sanitizePerfSettings(next);
    this.qualityPreset = this.perf.preset;
    this._applyPerformance();
    this._notifyPerf();
  }

  /** Reset all performance settings to the default High preset. */
  resetPerfSettings() {
    this.perf = createPerfSettings('high');
    this.qualityPreset = this.perf.preset;
    this._autoScale = 1.0;
    if (this.rendererConfig) {
      this.rendererConfig = {
        ...this.rendererConfig,
        requestedBackend: this.perf.rendererBackend,
        requestedBackendLabel: labelRendererBackend(this.perf.rendererBackend),
        requestedGpuPreference: this.perf.gpuPreference,
        requestedGpuPreferenceLabel: labelGpuPreference(this.perf.gpuPreference),
        reloadRequired: this.perf.rendererBackend !== this.rendererConfig.appliedRendererBackend
          || this.perf.gpuPreference !== this.rendererConfig.appliedGpuPreference,
      };
    }
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
    this._applyTerrainDetailPerf();
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
  _applyTerrainDetailPerf() {
    const s = this.perf;
    const u = this.uniforms;
    if (!u?.uTerrainDetailQuality) return;
    u.uTerrainDetailQuality.value = s.terrainDetailQuality ?? 3;
    u.uTerrainDetailScale.value = s.terrainDetailScale ?? 0.16;
    u.uTerrainDetailStrength.value = s.terrainDetailStrength ?? 0.72;
    u.uTerrainDetailNormalStrength.value = s.terrainDetailNormal ?? 0.42;
    u.uTerrainDetailNear.value = s.terrainDetailNear ?? 80;
    u.uTerrainDetailFar.value = Math.max((s.terrainDetailFar ?? 190), (s.terrainDetailNear ?? 80) + 1);
    u.uTerrainRockSlope.value = s.terrainRockSlope ?? 0.28;
    u.uTerrainRockSharpness.value = s.terrainRockSharpness ?? 0.14;
    u.uTerrainTriplanar.value = s.terrainTriplanar === false ? 0.0 : 1.0;
    u.uTerrainShoreRange.value = s.terrainShoreRange ?? 18;
    u.uTerrainShoreWetness.value = s.terrainShoreWetness ?? 0.35;
    this._needsRender = true;
  }

  _applyWaterPerf() {
    this.waterSystem?.applyPerf(this.perf);
    const s = this.perf;
    for (const mat of [this.waterMaterial, this._infiniteWaterMat, this.planetWaterMat]) {
      if (!mat || this.waterSystem?.ownsMaterial(mat)) continue;
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
    // timeOfDay drives the sky in infinite world (always) and in studio (Tile)
    // whenever the procedural sky is the active driver. Planet keeps its manual
    // Lighting sun angles, so it ignores the time slider.
    if (this.worldMode === 'infinite' || this._skyActive()) {
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
    if (this.planetWorld) {
      this.planetWorld.cullingEnabled = enabled;
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
   * True when the procedural sky dome is the active sky driver. In that state
   * the shared `timeOfDay` owns the sky colours, sun direction and fog colour
   * in BOTH studio (Tile) and infinite world. Planet mode is excluded — it uses
   * its own open-space backdrop + the manual Lighting sun angles.
   */
  _skyActive() {
    return this.worldMode !== 'planet' && this.params.skyboxEnabled !== false;
  }

  /**
   * Sync the skybox appearance params + dome visibility for the current mode.
   * Pure uniform/visibility updates — never rebuilds or recompiles.
   */
  _applySkyboxSettings() {
    if (!this.proceduralSky) return;
    this.proceduralSky.applyParams(this.params);
    this.proceduralSky.setVisible(this._skyActive());
    this._needsRender = true;
  }

  /**
   * Apply time-of-day to sky, fog, and lighting. Shared by studio (Tile) and
   * infinite world so both modes stay in lock-step with the single timeOfDay
   * value. In studio there is no FogManager, so the terrain fog colour is set
   * directly from the time-of-day palette.
   */
  _applyTimeOfDay() {
    const tod = evaluateTimeOfDay(this.timeOfDay);

    // Update sky dome + sun direction (shared with terrain via uSunDir)
    if (this.proceduralSky) {
      this.proceduralSky.updateFromTimeOfDay(tod);

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

    // Update fog: infinite uses the FogManager; studio sets the fog colour
    // uniform directly from the time-of-day palette.
    if (this.fogManager) {
      this.fogManager.updateFromTimeOfDay(tod);
    } else {
      this.uniforms.uFogColor.value.setRGB(tod.fogColor[0], tod.fogColor[1], tod.fogColor[2]);
    }

    // Update directional sun light intensity and color
    this.sunLight.intensity = tod.lightIntensity;
    this.sunLight.color.setRGB(tod.sunColor[0], tod.sunColor[1], tod.sunColor[2]);
    this._needsRender = true;
  }

  // ------------------------------------------------------------- save/load

  saveSeed() {
    this._syncPlanetStyleToParams();
    const data = {
      app: 'terrain-studio',
      version: 1,
      savedAt: new Date().toISOString(),
      params: this.params,
      tiles: this.tiles.map((t) => ({ ...t })),
      tileAssemblyShape: this.tileAssemblyShape,
      diskRadiusCells: this.circleRadiusCells,
    };
    // Only embed paint pixel data when something was actually painted —
    // serialize() returns null for an untouched canvas, which would otherwise
    // bloat the file with ~3M neutral values.
    const paint = this.paintMode?.serialize();
    if (paint) data.paint = paint;
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
    if (!('waterMode' in src)) {
      if (next.seaLevel <= 0.5) {
        next.waterMode = 'off';
        next.waterEnabled = false;
      } else {
        next.waterMode = 'legacy';
        next.waterEnabled = true;
      }
    }
    this.params = next;
    this._migrateLegacyCloudPerf(src);
    if (src.planetStyle) this.planetStyle.importJSON({ planetStyle: src.planetStyle });
    else if (src.planetPreset) this.planetStyle.applyPlanetPreset(src.planetPreset);
    this._syncPlanetStyleToParams();
    // restore the tile assembly (old saves with no tiles -> single origin tile)
    this.tileAssemblyShape = json?.tileAssemblyShape === 'circle' ? 'circle' : 'square';
    this.circleRadiusCells = this.tileAssemblyShape === 'circle'
      ? Math.max(0, Math.min(this.tileGridExtent,
        Number.isFinite(Number(json?.diskRadiusCells))
          ? Math.round(Number(json.diskRadiusCells))
          : this._circleRadiusForTiles(json?.tiles)))
      : 0;
    this.tiles = this.tileAssemblyShape === 'circle'
      ? this._circleTiles(this.circleRadiusCells)
      : this._sanitizeTiles(json?.tiles);
    this.cb.onParams({ ...this.params });
    this.applyAll({ force: true });
    const c = this._unionCenter();
    this.controls.goalTarget.set(c.x, 0, c.z);
    this._notifyTiles();
    if (json?.paint) this.paintMode?.load(json.paint);
    this.cb.onToast(`Loaded seed ${this.params.seed}`);
  }

  // ------------------------------------------------------- undo / redo state
  // The App keeps a history stack of these snapshots and calls restoreState()
  // on Ctrl+Z / Ctrl+Y. A snapshot captures every editable project setting
  // (params, planet style, noise stack, performance, time-of-day, debug
  // inspection toggles and paint layers) plus the current world mode. Imported
  // image maps (heavy pixel data) and pure view state (camera) are excluded.

  // Lightweight snapshot: every editable setting, but NO paint pixel data — the
  // paint canvas is megabytes, so we record only a `paintRev` marker here and
  // let the App fetch the heavy blob via serializePaint() once per revision.
  serializeState() {
    this._syncPlanetStyleToParams();
    return {
      params: JSON.parse(JSON.stringify(this.params)),
      perf: { ...this.perf },
      timeOfDay: this.timeOfDay,
      worldMode: this.worldMode,
      tileDebug: { ...this.tileDebug },
      debug: { ...this._debug },
      cullingEnabled: this.board?.cullingEnabled !== false,
      behindCameraCulling: this.board?.behindCameraCulling !== false,
      paintRev: this.paintMode?.layers?.revision ?? 0,
      tiles: this.tiles.map((t) => ({ ...t })),
      tileAssemblyShape: this.tileAssemblyShape,
      diskRadiusCells: this.circleRadiusCells,
    };
  }

  /** Heavy paint-layer blob (height/biome/props pixel arrays) for undo history. */
  serializePaint() {
    return this.paintMode?.serialize() ?? null;
  }

  /**
   * Restore a snapshot produced by serializeState(). The caller is responsible
   * for switching world mode first when snap.worldMode differs (that path is
   * heavy + async and already wrapped in a loading overlay by the App). This
   * re-applies all params, planet style, performance, noise stack, debug
   * toggles and paint, then fires the React mirror callbacks so the panels
   * reflect the restored values.
   */
  restoreState(snap) {
    if (!snap || !snap.params) return;

    // params: full replacement, but keep any newer default keys the snapshot
    // predates so we never end up with undefined settings.
    this.params = { ...DEFAULT_PARAMS, ...snap.params };

    // planet style lives nested in params — re-import so the style manager and
    // its uniforms match the restored palette/tuning exactly.
    if (snap.params.planetStyle) {
      this.planetStyle.importJSON({ planetStyle: snap.params.planetStyle });
    }
    this._syncPlanetStyleToParams();

    if (snap.perf) {
      this.perf = sanitizePerfSettings({ ...snap.perf });
      this.qualityPreset = this.perf.preset;
    }
    if (snap.debug) this._debug = { ...this._debug, ...snap.debug };
    if (snap.tileDebug) this.tileDebug = { ...this.tileDebug, ...snap.tileDebug };

    // tile assembly (so the board rebuild below lays out the right cells)
    this.tileAssemblyShape = snap.tileAssemblyShape === 'circle' ? 'circle' : 'square';
    this.circleRadiusCells = this.tileAssemblyShape === 'circle'
      ? Math.max(0, Math.min(this.tileGridExtent,
        Number.isFinite(Number(snap.diskRadiusCells))
          ? Math.round(Number(snap.diskRadiusCells))
          : this._circleRadiusForTiles(snap.tiles)))
      : 0;
    this.tiles = this.tileAssemblyShape === 'circle'
      ? this._circleTiles(this.circleRadiusCells)
      : this._sanitizeTiles(snap.tiles);

    // push params → uniforms and rebuild board geometry (chunk layout may differ)
    this.cb.onParams(this._paramsSnapshot());
    this.applyAll({ force: true });
    const uc = this._unionCenter();
    this.controls.goalTarget.set(uc.x, 0, uc.z);
    this._notifyTiles();
    this._applyPerformance();
    this._notifyPerf();

    // noise stack: structural edits recompile in the background, continuous
    // edits just repack uniforms (setNoiseStack handles both + fires onParams).
    this.setNoiseStack(migrateStack(snap.params.noiseStack));

    // global culling toggles live on the board / world objects, not in params.
    this.setCullingEnabled(snap.cullingEnabled !== false);
    this.setBehindCameraCulling(snap.behindCameraCulling !== false);

    // re-derive the tile-debug view uniform + notify the Debug panel.
    this.setTileDebug({});
    this.setDebugFlag('terrainDetailDebug', this._debug.terrainDetailDebug ?? 'off');

    // time of day (fires onTimeOfDayChange → React sync).
    this.setTimeOfDay(snap.timeOfDay ?? this.timeOfDay);

    // paint layers (board-local height/biome/props overrides). The App injects
    // the heavy blob into snap.paint before calling; a null blob means the
    // restored state had no paint, so wipe the live layers (silent — no toast).
    if (this.paintMode) {
      if (snap.paint) this.paintMode.load(snap.paint);
      else this.paintMode.layers.clear();
    }

    this._needsRender = true;
  }

  /**
   * Cloud quality/perf knobs used to live in `params` and serialize with the
   * save. They now live in `perf`. Port any legacy keys from an old save into
   * the current perf settings once (preset → custom), then they're ignored.
   */
  _migrateLegacyCloudPerf(src) {
    if (!src || !CLOUD_LEGACY_PERF_KEYS.some((k) => k in src)) return;
    const next = { ...this.perf };
    if ('cloudSelfShadow' in src) next.cloudSelfShadow = !!src.cloudSelfShadow;
    if ('cloudMaxDistance' in src) next.cloudMaxDistance = +src.cloudMaxDistance;
    if ('cloudFallback' in src) next.cloudFallback = src.cloudFallback;
    if ('cloudQuality' in src && CLOUD_QUALITY_PRESETS[src.cloudQuality]) {
      const p = CLOUD_QUALITY_PRESETS[src.cloudQuality];
      next.cloudSteps = p.steps;
      next.cloudLightSteps = p.lightSteps;
      next.cloudOctaves = p.octaves;
      next.cloudDetailOctaves = p.detailOctaves;
      next.cloudUseErosion = p.useErosion;
    }
    next.preset = 'custom';
    this.perf = sanitizePerfSettings(next);
    this.qualityPreset = this.perf.preset;
    this._applyPerformance();
    this._notifyPerf();
  }

  applyWaterPreset(presetKey) {
    this.params = this.waterSystem.applyPreset(presetKey);
    this.cb.onParams({ ...this.params });
    this._afterParamChange(false);
    this.cb.onToast(`Water preset: ${presetKey}`);
  }

  resetWaterSettings() {
    this.params = resetWaterParams(this.params);
    for (const key of ['deep', 'shallow', 'foam']) {
      this.planetStyle.setPaletteColor(key, [...EARTH_PALETTE[key]]);
    }
    this._syncPlanetStyleToParams();
    this.cb.onParams({ ...this.params });
    this._afterParamChange(false);
    this.cb.onToast('Water settings reset');
  }

  resetPanelSettings(panelId) {
    const toast = (msg) => this.cb.onToast(msg);
    switch (panelId) {
      case 'terrain': {
        const keepSeed = this.params.seed;
        this.params = patchParamsFromDefaults(this.params, TERRAIN_RESET_KEYS);
        this.params.seed = keepSeed;
        this.params.preset = 'highlands';
        const { params: noisePatch } = this.planetStyle.applyNoisePreset('default');
        this.params.noisePreset = 'default';
        for (const [k, v] of Object.entries(noisePatch)) this.params[k] = v;
        this._syncPlanetStyleToParams();
        this.cb.onParams({ ...this.params });
        this._afterParamChange(true);
        toast('Terrain settings reset');
        break;
      }
      case 'noiseLayers':
        this.setNoiseStack(defaultLegacyStack());
        toast('Noise layers reset');
        break;
      case 'biomes': {
        this.params = patchParamsFromDefaults(this.params, BIOME_RESET_KEYS);
        this.cb.onParams({ ...this.params });
        this._afterParamChange(false);
        toast('Biome settings reset');
        break;
      }
      case 'water':
        this.resetWaterSettings();
        break;
      case 'props': {
        this.params = patchParamsFromDefaults(this.params, PROPS_RESET_KEYS);
        this.cb.onParams({ ...this.params });
        this._afterParamChange(false);
        toast('Props settings reset');
        break;
      }
      case 'clouds': {
        this.params = resetCloudParams(this.params);
        this.cb.onParams({ ...this.params });
        this._afterParamChange(false);
        toast('Cloud settings reset');
        break;
      }
      case 'skybox': {
        this.params = resetSkyboxParams(this.params);
        this.setTimeOfDay(DEFAULT_TIME_OF_DAY);
        this.cb.onParams({ ...this.params });
        this._afterParamChange(false);
        toast('Skybox settings reset');
        break;
      }
      case 'lighting': {
        this.params = patchParamsFromDefaults(this.params, LIGHTING_PARAM_KEYS);
        for (const [key, val] of Object.entries(lightingStyleDefaults())) {
          this.setPlanetStyleTuning(key, val);
        }
        this._syncPlanetStyleToParams();
        this.cb.onParams({ ...this.params });
        this._afterParamChange(false);
        toast('Lighting settings reset');
        break;
      }
      case 'planet':
        this.applyPlanetPresetByKey('earth');
        toast('Planet style reset');
        break;
      case 'world': {
        this.params = patchParamsFromDefaults(this.params, WORLD_RESET_KEYS);
        this.cb.onParams({ ...this.params });
        this._afterParamChange(true);
        toast('World settings reset');
        break;
      }
      case 'performance':
        this.resetPerfSettings();
        break;
      case 'debug': {
        this.params = patchParamsFromDefaults(this.params, DEBUG_PARAM_KEYS);
        this._debug = { ...DEFAULT_DEBUG_FLAGS };
        this.uniforms.uTerrainDetailDebug.value = 0.0;
        this.cb.onParams({ ...this.params });
        this._afterParamChange(false);
        if (this.cb.onDebugReset) this.cb.onDebugReset();
        toast('Debug settings reset');
        break;
      }
      default:
        break;
    }
  }

  exportWaterMasks(options) {
    const files = this.waterSystem.exportMasks(options);
    if (files.length) this.cb.onToast(`Exported: ${files.join(', ')}`);
    else this.cb.onToast('No water masks exported');
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
    this._setPlinthVisible(false);

    this.renderer.setRenderTarget(rt);
    this.renderer.render(this.scene, cam);
    const pixels = new Uint8Array(SIZE * SIZE * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, SIZE, SIZE, pixels);
    this.renderer.setRenderTarget(null);

    this.uniforms.uColorMode.value = 0;
    this.water.visible = waterWasVisible;
    this._setPlinthVisible(true);
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
    this._exporting = true;
    const _exportTask = this.profiler.registerLoadingTask({
      name: `Export GLB (${this.worldMode})`, details: 'preparing mesh',
    });
    const onMsg = (msg) => {
      this.cb.onStatus(msg, true);
      this.cb.onToast(msg);
      this.profiler.updateLoadingTask(_exportTask, null, msg);
    };
    try {
      if (options.exportWaterMask || options.exportDepthMap || options.exportShorelineMask || options.exportFoamMask) {
        this.exportWaterMasks({ ...options, maskRes: options.maskRes ?? options.meshRes ?? '512' });
      }
      if (this.worldMode === 'planet') {
        // export the full cube-sphere planet mesh
        await PlanetExporter.export(this.renderer, this.params, this.uniforms, options, onMsg);
      } else {
        await TerrainExporter.export(
          this.renderer, this.params, this.uniforms, this.boardSize,
          { ...options, tiles: this.tiles.map((t) => ({ ...t })), tileAssemblyShape: this.tileAssemblyShape, diskRadiusCells: this.diskRadiusCells, cellSize: this.cellSize }, onMsg, this._stackGLSL
        );
      }
    } catch (e) {
      console.error(e);
      this.cb.onToast('Export failed: ' + e.message);
      this.profiler.failLoadingTask(_exportTask, e);
    } finally {
      this._exporting = false;
      this.profiler.finishLoadingTask(_exportTask);
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
    this._needsRender = true;   // viewport size changed → redraw
  }

  _tick() {
    // Tab not visible: most browsers pause rAF, but some throttle it to ~1 Hz
    // instead. Skip all work in that case (and don't advance the clock) so a
    // backgrounded tab costs nothing; the next visible frame resumes cleanly.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

    // A thrown error inside the animation loop would otherwise permanently
    // freeze the app (the rAF callback stops being scheduled). Guard the whole
    // frame so a single bad frame degrades to a logged warning and recovers.
    try {
      this._tickBody();
    } catch (e) {
      if (!this._tickErrorLogged) {
        console.error('Render tick error (recovering)', e);
        this._tickErrorLogged = true;
      }
    }
  }

  _tickBody() {
    const dt = Math.min(this._clock.getDelta(), 0.05);
    const now = performance.now();
    this.profiler.beginFrame(now);
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
      this.profiler.setMetric('sceneState', 'compiling');
      this.profiler.endFrame();
      return;
    }

    // underwater activation is smoothed inside the effect (no flicker at the
    // surface); inactive when there is no water — works in studio + infinite.
    // Planet has its own ocean shell and a curved "up", so the screen-space
    // underwater pass does not apply there (waterLevel stays null → inactive).
    const waterLevel = (this.worldMode !== 'planet' && this.waterSystem?.isEnabled())
      ? this.params.seaLevel : null;
    this.underwater.update(
      dt, this.uniforms.uTime.value, this.camera.position.y, waterLevel, this.uniforms
    );

    this.waterSystem?.update(this._fps);

    this.paintMode?.update(dt);
    this.propsManager?.update({
      mode: this.worldMode,
      camera: this.camera,
      params: this.params,
      boardSize: this.boardSize,
      heightSampler: this._getPropsTerrainSampler(),
      planetSampler: this.worldMode === 'planet' ? this._getPlanetSampler() : null,
      paintLayers: this.worldMode === 'studio' ? this.paintMode?.layers : null,
    });

    if (this.worldMode === 'infinite') {
      this._tickInfinite(dt, now);
    } else if (this.worldMode === 'planet') {
      this._tickPlanet(dt, now);
    } else {
      this._tickStudio(dt, now);
    }

    this._autoPerfTick(now);
    this.profiler.captureRenderer(this.renderer);
    this.profiler.endFrame();
  }

  _tickStudio(dt, now) {
    // Input always runs (so inertia/look settle even when we skip drawing).
    if (this.exploreMode === 'walk' && this.player) {
      this.fpsControls.update(dt);   // mouse look
      this.player.update(dt);        // body physics
    } else if (this.exploreMode === 'plane' && this.player) {
      this.player.update(dt);
    } else {
      this.controls.update(dt);
    }

    // FPS accounting runs every tick regardless of whether we draw.
    this._frames++;
    if (now - this._fpsTime >= 1000) {
      this._fps = this._frames;
      this._frames = 0;
      this._fpsTime = now;
    }

    // ---- on-demand gate: should we actually draw this frame? ----
    // Render when anything is animating, the camera moved, a redraw was
    // requested (param/LOD/resolution change), or the minimap needs a refresh.
    const cam = this.camera;
    const moved = this._camPos.distanceToSquared(cam.position) > 1e-7
      || this._camQuat.angleTo(cam.quaternion) > 1e-5;
    const animating =
      (this.params.cloudsEnabled && !!this.studioCloud) ||
      (this.water.visible && this.params.waterAnim) ||
      this.underwater.active ||
      this.exploreMode !== 'none' ||
      !!this.paintState?.enabled ||
      this.board._lodRebuildQueue.length > 0;
    const minimapDirty = this.minimap._dirty && now - this._minimapDirtyAt > 280;
    // Heartbeat safety net: redraw at least ~1 Hz so any state change that
    // forgot to invalidate self-heals within a second (cheap insurance).
    const heartbeat = now - this._lastRenderAt > 1000;
    const shouldRender = !this.perf.onDemandStudio || this._debug.forceRender
      || this._landingShowcase || this.controls.isSettling
      || this._needsRender || moved || animating || minimapDirty || heartbeat;

    if (shouldRender) {
      this._needsRender = false;
      this._lastRenderAt = now;
      this._camPos.copy(cam.position);
      this._camQuat.copy(cam.quaternion);

      if (this.studioCloud) {
        this.profiler.begin('clouds');
        this.studioCloud.update(dt, this.camera.position, this.uniforms.uSunDir.value);
        this.profiler.end('clouds');
      }

      // Cull invisible chunks based on current camera frustum and facing
      // (Debug "Freeze Culling" holds the last computed visibility so you can
      // fly the camera out and inspect the frozen frustum from outside).
      this.camera.updateMatrixWorld(true);
      this.profiler.begin('culling');
      if (!this._debug.freezeCulling) this.board.cull(this.camera);
      this.profiler.end('culling');

      // LOD selection: throttled, distance-based, internal to the fixed board
      if (now - this._lastLodUpdate > 150 && !this._debug.freezeLod) {
        this._lastLodUpdate = now;
        this.profiler.begin('lod');
        this.board.updateLOD(this.camera.position);
        this.profiler.end('lod');
        this.cb.onLod(
          [...this.board.lodCounts],
          this.params.chunkCount,
          this.board.visibleChunkCount,
          this.board.culledChunkCount
        );
      }

      if (this.studioCloud) {
        this.studioCloud.renderDepthPrepass(this.renderer, this.camera);
      }

      // refresh the baked height/normal texture if the field changed (no-op on a
      // steady frame); the studio terrain + water shaders then sample it per
      // pixel instead of re-evaluating the full height field.
      this._ensureTerrainHeightTex();

      this._maybeWarmUnderwater();
      this.profiler.begin('render');
      this.profiler.gpu?.frameBegin();
      this.underwater.render(this.renderer, this.scene, this.camera);
      this.profiler.gpu?.frameEnd();
      this.profiler.end('render');
      this._lastTris = this.renderer.info.render.triangles;
      this._lastDraws = this.renderer.info.render.calls;

      // minimap: re-render base only after params settle, marker every frame
      this.profiler.begin('minimap');
      if (minimapDirty) this._renderMinimapBase();
      this.minimap.drawOverlay(this.controls);
      this.profiler.end('minimap');
    }

    // HUD updates at ~6 Hz (uses last drawn triangle/draw-call counts)
    if (now - this._lastHudUpdate > 160) {
      this._lastHudUpdate = now;
      this.cb.onCamera({
        angle: `${this.controls.azimuthDeg.toFixed(0)}°, ${this.controls.elevationDeg.toFixed(0)}°`,
        distance: this.controls.distance.toFixed(0),
      });
      this.cb.onStats({ fps: this._fps, triangles: this._lastTris, drawCalls: this._lastDraws });
      if (this.cb.onPlayerState) {
        this.cb.onPlayerState(this.player ? this.player.state : null);
      }
      if (this.exploreMode === 'plane') {
        this._emitExploreStats({
          chunks: this.board?.activeChunkCount ?? 0,
          visibleChunks: this.board?.visibleChunkCount ?? 0,
          culledChunks: this.board?.culledChunkCount ?? 0,
          lodCounts: this.board ? [...this.board.lodCounts] : [0, 0, 0, 0],
        });
      }
    }
  }

  _emitExploreStats(chunkStats = {}) {
    if (!this.cb.onInfiniteStats) return;
    const pos = this.camera.position;
    const fps = this.fpsControls;
    const stats = {
      x: pos.x.toFixed(0),
      y: pos.y.toFixed(0),
      z: pos.z.toFixed(0),
      speed: this.player
        ? Math.hypot(this.player.vel.x, this.player.vel.y, this.player.vel.z).toFixed(1)
        : (fps ? fps.moveSpeed.toFixed(0) : '0'),
      playerState: this.player ? this.player.state : null,
      ...chunkStats,
    };
    if (this.exploreMode === 'plane' && this.player?.getHudData) {
      stats.plane = this.player.getHudData();
    }
    this.cb.onInfiniteStats(stats);
  }

  _tickInfinite(dt, now) {
    if (this.exploreMode !== 'plane' && this.fpsControls) this.fpsControls.update(dt);
    if (this.exploreMode !== 'none' && this.player) this.player.update(dt);

    // Stream chunks around the camera (with culling)
    if (this.infiniteWorld) {
      this.profiler.begin('chunks');
      this.infiniteWorld.update(this.camera.position, this.camera);
      this.profiler.end('chunks');
    }

    this._maybeWarmUnderwater();
    this.profiler.begin('render');
    this.profiler.gpu?.frameBegin();
    this.underwater.render(this.renderer, this.scene, this.camera);
    this.profiler.gpu?.frameEnd();
    this.profiler.end('render');
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
      if (this.cb.onInfiniteStats) {
        this._emitExploreStats({
          chunks: this.infiniteWorld ? this.infiniteWorld.activeChunkCount : 0,
          visibleChunks: this.infiniteWorld ? this.infiniteWorld.visibleChunkCount : 0,
          culledChunks: this.infiniteWorld ? this.infiniteWorld.culledChunkCount : 0,
          lodCounts: this.infiniteWorld ? [...this.infiniteWorld.lodCounts] : [0, 0, 0, 0],
        });
      }
      this.cb.onStats({ fps: this._fps, triangles, drawCalls });
    }
  }

  _tickPlanet(dt, now) {
    if (this.exploreMode !== 'none' && this.player) {
      this.player.update(dt);   // explore controller owns look + physics
    } else if (this.planetControls) {
      this.planetControls.update(dt);
    }

    if (this.planetWorld) {
      this.profiler.begin('chunks');
      this.planetWorld.update(this.camera.position, this.camera, this._debug);
      this.profiler.end('chunks');
    }
    if (this.planetCloudChunks || this.planetCloudLayer) {
      this.profiler.begin('clouds');
      if (this.planetCloudChunks) {
        this.planetCloudChunks.update(dt, this.camera.position, this.uniforms.uSunDir.value, this.camera, this.planetWorld, this._debug);
      }
      if (this.planetCloudLayer) {
        this.planetCloudLayer.update(dt, this.camera.position, this.uniforms.uSunDir.value);
      }
      this.profiler.end('clouds');
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

    // refresh the baked height/normal cubemap if the field changed (no-op on a
    // steady frame); the planet terrain + water shaders sample it per pixel.
    this._ensurePlanetHeightTex();

    // depth prepass so the cloud march is occluded by the terrain relief
    // (otherwise clouds show through the surface up close)
    if (this.planetCloudChunks) {
      this.planetCloudChunks.renderDepthPrepass(this.renderer, this.camera);
    }
    if (this.planetCloudLayer) {
      this.planetCloudLayer.renderDepthPrepass(this.renderer, this.camera);
    }

    // planet renders straight to the canvas — no underwater render-target pass
    this.profiler.begin('render');
    this.profiler.gpu?.frameBegin();
    this.renderer.render(this.scene, this.camera);
    this.profiler.gpu?.frameEnd();
    this.profiler.end('render');
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
      if (this.cb.onInfiniteStats) {
        this._emitExploreStats({
          chunks: this.planetWorld ? this.planetWorld.activeChunkCount : 0,
          visibleChunks: this.planetWorld ? this.planetWorld.visibleChunkCount : 0,
          culledChunks: this.planetWorld ? this.planetWorld.culledChunkCount : 0,
          lodCounts: this.planetWorld ? [...this.planetWorld.lodCounts] : [0, 0, 0, 0],
        });
      }
      this.cb.onStats({ fps: this._fps, triangles, drawCalls });
    }
  }

  // ----------------------------------------------------------- diagnostics
  // Snapshot of engine state for the Performance Overlay. Read-only, defensive:
  // every world-mode system may be absent (mode not active / disabled). Never
  // throws so the overlay can poll it safely at any time.
  getPerfDiagnostics() {
    const p = this.params || {};
    const perf = this.perf || {};
    const cam = this.camera?.position;

    // current high-level scene state
    let state = 'idle';
    if (this._compiling) state = 'compiling';
    else if (this._exporting) state = 'exporting';
    else if (this._baking) state = 'baking';
    else if (this._bootPending) state = 'loading';

    const cloudLayer = this.worldMode === 'planet'
      ? (this.planetCloudLayer || this.planetCloudChunks)
      : this.studioCloud;
    const cloudsActive = !!(p.cloudsEnabled && cloudLayer);

    const waterEnabled = !!this.waterSystem?.isEnabled();

    const diag = {
      version: APP_VERSION,
      mode: this.worldMode,
      exploreMode: this.exploreMode,
      state,
      qualityPreset: perf.preset,
      pixelRatio: this.renderer ? this.renderer.getPixelRatio() : 1,
      renderScale: perf.renderScale,
      renderer: {
        ...(this.rendererConfig || {}),
        capabilities: this.rendererCapabilities || detectRendererCapabilities(this.renderer),
        requestedBackend: perf.rendererBackend,
        requestedBackendLabel: labelRendererBackend(perf.rendererBackend),
        requestedGpuPreference: perf.gpuPreference,
        requestedGpuPreferenceLabel: labelGpuPreference(perf.gpuPreference),
        reloadRequired: !!(
          this.rendererConfig && (
            perf.rendererBackend !== this.rendererConfig.appliedRendererBackend
            || perf.gpuPreference !== this.rendererConfig.appliedGpuPreference
          )
        ),
      },
      drawingBuffer: this.renderer
        ? { w: this.renderer.domElement.width, h: this.renderer.domElement.height }
        : null,
      camera: cam ? { x: cam.x, y: cam.y, z: cam.z } : null,
      gpuName: this.gpuName,
      shadowsEnabled: !!(this.renderer && this.renderer.shadowMap && this.renderer.shadowMap.enabled),
      postProcessing: { underwater: !!this.underwater?.active },

      terrain: {},
      culling: {},
      lod: {},
      clouds: {
        enabled: cloudsActive,
        mode: cloudsActive ? (this.worldMode === 'planet' ? 'volumetric shell' : 'planar slab') : 'off',
        layers: cloudsActive ? 1 : 0,
        steps: cloudLayer?._steps ?? perf.cloudSteps ?? 0,
        lightSteps: perf.cloudLightSteps ?? 0,
        octaves: perf.cloudOctaves ?? 0,
        detailOctaves: perf.cloudDetailOctaves ?? 0,
        coverage: p.cloudCoverage,
        density: p.cloudDensity,
        scale: p.cloudScale,
        windSpeed: p.cloudWindSpeed,
        evolveSpeed: p.cloudEvolveSpeed,
        cullingMode: 'whole volume only',
        chunked: 'not used by default',
        lod: perf.cloudStepLOD ? 'distance step-LOD' : 'none',
        ready: cloudLayer ? (cloudLayer._ready !== false) : true,
        time: this.profiler.sections.get('clouds')?.stat.avg ?? null,
      },
      water: {
        enabled: waterEnabled,
        mode: this.waterSystem ? this.waterSystem.getEffectiveMode() : 'off',
        quality: perf.waterQuality,
        reflection: perf.waterReflection,
        detail: perf.waterDetail,
        waves: perf.waterWaves,
        seaLevel: p.seaLevel,
        underwater: !!this.underwater?.active,
      },
    };

    if (this.worldMode === 'infinite' && this.infiniteWorld) {
      const w = this.infiniteWorld;
      diag.terrain = {
        chunkSize: w.chunkSize,
        viewRadius: w.viewRadius,
        renderDistance: w.viewRadius * w.chunkSize,
        lodThresholds: Array.isArray(w.lodThresholds) ? [...w.lodThresholds] : [],
        lastChunkGenMs: this.profiler.getMetric('lastChunkGenMs') ?? null,
      };
      diag.culling = {
        total: w.activeChunkCount,
        visible: w.visibleChunkCount,
        culled: w.culledChunkCount,
      };
      diag.lod = { counts: [...w.lodCounts] };
    } else if (this.worldMode === 'planet' && this.planetWorld) {
      const w = this.planetWorld;
      diag.terrain = {
        planetRadius: p.planetRadius,
        faceGrid: this._planetFaceGrid ? this._planetFaceGrid() : this.planetFaceGrid,
        bakedHeightTex: this._bakedTerrainGen >= 0,
        lastRebuildMs: this.profiler.getMetric('lastPlanetRebuildMs') ?? null,
      };
      diag.culling = {
        total: w.activeChunkCount,
        visible: w.visibleChunkCount,
        culled: w.culledChunkCount,
      };
      diag.lod = { counts: [...w.lodCounts] };
    } else {
      const b = this.board;
      diag.terrain = {
        resolution: Array.isArray(perf.lodSegments) ? perf.lodSegments[0] : null,
        boardSize: this.boardSize,
        tiles: Array.isArray(this.tiles) ? this.tiles.length : 1,
        heightScale: p.heightScale,
        octaves: p.octaves,
        noiseLayers: Array.isArray(this.noiseStack?.layers) ? this.noiseStack.layers.length : null,
        bakedHeightTex: this._bakedStudioGen >= 0,
        lastGenMs: this.profiler.getMetric('lastTerrainGenMs') ?? null,
        lastBakeMs: this.profiler.getMetric('lastBakeMs') ?? null,
      };
      diag.culling = b ? {
        total: b.activeChunkCount ?? (Array.isArray(b.lodCounts) ? b.lodCounts.reduce((a, c) => a + c, 0) : 0),
        visible: b.visibleChunkCount,
        culled: b.culledChunkCount,
      } : {};
      diag.lod = { counts: b ? [...b.lodCounts] : [0, 0, 0, 0] };
    }

    this.profiler.setMetric('sceneState', state);
    return diag;
  }

  dispose() {
    for (const entry of Object.values(this.importedMaps || {})) entry?.texture?.dispose();
    if (this._disposed) return;
    this._disposed = true;
    if (this._resizeObserver) this._resizeObserver.disconnect();
    if (this._onVisibility) document.removeEventListener('visibilitychange', this._onVisibility);
    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
    }
    if (this.paintMode) { this.paintMode.dispose(); this.paintMode = null; }
    if (this.propsManager) { this.propsManager.dispose(); this.propsManager = null; }
    if (this.player) { this.player.dispose(); this.player = null; }
    if (this.heightSampler) { this.heightSampler.dispose(); this.heightSampler = null; }
    if (this.worldMode === 'infinite') this._disposeInfinite();
    else if (this.worldMode === 'planet') this._disposePlanet();
    else if (this.fpsControls) { this.fpsControls.dispose(); this.fpsControls = null; }
    if (this.studioCloud) { this.studioCloud.dispose(); this.studioCloud = null; }
    if (this.terrainHeightBaker) { this.terrainHeightBaker.dispose(); this.terrainHeightBaker = null; }
    if (this.proceduralSky) { this.proceduralSky.dispose(); this.proceduralSky = null; }
    this.board.dispose();
    this.minimap.dispose();
    this.underwater.dispose();
    this.waterSystem?.dispose();
    for (const t of this._matTrash) for (const m of t.mats) m.dispose();
    this._matTrash = [];
    this._warmGeo.dispose();
    if (this.terrainMaterial) this.terrainMaterial.dispose();
    if (this.waterMaterial) this.waterMaterial.dispose();
    if (this.controls) { this.controls.dispose(); this.controls = null; }
    if (this.planetControls) { this.planetControls.dispose(); this.planetControls = null; }
    // tile hover-to-add listeners + resources
    if (this._onTilePointerMove) {
      this.canvas.removeEventListener('pointermove', this._onTilePointerMove);
      this.canvas.removeEventListener('pointerdown', this._onTilePointerDown);
      this.canvas.removeEventListener('pointerup', this._onTilePointerUp);
    }
    if (this._tileGhost) {
      this._tileGhost.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      this._tileGhost = null;
    }
    if (this._tileOccTex) { this._tileOccTex.dispose(); this._tileOccTex = null; }
    if (this.renderer) {
      loseRendererContext(this.renderer);
      this.renderer.dispose();
      this.renderer = null;
    }
  }
}
