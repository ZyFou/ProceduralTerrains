import * as THREE from 'three';
import { createTerrainUniforms, createTerrainMaterial, createInfiniteTerrainMaterial, createBootTerrainMaterial, rebuildTerrainShaderSource, rebuildTerrainPreviewShaderSource } from './terrain/TerrainMaterial.js';
import { createWaterMaterial, createInfiniteWaterMaterial, rebuildWaterShaderSource } from './terrain/WaterMaterial.js';
import { TerrainBoard } from './terrain/TerrainBoard.js';
import { InfiniteWorld } from './terrain/InfiniteWorld.js';
import { InfiniteTerrainClipmap } from './terrain/InfiniteTerrainClipmap.js';
import { CloudSlabLayer } from './sky/CloudSlabLayer.js';
import { InfiniteCloudLayer } from './sky/InfiniteCloudLayer.js';
import { CloudAdaptiveQualityController } from './sky/CloudAdaptiveQualityController.js';
import {
  CLOUD_QUALITY_PRESETS,
  CLOUD_LEGACY_PERF_KEYS,
  normalizeCloudFormation,
} from './sky/CloudSettings.js';
import { TerrainHeightBaker } from './terrain/TerrainHeightBaker.js';
import {
  getLocation, makeCustomLocation, effectiveZoomFor, fetchBboxElevation,
  fetchBboxImagery, offsetBbox, compositeCellPatches, compositeCellImagery,
  ELEVATION_SOURCE, DEFAULT_IMAGERY_STYLE, resolveImageryStyle,
} from './terrain/RealWorldHeightmap.js';
import { fetchBboxBuildings } from './terrain/RealWorldBuildings.js';
import { RealWorldBuildingLayer } from './terrain/RealWorldBuildingLayer.js';
import {
  DEFAULT_IMPORT_SETTINGS,
  createRealWorldSource,
  normalizeRealWorldSource,
  updateRealWorldSourceBuildingsVisible,
  updateRealWorldSourceImageryStyle,
  updateRealWorldSourceSettings,
} from './terrain/RealWorldSource.js';
import { EditorControls } from './EditorControls.js';
import { FPSControls } from './FPSControls.js';
import { Minimap } from './Minimap.js';
import {
  DEFAULT_PARAMS,
  applyPreset,
  migrateTerrainFormationParams,
  PRESETS,
} from './presets.js';
import { ProceduralSky } from './sky/ProceduralSky.js';
import { evaluateTimeOfDay } from './sky/TimeOfDay.js';
import { resolveCloudLightingState } from './sky/CloudLightingState.js';
import { FogManager } from './render/FogManager.js';
import { UnderwaterEffect } from './render/UnderwaterEffect.js';
import { UnderwaterController } from './render/UnderwaterController.js';
import { VisualPostProcess } from './render/VisualPostProcess.js';
import { isVisualKey } from './render/VisualSettings.js';
import {
  applyPerfPreset, createPerfSettings, loadPerfSettings, savePerfSettings,
  sanitizePerfSettings, resolveLodSegments, resolveLodDistances,
  hasStoredPerfSettings,
} from './render/PerformanceSettings.js';
import { detectGpuTier, presetForTier, saveGpuTier } from './render/GpuTier.js';
import {
  buildBoardPlinthGeometry,
  buildCircularPlinthGeometry,
  buildDiskWallGeometry,
  MAX_DISK_BOUNDARY_SEGMENTS,
  resolveDiskBoundarySegments,
  buildTileAssemblyPlinthGeometry,
  createBoardPlinthMaterial,
} from './terrain/BoardPlinth.js';
import { PlanetStyleManager } from './style/PlanetStyleManager.js';
import { TerrainHeightSampler } from './terrain/TerrainHeightSampler.js';
import { ErosionField } from './terrain/erosion/ErosionField.js';
import { EROSION_QUALITY, getErosionPreset } from './terrain/erosion/ErosionPresets.js';
import { GpuHeightSampler } from './terrain/GpuHeightSampler.js';
import { PlayerController } from './player/PlayerController.js';
import { PlaneController } from './player/PlaneController.js';
import { defaultLegacyStack, migrateStack, makeLayer, cloneStack } from './terrain/noise/NoiseStack.js';
import { buildNoiseStackPresetRecipe } from './terrain/noise/noisePresets.js';
import {
  TERRAIN_RESET_KEYS, EROSION_RESET_KEYS, BIOME_RESET_KEYS, PROPS_RESET_KEYS, WORLD_RESET_KEYS,
  LIGHTING_PARAM_KEYS, LIGHTING_STYLE_KEYS, DEBUG_PARAM_KEYS,
  patchParamsFromDefaults, resetWaterParams, resetCloudParams, resetSkyboxParams,
  resetVisualParams, lightingStyleDefaults, waterColorDefaults, DEFAULT_TIME_OF_DAY, DEFAULT_DEBUG_FLAGS,
} from './panelResets.js';
import { EARTH_PALETTE, PALETTE_KEYS } from './style/ColorPalette.js';
import { generateStackGLSL, packStackUniforms } from './terrain/noise/noiseStackCodegen.js';
import { compileTerrainGraph } from './terrain/graph/GraphCompiler.js';
import { createBlankGraph, migrateGraphDocument } from './terrain/graph/GraphDocument.js';
import { downloadPlanetStyleJSON, parsePlanetStyleJSON } from './export/TerrainPresetExporter.js';
import { PaintModeManager } from '../paint/PaintModeManager.js';
import { ManualTerrainModeManager } from '../manual/ManualTerrainModeManager.js';
import { normalizeManualTerrainDocument } from '../manual/ManualShapeCatalog.js';
import { ProceduralPropsManager } from './props/ProceduralPropsManager.js';
import { FlatPropSampler } from './props/TerrainPropSampler.js';
import { WaterSystem } from './water/WaterSystem.js';
import { migrateWaterParams, resolveEffectiveWaterMode, resolveUnderwaterMode, underwaterModeFellBack, isRealisticWaterMode, isWaterActive } from './water/WaterSettings.js';
import {
  createWaterBaselineReport,
  getWaterBaselineScene,
  resolveWaterBaselineCamera,
  waterBaselineParams,
} from './water/WaterBaseline.js';
import { createRendererForCanvas, loseRendererContext } from './render/createWebGLRenderer.js';
import {
  SURFACE_TEXTURE_SOURCE,
  normalizeSurfaceTextureParams,
  normalizeSurfaceTextureSource,
} from './terrain/surface/SurfaceTextureSources.js';
import {
  detectRendererCapabilities,
  getWebGpuSupport,
  labelGpuPreference,
  labelRendererBackend,
} from './render/RendererCapabilities.js';
import { profiler } from './perf/PerformanceProfiler.js';
import { GPUProfiler } from './perf/GPUProfiler.js';
import { APP_VERSION } from '../constants/app.js';
import { TerrainPicker } from './terrain/TerrainPicker.js';
import { SplineManager } from '../creator/splines/SplineManager.js';
import { TerrainAnalysisManager } from '../creator/analysis/TerrainAnalysisManager.js';
import { ProjectHistoryManager } from '../creator/history/ProjectHistoryManager.js';
import { createProductionFiles } from '../export/ExportPresetManager.js';
import { hasExportErrors, validateExport } from '../export/ExportValidator.js';

const IMPORT_MODES = { disabled: 0, preview: 1, replace: 2, blend: 3 };
const NODE_NEUTRAL_PALETTE = Object.fromEntries(PALETTE_KEYS.map((key) => [
  key,
  key === 'deep' || key === 'shallow' || key === 'foam' ? [...EARTH_PALETTE[key]]
    : key === 'snow' ? [0.88, 0.89, 0.91]
    : key === 'rock' || key === 'rockHi' ? [0.62, 0.63, 0.65]
      : [0.74, 0.75, 0.77],
]));

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

function yieldTask() {
  if (typeof MessageChannel !== 'undefined') {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(0);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function yieldFrame() {
  if (typeof requestAnimationFrame === 'function'
      && (typeof document === 'undefined' || document.visibilityState !== 'hidden')) {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
  return new Promise((resolve) => setTimeout(resolve, 16));
}

// Parameter keys that change the baked terrain height/climate field. Live sea
// level is deliberately excluded: it moves water and presentation thresholds
// without changing terrain geometry. The frozen formation level remains a true
// terrain input because full presets/new projects may replace it.
const TERRAIN_FIELD_KEYS = new Set([
  'seed', 'terrainFormationSeaLevel', 'heightScale', 'noiseScale', 'noiseStrength', 'octaves',
  'terrainSmoothing', 'persistence', 'lacunarity', 'ridge', 'warp', 'falloff', 'edgeFalloffMode',
  'moistScale', 'moistBias', 'biomeScale', 'tempBias',
  'chunkCount', 'chunkSize',
]);

const REBUILD_KEYS = new Set(['chunkCount', 'chunkSize', 'planetFaceGrid']);
const DEFERRED_TERRAIN_KEYS = new Set(
  [...TERRAIN_FIELD_KEYS].filter((key) => !REBUILD_KEYS.has(key)),
);
const STACK_COMPAT_PARAM_KEYS = new Set([
  'warp', 'ridge', 'persistence', 'lacunarity', 'octaves',
]);

export class Engine {
  constructor({ canvas, minimapBase, minimapOverlay, callbacks, initialParams }) {
    this._bootStart = performance.now();   // boot timing baseline (see [boot] logs)
    this.canvas = canvas;
    this.cb = callbacks;
    this._initialParamKeys = new Set(Object.keys(initialParams || {}));
    this.params = normalizeCloudFormation(normalizeSurfaceTextureParams(
      migrateWaterParams(migrateTerrainFormationParams(
        { ...DEFAULT_PARAMS, ...initialParams },
        initialParams || {},
      )),
      initialParams || {},
    ));
    // Live Noise Stack (drives terrain shape). Migrated from params so old saves
    // get the default single Classic-Terrain layer == bit-identical to before.
    this.noiseStack = migrateStack(this.params.noiseStack);
    this.params.noiseStack = this.noiseStack;
    this._liveNoiseStack = this.noiseStack;
    this._stackGLSL = generateStackGLSL(this.noiseStack);
    this._stackSig = this._stackGLSL.sig;
    this._liveHeightSig = this._stackSig;
    this._liveHeightSourceSig = this._stackSig;
    this._liveGenerationSource = 'classic';
    this._liveGraphProgram = null;
    this._terrainSourcePendingToken = null;
    this._octaveTransitionTarget = null;
    this._octaveTransitionPromise = null;
    this.projectMode = 'procedural';
    this.workspacePreset = null;
    this.generationSource = 'classic';
    this.terrainGraph = null;
    this.graphView = { x: 0, y: 0, zoom: 1 };
    this._graphProgram = null;
    this._graphDiagnostics = [];
    this._pendingGraphCompileSig = null;
    this._pendingGraphCompileReady = null;
    this._pendingGraphCompileNodeIds = new Set();
    this._pendingGraphFallbackProgram = null;
    this._soloLayerId = null;       // solo-preview gate (uniform-only, no recompile)
    this._liveSoloLayerId = null;
    this.appliedChunkCount = 0;
    this.appliedChunkSize = 0;
    this._minimapDirtyAt = 0;
    this._lastLodUpdate = 0;
    this._lastHudUpdate = 0;
    this._lastTimeOfDayEmit = 0;
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
    this._qualityPending = true;
    this._bootFallbackFrameReady = false;
    this._bootShaderPending = false;
    this._initialShaderRetryTimer = null;
    this._initialShaderRetryCount = 0;
    this._bootDegradedMaterial = null;
    this._bootWatchdogTimer = null;
    this._qualityWatchdogTimer = null;
    this._bootGateLogAt = 0;
    this._waterDeferred = true;
    this._waterMaterialWarmed = false;
    this._waterMaterialWarmIdentity = null;
    this._waterWarmPromise = null;
    this._waterWarmRetryTimer = null;
    this._waterWarmRetryCount = 0;
    this._waterWarmFailed = false;
    this._terrainHeightBakeDeferred = true;
    this._terrainHeightBakeFailed = false;
    this._terrainHeightBakeRetryTimer = null;
    this._terrainHeightBakeRetryCount = 0;
    this._postFirstPaintWarmupsStarted = false;
    this._postFirstPaintWarmTimer = null;
    this._postFirstPaintWaterTimer = null;
    this._terrainUpgradeRetryTimer = null;
    this._terrainUpgradeRetryCount = 0;
    this._terrainVariantRetryTimer = null;
    this._terrainVariantRetryCount = 0;
    this._terrainVariantCompiling = false;
    this._terrainVariantFailed = false;
    this._terrainQualityTimer = null;
    this._contextLost = false;
    // Active shader gates (KHR_parallel_shader_compile). Superseded terrain
    // jobs may keep linking, but relinquish their gate so the already-live
    // material can render without waiting for obsolete work.
    this._compiling = 0;
    this._terrainAtomicCompileTokens = new Set();
    this._worldCompileGate = null;
    this._worldCompileSerial = 0;
    this._bgWork = new Map();   // id → label of non-blocking background compiles
    // The underwater render-target program variants are deferred from boot and
    // warmed lazily on first approach to water (see _warmUnderwaterShaders).
    this._underwaterWarmed = false;
    this._underwaterWarmIdentity = null;
    this._underwaterWarmPromise = null;
    this._octToken = 0;
    this._worldModeToken = 0;
    this._matTrash = [];         // warm materials kept alive until programs are acquired
    this._mainRenderSerial = 0;  // advances only after a live scene render
    this._warmGeo = new THREE.PlaneGeometry(1, 1);
    this._erosionGPUModule = null;
    this._erosionGPUImportPromise = null;
    this._erosionGPUUnavailable = false;
    this._erosionGPUWarmScheduled = false;
    this._erosionGPUWarmCancel = null;
    this.planetStyle = new PlanetStyleManager();
    this.paintMode = null;
    this.paintState = null;
    this.manualTerrain = null;
    this.manualTerrainState = { enabled: false, selectedId: null, transformMode: 'translate', placementType: null, texturePaint: { enabled: false, tool: 'paint', material: 'grass' }, shapes: [] };
    this.splineManager = null;
    this.splineState = { enabled: false, selectedId: null, splines: [] };
    this.terrainAnalysis = null;
    this.analysisState = null;
    this.projectHistory = null;
    this.propsManager = null;
    this.realWorldBuildingLayer = null;
    this._realWorldBuildingLayoutKey = '';
    this.propSampler = null;
    this.planetPropSampler = null;
    this.propSurfaceField = null;
    this._propCpuSampler = null;

    // World mode: 'studio' (single board), 'infinite' (streamed flat grid),
    // or 'planet' (cube-sphere world)
    this.worldMode = 'studio';
    this.infiniteWorld = null;
    this.infiniteTerrainClipmap = null;
    this.infiniteCloud = null;
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
    this._planetBakeRequestedGen = -1;
    this._planetModules = null;
    this._planetModulesPromise = null;

    // Studio (flat board) height bake: replaces the per-pixel height
    // field in the studio terrain + water shaders with a single texture fetch.
    this.terrainHeightBaker = null;
    this._bakedStudioGen = -1;       // terrain generation the studio texture was baked at
    this._bakedStudioLayout = '';    // tile layout the studio texture was baked at
    this._paintWasEnabled = false;   // detect paint→idle transition to refresh the bake
    this.planetFaceGrid = 8;
    this._compiledKeys = new Set();   // mode-specific shader sets (currently Planet) already compiled

    // Explore controllers: walk or plane. playerMode remains a walk-only
    // compatibility flag for existing UI/status paths.
    this.player = null;
    this.playerMode = false;
    this.exploreMode = 'none';
    this.heightSampler = null;
    this.cpuHeightSampler = null;
    this._freeCamRestore = null;
    this._debugFreeCamOwnsFps = false;
    this._terrainGen = 0;   // bumped whenever the height field changes
    this._pendingTerrainParams = {};
    this._pendingNoiseStack = null;
    this._pendingNoiseSolo = null;
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
    this._cloudAdaptive = new CloudAdaptiveQualityController();
    this._cloudAdaptive.suspend(this._bootStart, 9000);

    // Developer debug switches (Debug panel). None of these persist — they are
    // pure inspection aids that never touch saved projects or perf settings.
    this.tileDebug = { view: 'off', showLegend: true, opacity: 1, showPreview: true };
    this.importedMaps = { noise: null, height: null, biome: null, imagery: null };
    this.importedMapState = { noise: null, height: null, biome: null, imagery: null };
    this.realWorldImageryStyle = DEFAULT_IMAGERY_STYLE;
    this.realWorldBuildingsVisible = false;
    this.realWorldSource = null;

    // Erosion: additive world-space height-offset field applied in heightAt.
    // Slice 1 ships the offset pipeline + a no-op identity bake; the simulation
    // arrives in later slices.
    this.erosionField = new ErosionField();

    this._debug = {
      freezeCulling: false,   // stop recomputing chunk visibility (fly out to inspect the frustum)
      freezeLod: false,       // stop recomputing per-chunk LOD
      forceRender: false,     // bypass the on-demand gate — draw every frame
      disableHeightBake: false, // force the live per-pixel height field (studio bake off)
      terrainDetailDebug: 'off',
      mergeDebug: false,      // wireframe boxes around merged groups / macro proxy
      freeCamNoClip: false,
    };
    // Correctness baseline for Tile mode. The optimized Studio height/climate
    // cache has repeatedly allowed terrain geometry, shoreline masks and
    // surface colour classification to observe different generations. Until a
    // future cache implementation can prove atomic coordinate/generation
    // parity, keep every visible Tile consumer on the same live height field.
    // Infinite World and Planet retain their dedicated cache paths.
    this._studioLiveHeightField = true;
    this._landingShowcase = false;

    this._initRenderer();
    this._onContextLost = (event) => {
      event.preventDefault();
      this._contextLost = true;
      console.warn('[webgl] context lost; aborting shader waits');
      this._releaseBootFallback('WebGL context lost', { render: false });
      this.cb.onStatus('Graphics context lost — waiting to recover…', false);
    };
    this._onContextRestored = () => {
      this._contextLost = false;
      this._needsRender = true;
      console.info('[webgl] context restored');
      this.cb.onStatus('Ready', false);
      this._schedulePostFirstPaintWarmups(250);
    };
    this.canvas.addEventListener('webglcontextlost', this._onContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this._onContextRestored, false);
    this._autoSelectPresetByGpu();   // first run only: pick a preset for the GPU
    this._initScene(minimapBase, minimapOverlay);
    this._initControls();
    this._initTileInteraction();
    this._initPaintMode();
    this._initManualTerrain();
    this._initCreatorTools();
    this._initProps();
    this._bindMinimapSources();

    this.controls.setBoardSize(this.boardSize);
    this.controls.reset(this.boardSize);
    this.controls.update(1);
    this.camera.updateMatrixWorld(true);

    this.applyAll({ force: true });
    this._applyPerformance();
    this._syncPlanetStyleToParams();
    this.cb.onParams(this._paramsSnapshot());
    this.cb.onRealWorldBuildingsVisible?.(this.realWorldBuildingsVisible);
    if (this.cb.onPerfChange) this.cb.onPerfChange({ ...this.perf });

    this._resizeObserver = new ResizeObserver(() => this._onResize());
    this._resizeObserver.observe(canvas.parentElement);
    this._onResize();

    // On returning to the tab, force one redraw (the static studio scene may
    // have been cleared) and drop the accumulated hidden time.
    this._onVisibility = () => {
      if (document.visibilityState === 'visible') {
        this._clock.getDelta();   // discard the long hidden gap
        this._cloudAdaptive?.suspend(performance.now(), 6000);
        this._needsRender = true;
      }
    };
    document.addEventListener('visibilitychange', this._onVisibility);

    // Optional GPU quality work must yield to actual editor input. Track only
    // intent-bearing events (not passive mouse movement) so an idle cursor does
    // not postpone the upgrade forever.
    this._lastUserActivityAt = performance.now();
    this._onUserActivity = () => { this._lastUserActivityAt = performance.now(); };
    window.addEventListener('pointerdown', this._onUserActivity, true);
    window.addEventListener('wheel', this._onUserActivity, { capture: true, passive: true });
    window.addEventListener('keydown', this._onUserActivity, true);

    console.info(`[boot] sync init (renderer+scene+board) ${(performance.now() - this._bootStart).toFixed(0)}ms · GPU tier ${this.gpuTier} · preset ${this.perf?.preset}`);
    this.renderer.setAnimationLoop(() => this._tick());
    // Compile the first visible studio shaders immediately. Earlier idle/rAF gates
    // could be throttled for tens of seconds by Chrome before first paint.
    this._warmupInitialShaders();
  }

  // ----------------------------------------------------------------- setup

  async _loadPlanetModules() {
    if (this._planetModules) return this._planetModules;
    if (!this._planetModulesPromise) {
      this._planetModulesPromise = import('./planet/planetBundle.js');
    }
    try {
      this._planetModules = await this._planetModulesPromise;
      return this._planetModules;
    } catch (error) {
      this._planetModulesPromise = null;
      throw error;
    }
  }

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
      workerRequested: !!this.perf?.useWorker,
      workerActive: false,
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
    if (this.gpuTier === 'low' && !this._initialParamKeys.has('chunkCount')) {
      this.params.chunkCount = Math.min(this.params.chunkCount, 12);
    }
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
    const oct = Math.round(this.params.octaves);
    // Install the requested final terrain material from the first scene frame.
    // Shader compilation stays behind the loading overlay; users must never see
    // a temporary low-detail terrain that changes underneath an open project.
    this.terrainMaterial = createTerrainMaterial(
      this.uniforms,
      oct,
      this._stackGLSL,
      { variant: this._targetTerrainVariant() },
    );
    this.board = new TerrainBoard(this.scene, this.terrainMaterial);

    // water plane at sea level
    this.waterMaterial = createWaterMaterial(this.uniforms, oct, this._stackGLSL);
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.waterMaterial);
    this.water.geometry.rotateX(-Math.PI / 2);
    this.water.renderOrder = 10;
    this.water.frustumCulled = false;
    this.water.visible = false;
    this.scene.add(this.water);

    this.waterSystem = new WaterSystem(this);

    // clean diorama base: perimeter walls + flat bottom (no z-fight with chunk skirts)
    this._plinthGeometryKey = null;
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

    // camera-underwater post effect (inactive above water — zero cost) +
    // centralized submersion detection / transition (single source of truth).
    this.underwater = new UnderwaterEffect();
    this.underwaterController = new UnderwaterController();
    this.visualPost = new VisualPostProcess();
    this._sharedOpaqueRevision = null;
    this._sharedOpaqueTarget = null;

    // studio/flat-board volumetric cloud slab (sits above the board; hidden
    // until enabled). Planet mode has its own spherical PlanetCloudLayer.
    this.studioCloud = new CloudSlabLayer(this.scene, {
      compile: async (mats) => {
        // Restored cloud quality can rebuild a heavy shader during applyAll().
        // Yield until the minimal terrain safety frame has actually painted.
        while (!this._disposed
            && (this._bootPending || this._bootShaderPending)) {
          await yieldFrame();
        }
        if (this._disposed) return { ready: false, aborted: true };
        // The live Studio path normally renders into the visual-post target.
        // If that target changes while the cloud links, warm the replacement
        // before allowing CloudSlabLayer to publish/show the candidate.
        for (let attempt = 0; attempt < 3; attempt++) {
          const target = this._resolveCameraCompileTarget();
          const result = await this._compileMaterialVariants(mats, {
            canvasOnly: true,
            timeoutMs: 120000,
            renderTarget: target.renderTarget,
          });
          if (result?.ready !== true || this._disposed) return result;
          const current = this._resolveCameraCompileTarget();
          if (this._sameCameraCompileTarget(target, current)) return result;
          await yieldTask();
        }
        return { ready: false, aborted: true };
      },
      renderer: this.renderer,
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
      gpuTier: this.gpuTier,
      onChange: (state) => {
        this.paintState = state;
        if (state.enabled && this.worldMode === 'studio' && this.waterMaterial) {
          this._waterDeferred = true;
          if (this.water) this.water.visible = false;
          this.uniforms.uUseWaterTerrainBiomeTex.value = 0.0;
        }
        if (this.cb.onPaintState) this.cb.onPaintState(state);
      },
      onToast: (msg) => this.cb.onToast(msg),
    });
    this.paintState = { ...this.paintMode.state };
  }

  _initManualTerrain() {
    this.manualTerrain = new ManualTerrainModeManager({
      scene: this.scene,
      camera: this.camera,
      domElement: this.canvas,
      uniforms: this.uniforms,
      controls: this.controls,
      getBounds: () => this._creatorBounds(),
      getHeightAt: (x, z) => (
        this._getCpuHeightSampler().heightAt(x, z) * (this.paintMode?.state.baseMultiplier ?? 1)
        + this._samplePaintHeightOffset(x, z)
        + this._sampleManualHeightOffset(x, z)
        + this._sampleSplineHeightOffset(x, z)
      ),
      getBaseHeightAt: (x, z) => (
        this._getCpuHeightSampler().heightAt(x, z) * (this.paintMode?.state.baseMultiplier ?? 1)
        + this._samplePaintHeightOffset(x, z)
        + this._sampleSplineHeightOffset(x, z)
      ),
      gpuTier: this.gpuTier,
      onChange: (state, meta = {}) => {
        this.manualTerrainState = state;
        if (meta.surfaceChanged) {
          this._needsRender = true;
          this.minimap.requestRedraw();
        }
        if (meta.terrainChanged) {
          this._markTerrainFieldDirty();
          this._minimapDirtyAt = performance.now();
          this.minimap.requestRedraw();
        }
        this.cb.onManualTerrainState?.(state, meta);
      },
      onStableAction: (label) => this.projectHistory?.record('manual-terrain', label),
      onToast: (message) => this.cb.onToast(message),
    });
    this._bindAuthoringMaskTextures();
  }

  _bindAuthoringMaskTextures() {
    const uniforms = this.uniforms;
    if (!uniforms || !this.paintMode?.layers) return;
    const manual = this.projectMode === 'manual' && this.manualTerrain?.surfaceField;
    uniforms.uPaintBiomeTexture.value = this.paintMode.layers.biomeTexture;
    uniforms.uPaintPropsTexture.value = this.paintMode.layers.propsTexture;
    if (manual) {
      this.manualTerrain.surfaceField.bind(uniforms);
      uniforms.uManualSurfaceMode.value = 1;
      uniforms.uManualBaseGenerated.value = this._manualHasGeneratedBase() ? 1 : 0;
    } else {
      uniforms.uManualSurfaceMode.value = 0;
      uniforms.uManualBaseGenerated.value = 0;
    }
  }

  _initProps() {
    this.propsManager = new ProceduralPropsManager(this.scene);
    this.realWorldBuildingLayer = new RealWorldBuildingLayer(this.scene);
  }

  _creatorBounds() {
    const b = this._tileBounds(); const cs = this.cellSize;
    return { origin: { x: b.minX * cs - cs * .5, z: b.minZ * cs - cs * .5 }, span: { x: this._unionWidth(), z: this._unionDepth() } };
  }

  _syncManualTerrainBounds() {
    const changed = this.manualTerrain?.syncBounds();
    if (changed?.terrainChanged) {
      this._markTerrainFieldDirty();
    }
    return changed;
  }

  _initCreatorTools() {
    const contains = (x, z) => { const { origin, span } = this._creatorBounds(); return x >= origin.x && x <= origin.x + span.x && z >= origin.z && z <= origin.z + span.z; };
    const picker = new TerrainPicker({ camera: this.camera, domElement: this.canvas, contains,
      heightAt: (x, z) => (this._getHeightSampler().heightAt(x, z) * (this.paintMode?.state.baseMultiplier ?? 1)) + this._samplePaintHeightOffset(x, z) + this._sampleManualHeightOffset(x, z) + this._sampleSplineHeightOffset(x, z),
    });
    this.splineManager = new SplineManager({ scene: this.scene, camera: this.camera, domElement: this.canvas, controls: this.controls, uniforms: this.uniforms,
      getBounds: () => this._creatorBounds(), getBaseHeight: (x, z) => this._getHeightSampler().heightAt(x, z) * (this.paintMode?.state.baseMultiplier ?? 1), picker, gpuTier: this.gpuTier,
      onChange: (state) => {
        this.splineState = state;
        this._markTerrainFieldDirty();
        this.cb.onSplineState?.(state);
      },
      onStableAction: (label) => { this.projectHistory?.record('splines', label); }, onToast: (message) => this.cb.onToast(message),
    });
    this.terrainAnalysis = new TerrainAnalysisManager({ uniforms: this.uniforms, getParams: () => this.params, onChange: (state) => { this.analysisState = state; this._needsRender = true; this.cb.onAnalysisState?.(state); } });
    this.analysisState = this.terrainAnalysis.serialize();
    this.projectHistory = new ProjectHistoryManager({
      getState: () => ({ ...this.serializeState(), creatorTools: this._serializeCreatorTools() }),
      restoreState: (state) => this.restoreState(state),
      getThumbnail: () => { try { return this.canvas.toDataURL('image/webp', .78); } catch { return null; } },
      onChange: (state) => this.cb.onCreatorHistory?.(state),
    });
  }

  _bindMinimapSources() {
    this.minimap.setSources({
      controls: this.controls,
      sampler: this._getMinimapSampler(),
      getPaintHeightOffset: (x, z) => this._samplePaintHeightOffset(x, z) + this._sampleManualHeightOffset(x, z),
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
      this._minimapSampler.setHeightProgram(this.worldMode === 'studio' && this.generationSource === 'graph' ? this._graphProgram : null);
    }
    return this._minimapSampler;
  }

  _samplePaintHeightOffset(x, z) {
    return (this.paintMode?.layers?.sampleHeightOffset(x, z) ?? 0) * (this.paintMode?.state?.layerOpacity ?? 1);
  }

  _manualBaseSource(document = null) {
    if (this.projectMode !== 'manual') return this.projectMode === 'nodes' ? 'nodes' : 'procedural';
    const source = document?.baseSource ?? this.manualTerrain?.baseSource;
    return source === 'procedural' || source === 'nodes' ? source : 'flat';
  }

  _manualHasGeneratedBase(document = null) {
    return this.projectMode === 'manual' && this._manualBaseSource(document) !== 'flat';
  }

  _generationSourceForProject(document = null) {
    return this.projectMode === 'nodes' || this._manualBaseSource(document) === 'nodes'
      ? 'graph'
      : 'classic';
  }

  _sampleManualHeightOffset(x, z) {
    if (this.projectMode !== 'manual') return 0;
    return this.manualTerrain?.field?.sampleHeightOffset(x, z) ?? 0;
  }

  _sampleSplineHeightOffset(x, z) { return this.splineManager?.getHeightOffset(x, z) ?? 0; }
  _serializeCreatorTools() { return { splines: this.splineManager?.serialize?.() ?? [], analysis: this.terrainAnalysis?.serialize?.() ?? {} }; }

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

  // Sync board geometry + plinth/water/camera for the current tile set, then
  // re-center the camera on the assembly and mirror the layout to the UI.
  _rebuildTiles() {
    this._applyTileLayout();
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

  // ------------------------------------------- real-world tile load overlay
  // Small floating billboards above cells whose real-world elevation is being
  // fetched — label + progress bar, so tile expansion never looks stalled.
  // Sprites ignore depth (always readable) and are hidden from the minimap.

  _rwOverlayGroup() {
    if (!this._rwLoadGroup) {
      this._rwLoadGroup = new THREE.Group();
      this._rwLoadGroup.name = 'realworld-load-overlay';
      this.scene.add(this._rwLoadGroup);
    }
    return this._rwLoadGroup;
  }

  _rwDrawLoadSprite(sprite, progress) {
    const canvas = sprite.userData.canvas;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(8, 10, 14, 0.82)';
    ctx.beginPath(); ctx.roundRect(1, 1, w - 2, h - 2, 16); ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#e8ecf3';
    ctx.font = '600 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Loading terrain…', w / 2, 32);
    const bx = 24, by = 46, bw = w - 48, bh = 12;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 6); ctx.fill();
    ctx.fillStyle = '#2563eb';
    const p = Math.max(0, Math.min(1, progress));
    ctx.beginPath(); ctx.roundRect(bx, by, Math.max(bh, bw * p), bh, 6); ctx.fill();
    sprite.material.map.needsUpdate = true;
  }

  /** progress 0..1 shows/updates the cell's overlay; null removes it. */
  _rwSetTileLoadProgress(cx, cz, progress) {
    const key = `${cx},${cz}`;
    const map = (this._rwLoadSprites ??= new Map());
    if (progress === null) {
      const s = map.get(key);
      if (s) {
        this._rwLoadGroup?.remove(s);
        s.material.map.dispose();
        s.material.dispose();
        map.delete(key);
        this._needsRender = true;
      }
      return;
    }
    let s = map.get(key);
    if (!s) {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 68;
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
      s = new THREE.Sprite(mat);
      s.userData.canvas = canvas;
      s.renderOrder = 30;
      const cs = this.cellSize;
      const c = this._cellWorldCenter(cx, cz);
      s.position.set(c.x, this._maxHeight() * 0.6, c.z);
      s.scale.set(cs * 0.42, cs * 0.42 * (canvas.height / canvas.width), 1);
      this._rwOverlayGroup().add(s);
      map.set(key, s);
    }
    this._rwDrawLoadSprite(s, progress);
    this._needsRender = true;
  }

  _rwClearTileLoadOverlay() {
    if (!this._rwLoadSprites?.size) return;
    for (const key of [...this._rwLoadSprites.keys()]) {
      const [cx, cz] = key.split(',').map(Number);
      this._rwSetTileLoadProgress(cx, cz, null);
    }
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
    // A grazing preview projects as a detached line instead of a ground ring.
    // Keep the affordance for useful overhead and angled views only.
    if (Math.abs(this._tileRay.ray.direction.y) < 0.12) return null;
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
    this._onTilePointerLeave = () => {
      this._tileDownAt = null;
      if (this._tileGhostCell) {
        this._tileGhostCell = null;
        this._updateTileGhost();
      }
    };
    c.addEventListener('pointermove', this._onTilePointerMove);
    c.addEventListener('pointerdown', this._onTilePointerDown);
    c.addEventListener('pointerup', this._onTilePointerUp);
    c.addEventListener('pointerleave', this._onTilePointerLeave);
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

  _clearImportedMaps() {
    this._rwClearTileLoadOverlay();
    this._realWorldSyncGen = (this._realWorldSyncGen ?? 0) + 1;
    for (const type of ['noise', 'height', 'biome', 'imagery']) {
      this.importedMaps[type]?.texture?.dispose();
      this.importedMaps[type] = null;
      this._setImportState(type);
    }
    this.realWorldSource = null;
    this.realWorldBuildingsVisible = false;
    this.realWorldBuildingLayer?.clear();
    this._realWorldBuildingLayoutKey = '';
    this.realWorldImageryStyle = DEFAULT_IMAGERY_STYLE;
    this.cb.onRealWorldImageryStyle?.(DEFAULT_IMAGERY_STYLE);
    this.cb.onRealWorldBuildingsVisible?.(false);
    this._syncImportedMapUniforms();
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
      // File height imports are not geo-referenced — drop any OpenTopoMap layer
      // and the saved geographic source tied to a previous real-world load so
      // neither can silently return when this project is reopened.
      if (type === 'height') {
        this.realWorldSource = null;
        this.realWorldBuildingLayer?.clear();
        this._realWorldBuildingLayoutKey = '';
        if (this.importedMaps.imagery) {
          this.importedMaps.imagery.texture?.dispose();
          this.importedMaps.imagery = null;
          this._setImportState('imagery');
        }
      }
      this._rebuildImportedTexture(type);
      this.applyAll({ force: false, terrainDirty: type !== 'imagery' });
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
    const loc = getLocation(locationId);
    if (!loc) { this.cb.onToast('Unknown location.'); return false; }
    return this._loadRealWorldHeightmap(loc, { onProgress });
  }

  /**
   * Free lat/lon area picker variant — spec is { lat, lon, sizeKm, zoom }.
   * makeCustomLocation clamps every value to its valid range, so any slider
   * combination resolves to a loadable Mercator-domain request.
   */
  async loadRealWorldCustom(spec, { onProgress } = {}) {
    return this._loadRealWorldHeightmap(makeCustomLocation(spec), { onProgress });
  }

  async _loadRealWorldHeightmap(loc, { onProgress, persistedSource = null, silent = false } = {}) {
    if (this.worldMode !== 'studio') {
      this.cb.onToast('Real-world heightmaps load in Tile (Studio) mode.');
      return false;
    }
    const restoredSource = normalizeRealWorldSource(persistedSource);
    const imageryStyle = resolveImageryStyle(restoredSource?.imageryStyle ?? this.realWorldImageryStyle);
    const zoom = restoredSource?.zoom ?? effectiveZoomFor(loc);
    const source = restoredSource ?? createRealWorldSource({
      id: loc.id,
      name: loc.name,
      bbox: loc.bbox,
      zoom,
      imageryStyle: imageryStyle.id,
      buildingsVisible: this.realWorldBuildingsVisible === true,
    });
    if (!source) {
      this.cb.onToast('The geographic terrain settings are invalid.');
      return false;
    }
    // This descriptor intentionally outlives the fetched textures. Set it
    // before network work begins so a failed restore remains retryable and the
    // next local/cloud save does not lose the geographic source.
    this.realWorldSource = source;
    this.realWorldBuildingsVisible = source.buildingsVisible === true;
    this.realWorldImageryStyle = imageryStyle.id;
    this.cb.onRealWorldImageryStyle?.(imageryStyle.id);
    this.cb.onRealWorldBuildingsVisible?.(this.realWorldBuildingsVisible);
    this._setImportState('height', { loading: true, error: '' });
    this._setImportState('imagery', { loading: true, error: '' });
    try {
      // Raw-meters anchor patch for cell (0,0). The geo reference lets tile
      // expansion fetch the geographically ADJACENT area for each new cell.
      // Imagery RGB is fetched in parallel at the same zoom/bbox so albedo
      // lines up with elevation without a second geo lookup.
      let elevDone = 0, imgDone = 0;
      const report = () => onProgress?.((elevDone + imgDone) / 2);
      const [anchor, imageryAnchor] = await Promise.all([
        fetchBboxElevation(source.bbox, zoom, {
          onProgress: (p) => { elevDone = p; report(); },
        }),
        fetchBboxImagery(source.bbox, zoom, {
          style: imageryStyle.id,
          onProgress: (p) => { imgDone = p; report(); },
        }).catch((e) => {
          console.error(e);
          return null;
        }),
      ]);
      const previous = this.importedMaps.height;
      if (previous?.texture) previous.texture.dispose();
      this.importedMaps.height = {
        fileName: `${loc.name} (real-world)`,
        meta: { name: loc.name, zoom, source: ELEVATION_SOURCE },
        geoRef: {
          bbox0: { ...source.bbox },
          zoom,
          imageryStyle: imageryStyle.id,
          cells: { '0,0': anchor },
          imageryCells: imageryAnchor ? { '0,0': imageryAnchor } : {},
          // Buildings are opt-in because public OSM endpoints are separately
          // rate limited. Cells are populated only after the user enables them.
          buildingCells: {},
        },
        settings: { ...source.heightSettings },
      };
      const prevImg = this.importedMaps.imagery;
      if (prevImg?.texture) prevImg.texture.dispose();
      if (imageryAnchor) {
        this.importedMaps.imagery = {
          fileName: `${loc.name} (${imageryStyle.shortLabel})`,
          meta: { name: loc.name, zoom, source: imageryStyle.attribution, style: imageryStyle.id },
          settings: { ...source.imagerySettings },
        };
      } else {
        this.importedMaps.imagery = null;
        this._setImportState('imagery', {
          loading: false,
          error: `${imageryStyle.shortLabel} tiles could not be loaded.`,
        });
      }
      // Composite over the CURRENT assembly — also fetches neighbors for any
      // extra tiles already placed, so multi-tile boards load fully covered.
      await this._syncRealWorldNeighborTiles({ silent: true, includeBuildings: false });
      this._setImportState('height', { loading: false });
      if (this.importedMaps.imagery) this._setImportState('imagery', { loading: false });
      if (!silent) {
        this.cb.onToast(imageryAnchor
          ? `Loaded ${loc.name} + ${imageryStyle.shortLabel}`
          : `Loaded ${loc.name} (height only — map texture failed)`);
      }

      // Do not query the separately rate-limited OSM building service unless
      // the user explicitly enabled it. When enabled, keep that optional work
      // outside the main geographic loading overlay.
      const geoRef = this.importedMaps.height?.geoRef;
      const buildingTiles = this.tiles.map((tile) => ({ ...tile }));
      if (this.realWorldBuildingsVisible) Promise.allSettled(buildingTiles.map(async (tile) => {
        const key = `${tile.cx},${tile.cz}`;
        const bbox = offsetBbox(geoRef.bbox0, tile.cx, tile.cz);
        const patch = await fetchBboxBuildings(bbox);
        if (this.importedMaps.height?.geoRef !== geoRef) return;
        geoRef.buildingCells[key] = patch;
      })).then((results) => {
        if (this.importedMaps.height?.geoRef !== geoRef) return;
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            console.error(result.reason);
            const tile = buildingTiles[index];
            geoRef.buildingCells[`${tile.cx},${tile.cz}`] = { buildings: [], error: true };
          }
        });
        const buildingCount = this._rebuildRealWorldBuildings({ force: true });
        if (!silent && buildingCount) this.cb.onToast(`Loaded ${buildingCount} buildings`);
        const skipped = Object.values(geoRef.buildingCells).some((patch) => patch?.skipped === 'area-too-large');
        if (!silent && skipped) this.cb.onToast('3D buildings skipped: the selected area is too large for a public OSM query.');
      });
      return true;
    } catch (e) {
      console.error(e);
      const error = e?.name === 'AbortError'
        ? 'Load cancelled.'
        : 'Could not load elevation data (network or CORS blocked).';
      this._setImportState('height', { loading: false, error });
      this._setImportState('imagery', { loading: false });
      this.cb.onToast(error);
      return false;
    }
  }

  async _restoreRealWorldSource(input, { onProgress } = {}) {
    const source = normalizeRealWorldSource(input);
    if (!source) return false;
    return this._loadRealWorldHeightmap({
      id: source.id,
      name: source.name,
      bbox: { ...source.bbox },
      zoom: source.zoom,
    }, { persistedSource: source, silent: true, onProgress });
  }

  /**
   * Switch satellite vs topo map texture. Reloads imagery for the active
   * real-world geoRef without refetching elevation.
   */
  async setRealWorldImageryStyle(styleId) {
    const style = resolveImageryStyle(styleId);
    if (this.realWorldSource) {
      this.realWorldSource = updateRealWorldSourceImageryStyle(this.realWorldSource, style.id);
    }
    if (style.id === this.realWorldImageryStyle && this.importedMaps.height?.geoRef?.imageryStyle === style.id) {
      this.realWorldImageryStyle = style.id;
      this.cb.onRealWorldImageryStyle?.(style.id);
      return;
    }
    this.realWorldImageryStyle = style.id;
    this.cb.onRealWorldImageryStyle?.(style.id);

    const entry = this.importedMaps?.height;
    const geo = entry?.geoRef;
    if (!geo || this.worldMode !== 'studio') return;

    geo.imageryStyle = style.id;
    geo.imageryCells = {};
    entry.regionKey = null;

    const prevImg = this.importedMaps.imagery;
    if (prevImg?.texture) prevImg.texture.dispose();
    const savedImagerySettings = this.realWorldSource?.imagerySettings;
    this.importedMaps.imagery = {
      fileName: `${entry.meta?.name || 'Real-world'} (${style.shortLabel})`,
      meta: { name: entry.meta?.name, zoom: geo.zoom, source: style.attribution, style: style.id },
      settings: {
        ...(prevImg?.settings || savedImagerySettings || DEFAULT_IMPORT_SETTINGS),
        mode: prevImg?.settings?.mode || savedImagerySettings?.mode || 'replace',
        blend: prevImg?.settings?.blend ?? savedImagerySettings?.blend ?? 1,
      },
    };
    this._setImportState('imagery', { loading: true, error: '' });
    await this._syncRealWorldNeighborTiles({ silent: false });
    if (this.importedMaps.imagery && Object.keys(geo.imageryCells).length) {
      this._setImportState('imagery', { loading: false });
      this.cb.onToast(`Map texture → ${style.shortLabel}`);
    } else {
      this.importedMaps.imagery = null;
      this._setImportState('imagery', { loading: false, error: `${style.shortLabel} tiles could not be loaded.` });
    }
  }

  setRealWorldBuildingsVisible(visible) {
    this.realWorldBuildingsVisible = visible === true;
    if (this.realWorldSource) {
      this.realWorldSource = updateRealWorldSourceBuildingsVisible(
        this.realWorldSource,
        this.realWorldBuildingsVisible,
      );
    }
    if (this.realWorldBuildingLayer) {
      this.realWorldBuildingLayer.group.visible = this.realWorldBuildingsVisible
        && this.worldMode === 'studio';
    }
    if (this.realWorldBuildingsVisible) {
      this._rebuildRealWorldBuildings({ force: true });
      // Turning the layer back on is also an explicit retry opportunity for
      // any OSM cells that previously failed or were added while it was off.
      void this._syncRealWorldNeighborTiles({ silent: true });
    } else this._realWorldBuildingLayoutKey = '';
    this.cb.onRealWorldBuildingsVisible?.(this.realWorldBuildingsVisible);
    this._needsRender = true;
  }

  /**
   * Keep a real-world height import in sync with the tile assembly: fetch the
   * geographic neighbor patch for every cell that doesn't have one yet (same
   * zoom as the anchor → same detail), then composite all patches into one
   * union heightmap mapped over the assembly via uImportHeightRegion. Called
   * from _applyTileLayout on every add/remove/expand; a no-op without a geoRef.
   * Satellite / topo RGB patches stay in lockstep with elevation when present.
   */
  async _syncRealWorldNeighborTiles({
    silent = false,
    includeBuildings = this.realWorldBuildingsVisible,
  } = {}) {
    const entry = this.importedMaps?.height;
    const geo = entry?.geoRef;
    if (!geo || this.worldMode !== 'studio') return;
    if (!geo.imageryCells) geo.imageryCells = {};
    if (!geo.buildingCells) geo.buildingCells = {};
    const imageryStyle = resolveImageryStyle(geo.imageryStyle || this.realWorldImageryStyle);
    geo.imageryStyle = imageryStyle.id;
    const layoutKey = `${this.tiles.map((t) => `${t.cx},${t.cz}`).sort().join('|')}@${imageryStyle.id}`;
    const hasAllBuildingCells = !includeBuildings || this.tiles.every((tile) => {
      const patch = geo.buildingCells[`${tile.cx},${tile.cz}`];
      return patch && !patch.error && !patch.incomplete;
    });
    if (layoutKey === entry.regionKey && hasAllBuildingCells) return;
    const gen = (this._realWorldSyncGen = (this._realWorldSyncGen ?? 0) + 1);
    this._rwClearTileLoadOverlay();   // fresh run owns the overlay from here

    // Composite whatever patches exist (failed/not-yet-fetched cells pad with
    // the union minimum) so a network hiccup never leaves the import texture
    // broken — called after every tile resolves so the terrain grows in as
    // each patch arrives instead of waiting for the whole batch.
    const applyComposite = () => {
      if (this.importedMaps.height !== entry) return;
      const c = compositeCellPatches(geo.cells, this.tiles);
      entry.floatData = c.floatData;
      entry.width = c.width;
      entry.height = c.height;
      entry.originalWidth = c.width;
      entry.originalHeight = c.height;
      entry.preview = c.preview;
      entry.meta = { ...entry.meta, minElev: c.minElev, maxElev: c.maxElev };
      entry.regionBounds = c.bounds;   // world rect derived from cellSize in _syncImportedMapUniforms
      this._rebuildImportedTexture('height');

      const imgEntry = this.importedMaps.imagery;
      if (imgEntry && Object.keys(geo.imageryCells).length) {
        try {
          const ic = compositeCellImagery(geo.imageryCells, this.tiles);
          imgEntry.rgba = ic.rgba;
          imgEntry.width = ic.width;
          imgEntry.height = ic.height;
          imgEntry.originalWidth = ic.width;
          imgEntry.originalHeight = ic.height;
          imgEntry.preview = ic.preview;
          imgEntry.regionBounds = ic.bounds;
          this._rebuildImportedTexture('imagery');
        } catch (e) {
          console.error(e);
        }
      }
      // Real-world elevation is normalized 0..1 over [minElev,maxElev] then scaled
      // by heightScale — so the water plane (an absolute world height) needs to
      // sit at the world height that corresponds to TRUE elevation 0, not at
      // whatever the previous (procedural-tuned) seaLevel happened to be. Without
      // this, low-lying coastal areas (small span, minElev near 0) flood almost
      // entirely under the default seaLevel, while tall peaks correctly show none.
      const span = c.maxElev - c.minElev;
      if (span > 0) {
        const trueSeaWorldY = ((0 - c.minElev) / span) * (this.params.heightScale || 1);
        this.setParam('seaLevel', Math.max(0, trueSeaWorldY));
      }
      this.applyAll({ force: false });
    };

    const missingElev = this.tiles.filter((t) => !geo.cells[`${t.cx},${t.cz}`]);
    const missingImg = this.tiles.filter((t) => !geo.imageryCells[`${t.cx},${t.cz}`]);
    const missingBuildings = includeBuildings ? this.tiles.filter((t) => {
      const patch = geo.buildingCells[`${t.cx},${t.cz}`];
      return !patch || patch.error || patch.incomplete;
    }) : [];
    const missingKeys = new Set([
      ...missingElev.map((t) => `${t.cx},${t.cz}`),
      ...missingImg.map((t) => `${t.cx},${t.cz}`),
      ...missingBuildings.map((t) => `${t.cx},${t.cz}`),
    ]);
    const missing = this.tiles.filter((t) => missingKeys.has(`${t.cx},${t.cz}`));
    let failures = 0;
    if (missing.length) {
      // floating per-cell progress overlay — expansion never looks stalled
      for (const t of missing) this._rwSetTileLoadProgress(t.cx, t.cz, 0);
      if (!silent) {
        this._setImportState('height', { loading: true, error: '' });
        this.cb.onToast(missing.length === 1
          ? 'Loading adjacent real-world terrain…'
          : `Loading real-world terrain for ${missing.length} tiles…`);
      }
      // Fetch every missing tile concurrently — each one composites and
      // reveals its terrain the moment IT resolves, independent of the rest,
      // so a slow neighbor never delays the others.
      await Promise.all(missing.map(async (t) => {
        const key = `${t.cx},${t.cz}`;
        const bbox = offsetBbox(geo.bbox0, t.cx, t.cz);
        const wantElev = !geo.cells[key];
        const wantImg = !geo.imageryCells[key];
        const wantBuildings = includeBuildings && (
          !geo.buildingCells[key]
          || Boolean(geo.buildingCells[key]?.error)
          || Boolean(geo.buildingCells[key]?.incomplete)
        );
        try {
          let elevP = 0, imgP = 0, buildingP = 0;
          const reportCell = () => {
            if (gen !== this._realWorldSyncGen) return;
            const parts = (wantElev ? 1 : 0) + (wantImg ? 1 : 0) + (wantBuildings ? 1 : 0);
            const p = parts ? ((wantElev ? elevP : 0) + (wantImg ? imgP : 0) + (wantBuildings ? buildingP : 0)) / parts : 1;
            this._rwSetTileLoadProgress(t.cx, t.cz, p);
          };
          const jobs = [];
          if (wantElev) {
            jobs.push(fetchBboxElevation(bbox, geo.zoom, {
              onProgress: (p) => { elevP = p; reportCell(); },
            }).then((patch) => { geo.cells[key] = patch; }));
          }
          if (wantImg) {
            jobs.push(fetchBboxImagery(bbox, geo.zoom, {
              style: imageryStyle.id,
              onProgress: (p) => { imgP = p; reportCell(); },
            }).then((patch) => { geo.imageryCells[key] = patch; }).catch((e) => {
              console.error(e);
              failures++;
            }));
          }
          if (wantBuildings) {
            jobs.push(fetchBboxBuildings(bbox).then((loadedPatch) => {
              buildingP = 1;
              reportCell();
              const previousPatch = geo.buildingCells[key];
              let patch = loadedPatch;
              if (loadedPatch.incomplete && previousPatch?.buildings?.length) {
                const byId = new Map(previousPatch.buildings.map((building) => [building.id, building]));
                for (const building of loadedPatch.buildings) byId.set(building.id, building);
                patch = { ...loadedPatch, buildings: [...byId.values()] };
              }
              geo.buildingCells[key] = patch;
              if (patch.incomplete) failures++;
            }).catch((e) => {
              console.error(e);
              buildingP = 1;
              reportCell();
              failures++;
              // Keep terrain/imagery success independent from optional OSM
              // data, but leave the cell missing so expansion or re-enabling
              // buildings retries it instead of caching a permanent hole.
              delete geo.buildingCells[key];
            }));
          }
          await Promise.all(jobs);
        } catch (e) {
          console.error(e);
          failures++;
        }
        // a newer layout change superseded this run — it re-syncs everything
        // (and reset the overlay at its start, so no cleanup needed here)
        if (gen !== this._realWorldSyncGen) return;
        this._rwSetTileLoadProgress(t.cx, t.cz, null);
        applyComposite();   // reveal this tile's terrain now, don't wait on the rest
      }));
      if (gen !== this._realWorldSyncGen) return;
    } else {
      applyComposite();
    }
    if (gen !== this._realWorldSyncGen) return;   // newer run owns the overlay now
    this._rwClearTileLoadOverlay();
    if (this.importedMaps.height !== entry) return;

    entry.regionKey = failures === 0 ? layoutKey : null;   // retry failed cells on the next layout change
    if (!silent) {
      this._setImportState('height', { loading: false });
      if (this.importedMaps.imagery) this._setImportState('imagery', { loading: false });
      if (failures > 0) this.cb.onToast('Some real-world tiles could not be loaded (network or CORS blocked).');
      else if (missing.length) this.cb.onToast('Real-world terrain extended');
    } else if (failures > 0) {
      this.cb.onToast('Some real-world tiles could not be loaded (network or CORS blocked).');
    }
  }

  setTileMapSetting(type, key, value) {
    const entry = this.importedMaps[type];
    if (!entry) { this._setImportState(type, { error: 'Import a map before enabling this mode.' }); return; }
    entry.settings[key] = value;
    if (this.realWorldSource && (type === 'height' || type === 'imagery')) {
      this.realWorldSource = updateRealWorldSourceSettings(this.realWorldSource, type, entry.settings);
    }
    if (key === 'invert' || key === 'normalize') this._rebuildImportedTexture(type);
    this._syncImportedMapUniforms();
    this._setImportState(type);
    this.applyAll({ force: false, terrainDirty: type !== 'imagery' });
    if (type === 'height') this._rebuildRealWorldBuildings();
  }

  _setImportState(type, patch = {}) {
    const entry = this.importedMaps[type];
    this.importedMapState = { ...this.importedMapState, [type]: entry ? { fileName: entry.fileName, width: entry.width, height: entry.height, preview: entry.preview, settings: { ...entry.settings }, warning: entry.originalWidth > 4096 || entry.originalHeight > 4096 ? 'Large image downscaled for processing.' : '', ...patch } : { ...patch } };
    this.cb.onImportedMaps?.(this.importedMapState);
  }

  _rebuildImportedTexture(type) {
    const entry = this.importedMaps[type];
    if (!entry) return;
    if (type === 'imagery') {
      this._rebuildImportedColorTexture(entry);
      return;
    }
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

  /** RGB OpenTopoMap (or other geo imagery) — UnsignedByte, not HalfFloat luminance. */
  _rebuildImportedColorTexture(entry) {
    if (!entry?.rgba || !entry.width || !entry.height) return;
    const data = new Uint8Array(entry.rgba);
    entry.texture?.dispose();
    entry.texture = new THREE.DataTexture(data, entry.width, entry.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    entry.texture.colorSpace = THREE.SRGBColorSpace;
    entry.texture.wrapS = entry.texture.wrapT = THREE.ClampToEdgeWrapping;
    entry.texture.minFilter = entry.texture.magFilter = THREE.LinearFilter;
    entry.texture.flipY = false;
    entry.texture.needsUpdate = true;
    this._syncImportedMapUniforms();
    this._setImportState('imagery');
  }

  _syncImportedMapUniforms() {
    for (const type of ['noise', 'height', 'biome', 'imagery']) {
      const e = this.importedMaps[type];
      const cap = type[0].toUpperCase() + type.slice(1);
      if (!this.uniforms[`uImport${cap}Tex`]) continue;
      this.uniforms[`uImport${cap}Tex`].value = e?.texture ?? null;
      this.uniforms[`uImport${cap}Mode`].value = e ? (IMPORT_MODES[e.settings.mode] ?? 0) : 0;
      if (this.uniforms[`uImport${cap}Blend`]) this.uniforms[`uImport${cap}Blend`].value = e?.settings.blend ?? 1;
    }
    const h = this.importedMaps.height;
    this.uniforms.uImportHeightStrength.value = h?.settings.heightStrength ?? 1;
    this.uniforms.uImportHeightOffset.value = h?.settings.heightOffset ?? 0;
    // World rect the height map covers. Real-world composites span the tile
    // union (regionBounds, in cells — derived here so cellSize changes track);
    // everything else keeps the classic single origin cell.
    // Imagery shares this region so OpenTopoMap stays registered to elevation.
    const region = this.uniforms.uImportHeightRegion?.value;
    if (region) {
      const b = h?.regionBounds || this.importedMaps.imagery?.regionBounds;
      const cs = this.cellSize;
      if (b) region.set((b.minX - 0.5) * cs, (b.minZ - 0.5) * cs, b.cols * cs, b.rows * cs);
      else region.set(-cs / 2, -cs / 2, cs, cs);
    }
    this._needsRender = true;
  }

  _sampleRealWorldHeight(x, z) {
    const entry = this.importedMaps.height;
    const bounds = entry?.regionBounds;
    const data = entry?.floatData;
    if (!entry?.geoRef || !bounds || !data?.length || !entry.width || !entry.height) {
      return this._getCpuHeightSampler().heightAt(x, z);
    }
    const originX = (bounds.minX - 0.5) * this.cellSize;
    const originZ = (bounds.minZ - 0.5) * this.cellSize;
    const spanX = bounds.cols * this.cellSize;
    const spanZ = bounds.rows * this.cellSize;
    const u = Math.max(0, Math.min(1, (x - originX) / Math.max(1, spanX)));
    const v = Math.max(0, Math.min(1, (z - originZ) / Math.max(1, spanZ)));
    const fx = u * (entry.width - 1), fy = v * (entry.height - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(entry.width - 1, x0 + 1), y1 = Math.min(entry.height - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const top = data[y0 * entry.width + x0] * (1 - tx) + data[y0 * entry.width + x1] * tx;
    const bottom = data[y1 * entry.width + x0] * (1 - tx) + data[y1 * entry.width + x1] * tx;
    let normalized = top * (1 - ty) + bottom * ty;
    if (entry.settings?.invert) normalized = 1 - normalized;
    const imported = normalized * (this.params.heightScale || 1)
      * (entry.settings?.heightStrength ?? 1) + (entry.settings?.heightOffset ?? 0);
    const mode = entry.settings?.mode;
    const procedural = mode === 'replace' ? 0 : this._getCpuHeightSampler().heightAt(x, z);
    let height = mode === 'blend'
      ? procedural + (imported - procedural) * (entry.settings?.blend ?? 1)
      : (mode === 'replace' ? imported : procedural);
    height *= this.uniforms.uPaintBaseMult?.value ?? 1;
    // The CPU procedural sampler already includes erosion; a replaced real-world
    // field does not, so add it explicitly in that mode.
    if (mode === 'replace' && this.erosionField?.enabled) height += this.erosionField.offsetAt(x, z);
    height += this._samplePaintHeightOffset(x, z)
      + this._sampleManualHeightOffset(x, z)
      + this._sampleSplineHeightOffset(x, z);
    return height;
  }

  _rebuildRealWorldBuildings({ force = false } = {}) {
    const entry = this.importedMaps?.height;
    const geo = entry?.geoRef;
    if (!this.realWorldBuildingLayer || !geo?.buildingCells || !this.realWorldSource) {
      this.realWorldBuildingLayer?.clear();
      this._realWorldBuildingLayoutKey = '';
      return 0;
    }
    this.realWorldBuildingLayer.group.visible = this.realWorldBuildingsVisible
      && this.worldMode === 'studio';
    if (!this.realWorldBuildingsVisible) {
      this._realWorldBuildingLayoutKey = '';
      return this.realWorldBuildingLayer.count;
    }
    const cellSummary = Object.entries(geo.buildingCells)
      .map(([key, patch]) => `${key}:${patch?.buildings?.length ?? 0}`)
      .sort()
      .join('|');
    const settings = entry.settings || {};
    const layoutKey = [
      this.tiles.map((tile) => `${tile.cx},${tile.cz}`).sort().join('|'),
      cellSummary,
      this.cellSize,
      this.params.heightScale,
      entry.meta?.minElev,
      entry.meta?.maxElev,
      settings.mode,
      settings.blend,
      settings.invert,
      settings.heightStrength,
      settings.heightOffset,
    ].join('@');
    if (!force && layoutKey === this._realWorldBuildingLayoutKey) return this.realWorldBuildingLayer.count;
    this._realWorldBuildingLayoutKey = layoutKey;
    const count = this.realWorldBuildingLayer.rebuild({
      cells: geo.buildingCells,
      bbox0: geo.bbox0,
      zoom: geo.zoom,
      tiles: this.tiles,
      cellSize: this.cellSize,
      heightScale: this.params.heightScale || 1,
      elevationSpan: (entry.meta?.maxElev ?? 1) - (entry.meta?.minElev ?? 0),
      sampleHeight: (worldX, worldZ) => this._sampleRealWorldHeight(worldX, worldZ),
    });
    this._needsRender = true;
    return count;
  }

  setParam(key, value) {
    this._pendingTerrainParams ||= {};
    if (DEFERRED_TERRAIN_KEYS.has(key) && !this.params.autoUpdate) {
      const current = Object.hasOwn(this._pendingTerrainParams, key)
        ? this._pendingTerrainParams[key]
        : this.params[key];
      if (Object.is(current, value)) return;
      if (Object.is(this.params[key], value)) {
        delete this._pendingTerrainParams[key];
      } else {
        this._pendingTerrainParams[key] = value;
      }
      this.cb.onParams(this._paramsSnapshot());
      const hasPending = Object.keys(this._pendingTerrainParams).length > 0
        || !!this._pendingNoiseStack;
      this.cb.onStatus(
        hasPending ? 'Pending changes — enable Auto Update to apply' : 'Ready',
        hasPending,
      );
      return;
    }

    if (key === 'surfaceTextureSource') {
      const surfaceTextureSource = normalizeSurfaceTextureSource({ surfaceTextureSource: value });
      if (this.params.surfaceTextureSource === surfaceTextureSource
          && this.params.surfaceTextureMode
            === (surfaceTextureSource !== SURFACE_TEXTURE_SOURCE.PROCEDURAL)) return;
      this.params.surfaceTextureSource = surfaceTextureSource;
      this.params.surfaceTextureMode = surfaceTextureSource !== SURFACE_TEXTURE_SOURCE.PROCEDURAL;
    } else if (key === 'surfaceTextureMode') {
      const surfaceTextureSource = normalizeSurfaceTextureSource({ surfaceTextureMode: !!value });
      if (this.params.surfaceTextureSource === surfaceTextureSource
          && this.params.surfaceTextureMode
            === (surfaceTextureSource !== SURFACE_TEXTURE_SOURCE.PROCEDURAL)) return;
      this.params.surfaceTextureSource = surfaceTextureSource;
      this.params.surfaceTextureMode = surfaceTextureSource !== SURFACE_TEXTURE_SOURCE.PROCEDURAL;
    } else {
      if (Object.is(this.params[key], value)) return;
      this.params[key] = value;
    }
    this.cb.onParams(this._paramsSnapshot());
    this._needsRender = true;   // any param change → redraw (on-demand studio)

    // erosion params: erosionEnabled is the live before/after toggle (applies
    // the already-baked offset); every other erosion* knob only affects the
    // NEXT bake, so it just stores. Never triggers a terrain rebuild.
    if (key === 'erosionEnabled') {
      this.erosionField.setEnabled(value);
      this.erosionField.applyTo(this.uniforms);
      this._onErosionChanged();
      return;
    }
    if (key.startsWith('erosion')) {
      if (key === 'erosionPreset') this.applyErosionPreset(value);
      return;
    }

    // Dynamic Noise Modifier Addition:
    // If the active noise stack doesn't have any enabled legacy layer, intercept adjustments
    // to classic sliders and inject/update appropriate modifier/height layers.
    const stackCompat = this._stackWithCompatParam(
      this.noiseStack,
      key,
      value,
      { notify: true },
    );
    if (stackCompat.updated) {
      this.setNoiseStack(stackCompat.stack);
      return;
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

    if (isVisualKey(key)) {
      this._applyVisualSettings();
      this._applySkyboxSettings();
      return;
    }

    if (key === 'surfaceTextureSource' || key.startsWith('surfaceTexture')) {
      this._applySurfaceSettings();
      void this._ensureTerrainShaderVariantAsync();
      return;
    }

    // planet geometry params: rebuild the cube-sphere (chunk layout / radius).
    // These come from discrete dropdowns (one change at a time), so rebuild
    // immediately — App wraps the change in a loading overlay so the brief
    // freeze is covered. _rebuildPlanet refreshes uniforms itself.
    if (key === 'planetRadius' || key === 'planetFaceGrid') {
      if (this.worldMode === 'planet') {
        void this._rebuildPlanetStackMaterialsAsync(this._stackGLSL, {
          label: 'Rebuilding planet',
          atomic: true,
          rebuildGeometry: true,
        });
      } else {
        this._applyUniforms();
      }
      return;
    }

    if (key === 'autoUpdate') {
      // Replacing the old Regenerate footer: turning Auto Update back on
      // applies any shape edits that were deferred while it was off.
      const committed = value
        ? this._commitPendingTerrainParams()
        : { paramsChanged: false };
      if (committed.paramsChanged && !committed.stackChanged) {
        this.applyAll({ force: false, terrainDirty: true });
      }
      return;
    }

    if (key === 'waterEnabled' && value && this._waterDeferred) {
      this._warmDeferredWater();
    }
    if (key === 'octaves' && this.worldMode !== 'planet') {
      this._afterParamChange(false, false);
      return;
    }
    this._afterParamChange(REBUILD_KEYS.has(key), TERRAIN_FIELD_KEYS.has(key));
  }

  applyPresetByKey(presetKey) {
    this._clearPendingTerrainParams(
      [...TERRAIN_FIELD_KEYS].filter((key) => key !== 'seed'),
    );
    this._pendingNoiseStack = null;
    this._pendingNoiseSolo = null;
    this.params = applyPreset(this.params, presetKey);
    const defaultStack = migrateStack(undefined);
    this.setNoiseStack(defaultStack, { force: true });
    // A preset may also carry a colour palette (e.g. Cartoon) — switch the
    // terrain colours together with the shape so it's a single click.
    const preset = PRESETS[presetKey];
    if (preset?.palettePreset) {
      this.planetStyle.applyPalettePreset(preset.palettePreset);
      this._notifyPlanetStyle();
    }
    this.cb.onParams({ ...this.params });
    this._afterParamChange(true, true);
  }

  regenerate() {
    const committed = this._commitPendingTerrainParams();
    if (!committed.stackChanged) {
      this.applyAll({ force: false, terrainDirty: true });
    }
  }

  randomizeSeed() {
    this.setParam('seed', (Math.random() * 0xffffffff) >>> 0);
  }

  newProject({
    silent = false,
    projectMode = 'procedural',
    workspacePreset = null,
    seed = null,
    presetKey = null,
    noiseStackPresetKey = null,
  } = {}) {
    this.projectMode = projectMode === 'nodes' ? 'nodes' : projectMode === 'manual' ? 'manual' : 'procedural';
    this.workspacePreset = workspacePreset === 'real-terrain' ? 'real-terrain' : null;
    this._clearPendingTerrainParams();
    this.params = { ...DEFAULT_PARAMS };
    if (this.projectMode === 'procedural' && PRESETS[presetKey]) {
      this.params = applyPreset(this.params, presetKey);
    }
    const noiseStackRecipe = this.projectMode === 'procedural'
      ? buildNoiseStackPresetRecipe(noiseStackPresetKey)
      : null;
    if (noiseStackRecipe) Object.assign(this.params, noiseStackRecipe.terrainParams);
    if (Number.isFinite(Number(seed))) this.params.seed = Number(seed) >>> 0;
    this.planetStyle.reset();
    if (this.projectMode === 'procedural' && PRESETS[presetKey]?.palettePreset) {
      this.planetStyle.applyPalettePreset(PRESETS[presetKey].palettePreset);
    }

    // Establish the requested classic stack before the single applyAll below.
    // The previous order rendered the old project stack, reset the stack in a
    // second pass, then changed the seed in a third pass. Besides wasted work,
    // that exposed exactly the transient default/old terrain seen at startup.
    const defaultStack = noiseStackRecipe?.stack ?? migrateStack(undefined);
    this.noiseStack = defaultStack;
    this.params.noiseStack = defaultStack;
    this._soloLayerId = null;
    this._pendingNoiseStack = null;
    this._pendingNoiseSolo = null;
    this._stackGLSL = generateStackGLSL(defaultStack);
    this._stackSig = this._stackGLSL.sig;
    if (this.projectMode === 'nodes' || this.projectMode === 'manual') {
      Object.assign(this.params, {
        falloff: 0,
        seaLevel: 0,
        waterMode: 'off',
        waterEnabled: false,
        propsEnabled: false,
        surfaceTextureAmount: 0,
        visualsTerrainColorVariation: 0.08,
        visualsTerrainHeightDetail: 0.12,
        visualsWetShoreStrength: 0,
      });
    }
    if (this.projectMode === 'manual') {
      Object.assign(this.params, {
        surfaceTextureSource: SURFACE_TEXTURE_SOURCE.BUILT_IN,
        surfaceTextureMode: true,
        surfaceTextureAmount: 1,
        surfaceTexturePaletteInfluence: 0,
        surfaceTextureBreakup: 0,
        surfaceTextureTriplanar: true,
      });
    }
    if (this.projectMode === 'nodes') {
      this.planetStyle.setStyle({
        planetPreset: 'custom',
        palettePreset: 'custom',
        palette: NODE_NEUTRAL_PALETTE,
        paletteSaturation: 0.16,
        paletteContrast: 0.94,
        paletteTint: [1, 1, 1],
        customEdits: false,
      });
    }
    this._syncPlanetStyleToParams();

    // A new project must not inherit any authoring data from the previous
    // terrain. Clear both the baked masks and their source data, including an
    // unfinished spline draft, before rebuilding the fresh terrain.
    this.splineManager?.clear();
    this.splineManager?.setEditingEnabled(false);
    this.paintMode?.setEnabled(false);
    this.paintMode?.clear({ silent });
    this.paintMode?.setBaseMode(this.projectMode === 'manual' ? 'flat' : 'generated');
    this.paintMode?.setState({ layerOpacity: 1 });
    this.setTimeOfDay(DEFAULT_TIME_OF_DAY);
    this.manualTerrain?.setEnabled(false);
    this.manualTerrain?.load({ version: 5, baseSource: 'flat', shapes: [] }, { emit: false });
    this.manualTerrain?.setEnabled(this.projectMode === 'manual', { silent: true });
    this._bindAuthoringMaskTextures();
    this.terrainAnalysis?.load();
    this.generationSource = this._generationSourceForProject();
    this.terrainGraph = this.projectMode === 'nodes' ? createBlankGraph() : null;
    this.graphView = { x: 0, y: 0, zoom: 1 };
    const compiled = this.terrainGraph ? compileTerrainGraph(this.terrainGraph) : null;
    this._graphProgram = compiled?.ok ? compiled.program : null;
    this._graphDiagnostics = compiled?.diagnostics || [];
    this.cb.onProjectMode?.(this.projectMode);
    this.cb.onGenerationSource?.(this.generationSource);
    this.cb.onTerrainGraph?.(this.terrainGraph ? structuredClone(this.terrainGraph) : null);
    this.cb.onGraphState?.({ valid: !this.terrainGraph || compiled?.ok === true, compiling: false, diagnostics: structuredClone(this._graphDiagnostics), slotCount: this._graphProgram?.slotCount || 0, colorSlotCount: this._graphProgram?.colorSlotCount || 0 });
    this.cb.onGraphView?.({ ...this.graphView });

    this.tileAssemblyShape = 'square';
    this.circleRadiusCells = 0;
    this.tiles = [{ cx: 0, cz: 0 }];   // collapse any multi-tile assembly
    this._tileGhostCell = null;
    // Drop imported maps and their lightweight geographic source descriptor —
    // a fresh project always starts procedural.
    this._clearImportedMaps();
    // Drop any baked erosion: its delta is anchored to the OLD board region, so
    // keeping it would smear the previous (possibly larger / multi-tile) carve
    // over the fresh small default board. params already reset erosion* knobs.
    this.erosionField?.clear();
    this.erosionField?.applyTo(this.uniforms);
    // newProject mutates the complete document in one pass instead of routing
    // every preset field through setParam(). Publish that finished snapshot so
    // React panels do not keep rendering the previous project's stack.
    this.cb.onParams(this._paramsSnapshot());
    this.applyAll({ force: true });
    this._onErosionChanged();
    this._notifyTiles();

    this._syncCpuHeightProgram();

    this.controls.reset(this.boardSize);
    if (!silent) {
      const label = this.projectMode === 'nodes'
        ? 'New Nodes terrain'
        : this.projectMode === 'manual'
          ? 'New Manual Terrain'
          : 'New procedural terrain';
      this.cb.onToast(label);
    }
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
    const style = this.planetStyle?.getStyle?.() ?? this.params.planetStyle ?? {};
    return {
      ...this.params,
      ...this._pendingTerrainParams,
      noiseStack: this._pendingNoiseStack ?? this.params.noiseStack,
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
    this._syncCloudLighting();
    this._applyStudioFogFromStyle();
    this._applyStudioSunFromStyle();
    this._minimapDirtyAt = performance.now();
    this.minimap.requestRedraw();
  }

  _applyStudioSunFromStyle() {
    if (this.worldMode === 'infinite' || this._skyActive()) return;
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
    const overlay = this._rwLoadGroup;
    const overlayWas = !!overlay && overlay.visible;
    if (overlayWas) overlay.visible = false;
    this.minimap.renderBase();
    if (wasVisible) sky.setVisible(true);
    if (overlayWas) overlay.visible = true;
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
    const { style, params, perf } = this.planetStyle.applyPlanetPreset(key);
    this._clearPendingTerrainParams(Object.keys(params));
    for (const [k, v] of Object.entries(params)) this.params[k] = v;
    const resetsFormationLevel = Object.hasOwn(params, 'seaLevel');
    if (resetsFormationLevel) {
      this.params.terrainFormationSeaLevel = this.params.seaLevel;
    }
    if (perf && Object.keys(perf).length) {
      this.perf = sanitizePerfSettings({ ...this.perf, ...perf, preset: 'custom' });
      this.qualityPreset = this.perf.preset;
      this._applyPerformance();
      this._notifyPerf();
    }
    this.params.planetPreset = style.planetPreset;
    this.params.palettePreset = style.palettePreset;
    this.params.noisePreset = style.noisePreset;
    this.params.planetStyle = style;
    this.cb.onParams(this._paramsSnapshot());
    const changedKeys = [
      ...Object.keys(params),
      ...(resetsFormationLevel ? ['terrainFormationSeaLevel'] : []),
    ];
    this._afterParamChange(
      changedKeys.some((k) => REBUILD_KEYS.has(k)),
      changedKeys.some((k) => TERRAIN_FIELD_KEYS.has(k)),
    );
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
    this._clearPendingTerrainParams(Object.keys(params));
    this.params.noisePreset = key;
    for (const [k, v] of Object.entries(params)) this.params[k] = v;
    this.cb.onParams(this._paramsSnapshot());
    this._afterParamChange(
      false,
      Object.keys(params).some((k) => TERRAIN_FIELD_KEYS.has(k)),
    );
    this.cb.onToast(`Noise: ${key}`);
  }

  /**
   * Apply a Noise Layers recipe as one authored operation. Unlike the older
   * style-level Noise preset above, this replaces the serialized Noise Stack
   * and may also tune a deliberately small set of global terrain controls.
   */
  applyNoiseStackPresetByKey(key) {
    const recipe = buildNoiseStackPresetRecipe(key);
    if (!recipe) return Promise.resolve({ error: new Error(`Unknown noise stack preset: ${key}`) });

    const patch = recipe.terrainParams;
    const patchKeys = Object.keys(patch);
    if (!this.params.autoUpdate) {
      this._pendingTerrainParams ||= {};
      for (const [paramKey, value] of Object.entries(patch)) {
        if (Object.is(this.params[paramKey], value)) delete this._pendingTerrainParams[paramKey];
        else this._pendingTerrainParams[paramKey] = value;
      }
      return this.setNoiseStack(recipe.stack, { solo: null, force: false });
    }

    const previousParams = Object.fromEntries(patchKeys.map((paramKey) => [paramKey, this.params[paramKey]]));
    this._clearPendingTerrainParams(patchKeys);
    Object.assign(this.params, patch);

    const result = this.setNoiseStack(recipe.stack, { solo: null, force: true });
    return Promise.resolve(result).then((compileResult) => {
      if (compileResult?.error) {
        Object.assign(this.params, previousParams);
        this._applyUniforms();
        this.cb.onParams(this._paramsSnapshot());
        return compileResult;
      }

      // setNoiseStack owns terrain invalidation for the structural swap. This
      // pass publishes the companion controls and refreshes their live uniforms.
      this._applyUniforms();
      this.cb.onParams(this._paramsSnapshot());
      this._minimapDirtyAt = performance.now();
      this.minimap.requestRedraw();
      this._needsRender = true;
      this.cb.onToast(`Noise stack: ${key}`);
      return compileResult;
    });
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
    this._clearPendingTerrainParams(Object.keys(params));
    for (const [k, v] of Object.entries(params)) this.params[k] = v;
    const resetsFormationLevel = Object.hasOwn(params, 'seaLevel');
    if (resetsFormationLevel) {
      this.params.terrainFormationSeaLevel = this.params.seaLevel;
    }
    this.params.planetPreset = style.planetPreset;
    this.params.palettePreset = style.palettePreset;
    this.params.noisePreset = style.noisePreset;
    this.params.planetStyle = style;
    this.cb.onParams(this._paramsSnapshot());
    this._afterParamChange(
      false,
      resetsFormationLevel
        || Object.keys(params).some((k) => TERRAIN_FIELD_KEYS.has(k)),
    );
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

  _markTerrainFieldDirty() {
    this._terrainGen++;
    this._bakedStudioGen = -1;
    this._bakedTerrainGen = -1;
    // A stale cache must never be mixed with the new terrain field. Disable it
    // immediately, but keep the final terrain and water materials visible: both
    // shaders evaluate the same live height program until the replacement
    // height/climate pair is published atomically.
    if (this.worldMode === 'studio') {
      if (this.uniforms?.uUseTerrainHeightTex) {
        this.uniforms.uUseTerrainHeightTex.value = 0.0;
      }
      if (this.uniforms?.uUseTerrainBiomeTex) {
        this.uniforms.uUseTerrainBiomeTex.value = 0.0;
      }
      if (this.uniforms?.uUseWaterTerrainBiomeTex) {
        this.uniforms.uUseWaterTerrainBiomeTex.value = 0.0;
      }
    }
    this.heightSampler?.invalidate?.();
    this.propSurfaceField?.invalidate?.();
    this._needsRender = true;
  }

  /**
   * Keep the classic terrain sliders meaningful for stacks that no longer have
   * an enabled Legacy layer. The same transform is used for live and staged
   * Auto Update edits so applying a staged value cannot silently skip it.
   */
  _stackWithCompatParam(stack, key, value, { notify = false } = {}) {
    if (!stack
        || !STACK_COMPAT_PARAM_KEYS.has(key)
        || stack.layers?.some((layer) => layer.type === 'legacy' && layer.enabled)) {
      return { stack, updated: false };
    }
    const next = cloneStack(stack);
    let updated = false;
    let toast = null;
    if (key === 'warp') {
      const layer = next.layers.find((entry) => entry.type === 'domainWarp');
      if (layer) {
        layer.strength = value;
        updated = true;
      } else if (value > 0.05) {
        next.layers.unshift(makeLayer('domainWarp', {
          name: 'Domain Warp (Auto)',
          strength: value,
        }));
        toast = 'Domain Warp layer added to stack';
        updated = true;
      }
    } else if (key === 'ridge') {
      const layer = next.layers.find((entry) => entry.type === 'ridged');
      if (layer) {
        layer.strength = value;
        updated = true;
      } else if (value > 0.05) {
        next.layers.push(makeLayer('ridged', {
          name: 'Ridged Mountains (Auto)',
          strength: value,
        }));
        toast = 'Ridged Mountains layer added to stack';
        updated = true;
      }
    } else {
      let layer = next.layers.find((entry) => entry.params && key in entry.params);
      if (!layer) {
        layer = makeLayer('fbm', { name: 'FBM Detail (Auto)' });
        next.layers.push(layer);
        toast = 'FBM Detail layer added to stack';
      }
      layer.params[key] = value;
      updated = true;
    }
    if (notify && toast) this.cb.onToast?.(toast);
    return { stack: next, updated };
  }

  _commitPendingTerrainParams() {
    const entries = Object.entries(this._pendingTerrainParams || {});
    let pendingStack = this._pendingNoiseStack;
    const pendingSolo = pendingStack
      ? this._pendingNoiseSolo
      : this._soloLayerId;
    for (const [key, value] of entries) {
      const transformed = this._stackWithCompatParam(
        pendingStack ?? this.noiseStack,
        key,
        value,
        { notify: true },
      );
      if (transformed.updated) pendingStack = transformed.stack;
    }
    if (entries.length) Object.assign(this.params, Object.fromEntries(entries));
    this._pendingTerrainParams = {};
    this._pendingNoiseStack = null;
    this._pendingNoiseSolo = null;
    if (pendingStack) {
      this.setNoiseStack(pendingStack, { solo: pendingSolo, force: true });
    }
    this.cb.onParams(this._paramsSnapshot());
    return {
      paramsChanged: entries.length > 0,
      stackChanged: !!pendingStack,
    };
  }

  _clearPendingTerrainParams(keys = null) {
    if (!keys) {
      this._pendingTerrainParams = {};
      this._pendingNoiseStack = null;
      this._pendingNoiseSolo = null;
      return;
    }
    for (const key of keys) delete this._pendingTerrainParams[key];
  }

  _afterParamChange(needsRebuild, terrainDirty = false) {
    if (needsRebuild) this.applyAll({ force: false, terrainDirty });
    else {
      if (terrainDirty) this._markTerrainFieldDirty();
      this._applyUniforms();
    }
    if (terrainDirty && !needsRebuild && this.realWorldSource) {
      this._rebuildRealWorldBuildings({ force: true });
    }
    this._minimapDirtyAt = performance.now();
    this.minimap.requestRedraw();
  }

  // -------------------------------------------------------------- noise stack

  _packNoiseUniforms() {
    const u = this.uniforms;
    const liveStack = this._liveNoiseStack ?? this.noiseStack;
    const liveGraph = this._liveGenerationSource === 'graph'
      ? this._liveGraphProgram
      : null;
    const graphActive = this.worldMode === 'studio' && liveGraph;
    const graphPack = graphActive ? liveGraph.packUniforms() : null;
    const normalize = graphPack ? graphPack.normalize : liveStack?.normalizeOutput;
    const outputMin = graphPack ? graphPack.outMin : liveStack?.outputMin;
    const outputMax = graphPack ? graphPack.outMax : liveStack?.outputMax;
    if (u.uStackNormalize) u.uStackNormalize.value = normalize ? 1.0 : 0.0;
    if (u.uStackOutMin) u.uStackOutMin.value = Number.isFinite(outputMin) ? outputMin : 0.0;
    if (u.uStackOutMax) {
      const outMin = Number.isFinite(outputMin) ? outputMin : 0.0;
      const outMax = Number.isFinite(outputMax) ? outputMax : 1.35;
      u.uStackOutMax.value = Math.max(outMin + 0.0001, outMax);
    }

    const p = graphPack || packStackUniforms(
      liveStack,
      { solo: this._liveSoloLayerId },
    );
    for (let i = 0; i < p.strength.length; i++) {
      u.uLayerStrength.value[i] = p.strength[i];
      u.uLayerScale.value[i] = p.scale[i];
      u.uLayerSeed.value[i] = p.seed[i];
      u.uLayerParamsA.value[i].set(p.paramsA[i][0], p.paramsA[i][1], p.paramsA[i][2], p.paramsA[i][3]);
      u.uLayerParamsB.value[i].set(p.paramsB[i][0], p.paramsB[i][1], p.paramsB[i][2], p.paramsB[i][3]);
      u.uLayerMaskA.value[i].set(p.maskA[i][0], p.maskA[i][1], p.maskA[i][2], p.maskA[i][3]);
      u.uLayerMaskB.value[i].set(p.maskB[i][0], p.maskB[i][1], p.maskB[i][2], p.maskB[i][3]);
      if (u.uLayerMaskC) u.uLayerMaskC.value[i].set(p.maskC[i][0], p.maskC[i][1], p.maskC[i][2], p.maskC[i][3]);
    }
    if (p.colorA && u.uGraphColorA) {
      for (let i = 0; i < p.colorA.length; i++) {
        u.uGraphColorA.value[i].set(...p.colorA[i]);
        u.uGraphColorB.value[i].set(...p.colorB[i]);
        u.uGraphColorC.value[i].set(...p.colorC[i]);
        u.uGraphColorD.value[i].set(...p.colorD[i]);
        u.uGraphColorParams.value[i].set(...p.colorParams[i]);
      }
    }
  }

  /**
   * Replace the live Noise Stack. Continuous edits = uniform repack (instant).
   * Structural edits (add/remove/reorder/type/blend/mask/octave) regenerate the
   * GLSL and recompile materials in the background, mirroring _setOctavesAsync.
   */
  setNoiseStack(stack, { solo = this._soloLayerId, force = false } = {}) {
    if (!this.params.autoUpdate && !force) {
      const pending = this._pendingNoiseStack ?? this.noiseStack;
      if (JSON.stringify(stack) === JSON.stringify(pending)
          && solo === (this._pendingNoiseSolo ?? this._soloLayerId)) return;
      this._soloLayerId = solo;
      if (JSON.stringify(stack) === JSON.stringify(this.noiseStack)
          && solo === this._liveSoloLayerId) {
        this._pendingNoiseStack = null;
        this._pendingNoiseSolo = null;
      } else {
        this._pendingNoiseStack = cloneStack(stack);
        this._pendingNoiseSolo = solo;
      }
      this.cb.onParams(this._paramsSnapshot());
      const hasPending = !!this._pendingNoiseStack
        || Object.keys(this._pendingTerrainParams || {}).length > 0;
      this.cb.onStatus(
        hasPending ? 'Pending changes — enable Auto Update to apply' : 'Ready',
        hasPending,
      );
      return Promise.resolve({ pending: true, swapped: false });
    }

    if (JSON.stringify(stack) === JSON.stringify(this.noiseStack)
        && solo === this._soloLayerId
        && solo === this._liveSoloLayerId) return;
    const previousLiveStack = this._liveNoiseStack ?? this.noiseStack;
    const previousLiveSolo = this._liveSoloLayerId;
    this.noiseStack = stack;
    this.params.noiseStack = stack;
    this._soloLayerId = solo;

    const next = generateStackGLSL(stack);
    this._stackGLSL = next;
    this._stackSig = next.sig;
    this.cb.onParams(this._paramsSnapshot());

    if (this.worldMode === 'studio' && this.generationSource === 'graph') {
      // Nodes own the visible Studio field. Keep Classic ready for a later
      // source switch without invalidating the active graph bake.
      this._liveNoiseStack = stack;
      this._liveSoloLayerId = solo;
      this._syncNoiseStackSamplers(stack);
      this._applyUniforms();
      return Promise.resolve({ swapped: false, inactive: true });
    }

    if (this.worldMode === 'planet') {
      const liveOctaves = this.planetWorld?.materials?.[0]?.defines?.OCTAVES;
      const needsCompile = next.sig !== this._liveHeightSig
        || liveOctaves !== Math.round(this.params.octaves);
      if (needsCompile) {
        return this._rebuildPlanetStackMaterialsAsync(next).then((result) => {
          if (result?.error && this.noiseStack === stack) {
            const rollback = previousLiveStack;
            const rollbackGLSL = generateStackGLSL(rollback);
            this.noiseStack = rollback;
            this.params.noiseStack = rollback;
            this._liveNoiseStack = rollback;
            this._soloLayerId = previousLiveSolo;
            this._liveSoloLayerId = previousLiveSolo;
            this._stackGLSL = rollbackGLSL;
            this._stackSig = rollbackGLSL.sig;
            this._syncNoiseStackSamplers(rollback);
            this._applyUniforms();
            this.cb.onParams(this._paramsSnapshot());
            this.cb.onToast?.('Terrain change could not be compiled; previous settings restored');
          }
          return result;
        });
      }
      this._liveNoiseStack = stack;
      this._liveSoloLayerId = solo;
      this._syncNoiseStackSamplers(stack);
      this._markTerrainFieldDirty();
      this._applyUniforms();
      this.cb.onStatus('Planet', false);
      return Promise.resolve({ swapped: false, cached: true });
    }

    const liveMaterial = this.worldMode === 'infinite'
      ? this._infiniteTerrainMat
      : this.terrainMaterial;
    const needsCompile = next.sig !== this._liveHeightSig
      || liveMaterial?.defines?.OCTAVES !== Math.round(this.params.octaves);
    if (needsCompile) {
      return this._rebuildStackMaterialsAsync(next, {
        terrainDirtyOnSwap: true,
      }).then((result) => {
        if (result?.error && this.noiseStack === stack) {
          const rollback = previousLiveStack;
          const rollbackGLSL = generateStackGLSL(rollback);
          this.noiseStack = rollback;
          this.params.noiseStack = rollback;
          this._liveNoiseStack = rollback;
          this._soloLayerId = previousLiveSolo;
          this._liveSoloLayerId = previousLiveSolo;
          this._stackGLSL = rollbackGLSL;
          this._stackSig = rollbackGLSL.sig;
          this._syncNoiseStackSamplers(rollback);
          this.cb.onParams(this._paramsSnapshot());
          this.cb.onToast?.('Terrain change could not be compiled; previous settings restored');
        }
        return result;
      });
    }

    if (this._terrainSourcePendingToken != null) {
      this._octToken++;
      this._terrainSourcePendingToken = null;
    }
    this._liveNoiseStack = stack;
    this._liveSoloLayerId = solo;
    this._syncNoiseStackSamplers(stack);
    this._markTerrainFieldDirty();
    this._applyUniforms();
    this._minimapDirtyAt = performance.now();
    this.minimap.requestRedraw();
    this._needsRender = true;
    this.cb.onStatus('Ready', false);
    return Promise.resolve({ swapped: false, cached: true });
  }

  setSoloLayer(id) {
    const solo = id || null;
    if (!this.params.autoUpdate) {
      this._soloLayerId = solo;
      const stagedStack = this._pendingNoiseStack ?? this.noiseStack;
      if (JSON.stringify(stagedStack) === JSON.stringify(this.noiseStack)
          && solo === this._liveSoloLayerId) {
        this._pendingNoiseStack = null;
        this._pendingNoiseSolo = null;
      } else {
        this._pendingNoiseStack ??= cloneStack(this.noiseStack);
        this._pendingNoiseSolo = solo;
      }
      this.cb.onParams(this._paramsSnapshot());
      const hasPending = !!this._pendingNoiseStack
        || Object.keys(this._pendingTerrainParams || {}).length > 0;
      this.cb.onStatus(
        hasPending ? 'Pending changes — enable Auto Update to apply' : 'Ready',
        hasPending,
      );
      return;
    }
    return this.setNoiseStack(this.noiseStack, { solo, force: true });
  }

  _activeHeightProgram(mode = this.worldMode) {
    return mode === 'studio' && this.generationSource === 'graph' && this._graphProgram
      ? this._graphProgram
      : this._stackGLSL;
  }

  _syncCpuHeightProgram() {
    const program = this.worldMode === 'studio'
      && this._liveGenerationSource === 'graph'
      ? this._liveGraphProgram
      : null;
    for (const sampler of [this.cpuHeightSampler, this.heightSampler?.cpu, this._minimapSampler, this._propCpuSampler]) {
      sampler?.setHeightProgram?.(program);
    }
  }

  _syncNoiseStackSamplers(stack = this.noiseStack) {
    this.cpuHeightSampler?.setStack?.(stack);
    this.heightSampler?.cpu?.setStack?.(stack);
    this.planetSampler?.setStack?.(stack);
    this._minimapSampler?.setStack?.(stack);
  }

  _commitLiveHeightSource(program = this._activeHeightProgram()) {
    const desired = this._activeHeightProgram();
    if (program?.sig && desired?.sig && desired.sig !== program.sig) return false;
    this._liveGenerationSource = this.generationSource;
    if (this.generationSource === 'graph') {
      this._liveGraphProgram = this._graphProgram;
    } else {
      this._liveNoiseStack = this.noiseStack;
      this._liveSoloLayerId = this._soloLayerId;
      this._syncNoiseStackSamplers(this.noiseStack);
    }
    this._syncCpuHeightProgram();
    return true;
  }

  setTerrainGraph(graph, {
    structural = true, silent = false, atomic = false, affectedNodeIds = [],
  } = {}) {
    const nextGraph = migrateGraphDocument(graph, this.noiseStack);
    const compiled = compileTerrainGraph(nextGraph);
    const previousProgram = this._graphProgram;
    this.terrainGraph = nextGraph;
    this._graphDiagnostics = compiled.diagnostics || [];
    if (compiled.ok) this._graphProgram = compiled.program;
    this.cb.onTerrainGraph?.(structuredClone(this.terrainGraph));

    if (!compiled.ok) {
      if (this._liveGenerationSource === 'graph') {
        this._graphProgram = this._liveGraphProgram;
      }
      if (this._pendingGraphCompileSig) {
        this._octToken++;
        this._terrainSourcePendingToken = null;
        this._pendingGraphCompileSig = null;
        this._pendingGraphCompileReady = null;
        this._pendingGraphCompileNodeIds.clear();
        this._pendingGraphFallbackProgram = null;
        this.cb.onCompileProgress?.(null);
      }
      this.cb.onGraphState?.({
        valid: false, compiling: false, compilingNodeIds: [],
        diagnostics: structuredClone(this._graphDiagnostics),
        slotCount: this._graphProgram?.slotCount || 0,
        colorSlotCount: this._graphProgram?.colorSlotCount || 0,
      });
      if (!silent) this.cb.onToast?.(this._graphDiagnostics[0]?.message || 'Terrain graph is invalid');
      return { ok: false, diagnostics: this._graphDiagnostics, ready: Promise.resolve({ swapped: false }) };
    }

    const liveOctaves = this.terrainMaterial?.defines?.OCTAVES;
    const needsCompile = this._liveHeightSig !== compiled.program.sig
      || (this.projectMode !== 'nodes' && this.terrainMaterial?.userData?.minimalFragment)
      || liveOctaves !== Math.round(this.params.octaves);
    let ready = Promise.resolve({ swapped: false, error: null });
    if (this.worldMode === 'studio' && this.generationSource === 'graph') {
      if (needsCompile) {
        for (const nodeId of affectedNodeIds) this._pendingGraphCompileNodeIds.add(nodeId);
        if (this._pendingGraphCompileSig === compiled.program.sig && this._pendingGraphCompileReady) {
          this.cb.onGraphState?.({
            valid: true, compiling: true, compilingNodeIds: [...this._pendingGraphCompileNodeIds], diagnostics: [],
            slotCount: compiled.program.slotCount, colorSlotCount: compiled.program.colorSlotCount,
          });
          return { ok: true, program: compiled.program, ready: this._pendingGraphCompileReady, reused: true };
        }

        const fallbackProgram = this._pendingGraphFallbackProgram
          || this._liveGraphProgram
          || (previousProgram?.sig === this._liveHeightSig ? previousProgram : null);
        const pendingNodeIds = new Set(this._pendingGraphCompileNodeIds);
        this._pendingGraphCompileSig = compiled.program.sig;
        this._pendingGraphFallbackProgram = fallbackProgram;
        this._pendingGraphCompileNodeIds = pendingNodeIds;
        this.cb.onGraphState?.({
          valid: true, compiling: true, compilingNodeIds: [...this._pendingGraphCompileNodeIds], diagnostics: [],
          slotCount: compiled.program.slotCount, colorSlotCount: compiled.program.colorSlotCount,
        });
        ready = this._rebuildStackMaterialsAsync(compiled.program, {
          label: 'Compiling terrain graph',
          atomic,
          terrainDirtyOnSwap: true,
        }).then((result) => {
          if (this._pendingGraphCompileSig !== compiled.program.sig) return result;
          if (result?.error) {
            this._graphProgram = this._pendingGraphFallbackProgram;
            this._graphDiagnostics = [{ code: 'shader-compile', message: 'Terrain graph shader compilation failed. The last valid terrain is still active.' }];
            this._syncCpuHeightProgram();
            this.cb.onGraphState?.({ valid: false, compiling: false, compilingNodeIds: [], diagnostics: structuredClone(this._graphDiagnostics), slotCount: this._graphProgram?.slotCount || 0, colorSlotCount: this._graphProgram?.colorSlotCount || 0 });
            if (!silent) this.cb.onToast?.(this._graphDiagnostics[0].message);
          } else if (result?.swapped) {
            this.cb.onGraphState?.({ valid: true, compiling: false, compilingNodeIds: [], diagnostics: [], slotCount: this._graphProgram.slotCount, colorSlotCount: this._graphProgram.colorSlotCount });
          } else {
            this.cb.onGraphState?.({ valid: true, compiling: false, compilingNodeIds: [], diagnostics: [], slotCount: this._graphProgram.slotCount, colorSlotCount: this._graphProgram.colorSlotCount });
          }
          this._pendingGraphCompileSig = null;
          this._pendingGraphCompileReady = null;
          this._pendingGraphCompileNodeIds.clear();
          this._pendingGraphFallbackProgram = null;
          return result;
        });
        this._pendingGraphCompileReady = ready;
      }
      else {
        if (this._pendingGraphCompileSig) {
          this._octToken++;
          this._terrainSourcePendingToken = null;
          this._pendingGraphCompileSig = null;
          this._pendingGraphCompileReady = null;
          this._pendingGraphCompileNodeIds.clear();
          this._pendingGraphFallbackProgram = null;
          this.cb.onCompileProgress?.(null);
        }
        this._commitLiveHeightSource();
        this._markTerrainFieldDirty();
        this._applyUniforms();
        this.minimap.requestRedraw();
        this.cb.onGraphState?.({
          valid: true, compiling: false, compilingNodeIds: [], diagnostics: [],
          slotCount: compiled.program.slotCount, colorSlotCount: compiled.program.colorSlotCount,
        });
      }
    } else {
      this.cb.onGraphState?.({
        valid: true, compiling: false, compilingNodeIds: [], diagnostics: [],
        slotCount: compiled.program.slotCount, colorSlotCount: compiled.program.colorSlotCount,
      });
    }
    return { ok: true, program: compiled.program, ready };
  }

  setGenerationSource(source, { silent = false } = {}) {
    const next = source === 'graph' ? 'graph' : 'classic';
    if (next === this.generationSource) return;
    const previousSource = this.generationSource;
    if (next === 'graph' && !this.terrainGraph) this.terrainGraph = createBlankGraph();
    if (next === 'graph' && !this._graphProgram) {
      const compiled = compileTerrainGraph(this.terrainGraph);
      this._graphDiagnostics = compiled.diagnostics || [];
      if (compiled.ok) this._graphProgram = compiled.program;
    }
    this.generationSource = next;
    this.cb.onGenerationSource?.(next);
    this.cb.onTerrainGraph?.(this.terrainGraph ? structuredClone(this.terrainGraph) : null);
    this.cb.onGraphState?.({ valid: !!this._graphProgram && this._graphDiagnostics.length === 0, compiling: false, diagnostics: structuredClone(this._graphDiagnostics), slotCount: this._graphProgram?.slotCount || 0, colorSlotCount: this._graphProgram?.colorSlotCount || 0 });
    if (this.worldMode === 'studio') {
      const candidate = this._activeHeightProgram();
      this._rebuildStackMaterialsAsync(candidate, {
        label: next === 'graph' ? 'Compiling terrain graph' : 'Restoring Classic terrain',
        terrainDirtyOnSwap: true,
      }).then((result) => {
        if (!result?.error || this.generationSource !== next) return;
        this.generationSource = previousSource;
        this.cb.onGenerationSource?.(previousSource);
        this._graphDiagnostics = [{
          code: 'shader-compile',
          message: 'Terrain source could not be compiled. The previous terrain remains active.',
        }];
        this._syncCpuHeightProgram();
        this._applyUniforms();
        this.cb.onGraphState?.({
          valid: false,
          compiling: false,
          diagnostics: structuredClone(this._graphDiagnostics),
          slotCount: this._graphProgram?.slotCount || 0,
          colorSlotCount: this._graphProgram?.colorSlotCount || 0,
        });
        if (!silent) this.cb.onToast?.(this._graphDiagnostics[0].message);
      });
    } else {
      this._syncCpuHeightProgram();
      this._markTerrainFieldDirty();
      this._applyUniforms();
    }
    if (!silent) this.cb.onToast?.(next === 'graph' ? 'Nodes now drive Tile terrain' : 'Classic Noise Stack restored');
  }

  setGraphView(view) {
    this.graphView = {
      x: Number(view?.x) || 0,
      y: Number(view?.y) || 0,
      zoom: Math.max(0.1, Math.min(4, Number(view?.zoom) || 1)),
    };
    this.cb.onGraphView?.({ ...this.graphView });
  }

  rebuildActiveHeightProgram({
    label = 'Compiling terrain',
    atomic = false,
    terrainDirtyOnSwap = false,
  } = {}) {
    return this._rebuildStackMaterialsAsync(this._activeHeightProgram(), {
      label,
      atomic,
      terrainDirtyOnSwap,
    });
  }

  _acquireTerrainAtomicCompile(token) {
    this._terrainAtomicCompileTokens ||= new Set();
    if (this._terrainAtomicCompileTokens.has(token)) return false;
    this._terrainAtomicCompileTokens.add(token);
    this._compiling++;
    return true;
  }

  _releaseTerrainAtomicCompile(token) {
    if (!this._terrainAtomicCompileTokens?.delete(token)) return false;
    this._compiling = Math.max(0, this._compiling - 1);
    return true;
  }

  _retireTerrainAtomicCompiles() {
    const count = this._terrainAtomicCompileTokens?.size ?? 0;
    if (!count) return 0;
    this._terrainAtomicCompileTokens.clear();
    this._compiling = Math.max(0, this._compiling - count);
    return count;
  }

  _acquireWorldCompile(mode) {
    // Only the current mode-specific shader warmup may own this gate. The
    // driver's superseded async work can finish later without blocking or
    // decrementing the replacement mode's gate.
    this._retireWorldCompile();
    const token = (this._worldCompileSerial ?? 0) + 1;
    this._worldCompileSerial = token;
    const gate = { token, mode };
    this._worldCompileGate = gate;
    this._compiling++;
    return gate;
  }

  _releaseWorldCompile(gate) {
    if (!gate || this._worldCompileGate !== gate) return false;
    this._worldCompileGate = null;
    this._compiling = Math.max(0, this._compiling - 1);
    return true;
  }

  _retireWorldCompile() {
    if (!this._worldCompileGate) return false;
    this._worldCompileGate = null;
    this._compiling = Math.max(0, this._compiling - 1);
    return true;
  }

  /**
   * Recompile the studio/infinite height materials for the new generated stack
   * GLSL in the background, then update the LIVE materials' shader source in
   * place once the identical programs are cached (no freeze, no mesh swap).
   * Same warm-then-swap pattern as _setOctavesAsync.
   */
  async _rebuildStackMaterialsAsync(program = this._activeHeightProgram(), {
    label = 'Compiling noise stack',
    atomic = false,
    terrainDirtyOnSwap = false,
    onBeforeSwap = null,
  } = {}) {
    const oct = Math.round(this.params.octaves);
    const sg = program || this._stackGLSL;
    const heightSourceSig = sg.heightSig || sg.sig;
    const heightSourceChanged = this._liveHeightSourceSig !== heightSourceSig;
    const liveTerrainMaterial = this.worldMode === 'infinite'
      ? this._infiniteTerrainMat
      : this.terrainMaterial;
    const octavesChanged = liveTerrainMaterial?.defines?.OCTAVES !== oct;
    const nodePreviewMaterial = this.worldMode === 'studio' && this.projectMode === 'nodes';
    const terrainVariant = this._targetTerrainVariant();
    const liveTerrainVariant = this.terrainMaterial?.userData?.terrainVariant ?? null;
    const qualityVariants = ['base', 'detail', 'surface', 'full'];
    const hybridQualityVariants = ['hybrid-surface', 'hybrid'];
    const liveMinimalVariant = this.worldMode === 'studio'
      && this.terrainMaterial?.userData?.minimalFragment === true;
    const liveQualityVariant = !this.terrainMaterial?.userData?.minimalFragment
      && (!liveTerrainVariant
        || liveTerrainVariant === terrainVariant
        || (qualityVariants.includes(liveTerrainVariant)
          && qualityVariants.includes(terrainVariant))
        || (hybridQualityVariants.includes(liveTerrainVariant)
          && hybridQualityVariants.includes(terrainVariant)));
    // Presets commonly change only uniforms. Do not touch WebGL when the live
    // studio program already matches the requested structural variant.
    if (this.worldMode === 'studio'
        && this._liveHeightSig === sg.sig
        && this.terrainMaterial?.userData?.heightProgramSig === sg.sig
        && this.terrainMaterial?.defines?.OCTAVES === oct
        && (nodePreviewMaterial
          || liveMinimalVariant
          || liveQualityVariant)) {
      if (this._terrainSourcePendingToken != null
          || (this._terrainAtomicCompileTokens?.size ?? 0) > 0) {
        // Reverting to the already-live source must supersede an in-flight
        // compile just like starting another compile would. Otherwise the stale
        // job keeps bakes and variant upgrades blocked until it eventually ends.
        this._octToken++;
        this._terrainSourcePendingToken = null;
        this._retireTerrainAtomicCompiles();
        this.cb.onCompileProgress?.(null);
      }
      if (!this._commitLiveHeightSource(sg)) {
        return { swapped: false, error: null, stale: true };
      }
      onBeforeSwap?.();
      if (terrainDirtyOnSwap) this._markTerrainFieldDirty();
      this._applyUniforms();
      this._needsRender = true;
      const qualityPending = !nodePreviewMaterial
        && (liveMinimalVariant
          || (!!liveTerrainVariant && liveTerrainVariant !== terrainVariant));
      // The minimal boot material is already the exact requested height source
      // and is a coherent first frame. Do not replace it synchronously merely
      // to obtain the expensive surface fragment; the existing post-paint
      // sequence owns that optional upgrade together with height baking/water.
      if (qualityPending && !liveMinimalVariant) this._scheduleTerrainQualityUpgrade();
      if (!this._compiling) this.cb.onStatus('Ready', false);
      return { swapped: false, error: null, cached: true, qualityPending };
    }

    const token = ++this._octToken;
    if (terrainDirtyOnSwap) this._terrainSourcePendingToken = token;
    this._retireTerrainAtomicCompiles();
    if (atomic) {
      this._acquireTerrainAtomicCompile(token);
    }
    this.cb.onStatus(`${label}…`, true);
    let warm = [];
    let cachePreparation = null;
    const modeAtStart = this.worldMode;
    let preparedTargetSnapshot = null;
    try {
      warm = [nodePreviewMaterial
        ? createBootTerrainMaterial(this.uniforms, oct, sg)
        : createTerrainMaterial(this.uniforms, oct, sg, { variant: terrainVariant })];
      const waterActive = this.params.waterEnabled !== false;
      if ((heightSourceChanged || octavesChanged) && waterActive) {
        if (this.worldMode === 'infinite') {
          warm.push(
            this.waterSystem?.createInfiniteStackWarmMaterial?.(sg, oct)
            ?? createInfiniteWaterMaterial(this.uniforms, oct, sg),
          );
        } else {
          warm.push(
            this.waterSystem?.createStudioStackWarmMaterial?.(sg, oct)
            ?? createWaterMaterial(this.uniforms, oct, sg),
          );
        }
      }

      const emitProgress = (payload) => {
        if (token === this._octToken && !this._disposed) {
          this.cb.onCompileProgress?.(payload);
        }
      };
      emitProgress({
        id: 'noise-stack',
        label,
        done: 0,
        total: warm.length,
      });

      let compileError = null;
      try {
        const targetSnapshot = this._resolveCameraCompileTarget();
        const { renderTarget } = targetSnapshot;
        preparedTargetSnapshot = targetSnapshot;
        let compileResult = null;
        if (modeAtStart === 'infinite') {
          const source = this.infiniteWorld?.batches?.meshes?.find(Boolean) ?? null;
          if (!source?.geometry) throw new Error('Infinite terrain instance geometry is unavailable');
          const terrainResult = await this._compileInstancedMaterialVariant(
            warm[0], source.geometry, renderTarget, { timeoutMs: 120000 },
          );
          emitProgress({ id: 'noise-stack', label, done: 1, total: warm.length });
          let auxiliaryResult = { ready: true, timedOut: false, pendingCount: 0 };
          if (terrainResult?.ready === true && warm.length > 1) {
            auxiliaryResult = await this._compileMaterialVariants(warm.slice(1), {
              canvasOnly: true,
              stagger: true,
              timeoutMs: 120000,
              renderTarget,
              onProgress: (done) => emitProgress({
                id: 'noise-stack', label, done: 1 + done, total: warm.length,
              }),
            });
          }
          compileResult = {
            ready: terrainResult?.ready === true && auxiliaryResult?.ready === true,
            timedOut: terrainResult?.timedOut === true || auxiliaryResult?.timedOut === true,
          };
        } else {
          compileResult = await this._compileMaterialVariants(warm, {
            canvasOnly: true,
            stagger: true,
            timeoutMs: 120000,
            renderTarget,
            onProgress: (done, total) => emitProgress({
              id: 'noise-stack', label, done, total,
            }),
          });
        }
        if (compileResult?.ready !== true) {
          compileError = new Error('Terrain shader did not become ready');
        } else {
          cachePreparation = await this._prepareHeightCacheProgram(modeAtStart, oct, sg);
          if (cachePreparation?.result?.ready !== true) {
            compileError = new Error('Terrain cache shader did not become ready');
          }
        }
      } catch (e) {
        console.warn('Noise stack shader compile failed', e);
        compileError = e;
      }
      let swapped = false;
      if (!compileError && token === this._octToken && !this._disposed) {
        const currentTarget = this._resolveCameraCompileTarget();
        if (this.worldMode !== modeAtStart) {
          emitProgress(null);
          return { swapped: false, error: null, stale: true };
        }
        if (Math.round(this.params.octaves) !== oct
            || this._targetTerrainVariant() !== terrainVariant
            || !this._sameCameraCompileTarget(
              preparedTargetSnapshot,
              currentTarget,
            )) {
          return this._rebuildStackMaterialsAsync(
            this._activeHeightProgram(),
            {
              label,
              atomic,
              terrainDirtyOnSwap,
              onBeforeSwap,
            },
          );
        }
        if (cachePreparation && !this._publishHeightCachePreparation(cachePreparation)) {
          const error = new Error('Prepared terrain cache was superseded');
          emitProgress(null);
          return { swapped: false, error };
        }
        if (!this._commitLiveHeightSource(sg)) {
          emitProgress(null);
          return { swapped: false, error: null, stale: true };
        }
        onBeforeSwap?.();
        // update live materials in place (programs already cached from `warm`).
        // Project loads can change OCTAVES and the generated height source in the
        // same transaction. The earlier octave warmup is intentionally cancelled
        // by this newer token, so carry the matching define across here too.
        const liveMaterials = modeAtStart === 'infinite'
          ? [this._infiniteTerrainMat, this._infiniteWaterMat]
          : [this.terrainMaterial, this.waterMaterial];
        for (const mat of liveMaterials) {
          if (!mat) continue;
          mat.defines ||= {};
          if (mat.defines.OCTAVES !== oct) mat.defines.OCTAVES = oct;
        }
        if (modeAtStart === 'studio') {
          if (nodePreviewMaterial) rebuildTerrainPreviewShaderSource(this.terrainMaterial, sg);
          else rebuildTerrainShaderSource(this.terrainMaterial, sg, { variant: terrainVariant });
          if (heightSourceChanged
              && this.waterMaterial
              && !this.waterSystem?.ownsMaterial?.(this.waterMaterial)) {
            rebuildWaterShaderSource(this.waterMaterial, sg);
          }
        } else if (this._infiniteTerrainMat) {
          rebuildTerrainShaderSource(this._infiniteTerrainMat, sg, { variant: terrainVariant });
        }
        if (heightSourceChanged && this._infiniteWaterMat && !this.waterSystem?.ownsMaterial(this._infiniteWaterMat)) {
          rebuildWaterShaderSource(this._infiniteWaterMat, sg);
        }
        this._liveHeightSig = sg.sig;
        this._liveHeightSourceSig = heightSourceSig;
        if (this._terrainSourcePendingToken === token) {
          this._terrainSourcePendingToken = null;
        }
        if (terrainDirtyOnSwap) this._markTerrainFieldDirty();
        // The visible program is warm for the active camera target. The
        // separate underwater target remains lazy until the camera approaches water.
        this._underwaterWarmed = false;
        if (this._waterDeferred) {
          this._waterMaterialWarmed = false;
          this._waterMaterialWarmIdentity = null;
        }
        if (heightSourceChanged || octavesChanged) {
          this.waterSystem?.onStackRebuilt(sg, oct);
        }
        if (this.heightSampler) this.heightSampler.invalidate();
        if (this.propSurfaceField) this.propSurfaceField.invalidate();
        this._applyUniforms();
        if (!this._compiling || (atomic && this._compiling === 1)) this.cb.onStatus('Ready', false);
        this._minimapDirtyAt = performance.now();
        this.minimap.requestRedraw();
        this._needsRender = true;
        swapped = true;
      } else if (compileError && token === this._octToken && !this._disposed && !this._compiling) {
        this.cb.onStatus('Ready', false);
      }
      emitProgress(null);
      return { swapped, error: compileError };
    } finally {
      if (this._terrainSourcePendingToken === token) {
        this._terrainSourcePendingToken = null;
      }
      this._queueWarmMaterials(warm);
      this._discardHeightCachePreparation(cachePreparation);
      if (atomic) {
        const released = this._releaseTerrainAtomicCompile(token);
        // A newer atomic transition keeps the render gate closed. Only the last
        // completed load may expose the scene again.
        if (released && !this._compiling && !this._disposed) {
          this.cb.onStatus('Ready', false);
          this._needsRender = true;
        }
      }
    }
  }

  async _rebuildPlanetStackMaterialsAsync(program = this._stackGLSL, {
    label = 'Compiling planet terrain',
    atomic = false,
    rebuildGeometry = false,
  } = {}) {
    if (!this.params) {
      return { swapped: false, error: new Error('Planet parameters unavailable') };
    }
    const sg = program || this._stackGLSL;
    const octaves = Math.round(this.params.octaves);
    const token = ++this._octToken;
    const mode = this.worldMode;
    let warm = [];
    let cachePreparation = null;
    let targetSnapshot = null;

    this._retireTerrainAtomicCompiles();
    if (atomic) {
      this._terrainSourcePendingToken = token;
      this._acquireTerrainAtomicCompile(token);
    }
    this.cb.onStatus(label + '...', true);

    const stillCurrent = () => token === this._octToken
      && !this._disposed
      && !!this.params
      && this.worldMode === 'planet'
      && mode === 'planet'
      && this._stackGLSL?.sig === sg.sig
      && Math.round(this.params.octaves) === octaves;

    try {
      const planet = await this._loadPlanetModules();
      if (!planet || !stillCurrent()) {
        return { swapped: false, stale: true, error: null };
      }

      const minimal = this._planetMatMinimal === true;
      warm = [
        planet.createPlanetMaterial(this.uniforms, octaves, sg, { minimal }),
        planet.createPlanetWaterMaterial(this.uniforms, octaves, sg),
      ];

      const ensureVisibleTargetReady = async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          if (!stillCurrent()) return { ready: false, stale: true };
          targetSnapshot = this._resolveCameraCompileTarget();
          const result = await this._compileMaterialVariants(warm, {
            canvasOnly: true,
            stagger: true,
            timeoutMs: 120000,
            renderTarget: targetSnapshot.renderTarget,
          });
          if (result?.ready !== true) return { ready: false, stale: false };
          const currentTarget = this._resolveCameraCompileTarget();
          if (this._sameCameraCompileTarget(targetSnapshot, currentTarget)) {
            return { ready: true, stale: false };
          }
          await yieldTask();
        }
        return { ready: false, stale: false };
      };

      let targetResult = await ensureVisibleTargetReady();
      if (targetResult.stale) {
        return { swapped: false, stale: true, error: null };
      }
      if (!targetResult.ready) {
        return {
          swapped: false,
          error: new Error('Planet terrain shader did not become ready'),
        };
      }

      cachePreparation = await this._prepareHeightCacheProgram('planet', octaves, sg);
      if (!stillCurrent()) {
        return { swapped: false, stale: true, error: null };
      }
      if (cachePreparation?.result?.ready !== true) {
        return {
          swapped: false,
          error: new Error('Planet height-cache shader did not become ready'),
        };
      }

      // Cache preparation can span several frames. If post-processing changed
      // in that interval, compile the same candidates for the new live target
      // before publishing either shader family.
      const currentTarget = this._resolveCameraCompileTarget();
      if (!this._sameCameraCompileTarget(targetSnapshot, currentTarget)) {
        targetResult = await ensureVisibleTargetReady();
        if (targetResult.stale) {
          return { swapped: false, stale: true, error: null };
        }
        if (!targetResult.ready) {
          return {
            swapped: false,
            error: new Error('Planet render target changed during compilation'),
          };
        }
      }

      if (!stillCurrent()) {
        return { swapped: false, stale: true, error: null };
      }
      if (!this._publishHeightCachePreparation(cachePreparation)) {
        return {
          swapped: false,
          error: new Error('Prepared planet cache was superseded'),
        };
      }

      this._liveGenerationSource = 'classic';
      this._liveNoiseStack = this.noiseStack;
      this._liveSoloLayerId = this._soloLayerId;
      this._syncNoiseStackSamplers(this.noiseStack);
      this._syncCpuHeightProgram();

      if (rebuildGeometry) {
        // Geometry/layout changes are committed only after all exact programs
        // are ready. Newly-created materials hit those cached programs.
        this._rebuildPlanet({ skipUniforms: true });
      } else {
        for (const material of this.planetWorld?.materials || []) {
          material.defines ||= {};
          material.defines.OCTAVES = octaves;
          planet.rebuildPlanetMaterialSource(material, sg, {
            minimal: material.userData?.minimalFragment === true,
          });
        }
        if (this.planetWaterMat) {
          this.planetWaterMat.defines ||= {};
          this.planetWaterMat.defines.OCTAVES = octaves;
          planet.rebuildPlanetWaterMaterialSource(this.planetWaterMat, sg);
        }
      }

      this._liveHeightSig = sg.sig;
      this._liveHeightSourceSig = sg.heightSig || sg.sig;
      this._underwaterWarmed = false;
      this.waterSystem?.onStackRebuilt?.(this._stackGLSL, octaves);
      this._markTerrainFieldDirty();
      this._applyUniforms();
      this._needsRender = true;
      return { swapped: true, error: null };
    } catch (error) {
      console.warn('Planet terrain shader compile failed', error);
      return { swapped: false, error };
    } finally {
      this._queueWarmMaterials(warm);
      this._discardHeightCachePreparation(cachePreparation);
      if (this._terrainSourcePendingToken === token) {
        this._terrainSourcePendingToken = null;
      }
      if (atomic) this._releaseTerrainAtomicCompile(token);
      if (token === this._octToken && !this._disposed && !this._compiling) {
        this.cb.onStatus(this.worldMode === 'planet' ? 'Planet' : 'Ready', false);
        this._needsRender = true;
      }
    }
  }
  _circleBoundarySpec() {
    if (this.tileAssemblyShape !== 'circle') return null;
    const radius = (this.diskRadiusCells + 0.5) * this.cellSize;
    const lodSegments = resolveLodSegments(this.perf);
    const lastLod = Math.max(0, lodSegments.length - 1);
    let lod = Math.min(1, lastLod);
    let chunkSegments = Math.max(4, Number(lodSegments[lod]) || 4);
    const circumference = Math.PI * 2 * radius;
    const chunkSize = Math.max(
      1,
      Number(this.params?.chunkSize) || Number(this.board?.chunkSize) || 1,
    );
    // A grid circle crosses about eight radius-in-chunks worth of chunks.
    // Reserve only a bounded share of the configured triangle budget for its
    // stable rim, even when a custom preset makes every normal LOD expensive.
    const boundaryChunkEstimate = Math.ceil((8 * radius) / chunkSize) + 8;
    const configuredBudget = Number(this.perf?.triangleBudget) || 1600000;
    const boundaryBudget = Math.max(
      75000,
      Math.min(500000, configuredBudget * 0.25),
    );
    const boundaryTriangles = (segments) => (
      boundaryChunkEstimate * (2 * segments * segments + 8 * segments)
    );
    const radialSegments = (segments) => {
      const edge = chunkSize / Math.max(1, segments);
      const raw = Math.ceil(circumference / edge);
      return Math.ceil(raw / 4) * 4;
    };
    while (chunkSegments > 4
        && (boundaryTriangles(chunkSegments) > boundaryBudget
          || radialSegments(chunkSegments) > MAX_DISK_BOUNDARY_SEGMENTS)) {
      chunkSegments = Math.max(4, Math.floor(chunkSegments / 2));
    }
    for (let index = Math.min(2, lastLod); index <= lastLod; index++) {
      lod = index;
      if ((Number(lodSegments[index]) || Infinity) <= chunkSegments) break;
    }
    return {
      x: 0,
      z: 0,
      radius,
      lod,
      chunkSegments,
      segments: resolveDiskBoundarySegments(
        radius,
        chunkSize / chunkSegments,
      ),
    };
  }

  _syncCircularBoundarySpec() {
    const spec = this._circleBoundarySpec();
    if (this.uniforms?.uCircleBoundarySegments) {
      this.uniforms.uCircleBoundarySegments.value = spec?.chunkSegments ?? 16;
    }
    this.board?.setCircularBoundary(spec);
    return spec;
  }

  _applyStudioAssemblyLayout(maxHeight = this._maxHeight()) {
    // The board, plinth and water span the whole tile assembly (= one cell
    // when there is a single tile, keeping the classic centred diorama).
    const wall = this._wallThickness();
    const uw = this._unionWidth();
    const ud = this._unionDepth();
    const c = this._unionCenter();
    this._syncCircularBoundarySpec();
    // Extend the water out to the flared plinth wall so it meets the dark box
    // with no gap.
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
  }

  _refreshStudioChunkView(now = performance.now()) {
    this.camera.updateMatrixWorld(true);
    this.board.updateLOD(this.camera.position);
    this.board.cull(this.camera);
    this._lastLodUpdate = now;
  }

  _applyTileLayout() {
    this._needsRender = true;
    this._markTerrainFieldDirty();
    const p = this.params;
    const maxHeight = this._maxHeight();
    const result = this.board.syncCells({
      chunkCount: p.chunkCount,
      chunkSize: p.chunkSize,
      maxHeight,
      skirtDepth: this._skirtDepth(),
      lodSegments: resolveLodSegments(this.perf),
      cells: this.tiles,
      progressive: true,
      initialBatchSize: this._studioChunkCreatesPerFrame(),
    });
    if (result?.rebuilt) {
      this.appliedChunkCount = p.chunkCount;
      this.appliedChunkSize = p.chunkSize;
    }

    this._applyStudioAssemblyLayout(maxHeight);
    this._syncManualTerrainBounds();
    this._refreshStudioChunkView();
    this._applyUniforms({ updatePlinth: false });
    this._minimapDirtyAt = performance.now();
    this.minimap.requestRedraw();

    const c = this._unionCenter();
    this.controls.goalTarget.set(c.x, 0, c.z);
    this._updateTileGhost();
    this._notifyTiles();
    // Real-world height import: fetch the geographic neighbor for any new cell
    // (async, fire-and-forget; no-op unless a geoRef-carrying import is active).
    this._syncRealWorldNeighborTiles();
    if (!this._bootPending) {
      this.cb.onStatus(this.board?.isBuilding ? this._terrainBuildStatusText() : 'Ready', false);
    }
  }

  // Push every parameter into uniforms; rebuild the chunk grid if the world
  // layout changed.
  applyAll({ force, terrainDirty = true }) {
    this._needsRender = true;
    if (terrainDirty) this._markTerrainFieldDirty();
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
        progressive: this.worldMode === 'studio',
        initialBatchSize: this._studioInitialChunkBatch(),
      });
      this.appliedChunkCount = p.chunkCount;
      this.appliedChunkSize = p.chunkSize;

      this._applyStudioAssemblyLayout(maxHeight);

      // build() starts every chunk at the coarse base LOD; resolve per-chunk
      // LOD + culling NOW so the first rendered frame already shows the finished
      // terrain at full detail. Without this the throttled updateLOD (~150ms
      // later) causes a visible "coarse → detailed" pop when a preset loads.
      this._refreshStudioChunkView();
    }

    this._syncManualTerrainBounds();
    this._applyUniforms({ updatePlinth: !rebuildNeeded });
    this._rebuildRealWorldBuildings();
    this._minimapDirtyAt = performance.now();
    this.minimap.requestRedraw();
    if (!this._bootPending) {
      this.cb.onStatus(this.board?.isBuilding ? this._terrainBuildStatusText() : 'Ready', false);
    }
  }

  _studioInitialChunkBatch() {
    if (this._studioChunkBuildInstant()) return Infinity;
    if (this.gpuTier === 'low') return 25;
    if (this.gpuTier === 'medium') return 49;
    return 64;
  }

  _studioChunkCreatesPerFrame() {
    const n = Number(this.perf?.maxCreatesPerFrame);
    if (!Number.isFinite(n)) return 0;
    if (n <= 0) return Infinity;
    return Math.max(1, Math.round(n));
  }

  _studioChunkBuildInstant() {
    return this._studioChunkCreatesPerFrame() === Infinity;
  }

  _studioChunkBuildBudget() {
    const maxItems = this._studioChunkCreatesPerFrame();
    if (maxItems === Infinity) return { maxItems: Infinity, maxMs: Infinity };
    if (this.gpuTier === 'low') return { maxItems, maxMs: 3 };
    if (this.gpuTier === 'medium') return { maxItems, maxMs: 4 };
    return { maxItems, maxMs: 6 };
  }

  _terrainBuildStatusText() {
    const b = this.board;
    if (!b?.targetChunkCount) return 'Loading terrain...';
    return `Loading terrain ${b.activeChunkCount}/${b.targetChunkCount} chunks`;
  }

  _processTerrainBuildQueue(now = performance.now()) {
    if (this.worldMode !== 'studio' || !this.board?.isBuilding) return 0;
    const created = this.board.processBuildQueue(this._studioChunkBuildBudget());
    if (!created) return 0;

    this.camera.updateMatrixWorld(true);
    this.board.updateLOD(this.camera.position);
    this.board.cull(this.camera);
    this._needsRender = true;
    this._lastLodUpdate = now;
    this.cb.onLod(
      [...this.board.lodCounts],
      this.params.chunkCount,
      this.board.visibleChunkCount,
      this.board.culledChunkCount
    );
    if (!this._bootPending) {
      this.cb.onStatus(this.board.isBuilding ? this._terrainBuildStatusText() : 'Ready', false);
    } else {
      this._completeBootIfInteractiveReady();
      if (!this.board.isBuilding) this._completeBootIfQualityReady();
    }
    return created;
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
    if (!size) return false;
    const skirtDepth = this._skirtDepth();
    const sea = this.params.seaLevel;
    const topY = sea > 0.5 ? sea : 0;
    const wall = this._wallThickness();
    const circleSpec = this._circleBoundarySpec();
    const cellsKey = (this.tiles ?? [])
      .map((cell) => `${cell.cx},${cell.cz}`)
      .sort()
      .join(';');
    const geometryKey = circleSpec
      ? `circle:${circleSpec.radius}:${skirtDepth}:${circleSpec.segments}`
      : `square:${size}:${skirtDepth}:${topY}:${wall}:${cellsKey}`;

    if (geometryKey === this._plinthGeometryKey) {
      if (this.diskWall) {
        this.diskWall.visible = this.plinth.visible && this.tileAssemblyShape === 'circle';
      }
      return false;
    }

    let geo;
    if (circleSpec) {
      // The radial wall samples at the same stable edge spacing as circle
      // boundary chunks, bounding raster-mask mismatch without forcing LOD0.
      geo = buildCircularPlinthGeometry(
        circleSpec.radius,
        skirtDepth,
        circleSpec.segments,
      );
      if (this.diskWall) {
        this.diskWall.geometry.dispose();
        this.diskWall.geometry = buildDiskWallGeometry(
          circleSpec.radius,
          circleSpec.segments,
        );
      }
    } else {
      // Single tiles keep the legacy box. Multi-tile assemblies get one plinth
      // with walls only on exposed sides, so shared tile edges stay clear.
      geo = this.tiles.length > 1
        ? buildTileAssemblyPlinthGeometry(this.tiles, size, skirtDepth, topY, wall)
        : buildBoardPlinthGeometry(size, skirtDepth, topY, wall, this._cellWorldCenter(this.tiles[0]?.cx ?? 0, this.tiles[0]?.cz ?? 0));
    }
    this.plinth.geometry.dispose();
    this.plinth.geometry = geo;
    this._plinthGeometryKey = geometryKey;
    if (this.diskWall) {
      this.diskWall.visible = this.plinth.visible && this.tileAssemblyShape === 'circle';
    }
    return true;
  }

  _applyUniforms({ updatePlinth = true } = {}) {
    this._needsRender = true;
    const p = this.params;
    const u = this.uniforms;
    u.uInfiniteMode.value = this.worldMode === 'infinite' ? 1.0 : 0.0;
    this._syncImportedMapUniforms();
    const size = this.boardSize;

    const rng = mulberry32(p.seed >>> 0);
    u.uSeedOffset.value.set(rng() * 2048 - 1024, rng() * 2048 - 1024);

    u.uFrequency.value = (p.noiseScale * 0.1) / size;
    u.uHeightScale.value = p.heightScale;
    u.uSeaLevel.value = p.seaLevel;
    u.uTerrainFormationSeaLevel.value = p.terrainFormationSeaLevel;
    u.uAmplitude.value = p.noiseStrength;
    u.uTerrainSmoothing.value = p.terrainSmoothing ?? 0;
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
    u.uAORidge.value = p.aoRidge ?? 0;
    // Slope gates — keep each pair ordered so the smoothstep edges stay valid
    // whatever the two sliders are set to.
    {
      const rockLo = p.rockSlopeLo ?? 0.42;
      const snowMin = p.snowSlopeMin ?? 0.30;
      u.uRockSlopeLo.value = rockLo;
      u.uRockSlopeHi.value = Math.max(p.rockSlopeHi ?? 0.72, rockLo + 0.01);
      u.uSnowSlopeMin.value = snowMin;
      u.uSnowSlopeMax.value = Math.max(p.snowSlopeMax ?? 0.62, snowMin + 0.01);
    }
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

    // Octave count is a compile-time constant (keeps loop bounds static for
    // the D3D11 shader compiler) — changing it requires new programs, which
    // are compiled in the background and swapped in when ready.
    const oct = Math.round(p.octaves);
    const activeTerrainMaterial = this.worldMode === 'planet'
      ? this.planetWorld?.materials?.[0]
      : (this.worldMode === 'infinite' ? this._infiniteTerrainMat : this.terrainMaterial);
    if (activeTerrainMaterial?.defines?.OCTAVES !== oct) {
      this._setOctavesAsync(oct);
    }

    this.terrainMaterial.wireframe = p.wireframe;
    if (this.planetWorld) this.planetWorld.setWireframe(p.wireframe);
    if (this.planetWaterMat) this.planetWaterMat.uniforms.uWaterAnim.value = p.waterAnim ? 1 : 0;
    this._updatePlanetWater();
    this.waterMaterial.uniforms.uWaterAnim.value = p.waterAnim ? 1 : 0;
    this.water.position.y = p.seaLevel;
    if (this.waterSystem && !this._waterDeferred) this.waterSystem.sync(p, this.worldMode);
    else if (this.water) this.water.visible = false;

    this.board.updateBounds(this._maxHeight(), this._skirtDepth());
    if (updatePlinth) this._updatePlinth();
    this.planetStyle.applyToUniforms(u);
    this._applyStudioFogFromStyle();
    this._applyCloudSettings();   // slab altitude/scale track board height + size
    this._applySkyboxSettings();  // sky dome params + per-mode visibility
    this._applyVisualSettings();
    this._applySurfaceSettings();
    this._applyPixelRatio();
  }

  // Surface-texture control values (source / scale / normal relief). The atlas
  // textures themselves are set separately via setSurfaceAtlas(). Uniforms
  // persist across material rebuilds (shared uniforms object), so this only
  // needs to run on param change + init.
  _applySurfaceSettings() {
    const p = this.params;
    const u = this.uniforms;
    if (!u?.uSurfMode) return;
    const surfaceTextureSource = normalizeSurfaceTextureSource(p);
    p.surfaceTextureSource = surfaceTextureSource;
    p.surfaceTextureMode = surfaceTextureSource !== SURFACE_TEXTURE_SOURCE.PROCEDURAL;
    const flatManual = this.projectMode === 'manual' && !this._manualHasGeneratedBase();
    // A generated Manual base keeps the source project's surface mode. Manual
    // paint still samples the atlas through uManualSurfaceMode, but an
    // unpainted procedural base must not be replaced by an uninitialised atlas.
    u.uSurfMode.value = (flatManual || p.surfaceTextureMode) ? 1.0 : 0.0;
    u.uManualBaseGenerated.value = this._manualHasGeneratedBase()
      && p.surfaceTextureMode === true
      && (p.surfaceTextureAmount ?? 1) > 0.001 ? 1.0 : 0.0;
    u.uSurfAmount.value = 1.0;
    u.uSurfTint.value = 0.0;
    if (!u.uSurfPaletteInfluence) u.uSurfPaletteInfluence = { value: 0.6 };
    u.uSurfPaletteInfluence.value = flatManual ? 0.0 : (p.surfaceTexturePaletteInfluence ?? 0.6);
    if (!u.uSurfScale) u.uSurfScale = { value: 1.0 };
    u.uSurfScale.value = p.surfaceTextureScale ?? 1.0;
    if (!u.uSurfBreakup) u.uSurfBreakup = { value: 0.5 };
    u.uSurfBreakup.value = flatManual ? 0.0 : (p.surfaceTextureBreakup ?? 0.5);
    if (!u.uSurfBlend) u.uSurfBlend = { value: 0.35 };
    u.uSurfBlend.value = p.surfaceTextureBlend ?? 0.35;
    u.uSurfNormalAmt.value = p.surfaceTextureNormal ?? 1.0;
    u.uSurfRoughAmt.value = 1.0;
    u.uSurfAOAmt.value = 1.0;
    u.uSurfTriplanar.value = p.surfaceTextureTriplanar === false ? 0.0 : 1.0;
    this._needsRender = true;
  }

  _disposeSurfaceAtlas(atlas) {
    atlas?.diffuse?.dispose?.();
    atlas?.props?.dispose?.();
  }

  _installSurfaceAtlas(atlas) {
    const u = this.uniforms;
    if (!u?.uSurfDiffuse || !atlas) return false;
    u.uSurfDiffuse.value = atlas.diffuse;
    u.uSurfProps.value = atlas.props;
    u.uSurfPresent.value = atlas.present.map((v) => (v ? 1.0 : 0.0));
    if (u.uSurfRolePresent) {
      u.uSurfRolePresent.value = (atlas.rolePresent ?? atlas.layers?.map((layer) => (layer.hasDiffuse ? 1 : 0)) ?? [])
        .map((v) => (v ? 1.0 : 0.0));
    }
    u.uSurfTile.value = atlas.tile.slice();
    this._surfaceAtlas = atlas;
    this._needsRender = true;
    return true;
  }

  // Install freshly-built atlas textures (from SurfaceTextureAtlas.buildSurfaceAtlas).
  // Atlases are cached by source so switching Default <-> Custom doesn't rebuild
  // or dispose the source that is currently inactive.
  setSurfaceAtlas(atlas, source = this.params.surfaceTextureSource) {
    const surfaceTextureSource = normalizeSurfaceTextureSource({ surfaceTextureSource: source });
    if (!this._surfaceAtlasCache) this._surfaceAtlasCache = {};
    const previous = this._surfaceAtlasCache[surfaceTextureSource];
    if (previous && previous !== atlas) this._disposeSurfaceAtlas(previous);
    atlas.source = surfaceTextureSource;
    this._surfaceAtlasCache[surfaceTextureSource] = atlas;
    return this._installSurfaceAtlas(atlas);
  }

  installCachedSurfaceAtlas(source = this.params.surfaceTextureSource) {
    const surfaceTextureSource = normalizeSurfaceTextureSource({ surfaceTextureSource: source });
    const atlas = this._surfaceAtlasCache?.[surfaceTextureSource];
    if (!atlas) return false;
    return this._installSurfaceAtlas(atlas);
  }

  getCachedSurfaceAtlas(source = this.params.surfaceTextureSource) {
    const surfaceTextureSource = normalizeSurfaceTextureSource({ surfaceTextureSource: source });
    return this._surfaceAtlasCache?.[surfaceTextureSource] ?? null;
  }

  _applyVisualSettings() {
    const p = this.params;
    const u = this.uniforms;
    if (!u?.uVisualTerrainColorVariation) return;
    u.uVisualTerrainColorVariation.value = p.visualsTerrainColorVariation ?? 0.36;
    u.uVisualTerrainHeightDetail.value = p.visualsTerrainHeightDetail ?? 0.42;
    u.uVisualWetShoreStrength.value = p.visualsWetShoreStrength ?? 0.55;
    u.uVisualRockDetail.value = p.visualsRockDetail ?? 0.45;
    u.uVisualSoilDetail.value = p.visualsSoilDetail ?? 0.35;
    u.uVisualSandDetail.value = p.visualsSandDetail ?? 0.38;
    u.uVisualFoamBreakup.value = p.visualsFoamBreakup ?? 0.45;
    u.uVisualWetSandRange.value = p.visualsWetSandRange ?? 18;
    u.uVisualShallowWaterSoftness.value = p.visualsShallowWaterSoftness ?? 0.38;
    this._needsRender = true;
  }

  _applyPixelRatio() {
    // base = legacy absolute override if set, otherwise device pixel ratio;
    // Render Scale and auto-performance now size the offscreen scene buffer;
    // the visible canvas stays at this native base ratio for reconstruction.
    // On a low-tier GPU, cap the ceiling lower so a 2× HiDPI panel doesn't make
    // a weak GPU render 4× the pixels.
    const legacy = this.params?.pixelRatio || 0;
    const ceiling = this.gpuTier === 'low' ? 1.25 : 2;
    const base = legacy > 0 ? legacy : Math.min(window.devicePixelRatio, ceiling);
    this._basePixelRatio = Math.min(ceiling, Math.max(0.3, base));
    this._pixelRatioCeiling = ceiling;
    this.renderer.setPixelRatio(this._basePixelRatio);
    this._needsRender = true;   // resolution changed → force a redraw
  }

  _effectiveRenderScale() {
    const requested = (this.perf?.renderScale ?? 1) * this._autoScale;
    const base = this._basePixelRatio || this.renderer?.getPixelRatio?.() || 1;
    const ceiling = this._pixelRatioCeiling || 2;
    return Math.max(0.1, Math.min(requested, ceiling / Math.max(base, 0.01)));
  }

  _prepareCameraPipeline() {
    const cloudsNeedDepth = this.worldMode === 'studio'
      ? !!this.studioCloud?.active
      : (this.worldMode === 'infinite'
        ? !!this.infiniteCloud?.active
        : (this.worldMode === 'planet'
          && (!!this.planetCloudLayer?.active || !!this.planetCloudChunks?.active)));
    const requireSharedOpaque = cloudsNeedDepth
      || !!this.waterSystem?.needsSceneRefraction?.();
    return this.visualPost.prepare(this.renderer, {
      params: {
        ...this.params,
        ...this._pendingTerrainParams,
        noiseStack: this._pendingNoiseStack ?? this.params.noiseStack,
      },
      perf: this.perf,
      worldMode: this.worldMode,
      renderScale: this._effectiveRenderScale(),
      time: this.uniforms.uTime.value,
      sunScreen: this._underwaterSunScreen(),
      sunColor: this.sunLight?.color,
      requireSceneDepth: requireSharedOpaque || !!this.underwater?.active,
      requireSceneTarget: !!this.underwater?.active,
      requireSharedOpaque,
    });
  }

  _resolveCameraCompileTarget() {
    if (!this.visualPost?.prepare || !this.renderer) {
      return { renderTarget: null, usesSceneTarget: false };
    }
    const plan = this._prepareCameraPipeline();
    const renderTarget = plan?.usesSceneTarget ? (this.visualPost.inputTarget ?? null) : null;
    return { renderTarget, usesSceneTarget: !!renderTarget };
  }

  _sameCameraCompileTarget(a, b) {
    return !!a && !!b
      && a.usesSceneTarget === b.usesSceneTarget
      && a.renderTarget === b.renderTarget;
  }
  _compileCameraTargetMaterials(mats, { timeoutMs = 120000, stagger = false } = {}) {
    const { renderTarget } = this._resolveCameraCompileTarget();
    return this._compileMaterialVariants(mats, {
      canvasOnly: true,
      timeoutMs,
      stagger,
      renderTarget,
    });
  }

  async _compileExactPass(pass, { timeoutMs = 120000 } = {}) {
    if (!pass?.scene || !pass?.camera || !pass?.mesh || !pass?.material) {
      return { ready: true, timedOut: false, pendingCount: 0, waitMs: 0, syncCompileMs: 0 };
    }
    const renderer = this.renderer;
    const previousMaterial = pass.mesh.material;
    const previousTarget = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace?.() ?? 0;
    const previousMip = renderer.getActiveMipmapLevel?.() ?? 0;
    const previousXr = renderer.xr?.enabled;
    let pending = [];
    const startedAt = performance.now();
    try {
      if (pass.disableXr && renderer.xr) renderer.xr.enabled = false;
      pass.mesh.material = pass.material;
      pass.camera.updateMatrixWorld?.(true);
      renderer.setRenderTarget(
        pass.renderTarget ?? null,
        pass.activeCubeFace ?? 0,
        pass.activeMipmapLevel ?? 0,
      );
      pending = renderer.compile(pass.scene, pass.camera, pass.scene) || [];
    } finally {
      pass.mesh.material = previousMaterial;
      renderer.setRenderTarget(previousTarget, previousFace, previousMip);
      if (renderer.xr && previousXr !== undefined) renderer.xr.enabled = previousXr;
    }
    const syncCompileMs = performance.now() - startedAt;
    const result = await this._waitForMaterialsReady(pending, { timeoutMs });
    return { ...result, syncCompileMs };
  }

  async _compilePreparedPasses(handle, { timeoutMs = 120000 } = {}) {
    const passes = handle?.passes || [];
    if (!passes.length) {
      return { ready: true, timedOut: false, pendingCount: 0, waitMs: 0, syncCompileMs: 0 };
    }
    const results = [];
    for (const pass of passes) {
      const result = await this._compileExactPass(pass, { timeoutMs });
      results.push(result);
      if (result?.ready !== true) break;
      await yieldTask();
    }
    return {
      ready: results.length === passes.length && results.every((result) => result?.ready === true),
      timedOut: results.some((result) => result?.timedOut === true),
      pendingCount: results.reduce((sum, result) => sum + (result?.pendingCount || 0), 0),
      waitMs: results.reduce((sum, result) => sum + (result?.waitMs || 0), 0),
      syncCompileMs: results.reduce((sum, result) => sum + (result?.syncCompileMs || 0), 0),
    };
  }
  _cameraSceneSize(plan) {
    return { x: plan.sceneWidth, y: plan.sceneHeight };
  }

  _renderLowResCloudAfterScene(layer, target, sceneSize) {
    if (!layer?.usesLowRes) return false;
    const sceneDepth = this.visualPost?.opaqueTarget?.depthTexture
      || target?.depthTexture
      || null;
    if (!layer.useSceneDepth(sceneDepth, this.camera, sceneSize)) return false;
    layer.renderLowRes(this.renderer, this.camera, sceneSize);
    this.renderer.setRenderTarget(target);
    // The scene depth is attached to `target`; do not sample that same texture
    // while writing the composite back into the framebuffer. The march itself
    // already used depth, and alpha-guided upscaling preserves its silhouette.
    layer.compositeLowRes(this.renderer, null);
    return true;
  }

  _captureWaterSceneRefraction(sceneSize, sourceTarget = null) {
    if (!this.waterSystem) return false;
    this.profiler.begin('water-refraction');
    try {
      return this.waterSystem.captureSceneRefraction(
        this.renderer,
        this.scene,
        this.camera,
        sceneSize,
        sourceTarget,
      );
    } finally {
      this.profiler.end('water-refraction');
    }
  }

  _captureWaterPlanarReflection(sceneSize, revision = null) {
    if (!this.waterSystem) return false;
    this.profiler.begin('water-reflection');
    try {
      return this.waterSystem.capturePlanarReflection(
        this.renderer,
        this.scene,
        this.camera,
        sceneSize,
        revision,
      );
    } finally {
      this.profiler.end('water-reflection');
    }
  }

  _sceneRevisionKey(sceneSize, includeCloudMotion = false) {
    this.camera.updateMatrixWorld?.(true);
    const worldElements = this.camera.matrixWorld?.elements || [];
    const projectionElements = this.camera.projectionMatrix?.elements || [];
    const camera = [...worldElements, ...projectionElements]
      .map((value) => Number(value).toFixed(4))
      .join(',');
    const sun = this.uniforms?.uSunDir?.value;
    const cloudTick = includeCloudMotion && this.params?.cloudsEnabled
      ? Math.floor((this.uniforms?.uTime?.value || 0) * 4)
      : 0;
    // Shared opaque refraction contains the terrain itself. Its caustic shader
    // animates with uTime even on a static camera, so include a modest 4 Hz
    // revision only while animated caustics and scene refraction are active.
    // This keeps the cache effective without freezing the illuminated seabed.
    const causticTick = !includeCloudMotion
      && this.waterSystem?.needsSceneRefraction?.()
      && (this.uniforms?.uCausticBlend?.value ?? 0) > 0.001
      && (this.uniforms?.uCausticStrength?.value ?? 0) > 0.001
      && (this.uniforms?.uCausticWaterAnim?.value ?? 0) > 0.5
      ? Math.floor((this.uniforms?.uTime?.value || 0) * 4)
      : 0;
    const boardState = this.board
      ? [
        this.board.activeChunkCount ?? 0,
        this.board.targetChunkCount ?? 0,
        this.board.isBuilding ? 1 : 0,
        this.board._lodRebuildQueue?.length ?? 0,
        ...(this.board.lodCounts ?? []),
        this.board.mergedGroupCount ?? 0,
        this.board.visibleChunkCount ?? 0,
      ].join(',')
      : '';
    const terrainTexture = this.uniforms?.uTerrainHeightTex?.value;
    const terrainBakeState = [
      this._bakedStudioGen ?? -1,
      this._bakedStudioLayout ?? '',
      this.uniforms?.uUseTerrainHeightTex?.value ?? 0,
      this.uniforms?.uUseTerrainBiomeTex?.value ?? 0,
      terrainTexture?.uuid ?? '',
      terrainTexture?.version ?? 0,
    ].join(',');
    const importedState = ['noise', 'height', 'biome', 'imagery']
      .map((type) => {
        const entry = this.importedMaps?.[type];
        return [
          type,
          entry?.texture?.uuid ?? '',
          entry?.texture?.version ?? 0,
          JSON.stringify(entry?.settings ?? null),
        ].join(':');
      })
      .join(',');
    const authoringState = [
      this.paintMode?.layers?.revision ?? 0,
      this.manualTerrain?.field?.revision ?? 0,
      this.manualTerrain?.surfaceField?.revision ?? 0,
      this.splineManager?.baker?.revision ?? 0,
    ].join(',');
    return [
      this.worldMode,
      sceneSize.x ?? sceneSize.width,
      sceneSize.y ?? sceneSize.height,
      this._terrainGen,
      this.terrainMaterial?.version ?? 0,
      boardState,
      terrainBakeState,
      importedState,
      authoringState,
      camera,
      sun ? `${sun.x.toFixed(4)},${sun.y.toFixed(4)},${sun.z.toFixed(4)}` : '',
      cloudTick,
      causticTick,
      JSON.stringify(this.params || {}),
    ].join('|');
  }

  _sharedOpaqueRoots() {
    return [
      this.water,
      this.infiniteWorld?.waterPlane,
      this.planetWater,
      this.studioCloud?.mesh,
      this.infiniteCloud?.mesh,
      this.planetCloudLayer?.mesh,
      this.planetCloudChunks?.group,
      this.waterSystem?._boundsHelper,
      ...this._captureOverlayRoots(),
    ].filter(Boolean);
  }

  _prepareSharedOpaque(plan, sceneSize) {
    const target = this.visualPost.opaqueTarget;
    if (!target) {
      this._captureWaterSceneRefraction(sceneSize, null);
      return false;
    }
    const revision = this._sceneRevisionKey(sceneSize, false);
    const targetChanged = target !== this._sharedOpaqueTarget;
    if (targetChanged || revision !== this._sharedOpaqueRevision) {
      const visibility = [...new Set(this._sharedOpaqueRoots())]
        .map((object) => [object, object.visible]);
      const previousTarget = this.renderer.getRenderTarget();
      try {
        for (const [object] of visibility) object.visible = false;
        this.renderer.setRenderTarget(target);
        this.renderer.render(this.scene, this.camera);
      } finally {
        this.renderer.setRenderTarget(previousTarget);
        for (const [object, visible] of visibility) object.visible = visible;
      }
      this._sharedOpaqueRevision = revision;
      this._sharedOpaqueTarget = target;
    }

    this._captureWaterSceneRefraction(sceneSize, target);
    const depth = target.depthTexture;
    this.studioCloud?.useSceneDepth?.(depth, this.camera, sceneSize);
    this.infiniteCloud?.useSceneDepth?.(depth, this.camera, sceneSize);
    this.planetCloudLayer?.useSceneDepth?.(depth, this.camera, sceneSize);
    this.planetCloudChunks?.useSceneDepth?.(depth, this.camera, sceneSize);
    return true;
  }

  _applyUnderwaterFromSharedTarget(target) {
    if (!this.underwater?.active || !target) return target;
    this._ensureUnderwaterWarmTarget(target);
    const currentIdentity = this._captureUnderwaterWarmIdentity(target);
    if (!this._underwaterWarmed
        || !this._sameUnderwaterWarmIdentity(this._underwaterWarmIdentity, currentIdentity)) {
      // Never enter a post-process variant while its exact scene topology,
      // material versions, or render targets are still linking. Keep the
      // already-rendered scene visible for this frame.
      this._underwaterWarmed = false;
      this._underwaterWarmIdentity = null;
      void this._warmUnderwaterShaders(target);
      return target;
    }
    const underwaterTarget = this.underwater.compositeFromTarget(
      this.renderer,
      this.camera,
      target,
    );
    if (underwaterTarget?.texture) {
      this.visualPost.setInputTexture(underwaterTarget.texture);
    }
    return underwaterTarget;
  }

  // -------------------------------------------------- async shader compiling
  // Heavy shaders are compiled via renderer.compile + _waitForMaterialsReady so
  // the GPU driver can link off-thread (KHR_parallel_shader_compile) while ticks
  // keep running. Avoids Three.js compileAsync crashing when currentProgram is
  // still undefined during transparent DoubleSide prepare.

  async _compileMaterialVariants(mats, {
    canvasOnly = false,
    timeoutMs,
    stagger = false,
    onProgress,
    renderTarget = null,
  } = {}) {
    const list = mats.filter(Boolean);
    if (!list.length) {
      return {
        ready: true,
        timedOut: false,
        materialCount: 0,
        pendingCount: 0,
        waitMs: 0,
        syncCompileMs: 0,
        asyncWaitMs: 0,
      };
    }
    const passesPerMaterial = canvasOnly ? 1 : 2;
    const total = list.length * passesPerMaterial;

    if (stagger && list.length > 1) {
      let done = 0;
      const results = [];
      for (const m of list) {
        results.push(await this._compileMaterialVariants([m], {
          canvasOnly,
          timeoutMs,
          onProgress: (stepDone) => onProgress?.(done + stepDone, total),
          renderTarget,
        }));
        done += passesPerMaterial;
        await yieldTask();
      }
      return {
        ready: results.every((result) => result.ready),
        timedOut: results.some((result) => result.timedOut),
        materialCount: list.length,
        pendingCount: results.reduce((sum, result) => sum + result.pendingCount, 0),
        waitMs: results.reduce((sum, result) => sum + result.waitMs, 0),
        syncCompileMs: results.reduce((sum, result) => sum + result.syncCompileMs, 0),
        asyncWaitMs: results.reduce((sum, result) => sum + result.asyncWaitMs, 0),
      };
    }

    const group = new THREE.Group();
    for (const m of list) group.add(new THREE.Mesh(this._warmGeo, m));

    const waitOpts = timeoutMs != null ? { timeoutMs } : undefined;
    const compileStartedAt = performance.now();
    const previousTarget = this.renderer.getRenderTarget();
    let pending;
    try {
      this.renderer.setRenderTarget(renderTarget);
      pending = this.renderer.compile(group, this.camera, this.scene);
    } finally {
      this.renderer.setRenderTarget(previousTarget);
    }
    const syncCompileMs = performance.now() - compileStartedAt;
    const waitStartedAt = performance.now();
    const canvasResult = await this._waitForMaterialsReady(pending, waitOpts);
    const asyncWaitMs = performance.now() - waitStartedAt;
    const parallelCompile = Boolean(
      this.renderer.getContext().getExtension('KHR_parallel_shader_compile')
    );
    console.info(
      `[shader compile] pass=${renderTarget ? 'scene-target' : 'canvas'}`
      + ` materials=${list.length}`
      + ` sync=${syncCompileMs.toFixed(0)}ms`
      + ` async=${asyncWaitMs.toFixed(0)}ms`
      + ` ready=${canvasResult.ready}`
      + ` pending=${canvasResult.pendingCount}`
      + ` parallel=${parallelCompile}`
    );
    onProgress?.(list.length, total);

    if (canvasOnly) {
      return { ...canvasResult, materialCount: list.length, syncCompileMs, asyncWaitMs };
    }

    this.underwater._ensureTarget(this.renderer);
    this.renderer.setRenderTarget(this.underwater._rt);
    const rtCompileStartedAt = performance.now();
    const pendingRt = this.renderer.compile(group, this.camera, this.scene);
    const rtSyncCompileMs = performance.now() - rtCompileStartedAt;
    this.renderer.setRenderTarget(null);
    const rtWaitStartedAt = performance.now();
    const rtResult = await this._waitForMaterialsReady(pendingRt, waitOpts);
    const rtAsyncWaitMs = performance.now() - rtWaitStartedAt;
    console.info(
      `[shader compile] pass=underwater`
      + ` materials=${list.length}`
      + ` sync=${rtSyncCompileMs.toFixed(0)}ms`
      + ` async=${rtAsyncWaitMs.toFixed(0)}ms`
      + ` ready=${rtResult.ready}`
      + ` pending=${rtResult.pendingCount}`
      + ` parallel=${parallelCompile}`
    );
    onProgress?.(total, total);
    return {
      ready: canvasResult.ready && rtResult.ready,
      timedOut: canvasResult.timedOut || rtResult.timedOut,
      materialCount: list.length,
      pendingCount: canvasResult.pendingCount + rtResult.pendingCount,
      waitMs: canvasResult.waitMs + rtResult.waitMs,
      syncCompileMs: syncCompileMs + rtSyncCompileMs,
      asyncWaitMs: asyncWaitMs + rtAsyncWaitMs,
    };
  }


  async _compileInstancedMaterialVariant(material, geometry, renderTarget = null, {
    timeoutMs = 120000,
  } = {}) {
    if (!material || !geometry) return { ready: true, pendingCount: 0 };
    const group = new THREE.Group();
    const probe = new THREE.InstancedMesh(geometry, material, 1);
    probe.count = 1;
    probe.setMatrixAt(0, new THREE.Matrix4());
    group.add(probe);
    const previousTarget = this.renderer.getRenderTarget();
    const startedAt = performance.now();
    let pending;
    try {
      this.renderer.setRenderTarget(renderTarget);
      pending = this.renderer.compile(group, this.camera, this.scene);
    } finally {
      this.renderer.setRenderTarget(previousTarget);
    }
    const syncCompileMs = performance.now() - startedAt;
    const result = await this._waitForMaterialsReady(pending, { timeoutMs });
    return { ...result, syncCompileMs };
  }
  /**
   * Poll until compiled materials report ready. Guards against Three.js
   * compileAsync throwing when currentProgram is still undefined (common for
   * transparent DoubleSide materials mid-prepare).
   */
  _waitForMaterialsReady(materials, { timeoutMs = 45000 } = {}) {
    const pending = new Set(materials);
    const props = this.renderer.properties;
    const gl = this.renderer.getContext?.();

    return new Promise((resolve) => {
      if (!pending.size) {
        resolve({
          ready: true,
          timedOut: false,
          pendingCount: 0,
          waitMs: 0,
        });
        return;
      }
      const start = performance.now();

      const check = () => {
        if (this._disposed || this._contextLost || gl?.isContextLost?.()) {
          resolve({
            ready: false,
            timedOut: false,
            aborted: true,
            contextLost: this._contextLost || gl?.isContextLost?.() || false,
            pendingCount: pending.size,
            waitMs: performance.now() - start,
          });
          return;
        }

        pending.forEach((material) => {
          const program = props.get(material)?.currentProgram;
          if (program?.isReady?.()) pending.delete(material);
        });

        const waitMs = performance.now() - start;
        if (!pending.size) {
          resolve({
            ready: true,
            timedOut: false,
            pendingCount: 0,
            waitMs,
          });
          return;
        }
        if (waitMs >= timeoutMs) {
          console.warn(`Shader compile wait timed out (${pending.size} material(s) still pending)`);
          resolve({
            ready: false,
            timedOut: true,
            pendingCount: pending.size,
            waitMs,
          });
          return;
        }
        yieldFrame().then(check);
      };

      yieldFrame().then(check);
    });
  }

  async _withStudioCloudDetached(task) {
    const mesh = this.studioCloud?.mesh;
    const parent = mesh?.parent || null;
    if (parent) parent.remove(mesh);
    try {
      return await task();
    } finally {
      if (!this._disposed && this.worldMode === 'studio'
          && this.studioCloud?.mesh === mesh && parent && !mesh.parent) parent.add(mesh);
    }
  }

  async _withBootDeferredObjectsDetached(task) {
    const items = [this.studioCloud?.mesh].filter(Boolean)
      .map((mesh) => ({ mesh, parent: mesh.parent || null }));
    for (const { mesh, parent } of items) {
      if (parent) parent.remove(mesh);
    }
    try {
      return await task();
    } finally {
      for (const { mesh, parent } of items) {
        if (!this._disposed && this.worldMode === 'studio'
            && this.studioCloud?.mesh === mesh && parent && !mesh.parent) parent.add(mesh);
      }
      if (this._waterDeferred && this.water) this.water.visible = false;
    }
  }

  /**
   * Compile every unique material currently in the scene, yielding between
   * programs, then wait for all programs to finish linking.
   *
   * Why one-per-task: ANGLE (Chrome on Windows → D3D11) does the GLSL→HLSL
   * translation for each program SYNCHRONOUSLY on the calling thread inside
   * renderer.compile(). KHR_parallel_shader_compile only moves the *D3D bytecode*
   * link onto a driver thread — the translation still blocks the main thread.
   * Compiling the whole scene in one call therefore freezes the tab for the SUM
   * of every shader's translation (several seconds with the heavy FBM terrain +
   * volumetric materials). Initiating one material per yielded browser task caps
   * the worst stall at a single shader's translation and lets the browser stay
   * responsive in between, while the driver still links all the programs in
   * parallel — so total wall-clock time does not regress.
   *
   * The board shares one terrain material across all its chunks, so the Set
   * collapses hundreds of meshes down to a handful of unique programs.
   *
   * @param {THREE.WebGLRenderTarget|null} [renderTarget] compile the render-target
   *   program variant (e.g. the underwater linear-output pass) instead of canvas.
   * @param {boolean} [visibleOnly] skip materials whose meshes are hidden (deferred
   *   water, disk wall, tile ghost, disabled sky) — they compile lazily when shown.
   */
  async _compileSceneStaggered(renderTarget = null, {
    visibleOnly = false,
    skipMinimalTerrain = false,
    skipWaterMaterial = false,
    skipMaterials = null,
    timeoutMs,
  } = {}) {
    // One material can have multiple WebGL program variants depending on the
    // draw topology. In particular, ProceduralPropsManager uses InstancedMesh;
    // warming it with a plain Mesh leaves USE_INSTANCING cold for the first dive.
    const variants = new Map();
    this.scene.traverse((obj) => {
      if (!obj.material) return;
      if (visibleOnly && !this._isRenderable(obj)) return;
      const topology = obj.isInstancedMesh ? 'instanced' : 'mesh';
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => {
        if (!m
            || skipMaterials?.has?.(m)
            || (skipMinimalTerrain && m.userData?.minimalFragment)
            || (skipWaterMaterial && m === this.waterMaterial)) return;
        const key = `${m.id}:${topology}`;
        if (!variants.has(key)) variants.set(key, { material: m, source: obj, topology });
      });
    });
    if (!variants.size) {
      return { ready: true, timedOut: false, pendingCount: 0, waitMs: 0 };
    }

    const prevTarget = renderTarget ? this.renderer.getRenderTarget() : null;
    const allPending = new Set();
    for (const { material, source, topology } of variants.values()) {
      if (this._disposed) break;
      const group = new THREE.Group();
      const geometry = source?.geometry ?? this._warmGeo;
      let probe;
      if (topology === 'instanced') {
        probe = new THREE.InstancedMesh(geometry, material, 1);
        probe.count = 1;
        probe.setMatrixAt(0, new THREE.Matrix4());
      } else {
        probe = new THREE.Mesh(geometry, material);
      }
      probe.castShadow = !!source?.castShadow;
      probe.receiveShadow = !!source?.receiveShadow;
      group.add(probe);
      if (renderTarget) this.renderer.setRenderTarget(renderTarget);
      const pending = this.renderer.compile(group, this.camera, this.scene);
      if (renderTarget) this.renderer.setRenderTarget(prevTarget);
      pending.forEach((m) => allPending.add(m));
      await yieldTask();
    }
    const waitOpts = timeoutMs != null ? { timeoutMs } : undefined;
    return this._waitForMaterialsReady(allPending, waitOpts);
  }

  /** True when the object (and its whole parent chain) is visible. */
  _isRenderable(obj) {
    for (let o = obj; o; o = o.parent) {
      if (o.visible === false) return false;
    }
    return true;
  }

  /**
   * Compile realistic water shaders without pausing the whole app, then swap.
   * Legacy water stays visible until programs are linked.
   */
  compileWaterMaterialsAsync(materials, onSwap) {
    const mats = materials.filter(Boolean);
    if (!mats.length) {
      onSwap?.();
      return Promise.resolve(true);
    }

    this.cb.onStatus('Compiling water shaders…', false);

    return new Promise((resolve) => {
      const run = async () => {
        let ready = false;
        try {
          const result = await this._compileCameraTargetMaterials(mats, {
            timeoutMs: 20000,
            stagger: mats.length > 1,
          });
          this._recordWaterShaderCompile('mode-switch', result);
          ready = result?.ready === true;
          if (!ready) {
            console.warn(
              `Water shader compile still pending after ${result?.waitMs?.toFixed?.(0) ?? 0}ms; keeping the current material`
            );
            const states = await Promise.all(
              mats.map((mat) => this._pollProgramReady(mat, { tries: 240, intervalMs: 250 }))
            );
            ready = states.every(Boolean);
          }
          if (ready && !this._disposed) onSwap?.();
          else if (!ready) console.warn('Water shader did not become ready; material swap skipped');
        } catch (e) {
          console.warn('Water shader compile failed', e);
        } finally {
          if (!this._disposed) this.cb.onStatus('Ready', false);
          resolve(ready);
        }
      };

      // Yield twice so the UI can paint before kicking off GPU work.
      yieldTask().then(() => yieldTask().then(run));
    });
  }

  _recordWaterShaderCompile(reason, result) {
    if (!result) return;
    this._lastWaterShaderCompile = {
      reason,
      ready: result.ready === true,
      timedOut: result.timedOut === true,
      materialCount: result.materialCount ?? null,
      syncCompileMs: Number.isFinite(result.syncCompileMs) ? Math.round(result.syncCompileMs * 100) / 100 : null,
      asyncWaitMs: Number.isFinite(result.asyncWaitMs) ? Math.round(result.asyncWaitMs * 100) / 100 : null,
      totalMs: Number.isFinite(result.syncCompileMs) && Number.isFinite(result.asyncWaitMs)
        ? Math.round((result.syncCompileMs + result.asyncWaitMs) * 100) / 100
        : null,
      capturedAt: new Date().toISOString(),
    };
    this.profiler.setMetric('waterShaderCompile', this._lastWaterShaderCompile);
  }

  /** Compile a final-quality first frame behind the loading overlay. */
  async _warmupInitialShaders() {
    this._compiling++;
    this.cb.onStatus('Preparing first frame…', true);
    const startedAt = performance.now();
    try {
      // Allocate/size the current visual pipeline before painting the safety
      // frame. The exact compile target is resolved later, immediately before
      // each asynchronous warm attempt.
      this._prepareCameraPipeline();
      // Paint a trivial safety frame before starting live shader translation.
      // It remains behind the opaque overlay and is never a normal editor frame.
      this._bootShaderPending = true;
      const paintMs = this._renderBootPlaceholderFrame();
      this._bootFallbackFrameReady = paintMs != null;
      if (this._bootFallbackFrameReady) this._startBootWatchdog();
      console.info(
        `[boot] safe placeholder ${(paintMs ?? 0).toFixed(0)}ms; `
        + `elapsed ${(performance.now() - startedAt).toFixed(0)}ms`
      );
      this.cb.onStatus('Loading terrain detail…', true);
    } catch (error) {
      console.warn('Initial safety frame failed', error);
    } finally {
      this._compiling--;
    }
    if (!this._disposed && this._bootFallbackFrameReady) {
      void this._resumeInitialShaderWarmup();
    }
  }


  _renderBootPlaceholderFrame() {
    if (this.worldMode !== 'studio' || this._disposed) return null;
    const t0 = performance.now();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111722);
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({ color: 0x52634c });
    const plane = new THREE.Mesh(geometry, material);
    const width = Math.max(1, this._unionWidth?.() ?? this.boardSize ?? 1);
    const depth = Math.max(1, this._unionDepth?.() ?? this.boardSize ?? 1);
    const center = this._unionCenter?.() ?? { x: 0, z: 0 };
    plane.scale.set(width, 1, depth);
    plane.position.set(center.x, 0, center.z);
    scene.add(plane);
    this.controls.update(0.016);
    this.camera.updateMatrixWorld(true);
    const previousTarget = this.renderer.getRenderTarget();
    try {
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, this.camera);
    } finally {
      this.renderer.setRenderTarget(previousTarget);
      geometry.dispose();
      material.dispose();
    }
    this._lastRenderAt = performance.now();
    this._camPos.copy(this.camera.position);
    this._camQuat.copy(this.camera.quaternion);
    this._needsRender = false;
    return performance.now() - t0;
  }

  async _resumeInitialShaderWarmup() {
    if (this._disposed || !this._bootShaderPending) return;
    // Two animation frames guarantee the placeholder is composited before a
    // driver call can spend time translating the live terrain shader.
    await yieldFrame();
    await yieldFrame();
    if (this._disposed || !this._bootShaderPending) return;
    this._bgWorkStart('boot-shader', 'Finishing graphics initialization…');
    const targetSnapshot = this._resolveCameraCompileTarget();
    let result = null;
    try {
      const materials = [
        this.terrainMaterial,
        this.plinth?.material,
        this.proceduralSky?.material,
      ].filter(Boolean);
      result = await this._compileMaterialVariants([...new Set(materials)], {
        canvasOnly: true,
        stagger: true,
        timeoutMs: 120000,
        renderTarget: targetSnapshot.renderTarget,
      });
    } catch (error) {
      console.warn('Background first-frame shader warmup failed', error);
    }
    if (this._disposed) return;
    const currentTarget = this._resolveCameraCompileTarget();
    if (result?.ready === true
        && !this._sameCameraCompileTarget(targetSnapshot, currentTarget)) {
      // Post-processing/underwater toggled while the program linked. Keep the
      // safety frame active and immediately warm the actual destination.
      await yieldTask();
      if (!this._disposed && this._bootShaderPending) {
        void this._resumeInitialShaderWarmup();
      }
      return;
    }
    if (result?.ready === true) {
      this._bootShaderPending = false;
      this._initialShaderRetryCount = 0;
      this._bgWorkEnd('boot-shader');
      this._needsRender = true;
      this._completeBootIfInteractiveReady('final terrain shader ready');
      if (this.worldMode === 'studio') {
        this._schedulePostFirstPaintWarmups(150);
      }
      return;
    }
    const retry = this._initialShaderRetryCount + 1;
    this._initialShaderRetryCount = retry;
    if (retry <= 3) {
      const delay = Math.min(15000, 2000 * (2 ** (retry - 1)));
      this._initialShaderRetryTimer = setTimeout(() => {
        this._initialShaderRetryTimer = null;
        void this._resumeInitialShaderWarmup();
      }, delay);
      return;
    }

    // Terminal driver failure: remain interactive with a deliberately degraded
    // flat board instead of freezing forever or forcing an unfinished link.
    console.warn('Initial graphics shaders unavailable; entering degraded safe mode');
    this._bootShaderPending = false;
    this._bgWorkEnd('boot-shader');
    this._bootDegradedMaterial = new THREE.MeshBasicMaterial({ color: 0x52634c });
    if (this.board) {
      this.board.material = this._bootDegradedMaterial;
      for (const chunk of this.board.chunks) chunk.mesh.material = this._bootDegradedMaterial;
    }
    if (this.plinth) this.plinth.visible = false;
    if (this.diskWall) this.diskWall.visible = false;
    if (this.water) this.water.visible = false;
    this.proceduralSky?.setVisible(false);
    this.studioCloud?.setInScene(false);
    this._needsRender = true;
    this.cb.onToast?.('Graphics initialization failed; running in safe mode');
    this._completeBootIfInteractiveReady('degraded graphics mode');
  }


  _bootReadinessSnapshot() {
    const targetVariant = this._targetTerrainVariant();
    return {
      bootPending: this._bootPending,
      fallbackFrameReady: this._bootFallbackFrameReady,
      terrain: {
        minimal: !!this.terrainMaterial?.userData?.minimalFragment,
        current: this.terrainMaterial?.userData?.terrainVariant ?? null,
        target: targetVariant,
        upgradePending: !!this._terrainUpgradePromise,
      },
      bake: {
        heightReady: (this.uniforms?.uUseTerrainHeightTex?.value ?? 0) > 0.5,
        biomeReady: (this.uniforms?.uUseTerrainBiomeTex?.value ?? 0) > 0.5,
        active: !!this.terrainHeightBaker?.isBaking,
        progress: this.profiler?.getMetric?.('terrainBakeProgress') ?? null,
      },
      water: {
        deferred: this._waterDeferred,
        bakeReady: this._isStudioWaterBakeReady(),
        warmed: this._waterMaterialWarmed,
        enabled: this.params?.waterEnabled !== false,
      },
      board: {
        active: this.board?.activeChunkCount ?? 0,
        target: this.board?.targetChunkCount ?? 0,
        building: !!this.board?.isBuilding,
        lodPending: this.board?._lodRebuildQueue?.length ?? 0,
      },
    };
  }

  _logBootGate(label) {
    const now = performance.now();
    if (now - this._bootGateLogAt < 1000) return;
    this._bootGateLogAt = now;
    console.info(`[boot gate] ${label}`, this._bootReadinessSnapshot());
  }

  _startBootWatchdog() {
    if (this._disposed || !this._bootPending || !this._bootFallbackFrameReady
        || this._bootWatchdogTimer) return;
    const delayMs = this.gpuTier === 'low' ? 8000 : 12000;
    this._bootWatchdogTimer = setTimeout(() => {
      this._bootWatchdogTimer = null;
      if (this._disposed || !this._bootPending || !this._bootFallbackFrameReady) return;
      console.warn('[boot] interactive startup watchdog elapsed', this._bootReadinessSnapshot());
      this.cb.onStatus?.('Still preparing full-quality terrain and water…', true);
      // Keep the safety frame behind the overlay. Performance work may take
      // longer, but an unfinished or low-detail terrain is never a normal
      // editor frame. Terminal shader failure has its own explicit safe mode.
      if (!this._completeBootIfInteractiveReady('startup watchdog')) {
        this._startBootWatchdog();
      }
    }, delayMs);
  }

  _startQualityWatchdog() {
    if (this._disposed || !this._qualityPending || this._qualityWatchdogTimer) return;
    this._qualityWatchdogTimer = setTimeout(() => {
      this._qualityWatchdogTimer = null;
      if (this._disposed || !this._qualityPending) return;
      console.warn('[boot] optional quality work is still pending', this._bootReadinessSnapshot());
      this._bgWorkEnd('boot-quality');
    }, 30000);
  }

  _completeBootIfInteractiveReady(reason = 'interactive terrain ready', { alreadyRendered = false } = {}) {
    if (!this._bootPending || this._disposed || this._bootShaderPending) return false;

    const nodeMode = this.projectMode === 'nodes';
    const terrainReady = alreadyRendered || nodeMode || !!this.terrainMaterial;
    const boardReady = alreadyRendered || nodeMode
      || !this.board
      || (this.board.activeChunkCount ?? 0) > 0;
    const landingWaterRequired = this._landingShowcase
      && this.worldMode === 'studio'
      && !!this.waterMaterial
      && isWaterActive(
        resolveEffectiveWaterMode(this.params, this.worldMode),
        this.params.seaLevel,
      );
    const waterSafe = alreadyRendered || nodeMode
      || this.params.waterEnabled === false
      || !this.waterMaterial
      || !this._waterDeferred
      || (!landingWaterRequired
        && this._waterDeferred
        && this.water?.visible !== true);
    if (!this._bootFallbackFrameReady || !terrainReady || !boardReady || !waterSafe) {
      this._logBootGate('waiting for interactive frame');
      return false;
    }

    let paintMs = alreadyRendered ? 0 : null;
    if (!alreadyRendered && !this._contextLost) {
      try {
        paintMs = this._renderInitialStudioFrame();
      } catch (error) {
        console.warn('Interactive boot frame render failed', error);
      }
    }
    if (paintMs == null && !this._contextLost) {
      this._logBootGate('waiting for interactive rendered frame');
      return false;
    }
    this._bootInteractiveReady = true;
    console.info('[boot] interactive frame ' + (paintMs ?? 0).toFixed(0) + 'ms; '
      + 'elapsed ' + (performance.now() - this._bootStart).toFixed(0) + 'ms');
    return this._releaseBootFallback(reason, { render: false });
  }

  _completeBootIfQualityReady(reason = 'quality upgrades ready') {
    if (this._qualityPending === false || this._disposed) return false;

    const nodeMode = this.projectMode === 'nodes';
    const targetVariant = this._targetTerrainVariant();
    const terrainReady = nodeMode
      || (!this.terrainMaterial?.userData?.minimalFragment
        && this.terrainMaterial?.userData?.terrainVariant === targetVariant);
    const bakeReady = nodeMode
      || this._usesLiveStudioHeightField()
      || (this._bakedStudioGen === this._terrainGen
        && this._bakedStudioLayout === this._studioBakeLayoutKey()
        && (this.uniforms?.uUseTerrainHeightTex?.value ?? 0) > 0.5
        && (this.uniforms?.uUseTerrainBiomeTex?.value ?? 0) > 0.5
        && !this.terrainHeightBaker?.isBaking);
    const waterReady = nodeMode
      || this.params.waterEnabled === false
      || !this.waterMaterial
      || (!this._waterDeferred
        && !this.waterSystem?.isMaterialTransitionPending?.()
        && this.waterSystem?.isRequestedMaterialReady?.() !== false);
    const targetChunks = this.board?.targetChunkCount ?? 0;
    const activeChunks = this.board?.activeChunkCount ?? targetChunks;
    const boardReady = !this.board?.isBuilding
      && (this._debug?.freezeLod
        || !(this.board?._lodRebuildQueue?.length > 0))
      && (!targetChunks || activeChunks >= targetChunks);
    const sourceReady = this._terrainSourcePendingToken == null
      && !this._compiling;
    if (!terrainReady || !bakeReady || !waterReady || !boardReady || !sourceReady) {
      if (this._qualityPending) this._logBootGate('waiting for quality upgrades');
      return false;
    }

    let paintMs = null;
    if (!this._contextLost) {
      try {
        paintMs = this._renderInitialStudioFrame();
      } catch (error) {
        console.warn('Final boot frame render failed', error);
      }
    }
    if (paintMs == null && !this._contextLost) {
      this._logBootGate('waiting for final rendered frame');
      return false;
    }
    this._qualityPending = false;
    if (this._qualityWatchdogTimer) {
      clearTimeout(this._qualityWatchdogTimer);
      this._qualityWatchdogTimer = null;
    }
    this._bgWorkEnd('boot-quality');
    console.info(
      `[boot] final quality frame ${(paintMs ?? 0).toFixed(0)}ms `
      + `(terrain ready=${terrainReady}, bake ready=${bakeReady}, `
      + `water ready=${waterReady}, board ready=${boardReady}, `
      + `source ready=${sourceReady}); `
      + `elapsed ${(performance.now() - this._bootStart).toFixed(0)}ms`
    );
    if (this._bootPending) return this._releaseBootFallback(reason, { render: false });
    return true;
  }

  /**
   * Resolve when a blocking project/template transition has one coherent,
   * interactive Studio frame. Full-resolution baking, target shader variants,
   * water activation and remaining board/LOD chunks are background quality
   * work and must not hold the blocking overlay.
   */
  async waitForTerrainReady({ timeoutMs = 120000 } = {}) {
    if (this.worldMode !== 'studio') return !this._disposed;
    const startedAt = performance.now();
    while (!this._disposed) {
      if (this._contextLost) {
        throw new Error('Graphics context was lost while loading terrain');
      }
      if (performance.now() - startedAt > timeoutMs) {
        throw new Error('Terrain did not become ready before the loading timeout');
      }
      const nodeMode = this.projectMode === 'nodes';
      const terrainReady = nodeMode
        || !!this.terrainMaterial;
      const waterSafe = nodeMode
        || this.params.waterEnabled === false
        || !this.waterMaterial
        || this.water?.visible !== true
        || (!this._waterDeferred
          && !this.waterSystem?.isMaterialTransitionPending?.()
          && this.waterSystem?.isRequestedMaterialReady?.() !== false);
      const boardReady = nodeMode
        || !this.board
        || (this.board.activeChunkCount ?? 0) > 0;
      // rebuildActiveHeightProgram owns and awaits the source/material swap
      // before callers enter this gate. The global compile counter also tracks
      // optional shader warmups, so using it here can strand a blocking loader
      // behind unrelated quality work.
      const sourceReady = this._terrainSourcePendingToken == null;
      if (terrainReady && waterSafe && boardReady && sourceReady) {
        const paintMs = this._contextLost
          ? null
          : this._renderInitialStudioFrame();
        if (paintMs != null) return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 32));
    }
    throw new Error('Terrain engine was disposed while loading');
  }

  _releaseBootFallback(reason = 'fallback', { render = true } = {}) {
    if (!this._bootPending || this._disposed) return false;

    const log = (reason === 'quality upgrades ready' || reason === 'interactive terrain ready')
      ? console.info
      : console.warn;
    log(`[boot] releasing fallback: ${reason}`);
    if (render && !this._contextLost) {
      try {
        this._renderInitialStudioFrame();
      } catch (error) {
        console.warn('Fallback frame render failed', error);
      }
    }

    this._bootPending = false;
    if (this._bootWatchdogTimer) {
      clearTimeout(this._bootWatchdogTimer);
      this._bootWatchdogTimer = null;
    }
    this.cb.onStatus('Ready', false);
    if (this._tierNotice) {
      this.cb.onToast(this._tierNotice);
      this._tierNotice = null;
    }
    this.cb.onBootComplete?.();
    if (this._qualityPending) {
      this._bgWorkStart('boot-quality', 'Improving terrain quality…');
      this._startQualityWatchdog();
    }
    this._scheduleErosionGPUWarmImport();
    return true;
  }

  _scheduleErosionGPUWarmImport() {
    if (this._disposed || this._erosionGPUWarmScheduled) return;
    if (this.params.erosionBackend === 'cpu' || this._erosionGPUUnavailable) return;
    this._erosionGPUWarmScheduled = true;

    const run = () => {
      this._erosionGPUWarmCancel = null;
      if (this._disposed) return;
      this._importErosionGPU({ warm: true });
    };

    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(run, { timeout: 3000 });
      this._erosionGPUWarmCancel = () => cancelIdleCallback(id);
    } else {
      const id = setTimeout(run, 1000);
      this._erosionGPUWarmCancel = () => clearTimeout(id);
    }
  }

  /**
   * Track background (non-blocking) shader work for the UI. The status-bar
   * indicator shows the latest active label; null clears it. Unlike onStatus
   * busy=true this never gates rendering or the mode-switch overlay.
   */
  _bgWorkStart(id, label) {
    if (!this._bgWork) this._bgWork = new Map();
    this._bgWork.set(id, label);
    this.cb.onBackgroundWork?.(label);
  }

  _bgWorkEnd(id) {
    if (!this._bgWork) return;
    this._bgWork.delete(id);
    const rest = [...this._bgWork.values()];
    this.cb.onBackgroundWork?.(rest.length ? rest[rest.length - 1] : null);
  }
  _queueWarmMaterials(mats) {
    if (!mats?.length) return;
    if (this._disposed) {
      for (const material of mats) material?.dispose?.();
      return;
    }
    if (!this._matTrash) this._matTrash = [];
    this._matTrash.push({
      mats,
      afterRender: (this._mainRenderSerial ?? 0) + 1,
    });
  }

  _noteMainRender() {
    this._mainRenderSerial = (this._mainRenderSerial ?? 0) + 1;
  }

  _releaseWarmMaterialsAfterRender() {
    if (!this._matTrash?.length) return;
    const serial = this._mainRenderSerial ?? 0;
    const keep = [];
    for (const entry of this._matTrash) {
      if (serial >= entry.afterRender) {
        for (const material of entry.mats) material.dispose?.();
      } else {
        keep.push(entry);
      }
    }
    this._matTrash = keep;
  }


  /**
   * Poll (off the compile hot path) until a warmed material's program reports
   * ready. The _compileMaterialVariants wait can time out while the driver is
   * still linking (slow GPU, throttled/occluded tab); swapping sources onto a
   * not-ready program would force a blocking link — the exact freeze all of
   * this avoids — so the upgrade paths wait patiently here instead.
   */
  async _pollProgramReady(mat, { tries = 1200, intervalMs = 250 } = {}) {
    for (let i = 0; i < tries; i++) {
      if (this._disposed) return false;
      const prog = this.renderer.properties.get(mat)?.currentProgram;
      if (prog?.isReady?.()) return true;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
  }

  /**
   * The board boots on a minimal-fragment terrain material so the first paint
   * never waits on the full fragment's synchronous GLSL→HLSL translation (the
   * multi-second first-load freeze on Windows/ANGLE). Warm the full-source
   * program in the background here, then swap the live material's source in
   * place — at that point the program is cached, so the swap is instant and no
   * mesh needs touching (board chunks + disk wall share the material object).
   * The landing page is opaque, so the colour pop from the swap is invisible
   * on a normal boot.
   */
  async _upgradeMinimalTerrain(renderTarget = null, variant = this._targetTerrainVariant()) {
    if (!this.terrainMaterial?.userData?.minimalFragment) return;
    if (this._terrainUpgradePromise) return this._terrainUpgradePromise;
    const promise = (async () => {
      const t0 = performance.now();
      const oct = this.terrainMaterial.defines.OCTAVES;
      const heightProgram = this._activeHeightProgram('studio');
      const warm = createTerrainMaterial(this.uniforms, oct, heightProgram, { variant });
      const targetSnapshot = this._resolveCameraCompileTarget();
      const workId = `terrain-${variant}`;
      this._bgWorkStart(workId, variant === 'base'
        ? 'Preparing lightweight terrain colors…'
        : `Preparing ${variant} terrain shader…`);
      let swapped = false;
      let ready = false;
      let compileWaitMs = 0;
      let swapMs = 0;
      try {
        const tCompile = performance.now();
        const result = await this._compileMaterialVariants([warm], {
          canvasOnly: true,
          timeoutMs: 120000,
          renderTarget: targetSnapshot.renderTarget,
        });
        ready = result?.ready === true
          && this._sameCameraCompileTarget(
            targetSnapshot,
            this._resolveCameraCompileTarget(),
          );
        compileWaitMs = performance.now() - tCompile;
        console.info(`[boot] ${variant} terrain compile wait ${compileWaitMs.toFixed(0)}ms (ready=${ready})`);
        // Swap ONLY when the warmed program is genuinely ready and the live
        // material still matches what was warmed (octaves may have changed
        // mid-compile — that path upgrades the source itself). Swapping onto a
        // not-ready program would trigger a blocking link = the freeze.
        if (!this._disposed && ready &&
            this.terrainMaterial.userData.minimalFragment &&
            this.terrainMaterial.defines.OCTAVES === oct &&
            this._activeHeightProgram('studio').sig === heightProgram.sig) {
          const tSwap = performance.now();
          rebuildTerrainShaderSource(this.terrainMaterial, heightProgram, { variant });
          swapMs = performance.now() - tSwap;
          swapped = true;
          this._needsRender = true;
          this._minimapDirtyAt = performance.now();
          this.minimap.requestRedraw();
          console.info(`[boot] ${variant} terrain live material source swapped in ${swapMs.toFixed(1)}ms; elapsed ${(performance.now() - t0).toFixed(0)}ms`);
          this._completeBootIfInteractiveReady();
          this._completeBootIfQualityReady();
        }
      } catch (e) {
        console.warn(`${variant} terrain material upgrade failed`, e);
      } finally {
        this._bgWorkEnd(workId);
      }
      this._queueWarmMaterials([warm]);
      if (!ready && !this._disposed && this._terrainUpgradeRetryCount < 3) {
        this._terrainVariantFailed = true;
        const delay = Math.min(
          15000,
          3000 * (2 ** Math.min(this._terrainUpgradeRetryCount, 2)),
        );
        this._terrainUpgradeRetryTimer = setTimeout(() => {
          this._terrainUpgradeRetryTimer = null;
          if (this._disposed || !this.terrainMaterial?.userData?.minimalFragment) return;
          this._terrainUpgradeRetryCount++;
          void this._upgradeMinimalTerrain(null, variant);
        }, delay);
      }
      if (swapped) {
        this._terrainUpgradeRetryCount = 0;
        this._terrainVariantFailed = false;
        // A successful retry happens outside the original post-paint promise
        // chain. Schedule the requested visual variant here as well; otherwise
        // a transient Base compile miss leaves the app permanently on Base and
        // _qualityPending can never settle even though terrain/water are ready.
        if (this.terrainMaterial?.userData?.terrainVariant
            !== this._targetTerrainVariant()) {
          this._scheduleTerrainQualityUpgrade(renderTarget);
        }
      }
      return { ready, swapped, compileWaitMs, swapMs };
    })();
    this._terrainUpgradePromise = promise;
    promise.finally(() => {
      if (this._terrainUpgradePromise === promise) this._terrainUpgradePromise = null;
    });
    return promise;
  }

  _bootTerrainVariant() {
    return 'base';
  }

  _scheduleTerrainQualityUpgrade(renderTarget = null, delayMs = 500) {
    if (this._disposed || this._terrainQualityTimer
        || this._terrainVariantCompiling) return;
    this._terrainQualityTimer = setTimeout(() => {
      this._terrainQualityTimer = null;
      if (this._disposed) return;
      // Translating the first full terrain fragment is the one background job
      // a browser cannot cancel once ANGLE hands it to the graphics driver.
      // Starting it immediately after water made a reload wait for that driver
      // job before the new document could even reach DOMContentLoaded. Keep the
      // coherent boot terrain live through a generous interaction window; once
      // the full Base material exists, subsequent feature variants use the
      // shorter normal debounce.
      const bootMaterial = this.terrainMaterial?.userData?.minimalFragment === true;
      const quietWindowMs = bootMaterial ? 15000 : 3500;
      const quietForMs = performance.now() - (this._lastUserActivityAt ?? -Infinity);
      if (quietForMs < quietWindowMs) {
        this._scheduleTerrainQualityUpgrade(
          renderTarget,
          Math.max(250, quietWindowMs - quietForMs),
        );
        return;
      }
      if (bootMaterial) {
        void this._upgradeMinimalTerrain(renderTarget, this._bootTerrainVariant());
      } else {
        void this._ensureTerrainShaderVariantAsync(renderTarget);
      }
    }, delayMs);
  }

  _schedulePostFirstPaintWarmups(delayMs = 850, renderTarget = null) {
    if (this._disposed || this._postFirstPaintWarmupsStarted) return;
    this._postFirstPaintWarmupsStarted = true;

    const run = () => {
      this._postFirstPaintWarmTimer = null;
      if (this._disposed) return;
      // Water is part of the landing showcase, so prepare its requested material
      // while the menu is open. Keep height-cache/full-surface quality work on
      // the editor side of the transition: those jobs can synchronously occupy
      // ANGLE even when their promises are asynchronous.
      if (this._landingShowcase) {
        const waterJob = this.params?.waterEnabled !== false
          && this._waterDeferred
          && this.waterMaterial
          ? this._warmDeferredWater(renderTarget)
          : false;
        Promise.resolve(waterJob).catch((error) => {
          console.warn('Landing water warmup failed', error);
        }).finally(() => {
          if (this._disposed) return;
          this._postFirstPaintWarmupsStarted = false;
          this._needsRender = true;
          // The menu may have closed while the water program was linking. In
          // that case resume the editor-only cache/quality sequence now because
          // setLandingShowcase(false) could not schedule it while this job owned
          // the warmup gate.
          if (!this._landingShowcase) {
            this._schedulePostFirstPaintWarmups(100, renderTarget);
          }
        });
        return;
      }
      // Shader translation and the first height-cache pass may still occupy the
      // browser's graphics thread for a noticeable interval. Require a real
      // quiet window after the user's latest pointer/key input so optional
      // quality can never steal the first camera or editor interaction.
      const quietWindowMs = 3500;
      const quietForMs = performance.now() - (this._lastUserActivityAt ?? -Infinity);
      if (quietForMs < quietWindowMs) {
        this._postFirstPaintWarmTimer = setTimeout(
          run,
          Math.max(250, quietWindowMs - quietForMs),
        );
        return;
      }
      // Project/template transitions own the critical path. Let them finish
      // before starting optional visual-quality work.
      if (this._compiling) {
        this._postFirstPaintWarmTimer = setTimeout(run, 250);
        return;
      }

      // Node authoring already uses the lightweight palette fragment. Do not
      // replace it with full surface shaders or start unrelated water work.
      if (this.projectMode === 'nodes') {
        this._postFirstPaintWarmupsStarted = false;
        this._completeBootIfInteractiveReady();
        this._completeBootIfQualityReady();
        return;
      }

      // The minimal terrain is already a coherent interactive frame. Prepare
      // its generation-matched height cache and water before translating the
      // optional full surface fragment; that translation can take tens of
      // seconds on ANGLE and must not strand the water behind it.
      const jobs = [];
      const cacheJob = (async () => {
        await yieldFrame();
        if (this._disposed) return false;
        try {
          const ready = await this._prepareStudioHeightCacheAsync();
          if (!ready) this._scheduleTerrainHeightBakeRetry();
          return ready;
        } catch (e) {
          this._handleTerrainHeightBakeFailure(e);
          this._completeBootIfInteractiveReady();
          this._completeBootIfQualityReady();
          return false;
        }
      })();
      jobs.push(cacheJob);

      let waterJob = Promise.resolve();
      if (this.params.waterEnabled !== false && this._waterDeferred) {
        waterJob = cacheJob.then(() => new Promise((resolve) => {
          this._postFirstPaintWaterTimer = setTimeout(() => {
            this._postFirstPaintWaterTimer = null;
            resolve(this._disposed ? undefined : this._warmDeferredWater(renderTarget));
          }, 250);
        }));
        jobs.push(waterJob);
      }

      const needsTerrainUpgrade = this.terrainMaterial?.userData?.minimalFragment === true;
      Promise.allSettled(jobs).then(() => {
        if (!this._disposed) {
          this._needsRender = true;
          this._completeBootIfInteractiveReady();
          this._completeBootIfQualityReady();
          if (needsTerrainUpgrade) {
            this._scheduleTerrainQualityUpgrade(renderTarget);
          }
        }
      });
    };

    this._postFirstPaintWarmTimer = setTimeout(run, delayMs);
  }

  _warmDeferredWater(renderTarget = null) {
    if (this._disposed || !this._waterDeferred || !this.waterMaterial) return false;
    if (this._waterWarmPromise) return this._waterWarmPromise;
    this._waterWarmRestartPending = false;
    const job = this._warmDeferredWaterImpl(renderTarget);
    const pending = job.finally(() => {
      if (this._waterWarmPromise !== pending) return;
      this._waterWarmPromise = null;
      const restart = this._waterWarmRestartPending;
      this._waterWarmRestartPending = false;
      if (restart && !this._disposed && this._waterDeferred
          && this.worldMode === 'studio'
          && resolveEffectiveWaterMode(this.params, this.worldMode) !== 'off'
          && this._isStudioWaterBakeReady()) {
        Promise.resolve().then(() => {
          if (!this._disposed && this._waterDeferred && !this._waterWarmPromise
              && this.worldMode === 'studio'
              && resolveEffectiveWaterMode(this.params, this.worldMode) !== 'off') {
            void this._warmDeferredWater();
          }
        });
      }
    });
    this._waterWarmPromise = pending;
    return this._waterWarmPromise;
  }

  _isStudioWaterBakeReady() {
    if (this.worldMode !== 'studio') return true;
    if (this._usesLiveStudioHeightField()) return true;
    return this._bakedStudioGen === this._terrainGen
      && this._bakedStudioLayout === this._studioBakeLayoutKey()
      && !this.terrainHeightBaker?.isBaking
      && this.uniforms?.uWaterTerrainHeightTex?.value != null
      && this.uniforms?.uWaterTerrainBiomeTex?.value != null
      && (this.uniforms?.uUseWaterTerrainBiomeTex?.value ?? 0) > 0.5;
  }

  _usesLiveStudioHeightField() {
    return this._studioLiveHeightField === true
      || this._debug?.disableHeightBake === true;
  }

  _scheduleWaterWarmRetry(renderTarget = null, delayMs = 250) {
    if (this._disposed || !this._waterDeferred || this._waterWarmRetryTimer) return false;
    if (this._waterWarmRetryCount >= 3) {
      this._waterWarmFailed = true;
      return false;
    }
    this._waterWarmRetryTimer = setTimeout(() => {
      this._waterWarmRetryTimer = null;
      if (this._disposed || !this._waterDeferred) return;
      this._waterWarmRetryCount++;
      void this._warmDeferredWater();
    }, delayMs);
    return true;
  }

  _scheduleTerrainHeightBakeRetry(delayMs = 1000) {
    if (this._disposed || this._terrainHeightBakeRetryTimer) return false;
    if (this._terrainHeightBakeRetryCount >= 3) {
      this._terrainHeightBakeFailed = true;
      return false;
    }
    this._terrainHeightBakeFailed = true;
    const retryDelay = Math.max(delayMs, Math.min(
      15000,
      1000 * (2 ** Math.min(this._terrainHeightBakeRetryCount, 3)),
    ));
    this._terrainHeightBakeRetryTimer = setTimeout(() => {
      this._terrainHeightBakeRetryTimer = null;
      if (this._disposed || !this.params) return;
      this._terrainHeightBakeRetryCount++;
      void this._prepareStudioHeightCacheAsync().then((ready) => {
        if (!ready && !this._disposed && this.params) {
          this._scheduleTerrainHeightBakeRetry();
        }
      }).catch((error) => {
        if (!this._disposed && this.params) this._handleTerrainHeightBakeFailure(error);
      });
      this._needsRender = true;
    }, retryDelay);
    return true;
  }

  _handleTerrainHeightBakeFailure(error) {
    this.terrainHeightBaker?.cancel?.();
    this._terrainBakeJobKey = null;
    this._terrainHeightBakeDeferred = true;
    this._terrainHeightBakeFailed = true;
    if (this.uniforms?.uUseWaterTerrainBiomeTex) {
      this.uniforms.uUseWaterTerrainBiomeTex.value = 0.0;
    }

    if (this.uniforms?.uUseTerrainHeightTex) {
      this.uniforms.uUseTerrainHeightTex.value = 0.0;
    }
    if (this.uniforms?.uUseTerrainBiomeTex) {
      this.uniforms.uUseTerrainBiomeTex.value = 0.0;
    }
    console.warn('Terrain height bake failed', error);
    this._scheduleTerrainHeightBakeRetry();
  }

  _ensureTerrainHeightTexSafely() {
    try {
      this._ensureTerrainHeightTex();
      return true;
    } catch (error) {
      this._handleTerrainHeightBakeFailure(error);
      return false;
    }
  }

  async _warmDeferredWaterImpl(renderTarget = null) {
    const t0 = performance.now();
    if (!this._bootPending) this.cb.onStatus('Preparing water...', false);

    const preparedWorldMode = this.worldMode;
    const liveStudioField = preparedWorldMode === 'studio'
      && this._usesLiveStudioHeightField();
    let cacheReady = liveStudioField;
    if (!liveStudioField) {
      try {
        cacheReady = await this._prepareStudioHeightCacheAsync();
        if (cacheReady) this._ensureTerrainHeightTex();
      } catch (e) {
        this._handleTerrainHeightBakeFailure(e);
      }
    }

    if (!cacheReady || !this._isStudioWaterBakeReady()) {
      if (!this._bootPending) this.cb.onStatus('Ready', false);
      return false;
    }
    const waterTerrainGen = this._terrainGen;
    const waterLayout = preparedWorldMode === 'studio'
      ? this._studioBakeLayoutKey() : null;

    const materials = [...(this.waterSystem?.prepareInitialMaterials(
      this.params,
      preparedWorldMode
    ) ?? [this.waterMaterial])];
    const preparedEffectiveMode = resolveEffectiveWaterMode(this.params, preparedWorldMode);
    const requestedMaterialForMode = (worldMode) => {
      const requested = this.waterSystem?.getRequestedMaterial?.(worldMode);
      if (requested != null) return requested;
      if (worldMode === 'infinite') {
        return this.waterSystem?.getInfiniteMaterial?.()
          ?? this._infiniteWaterMat
          ?? materials[0]
          ?? null;
      }
      if (worldMode === 'planet') return this.planetWaterMat ?? materials[0] ?? null;
      return this.waterSystem?.getStudioMaterial?.()
        ?? this.waterMaterial
        ?? materials[0]
        ?? null;
    };
    const preparedRequestedMaterial = requestedMaterialForMode(preparedWorldMode);
    const preparedMaterialVersions = materials.map((material) => material?.version ?? 0);
    const targetSnapshot = this._resolveCameraCompileTarget();
    const previousIdentity = this._waterMaterialWarmIdentity;
    let materialReady = this._waterMaterialWarmed === true
      && previousIdentity?.worldMode === preparedWorldMode
      && previousIdentity?.effectiveMode === preparedEffectiveMode
      && previousIdentity?.usesSceneTarget === targetSnapshot.usesSceneTarget
      && previousIdentity?.renderTarget === targetSnapshot.renderTarget
      && previousIdentity?.materials?.length === materials.length
      && materials.every((material, index) => (
        previousIdentity.materials[index] === material
        && previousIdentity.versions[index] === preparedMaterialVersions[index]
      ));
    let compileResult = null;
    let compileFailure = null;
    if (!materialReady) {
      try {
        compileResult = await this._compileMaterialVariants(materials, {
          canvasOnly: true,
          stagger: materials.length > 1,
          timeoutMs: 20000,
          renderTarget: targetSnapshot.renderTarget,
        });
        this._recordWaterShaderCompile('deferred-startup', compileResult);
        materialReady = compileResult?.ready === true;
      } catch (e) {
        compileFailure = e;
      }
    }
    if (this._disposed) return false;

    const desiredEffectiveMode = resolveEffectiveWaterMode(this.params, this.worldMode);
    const currentEffectiveMode = this.waterSystem?.getEffectiveMode?.()
      ?? preparedEffectiveMode;
    const currentRequestedMaterial = requestedMaterialForMode(preparedWorldMode);
    const currentTarget = this._resolveCameraCompileTarget();
    const materialSnapshotStillCurrent = this.worldMode === preparedWorldMode
      && currentEffectiveMode === preparedEffectiveMode
      && desiredEffectiveMode === preparedEffectiveMode
      && this._sameCameraCompileTarget(targetSnapshot, currentTarget)
      && currentRequestedMaterial === preparedRequestedMaterial
      && materials.includes(preparedRequestedMaterial)
      && materials.every((material, index) => (
        (material?.version ?? 0) === preparedMaterialVersions[index]
      ));
    if (!materialSnapshotStillCurrent) {
      // Shader readiness belongs to the exact mode/material/version that was
      // prepared. A late Studio promise must never attach itself to Infinite
      // or suppress compilation of that mode's distinct water material.
      this._waterMaterialWarmed = false;
      this._waterMaterialWarmIdentity = null;
      this._waterWarmRestartPending = this.worldMode === 'studio'
        && desiredEffectiveMode !== 'off'
        && this._isStudioWaterBakeReady();
      if (!this._bootPending) this.cb.onStatus('Ready', false);
      return false;
    }

    this._waterMaterialWarmed = materialReady;
    this._waterMaterialWarmIdentity = materialReady ? {
      worldMode: preparedWorldMode,
      effectiveMode: preparedEffectiveMode,
      materials: [...materials],
      versions: [...preparedMaterialVersions],
      usesSceneTarget: targetSnapshot.usesSceneTarget,
      renderTarget: targetSnapshot.renderTarget,
    } : null;
    if (!materialReady) {
      if (compileFailure) {
        console.warn('Deferred water warmup failed', compileFailure);
        this._scheduleWaterWarmRetry(null, 1000);
      } else {
        console.warn(
          `Water compile still pending after ${compileResult?.waitMs?.toFixed?.(0) ?? 0}ms; keeping water deferred`
        );
        this._scheduleWaterWarmRetry(null, 3000);
      }
      if (!this._disposed) {
        console.warn('Water material was not activated because its shader is not ready');
        if (!this._bootPending) this.cb.onStatus('Ready', false);
      }
      return false;
    }
    const waterBakeStillCurrent = preparedWorldMode !== 'studio'
      || (liveStudioField
        ? this._terrainGen === waterTerrainGen
        : (this._terrainGen === waterTerrainGen
          && this._bakedStudioGen === waterTerrainGen
          && this._studioBakeLayoutKey() === waterLayout
          && this._bakedStudioLayout === waterLayout
          && this._isStudioWaterBakeReady()));
    if (!waterBakeStillCurrent) {
      // A sea/terrain/layout edit landed while the shader linked. Never let
      // that stale promise re-show water against the replacement bake.
      this._waterDeferred = true;
      if (this.water) this.water.visible = false;
      // If the replacement bake already finished, the wrapper restarts after
      // this promise clears. Otherwise final bake publication triggers it.
      this._waterWarmRestartPending = this.worldMode === 'studio'
        && this._isStudioWaterBakeReady();
      if (!this._bootPending) this.cb.onStatus('Ready', false);
      return false;
    }

    this._waterDeferred = false;
    this._waterWarmRetryCount = 0;
    this._waterWarmFailed = false;
    this.waterSystem?.activateInitialMaterials(this.params, preparedWorldMode);
    this._needsRender = true;
    console.info(`[boot] water init ${(performance.now() - t0).toFixed(0)}ms (precompiled)`);
    this._completeBootIfInteractiveReady();
    this._completeBootIfQualityReady();
    if (!this._bootPending) this.cb.onStatus('Ready', false);
    return true;
  }

  /**
   * Lazily compile the underwater render-target program variants that were
   * deferred from boot. Runs WITHOUT bumping _compiling, so the scene keeps
   * rendering normally (the canvas programs are already linked) while the driver
   * builds the RT variants on its own threads. Kicked off when the camera nears
   * the surface so the programs are cached before the first submerged frame —
   * no dive hitch, and zero cost for sessions that never touch water.
   */
  _activeUnderwaterTerrainMaterial() {
    if (this.worldMode === 'infinite') return this._infiniteTerrainMat ?? null;
    if (this.worldMode === 'planet') return this.planetWorld?.materials?.[0] ?? null;
    return this.terrainMaterial ?? null;
  }

  _captureUnderwaterWarmIdentity(cameraRenderTarget = null) {
    const unique = new Map();
    this.scene?.traverse?.((obj) => {
      if (!obj.material) return;
      const topology = obj.isInstancedMesh ? 'instanced' : 'mesh';
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const material of mats) {
        if (!material) continue;
        const key = `${material.id}:${topology}`;
        if (!unique.has(key)) {
          unique.set(key, {
            material,
            version: material.version ?? 0,
            topology,
          });
        }
      }
    });
    const variants = [...unique.values()].sort((a, b) => {
      const idDelta = (a.material?.id ?? 0) - (b.material?.id ?? 0);
      return idDelta || a.topology.localeCompare(b.topology);
    });
    const quadMaterial = this.underwater?._material ?? null;
    return {
      worldMode: this.worldMode,
      cameraRenderTarget,
      underwaterRenderTarget: this.underwater?._rt ?? null,
      quadMaterial,
      quadVersion: quadMaterial?.version ?? 0,
      variants,
    };
  }

  _sameUnderwaterWarmIdentity(a, b) {
    if (!a || !b
        || a.worldMode !== b.worldMode
        || a.cameraRenderTarget !== b.cameraRenderTarget
        || a.underwaterRenderTarget !== b.underwaterRenderTarget
        || a.quadMaterial !== b.quadMaterial
        || a.quadVersion !== b.quadVersion
        || a.variants.length !== b.variants.length) return false;
    return a.variants.every((variant, index) => {
      const current = b.variants[index];
      return variant.material === current.material
        && variant.version === current.version
        && variant.topology === current.topology;
    });
  }

  _ensureUnderwaterWarmTarget(cameraRenderTarget = null) {
    if (cameraRenderTarget?.width && cameraRenderTarget?.height) {
      this.underwater._ensureTarget(
        this.renderer,
        cameraRenderTarget.width,
        cameraRenderTarget.height,
      );
    } else {
      this.underwater._ensureTarget(this.renderer);
    }
  }

  _warmUnderwaterShaders(cameraRenderTarget = null) {
    if (this._disposed) return Promise.resolve(false);

    this._ensureUnderwaterWarmTarget(cameraRenderTarget);
    const requestedIdentity = this._captureUnderwaterWarmIdentity(cameraRenderTarget);
    if (this._underwaterWarmed
        && this._sameUnderwaterWarmIdentity(this._underwaterWarmIdentity, requestedIdentity)) {
      return Promise.resolve(true);
    }
    if (this._underwaterWarmed) {
      this._underwaterWarmed = false;
      this._underwaterWarmIdentity = null;
    }
    if (this._underwaterWarmPromise) return this._underwaterWarmPromise;

    const job = (async () => {
      // The RT variants must be compiled from the full fragment. Finish the
      // boot upgrade first so readiness cannot belong to a discarded source.
      if (this.worldMode === 'studio'
          && this.terrainMaterial?.userData?.minimalFragment) {
        const upgraded = await this._upgradeMinimalTerrain();
        if (upgraded?.ready !== true || this._disposed) return false;
      }

      const preparedMode = this.worldMode;
      const preparedCameraTarget = this._resolveCameraCompileTarget();
      if (cameraRenderTarget
          && preparedCameraTarget.renderTarget !== cameraRenderTarget) return false;
      this._ensureUnderwaterWarmTarget(preparedCameraTarget.renderTarget);
      const preparedIdentity = this._captureUnderwaterWarmIdentity(
        preparedCameraTarget.renderTarget,
      );
      const preparedTerrain = this._activeUnderwaterTerrainMaterial();
      let sceneResult = null;
      let instancedResult = { ready: true };
      let quadResult = null;

      await this._withStudioCloudDetached(async () => {
        const skipMaterials = new Set();

        // Infinite terrain's live draw defines USE_INSTANCING. A plain warm
        // mesh is a different program and was the source of first-dive stalls.
        if (preparedMode === 'infinite' && preparedTerrain) {
          const source = this.infiniteWorld?.batches?.meshes?.find(Boolean);
          if (!source?.geometry) throw new Error('Infinite terrain geometry unavailable');
          instancedResult = await this._compileInstancedMaterialVariant(
            preparedTerrain,
            source.geometry,
            preparedCameraTarget.renderTarget,
          );
          skipMaterials.add(preparedTerrain);
        }

        // Planet chunks own distinct material objects but share one source and
        // define set. Compile one representative instead of yielding hundreds
        // of equivalent warm meshes.
        if (preparedMode === 'planet') {
          for (const material of this.planetWorld?.materials?.slice(1) ?? []) {
            skipMaterials.add(material);
          }
        }

        sceneResult = await this._compileSceneStaggered(preparedCameraTarget.renderTarget, {
          skipMaterials,
          timeoutMs: 120000,
        });
        if (instancedResult?.ready !== true || sceneResult?.ready !== true) {
          throw new Error('Underwater scene shaders did not become ready');
        }

        const quad = this.underwater._quadScene?.children?.[0] ?? null;
        quadResult = await this._compileExactPass({
          scene: this.underwater._quadScene,
          camera: this.underwater._quadCam,
          mesh: quad,
          material: this.underwater._material,
          renderTarget: this.underwater._rt,
        }, { timeoutMs: 120000 });
        if (quadResult?.ready !== true) {
          throw new Error('Underwater composite shader did not become ready');
        }
      });

      const currentCameraTarget = this._resolveCameraCompileTarget();
      this._ensureUnderwaterWarmTarget(currentCameraTarget.renderTarget);
      const currentIdentity = this._captureUnderwaterWarmIdentity(
        currentCameraTarget.renderTarget,
      );
      if (this._disposed || this.worldMode !== preparedMode
          || !this._sameUnderwaterWarmIdentity(preparedIdentity, currentIdentity)) {
        return false;
      }
      this._underwaterWarmIdentity = preparedIdentity;
      this._underwaterWarmed = true;
      return true;
    })().catch((error) => {
      this._underwaterWarmed = false;
      this._underwaterWarmIdentity = null;
      console.warn('Underwater shader warmup failed', error);
      return false;
    });

    const pending = job.finally(() => {
      if (this._underwaterWarmPromise === pending) {
        this._underwaterWarmPromise = null;
      }
    });
    this._underwaterWarmPromise = pending;
    return pending;
  }

  /** Trigger the deferred underwater compile once the camera approaches water. */
  _maybeWarmUnderwater() {
    if (this._bootPending || !this.underwater?.enabled) return;
    const wl = this._waterLevel();
    if (wl == null || this.camera.position.y - wl >= 120) return;
    const cameraTarget = this._resolveCameraCompileTarget().renderTarget;
    this._ensureUnderwaterWarmTarget(cameraTarget);
    const currentIdentity = this._captureUnderwaterWarmIdentity(cameraTarget);
    if (this._underwaterWarmed
        && this._sameUnderwaterWarmIdentity(this._underwaterWarmIdentity, currentIdentity)) return;
    this._underwaterWarmed = false;
    this._underwaterWarmIdentity = null;
    void this._warmUnderwaterShaders(cameraTarget);
  }
  _renderInitialStudioFrame() {
    if (this.worldMode !== 'studio' || !this.board?.chunks?.length) return null;
    if (this._bootShaderPending) return null;
    const t0 = performance.now();

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
      this._syncTerrainCloudShadows();
    }

    const renderStats = this._renderCameraCapture();
    this._lastTris = renderStats?.triangles ?? 0;
    this._lastDraws = renderStats?.drawCalls ?? 0;
    this._lastRenderAt = performance.now();
    this._camPos.copy(this.camera.position);
    this._camQuat.copy(this.camera.quaternion);
    this._needsRender = false;
    return performance.now() - t0;
  }

  /**
   * Recompile terrain + water programs for a new octave count in the
   * background, then swap the define on the live materials — at that point
   * the programs are already in three's cache, so the swap is instant.
   */
  async _setOctavesAsync(oct) {
    if (this.worldMode !== 'planet') {
      if (this._octaveTransitionTarget === oct
          && this._octaveTransitionPromise) {
        return this._octaveTransitionPromise;
      }
      const liveMaterial = this.worldMode === 'infinite'
        ? this._infiniteTerrainMat
        : this.terrainMaterial;
      const liveOctaves = liveMaterial?.defines?.OCTAVES ?? oct;
      const rebuildJob = this._rebuildStackMaterialsAsync(
        this._activeHeightProgram(),
        {
          label: 'Compiling shaders',
          terrainDirtyOnSwap: true,
        },
      );
      const job = rebuildJob.then((result) => {
        if (result?.error
            && !this._disposed
            && Math.round(this.params.octaves) === oct) {
          // Keep params, UI, CPU sampling and the visible shader on one octave
          // count after a link failure. The same value can then be selected
          // again to retry instead of becoming a silent no-op.
          this.params.octaves = liveOctaves;
          this.cb.onParams(this._paramsSnapshot());
          this._applyUniforms();
          this.cb.onStatus('Ready', false);
          this.cb.onToast?.('Octave change could not be compiled; previous value restored');
        }
        return result;
      });
      this._octaveTransitionTarget = oct;
      this._octaveTransitionPromise = job;
      job.finally(() => {
        if (this._octaveTransitionPromise === job) {
          this._octaveTransitionPromise = null;
          this._octaveTransitionTarget = null;
        }
      });
      return job;
    }

    if (this._octaveTransitionTarget === oct && this._octaveTransitionPromise) {
      return this._octaveTransitionPromise;
    }
    const liveOctaves = this.planetWorld?.materials?.[0]?.defines?.OCTAVES ?? oct;
    const rebuildJob = this._rebuildPlanetStackMaterialsAsync(this._stackGLSL, {
      label: 'Compiling planet shaders',
    });
    const job = rebuildJob.then((result) => {
      if (result?.error && !this._disposed
          && this.worldMode === 'planet' && Math.round(this.params.octaves) === oct) {
        this.params.octaves = liveOctaves;
        this.cb.onParams(this._paramsSnapshot());
        this._applyUniforms();
        this.cb.onStatus('Planet', false);
        this.cb.onToast?.('Octave change could not be compiled; previous value restored');
      }
      return result;
    });
    this._octaveTransitionTarget = oct;
    this._octaveTransitionPromise = job;
    job.finally(() => {
      if (this._octaveTransitionPromise === job) {
        this._octaveTransitionPromise = null;
        this._octaveTransitionTarget = null;
      }
    });
    return job;
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
      this._schedulePostFirstPaintWarmups(100);
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
    if (key === 'freeCamNoClip') {
      this._setDebugFreeCam(!!value);
      return;
    }
    this._debug[key] = !!value;
    this._needsRender = true;
    if (key === 'mergeDebug') {
      this.board.setMergeDebug(this._debug.mergeDebug);
      if (this.infiniteWorld) this.infiniteWorld.setMergeDebug(this._debug.mergeDebug);
      if (this.planetWorld) this.planetWorld.setMergeDebug(this._debug.mergeDebug);
    }
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

  _setDebugFreeCam(enabled) {
    enabled = !!enabled;
    if (enabled === !!this._debug.freeCamNoClip) return;
    this._debug.freeCamNoClip = enabled;

    if (enabled) {
      const savedPos = this.camera.position.clone();
      const savedQuat = this.camera.quaternion.clone();
      this._freeCamRestore = {
        worldMode: this.worldMode,
        exploreMode: this.exploreMode,
        playerMode: this.playerMode,
      };
      const previousExplore = this.exploreMode;
      if (previousExplore !== 'none') this.setExploreMode('none');
      this.camera.position.copy(savedPos);
      this.camera.quaternion.copy(savedQuat);

      if (this.worldMode === 'studio') {
        this.controls.enabled = false;
        if (!this.fpsControls) {
          this.fpsControls = new FPSControls(this.camera, this.canvas);
          this._debugFreeCamOwnsFps = true;
        }
      } else if (this.worldMode === 'planet') {
        if (this.planetControls) {
          this.planetControls.dispose();
          this.planetControls = null;
        }
        if (!this.fpsControls) {
          this.fpsControls = new FPSControls(this.camera, this.canvas);
          this._debugFreeCamOwnsFps = true;
        }
      } else if (this.worldMode === 'infinite') {
        if (!this.fpsControls) {
          this.fpsControls = new FPSControls(this.camera, this.canvas);
          this._debugFreeCamOwnsFps = true;
        }
      }
      this._configureDebugFreeCamControls();
      this.cb.onExploreMode?.('freecam');
      this.cb.onPlayerMode?.(false);
      this._emitExploreStats({
        chunks: this.worldMode === 'infinite'
          ? (this.infiniteWorld?.activeChunkCount ?? 0)
          : (this.worldMode === 'planet' ? (this.planetWorld?.activeChunkCount ?? 0) : (this.board?.activeChunkCount ?? 0)),
        visibleChunks: this.worldMode === 'infinite'
          ? (this.infiniteWorld?.visibleChunkCount ?? 0)
          : (this.worldMode === 'planet' ? (this.planetWorld?.visibleChunkCount ?? 0) : (this.board?.visibleChunkCount ?? 0)),
        culledChunks: this.worldMode === 'infinite'
          ? (this.infiniteWorld?.culledChunkCount ?? 0)
          : (this.worldMode === 'planet' ? (this.planetWorld?.culledChunkCount ?? 0) : (this.board?.culledChunkCount ?? 0)),
        lodCounts: this.worldMode === 'infinite'
          ? [...(this.infiniteWorld?.lodCounts ?? [0, 0, 0, 0])]
          : (this.worldMode === 'planet' ? [...(this.planetWorld?.lodCounts ?? [0, 0, 0, 0])] : [...(this.board?.lodCounts ?? [0, 0, 0, 0])]),
      });
      try { document.activeElement?.blur?.(); } catch {}
      try { this.canvas.requestPointerLock?.(); } catch {}
      this.cb.onToast?.('No-clip fly camera - ZQSD/WASD move · Space up · Shift down');
      this._needsRender = true;
      return;
    }

    const restore = this._freeCamRestore;
    this._freeCamRestore = null;

    if (this._debugFreeCamOwnsFps && this.fpsControls) {
      this.fpsControls.dispose();
      this.fpsControls = null;
    }
    this._debugFreeCamOwnsFps = false;

    if (this.worldMode === 'studio') {
      this.controls.enabled = true;
      if (restore?.worldMode === this.worldMode && restore.exploreMode !== 'none') {
        this.setExploreMode(restore.exploreMode);
      }
    } else if (this.worldMode === 'infinite') {
      if (restore?.worldMode === this.worldMode && restore.exploreMode !== 'none') {
        this.setExploreMode(restore.exploreMode);
      } else if (!this.fpsControls) {
        this.fpsControls = new FPSControls(this.camera, this.canvas);
      } else {
        this.fpsControls.allowKeyboardWithoutLock = false;
      }
    } else if (this.worldMode === 'planet') {
      if (restore?.worldMode === this.worldMode && restore.exploreMode !== 'none') {
        this.setExploreMode(restore.exploreMode);
      } else if (!this.planetControls && this._planetModules) {
        const planet = this._planetModules;
        this.planetControls = new planet.PlanetOrbitControls(this.camera, this.canvas, this.params.planetRadius);
        this.planetControls.onFirstInteract = () => this.cb.onFirstInteract();
        this.planetControls.update(0.001);
      }
    }
    this.cb.onExploreMode?.(this.exploreMode);
    this.cb.onPlayerMode?.(this.playerMode);
    this.cb.onToast?.('No-clip free cam off');
    this._needsRender = true;
  }

  _configureDebugFreeCamControls() {
    if (!this.fpsControls) return;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.fpsControls.yaw = Math.atan2(-dir.x, -dir.z);
    this.fpsControls.pitch = Math.asin(Math.max(-0.999, Math.min(0.999, dir.y)));
    this.fpsControls.externalMove = false;
    this.fpsControls.allowKeyboardWithoutLock = true;
    this.fpsControls.onSpeedWheel = null;
    this.fpsControls.moveSpeed = this.worldMode === 'planet'
      ? Math.max(200, (this.params.planetRadius || 16000) * 0.025)
      : Math.max(80, Math.min(600, this.params.chunkSize * 1.6));
    this.fpsControls.minSpeed = 10;
    this.fpsControls.maxSpeed = this.worldMode === 'planet' ? 5000 : 2500;
    this.fpsControls.update(0);
  }

  // ------------------------------------------------------------- player mode

  _getCpuHeightSampler() {
    if (!this.cpuHeightSampler) {
      this.cpuHeightSampler = new TerrainHeightSampler(this.uniforms, () => ({
        octaves: Math.round(this.params.octaves),
        infinite: this.worldMode === 'infinite',
      }), this.noiseStack);
      this.cpuHeightSampler.setHeightProgram(this.worldMode === 'studio' && this.generationSource === 'graph' ? this._graphProgram : null);
      this.cpuHeightSampler.erosion = this.erosionField;
    }
    return this.cpuHeightSampler;
  }

  _getHeightSampler() {
    if (!this.heightSampler) {
      const cpu = this._getCpuHeightSampler();
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

  // -------------------------------------------------------------- erosion
  // Erosion is an additive, world-space height-offset field (delta = eroded -
  // base) added in heightAt(), so mesh / normals / collision / props / export
  // all follow it and the base terrain is never mutated. The hydraulic + thermal
  // simulation runs in a Web Worker; the bake is a one-shot the user triggers.

  /** No-op identity bake (zero delta): proves the offset pipeline without
   *  changing the terrain. Dev/testing aid; the real bake is bakeErosion. */
  bakeErosionIdentity(res = 256) {
    const u = this.uniforms;
    this.erosionField.bakeIdentity({
      originX: u.uBakeOrigin.value.x,
      originZ: u.uBakeOrigin.value.y,
      sizeX: u.uBakeSpan.value.x,
      sizeZ: u.uBakeSpan.value.y,
    }, res);
    this.erosionField.applyTo(u);
    this._onErosionChanged();
    return true;
  }

  /**
   * Bake erosion (Tile mode): sample the base height field into a grid, run the
   * worker simulation, then apply the resulting delta + masks. Returns a promise
   * that resolves true on success.
   * @param {{onProgress?:(p:number,phase:string)=>void}} [opts]
   */
  async bakeErosion({ onProgress } = {}) {
    if (this.worldMode !== 'studio') {
      this.cb.onToast?.('Erosion is available in Tile mode.');
      return false;
    }
    if (this._erosionBaking) return false;
    this.projectHistory?.createSnapshot('Before erosion', { automatic: true });
    this._erosionBaking = true;
    try {
      const u = this.uniforms;
      const q = EROSION_QUALITY[this.params.erosionQuality] || EROSION_QUALITY.balanced;
      const res = q.res;
      const originX = u.uBakeOrigin.value.x;
      const originZ = u.uBakeOrigin.value.y;
      const sizeX = u.uBakeSpan.value.x;
      const sizeZ = u.uBakeSpan.value.y;

      // sample the BASE field (erosion off → no feedback) at texel centres,
      // yielding to the event loop so the UI/progress stay responsive
      const sampler = this._getHeightSampler().cpu;
      const prevEnabled = this.erosionField.enabled;
      this.erosionField.enabled = false;
      const base = new Float32Array(res * res);
      for (let row = 0; row < res; row++) {
        const z = originZ + ((row + 0.5) / res) * sizeZ;
        const rowOff = row * res;
        for (let col = 0; col < res; col++) {
          const x = originX + ((col + 0.5) / res) * sizeX;
          base[rowOff + col] = sampler.heightAt(x, z);
        }
        if ((row & 31) === 0) {
          onProgress?.(0.08 * (row / res), 'sampling');
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      this.erosionField.enabled = prevEnabled;

      // cell size in world units → scale cell-relative knobs (talus / minSlope)
      const cellWorld = Math.max(sizeX, sizeZ) / res;
      const params = this._erosionSimParams(cellWorld);

      const out = await this._runErosionSim({
        width: res, height: res, heightmap: base, params,
        onProgress: (pr, phase) => onProgress?.(0.1 + pr * 0.85, phase),
      });

      this.erosionField.setRegion(originX, originZ, sizeX, sizeZ);
      this.erosionField.setDelta(out.delta, res);
      this.erosionField.setMasks({
        flow: out.flow, erosionMask: out.erosionMask, depositionMask: out.depositionMask,
        sedimentMap: out.sedimentMap, slopeMap: out.slopeMap,
      }, res);
      this.erosionField.setEnabled(true);
      this.erosionField.applyTo(u);

      if (this.params.erosionEnabled !== true) {
        this.params.erosionEnabled = true;
        this.cb.onParams?.(this._paramsSnapshot());
      }
      this._onErosionChanged();
      onProgress?.(1, 'done');
      this.cb.onToast?.(out.backend === 'webgpu' ? 'Erosion baked (WebGPU compute).' : 'Erosion baked.');
      return true;
    } catch (err) {
      this.cb.onToast?.(`Erosion failed: ${err?.message || err}`);
      return false;
    } finally {
      this._erosionBaking = false;
    }
  }

  /** Map the engine `erosion*` params to erosionSim params (cell-scaled). */
  _erosionSimParams(cellWorld) {
    const p = this.params;
    return {
      seed: (p.erosionSeed | 0) || 1,
      strength: p.erosionStrength,
      droplets: p.erosionDroplets,
      maxLifetime: p.erosionLifetime,
      inertia: p.erosionInertia,
      sedimentCapacity: p.erosionSedimentCapacity,
      minSlope: 0.01 * cellWorld,
      depositionRate: p.erosionDeposition,
      erosionRate: p.erosionErosionRate,
      erosionRadius: p.erosionRadius,
      evaporation: p.erosionEvaporation,
      gravity: p.erosionGravity,
      initialSpeed: 1.0,
      initialWater: 1.0,
      thermalIterations: p.erosionThermalIterations,
      thermalStrength: p.erosionThermalStrength,
      talus: p.erosionTalus * cellWorld,
      smoothing: p.erosionSmoothing,
    };
  }

  /**
   * Backend dispatch for the erosion simulation. `erosionBackend` param:
   * 'auto' (default) tries the WebGPU compute backend and falls back to the
   * CPU worker on any failure; 'cpu' forces the worker. The WebGPU module is
   * imported lazily so it never affects boot.
   */
  async _runErosionSim(job) {
    if (this.params.erosionBackend !== 'cpu' && !this._erosionGPUUnavailable) {
      const gpu = await this._importErosionGPU();
      if (gpu?.isWebGPUErosionSupported?.()) {
        try {
          const t0 = performance.now();
          const out = await gpu.erodeWebGPU(job);
          console.log(`[erosion] WebGPU compute backend: ${(performance.now() - t0).toFixed(0)}ms`);
          return { ...out, backend: 'webgpu' };
        } catch (err) {
          console.warn('[erosion] WebGPU compute backend failed — falling back to CPU worker.', err);
        }
      }
    }
    return { ...(await this._runErosionWorker(job)), backend: 'cpu' };
  }

  _importErosionGPU({ warm = false } = {}) {
    if (this._erosionGPUUnavailable) return Promise.resolve(null);
    if (this._erosionGPUModule) return Promise.resolve(this._erosionGPUModule);
    if (this._erosionGPUImportPromise) return this._erosionGPUImportPromise;

    this._erosionGPUImportPromise = this._importErosionGPUWithRetries()
      .then((mod) => {
        this._erosionGPUModule = mod;
        return mod;
      })
      .catch((err) => {
        this._erosionGPUUnavailable = true;
        const context = warm ? 'during post-boot warmup' : 'while starting erosion';
        console.warn(
          `[erosion] WebGPU module import failed ${context}; dev server may have restarted — hard-reload the tab. Falling back to CPU erosion, slower but same result.`,
          err,
        );
        return null;
      })
      .finally(() => {
        this._erosionGPUImportPromise = null;
      });

    return this._erosionGPUImportPromise;
  }

  async _importErosionGPUWithRetries() {
    const failures = [];

    try {
      return await import('./terrain/erosion/erosionWebGPU.js');
    } catch (err) {
      failures.push(err);
    }

    await new Promise((resolve) => setTimeout(resolve, 300));

    try {
      return await import('./terrain/erosion/erosionWebGPU.js');
    } catch (err) {
      failures.push(err);
    }

    if (import.meta.env.DEV) {
      try {
        return await import(/* @vite-ignore */ `./terrain/erosion/erosionWebGPU.js?t=${Date.now()}`);
      } catch (err) {
        failures.push(err);
      }
    }

    throw failures[failures.length - 1] || new Error('unknown WebGPU module import failure');
  }

  _runErosionWorker({ width, height, heightmap, params, onProgress }) {
    return new Promise((resolve, reject) => {
      if (!this._erosionWorker) {
        this._erosionWorker = new Worker(
          new URL('./terrain/erosion/erosion.worker.js', import.meta.url),
          { type: 'module' },
        );
      }
      const worker = this._erosionWorker;
      const id = (this._erosionJobId = (this._erosionJobId || 0) + 1);
      const onMsg = (e) => {
        const m = e.data;
        if (!m || m.id !== id) return;
        if (m.type === 'progress') onProgress?.(m.progress, m.phase);
        else if (m.type === 'result') { worker.removeEventListener('message', onMsg); resolve(m); }
        else if (m.type === 'error') { worker.removeEventListener('message', onMsg); reject(new Error(m.message)); }
      };
      worker.addEventListener('message', onMsg);
      worker.postMessage({ type: 'erode', id, width, height, heightmap, params }, [heightmap.buffer]);
    });
  }

  /** Apply a named erosion preset to the engine params (does not rebake). */
  applyErosionPreset(key) {
    const preset = getErosionPreset(key);
    this.params.erosionPreset = key;
    Object.assign(this.params, preset.params);
    this.cb.onParams?.(this._paramsSnapshot());
  }

  /** Live before/after toggle — only applies if a bake exists. */
  setErosionEnabled(on) {
    this.erosionField.setEnabled(on);
    this.erosionField.applyTo(this.uniforms);
    this._onErosionChanged();
  }

  /** Reset erosion: drop the baked offset + masks and disable. */
  clearErosion() {
    this.erosionField.clear();
    this.erosionField.applyTo(this.uniforms);
    if (this.params.erosionEnabled !== false) {
      this.params.erosionEnabled = false;
      this.cb.onParams?.(this._paramsSnapshot());
    }
    this._onErosionChanged();
  }

  /** Erosion edits change the height field: invalidate the studio bake + GPU
   *  height readbacks and force a redraw, exactly like an import/paint edit. */
  _onErosionChanged() {
    this._markTerrainFieldDirty();
  }

  _waterLevel() {
    if (this._waterDeferred) return null;
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
    if (mode !== 'none' && this.splineState?.enabled) this.setSplineEditingEnabled(false);
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
      const planet = this._planetModules;
      if (!planet) return;
      this.planetControls = new planet.PlanetOrbitControls(this.camera, this.canvas, this.params.planetRadius);
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
      const planet = this._planetModules;
      if (!planet) return null;
      this.planetSampler = new planet.PlanetHeightSampler(this.uniforms, () => ({
        octaves: Math.round(this.params.octaves),
      }));
    }
    return this.planetSampler;
  }

  /** Enter/leave the spherical-gravity walker (orbit camera ↔ surface walk). */
  _setPlanetPlayerMode(enabled) {
    const planet = this._planetModules;
    if (!planet) return;
    if (enabled) {
      // orbit camera sleeps while walking (frees the click for pointer lock)
      if (this.planetControls) { this.planetControls.dispose(); this.planetControls = null; }
      // Near chunks are coarse (one quad spans chunkSpan / lodSegments[0] world
      // units), so the flat triangles can sit above the exact sampled point.
      // Tell the controller that quad size so it can keep the body on top of the
      // faceted mesh instead of sinking under it.
      const pw = this.planetWorld;
      const quadSize = pw ? pw.chunkSpan / (pw.lodSegments[0] || 64) : 62.5;
      this.player = new planet.PlanetController({
        camera: this.camera,
        domElement: this.canvas,
        sampler: this._getPlanetSampler(),
        config: { groundSampleSpread: quadSize },
      });
      this.cb.onToast('Planet walk — click to lock mouse · Space jump · Shift run');
    } else {
      if (this.player) { this.player.dispose(); this.player = null; }
      // restore the orbit camera at a sensible distance
      this.planetControls = new planet.PlanetOrbitControls(this.camera, this.canvas, this.params.planetRadius);
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
    if (enabled && !this.paintMode?.state.enabled) {
      // Never let a pre-stroke progressive bake publish after painting starts.
      // Paint is sampled live while editing; exit starts one fresh atomic bake.
      this.terrainHeightBaker?.cancel?.();
      this._terrainBakeJobKey = null;
      this._bakedStudioGen = -1;
      this._paintWasEnabled = true;
      this.uniforms.uUseTerrainHeightTex.value = 0.0;
      if (this.uniforms.uUseTerrainBiomeTex) {
        this.uniforms.uUseTerrainBiomeTex.value = 0.0;
      }
      this.uniforms.uUseWaterTerrainBiomeTex.value = 0.0;
    }
    this.paintMode?.setEnabled(enabled);
  }

  setPaintSetting(key, value) {
    this.paintMode?.setState({ [key]: value });
  }

  clearPaintLayers() {
    this.projectHistory?.createSnapshot('Before clearing paint', { automatic: true });
    this.paintMode?.clear();
    this._markTerrainFieldDirty();
  }

  // Non-destructive: swap between painting on top of the generated terrain
  // and a flat Empty Terrain base, keeping any existing paint strokes.
  setPaintBaseMode(mode) {
    this.paintMode?.setBaseMode(mode);
    this._markTerrainFieldDirty();
  }

  // Destructive "start fresh": flatten the base AND clear paint layers.
  startEmptyTerrain() {
    this.projectHistory?.createSnapshot('Before empty terrain', { automatic: true });
    this.paintMode?.startEmpty();
    this._markTerrainFieldDirty();
  }

  // ----------------------------------------------------- manual terrain mode

  setManualPlacementType(type) { this.manualTerrain?.setPlacementType(type); }
  beginManualShapeDrag(type) { this.manualTerrain?.beginDrag(type); }
  endManualShapeDrag() { this.manualTerrain?.endDrag(); }
  setManualTransformMode(mode) { this.manualTerrain?.setTransformMode(mode); }
  selectManualShape(id) { this.manualTerrain?.selectShape(id, { requestInspector: !!id }); }
  updateManualShape(id, patch) { return this.manualTerrain?.updateShape(id, patch); }
  deleteManualShape(id) { return this.manualTerrain?.deleteShape(id); }
  duplicateManualShape(id) { return this.manualTerrain?.duplicateShape(id); }
  moveManualShape(id, direction) { return this.manualTerrain?.moveShape(id, direction); }
  addManualShapeLayer(shapeId, type) { return this.manualTerrain?.addShapeLayer(shapeId, type); }
  updateManualShapeLayer(shapeId, layerId, patch) { return this.manualTerrain?.updateShapeLayer(shapeId, layerId, patch); }
  deleteManualShapeLayer(shapeId, layerId) { return this.manualTerrain?.deleteShapeLayer(shapeId, layerId); }
  duplicateManualShapeLayer(shapeId, layerId) { return this.manualTerrain?.duplicateShapeLayer(shapeId, layerId); }
  moveManualShapeLayer(shapeId, layerId, direction) { return this.manualTerrain?.moveShapeLayer(shapeId, layerId, direction); }
  setManualSculptEnabled(enabled) { this.manualTerrain?.setSculptEnabled(enabled); }
  setManualSculptSetting(key, value) { this.manualTerrain?.setSculptSetting(key, value); }
  clearManualSculpt() { return this.manualTerrain?.clearSculpt(); }
  setManualTexturePaintEnabled(enabled) { this.manualTerrain?.setTexturePaintEnabled(enabled); }
  setManualTexturePaintSetting(key, value) { this.manualTerrain?.setTexturePaintSetting(key, value); }
  clearManualTexturePaint() { return this.manualTerrain?.clearTexturePaint(); }
  setManualWorkspaceActive(active) { this.manualTerrain?.setWorkspaceActive(active); }

  // ---------------------------------------------------------- creator tools

  setSplineEditingEnabled(enabled) {
    if (enabled && this.worldMode !== 'studio') { this.cb.onToast('Splines are currently available in Tile mode'); return; }
    if (enabled && this.exploreMode !== 'none') this.setExploreMode('none');
    if (enabled && this.paintMode?.state.enabled) this.setPaintMode(false);
    this.splineManager?.setEditingEnabled(enabled);
  }
  createSpline(type) { this.setSplineEditingEnabled(true); this.splineManager?.createSpline(type); }
  confirmSplineCreation() {
    const manager = this.splineManager;
    if (!manager?.editor?.creatingType) return;
    manager.finishDraft();
    manager.editor.creatingType = null;
    manager._emit();
  }
  cancelSplineCreation() { this.splineManager?.editor?.cancel(); }
  updateSpline(id, patch) { this.splineManager?.updateSpline(id, patch); }
  deleteSpline(id) { this.splineManager?.deleteSpline(id); }
  selectSpline(id) { this.splineManager?.selectSpline(id); }
  duplicateSpline(id) { this.splineManager?.duplicateSpline(id); }
  setAnalysisMode(mode) { this.terrainAnalysis?.setMode(mode); this.projectHistory?.record('analysis', `Analysis: ${mode}`); }
  setAnalysisSettings(patch) { this.terrainAnalysis?.setSettings(patch); }
  async createSnapshot(name) { const s = await this.projectHistory?.createSnapshot(name); if (s) this.cb.onToast(`Snapshot saved · ${s.name}`); return s; }
  restoreSnapshot(id) { return this.projectHistory?.restoreSnapshot(id); }
  restoreHistoryAction(id) { return this.projectHistory?.restoreAction(id); }
  deleteSnapshot(id) { this.projectHistory?.deleteSnapshot(id); }
  renameSnapshot(id, name) { this.projectHistory?.renameSnapshot(id, name); }

  // -------------------------------------------------------------- world mode

  async setWorldMode(mode) {
    const transitionToken = (this._worldModeToken ?? 0) + 1;
    this._worldModeToken = transitionToken;
    if (mode === this.worldMode) return;
    if (this.projectMode === 'manual' && mode !== 'studio') {
      this.cb.onToast('Manual Terrain is currently available in Tile mode');
      return;
    }

    let planetModules = null;
    if (mode === 'planet') {
      try {
        planetModules = await this._loadPlanetModules();
      } catch (error) {
        if (transitionToken === this._worldModeToken && !this._disposed) {
          console.warn('Planet modules failed to load', error);
          this.cb.onToast?.('Planet mode failed to load - please try again');
        }
        return;
      }
      if (transitionToken !== this._worldModeToken || this._disposed) return;
    }
    if (transitionToken !== this._worldModeToken || this._disposed) return;
    if (mode === this.worldMode) return;
    if (this.projectMode === 'manual' && mode !== 'studio') {
      this.cb.onToast('Manual Terrain is currently available in Tile mode');
      return;
    }
    if (this.paintMode?.state.enabled) this.setPaintMode(false);
    if (this.splineState?.enabled) this.setSplineEditingEnabled(false);
    // Player physics is per-mode; leave it only once the target is ready.
    this.setExploreMode('none');

    // tear down the mode we are leaving
    const prev = this.worldMode;
    this._octToken++;
    this._terrainSourcePendingToken = null;
    this._retireTerrainAtomicCompiles();
    this._retireWorldCompile();
    this.cb.onCompileProgress?.(null);

    if (prev === 'studio' && mode !== 'studio') {
      // Deferred water is a Studio bake gate, never a global water-off flag.
      // Infinite/Planet can show their safe fallback while exact shaders link.
      this._waterDeferred = false;
      this._waterMaterialWarmed = false;
      this._waterMaterialWarmIdentity = null;
      this._waterWarmRestartPending = false;
      this._waterWarmRetryCount = 0;
      this._waterWarmFailed = false;
      if (this._waterWarmRetryTimer) {
        clearTimeout(this._waterWarmRetryTimer);
        this._waterWarmRetryTimer = null;
      }
    }
    if (prev === 'infinite') this._disposeInfinite();
    else if (prev === 'planet') this._disposePlanet();

    this.worldMode = mode;
    this._cloudAdaptive?.suspend(performance.now(), 6000);
    this.uniforms.uInfiniteMode.value = mode === 'infinite' ? 1.0 : 0.0;
    const tileDebugView = this.tileDebug?.view ?? 'off';
    this.uniforms.uTileDebugView.value = mode === 'studio'
      ? (tileDebugView === 'noise' ? 1
        : tileDebugView === 'height' ? 2
          : tileDebugView === 'biome' ? 3 : 0)
      : 0;
    this._markTerrainFieldDirty();   // uFrequency / falloff change with the mode
    // The new mode's materials need their own underwater RT-variant programs;
    // re-arm the lazy warm so they compile on first approach to water (three's
    // program cache makes the recompile instant if already built this session).
    this._underwaterWarmed = false;

    if (mode === 'infinite') this._enterInfiniteMode();
    else if (mode === 'planet') this._enterPlanetMode(planetModules);
    else this._enterStudioMode();
  }

  _enterInfiniteMode() {
    this._packNoiseUniforms();
    this._syncCpuHeightProgram();
    // Infinite exploration stays fully procedural; Studio paint layers are
    // board-local overrides and are restored when returning to Studio mode.
    this.uniforms.uPaintEnabled.value = 0;
    this.uniforms.uManualEnabled.value = 0;
    this.uniforms.uUseTerrainHeightTex.value = 0.0;   // unbounded world — no fixed bake
    if (this.studioCloud) this.studioCloud.setInScene(false);

    // Hide studio objects
    this.board.group.visible = false;
    if (this.realWorldBuildingLayer) this.realWorldBuildingLayer.group.visible = false;
    this._setPlinthVisible(false);
    this.water.visible = false;
    this._tileGhostCell = null;
    if (this._tileGhost) this._tileGhost.visible = false;

    // Compute fixed frequency matching the current tile
    const p = this.params;
    const tileFreq = (p.noiseScale * 0.1) / this.boardSize;

    // Keep a distinct material object for disposal, but use source/defines that
    // are byte-identical to Tile terrain. Tile's compiled program remains owned
    // by terrainMaterial, so Three.js can reuse it immediately for these chunks.
    const oct = Math.round(p.octaves);
    this._infiniteTerrainMat = createInfiniteTerrainMaterial(
      this.uniforms,
      oct,
      this._stackGLSL,
      { variant: this._targetTerrainVariant() },
    );
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
    this.infiniteWorld.setMergeOptions({
      enabled: perf.terrainMerge,
      quadsPerChunk: perf.terrainMergeQuads,
      mergeDistance: perf.terrainMergeDistance,
      allowRoot: perf.terrainMacroProxy,
    });
    this.infiniteWorld.behindCameraCulling = this.board.behindCameraCulling;
    this.infiniteWorld.setMergeDebug(this._debug.mergeDebug);

    this.infiniteCloud = new InfiniteCloudLayer(this.scene, {
      compile: async (mats) => {
        // Applying restored quality may request a rebuild while mode setup is
        // still synchronous. Yield so the transition gate and scene exist first.
        await yieldTask();
        if (this._disposed || this.worldMode !== 'infinite') {
          return { ready: false, aborted: true };
        }
        for (let attempt = 0; attempt < 3; attempt++) {
          const target = this._resolveCameraCompileTarget();
          const result = await this._compileMaterialVariants(mats, {
            canvasOnly: true,
            timeoutMs: 120000,
            renderTarget: target.renderTarget,
          });
          if (result?.ready !== true || this._disposed
              || this.worldMode !== 'infinite') return result;
          const current = this._resolveCameraCompileTarget();
          if (this._sameCameraCompileTarget(target, current)) return result;
          await yieldTask();
        }
        return { ready: false, aborted: true };
      },
      renderer: this.renderer,
      chunkSize: p.chunkSize,
      viewRadius: perf.viewRadius,
    });
    this._applyCloudSettings();

    const clipmapResolutions = this.gpuTier === 'low'
      ? [256, 192, 128]
      : (this.gpuTier === 'medium' ? [384, 256, 192] : [512, 384, 256]);
    this.infiniteTerrainClipmap = new InfiniteTerrainClipmap({
      renderer: this.renderer,
      uniforms: this.uniforms,
      chunkSize: p.chunkSize,
      viewRadius: perf.viewRadius,
      octaves: oct,
      stackGLSL: this._stackGLSL,
      resolutions: clipmapResolutions,
      requirePrepared: true,
    });

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

    // Terrain already reuses Tile's compiled program. Only genuinely
    // mode-specific world materials need background preparation.
    this._warmupInfiniteShaders(oct);

    if (!this._compiling) this.cb.onStatus('Infinite World', false);
    if (this.cb.onQualityChange) this.cb.onQualityChange(this.qualityPreset);
    if (this.cb.onTimeOfDayChange) this.cb.onTimeOfDayChange(this.timeOfDay);
  }

  async _warmupInfiniteShaders(_oct) {
    const gate = this._acquireWorldCompile('infinite');
    this.cb.onStatus('Compiling world shadersâ€¦', true);
    const isCurrent = () => this._worldCompileGate === gate
      && !this._disposed
      && this.worldMode === 'infinite';
    let cachePreparation = null;
    let success = false;
    try {
      const targetSnapshot = this._resolveCameraCompileTarget();
      const source = this.infiniteWorld?.batches?.meshes?.find(Boolean) ?? null;
      if (!source?.geometry) return;
      const terrainResult = await this._compileInstancedMaterialVariant(
        this._infiniteTerrainMat, source.geometry, targetSnapshot.renderTarget,
      );
      if (!isCurrent() || terrainResult?.ready !== true) return;

      cachePreparation = await this._prepareHeightCacheProgram(
        'infinite', Math.round(this.params.octaves), this._stackGLSL,
      );
      if (!isCurrent() || cachePreparation?.result?.ready !== true) return;

      const liveMaterials = [];
      if (this.params?.waterEnabled !== false && this._infiniteWaterMat) {
        liveMaterials.push(this._infiniteWaterMat);
      }
      if (this.proceduralSky?.material) liveMaterials.push(this.proceduralSky.material);
      if (this.params?.cloudsEnabled && this.infiniteCloud?.material) {
        liveMaterials.push(this.infiniteCloud.material);
      }
      const result = await this._compileMaterialVariants(
        [...new Set(liveMaterials)],
        {
          canvasOnly: true, stagger: true, timeoutMs: 120000,
          renderTarget: targetSnapshot.renderTarget,
        },
      );
      if (!isCurrent() || result?.ready !== true) return;
      const currentTarget = this._resolveCameraCompileTarget();
      if (!this._sameCameraCompileTarget(targetSnapshot, currentTarget)) return;
      if (!this._publishHeightCachePreparation(cachePreparation)) return;
      success = true;
    } catch (error) {
      console.warn('Infinite shader warmup failed', error);
    } finally {
      this._discardHeightCachePreparation(cachePreparation);
      this._worldWarmRetryCount ||= { infinite: 0, planet: 0 };
      if (!success && isCurrent()) {
        const retry = ++this._worldWarmRetryCount.infinite;
        if (retry <= 1) {
          void this._warmupInfiniteShaders(Math.round(this.params.octaves));
          return;
        }
        this.cb.onToast?.('Infinite World graphics could not be prepared; returning to Studio');
        void this.setWorldMode('studio');
        return;
      }
      if (success) this._worldWarmRetryCount.infinite = 0;
      const released = this._releaseWorldCompile(gate);
      if (released && !this._disposed && !this._compiling) {
        this.cb.onStatus(this.worldMode === 'infinite' ? 'Infinite World' : 'Ready', false);
      }
    }
  }
  /** Dispose the infinite-world systems (does not restore studio). */
  _disposeInfinite() {
    if (this.infiniteCloud) {
      this.infiniteCloud.dispose();
      this.infiniteCloud = null;
    }
    if (this.infiniteTerrainClipmap) {
      this.infiniteTerrainClipmap.dispose();
      this.infiniteTerrainClipmap = null;
    }
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
    if (this.realWorldBuildingLayer) {
      this.realWorldBuildingLayer.group.visible = this.realWorldBuildingsVisible;
    }
    this._setPlinthVisible(true);
    this.water.visible = !this._waterDeferred
      && this.waterSystem?.isEnabled() && this.params.seaLevel > 0.5;
    if (this.studioCloud) {
      this.studioCloud.setInScene(true);
      this._applyCloudSettings();
    }

    this._syncCpuHeightProgram();
    this._applyUniforms();
    this.paintMode?._syncUniforms?.();
    this.uniforms.uManualEnabled.value = this.projectMode === 'manual'
      && (this.manualTerrain?.shapes?.length || !this.manualTerrain?.field?.isSculptEmpty?.()) ? 1 : 0;
    const rebuildJob = this._rebuildStackMaterialsAsync(this._activeHeightProgram(), {
      atomic: true,
      terrainDirtyOnSwap: true,
      label: 'Preparing Studio terrain',
    });

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
    Promise.resolve(rebuildJob).then((result) => {
      if (this._disposed || this.worldMode !== 'studio') return;
      if (!result?.error) this._renderMinimapBase();
      this.cb.onStatus(result?.error ? 'Studio terrain unavailable' : 'Ready', false);
    });
  }

  // ---------------------------------------------------------------- planet mode

  /** Planet base radius + chunks-per-face from params (sane fallbacks). */
  _planetRadius() { return this.params.planetRadius || 16000; }
  _planetFaceGrid() { return Math.round(this.params.planetFaceGrid) || 8; }

  /** (Re)build the cube-sphere world + water shell from the current params.
   *  Disposes any existing planet world/water first. */
  _buildPlanetWorld() {
    const planet = this._planetModules;
    if (!planet) return;
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
    this.planetWorld = new planet.PlanetWorld(
      this.scene,
      // the factory reads the minimal flag at call time, so fold meshes
      // created after the background upgrade get the full fragment directly
      () => planet.createPlanetMaterial(this.uniforms, oct, this._stackGLSL,
        { minimal: this._planetMatMinimal === true }),
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
    this.planetWorld.horizonCulling = this.board.behindCameraCulling;
    this.planetWorld.setMergeOptions({
      enabled: this.perf.terrainMerge,
      quadsPerChunk: this.perf.terrainMergeQuads,
      mergeDistance: this.perf.terrainMergeDistance,
      macroEnabled: this.perf.terrainMacroProxy,
    });
    this.planetWorld.setMergeDebug(this._debug.mergeDebug);

    // water shell: a sphere at radius (planetRadius + seaLevel); the shader
    // discards over land so only basins fill. One mesh, one shared material.
    this.planetWaterMat = planet.createPlanetWaterMaterial(this.uniforms, oct, this._stackGLSL);
    this.planetWaterMat.uniforms.uWaterAnim.value = p.waterAnim ? 1 : 0;
    this.planetWater = new THREE.Mesh(new THREE.SphereGeometry(1, 256, 192), this.planetWaterMat);
    this.planetWater.frustumCulled = false;
    this.planetWater.renderOrder = 10;
    this._updatePlanetWater();
    this.scene.add(this.planetWater);
    this._applyWaterPerf();
  }

  _ensureStudioHeightBaker() {
    if (!this.terrainHeightBaker) {
      this.terrainHeightBaker = new TerrainHeightBaker({
        renderer: this.renderer,
        uniforms: this.uniforms,
        size: this._bakeBaseSize(),
        maxSize: this.gpuTier === 'low' ? 2048 : 4096,
        requirePrepared: true,
      });
      this._bakedStudioGen = -1;
      this._terrainBakeJobKey = null;
    }
    return this.terrainHeightBaker;
  }

  async _ensurePlanetHeightBaker() {
    if (this.planetHeightBaker) return this.planetHeightBaker;
    const planet = this._planetModules || await this._loadPlanetModules();
    if (!planet || this._disposed) return null;
    this.planetHeightBaker = new planet.PlanetHeightBaker({
      renderer: this.renderer,
      uniforms: this.uniforms,
      size: 1024,
      requirePrepared: true,
    });
    this._bakedTerrainGen = -1;
    this._planetBakeRequestedGen = -1;
    return this.planetHeightBaker;
  }

  async _prepareHeightCacheProgram(mode, octaves, program) {
    if (mode === 'studio' && this._usesLiveStudioHeightField()) {
      return { cache: null, handle: null, result: { ready: true, live: true } };
    }
    let cache = null;
    let handle = null;
    if (mode === 'studio') {
      cache = this.terrainHeightBaker
        ?? (this.renderer ? this._ensureStudioHeightBaker?.() : null)
        ?? null;
      let bounds = { cols: 1, rows: 1 };
      try {
        bounds = this._tileBounds?.() ?? bounds;
      } catch {
        // Lightweight lifecycle/test harnesses need no tile-layout compile
        // variant; production Engine instances always provide _tileBounds().
      }
      handle = cache?.prepareProgram?.(
        octaves, program, bounds.cols ?? 1, bounds.rows ?? 1,
      ) ?? null;
    } else if (mode === 'infinite') {
      cache = this.infiniteTerrainClipmap;
      handle = cache?.prepareProgram?.(octaves, program) ?? null;
    } else if (mode === 'planet') {
      cache = this.planetHeightBaker
        ?? (this.renderer ? await this._ensurePlanetHeightBaker?.() : null)
        ?? null;
      handle = cache?.prepareProgram?.(octaves, program) ?? null;
    }
    if (!cache || !handle) return { cache, handle, result: { ready: true } };
    try {
      const result = await this._compilePreparedPasses(handle, { timeoutMs: 120000 });
      return { cache, handle, result };
    } catch (error) {
      cache.discardPrepared?.(handle);
      throw error;
    }
  }

  _prepareStudioHeightCacheAsync() {
    if (this._disposed || !this.params) return Promise.resolve(false);
    if (this._usesLiveStudioHeightField()) {
      this._ensureTerrainHeightTex();
      return Promise.resolve(true);
    }
    if (this._terrainHeightPreparePromise) return this._terrainHeightPreparePromise;
    const program = this._activeHeightProgram('studio');
    const programSig = program?.heightSig || program?.sig;
    const octaves = Math.round(
      this.params?.octaves ?? this.terrainMaterial?.defines?.OCTAVES ?? 1,
    );
    const job = (async () => {
      let preparation = null;
      try {
        preparation = await this._prepareHeightCacheProgram('studio', octaves, program);
        const current = this._activeHeightProgram('studio');
        const currentSig = current?.heightSig || current?.sig;
        if (this._disposed || !this.params || this.worldMode !== 'studio'
            || currentSig !== programSig
            || Math.round(this.params?.octaves ?? octaves) !== octaves
            || preparation?.result?.ready !== true) {
          return false;
        }
        if (!this._publishHeightCachePreparation(preparation)) return false;
        this._terrainHeightBakeDeferred = false;
        this._ensureTerrainHeightTexSafely();
        return true;
      } catch (error) {
        console.warn('Studio height-cache preparation failed', error);
        return false;
      } finally {
        this._discardHeightCachePreparation(preparation);
      }
    })();
    const pending = job.finally(() => {
      if (this._terrainHeightPreparePromise === pending) {
        this._terrainHeightPreparePromise = null;
      }
    });
    this._terrainHeightPreparePromise = pending;
    return pending;
  }
  _preparePlanetHeightCacheAsync() {
    if (this._disposed || !this.params) return Promise.resolve(false);
    if (this._planetHeightPreparePromise) return this._planetHeightPreparePromise;
    const program = this._stackGLSL;
    const programSig = program?.heightSig || program?.sig;
    const octaves = Math.round(this.params.octaves);
    const job = (async () => {
      let preparation = null;
      try {
        preparation = await this._prepareHeightCacheProgram('planet', octaves, program);
        const currentSig = this._stackGLSL?.heightSig || this._stackGLSL?.sig;
        if (this._disposed || this.worldMode !== 'planet'
            || currentSig !== programSig
            || Math.round(this.params?.octaves ?? octaves) !== octaves
            || preparation?.result?.ready !== true) {
          return false;
        }
        return this._publishHeightCachePreparation(preparation);
      } catch (error) {
        console.warn('Planet height-cache preparation failed', error);
        return false;
      } finally {
        this._discardHeightCachePreparation(preparation);
      }
    })();
    const pending = job.finally(() => {
      if (this._planetHeightPreparePromise === pending) {
        this._planetHeightPreparePromise = null;
      }
    });
    this._planetHeightPreparePromise = pending;
    return pending;
  }
  _publishHeightCachePreparation(preparation) {
    if (!preparation?.cache || !preparation?.handle) return true;
    if (preparation.result?.ready !== true) return false;
    return preparation.cache.publishPrepared?.(preparation.handle) !== false;
  }

  _discardHeightCachePreparation(preparation) {
    if (!preparation?.cache || !preparation?.handle) return;
    preparation.cache.discardPrepared?.(preparation.handle);
  }
  /**
   * Ensure the planet height cubemap is baked and current. Re-bakes only
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
      void this._preparePlanetHeightCacheAsync();
      return;
    }
    if (this._bakedTerrainGen === this._terrainGen) return;
    if (this._planetBakeRequestedGen !== this._terrainGen) {
      const started = this.planetHeightBaker.begin(
        Math.round(this.params.octaves), this._stackGLSL,
      );
      if (started === false) {
        void this._preparePlanetHeightCacheAsync();
        return;
      }
      this._planetBakeRequestedGen = this._terrainGen;
      this.uniforms.uUsePlanetHeightTex.value = 0.0;
    }
    const result = this.planetHeightBaker.step();
    if (result.ready) {
      this.uniforms.uPlanetHeightTex.value = result.texture;
      this.uniforms.uUsePlanetHeightTex.value = 1.0;
    }
    if (result.complete) this._bakedTerrainGen = this._terrainGen;
  }

  /**
   * Ensure the studio height texture is baked and current. Re-bakes only
   * when the terrain generation counter has advanced (seed / shape / biome
   * edits), so a steady camera costs nothing. While painting, the height field
   * changes continuously — sample the live field and refresh the bake once the
   * stroke ends. The progressive high-resolution bake stays private and is
   * published atomically only when its height and climate passes are complete.
   */
  _ensureTerrainHeightTex() {
    if (this.worldMode !== 'studio') return;
    if (this._usesLiveStudioHeightField()) {
      // All three switches must move together. Leaving even the climate or
      // water cache enabled recreates the mixed-generation shoreline/colour
      // artifacts this correctness path exists to prevent.
      this.uniforms.uUseTerrainHeightTex.value = 0.0;
      this.uniforms.uUseTerrainBiomeTex.value = 0.0;
      this.uniforms.uUseWaterTerrainBiomeTex.value = 0.0;
      return;
    }
    // Keep the last coherent full-resolution bake visible while a structural
    // height program is compiling. The matching generation is invalidated
    // atomically when the new terrain shader is ready to publish.
    if (this._terrainSourcePendingToken != null) return;
    if (this._terrainHeightBakeDeferred) {
      this.uniforms.uUseTerrainHeightTex.value = 0.0;
      return;
    }
    if (this._debug.disableHeightBake) {   // debug: force the live per-pixel field
      this.uniforms.uUseTerrainHeightTex.value = 0.0;
      return;
    }
    if (this.paintState?.enabled) {
      this.uniforms.uUseTerrainHeightTex.value = 0.0;
      this.uniforms.uUseTerrainBiomeTex.value = 0.0;
      this.uniforms.uUseWaterTerrainBiomeTex.value = 0.0;
      this._paintWasEnabled = true;
      return;
    }
    if (this._paintWasEnabled) {      // just left paint mode — capture the edits
      this._bakedStudioGen = -1;
      this._paintWasEnabled = false;
    }
    this._ensureStudioHeightBaker();
    const layoutKey = this._studioBakeLayoutKey();
    if (this._bakedStudioGen === this._terrainGen && this._bakedStudioLayout === layoutKey) return;
    const b = this._tileBounds();
    const jobKey = `${this._terrainGen}:${layoutKey}`;
    if (this._terrainBakeJobKey !== jobKey) {
      const bakeId = this.terrainHeightBaker.begin(
        Math.round(this.params.octaves),
        this._activeHeightProgram('studio'),
        b.cols,
        b.rows,
      );
      if (bakeId == null) {
        this._terrainHeightBakeDeferred = true;
        void this._prepareStudioHeightCacheAsync();
        return;
      }
      this._terrainHeightBakeFailed = false;
      // No interim texture is publishable. Keep both final materials visible
      // on their shared live field until the complete height/climate pair is
      // ready, then publish the pair atomically below.
      this.uniforms.uUseWaterTerrainBiomeTex.value = 0.0;
      this.uniforms.uUseTerrainHeightTex.value = 0.0;
      this.uniforms.uUseTerrainBiomeTex.value = 0.0;
      this._terrainBakeJobKey = jobKey;
      this._terrainBakeElapsedMs = 0;
      this._terrainBakeStripeRows = this.gpuTier === 'low' ? 8
        : (this.gpuTier === 'medium' ? 16 : 32);
      this._completeBootIfInteractiveReady();
    }

    const _t0 = performance.now();
    const stripeRows = this._terrainBakeStripeRows
      ?? (this.gpuTier === 'low' ? 8 : (this.gpuTier === 'medium' ? 16 : 32));
    const result = this.terrainHeightBaker.step(stripeRows);
    const stepMs = performance.now() - _t0;
    const maxStripeRows = this.gpuTier === 'low' ? 32
      : (this.gpuTier === 'medium' ? 48 : 64);
    if (stepMs > 8) {
      this._terrainBakeStripeRows = Math.max(4, Math.floor(stripeRows / 2));
    } else if (stepMs < 3) {
      this._terrainBakeStripeRows = Math.min(
        maxStripeRows,
        Math.max(stripeRows + 1, Math.round(stripeRows * 1.25)),
      );
    }
    this._terrainBakeElapsedMs = (this._terrainBakeElapsedMs || 0) + stepMs;
    this.profiler.setMetric('lastBakeStepMs', stepMs);
    this.profiler.setMetric('terrainBakeProgress', result.progress ?? 0);
    if (!result.complete) {
      this._needsRender = true;
      return;
    }

    this.profiler.setMetric('lastBakeMs', this._terrainBakeElapsedMs);
    this.uniforms.uTerrainHeightTex.value = this.terrainHeightBaker.texture;
    this.uniforms.uUseTerrainHeightTex.value = 1.0;
    this.uniforms.uTerrainBiomeTex.value = this.terrainHeightBaker.biomeTexture;
    this.uniforms.uUseTerrainBiomeTex.value = 1.0;
    this.uniforms.uWaterTerrainHeightTex.value = this.terrainHeightBaker.texture;
    this.uniforms.uWaterTerrainBiomeTex.value = this.terrainHeightBaker.biomeTexture;
    this.uniforms.uUseWaterTerrainBiomeTex.value = 1.0;
    this._bakedStudioGen = this._terrainGen;
    this._bakedStudioLayout = layoutKey;
    this._terrainBakeJobKey = null;
    this._terrainBakeElapsedMs = 0;
    this._terrainBakeStripeRows = null;
    this._terrainHeightBakeFailed = false;
    this._terrainHeightBakeRetryCount = 0;
    if (this.params.waterEnabled !== false && this._waterDeferred) {
      // Let a just-resolved warmup promise clear before re-entering it.
      Promise.resolve().then(() => {
        if (!this._disposed && this._waterDeferred) void this._warmDeferredWater();
      });
    }
    this._completeBootIfQualityReady();
  }

  /**
   * Per-cell resolution of the studio height bake, scaled to the GPU
   * tier. The bake re-evaluates the full ~46-octave field three times per texel
   * (for the analytic normal), so on a weak GPU a 2048² bake is one of the
   * heaviest single operations at startup. 1024² is plenty for a single board
   * and quarters that cost; strong GPUs keep the crisp 2048².
   */
  _bakeBaseSize() {
    if (this.gpuTier === 'low') return 1024;
    if (this.gpuTier === 'medium') return 1024;
    return 1536;
  }

  _enterPlanetMode(planet) {
    if (!planet) return;
    const p = this.params;
    // planet is fully procedural — Studio paint layers don't apply
    this.uniforms.uPaintEnabled.value = 0;
    this.uniforms.uManualEnabled.value = 0;
    this.uniforms.uUseTerrainHeightTex.value = 0.0;   // studio-only bake
    if (this.studioCloud) this.studioCloud.setInScene(false);

    // hide studio objects + sleep the editor camera
    this.board.group.visible = false;
    if (this.realWorldBuildingLayer) this.realWorldBuildingLayer.group.visible = false;
    this._setPlinthVisible(false);
    this.water.visible = false;
    this._tileGhostCell = null;
    if (this._tileGhost) this._tileGhost.visible = false;
    this.controls.enabled = false;

    // refresh shared uniforms (radius, frequency, sun, fog-off for planet)
    this._applyUniforms();

    // Planet always builds the FULL chunk materials and holds the mode-switch
    // overlay until they are compiled (user preference: never show the planet
    // with interim colors). The minimal-fragment machinery stays available but
    // is not used here — the overlay compile is staggered, so the tab stays
    // responsive while it works.
    this._planetMatMinimal = false;

    this._buildPlanetWorld();

    // Apply the requested cloud quality before starting GPU work so a default
    // material is never compiled and immediately replaced.
    if (p.cloudChunksEnabled === true) {
      this.planetCloudChunks = new planet.PlanetCloudChunks(this.scene, {
        planetRadius: this._planetRadius(),
        faceGrid: 4,
        compile: (mats) => this._compileCameraTargetMaterials(mats),
      });
    } else {
      this.planetCloudLayer = new planet.PlanetCloudLayer(this.scene, {
        planetRadius: this._planetRadius(),
        compile: (mats) => this._compileCameraTargetMaterials(mats),
        renderer: this.renderer,
      });
    }
    this._applyCloudSettings();
    const activeCloud = this.planetCloudChunks || this.planetCloudLayer;
    const cloudWarmPromise = Promise.resolve()
      .then(() => activeCloud?.warmup?.())
      .catch((e) => console.warn('Cloud shader warmup failed', e));

    // open-space backdrop (procedural sky is added in a later pass)
    this.scene.background = new THREE.Color(0x05070d);

    this._applyPlanetCamera();

    this.planetControls = new planet.PlanetOrbitControls(this.camera, this.canvas, this._planetRadius());
    this.planetControls.onFirstInteract = () => this.cb.onFirstInteract();
    this.planetControls.update(0.001);   // place the camera immediately

    this._applyPixelRatio();

    // compile the PLANET_MODE shader variant in the background (no freeze)
    this._warmupPlanetShaders(Math.round(p.octaves), cloudWarmPromise);

    if (!this._compiling) this.cb.onStatus('Planet', false);
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
      const planet = this._planetModules;
      if (!planet) return;
      const wantChunks = this.params.cloudChunksEnabled === true;
      if (wantChunks && !this.planetCloudChunks) {
        if (this.planetCloudLayer) {
          this.planetCloudLayer.dispose();
          this.planetCloudLayer = null;
        }
        this.planetCloudChunks = new planet.PlanetCloudChunks(this.scene, {
          planetRadius: this._planetRadius(),
          faceGrid: 4,
        compile: (mats) => this._compileCameraTargetMaterials(mats),
        });
        this.planetCloudChunks.warmup()
          .catch((e) => console.warn('Cloud shader warmup failed', e));
      } else if (!wantChunks && !this.planetCloudLayer) {
        if (this.planetCloudChunks) {
          this.planetCloudChunks.dispose();
          this.planetCloudChunks = null;
        }
        this.planetCloudLayer = new planet.PlanetCloudLayer(this.scene, {
          planetRadius: this._planetRadius(),
        compile: (mats) => this._compileCameraTargetMaterials(mats),
          renderer: this.renderer,
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
    if (this.infiniteCloud) {
      this.infiniteCloud.applyParams(
        this.params,
        this._maxHeight(),
        this.boardSize,
        this.perf,
        {
          chunkSize: this.params.chunkSize,
          viewRadius: this.perf.viewRadius,
        },
      );
    }
    if (this.studioCloud) {
      // Cover the whole tile assembly (union of cells), not just the origin cell.
      this.studioCloud.applyParams(this.params, this._maxHeight(), this.boardSize, this.perf, {
        extent: Math.max(this._unionWidth(), this._unionDepth()),
        center: this._unionCenter(),
      });
    }
    this._syncCloudLighting();
    this._applyCloudAdaptiveQuality();
  }

  /** Rebuild the planet for a radius / face-grid change (settings panel). */
  _rebuildPlanet({ skipUniforms = false } = {}) {
    if (this.worldMode !== 'planet') return;
    this._needsRender = true;
    if (!skipUniforms) {
      this._applyUniforms();
    }
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

  // Rich prop-placement sampler (flat Tile/Infinite). Wraps the f32-exact
  // TerrainHeightSampler so props land on the real rendered surface, and folds
  // in the studio paint height/biome/props masks.
  _getPropSampler() {
    if (!this.propSampler) {
      const cpu = new TerrainHeightSampler(this.uniforms, () => ({
        octaves: Math.round(this.params.octaves),
        infinite: this.worldMode === 'infinite',
      }), this.noiseStack);
      cpu.setHeightProgram(this.worldMode === 'studio' && this.generationSource === 'graph' ? this._graphProgram : null);
      cpu.erosion = this.erosionField;   // props anchor to the eroded field too
      this._propCpuSampler = cpu;
      // GPU readback of the ACTUAL rendered (faceted) surface — props anchor to
      // the visible LOD mesh, not the smooth analytic field (which floats above
      // crests). colorMode 3 packs the interpolated vertex height.
      this.propSurfaceField = new GpuHeightSampler({
        renderer: this.renderer,
        scene: this.scene,
        uniforms: this.uniforms,
        cpuSampler: cpu,
        isTerrainMaterial: (m) => m === this.terrainMaterial || m === this._infiniteTerrainMat,
        getGeneration: () => this._terrainGen,
        getMaxHeight: () => this._maxHeight(),
        colorMode: 3,
        tileSize: 512,
        tileWorld: 1400,
        edgeMargin: 32,
      });
      this.propSampler = new FlatPropSampler({
        cpu,
        surfaceField: this.propSurfaceField,
        getWaterLevel: () => this.params.seaLevel,
        getHeightOffset: (x, z) => (this.worldMode === 'studio'
          ? this._samplePaintHeightOffset(x, z) + this._sampleManualHeightOffset(x, z) + this._sampleSplineHeightOffset(x, z)
          : 0),
        getPaintBiomeWeights: (x, z) => (this.worldMode === 'studio'
          ? (this.paintMode?.layers?.sampleBiomeMask(x, z) ?? null) : null),
        getPaintMask: (x, z) => {
          if (this.worldMode !== 'studio') return null;
          const base = this.paintMode?.layers?.samplePropsMask(x, z) ?? { grass: 0, flowers: 0, mixed: 0 };
          const exclusion = this.splineManager?.getPropExclusion(x, z) ?? 0;
          // Negative density is represented by zero availability; placement
          // code sees a deterministic empty mask at road/river pixels.
          const keep = 1 - exclusion;
          return { grass: base.grass * keep, flowers: base.flowers * keep, mixed: base.mixed * keep };
        },
        getPropExclusion: (x, z) => this.worldMode === 'studio' ? (this.splineManager?.getPropExclusion(x, z) ?? 0) : 0,
      });
    }
    // keep the custom-stack reference current
    this._propCpuSampler?.setStack?.(this.noiseStack);
    return this.propSampler;
  }

  // Rich prop-placement sampler for Planet mode (wraps PlanetHeightSampler).
  _getPlanetPropSampler() {
    if (!this.planetPropSampler) {
      const planet = this._planetModules;
      if (!planet) return null;
      this.planetPropSampler = new planet.PlanetPropSampler({
        planet: this._getPlanetSampler(),
        getWaterLevel: () => this.params.seaLevel,
        getPlanetRadius: () => this.params.planetRadius,
      });
    }
    return this.planetPropSampler;
  }

  /** Size + show/hide the water shell from the current radius + sea level. */
  _updatePlanetWater() {
    if (!this.planetWater) return;
    const seaR = this._planetRadius() + this.params.seaLevel;
    // Circumscribe the analytic sea sphere by only the half-cell diagonal of
    // the 256x192 shell. This covers facet chord sag without the old ~17-unit
    // arbitrary lift that made the water visibly float above its shoreline.
    const halfLon = Math.PI / 256;
    const halfLat = Math.PI / (2 * 192);
    const halfDiagonal = Math.hypot(halfLon, halfLat);
    const shellRadius = seaR / Math.cos(halfDiagonal) + 0.05;
    this.planetWater.scale.setScalar(shellRadius);
    this.planetWater.visible = resolveEffectiveWaterMode(this.params, 'planet') !== 'off'
      && this.params.seaLevel > 0.5;
  }

  async _warmupPlanetShaders(oct, cloudWarmPromise = null) {
    const gate = this._acquireWorldCompile('planet');
    this.cb.onStatus('Compiling planet shadersâ€¦', true);
    let minimal = false;
    let warm = [];
    let shouldUpgrade = false;
    let success = false;
    const isCurrent = () => this._worldCompileGate === gate
      && !this._disposed
      && this.worldMode === 'planet';
    try {
      const planet = await this._loadPlanetModules();
      if (!isCurrent()) return;
      minimal = this._planetMatMinimal === true;
      warm = [
        planet.createPlanetMaterial(this.uniforms, oct, this._stackGLSL, { minimal }),
        planet.createPlanetWaterMaterial(this.uniforms, oct, this._stackGLSL),
      ];
      const targetSnapshot = this._resolveCameraCompileTarget();
      const result = await this._compileMaterialVariants(warm, {
        canvasOnly: true, timeoutMs: 120000, stagger: true,
        renderTarget: targetSnapshot.renderTarget,
      });
      if (!isCurrent() || result?.ready !== true) return;
      if (cloudWarmPromise) await cloudWarmPromise;
      if (!isCurrent()) return;
      const cacheReady = await this._preparePlanetHeightCacheAsync();
      if (!isCurrent() || !cacheReady) return;
      const currentTarget = this._resolveCameraCompileTarget();
      if (!this._sameCameraCompileTarget(targetSnapshot, currentTarget)) return;
      await yieldTask();
      if (!isCurrent()) return;
      this._ensurePlanetHeightTex();
      shouldUpgrade = minimal;
      success = true;
    } catch (error) {
      console.warn('Planet shader warmup failed', error);
    } finally {
      this._queueWarmMaterials(warm);
      this._worldWarmRetryCount ||= { infinite: 0, planet: 0 };
      if (!success && isCurrent()) {
        const retry = ++this._worldWarmRetryCount.planet;
        if (retry <= 1) {
          const activeCloud = this.planetCloudChunks || this.planetCloudLayer;
          const retryCloud = activeCloud?.warmup?.() ?? null;
          void this._warmupPlanetShaders(Math.round(this.params.octaves), retryCloud);
          return;
        }
        this.cb.onToast?.('Planet graphics could not be prepared; returning to Studio');
        void this.setWorldMode('studio');
        return;
      }
      if (success) this._worldWarmRetryCount.planet = 0;
      const released = this._releaseWorldCompile(gate);
      if (released && !this._disposed && !this._compiling) {
        this.cb.onStatus(this.worldMode === 'planet' ? 'Planet' : 'Ready', false);
      }
    }
    if (shouldUpgrade && !this._disposed && this.worldMode === 'planet') {
      this._upgradePlanetMaterials(oct);
    }
  }
  /**
   * Background full-fragment upgrade for the live planet chunk materials.
   * All chunk materials share one program (identical source + defines), so
   * after warming the full source once, flipping each material's source in
   * place is served from three's program cache — no freeze, no mesh churn.
   */
  async _upgradePlanetMaterials(oct) {
    const planet = this._planetModules;
    if (!planet || this._planetMatMinimal !== true) return;
    const t0 = performance.now();
    const program = this._stackGLSL;
    const programSig = program?.sig;
    const warm = planet.createPlanetMaterial(this.uniforms, oct, program);
    const targetSnapshot = this._resolveCameraCompileTarget();
    this._bgWorkStart('planet-full', 'Loading full planet colors…');
    try {
      const result = await this._compileMaterialVariants(
        [warm],
        {
          canvasOnly: true,
          timeoutMs: 120000,
          renderTarget: targetSnapshot.renderTarget,
        }
      );
      const ready = result?.ready === true
        && this._sameCameraCompileTarget(
          targetSnapshot,
          this._resolveCameraCompileTarget(),
        );
      if (ready) this._compiledKeys.add(`planet:${oct}`);
      if (!this._disposed && this.worldMode === 'planet' && this.planetWorld &&
          this._planetMatMinimal === true && ready &&
          this._stackGLSL?.sig === programSig &&
          Math.round(this.params.octaves) === oct &&
          (this.planetWorld.materials[0]?.defines?.OCTAVES ?? oct) === oct) {
        this._planetMatMinimal = false;
        for (const m of this.planetWorld.materials) {
          planet.upgradePlanetMaterialSource(m, program);
        }
        this._needsRender = true;
        console.info(`[mode] full planet material swapped in ${(performance.now() - t0).toFixed(0)}ms (${this.planetWorld.materials.length} chunk materials)`);
      } else if (!this._disposed) {
        console.warn(`[mode] planet material upgrade skipped (ready=${ready}, mode=${this.worldMode}, minimal=${this._planetMatMinimal})`);
      }
    } catch (e) {
      console.warn('Planet terrain material upgrade failed', e);
    } finally {
      this._bgWorkEnd('planet-full');
    }
    this._queueWarmMaterials([warm]);
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
    this._planetBakeRequestedGen = -1;
    if (this.planetWorld) { this.planetWorld.dispose(); this.planetWorld = null; }
    if (this.planetWater) {
      this.scene.remove(this.planetWater);
      this.planetWater.geometry.dispose();
      this.planetWater = null;
    }
    if (this.planetWaterMat) { this.planetWaterMat.dispose(); this.planetWaterMat = null; }
    if (this.planetControls) { this.planetControls.dispose(); this.planetControls = null; }
    if (this.fpsControls) { this.fpsControls.dispose(); this.fpsControls = null; }
    // Procedural sky is shared by Tile and Infinite. Planet only hides it.
    if (this.proceduralSky) this.proceduralSky.setVisible(false);
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
      || key === 'resolutionDenoiseMode'
      || key === 'rendererBackend'
      || key === 'gpuPreference'
      || key === 'useWorker';
    if (!keepsPreset) next.preset = 'custom';
    this.perf = sanitizePerfSettings(next);
    if (key === 'rendererBackend' || key === 'gpuPreference' || key === 'useWorker') {
      const cfg = this.rendererConfig || {};
      this.rendererConfig = {
        ...cfg,
        requestedBackend: this.perf.rendererBackend,
        requestedBackendLabel: labelRendererBackend(this.perf.rendererBackend),
        requestedGpuPreference: this.perf.gpuPreference,
        requestedGpuPreferenceLabel: labelGpuPreference(this.perf.gpuPreference),
        workerRequested: !!this.perf.useWorker,
        workerActive: false,
        reloadRequired: this.perf.rendererBackend !== cfg.appliedRendererBackend
          || this.perf.gpuPreference !== cfg.appliedGpuPreference
          || !!this.perf.useWorker !== !!cfg.workerActive,
      };
    }
    if (key === 'autoPerf' && !this.perf.autoPerf) {
      this._autoScale = 1.0;   // leaving auto mode restores full render scale
      this._cloudAdaptive?.reset(performance.now());
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
    this._cloudAdaptive?.reset(performance.now());
    if (this.rendererConfig) {
      this.rendererConfig = {
        ...this.rendererConfig,
        requestedBackend: this.perf.rendererBackend,
        requestedBackendLabel: labelRendererBackend(this.perf.rendererBackend),
        requestedGpuPreference: this.perf.gpuPreference,
        requestedGpuPreferenceLabel: labelGpuPreference(this.perf.gpuPreference),
        workerRequested: !!this.perf.useWorker,
        workerActive: false,
        reloadRequired: this.perf.rendererBackend !== this.rendererConfig.appliedRendererBackend
          || this.perf.gpuPreference !== this.rendererConfig.appliedGpuPreference
          || !!this.perf.useWorker !== !!this.rendererConfig.workerActive,
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
    if (this.tileAssemblyShape === 'circle' && this.plinth) {
      this._syncCircularBoundarySpec();
      this._updatePlinth();
    }
    this.board.setLodDistanceScale(s.lodDistanceScale);
    this.board.cullingAggressiveness = s.cullingAggressiveness;
    this.board.setMergeOptions({
      enabled: s.terrainMerge,
      quadsPerChunk: s.terrainMergeQuads,
      mergeDistance: s.terrainMergeDistance,
      macroEnabled: s.terrainMacroProxy,
    });

    if (this.infiniteWorld) {
      this.infiniteWorld.setViewRadius(s.viewRadius);
      this.infiniteWorld.setMaxCreatesPerFrame(s.maxCreatesPerFrame);
      this.infiniteWorld.setLodSegments(segments);
      this.infiniteWorld.setLodDistances(distances);
      this.infiniteWorld.setWaterDistanceFactor(s.waterDistance);
      this.infiniteWorld.setTriangleBudget(s.triangleBudget);
      this.infiniteWorld.cullingAggressiveness = s.cullingAggressiveness;
      this.infiniteWorld.setMergeOptions({
        enabled: s.terrainMerge,
        quadsPerChunk: s.terrainMergeQuads,
        mergeDistance: s.terrainMergeDistance,
        allowRoot: s.terrainMacroProxy,
      });
    }

    if (this.planetWorld) {
      this.planetWorld.setLodSegments(segments);
      this.planetWorld.setTriangleBudget(s.triangleBudget);
      this.planetWorld.cullingAggressiveness = s.cullingAggressiveness;
      this.planetWorld.setMergeOptions({
        enabled: s.terrainMerge,
        quadsPerChunk: s.terrainMergeQuads,
        mergeDistance: s.terrainMergeDistance,
        macroEnabled: s.terrainMacroProxy,
      });
    }

    if (this.fogManager) {
      this.fogManager.setDistanceMultiplier(s.fogDistance);
      this.fogManager.updateFromViewDistance(s.viewRadius, this.params.chunkSize);
      if (this.proceduralSky) this._applyTimeOfDay();   // refresh fog color
    }

    this._applyCloudSettings();
  }

  _activeCloudLayer() {
    if (this.worldMode === 'planet') {
      return this.planetCloudLayer || this.planetCloudChunks;
    }
    if (this.worldMode === 'infinite') return this.infiniteCloud || null;
    return this.studioCloud || null;
  }

  _applyCloudAdaptiveQuality() {
    const controller = this._cloudAdaptive;
    if (!controller) return;
    for (const layer of [
      this.studioCloud,
      this.infiniteCloud,
      this.planetCloudLayer,
      this.planetCloudChunks,
    ]) {
      layer?.setAdaptiveQuality?.(
        controller.scaleMultiplier,
        controller.stepMultiplier,
      );
    }
    this._needsRender = true;
  }

  /** Water quality uniforms — per water material, never shared with terrain. */
  _targetTerrainVariant() {
    if (this.projectMode === 'manual' && !this._manualHasGeneratedBase()) return 'manual';
    const hybridManual = this.projectMode === 'manual' && this._manualHasGeneratedBase();
    const surfaceEnabled = this.projectMode === 'manual'
      || (this.params?.surfaceTextureMode === true
        && (this.params?.surfaceTextureAmount ?? 1) > 0.001);
    const detailEnabled = (this.perf?.terrainDetailQuality ?? 3) > 0
      && (this.perf?.terrainDetailOpacity ?? 1) > 0.001;
    if (hybridManual) return detailEnabled ? 'hybrid' : 'hybrid-surface';
    if (surfaceEnabled && detailEnabled) return 'full';
    if (surfaceEnabled) return 'surface';
    if (detailEnabled) return 'detail';
    return 'base';
  }

  async _ensureTerrainShaderVariantAsync(renderTarget = null) {
    if (this._disposed || this.worldMode === 'planet') return false;
    if (this._terrainVariantCompiling) return false;
    if (this._terrainSourcePendingToken != null) {
      this._scheduleTerrainVariantRetry(renderTarget, 100);
      return false;
    }
    const live = this.worldMode === 'infinite'
      ? this._infiniteTerrainMat
      : this.terrainMaterial;
    if (!live || live.userData?.minimalFragment) return false;
    const variant = this._targetTerrainVariant();
    if (live.userData?.terrainVariant === variant) return true;

    const token = (this._terrainVariantToken || 0) + 1;
    this._terrainVariantToken = token;
    const mode = this.worldMode;
    const liveAtStart = live;
    const oct = Math.round(this.params.octaves);
    const program = mode === 'studio'
      ? this._activeHeightProgram('studio')
      : this._stackGLSL;
    const programSig = program?.sig;
    const warm = createTerrainMaterial(
      this.uniforms,
      oct,
      program,
      { variant },
    );
    this._terrainVariantCompiling = true;
    this._bgWorkStart('terrain-variant', `Preparing ${variant} terrain shader…`);
    try {
      await yieldFrame();
      const targetSnapshot = this._resolveCameraCompileTarget();
      const exactRenderTarget = targetSnapshot.renderTarget;
      let result;
      if (mode === 'infinite') {
        const source = this.infiniteWorld?.batches?.meshes?.find(Boolean) ?? null;
        if (!source?.geometry) throw new Error('Infinite terrain instance geometry is unavailable');
        result = await this._compileInstancedMaterialVariant(
          warm, source.geometry, exactRenderTarget, { timeoutMs: 120000 },
        );
      } else {
        result = await this._compileMaterialVariants([warm], {
          canvasOnly: true,
          timeoutMs: 120000,
          renderTarget: exactRenderTarget,
        });
      }
      const currentLive = mode === 'infinite'
        ? this._infiniteTerrainMat
        : this.terrainMaterial;
      const currentProgram = mode === 'studio'
        ? this._activeHeightProgram('studio')
        : this._stackGLSL;
      const currentTarget = this._resolveCameraCompileTarget();
      const snapshotIsCurrent = this.worldMode === mode
        && currentLive === liveAtStart
        && this._sameCameraCompileTarget(targetSnapshot, currentTarget)
        && currentProgram?.sig === programSig
        && Math.round(this.params.octaves) === oct
        && this._targetTerrainVariant() === variant;
      if (result?.ready !== true || token !== this._terrainVariantToken
          || this._disposed || !snapshotIsCurrent) {
        if (result?.ready !== true && token === this._terrainVariantToken) {
          this._scheduleTerrainVariantRetry(renderTarget);
        } else if (!snapshotIsCurrent && token === this._terrainVariantToken) {
          this._scheduleTerrainVariantRetry(renderTarget, 0);
        }
        return false;
      }
      const target = mode === 'infinite'
        ? this._infiniteTerrainMat
        : this.terrainMaterial;
      if (!target || target.userData?.minimalFragment) return false;
      rebuildTerrainShaderSource(target, program, { variant });
      this._needsRender = true;
      this._terrainVariantRetryCount = 0;
      this._terrainVariantFailed = false;
      this._completeBootIfQualityReady();
      return true;
    } catch (error) {
      console.warn('Terrain shader variant compile failed', error);
      if (token === this._terrainVariantToken) this._scheduleTerrainVariantRetry(renderTarget);
      return false;
    } finally {
      this._terrainVariantCompiling = false;
      this._bgWorkEnd('terrain-variant');
      this._queueWarmMaterials([warm]);
    }
  }

  _scheduleTerrainVariantRetry(renderTarget = null, delayMs = 3000) {
    if (this._disposed || this._terrainVariantRetryTimer) return false;
    if (this._terrainVariantRetryCount >= 3) {
      this._terrainVariantFailed = true;
      return false;
    }
    this._terrainVariantRetryTimer = setTimeout(() => {
      this._terrainVariantRetryTimer = null;
      if (this._disposed) return;
      this._terrainVariantRetryCount++;
      void this._ensureTerrainShaderVariantAsync(renderTarget);
    }, delayMs);
    return true;
  }

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
    u.uTerrainDetailOpacity.value = s.terrainDetailOpacity ?? 1.0;
    u.uTerrainMicroDetail.value = s.terrainMicroDetail ?? 0.6;
    u.uTerrainMacroVariation.value = s.terrainMacroVariation ?? 0.5;
    this._needsRender = true;
    if (!this._bootPending) void this._ensureTerrainShaderVariantAsync();
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
   * Automatic performance mode. Volumetric clouds spend the first degradation
   * budget on their dedicated target; scene resolution moves only after that
   * target reaches its floor.
   */
  _autoPerfTick(now) {
    if (!this.perf.autoPerf || now - this._autoCheckAt < 2000) return;
    this._autoCheckAt = now;
    if (this._fps <= 0) return;

    const cloudLayer = this._activeCloudLayer();
    const cloudAdaptiveActive = !!(
      this.params.cloudsEnabled
      && cloudLayer?.active
      && cloudLayer?.setAdaptiveQuality
      // The experimental chunk renderer has no low-res composite path.
      && cloudLayer !== this.planetCloudChunks
    );
    const presetCloudScale = this.perf.cloudRenderScale ?? 1;
    const cloudResult = this._cloudAdaptive.update({
      now,
      fps: this._fps,
      presetScale: presetCloudScale,
      active: cloudAdaptiveActive,
      blocked: this._bootPending || this._compiling > 0
        || (typeof document !== 'undefined' && document.hidden),
    });
    if (cloudResult.changed) this._applyCloudAdaptiveQuality();

    if (this._fps < 42 && this._autoScale > 0.55) {
      if (cloudAdaptiveActive && !cloudResult.atScaleFloor) return;
      this._autoScale = Math.max(0.55, this._autoScale - 0.1);
      this._applyPixelRatio();
    } else if (this._fps > 70 && this._autoScale < 1.0) {
      this._autoScale = Math.min(1.0, this._autoScale + 0.05);
      this._applyPixelRatio();
    }

    // Resolution is already at the floor and a real (rendered) frame is still
    // slow → the PRESET itself is too heavy for this GPU. Step it down one notch
    // and hand the lighter preset a fresh full-res budget. Uses per-rendered-
    // frame CPU time (profiler.frame.avg) rather than the frame COUNT, so the
    // on-demand studio idle (which legitimately stops drawing) never triggers a
    // spurious downgrade. ~45ms ≈ sub-22fps while actually working.
    const frameMs = this.profiler?.frame?.avg || 0;
    if (this._autoScale <= 0.56 && frameMs > 45
        && (!cloudAdaptiveActive || cloudResult.atScaleFloor)) {
      const lighter = this._lighterPreset(this.perf.preset);
      if (lighter) {
        this.cb.onToast?.(`Auto performance: GPU struggling — lowering quality to ${lighter}`);
        this.setPerfPreset(lighter);
        this._autoScale = 1.0;
        this._applyPixelRatio();
      }
    }
  }

  /** Next lighter performance preset, or null if already at the lightest.
   *  Custom / unknown presets jump straight to the safest tier. */
  _lighterPreset(key) {
    const order = ['ultra', 'high', 'balanced', 'performance'];
    const i = order.indexOf(key);
    if (i === -1) return 'performance';
    return i < order.length - 1 ? order[i + 1] : null;
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

  _tickDayNightCycle(dt, now = performance.now()) {
    const p = this.params;
    if (!p.skyboxDayNightCycle || !this._skyActive()) return;
    const speed = Math.max(0, p.skyboxCycleSpeed ?? 1);
    if (speed <= 0) return;
    // speed 1 = one full day/night cycle in roughly two minutes.
    this.timeOfDay = (this.timeOfDay + dt * speed / 120) % 1;
    this._applyTimeOfDay();
    if (this.cb.onTimeOfDayChange && now - this._lastTimeOfDayEmit > 160) {
      this._lastTimeOfDayEmit = now;
      this.cb.onTimeOfDayChange(this.timeOfDay);
    }
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
    if (this.planetWorld) {
      // Planet's equivalent of behind-camera culling is the horizon (back-of-
      // planet) test. It was never wired to this toggle, so the control did
      // nothing in planet mode.
      this.planetWorld.horizonCulling = enabled;
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

  _resolveCloudLighting(tod = null) {
    const u = this.uniforms || {};
    const toRgb = (value, fallback) => {
      if (value?.toArray) return value.toArray([]).slice(0, 3);
      if (Array.isArray(value)) return value.slice(0, 3);
      return fallback;
    };
    const skyActive = this._skyActive();
    const evaluated = skyActive ? (tod || evaluateTimeOfDay(this.timeOfDay)) : null;

    return resolveCloudLightingState({
      proceduralSkyActive: skyActive,
      timeOfDay: evaluated,
      params: this.params,
      sunDirection: u.uSunDir?.value,
      terrainSunColor: toRgb(u.uTerrainSunCol?.value, [1.0, 0.94, 0.82]),
      terrainSunIntensity: u.uTerrainSunIntensity?.value ?? 1.25,
      terrainSkyAmbient: toRgb(u.uTerrainSkyAmb?.value, [0.36, 0.46, 0.62]),
      terrainGroundBounce: toRgb(u.uTerrainBounce?.value, [0.20, 0.16, 0.11]),
    });
  }

  _syncCloudLighting(tod = null) {
    const state = this._resolveCloudLighting(tod);
    this.studioCloud?.setLighting(state);
    this.infiniteCloud?.setLighting(state);
    this.planetCloudLayer?.setLighting(state);
    this.planetCloudChunks?.setLighting(state);
    this._syncTerrainLighting(state, tod);
    this._syncTerrainCloudShadows();
    this._needsRender = true;
  }

  _syncTerrainLighting(state = null, tod = null) {
    if (!this._skyActive() || !this.uniforms) return;
    const lighting = state || this._resolveCloudLighting(tod);
    const evaluated = tod || evaluateTimeOfDay(this.timeOfDay);
    const u = this.uniforms;

    // Terrain shaders keep direct color/intensity separate, while the resolved
    // cloud state already contains physical ambient radiance. Convert the
    // latter back through the terrain shader's historical 0.5 / 0.25 scales.
    u.uTerrainSunCol.value.set(
      evaluated.sunColor[0],
      evaluated.sunColor[1],
      evaluated.sunColor[2]
    );
    u.uTerrainSunIntensity.value = Math.max(0, evaluated.lightIntensity);

    const top = lighting.ambientTopColor;
    const bottom = lighting.ambientBottomColor;
    u.uTerrainSkyAmb.value.set(
      (top[0] * 0.7 + bottom[0] * 0.3) * 2.0,
      (top[1] * 0.7 + bottom[1] * 0.3) * 2.0,
      (top[2] * 0.7 + bottom[2] * 0.3) * 2.0
    );
    u.uTerrainBounce.value.set(
      lighting.groundBounceColor[0] * 4.0,
      lighting.groundBounceColor[1] * 4.0,
      lighting.groundBounceColor[2] * 4.0
    );
  }

  _syncTerrainCloudShadows() {
    const u = this.uniforms;
    if (!u?.uTerrainCloudShadowEnabled) return;
    const state = this.studioCloud?.getTerrainShadowState?.();
    const enabled = this.worldMode === 'studio'
      && this.params.cloudsEnabled
      && this.params.cloudShadowsEnabled
      && !!state;

    u.uTerrainCloudShadowEnabled.value = enabled ? 1.0 : 0.0;
    u.uTerrainCloudShadowStrength.value = Math.min(
      0.85,
      Math.max(0, this.params.cloudShadowOpacity ?? 0.45)
    );
    if (state) {
      u.uTerrainCloudShadowCenter.value.copy(state.center);
      u.uTerrainCloudShadowExtent.value = state.extent;
      u.uTerrainCloudShadowAltitude.value = state.altitude;
      u.uTerrainCloudShadowScale.value = state.scale;
      u.uTerrainCloudShadowCoverage.value = state.coverage;
      u.uTerrainCloudShadowSoftness.value = state.softness;
      u.uTerrainCloudShadowWind.value.copy(state.wind);
      u.uTerrainCloudShadowTime.value = state.time;
      u.uTerrainCloudShadowRotation.value = state.rotation;
      u.uTerrainCloudShadowEvolve.value = state.evolve;
    }
  }

  /**
   * Sync the skybox appearance params + dome visibility for the current mode.
   * Pure uniform/visibility updates — never rebuilds or recompiles.
   */
  _applySkyboxSettings() {
    if (!this.proceduralSky) {
      this.proceduralSky = new ProceduralSky(this.scene);
    }
    this.proceduralSky.applyParams(this.params);
    this.proceduralSky.setVisible(this._skyActive());
    this._syncCloudLighting();
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
    this._syncCloudLighting(tod);
    this._needsRender = true;
  }

  // ------------------------------------------------------------- save/load

  createProjectPayload() {
    this._syncPlanetStyleToParams();
    // A project save represents what the editor controls currently show. When
    // Auto Update is off, terrain-field edits deliberately remain staged until
    // the user applies them; folding that staging layer into the document keeps
    // those visible settings from reverting after a save/reload.
    let projectNoiseStack = this._pendingNoiseStack ?? this.params.noiseStack;
    for (const [key, value] of Object.entries(this._pendingTerrainParams || {})) {
      const transformed = this._stackWithCompatParam(
        projectNoiseStack,
        key,
        value,
      );
      if (transformed.updated) projectNoiseStack = transformed.stack;
    }
    const projectParams = {
      ...this.params,
      ...this._pendingTerrainParams,
      noiseStack: projectNoiseStack,
    };
    const paintOpacity = Number(this.paintMode?.state?.layerOpacity);
    const data = {
      app: 'terrain-studio',
      version: 2,
      savedAt: new Date().toISOString(),
      params: structuredClone(projectParams),
      tiles: this.tiles.map((t) => ({ ...t })),
      tileAssemblyShape: this.tileAssemblyShape,
      diskRadiusCells: this.circleRadiusCells,
      creatorTools: this._serializeCreatorTools(),
      historyMetadata: this.projectHistory?.serializeMetadata?.(),
      editorMode: this.projectMode,
      ...(this.workspacePreset ? { workspacePreset: this.workspacePreset } : {}),
      generationSource: this.generationSource,
      worldMode: this.worldMode,
      graph: this.terrainGraph ? structuredClone(this.terrainGraph) : null,
      graphView: { ...this.graphView },
      timeOfDay: Number.isFinite(Number(this.timeOfDay))
        ? Math.max(0, Math.min(1, Number(this.timeOfDay)))
        : DEFAULT_TIME_OF_DAY,
      paintState: {
        baseMode: this.paintMode?.state?.baseMode === 'flat' ? 'flat' : 'generated',
        layerOpacity: Number.isFinite(paintOpacity)
          ? Math.max(0, Math.min(1, paintOpacity))
          : 1,
      },
    };
    if (this.projectMode === 'manual') data.manualTerrain = this.manualTerrain?.serialize() ?? { version: 5, baseSource: 'flat', shapes: [], sculpt: null, surfacePaint: null };
    const realWorldSource = normalizeRealWorldSource(this.realWorldSource);
    if (realWorldSource) data.realWorldSource = realWorldSource;
    // Only embed paint pixel data when something was actually painted —
    // serialize() returns null for an untouched canvas, which would otherwise
    // bloat the file with ~3M neutral values.
    const paint = this.paintMode?.serialize();
    if (paint) data.paint = paint;
    const erosion = this.erosionField?.serialize({ jsonSafe: true });
    if (erosion) data.erosion = erosion;
    return data;
  }

  saveSeed() {
    const data = this.createProjectPayload();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    this._download(URL.createObjectURL(blob), `terrain-seed-${data.params.seed}.json`);
    this.cb.onToast('Seed saved as JSON');
  }

  loadSeedJSON(json, { silent = false, onRealWorldProgress } = {}) {
    const src = json?.params && typeof json.params === 'object' ? json.params : json;
    if (!src || typeof src !== 'object' || !('seed' in src)) {
      this.cb.onToast('Not a valid terrain seed file');
      return Promise.reject(new Error('Invalid terrain seed'));
    }
    const rollbackState = {
      ...this.serializeState(),
      paint: this.serializePaint(),
      erosion: this.serializeErosion(),
      manualSculpt: this.serializeManualSculpt(),
      manualSurface: this.serializeManualSurface(),
    };
    // Freeze bake publication while the desired params, authored fields and
    // generated shader source are installed as one transaction.
    this._terrainSourcePendingToken = 'project-load';
    if (!silent) this.projectHistory?.createSnapshot('Before loading project', { automatic: true });
    const realWorldSource = normalizeRealWorldSource(json?.realWorldSource);
    const next = { ...DEFAULT_PARAMS };
    for (const key of Object.keys(DEFAULT_PARAMS)) {
      if (key in src && typeof src[key] === typeof DEFAULT_PARAMS[key]) next[key] = src[key];
    }
    const migratedTerrainParams = migrateTerrainFormationParams(next, src);
    if (!('waterMode' in src)) {
      if (next.seaLevel <= 0.5) {
        next.waterMode = 'off';
        next.waterEnabled = false;
      } else {
        next.waterMode = 'legacy';
        next.waterEnabled = true;
      }
    }
    this._clearPendingTerrainParams();
    this.params = normalizeCloudFormation(normalizeSurfaceTextureParams(
      migratedTerrainParams,
      src,
    ));
    this.noiseStack = migrateStack(src.noiseStack);
    this.params.noiseStack = this.noiseStack;
    this._stackGLSL = generateStackGLSL(this.noiseStack);
    this._stackSig = this._stackGLSL.sig;
    this.projectMode = json?.editorMode === 'nodes'
      ? 'nodes'
      : json?.editorMode === 'manual'
        ? 'manual'
        : json?.editorMode === 'procedural'
          ? 'procedural'
          : json?.generationSource === 'graph' ? 'nodes' : 'procedural';
    const manualDocument = this.projectMode === 'manual'
      ? normalizeManualTerrainDocument(json?.manualTerrain)
      : null;
    this.workspacePreset = json?.workspacePreset === 'real-terrain' ? 'real-terrain' : null;
    if (this.projectMode === 'manual' && manualDocument.baseSource === 'flat') {
      this.params.surfaceTextureSource = SURFACE_TEXTURE_SOURCE.BUILT_IN;
      this.params.surfaceTextureMode = true;
      this.params.surfaceTexturePaletteInfluence = 0;
      this.params.surfaceTextureBreakup = 0;
    }
    this.terrainGraph = this.projectMode === 'nodes' || manualDocument?.baseSource === 'nodes'
      ? (json?.graph ? migrateGraphDocument(json.graph, this.noiseStack) : createBlankGraph())
      : null;
    this.graphView = { ...this.graphView, ...(json?.graphView || {}) };
    this.generationSource = this._generationSourceForProject(manualDocument);
    const compiled = this.terrainGraph ? compileTerrainGraph(this.terrainGraph) : null;
    this._graphProgram = compiled?.ok ? compiled.program : null;
    this._graphDiagnostics = compiled?.diagnostics || [];
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
    this.paintMode?.setEnabled(false);
    // Project documents omit paint data when no stroke exists. Clear the
    // previous project's textures first so an unpainted project cannot inherit
    // height/biome masks from the project that was open before it.
    this.paintMode?.clear({ silent: true });
    const savedPaintBase = json?.paintState?.baseMode === 'flat'
      ? 'flat'
      : 'generated';
    this.paintMode?.setBaseMode(
      this.projectMode === 'manual' && manualDocument.baseSource === 'flat' ? 'flat' : savedPaintBase,
    );
    const savedPaintOpacity = Number(json?.paintState?.layerOpacity);
    this.paintMode?.setState({
      layerOpacity: Number.isFinite(savedPaintOpacity)
        ? Math.max(0, Math.min(1, savedPaintOpacity))
        : 1,
    });
    if (json?.paint) this.paintMode?.load(json.paint);
    this.manualTerrain?.setEnabled(false);
    this.manualTerrain?.load(this.projectMode === 'manual' ? manualDocument : null, { emit: false });
    this.manualTerrain?.setEnabled(this.projectMode === 'manual', { silent: true });
    this._bindAuthoringMaskTextures();
    // Install all authored height sources before invalidating and starting the
    // replacement bake; consumers never see a bake from the previous project.
    this.splineManager?.load(json?.creatorTools?.splines ?? json?.splines ?? []);
    this.terrainAnalysis?.load(json?.creatorTools?.analysis);
    if (this.erosionField) {
      if (json?.erosion) this.erosionField.restore(json.erosion);
      else this.erosionField.clear();
      this.erosionField.setEnabled(this.params.erosionEnabled === true);
      this.erosionField.applyTo(this.uniforms);
    }
    this.setTimeOfDay(
      Number.isFinite(Number(json?.timeOfDay))
        ? Number(json.timeOfDay)
        : DEFAULT_TIME_OF_DAY,
    );
    this.cb.onParams({ ...this.params });
    this.cb.onProjectMode?.(this.projectMode);
    this.cb.onGenerationSource?.(this.generationSource);
    this.cb.onTerrainGraph?.(this.terrainGraph ? structuredClone(this.terrainGraph) : null);
    this.cb.onGraphState?.({ valid: !!this._graphProgram || this.generationSource === 'classic', compiling: false, diagnostics: structuredClone(this._graphDiagnostics), slotCount: this._graphProgram?.slotCount || 0, colorSlotCount: this._graphProgram?.colorSlotCount || 0 });
    this.cb.onGraphView?.({ ...this.graphView });
    this.applyAll({
      force: true,
      terrainDirty: this.worldMode === 'planet',
    });
    if (this.params.waterEnabled !== false && this._waterDeferred) {
      void this._warmDeferredWater();
    }
    const ready = this.worldMode === 'planet'
      ? this._rebuildPlanetStackMaterialsAsync(this._stackGLSL, {
        label: 'Loading terrain',
        atomic: true,
        rebuildGeometry: true,
      })
      : this.rebuildActiveHeightProgram({
        label: 'Loading terrain',
        atomic: true,
        terrainDirtyOnSwap: true,
      });
    const loadedSeed = this.params.seed;
    const c = this._unionCenter();
    this.controls.goalTarget.set(c.x, 0, c.z);
    this._notifyTiles();
    return ready.then(async (result) => {
      if (result?.error) throw result.error;
      // Imported pixels are not embedded in project documents. Keep the
      // current project's textures intact until the replacement source has
      // compiled successfully, then clear/refetch behind the blocking overlay.
      // A failed load can therefore roll back without losing its maps.
      this._clearImportedMaps();
      if (realWorldSource) {
        this.realWorldSource = realWorldSource;
        this.realWorldBuildingsVisible = realWorldSource.buildingsVisible === true;
        this.realWorldImageryStyle = realWorldSource.imageryStyle;
        this.cb.onRealWorldImageryStyle?.(realWorldSource.imageryStyle);
        this.cb.onRealWorldBuildingsVisible?.(this.realWorldBuildingsVisible);
      }
      if (realWorldSource) {
        await this._restoreRealWorldSource(realWorldSource, { onProgress: onRealWorldProgress });
      }
      await this.waitForTerrainReady();
      if (!silent) this.cb.onToast(`Loaded seed ${loadedSeed}`);
      return result;
    }).catch(async (error) => {
      try {
        await this.restoreState(rollbackState, { rollbackOnError: false });
      } catch (rollbackError) {
        console.warn('Project load rollback failed', rollbackError);
      }
      throw error;
    });
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
      pendingTerrainParams: JSON.parse(JSON.stringify(
        this._pendingTerrainParams || {},
      )),
      pendingNoiseStack: this._pendingNoiseStack
        ? structuredClone(this._pendingNoiseStack)
        : null,
      pendingNoiseSolo: this._pendingNoiseSolo,
      perf: { ...this.perf },
      timeOfDay: this.timeOfDay,
      worldMode: this.worldMode,
      tileDebug: { ...this.tileDebug },
      debug: { ...this._debug },
      cullingEnabled: this.board?.cullingEnabled !== false,
      behindCameraCulling: this.board?.behindCameraCulling !== false,
      paintRev: this.paintMode?.layers?.revision ?? 0,
      paintBaseMode: this.paintMode?.state?.baseMode ?? 'generated',
      paintLayerOpacity: this.paintMode?.state?.layerOpacity ?? 1,
      erosionRev: this.erosionField?.revision ?? 0,
      tiles: this.tiles.map((t) => ({ ...t })),
      tileAssemblyShape: this.tileAssemblyShape,
      diskRadiusCells: this.circleRadiusCells,
      creatorTools: this._serializeCreatorTools(),
      projectMode: this.projectMode,
      generationSource: this.generationSource,
      terrainGraph: this.terrainGraph ? structuredClone(this.terrainGraph) : null,
      graphView: { ...this.graphView },
      manualTerrain: this.manualTerrain?.serialize({ includeSculpt: false, includeSurface: false }) ?? { version: 5, baseSource: 'flat', shapes: [] },
      manualSculptRev: this.manualTerrain?.field?.sculptRevision ?? 0,
      manualSurfaceRev: this.manualTerrain?.surfaceField?.revision ?? 0,
    };
  }

  /** Heavy paint-layer blob (height/biome/props pixel arrays) for undo history. */
  serializePaint() {
    return this.paintMode?.serialize() ?? null;
  }

  /** Heavy erosion blob (baked delta grid + masks) for undo history. */
  serializeErosion() {
    return this.erosionField?.serialize() ?? null;
  }

  /** Heavy Manual Sculpt delta blob, deduplicated by sculpt revision in App history. */
  serializeManualSculpt() {
    return this.manualTerrain?.serializeSculpt() ?? null;
  }

  /** Heavy Manual Texture Paint weight maps, deduplicated by revision in App history. */
  serializeManualSurface() {
    return this.manualTerrain?.serializeSurfacePaint() ?? null;
  }

  /**
   * Restore a snapshot produced by serializeState(). The caller is responsible
   * for switching world mode first when snap.worldMode differs (that path is
   * heavy + async and already wrapped in a loading overlay by the App). This
   * re-applies all params, planet style, performance, noise stack, debug
   * toggles and paint, then fires the React mirror callbacks so the panels
   * reflect the restored values.
   */
  async restoreState(snap, { rollbackOnError = true } = {}) {
    if (!snap || !snap.params) return { swapped: false };
    const rollbackState = rollbackOnError
      ? {
        ...this.serializeState(),
        paint: this.serializePaint(),
        erosion: this.serializeErosion(),
        manualSculpt: this.serializeManualSculpt(),
        manualSurface: this.serializeManualSurface(),
      }
      : null;
    try {
    this._terrainSourcePendingToken = 'history-restore';

    // params: full replacement, but keep any newer default keys the snapshot
    // predates so we never end up with undefined settings.
    this._clearPendingTerrainParams();
    this.params = normalizeCloudFormation(
      normalizeSurfaceTextureParams(
        migrateTerrainFormationParams(
          { ...DEFAULT_PARAMS, ...snap.params },
          snap.params,
        ),
        snap.params,
      ),
    );

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
    if (snap.debug) {
      const wantFreeCam = !!snap.debug.freeCamNoClip;
      if (this._debug.freeCamNoClip && !wantFreeCam) this._setDebugFreeCam(false);
      this._debug = { ...this._debug, ...snap.debug, freeCamNoClip: false };
      if (wantFreeCam) this._setDebugFreeCam(true);
    }
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
    this.applyAll({ force: true, terrainDirty: false });
    const uc = this._unionCenter();
    this.controls.goalTarget.set(uc.x, 0, uc.z);
    this._notifyTiles();
    this._applyPerformance();
    this._notifyPerf();

    // Install the desired stack model without publishing it to live samplers or
    // materials yet. One transaction at the end warms and commits the matching
    // GPU/CPU source after every authored height field has also been restored.
    this.noiseStack = migrateStack(snap.params.noiseStack);
    this.params.noiseStack = this.noiseStack;
    this._stackGLSL = generateStackGLSL(this.noiseStack);
    this._stackSig = this._stackGLSL.sig;
    const restoredProjectMode = snap.projectMode === 'nodes'
      ? 'nodes'
      : snap.projectMode === 'manual'
        ? 'manual'
        : snap.projectMode === 'procedural'
          ? 'procedural'
          : snap.generationSource === 'graph' ? 'nodes' : 'procedural';
    const restoredManualDocument = restoredProjectMode === 'manual'
      ? normalizeManualTerrainDocument(snap.manualTerrain)
      : null;
    this.terrainGraph = (restoredProjectMode === 'nodes' || restoredManualDocument?.baseSource === 'nodes')
      && snap.terrainGraph
      ? migrateGraphDocument(snap.terrainGraph, this.noiseStack)
      : null;
    this.graphView = { ...this.graphView, ...(snap.graphView || {}) };
    if (this.terrainGraph) {
      const compiled = compileTerrainGraph(this.terrainGraph);
      this._graphProgram = compiled.ok ? compiled.program : this._graphProgram;
      this._graphDiagnostics = compiled.diagnostics || [];
    }
    this.projectMode = restoredProjectMode;
    this.generationSource = this._generationSourceForProject(restoredManualDocument);
    this.cb.onTerrainGraph?.(this.terrainGraph ? structuredClone(this.terrainGraph) : null);
    this.cb.onProjectMode?.(this.projectMode);
    this.cb.onGenerationSource?.(this.generationSource);
    this.cb.onGraphState?.({ valid: this._graphDiagnostics.length === 0, compiling: false, diagnostics: structuredClone(this._graphDiagnostics), slotCount: this._graphProgram?.slotCount || 0, colorSlotCount: this._graphProgram?.colorSlotCount || 0 });
    // global culling toggles live on the board / world objects, not in params.
    this.setCullingEnabled(snap.cullingEnabled !== false);
    this.setBehindCameraCulling(snap.behindCameraCulling !== false);

    // re-derive the tile-debug view uniform + notify the Debug panel.
    this.setTileDebug({});
    this.setDebugFlag('terrainDetailDebug', this._debug.terrainDetailDebug ?? 'off');
    this.board.setMergeDebug(this._debug.mergeDebug);

    // time of day (fires onTimeOfDayChange → React sync).
    this.setTimeOfDay(snap.timeOfDay ?? this.timeOfDay);

    // paint layers (board-local height/biome/props overrides). The App injects
    // the heavy blob into snap.paint before calling; a null blob means the
    // restored state had no paint, so wipe the live layers (silent — no toast).
    if (this.paintMode) {
      if (snap.paint) this.paintMode.load(snap.paint);
      else this.paintMode.layers.clear();
      this.paintMode.setBaseMode(
        this.projectMode === 'manual' && restoredManualDocument.baseSource === 'flat'
          ? 'flat'
          : (snap.paintBaseMode ?? 'generated'),
      );
      this.paintMode.setState({
        layerOpacity: Number.isFinite(Number(snap.paintLayerOpacity))
          ? Math.max(0, Math.min(1, Number(snap.paintLayerOpacity)))
          : 1,
      });
    }
    this.manualTerrain?.setEnabled(false);
    this.manualTerrain?.load(this.projectMode === 'manual'
      ? { ...restoredManualDocument, sculpt: snap.manualSculpt ?? null, surfacePaint: snap.manualSurface ?? null }
      : null, { emit: false });
    this.manualTerrain?.setEnabled(this.projectMode === 'manual', { silent: true });
    this._bindAuthoringMaskTextures();

    // Creator sources are serialised, not their generated render targets. A
    // restore therefore re-bakes deterministic masks against the restored map.
    this.splineManager?.load(snap.creatorTools?.splines ?? snap.splines ?? []);
    this.terrainAnalysis?.load(snap.creatorTools?.analysis);

    // erosion offset field (baked delta + masks). The App injects the heavy
    // blob into snap.erosion before calling, mirroring the paint path; a null
    // blob means the restored state had no bake, so drop the live field. The
    // live before/after toggle comes from the restored params.erosionEnabled.
    if (this.erosionField) {
      if (snap.erosion) this.erosionField.restore(snap.erosion);
      else this.erosionField.clear();
      this.erosionField.setEnabled(this.params.erosionEnabled === true);
      this.erosionField.applyTo(this.uniforms);
    }

    this._pendingTerrainParams = { ...(snap.pendingTerrainParams || {}) };
    this._pendingNoiseStack = snap.pendingNoiseStack
      ? migrateStack(snap.pendingNoiseStack)
      : null;
    this._pendingNoiseSolo = snap.pendingNoiseSolo ?? null;
    this.cb.onParams(this._paramsSnapshot());
    this._needsRender = true;
    let result;
    if (this.worldMode === 'planet') {
      result = await this._rebuildPlanetStackMaterialsAsync(this._stackGLSL, {
        label: 'Restoring terrain',
        atomic: true,
        rebuildGeometry: true,
      });
      if (result?.error) throw result.error;
      await this.waitForTerrainReady();
    } else {
      result = await this._rebuildStackMaterialsAsync(
        this._activeHeightProgram(),
        {
          label: 'Restoring terrain',
          atomic: true,
          terrainDirtyOnSwap: true,
        },
      );
      if (result?.error) throw result.error;
      await this.waitForTerrainReady();
    }
    return result;
    } catch (error) {
      if (rollbackState) {
        try {
          await this.restoreState(rollbackState, { rollbackOnError: false });
        } catch (rollbackError) {
          console.warn('History restore rollback failed', rollbackError);
        }
      }
      throw error;
    }
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
    this.cb.onParams(this._paramsSnapshot());
    this._afterParamChange(false);
    this.cb.onToast(`Water preset: ${presetKey}`);
  }

  resetWaterSettings() {
    this.params = resetWaterParams(this.params);
    for (const key of ['deep', 'shallow', 'foam']) {
      this.planetStyle.setPaletteColor(key, [...EARTH_PALETTE[key]]);
    }
    this._syncPlanetStyleToParams();
    this.cb.onParams(this._paramsSnapshot());
    this._afterParamChange(false);
    this.cb.onToast('Water settings reset');
  }

  resetPanelSettings(panelId) {
    const toast = (msg) => this.cb.onToast(msg);
    switch (panelId) {
      case 'terrain': {
        this._clearPendingTerrainParams();
        const keepSeed = this.params.seed;
        this.params = patchParamsFromDefaults(this.params, [...TERRAIN_RESET_KEYS, ...EROSION_RESET_KEYS]);
        this.params.seed = keepSeed;
        this.params.preset = 'highlands';
        this.params.terrainFormationSeaLevel = this.params.seaLevel;
        const { params: noisePatch } = this.planetStyle.applyNoisePreset('default');
        this.params.noisePreset = 'default';
        for (const [k, v] of Object.entries(noisePatch)) this.params[k] = v;
        this._syncPlanetStyleToParams();
        // Erosion is part of the Terrain panel — drop the baked delta too so it
        // can't linger over the reset (default-size) terrain.
        this.erosionField?.clear();
        this.erosionField?.applyTo(this.uniforms);
        this.cb.onParams(this._paramsSnapshot());
        this._afterParamChange(true, true);
        this._onErosionChanged();
        toast('Terrain settings reset');
        break;
      }
      case 'noiseLayers':
        this.setNoiseStack(defaultLegacyStack());
        toast('Noise layers reset');
        break;
      case 'biomes': {
        this._clearPendingTerrainParams(BIOME_RESET_KEYS);
        this.params = patchParamsFromDefaults(this.params, BIOME_RESET_KEYS);
        this.cb.onParams(this._paramsSnapshot());
        this._afterParamChange(false, true);
        toast('Biome settings reset');
        break;
      }
      case 'water':
        this.resetWaterSettings();
        break;
      case 'props': {
        this.params = patchParamsFromDefaults(this.params, PROPS_RESET_KEYS);
        this.cb.onParams(this._paramsSnapshot());
        this._afterParamChange(false);
        toast('Props settings reset');
        break;
      }
      case 'clouds': {
        this.params = resetCloudParams(this.params);
        this.cb.onParams(this._paramsSnapshot());
        this._afterParamChange(false);
        toast('Cloud settings reset');
        break;
      }
      case 'skybox': {
        this.params = resetSkyboxParams(this.params);
        this.setTimeOfDay(DEFAULT_TIME_OF_DAY);
        this.cb.onParams(this._paramsSnapshot());
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
        this.cb.onParams(this._paramsSnapshot());
        this._afterParamChange(false);
        toast('Lighting settings reset');
        break;
      }
      case 'visuals': {
        this.params = resetVisualParams(this.params);
        this.cb.onParams(this._paramsSnapshot());
        this._afterParamChange(false);
        toast('Visual settings reset');
        break;
      }
      case 'planet':
        this.applyPlanetPresetByKey('earth');
        toast('Planet style reset');
        break;
      case 'world': {
        this._clearPendingTerrainParams(WORLD_RESET_KEYS);
        this.params = patchParamsFromDefaults(this.params, WORLD_RESET_KEYS);
        this.cb.onParams(this._paramsSnapshot());
        this._afterParamChange(true, true);
        toast('World settings reset');
        break;
      }
      case 'performance':
        this.resetPerfSettings();
        break;
      case 'debug': {
        // Debug defaults include Auto Update=true; discard any staged terrain
        // values so they cannot remain hidden behind an enabled toggle.
        this._clearPendingTerrainParams();
        this.params = patchParamsFromDefaults(this.params, DEBUG_PARAM_KEYS);
        if (this._debug.freeCamNoClip) this._setDebugFreeCam(false);
        this._debug = { ...DEFAULT_DEBUG_FLAGS };
        this.uniforms.uTerrainDetailDebug.value = 0.0;
        this.board.setMergeDebug(this._debug.mergeDebug);
        this.cb.onParams(this._paramsSnapshot());
        this._afterParamChange(false);
        if (this.cb.onDebugReset) this.cb.onDebugReset();
        toast('Debug settings reset');
        break;
      }
      default:
        break;
    }
  }

  async exportWaterMasks(options) {
    const files = await this.waterSystem.exportMasks(options);
    const names = Object.keys(files);
    if (!names.length) { this.cb.onToast('No water masks exported'); return; }
    const { zipSync } = await import('fflate');
    const zipped = zipSync(files);
    this._download(URL.createObjectURL(new Blob([zipped])), `water_masks-${this.params.seed}.zip`);
    this.cb.onToast(`Exported water masks (${names.length} file${names.length > 1 ? 's' : ''})`);
  }

  applyWaterBaselineScene(sceneId) {
    const scene = getWaterBaselineScene(sceneId);
    if (!scene) throw new Error(`Unknown water baseline scene: ${sceneId}`);
    if (scene.worldMode !== this.worldMode) {
      throw new Error(`Water baseline "${sceneId}" requires ${scene.worldMode} mode`);
    }
    if (this.generationSource !== 'classic') {
      throw new Error('Water baselines require the Procedural terrain editor');
    }

    // Baselines deliberately use the classic deterministic field. Keeping the
    // seed, terrain preset and water preset fixed makes captures comparable
    // across shader revisions and across machines.
    this._clearPendingTerrainParams();
    this.params = applyPreset(this.params, scene.terrainPreset);
    this.params = this.waterSystem.applyPreset(scene.waterPreset);
    this.params = waterBaselineParams(scene, this.params);
    this.params.autoUpdate = true;
    this.setNoiseStack(migrateStack(undefined));

    this._markTerrainFieldDirty();
    this._activeWaterBaseline = scene.value;
    this.profiler.setMetric('waterBaselineScene', scene.value);
    this.cb.onParams(this._paramsSnapshot());
    this.setTimeOfDay(scene.timeOfDay);
    this.applyAll({ force: true });
    this._applyWaterBaselineCamera(scene);
    this._needsRender = true;
    this.cb.onToast(`Water baseline loaded: ${scene.label}`);
    return scene;
  }

  _applyWaterBaselineCamera(scene) {
    const resolved = resolveWaterBaselineCamera(scene, {
      seaLevel: this.params.seaLevel,
      boardSize: this.boardSize,
    });
    if (!resolved) return;

    if (resolved.kind === 'first-person') {
      this.camera.position.fromArray(resolved.position);
      if (this.fpsControls) {
        this.fpsControls.yaw = resolved.yaw;
        this.fpsControls.pitch = resolved.pitch;
        this.fpsControls.update(0);
      }
      this.camera.updateMatrixWorld(true);
      return;
    }

    const controls = this.controls;
    if (!controls) return;
    controls.mode = 'orbit';
    controls.target.fromArray(resolved.target);
    controls.goalTarget.copy(controls.target);
    controls.radius = resolved.radius;
    controls.goalRadius = resolved.radius;
    controls.phi = resolved.phi;
    controls.goalPhi = resolved.phi;
    controls.theta = resolved.theta;
    controls.goalTheta = resolved.theta;
    controls._smoothRate = null;
    controls.update(0);
    this.camera.updateMatrixWorld(true);
  }

  async captureWaterBaseline(sceneId = this._activeWaterBaseline) {
    const scene = getWaterBaselineScene(sceneId);
    if (!scene) throw new Error('Load a water baseline scene before capturing');
    if (this._activeWaterBaseline !== sceneId) {
      throw new Error(`Load "${scene.label}" before capturing it`);
    }
    if (scene.worldMode !== this.worldMode) {
      throw new Error(`Water baseline "${sceneId}" requires ${scene.worldMode} mode`);
    }

    this.cb.onStatus('Capturing water baseline…', true);
    const profilerWasActive = this.profiler.active;
    this.profiler.setActive(true);
    try {
      const ready = await this._waitForWaterBaselineReady();
      if (!ready) throw new Error('Water baseline did not become ready before capture');
      // Give asynchronous GPU timing queries enough rendered frames to resolve.
      for (let frame = 0; frame < 12; frame++) {
        this._needsRender = true;
        await yieldFrame();
      }

      const captureStats = this._renderCameraCapture();
      this.profiler.captureRenderer(this.renderer);
      const performanceSnapshot = this.profiler.snapshot();
      const diagnostics = this.getPerfDiagnostics();
      const png = await new Promise((resolve) => {
        this.renderer.domElement.toBlob(resolve, 'image/png');
      });
      if (!png) throw new Error('Water baseline screenshot could not be encoded');

      const report = createWaterBaselineReport({
        scene,
        params: this.params,
        diagnostics,
        performance: performanceSnapshot,
        captureStats,
        shaderCompile: this._lastWaterShaderCompile ?? null,
      });
      const { strToU8, zipSync } = await import('fflate');
      const pngBytes = new Uint8Array(await png.arrayBuffer());
      const reportBytes = strToU8(JSON.stringify(report, null, 2));
      const archive = zipSync({
        [`${scene.value}.png`]: pngBytes,
        [`${scene.value}.json`]: reportBytes,
      });
      this._download(
        URL.createObjectURL(new Blob([archive], { type: 'application/zip' })),
        `water-baseline-${scene.value}.zip`,
      );
      this.cb.onToast(`Water baseline captured: ${scene.label}`);
      return report;
    } finally {
      if (!profilerWasActive) this.profiler.setActive(false);
      this.cb.onStatus('Ready', false);
    }
  }

  async _waitForWaterBaselineReady(timeoutMs = 30000) {
    const startedAt = performance.now();
    while (
      this._compiling
      || this.board?.isBuilding
      || this.waterSystem?._waterCompilePending
    ) {
      if (performance.now() - startedAt >= timeoutMs) return false;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return true;
  }

  // --------------------------------------------------------------- exports

  _download(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  _captureOverlayRoots() {
    return [
      this._tileGhost,
      this.paintMode?.cursor?.group,
      this.manualTerrain?.group,
      this.manualTerrain?.anchor,
      this.manualTerrain?.transform,
      this.manualTerrain?.cursor?.group,
      this.splineManager?.group,
      this._rwLoadGroup,
    ].filter(Boolean);
  }

  _withCaptureOverlaysHidden(capture) {
    const visibility = [...new Set(this._captureOverlayRoots())]
      .map((object) => [object, object.visible]);
    for (const [object] of visibility) object.visible = false;
    try {
      return capture();
    } finally {
      for (const [object, visible] of visibility) object.visible = visible;
    }
  }

  _renderCameraCapture() {
    return this._withCaptureOverlaysHidden(() => {
      const plan = this._prepareCameraPipeline();
      const sceneSize = this._cameraSceneSize(plan);
      const target = plan.usesSceneTarget ? this.visualPost.inputTarget : null;

      const studioLowRes = this.worldMode === 'studio' && !!this.studioCloud?.usesLowRes;
      const infiniteLowRes = this.worldMode === 'infinite' && !!this.infiniteCloud?.usesLowRes;
      const planetLowRes = this.worldMode === 'planet' && !!this.planetCloudLayer?.usesLowRes;

      this._prepareSharedOpaque(plan, sceneSize);
      this._captureWaterPlanarReflection(
        sceneSize,
        this._sceneRevisionKey(sceneSize, true),
      );
      if (typeof this.renderer.render === 'function') {
        this.renderer.setRenderTarget(target);
        this.renderer.render(this.scene, this.camera);
      } else {
        // Lightweight capture harnesses and legacy embedders may only expose
        // the old renderer-compatible underwater facade.
        this.underwater.render(this.renderer, this.scene, this.camera, target);
      }
      this._noteMainRender();
      const stats = {
        triangles: this.renderer.info.render.triangles,
        drawCalls: this.renderer.info.render.calls,
      };

      if (studioLowRes) {
        this._renderLowResCloudAfterScene(this.studioCloud, target, sceneSize);
      } else if (infiniteLowRes) {
        this._renderLowResCloudAfterScene(this.infiniteCloud, target, sceneSize);
      } else if (planetLowRes) {
        this._renderLowResCloudAfterScene(this.planetCloudLayer, target, sceneSize);
      }
      if (this.worldMode !== 'planet') this._applyUnderwaterFromSharedTarget(target);
      if (target) this.renderer.setRenderTarget(null);
      this.visualPost.finish(this.renderer);
      return stats;
    });
  }

  exportScreenshot() {
    this._renderCameraCapture();
    this.renderer.domElement.toBlob((blob) => {
      if (!blob) return this.cb.onToast('Export failed');
      this._download(URL.createObjectURL(blob), `terrain-${this.params.seed}.png`);
      this.cb.onToast('Screenshot exported');
    });
  }

  capturePreviewThumbnail(width = 480, height = 270) {
    // Render through the exact same path used by screenshot export, then scale
    // the actual WebGL canvas into a compact data URL for template previews.
    this._renderCameraCapture();
    const thumbnail = document.createElement('canvas');
    thumbnail.width = width; thumbnail.height = height;
    thumbnail.getContext('2d')?.drawImage(this.renderer.domElement, 0, 0, width, height);
    return thumbnail.toDataURL('image/webp', 0.8);
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
    const checks = validateExport(options, { worldMode: this.worldMode, boardSize: this.boardSize });
    const blockingCheck = checks.find((check) => check.status === 'error');
    if (hasExportErrors(checks)) {
      this.cb.onToast(`Export blocked: ${blockingCheck.message}`);
      return false;
    }
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
      // Water masks are folded into the single export zip (not downloaded
      // separately) via extraZipFiles, so the user gets one .zip with everything.
      const exportOptions = { ...options };
      let extraZipFiles = createProductionFiles(exportOptions, {
        seed: this.params.seed, boardSize: this.boardSize, heightScale: this.params.heightScale,
      });
      let tileWaterMaskFiles = null;
      if (options.exportWaterMask || options.exportDepthMap || options.exportShorelineMask
        || options.exportFoamMask || options.exportWaterMetadata) {
        const maskOptions = { ...exportOptions, maskRes: exportOptions.maskRes ?? exportOptions.meshRes ?? '512' };
        const separateTiles = this.worldMode === 'studio'
          && this.tileAssemblyShape === 'square'
          && this.tiles.length > 1
          && options.exportTileMode === 'separate';
        if (separateTiles) {
          tileWaterMaskFiles = {};
          for (const tile of this.tiles) {
            tileWaterMaskFiles[`${tile.cx},${tile.cz}`] = await this.waterSystem.exportMasks({
              ...maskOptions,
              maskSize: this.cellSize,
              maskOrigin: this._cellWorldCenter(tile.cx, tile.cz),
            });
          }
        } else {
          const assemblySize = this.worldMode === 'studio'
            ? Math.max(this._unionWidth(), this._unionDepth())
            : this.boardSize;
          Object.assign(extraZipFiles, await this.waterSystem.exportMasks({
            ...maskOptions,
            maskSize: assemblySize,
            maskOrigin: this.worldMode === 'studio' ? this._unionCenter() : { x: 0, z: 0 },
          }));
        }
      }
      if (options.exportSplineMasks && this.splineManager?.baker) {
        Object.assign(extraZipFiles, await this._splineMaskZipFiles());
      }
      if (this.worldMode === 'planet') {
        // export the full cube-sphere planet mesh
        const { PlanetExporter } = await import('./terrain/PlanetExporter.js');
        await PlanetExporter.export(this.renderer, this.params, this.uniforms, { ...exportOptions, extraZipFiles }, onMsg);
      } else {
        const { TerrainExporter } = await import('./terrain/TerrainExporter.js');
        await TerrainExporter.export(
          this.renderer, this.params, this.uniforms, this.boardSize,
          { ...exportOptions, extraZipFiles, tileWaterMaskFiles, tiles: this.tiles.map((t) => ({ ...t })), tileAssemblyShape: this.tileAssemblyShape, diskRadiusCells: this.diskRadiusCells, cellSize: this.cellSize }, onMsg, this._activeHeightProgram()
        );
      }
      return true;
    } catch (e) {
      console.error(e);
      this.cb.onToast('Export failed: ' + e.message);
      this.profiler.failLoadingTask(_exportTask, e);
      return false;
    } finally {
      this._exporting = false;
      this.profiler.finishLoadingTask(_exportTask);
      this.cb.onStatus('Ready', false);
    }
  }

  async _splineMaskZipFiles() {
    const baker = this.splineManager?.baker; if (!baker) return {};
    const encode = async (source, name, channel = 0, signed = false) => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = baker.resolution;
      const ctx = canvas.getContext('2d'); const image = ctx.createImageData(canvas.width, canvas.height);
      for (let i = 0; i < baker.resolution * baker.resolution; i++) {
        const value = source[i * 4 + channel]; const v = signed ? Math.round(Math.max(0, Math.min(255, 128 + value * 2))) : value;
        const o = i * 4; image.data[o] = image.data[o + 1] = image.data[o + 2] = v; image.data[o + 3] = 255;
      }
      ctx.putImageData(image, 0, 0); const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      return [name, new Uint8Array(await blob.arrayBuffer())];
    };
    const entries = await Promise.all([
      encode(baker.height, 'textures/spline_height_offset.png', 0, true), encode(baker.surface, 'textures/spline_surface_mask.png'), encode(baker.aux, 'textures/spline_prop_exclusion.png'),
    ]);
    return Object.fromEntries(entries);
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
    this._tickDayNightCycle(dt, now);


    this._processTerrainBuildQueue(now);

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

    // Centralized underwater detection + transition. Works in all world modes
    // (flat for Tile/Infinite, spherical for Planet). The smoothed `blend`
    // drives both the screen-space pass and the terrain caustics. Planet has a
    // curved "up", so it detects submersion (diagnostics + caustics) but the
    // screen-space pass is not applied in _tickPlanet (renders straight to canvas).
    this._updateUnderwater(dt);

    this.waterSystem?.update(this._fps);

    this.paintMode?.update(dt);
    this.manualTerrain?.update(dt);
    // Coalesce every brush stamp produced during this tick into one texture
    // version bump per changed map. This keeps pointer interpolation from
    // triggering several full DataTexture uploads before a single draw.
    this.paintMode?.flushUploads();
    this.manualTerrain?.flushUploads();
    this.propsManager?.tickWind(now * 0.001, this.params);
    this.propsManager?.update({
      mode: this.worldMode,
      camera: this.camera,
      params: this.params,
      boardSize: this.boardSize,
      sampler: this.worldMode === 'planet' ? null : this._getPropSampler(),
      planetSampler: this.worldMode === 'planet' ? this._getPlanetPropSampler() : null,
      paintLayers: this.worldMode === 'studio' ? this.paintMode?.layers : null,
      splineRevision: this.worldMode === 'studio' ? this.splineManager?.baker?.revision : -1,
      terrainRevision: this._terrainGen,
    });

    if (this.worldMode === 'infinite') {
      this._tickInfinite(dt, now);
    } else if (this.worldMode === 'planet') {
      this._tickPlanet(dt, now);
    } else {
      this._tickStudio(dt, now);
    }

    this._releaseWarmMaterialsAfterRender();
    this._autoPerfTick(now);
    this.profiler.captureRenderer(this.renderer);
    this.profiler.endFrame();
  }
  _isRenderedWaterActive() {
    if (!this.waterSystem?.isEnabled?.()) return false;
    if (this.worldMode === 'studio') {
      return !this._waterDeferred && this.water?.visible === true;
    }
    if (this.worldMode === 'infinite') {
      return this.infiniteWorld?.waterPlane?.visible === true;
    }
    if (this.worldMode === 'planet') return this.planetWater?.visible === true;
    return false;
  }


  // Centralized underwater state: resolve quality, drive the controller, push
  // caustic + post-process uniforms. Called once per frame from _tickBody.
  _updateUnderwater(dt) {
    const p = this.params;
    const ctrl = this.underwaterController;
    const u = this.uniforms;
    const perfOn = this.perf?.underwaterEffect !== false;
    const effectiveMode = this.waterSystem ? this.waterSystem.getEffectiveMode() : 'off';
    const waterActive = this._isRenderedWaterActive();
    const quality = resolveUnderwaterMode(p, effectiveMode, perfOn);
    const fellBack = underwaterModeFellBack(p, effectiveMode);

    // configure the screen-space pass from settings
    this.underwater.enabled = perfOn && p.waterUnderwaterEnabled !== false;
    this.underwater.intensity = p.waterUnderwaterFogDensity ?? 1;
    this.underwater.visibility = 140 / Math.max(0.25, p.waterUnderwaterVisibility ?? 1);

    ctrl.enabled = this.underwater.enabled;
    ctrl.depthTextureAvailable = this.underwater._depthSupported !== false;

    ctrl.update(dt, {
      worldMode: this.worldMode,
      cameraPos: this.camera.position,
      seaLevel: p.seaLevel,
      waterActive,
      waterMode: effectiveMode,
      quality,
      requestedQuality: p.waterUnderwaterMode ?? 'auto',
      fellBack,
      planetRadius: p.planetRadius ?? 0,
      blendBand: Math.max(0.3, p.waterSurfaceTransition ?? 0.8),
      transitionSpeed: 1.0,
      causticsEnabled: p.waterUnderwaterCausticsEnabled !== false,
      particlesEnabled: !!p.waterUnderwaterParticles,
      lightShaftsEnabled: !!p.waterUnderwaterLightShafts,
    });

    // terrain caustics (shared uniforms; world-XZ projection → seamless across
    // chunks). Cost is gated to a warp-coherent uniform branch in the shader, so
    // this is free above water.
    const causticUser = p.waterUnderwaterCaustics ?? 0.4;
    const causticsOn = waterActive && ctrl.causticsEnabled && quality !== 'off';
    if (u.uCausticStrength) {
      u.uCausticStrength.value = causticsOn ? causticUser : 0;
      // Caustics live on the submerged sea floor and are visible from any
      // viewpoint (above or below water), so they are NOT tied to the camera
      // being underwater — only to water covering the terrain. Depth fade in
      // the shader handles spatial falloff.
      u.uCausticBlend.value = causticsOn ? 1.0 : 0.0;
      u.uCausticScale.value = p.waterUnderwaterCausticScale ?? 1;
      u.uCausticSpeed.value = p.waterUnderwaterCausticSpeed ?? 1;
      if (u.uCausticMinDepth) {
        u.uCausticMinDepth.value =
          p.waterUnderwaterCausticMinDepth ?? 1;
      }
      if (u.uCausticMinDepthFalloff) {
        u.uCausticMinDepthFalloff.value =
          p.waterUnderwaterCausticMinDepthFalloff ?? 1;
      }
      this._syncCausticWaveUniforms(p);
    }

    // sync the screen-space pass (no-op while dry)
    const sun = this._underwaterSunScreen();
    this.underwater.update(ctrl, u.uTime.value, u, {
      distortion: p.waterUnderwaterDistortion ?? 0.5,
      caustics: causticUser,
      particles: 0.6,
      lightShafts: 0.7,
      sunScreen: sun,
      sunVisible: sun.visible,
    });
  }

  // Mirror active water ripple settings into terrain caustic uniforms so floor
  // caustics drift with the surface waves.
  _syncCausticWaveUniforms(p) {
    const u = this.uniforms;
    if (!u.uCausticWaveDir) return;

    const perf = this.perf ?? {};
    const realistic = isRealisticWaterMode(this.waterSystem?.getEffectiveMode() ?? 'legacy');
    u.uCausticWaterAnim.value = p.waterAnim ? 1 : 0;
    u.uCausticRippleLegacy.value = realistic ? 0 : 1;

    if (realistic) {
      const dirRad = (p.waterWaveDirection ?? 0) * Math.PI / 180;
      u.uCausticWaveDir.value.set(Math.cos(dirRad), Math.sin(dirRad));
      u.uCausticWaveSpeed.value = p.waterWaveSpeed ?? 1;
      u.uCausticWaveScale.value = p.waterWaveScale ?? 1;
      u.uCausticAnimSpeed.value = p.waterAnimSpeed ?? 1;
      u.uCausticLargeWaveStr.value = p.waterLargeWaveStrength ?? 1;
      u.uCausticSmallWaveStr.value = p.waterSmallWaveStrength ?? 0.65;
      const ws = (p.waterWaveStrength ?? 1) * (perf.waterWaves ?? 1);
      u.uCausticWaveStrength.value = 1.8 * (p.waterNormalIntensity ?? 1) * ws;
    } else {
      u.uCausticWaveDir.value.set(1, 0);
      u.uCausticWaveSpeed.value = 1;
      u.uCausticWaveScale.value = 1;
      u.uCausticAnimSpeed.value = 1;
      u.uCausticLargeWaveStr.value = 1;
      u.uCausticSmallWaveStr.value = perf.waterDetail ?? 1;
      u.uCausticWaveStrength.value = 1.6 * (perf.waterWaves ?? 1);
    }
  }

  // Structured underwater diagnostics for the Performance Overlay.
  _underwaterDiagnostics() {
    const ctrl = this.underwaterController;
    const perfOn = this.perf?.underwaterEffect !== false;
    if (!ctrl) {
      return { available: false, active: false, mode: 'off', requestedMode: 'off' };
    }
    const snap = ctrl.snapshot();
    // the screen-space pass does not run on the planet (curved up) — caustics +
    // detection still report, but flag that post-processing is not applied there
    const postApplies = this.worldMode !== 'planet';
    return {
      available: true,
      enabled: perfOn && (this.params?.waterUnderwaterEnabled !== false),
      postProcessApplies: postApplies,
      // estimate of extra cost: the pass renders the scene into an RT + a
      // fullscreen composite while submerged (0 above water)
      costEstimate: snap.active && postApplies
        ? (snap.mode === 'high' ? 'high' : 'low')
        : 'none',
      particleCount: snap.particlesEnabled ? 'screen-space (procedural)' : 0,
      ...snap,
    };
  }

  // Project the sun direction to screen UV for High-mode light shafts.
  _underwaterSunScreen() {
    const cam = this.camera;
    const sunDir = this.uniforms.uSunDir.value;
    const v = this._uwSunScratch || (this._uwSunScratch = new THREE.Vector3());
    v.copy(cam.position).addScaledVector(sunDir, 1e6);
    v.project(cam);
    const visible = sunDir.y > -0.02 && v.z > -1 && v.z < 1;
    return { x: v.x * 0.5 + 0.5, y: v.y * 0.5 + 0.5, visible };
  }

  _tickStudio(dt, now) {
    // Input always runs (so inertia/look settle even when we skip drawing).
    if (this._debug.freeCamNoClip && this.fpsControls) {
      this.fpsControls.update(dt);
    } else if (this.exploreMode === 'walk' && this.player) {
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
    const cloudMotion = Math.abs(this.params.cloudWindSpeed ?? 0) > 0.0001
      || Math.abs(this.params.cloudRotationSpeed ?? 0) > 0.0001
      || Math.abs(this.params.cloudEvolveSpeed ?? 0) > 0.0001;
    const waterMotion = this.params.waterAnim
      && Math.abs(this.params.waterAnimSpeed ?? 1) > 0.0001;
    const propMotion = this.params.propsEnabled
      && Math.abs(this.params.propsWind ?? 0.6) > 0.0001
      && Math.abs(this.params.propsWindSpeed ?? 1.6) > 0.0001;
    const manualEditing = !!(
      this.manualTerrain?.sculpt?.enabled
      || this.manualTerrain?.texturePaint?.enabled
    );
    const animating =
      (this.params.cloudsEnabled && !!this.studioCloud && cloudMotion) ||
      (this.water.visible && waterMotion) ||
      (this.propsManager?.group?.visible && propMotion) ||
      (this.visualPost?.enabled(this.params, this.worldMode) && (this.params.visualsSunRaysStrength ?? 0) > 0.001) ||
      !!this.params.visualsCrtEnabled ||
      this.underwater.active ||
      this._debug.freeCamNoClip ||
      this.exploreMode !== 'none' ||
      !!this.paintState?.enabled ||
      manualEditing ||
      this.board?.isBuilding ||
      (!this._debug.freezeLod && this.board._lodRebuildQueue.length > 0);
    const minimapDirty = this.minimap._dirty && now - this._minimapDirtyAt > 280;
    // Heartbeat safety net: redraw at least ~1 Hz so any state change that
    // forgot to invalidate self-heals within a second (cheap insurance).
    const heartbeat = now - this._lastRenderAt > 1000;
    const shouldRender = !this.perf.onDemandStudio || this._debug.forceRender
      || this._landingShowcase || this.controls.isSettling
      || this._needsRender || moved || animating || minimapDirty || heartbeat;

    if (this._bootShaderPending) return;

    if (shouldRender) {
      this._needsRender = false;
      this._lastRenderAt = now;
      this._camPos.copy(cam.position);
      this._camQuat.copy(cam.quaternion);

      if (this.studioCloud) {
        this.profiler.begin('clouds');
        this.studioCloud.update(dt, this.camera.position, this.uniforms.uSunDir.value);
        this._syncTerrainCloudShadows();
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
        // A quality preset may rebuild the four shared LOD geometries over
        // several hidden boot frames. Re-check readiness after the last level
        // so the loading cover cannot reveal an intermediate mesh.
        if (this._bootPending && !this.board.isBuilding
            && !this.board._lodRebuildQueue.length) {
          this._completeBootIfInteractiveReady();
          this._completeBootIfQualityReady();
        }
      }

      const cameraPlan = this._prepareCameraPipeline();
      const cameraSceneSize = this._cameraSceneSize(cameraPlan);
      const cameraTarget = cameraPlan.usesSceneTarget ? this.visualPost.inputTarget : null;

      const studioLowRes = !!this.studioCloud?.usesLowRes;
      this.profiler.begin('render');
      this.profiler.gpu?.frameBegin();
      // refresh the baked height/normal texture if the field changed (no-op on a
      // steady frame); the studio terrain + water shaders then sample it per
      // pixel instead of re-evaluating the full height field.
      this._ensureTerrainHeightTexSafely();

      this._maybeWarmUnderwater();
      this._prepareSharedOpaque(cameraPlan, cameraSceneSize);
      this._captureWaterPlanarReflection(
        cameraSceneSize,
        this._sceneRevisionKey(cameraSceneSize, true),
      );
      this.renderer.setRenderTarget(cameraTarget);
      this.renderer.render(this.scene, this.camera);
      this._noteMainRender();
      // capture the scene's tri/draw counts BEFORE the low-res cloud composite —
      // renderer.info auto-resets each render(), so the fullscreen composite quad
      // would otherwise overwrite the stats with its own ~2 triangles (HUD → 0).
      this._lastTris = this.renderer.info.render.triangles;
      this._lastDraws = this.renderer.info.render.calls;
      if (studioLowRes) {
        this._renderLowResCloudAfterScene(this.studioCloud, cameraTarget, cameraSceneSize);
      }
      this._applyUnderwaterFromSharedTarget(cameraTarget);
      if (cameraTarget) this.renderer.setRenderTarget(null);
      this.visualPost.finish(this.renderer);
      this.profiler.gpu?.frameEnd();
      this.profiler.end('render');

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
      this.cb.onStats({
        fps: this._fps,
        triangles: this._lastTris,
        drawCalls: this._lastDraws,
        waterCost: this.params.waterShowPerfCost
          ? this.waterSystem?.getPerformanceDiagnostics?.() ?? null
          : null,
      });
      if (this.cb.onPlayerState) {
        this.cb.onPlayerState(this.player ? this.player.state : null);
      }
      if (this.exploreMode === 'plane' || this._debug.freeCamNoClip) {
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

    if (this.infiniteTerrainClipmap) {
      this.profiler.begin('terrain-field-cache');
      if (this._debug.disableHeightBake) {
        this.uniforms.uUseInfiniteFieldCache.value = 0;
      } else {
        this.uniforms.uUseInfiniteFieldCache.value = 1;
        this.infiniteTerrainClipmap.update(this.camera.position, this._terrainGen);
      }
      this.profiler.end('terrain-field-cache');
    }

    // Stream chunks around the camera (with culling)
    if (this.infiniteWorld) {
      this.profiler.begin('chunks');
      this.infiniteWorld.update(this.camera.position, this.camera);
      this.profiler.end('chunks');
    }
    if (this.infiniteCloud) {
      this.profiler.begin('clouds');
      this.infiniteCloud.update(dt, this.camera.position, this.uniforms.uSunDir.value);
      this.profiler.end('clouds');
    }
    this._maybeWarmUnderwater();
    this.profiler.begin('render');
    this.profiler.gpu?.frameBegin();
    const cameraPlan = this._prepareCameraPipeline();
    const cameraSceneSize = this._cameraSceneSize(cameraPlan);
    const cameraTarget = cameraPlan.usesSceneTarget ? this.visualPost.inputTarget : null;
    const infiniteLowRes = !!this.infiniteCloud?.usesLowRes;
    this._prepareSharedOpaque(cameraPlan, cameraSceneSize);
    this._captureWaterPlanarReflection(
      cameraSceneSize,
      this._sceneRevisionKey(cameraSceneSize, true),
    );
    this.renderer.setRenderTarget(cameraTarget);
    this.renderer.render(this.scene, this.camera);
    this._noteMainRender();
    const triangles = this.renderer.info.render.triangles;
    const drawCalls = this.renderer.info.render.calls;
    if (infiniteLowRes) {
      this._renderLowResCloudAfterScene(this.infiniteCloud, cameraTarget, cameraSceneSize);
    }
    this._applyUnderwaterFromSharedTarget(cameraTarget);
    this.visualPost.finish(this.renderer);
    this.profiler.gpu?.frameEnd();
    this.profiler.end('render');

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
          pendingChunks: this.infiniteWorld ? this.infiniteWorld.pendingChunkCount : 0,
          terrainDrawCalls: this.infiniteWorld ? this.infiniteWorld.terrainDrawCallCount : 0,
        });
      }
      this.cb.onStats({
        fps: this._fps,
        triangles,
        drawCalls,
        waterCost: this.params.waterShowPerfCost
          ? this.waterSystem?.getPerformanceDiagnostics?.() ?? null
          : null,
      });
    }
  }

  _tickPlanet(dt, now) {
    if (this._debug.freeCamNoClip && this.fpsControls) {
      this.fpsControls.update(dt);
    } else if (this.exploreMode !== 'none' && this.player) {
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

    const cameraPlan = this._prepareCameraPipeline();
    const cameraSceneSize = this._cameraSceneSize(cameraPlan);
    const cameraTarget = cameraPlan.usesSceneTarget ? this.visualPost.inputTarget : null;

    const planetLowRes = !!this.planetCloudLayer?.usesLowRes;
    this.profiler.begin('render');
    this.profiler.gpu?.frameBegin();

    this._prepareSharedOpaque(cameraPlan, cameraSceneSize);

    // planet renders straight to the canvas — no underwater render-target pass
    this.renderer.setRenderTarget(cameraTarget);
    this.renderer.render(this.scene, this.camera);
    this._noteMainRender();
    // capture scene tri/draw counts BEFORE the low-res cloud composite (its
    // fullscreen quad would otherwise reset renderer.info to ~2 triangles).
    const triangles = this.renderer.info.render.triangles;
    const drawCalls = this.renderer.info.render.calls;
    if (planetLowRes) {
      this._renderLowResCloudAfterScene(this.planetCloudLayer, cameraTarget, cameraSceneSize);
    }
    if (cameraTarget) this.renderer.setRenderTarget(null);
    this.visualPost.finish(this.renderer);
    this.profiler.gpu?.frameEnd();
    this.profiler.end('render');
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
      this.cb.onStats({
        fps: this._fps,
        triangles,
        drawCalls,
        waterCost: this.params.waterShowPerfCost
          ? this.waterSystem?.getPerformanceDiagnostics?.() ?? null
          : null,
      });
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

    const cloudLayer = this._activeCloudLayer();
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
            || !!perf.useWorker !== !!this.rendererConfig.workerActive
          )
        ),
      },
      drawingBuffer: this.renderer
        ? { w: this.renderer.domElement.width, h: this.renderer.domElement.height }
        : null,
      camera: cam ? { x: cam.x, y: cam.y, z: cam.z } : null,
      gpuName: this.gpuName,
      shadowsEnabled: !!(this.renderer && this.renderer.shadowMap && this.renderer.shadowMap.enabled),
      postProcessing: {
        underwater: !!this.underwater?.active,
        visuals: !!this.visualPost?.lookEnabled(this.params, this.worldMode),
        cameraShaders: !!this.visualPost?.cameraEffectsEnabled(this.params),
        cameraStack: this.visualPost?.diagnostics?.() ?? null,
      },

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
        renderScale: cloudLayer?.effectiveRenderScale ?? perf.cloudRenderScale ?? 1,
        adaptiveScale: this._cloudAdaptive?.scaleMultiplier ?? 1,
        adaptiveStepScale: this._cloudAdaptive?.stepMultiplier ?? 1,
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
        baselineScene: this._activeWaterBaseline ?? null,
        shaderCompile: this._lastWaterShaderCompile ?? null,
        refractionPass: this.waterSystem?.getRefractionDiagnostics?.() ?? null,
        planarReflectionPass:
          this.waterSystem?.getPlanarReflectionDiagnostics?.() ?? null,
        performanceCost:
          this.waterSystem?.getPerformanceDiagnostics?.() ?? null,
      },
      underwater: this._underwaterDiagnostics(),
    };

    if (this.worldMode === 'infinite' && this.infiniteWorld) {
      const w = this.infiniteWorld;
      diag.terrain = {
        chunkSize: w.chunkSize,
        viewRadius: w.viewRadius,
        renderDistance: w.viewRadius * w.chunkSize,
        lodThresholds: Array.isArray(w.lodThresholds) ? [...w.lodThresholds] : [],
        lastChunkGenMs: this.profiler.getMetric('lastChunkGenMs') ?? null,
        renderer: 'instanced',
        terrainDrawCalls: w.terrainDrawCallCount,
        pendingChunks: w.pendingChunkCount,
        createdThisFrame: w.createdChunkCount,
        removedThisFrame: w.removedChunkCount,
        streamTimeMs: w.streamTimeMs,
      };
      diag.culling = {
        total: w.activeChunkCount,
        visible: w.visibleChunkCount,
        culled: w.culledChunkCount,
      };
      diag.merge = {
        enabled: w.merge?.enabled !== false,
        foldedNodes: w.mergedGroupCount ?? 0,
        savedDrawCalls: w.savedDrawCalls ?? 0,
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
      diag.merge = {
        enabled: w.mergeEnabled !== false,
        foldedNodes: w.mergedGroupCount ?? 0,
        savedDrawCalls: w.savedDrawCalls ?? 0,
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
      if (b) {
        diag.merge = {
          enabled: b.mergeEnabled,
          foldedNodes: b.mergedGroupCount,
          savedDrawCalls: b.savedDrawCalls,
        };
      }
      diag.lod = { counts: b ? [...b.lodCounts] : [0, 0, 0, 0] };
    }

    this.profiler.setMetric('sceneState', state);
    return diag;
  }

  dispose() {
    for (const entry of Object.values(this.importedMaps || {})) entry?.texture?.dispose();
    this.erosionField?.dispose();
    this._erosionWorker?.terminate();
    this._erosionWorker = null;
    if (this._disposed) return;
    this._disposed = true;
    if (this._erosionGPUWarmCancel) {
      this._erosionGPUWarmCancel();
      this._erosionGPUWarmCancel = null;
    }
    if (this._postFirstPaintWarmTimer) {
      clearTimeout(this._postFirstPaintWarmTimer);
      this._postFirstPaintWarmTimer = null;
    }
    if (this._postFirstPaintWaterTimer) {
      clearTimeout(this._postFirstPaintWaterTimer);
      this._postFirstPaintWaterTimer = null;
    }
    if (this._initialShaderRetryTimer) {
      clearTimeout(this._initialShaderRetryTimer);
      this._initialShaderRetryTimer = null;
    }
    if (this._terrainUpgradeRetryTimer) {
      clearTimeout(this._terrainUpgradeRetryTimer);
      this._terrainUpgradeRetryTimer = null;
    }
    if (this._terrainHeightBakeRetryTimer) {
      clearTimeout(this._terrainHeightBakeRetryTimer);
      this._terrainHeightBakeRetryTimer = null;
    }
    if (this._terrainVariantRetryTimer) {
      clearTimeout(this._terrainVariantRetryTimer);
      this._terrainVariantRetryTimer = null;
    }
    if (this._terrainQualityTimer) {
      clearTimeout(this._terrainQualityTimer);
      this._terrainQualityTimer = null;
    }
    if (this._waterWarmRetryTimer) {
      clearTimeout(this._waterWarmRetryTimer);
      this._waterWarmRetryTimer = null;
    }
    if (this._bootWatchdogTimer) {
      clearTimeout(this._bootWatchdogTimer);
      this._bootWatchdogTimer = null;
    }
    if (this._qualityWatchdogTimer) {
      clearTimeout(this._qualityWatchdogTimer);
      this._qualityWatchdogTimer = null;
    }
    if (this._resizeObserver) this._resizeObserver.disconnect();
    if (this._onVisibility) document.removeEventListener('visibilitychange', this._onVisibility);
    if (this._onUserActivity) {
      window.removeEventListener('pointerdown', this._onUserActivity, true);
      window.removeEventListener('wheel', this._onUserActivity, true);
      window.removeEventListener('keydown', this._onUserActivity, true);
      this._onUserActivity = null;
    }
    if (this._onContextLost) this.canvas.removeEventListener('webglcontextlost', this._onContextLost, false);
    if (this._onContextRestored) this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored, false);
    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
    }
    if (this.paintMode) { this.paintMode.dispose(); this.paintMode = null; }
    if (this.manualTerrain) { this.manualTerrain.dispose(); this.manualTerrain = null; }
    if (this.splineManager) { this.splineManager.dispose(); this.splineManager = null; }
    if (this.propsManager) { this.propsManager.dispose(); this.propsManager = null; }
    if (this.realWorldBuildingLayer) { this.realWorldBuildingLayer.dispose(); this.realWorldBuildingLayer = null; }
    if (this.player) { this.player.dispose(); this.player = null; }
    if (this.heightSampler) { this.heightSampler.dispose(); this.heightSampler = null; }
    if (this.propSurfaceField) { this.propSurfaceField.dispose(); this.propSurfaceField = null; }
    if (this.worldMode === 'infinite') this._disposeInfinite();
    else if (this.worldMode === 'planet') this._disposePlanet();
    else if (this.fpsControls) { this.fpsControls.dispose(); this.fpsControls = null; }
    if (this.studioCloud) { this.studioCloud.dispose(); this.studioCloud = null; }
    if (this.terrainHeightBaker) { this.terrainHeightBaker.dispose(); this.terrainHeightBaker = null; }
    if (this.proceduralSky) { this.proceduralSky.dispose(); this.proceduralSky = null; }
    this.board.dispose();
    this.minimap.dispose();
    this.underwater.dispose();
    this.visualPost?.dispose();
    this.waterSystem?.dispose();
    this.water?.geometry?.dispose();
    for (const t of this._matTrash) for (const m of t.mats) m.dispose();
    this._matTrash = [];
    this._warmGeo.dispose();
    if (this.terrainMaterial) this.terrainMaterial.dispose();
    this._bootDegradedMaterial?.dispose?.();
    if (this.waterMaterial) this.waterMaterial.dispose();
    if (this._surfaceAtlasCache) {
      for (const atlas of Object.values(this._surfaceAtlasCache)) this._disposeSurfaceAtlas(atlas);
      this._surfaceAtlasCache = null;
      this._surfaceAtlas = null;
    }
    if (this.controls) { this.controls.dispose(); this.controls = null; }
    if (this.planetControls) { this.planetControls.dispose(); this.planetControls = null; }
    // tile hover-to-add listeners + resources
    if (this._onTilePointerMove) {
      this.canvas.removeEventListener('pointermove', this._onTilePointerMove);
      this.canvas.removeEventListener('pointerdown', this._onTilePointerDown);
      this.canvas.removeEventListener('pointerup', this._onTilePointerUp);
      this.canvas.removeEventListener('pointerleave', this._onTilePointerLeave);
    }
    if (this._tileGhost) {
      this._tileGhost.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      this._tileGhost = null;
    }
    if (this._rwLoadGroup) {
      this._rwClearTileLoadOverlay();
      this._rwLoadGroup = null;
      this._rwLoadSprites = null;
    }
    if (this._tileOccTex) { this._tileOccTex.dispose(); this._tileOccTex = null; }
    if (this.renderer) {
      loseRendererContext(this.renderer);
      this.renderer.dispose();
      this.renderer = null;
    }
  }
}
