import React, { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createEngineProxy } from './engine/EngineProxy.js';
import { DEFAULT_PARAMS } from './engine/presets.js';
import { DEFAULT_DEBUG_FLAGS, DEFAULT_TILE_DEBUG } from './engine/panelResets.js';
import { clonePlanetStyle } from './engine/style/PlanetStyleConfig.js';
import { buildActiveSurfaceAtlas } from './engine/terrain/surface/applyTerrainSurface.js';
import { resetSurfaceLibraryState } from './engine/terrain/surface/SurfaceLibrary.js';
import { normalizeSurfaceTextureSource, sourceUsesTextureAtlas } from './engine/terrain/surface/SurfaceTextureSources.js';
import { colorToHex } from './engine/style/ColorPalette.js';
import { formatTimeOfDay } from './engine/sky/TimeOfDay.js';
import { useLoading, blockingTask, nonBlockingTask } from './state/loading.jsx';
import { panelAvailable, PANEL_ORDER, getPanelDisplay } from './components/panels/panelMeta.js';
import { searchSettings } from './components/panels/settingsSearch.js';
import TopBar from './components/TopBar.jsx';
import LeftToolbar from './components/ui/LeftToolbar.jsx';
import {
  loadToolsRailLayout,
  saveToolsRailLayout,
  loadDrawerLayout,
  saveDrawerLayout,
} from './components/ui/toolsRailLayout.js';
import { loadUiPrefs, saveUiPrefs } from './components/ui/uiPrefs.js';
import UiSettingsPanel from './components/ui/UiSettingsPanel.jsx';
import SettingsSearchOverlay from './components/ui/SettingsSearchOverlay.jsx';
import BottomToolbar from './components/BottomToolbar.jsx';
import CreatorToolbar from './components/CreatorToolbar.jsx';
import WorldModeBar from './components/WorldModeBar.jsx';
import StatusBar from './components/StatusBar.jsx';
import InfiniteHUD from './components/InfiniteHUD.jsx';
import PlaneHUD from './components/PlaneHUD.jsx';
import TouchControls from './components/TouchControls.jsx';
import MinimapOverlay from './components/MinimapOverlay.jsx';
import PaintPanel from './components/paint/PaintPanel.jsx';
import LoadingOverlay from './components/ui/LoadingOverlay.jsx';
import CompileProgressChip from './components/ui/CompileProgressChip.jsx';
import { classifyToast } from './components/ui/Toast.jsx';
import { useLanding } from './landing/landingContext.jsx';
import { usePerfOverlay } from './components/perf/usePerfOverlay.js';
import { labelGpuPreference, labelRendererBackend } from './engine/render/RendererCapabilities.js';
import { normalizeProject, projectStore } from './project/ProjectStore.js';
import { getProjectTemplate, PROJECT_TEMPLATES, projectTemplatePreviewCacheKey } from './project/ProjectTemplates.js';
import {
  NODE_PROJECT_TEMPLATES, createNodeTemplateGraph, getNodeProjectTemplate, nodeTemplatePreviewCacheKey,
} from './project/NodeProjectTemplates.js';
import { createBlankGraph } from './engine/terrain/graph/GraphDocument.js';

const MODE_LABEL = { studio: 'Tile', infinite: 'Infinite World', planet: 'Planet' };
const NODE_PANEL_IDS = ['planet', 'water', 'clouds', 'visuals', 'skybox', 'lighting', 'export', 'performance', 'debug'];
const PerformanceOverlay = lazy(() => import('./components/perf/PerformanceOverlay.jsx'));
const SideDrawer = lazy(() => import('./components/ui/SideDrawer.jsx'));
const loadNodeWorkspace = () => import('./components/nodes/NodeWorkspace.jsx');
const NodeWorkspace = lazy(loadNodeWorkspace);

const hex = (rgb) => colorToHex(Array.isArray(rgb) ? rgb : [0.5, 0.5, 0.5]);
const yesNo = (value) => (value ? 'On' : 'Off');
const num = (value, digits = 2, suffix = '') => {
  if (!Number.isFinite(value)) return '—';
  return `${Number(value).toFixed(digits)}${suffix}`;
};

export default function App() {
  const canvasRef = useRef(null);
  const minimapBaseRef = useRef(null);
  const minimapOverlayRef = useRef(null);
  const engineRef = useRef(null);
  const activeProjectRef = useRef(null);
  const templatePreviewQueueRef = useRef(Promise.resolve());
  const landingPreviewActiveRef = useRef(true);
  const landingPreviewSessionRef = useRef(0);

  const loading = useLoading();
  const landing = useLanding();
  const landingRef = useRef(landing);
  landingRef.current = landing;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  // Developer Performance Overlay (diagnostics). Toggle: Ctrl/Cmd+Shift+P or
  // the FPS badge in the status bar. Detailed collection only while open.
  const perfOverlay = usePerfOverlay(engineRef, loading.tasks);

  const [params, setParams] = useState({ ...DEFAULT_PARAMS });
  const [status, setStatus] = useState({ text: 'Booting…', busy: true });
  const [bgWork, setBgWork] = useState(null);   // background shader-compile label
  const [compileProgress, setCompileProgress] = useState(null);
  const [stats, setStats] = useState({ fps: 0, triangles: 0, drawCalls: 0 });
  const [lodCounts, setLodCounts] = useState([0, 0, 0, 0]);
  const [chunkCount, setChunkCount] = useState(DEFAULT_PARAMS.chunkCount);
  const [boardSize, setBoardSize] = useState(DEFAULT_PARAMS.chunkCount * DEFAULT_PARAMS.chunkSize);
  const [camInfo, setCamInfo] = useState({ angle: '–', distance: '–' });
  const [gpu, setGpu] = useState('–');

  const [camMode, setCamMode] = useState('orbit');
  const [helpVisible, setHelpVisible] = useState(false);
  const [fileDragActive, setFileDragActive] = useState(false);
  const fileDragDepthRef = useRef(0);
  const [previewMode, setPreviewMode] = useState(false);
  const [activePanel, setActivePanel] = useState(null);
  const [toolsRailLayout, setToolsRailLayout] = useState(loadToolsRailLayout);
  const [drawerLayout, setDrawerLayout] = useState(loadDrawerLayout);
  const [uiPrefs, setUiPrefs] = useState(loadUiPrefs);
  const [uiSettingsOpen, setUiSettingsOpen] = useState(false);
  const appShellRef = useRef(null);
  const [paintState, setPaintState] = useState({ enabled: false });
  const [splineState, setSplineState] = useState({ enabled: false, selectedId: null, creatingType: null, draftPointCount: 0, splines: [] });
  const [analysisState, setAnalysisState] = useState({ enabled: false, mode: 'elevation', opacity: .72 });
  const [creatorHistory, setCreatorHistory] = useState({ actions: [], snapshots: [] });
  const [tileDebug, setTileDebug] = useState({ view: 'off', showLegend: true, opacity: 1, showPreview: true });
  const [tiles, setTiles] = useState([{ cx: 0, cz: 0 }]);
  const [tileAssemblyShape, setTileAssemblyShape] = useState('square');
  const [diskRadiusCells, setDiskRadiusCells] = useState(0);
  const [importedMaps, setImportedMaps] = useState({ noise: null, height: null, biome: null, imagery: null });
  const [realWorldImageryStyle, setRealWorldImageryStyle] = useState('satellite');

  const [worldMode, setWorldMode] = useState('studio');
  const [infiniteStats, setInfiniteStats] = useState(null);
  const [exploreMode, setExploreMode] = useState('none');
  const [playerMode, setPlayerMode] = useState(false);
  const [playerState, setPlayerState] = useState(null);

  const [qualityPreset, setQualityPreset] = useState('high');
  const [timeOfDay, setTimeOfDay] = useState(0.38);
  const [cullingEnabled, setCullingEnabled] = useState(true);
  const [behindCameraCulling, setBehindCameraCulling] = useState(true);
  const [debugFlags, setDebugFlags] = useState({ ...DEFAULT_DEBUG_FLAGS });
  const [visibleChunks, setVisibleChunks] = useState(DEFAULT_PARAMS.chunkCount * DEFAULT_PARAMS.chunkCount);
  const [culledChunks, setCulledChunks] = useState(0);
  const [perf, setPerf] = useState(null);
  const [settingsSearchOpen, setSettingsSearchOpen] = useState(false);
  const [settingsSearchQuery, setSettingsSearchQuery] = useState('');
  const [settingsSearchIndex, setSettingsSearchIndex] = useState(0);
  const [settingsTarget, setSettingsTarget] = useState(null);
  const [webglError, setWebglError] = useState(null);
  const [activeProject, setActiveProject] = useState(null);
  const [projectMode, setProjectMode] = useState('procedural');
  const [terrainGraph, setTerrainGraph] = useState(null);
  const [graphView, setGraphView] = useState({ x: 0, y: 0, zoom: 1 });
  const [graphState, setGraphState] = useState({ valid: true, compiling: false, diagnostics: [], slotCount: 0 });
  const [nodesPreviewVisible, setNodesPreviewVisible] = useState(false);
  const [nodePaletteDock, setNodePaletteDock] = useState({ detached: true, side: 'left', width: 208 });
  const graphCompileTimerRef = useRef(null);
  const graphUniformFrameRef = useRef(null);
  const pendingGraphRef = useRef(null);

  // ---- toasts ----
  const [recentNotifications, setRecentNotifications] = useState([]);
  const [notificationsIgnored, setNotificationsIgnored] = useState(() => {
    try { return localStorage.getItem('terrain-studio.ignore-notifications') === 'true'; }
    catch { return false; }
  });
  const notificationsIgnoredRef = useRef(notificationsIgnored);
  notificationsIgnoredRef.current = notificationsIgnored;
  const toastId = useRef(0);
  const pushToast = useCallback((msg, type = 'info') => {
    if (notificationsIgnoredRef.current) return;
    const id = ++toastId.current;
    const notification = { id, msg, type, timestamp: Date.now() };
    setRecentNotifications((prev) => [notification, ...prev].slice(0, 12));
  }, []);
  const clearNotifications = useCallback(() => setRecentNotifications([]), []);
  const toggleNotificationLogging = useCallback(() => {
    setNotificationsIgnored((prev) => {
      const next = !prev;
      try { localStorage.setItem('terrain-studio.ignore-notifications', String(next)); } catch { /* ignore storage failures */ }
      return next;
    });
  }, []);
  const pushToastRef = useRef(pushToast);
  pushToastRef.current = pushToast;
  const showToast = useCallback((msg, type) => pushToast(msg, type ?? classifyToast(msg)), [pushToast]);

  // refs read by stable engine callbacks
  const blockingActiveRef = useRef(false);
  const blockingUpdateRef = useRef(null); // current blocking task's update fn
  const bootedRef = useRef(false);
  const exportFailedRef = useRef(false);

  // ---- undo / redo history ----
  // Each entry is a JSON string from engine.serializeState() (every setting,
  // minus heavy paint pixels — those are deduped by revision in paintBlobsRef).
  // Rapid edits (dragging a slider 100→150) are coalesced by a debounce so one
  // Ctrl+Z reverts the whole gesture back to the value before the drag (100),
  // never the intermediate frames.
  const historyRef = useRef({ past: [], future: [], present: null });
  const paintBlobsRef = useRef(new Map());     // paintRev → heavy paint blob
  const erosionBlobsRef = useRef(new Map());   // erosionRev → heavy erosion blob
  const histSuppressRef = useRef(false);       // true while applying a restore
  const histTimerRef = useRef(null);           // pending debounced record
  const scheduleRecordRef = useRef(null);      // late-bound for engine callbacks
  const worldModeRef = useRef('studio');
  const [histState, setHistState] = useState({ canUndo: false, canRedo: false });
  const HISTORY_LIMIT = 100;

  blockingActiveRef.current = !!blockingTask(loading.tasks);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      setWebglError('Viewport canvas is not available.');
      loadingRef.current.done('boot');
      return undefined;
    }

    loadingRef.current.start('boot', { blocking: true, label: 'Loading Terrain Studio…', detail: 'Initializing engine' });

    let engine = null;
    let bootTimer = null;
    let cancelled = false;

    const init = async () => {
    try {
      engine = await createEngineProxy({
        canvas,
        minimapBase: minimapBaseRef.current,
        minimapOverlay: minimapOverlayRef.current,
        initialParams: landingRef.current?.sessionSeed != null
          ? { seed: landingRef.current.sessionSeed }
          : undefined,
        callbacks: {
          onParams: (next) => {
            setParams({
              ...next,
              planetStyle: next.planetStyle ? clonePlanetStyle(next.planetStyle) : next.planetStyle,
            });
            scheduleRecordRef.current?.();
          },
          onStatus: (text, busy) => {
            setStatus({ text, busy });
            // feed the active blocking task's detail line
            if (busy && blockingUpdateRef.current) blockingUpdateRef.current({ detail: text });
            // clear the initial boot overlay once the full-detail terrain
            // material is compiled, swapped in, and rendered once
            if (!busy && !bootedRef.current) {
              bootedRef.current = true;
              loadingRef.current.done('boot');
            }
          },
          onBootComplete: () => landingRef.current?.setBootReady(true),
          onStats: setStats,
          onBackgroundWork: setBgWork,
          onCompileProgress: setCompileProgress,
          onLod: (counts, count, visible, culled) => {
            setLodCounts(counts);
            setChunkCount(count);
            setVisibleChunks(visible !== undefined ? visible : count * count);
            setCulledChunks(culled !== undefined ? culled : 0);
          },
          onCamera: setCamInfo,
          onBoard: setBoardSize,
          onToast: (msg) => {
            const type = classifyToast(msg);
            if (/fail|error/i.test(msg)) exportFailedRef.current = true;
            // suppress progress (info) toasts while a blocking overlay is up
            if (blockingActiveRef.current && type === 'info') return;
            pushToastRef.current(msg, type);
          },
          onFirstInteract: () => setHelpVisible(false),
          onInfiniteStats: setInfiniteStats,
          onExploreMode: setExploreMode,
          onPlayerMode: setPlayerMode,
          onPlayerState: setPlayerState,
          onQualityChange: setQualityPreset,
          onTimeOfDayChange: (v) => { setTimeOfDay(v); scheduleRecordRef.current?.(); },
          onPerfChange: (p) => { setPerf(p); scheduleRecordRef.current?.(); },
          onPaintState: (s) => { setPaintState(s); scheduleRecordRef.current?.(); },
          onSplineState: (s) => { setSplineState(s); scheduleRecordRef.current?.(); },
          onAnalysisState: setAnalysisState,
          onCreatorHistory: setCreatorHistory,
          onTileDebug: (t) => { setTileDebug(t); scheduleRecordRef.current?.(); },
          onTiles: (payload) => {
            const list = Array.isArray(payload) ? payload : (payload?.tiles ?? [{ cx: 0, cz: 0 }]);
            setTiles(list);
            if (!Array.isArray(payload)) {
              setTileAssemblyShape(payload?.tileAssemblyShape ?? 'square');
              setDiskRadiusCells(payload?.diskRadiusCells ?? 0);
            }
            scheduleRecordRef.current?.();
          },
          onImportedMaps: setImportedMaps,
          onRealWorldImageryStyle: setRealWorldImageryStyle,
          onDebugReset: () => {
            setDebugFlags({ ...DEFAULT_DEBUG_FLAGS });
            setTileDebug({ ...DEFAULT_TILE_DEBUG });
          },
          onTerrainGraph: (next) => {
            setTerrainGraph(next);
            scheduleRecordRef.current?.();
          },
          onProjectMode: setProjectMode,
          onGraphState: setGraphState,
          onGraphView: setGraphView,
        },
      });
    } catch (err) {
      if (cancelled) return;
      console.error('WebGL initialization failed', err);
      const message = err?.message || 'Could not create a WebGL context.';
      setWebglError(message);
      setStatus({ text: 'WebGL unavailable', busy: false });
      bootedRef.current = true;
      loadingRef.current.done('boot');
      landingRef.current?.setBootReady(true);
      return;
    }

    if (cancelled) {
      engine?.dispose();
      return;
    }

    engine.setCullingEnabled(cullingEnabled);
    engine.setBehindCameraCulling(behindCameraCulling);
    engineRef.current = engine;
    // seed the undo history baseline from the freshly-built default project
    try { historyRef.current = { past: [], future: [], present: JSON.stringify(engine.serializeState()) }; } catch { /* ignore */ }
    setGpu(engine.gpuName);
    if (landingRef.current?.visible && !landingRef.current?.exiting) {
      engine.setLandingShowcase(true);
    }
    if (import.meta.env.DEV) window.terrainStudio = engine;
    // safety: never leave the boot overlay stuck, but do not reveal the canvas
    // while the first studio frame is still being compiled/prepared.
    bootTimer = setTimeout(() => {
      const e = engineRef.current;
      if (!bootedRef.current && (!e || e._disposed || (!e._bootPending && !e._compiling))) {
        bootedRef.current = true;
        loadingRef.current.done('boot');
        landingRef.current?.setBootReady(true);
      }
    }, 30000);
    };

    init();

    return () => {
      cancelled = true;
      if (bootTimer) clearTimeout(bootTimer);
      engine?.dispose();
      engineRef.current = null;
      if (import.meta.env.DEV && window.terrainStudio === engine) window.terrainStudio = null;
    };
  }, []);

  useEffect(() => {
    if (!import.meta.hot) return undefined;
    const disposeEngine = () => {
      const e = engineRef.current;
      if (!e) return;
      e.dispose();
      engineRef.current = null;
      if (import.meta.env.DEV && window.terrainStudio === e) window.terrainStudio = null;
    };
    import.meta.hot.dispose(disposeEngine);
    return disposeEngine;
  }, []);

  const engine = () => engineRef.current;

  const setCurrentProject = useCallback((project) => {
    activeProjectRef.current = project;
    setActiveProject(project);
  }, []);

  const saveCurrentProject = useCallback(async (metadata = null) => {
    const eng = engineRef.current;
    if (!eng) return null;
    const current = activeProjectRef.current;
    let thumbnail = null;
    try { thumbnail = eng.capturePreviewThumbnail?.() || null; } catch { /* thumbnail capture is best effort */ }
    if (!thumbnail) {
      try { thumbnail = canvasRef.current?.toDataURL?.('image/webp', 0.72) || null; } catch { /* canvas capture is best effort */ }
    }
    thumbnail ||= current?.metadata?.thumbnail ?? null;
    const project = normalizeProject({
      id: current?.id,
      metadata: {
        ...current?.metadata,
        ...(metadata ?? {}),
        thumbnail,
      },
      terrain: eng.createProjectPayload(),
      exportHistory: current?.exportHistory ?? [],
    });
    const saved = await projectStore.save(project);
    setCurrentProject(saved);
    showToast(`Saved ${saved.metadata.name}`, 'success');
    return saved;
  }, [setCurrentProject, showToast]);

  const loadProjectJSON = useCallback(async (json) => {
    if (!json) return showToast('Could not parse project file', 'error');
    if (json.terrain) {
      const project = normalizeProject(json);
      if (project.terrain.editorMode === 'nodes' && worldModeRef.current !== 'studio') {
        await runModeSwitchRef.current('studio', { silent: true });
      }
      await engineRef.current?.loadSeedJSON(project.terrain);
      setCurrentProject(project);
      return showToast(`Opened ${json.metadata?.name ?? 'terrain project'}`, 'success');
    }
    const terrain = normalizeProject({ terrain: json }).terrain;
    if (terrain.editorMode === 'nodes' && worldModeRef.current !== 'studio') {
      await runModeSwitchRef.current('studio', { silent: true });
    }
    await engineRef.current?.loadSeedJSON(terrain);
    setCurrentProject(null);
  }, [setCurrentProject, showToast]);

  const loadProjectFile = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { loadProjectJSON(JSON.parse(reader.result)); }
      catch { loadProjectJSON(null); }
    };
    reader.readAsText(file);
  }, [loadProjectJSON]);

  const hasFileDrag = (e) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

  const onFileDragEnter = useCallback((e) => {
    if (!hasFileDrag(e)) return;
    e.preventDefault();
    fileDragDepthRef.current += 1;
    setFileDragActive(true);
  }, []);

  const onFileDragOver = useCallback((e) => {
    if (!hasFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onFileDragLeave = useCallback((e) => {
    if (!hasFileDrag(e)) return;
    e.preventDefault();
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
    if (fileDragDepthRef.current === 0) setFileDragActive(false);
  }, []);

  const onFileDrop = useCallback((e) => {
    if (!hasFileDrag(e)) return;
    e.preventDefault();
    fileDragDepthRef.current = 0;
    setFileDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) loadProjectFile(file);
  }, [loadProjectFile]);

  const downloadCurrentProject = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const current = activeProjectRef.current;
    const project = normalizeProject({
      id: current?.id,
      metadata: { ...current?.metadata },
      terrain: eng.createProjectPayload(),
      exportHistory: current?.exportHistory ?? [],
    });
    const name = project.metadata?.name || 'terrain';
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'terrain';
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(`Downloaded ${name}`, 'success');
  }, [showToast]);

  const createProjectFromTemplate = useCallback(async (templateId = 'blank', { editorMode = 'procedural' } = {}) => {
    const eng = engineRef.current;
    if (!eng) return;
    const nextMode = editorMode === 'nodes' ? 'nodes' : 'procedural';
    if (nextMode === 'nodes') loadNodeWorkspace().catch(() => {});
    const template = nextMode === 'nodes' ? getNodeProjectTemplate(templateId) : getProjectTemplate(templateId);
    landingPreviewActiveRef.current = false;
    landingPreviewSessionRef.current += 1;
    if (nextMode === 'nodes' && worldModeRef.current !== 'studio') {
      await runModeSwitchRef.current('studio', { silent: true });
    }
    eng.newProject({ projectMode: nextMode });
    // A new terrain is a new document. Do not let saveCurrentProject reuse the
    // id of whichever project was previously open.
    setCurrentProject(null);
    // Every launch starts from the Root's session seed; give each chosen
    // template a stable-but-fresh variant instead of reverting to seed 1337.
    const baseSeed = Number(landingRef.current?.sessionSeed) || ((Math.random() * 0xffffffff) >>> 0);
    const catalog = nextMode === 'nodes' ? NODE_PROJECT_TEMPLATES : PROJECT_TEMPLATES;
    const templateOffset = catalog.findIndex((item) => item.id === template.id) + 1;
    eng.setParam('seed', (baseSeed + templateOffset * 0x9e3779b9) >>> 0);
    if (nextMode === 'nodes') {
      const graphResult = eng.setTerrainGraph(createNodeTemplateGraph(template.id), { structural: true, silent: true, atomic: true });
      await graphResult?.ready;
    } else {
      if (template.preset !== 'highlands') eng.applyPresetByKey(template.preset);
      await eng.rebuildActiveHeightProgram({ label: 'Loading procedural terrain', atomic: true });
    }
    const metadata = nextMode === 'nodes'
      ? {
        name: template.id === 'nodes-blank' ? 'Nodes Terrain' : template.name,
        description: template.description,
        tags: ['nodes', template.id],
      }
      : { name: template.name, description: template.description, tags: [template.id] };
    const project = await saveCurrentProject(metadata);
    if (project) showToast(`${template.name} project created`, 'success');
  }, [saveCurrentProject, showToast]);

  useEffect(() => {
    const stopLandingPreviews = () => {
      landingPreviewActiveRef.current = false;
      landingPreviewSessionRef.current += 1;
    };
    const onNewProject = (event) => {
      createProjectFromTemplate(event.detail?.templateId ?? 'blank', { editorMode: event.detail?.editorMode ?? 'procedural' });
    };
    const onOpenProject = async (event) => {
      const project = event.detail?.project;
      const eng = engineRef.current;
      if (!project?.terrain || !eng) return;
      stopLandingPreviews();
      const normalized = normalizeProject(project);
      if (normalized.terrain.editorMode === 'nodes') loadNodeWorkspace().catch(() => {});
      if (normalized.terrain.editorMode === 'nodes' && worldModeRef.current !== 'studio') {
        await runModeSwitchRef.current('studio', { silent: true });
      }
      await eng.loadSeedJSON(normalized.terrain);
      setCurrentProject(normalized);
      showToast(`Opened ${normalized.metadata?.name ?? 'terrain project'}`, 'success');
    };
    const previewSeed = (templateId, editorMode = 'procedural') => {
      const catalog = editorMode === 'nodes' ? NODE_PROJECT_TEMPLATES : PROJECT_TEMPLATES;
      const index = Math.max(0, catalog.findIndex((item) => item.id === templateId));
      const base = Number(landingRef.current?.sessionSeed) || 1337;
      return (base + (index + 1) * 0x9e3779b9) >>> 0;
    };
    const captureTemplateThumbnail = async (templateId, { silent = true, editorMode = 'procedural', session = landingPreviewSessionRef.current } = {}) => {
      const eng = engineRef.current;
      if (!landingPreviewActiveRef.current || session !== landingPreviewSessionRef.current || !eng || !canvasRef.current || !landingRef.current?.visible || landingRef.current?.exiting) return;
      const nextMode = editorMode === 'nodes' ? 'nodes' : 'procedural';
      const template = nextMode === 'nodes' ? getNodeProjectTemplate(templateId) : getProjectTemplate(templateId);
      if (nextMode === 'nodes' && worldModeRef.current !== 'studio') {
        await runModeSwitchRef.current('studio', { silent: true });
      }
      if (!landingPreviewActiveRef.current || session !== landingPreviewSessionRef.current || landingRef.current?.exiting) return;
      eng.newProject({ silent, projectMode: nextMode });
      eng.setParam('seed', previewSeed(template.id, nextMode));
      if (nextMode === 'nodes') {
        const graphResult = eng.setTerrainGraph(createNodeTemplateGraph(template.id), { structural: true, silent: true, atomic: true });
        await graphResult?.ready;
      } else {
        if (template.preset !== 'highlands') eng.applyPresetByKey(template.preset);
        await eng.rebuildActiveHeightProgram({ label: 'Loading procedural terrain', atomic: true });
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise((resolve) => window.setTimeout(resolve, nextMode === 'nodes' ? 260 : 100));
      if (!landingPreviewActiveRef.current || session !== landingPreviewSessionRef.current || landingRef.current?.exiting) return;
      const image = eng.capturePreviewThumbnail();
      const cacheKey = nextMode === 'nodes' ? nodeTemplatePreviewCacheKey(template.id) : projectTemplatePreviewCacheKey(template.id);
      try { sessionStorage.setItem(cacheKey, image); } catch { /* cache is optional */ }
      window.dispatchEvent(new CustomEvent('terrain-template:thumbnail', { detail: { templateId: template.id, editorMode: nextMode, image } }));
    };
    const queueTemplatePreview = (templateId, options) => {
      const session = landingPreviewSessionRef.current;
      templatePreviewQueueRef.current = templatePreviewQueueRef.current
        .then(() => captureTemplateThumbnail(templateId, { ...options, session }))
        .catch(() => {});
      return templatePreviewQueueRef.current;
    };
    const onPreviewTemplate = (event) => {
      if (!landingRef.current?.visible || landingRef.current?.exiting) return;
      if (event.detail?.editorMode === 'nodes') loadNodeWorkspace().catch(() => {});
      landingPreviewActiveRef.current = true;
      // Every explicit selection owns a fresh session so an older queued
      // procedural preview can never overwrite it.
      landingPreviewSessionRef.current += 1;
      queueTemplatePreview(event.detail?.templateId ?? 'blank', { editorMode: event.detail?.editorMode ?? 'procedural' });
    };
    window.addEventListener('terrain-project:new', onNewProject);
    window.addEventListener('terrain-project:open', onOpenProject);
    window.addEventListener('terrain-template:preview', onPreviewTemplate);
    return () => {
      window.removeEventListener('terrain-project:new', onNewProject);
      window.removeEventListener('terrain-project:open', onOpenProject);
      window.removeEventListener('terrain-template:preview', onPreviewTemplate);
    };
  }, [createProjectFromTemplate, setCurrentProject, showToast]);

  // Params that rebuild the whole world geometry (planet radius / surface
  // detail, board chunk layout). The rebuild briefly freezes the main thread,
  // so run it behind a blocking loading overlay with a yield first — the
  // overlay paints, then the engine rebuilds, then we wait out any background
  // shader compile (same pattern as a mode switch).
  const HEAVY_PARAMS = new Set(['planetRadius', 'planetFaceGrid', 'chunkCount', 'chunkSize']);
  const HEAVY_LABEL = {
    planetRadius: 'Resizing planet…', planetFaceGrid: 'Rebuilding planet…',
    chunkCount: 'Rebuilding board…', chunkSize: 'Rebuilding board…',
  };
  const onParam = (key, value) => {
    const eng = engine();
    if (!eng) return;
    if (!HEAVY_PARAMS.has(key)) { eng.setParam(key, value); return; }
    loading.run('param-rebuild', { blocking: true, label: HEAVY_LABEL[key] ?? 'Rebuilding…', detail: 'Generating new geometry…' }, async (update) => {
      blockingUpdateRef.current = update;
      eng.setParam(key, value);   // synchronous geometry rebuild (overlay already painted)
      // wait out any background shader recompile the rebuild kicked off
      await new Promise((resolve) => {
        const startT = performance.now();
        const tick = () => {
          const e = engineRef.current;
          if (!e || e._disposed) return resolve();
          const elapsed = performance.now() - startT;
          if (!e._compiling && elapsed > 80) return resolve();
          if (elapsed > 30000) return resolve();   // safety net
          setTimeout(tick, 80);
        };
        setTimeout(tick, 80);
      });
      blockingUpdateRef.current = null;
    });
  };

  const planetStyleProps = {
    planetStyle: params.planetStyle,
    planetPreset: params.planetPreset ?? 'earth',
    palettePreset: params.palettePreset ?? 'earth',
    terrainSeed: params.seed,
    onPlanetPreset: (key) => engine().applyPlanetPresetByKey(key),
    onRandomPlanet: () => engine().randomizePlanetPreset(),
    onPalettePreset: (key) => engine().applyPalettePresetByKey(key),
    onGeneratePalette: (opts) => engine().generatePalette(opts),
    onColorChange: (key, rgb) => engine().setPlanetStyleColor(key, rgb),
    onTuning: (key, v) => engine().setPlanetStyleTuning(key, v),
    onNoisePreset: (key) => engine().applyNoisePresetByKey(key),
    onExportStyle: () => engine().exportPlanetStyle(),
    onImportStyle: (json) => json && engine().importPlanetStyleJSON(json),
  };

  // ---- mode switching: blocking overlay + transition lock ----
  // The heavy part is the ASYNC shader compile the engine kicks off after the
  // synchronous geometry build (FXC can take ~15-20s on this GPU), during which
  // the engine skips rendering. We keep the loader up until `engine._compiling`
  // drops back to 0 so the user always sees what's happening.
  const modeLockRef = useRef(false);
  const [modeLocked, setModeLocked] = useState(false);
  const BUILD_STEP = { studio: 'Building terrain board…', infinite: 'Streaming world chunks…', planet: 'Building spherical mesh…' };
  // Returns a promise that resolves once the (heavy, async) mode switch has
  // finished compiling. `silent` suppresses the success/info toasts — used by
  // the undo/redo restore path so reverting across modes is quiet.
  const runModeSwitch = (next, { silent = false } = {}) => {
    if (next === worldMode || modeLockRef.current) return Promise.resolve();
    modeLockRef.current = true;
    setModeLocked(true);
    const label = MODE_LABEL[next] ?? next;
    if (!panelAvailable(activePanel, next)) setActivePanel(null);

    return loading.run('mode', { blocking: true, label: `Switching to ${label} mode…`, detail: 'Preparing scene…' }, async (update) => {
      blockingUpdateRef.current = update;
      update({ detail: BUILD_STEP[next] ?? 'Building scene…' });
      // yield so the overlay paints the build message before the sync build
      await new Promise((r) => setTimeout(r, 30));
      await engine().setWorldMode(next);      // sync build; kicks off async shader compile
      setWorldMode(next);

      // wait for the engine to finish compiling shaders (it raises onStatus
      // 'Compiling … shaders…' which feeds this task's detail line)
      await new Promise((resolve) => {
        const startT = performance.now();
        const tick = () => {
          const e = engineRef.current;
          if (!e || e._disposed) return resolve();
          const elapsed = performance.now() - startT;
          if (!e._compiling && elapsed > 160) { update({ detail: 'Finalizing…' }); return resolve(); }
          // long compiles get a reassuring message; hard cap so it never hangs forever
          if (e._compiling && elapsed > 6000) update({ detail: 'Compiling shaders… (this can take a while on first use)' });
          if (elapsed > 60000) return resolve();   // safety net
          setTimeout(tick, 120);
        };
        setTimeout(tick, 120);
      });
      await new Promise((r) => setTimeout(r, 80));
    }).then(() => {
      if (!silent) {
        showToast(`Switched to ${label} mode`, 'success');
        if (next === 'infinite') { setHelpVisible(false); showToast('Click to lock mouse', 'info'); }
        else if (next === 'planet') { setHelpVisible(false); }
      } else if (next !== 'studio') {
        setHelpVisible(false);
      }
    }).catch((e) => {
      console.error(e);
      if (!silent) showToast('Mode switch failed', 'error');
    }).finally(() => {
      blockingUpdateRef.current = null;
      modeLockRef.current = false;
      setModeLocked(false);
      scheduleRecordRef.current?.();   // guarded no-op while a restore is suppressed
    });
  };

  const selectWorldMode = (next) => { runModeSwitch(next); };
  const runModeSwitchRef = useRef(runModeSwitch);
  runModeSwitchRef.current = runModeSwitch;

  const selectExploreMode = (mode) => {
    if (exploreMode === 'freecam') {
      engine().setDebugFlag('freeCamNoClip', false);
      setDebugFlags((f) => ({ ...f, freeCamNoClip: false }));
      if (mode === 'freecam') {
        scheduleRecordRef.current?.();
        return;
      }
    }
    const next = exploreMode === mode ? 'none' : mode;
    engine().setExploreMode(next);
  };
  const handleQualityChange = (key) => { engine().setQuality(key); setQualityPreset(key); };
  const handleTimeOfDay = (value) => { engine().setTimeOfDay(value); setTimeOfDay(value); };
  const handleBehindCameraCulling = (enabled) => { engine().setBehindCameraCulling(enabled); setBehindCameraCulling(enabled); scheduleRecordRef.current?.(); };
  const handleCullingEnabled = (enabled) => { engine().setCullingEnabled(enabled); setCullingEnabled(enabled); scheduleRecordRef.current?.(); };
  const handleDebugFlag = (key, value) => {
    engine().setDebugFlag(key, value);
    setDebugFlags((f) => ({ ...f, [key]: value }));
    scheduleRecordRef.current?.();
  };
  const handleTouchInput = useCallback((input) => {
    engineRef.current?.setTouchInput(input);
  }, []);

  // ---------------------------------------------------------- undo / redo
  worldModeRef.current = worldMode;

  const captureSnapshot = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return null;
    try {
      const state = eng.serializeState();
      const rev = state.paintRev ?? 0;
      // dedupe the heavy paint blob: store one copy per revision, referenced
      // from the (tiny) snapshot string by its rev number.
      if (rev > 0 && !paintBlobsRef.current.has(rev)) {
        const blob = eng.serializePaint();
        if (blob) paintBlobsRef.current.set(rev, blob);
      }
      // same dedupe for the heavy baked-erosion blob (delta grid + masks).
      const erev = state.erosionRev ?? 0;
      if (erev > 0 && !erosionBlobsRef.current.has(erev)) {
        const blob = eng.serializeErosion();
        if (blob) erosionBlobsRef.current.set(erev, blob);
      }
      return JSON.stringify(state);
    } catch (err) {
      console.warn('History snapshot failed', err);
      return null;
    }
  }, []);

  // Drop cached paint / erosion blobs no longer referenced by any history entry
  // so the dedupe maps can't grow without bound across many strokes / bakes.
  const prunePaintBlobs = useCallback(() => {
    const paintMap = paintBlobsRef.current;
    const erosionMap = erosionBlobsRef.current;
    if (paintMap.size <= 4 && erosionMap.size <= 4) return;
    const h = historyRef.current;
    const livePaint = new Set();
    const liveErosion = new Set();
    const collect = (s) => {
      try {
        const snap = JSON.parse(s);
        if (snap.paintRev) livePaint.add(snap.paintRev);
        if (snap.erosionRev) liveErosion.add(snap.erosionRev);
      } catch { /* ignore */ }
    };
    h.past.forEach(collect);
    h.future.forEach(collect);
    if (h.present) collect(h.present);
    for (const key of paintMap.keys()) if (!livePaint.has(key)) paintMap.delete(key);
    for (const key of erosionMap.keys()) if (!liveErosion.has(key)) erosionMap.delete(key);
  }, []);

  const recordHistory = useCallback(() => {
    const eng = engineRef.current;
    if (!eng || histSuppressRef.current) return;
    const snap = captureSnapshot();
    if (snap == null) return;
    const h = historyRef.current;
    if (h.present == null) { h.present = snap; return; }  // first run → baseline
    if (snap === h.present) return;                        // nothing actually changed
    h.past.push(h.present);
    if (h.past.length > HISTORY_LIMIT) h.past.shift();
    h.present = snap;
    h.future.length = 0;
    prunePaintBlobs();
    setHistState({ canUndo: h.past.length > 0, canRedo: false });
  }, [captureSnapshot, prunePaintBlobs]);

  const scheduleRecord = useCallback(() => {
    if (histSuppressRef.current) return;
    if (!bootedRef.current || landingRef.current?.visible) return;
    if (histTimerRef.current) clearTimeout(histTimerRef.current);
    histTimerRef.current = setTimeout(() => {
      histTimerRef.current = null;
      recordHistory();
    }, 350);
  }, [recordHistory]);
  scheduleRecordRef.current = scheduleRecord;

  const flushRecord = useCallback(() => {
    if (histTimerRef.current) { clearTimeout(histTimerRef.current); histTimerRef.current = null; }
    recordHistory();
  }, [recordHistory]);

  const applySnapshot = useCallback(async (snapStr) => {
    const eng = engineRef.current;
    if (!eng || !snapStr) return;
    let snap;
    try { snap = JSON.parse(snapStr); } catch { return; }
    histSuppressRef.current = true;
    try {
      // hydrate the heavy paint blob (kept out of the history string)
      snap.paint = (snap.paintRev ?? 0) > 0
        ? (paintBlobsRef.current.get(snap.paintRev) ?? null)
        : null;
      // and the heavy baked-erosion blob (delta grid + masks)
      snap.erosion = (snap.erosionRev ?? 0) > 0
        ? (erosionBlobsRef.current.get(snap.erosionRev) ?? null)
        : null;
      // a different world mode is a heavy, async rebuild — do it first (and
      // quietly) through the same blocking-overlay path as the mode bar.
      if (snap.worldMode && snap.worldMode !== worldModeRef.current) {
        await runModeSwitchRef.current(snap.worldMode, { silent: true });
      }
      eng.restoreState(snap);
      // sync the React mirrors the engine has no callback for
      setDebugFlags({ ...DEFAULT_DEBUG_FLAGS, ...(snap.debug || {}) });
      setCullingEnabled(snap.cullingEnabled !== false);
      setBehindCameraCulling(snap.behindCameraCulling !== false);
      // restoring paint bumps the live layer revision, so the live state now
      // serialises with a newer paintRev than the snapshot we navigated to.
      // Re-baseline `present` to the actual live state so the next edit diffs
      // against it (and we don't log a spurious "paintRev-only" history entry).
      const live = captureSnapshot();
      if (live) historyRef.current.present = live;
    } catch (err) {
      console.warn('History restore failed', err);
    } finally {
      // release after the synchronous callbacks settle (a structural noise-stack
      // change may fire onParams again on the next frame — keep it suppressed).
      setTimeout(() => { histSuppressRef.current = false; }, 60);
    }
  }, [captureSnapshot]);

  const undo = useCallback(() => {
    if (histSuppressRef.current || modeLockRef.current) return;
    flushRecord();
    const h = historyRef.current;
    if (!h.past.length) return;
    h.future.push(h.present);
    h.present = h.past.pop();
    setHistState({ canUndo: h.past.length > 0, canRedo: true });
    applySnapshot(h.present);
  }, [flushRecord, applySnapshot]);

  const redo = useCallback(() => {
    if (histSuppressRef.current || modeLockRef.current) return;
    flushRecord();
    const h = historyRef.current;
    if (!h.future.length) return;
    h.past.push(h.present);
    h.present = h.future.pop();
    setHistState({ canUndo: true, canRedo: h.future.length > 0 });
    applySnapshot(h.present);
  }, [flushRecord, applySnapshot]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
      else if (k === 's' && e.shiftKey) { e.preventDefault(); engineRef.current?.createSnapshot('Creator checkpoint'); }
      return;
      }
      const k = e.key.toLowerCase();
      if (k === 's') engineRef.current?.setSplineEditingEnabled(!splineState.enabled);
      else if (k === 'r' && e.shiftKey) engineRef.current?.createSpline('river');
      else if (k === 'r') engineRef.current?.createSpline('road');
      else if (k === 'a') engineRef.current?.setAnalysisSettings({ enabled: !analysisState.enabled });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, splineState.enabled, analysisState.enabled]);

  // ---- export: blocking overlay, button disabled via panel busy state ----
  const onExport = (options) => {
    exportFailedRef.current = false;
    return loading.run('export', { blocking: true, label: 'Exporting…', detail: 'Preparing scene…' }, async (update) => {
      blockingUpdateRef.current = update;
      try {
        const exported = await engine().export3DTerrain(options);
        if (!exported) exportFailedRef.current = true;
      } finally {
        blockingUpdateRef.current = null;
      }
    }).then(() => {
      if (!exportFailedRef.current) showToast('Export complete', 'success');
    });
  };

  const onExportScreenshot = () => { engine().exportScreenshot(); };
  const onExportHeightmap = () => { engine().exportHeightmap(); };

  const onRegenerate = () => {
    loading.run('regen', { blocking: false, label: 'Regenerating…' }, async () => {
      engine().regenerate();
      await new Promise((r) => setTimeout(r, 30));
    });
  };

  const onRandomizeTerrain = () => {
    engine().randomizeSeed();
    engine().regenerate();
  };

  const isStudio = worldMode === 'studio';
  const isInfinite = worldMode === 'infinite';
  const isPlanet = worldMode === 'planet';
  const paintMode = !!paintState?.enabled;
  const exploring = exploreMode !== 'none' && exploreMode !== 'freecam';
  const planetExploring = isPlanet && exploring;
  const fpsView = isInfinite || planetExploring;
  const touchExplore = isInfinite || exploring;
  const studioLike = isStudio || (isPlanet && !exploring);
  const showStudioUI = !previewMode && !paintMode && studioLike;
  const nodeToolsVisible = projectMode !== 'nodes' || uiPrefs.nodeToolsVisible !== false;
  const showToolPanels = !previewMode && !paintMode && !planetExploring && nodeToolsVisible;
  const searchEnabled = showToolPanels && projectMode === 'procedural';
  const nodesWorkspaceActive = projectMode === 'nodes' && isStudio && !previewMode && !paintMode && !landing?.visible;

  const handleTerrainGraphChange = useCallback((next, meta = {}) => {
    setTerrainGraph(next);
    pendingGraphRef.current = next;
    if (meta.structural) {
      if (graphUniformFrameRef.current) cancelAnimationFrame(graphUniformFrameRef.current);
      graphUniformFrameRef.current = null;
      if (graphCompileTimerRef.current) clearTimeout(graphCompileTimerRef.current);
      graphCompileTimerRef.current = setTimeout(() => {
        graphCompileTimerRef.current = null;
        const pending = pendingGraphRef.current;
        pendingGraphRef.current = null;
        if (pending) engineRef.current?.setTerrainGraph(pending, { structural: true });
      }, 200);
    } else if (!graphCompileTimerRef.current && !graphUniformFrameRef.current) {
      // Range inputs can emit faster than the display refresh rate. Repack the
      // latest uniform values once per frame instead of evaluating every
      // intermediate pointer event.
      graphUniformFrameRef.current = requestAnimationFrame(() => {
        graphUniformFrameRef.current = null;
        const pending = pendingGraphRef.current;
        pendingGraphRef.current = null;
        if (pending) engineRef.current?.setTerrainGraph(pending, { structural: false });
      });
    }
  }, []);

  const handleStartBlankGraph = useCallback((mode = 'terrain') => {
    if (graphCompileTimerRef.current) clearTimeout(graphCompileTimerRef.current);
    if (graphUniformFrameRef.current) cancelAnimationFrame(graphUniformFrameRef.current);
    graphUniformFrameRef.current = null;
    graphCompileTimerRef.current = null; pendingGraphRef.current = null;
    const next = createBlankGraph(mode);
    setTerrainGraph(next);
    engineRef.current?.setTerrainGraph(next, { structural: true });
  }, []);

  useEffect(() => () => {
    if (graphCompileTimerRef.current) clearTimeout(graphCompileTimerRef.current);
    if (graphUniformFrameRef.current) cancelAnimationFrame(graphUniformFrameRef.current);
  }, []);

  const handleGraphView = useCallback((next) => {
    setGraphView(next);
    engineRef.current?.setGraphView(next);
  }, []);

  const formatSearchValue = useCallback((item) => {
    const id = item.settingId;
    const paramsStyle = params.planetStyle ?? {};
    const palette = paramsStyle.palette ?? {};

    switch (id) {
      case 'terrain.heightScale': return num(params.heightScale, 0, ' m');
      case 'terrain.seaLevel': return num(params.seaLevel, 0, ' m');
      case 'terrain.noiseScale': return num(params.noiseScale, 1);
      case 'terrain.noiseStrength': return num(params.noiseStrength, 2);
      case 'terrain.terrainSmoothing': return num(params.terrainSmoothing, 2);
      case 'terrain.octaves': return String(params.octaves);
      case 'terrain.persistence': return num(params.persistence, 2);
      case 'terrain.lacunarity': return num(params.lacunarity, 2);
      case 'terrain.ridge': return num(params.ridge, 2);
      case 'terrain.warp': return num(params.warp, 2);
      case 'terrain.falloff': return num(params.falloff, 2);
      case 'terrain.normalStrength': return num(params.normalStrength, 2);
      case 'terrain.aoStrength': return num(params.aoStrength, 2);
      case 'visuals.normalStrength': return num(params.normalStrength, 2);
      case 'visuals.aoStrength': return num(params.aoStrength, 2);
      case 'visuals.aoRidge': return num(params.aoRidge ?? 0, 2);
      case 'visuals.visualsPixelatedEnabled': return yesNo(!!params.visualsPixelatedEnabled);
      case 'visuals.visualsPixelResolution': return `${Math.round(params.visualsPixelResolution ?? 240)}p`;
      case 'visuals.visualsDitheringEnabled': return yesNo(!!params.visualsDitheringEnabled);
      case 'visuals.visualsDitheringStrength': return num(params.visualsDitheringStrength ?? 0.65, 2);
      case 'visuals.visualsDitheringLevels': return String(Math.round(params.visualsDitheringLevels ?? 8));
      case 'visuals.visualsDitheringScale': return num(params.visualsDitheringScale ?? 2, 0, ' px');
      case 'visuals.visualsCrtEnabled': return yesNo(!!params.visualsCrtEnabled);
      case 'visuals.visualsCrtStrength': return num(params.visualsCrtStrength ?? 0.5, 2);
      case 'visuals.visualsCrtLensBend': return num(params.visualsCrtLensBend ?? 0.35, 2);
      case 'visuals.visualsCrtLineWidth': return num(params.visualsCrtLineWidth ?? 2, 2, ' px');
      case 'visuals.visualsChromaticAberrationEnabled': return yesNo(!!params.visualsChromaticAberrationEnabled);
      case 'visuals.visualsChromaticAberrationStrength': return num(params.visualsChromaticAberrationStrength ?? 1.5, 1, ' px');
      case 'terrain.heightMap':
      case 'terrain.noiseMap':
      case 'terrain.biomeMap':
        return params.importedMaps?.[id.split('.')[1]]?.fileName ?? 'No file';

      case 'biomes.biomeScale': return num(params.biomeScale, 2);
      case 'biomes.tempBias': return num(params.tempBias, 2);
      case 'biomes.moistScale': return num(params.moistScale, 2);
      case 'biomes.moistBias': return num(params.moistBias, 2);
      case 'biomes.snowLine': return num(params.snowLine, 2);
      case 'biomes.snowSlopeMin': return num(params.snowSlopeMin ?? 0.30, 2);
      case 'biomes.snowSlopeMax': return num(params.snowSlopeMax ?? 0.62, 2);
      case 'biomes.rockSlopeLo': return num(params.rockSlopeLo ?? 0.42, 2);
      case 'biomes.rockSlopeHi': return num(params.rockSlopeHi ?? 0.72, 2);
      case 'biomes.biomeDebug': return yesNo(params.biomeDebug);

      case 'world.chunkCount': return `${params.chunkCount} × ${params.chunkCount}`;
      case 'world.chunkSize': return String(params.chunkSize);
      case 'world.chunkGrid': return yesNo(params.chunkGrid);
      case 'world.planetRadius': return `${Math.round(params.planetRadius / 1000)}k`;
      case 'world.planetFaceGrid': return `${params.planetFaceGrid} / face`;

      case 'water.waterAnim': return yesNo(params.waterAnim);
      case 'water.waterMode': return params.waterMode ?? 'legacy';
      case 'water.waterEnabled': return yesNo(params.waterEnabled !== false && params.waterMode !== 'off');
      case 'water.seaLevel': return num(params.seaLevel, 0, ' m');

      case 'planet.water.deep': return hex(palette.deep);
      case 'planet.water.shallow': return hex(palette.shallow);
      case 'planet.water.foam': return hex(palette.foam);
      case 'planet.paletteSaturation': return num(paramsStyle.paletteSaturation ?? 1, 2);
      case 'planet.paletteContrast': return num(paramsStyle.paletteContrast ?? 1, 2);

      case 'performance.preset': return perf?.preset ?? 'high';
      case 'performance.rendererBackend': return labelRendererBackend(perf?.rendererBackend);
      case 'performance.gpuPreference': return labelGpuPreference(perf?.gpuPreference);
      case 'performance.useWorker': return yesNo(perf?.useWorker);
      case 'performance.autoPerf': return yesNo(perf?.autoPerf);
      case 'performance.onDemandStudio': return yesNo(perf?.onDemandStudio);
      case 'performance.renderScale': return num(perf?.renderScale, 2, 'x');
      case 'performance.resolutionDenoiseMode': return perf?.resolutionDenoiseMode === 'pixelated' ? 'Pixelated Denoise' : 'Clean Denoise';
      case 'performance.resolutionScale': return num(perf?.resolutionScale, 2, 'x');
      case 'performance.lodDistanceScale': return num(perf?.lodDistanceScale, 2, 'x');
      case 'performance.viewRadius': return `${perf?.viewRadius ?? '—'} chunks`;
      case 'performance.maxCreatesPerFrame': return String(perf?.maxCreatesPerFrame ?? '—');
      case 'performance.triangleBudget': return `${num((perf?.triangleBudget ?? 0) / 1e6, 1)}M`;
      case 'performance.cullingAggressiveness': return num(perf?.cullingAggressiveness, 1);
      case 'performance.waterQuality':
        return ({ 0: 'Low', 1: 'Medium', 2: 'High' }[perf?.waterQuality] ?? 'Custom');
      case 'performance.waterReflection': return num(perf?.waterReflection, 2, 'x');
      case 'performance.waterDetail': return num(perf?.waterDetail, 2, 'x');
      case 'performance.waterWaves': return num(perf?.waterWaves, 2, 'x');
      case 'performance.underwaterEffect': return yesNo(perf?.underwaterEffect !== false);
      case 'performance.waterDistance': return num(perf?.waterDistance, 2, 'x');
      case 'performance.fogDistance': return num(perf?.fogDistance, 2, 'x');
      case 'performance.terrainDetailQuality':
        return ({ 0: 'Off', 1: 'Low', 2: 'Medium', 3: 'High' }[perf?.terrainDetailQuality] ?? 'High');
      case 'performance.terrainDetailScale': return num(perf?.terrainDetailScale, 2, 'x');
      case 'performance.terrainDetailStrength': return num(perf?.terrainDetailStrength, 2, 'x');
      case 'performance.terrainDetailNormal': return num(perf?.terrainDetailNormal, 2, 'x');
      case 'performance.terrainDetailNear': return num(perf?.terrainDetailNear, 0, 'm');
      case 'performance.terrainDetailFar': return num(perf?.terrainDetailFar, 0, 'm');
      case 'performance.terrainRockSlope': return num(perf?.terrainRockSlope, 2);
      case 'performance.terrainRockSharpness': return num(perf?.terrainRockSharpness, 2);
      case 'performance.terrainTriplanar': return yesNo(perf?.terrainTriplanar !== false);
      case 'performance.terrainShoreRange': return num(perf?.terrainShoreRange, 0, 'm');
      case 'performance.terrainShoreWetness': return num(perf?.terrainShoreWetness, 2, 'x');
      case 'performance.cloudFallback': return perf?.cloudFallback ?? 'none';
      case 'performance.cloudSteps': return `${perf?.cloudSteps ?? '—'} steps`;
      case 'performance.cloudSelfShadow': return yesNo(perf?.cloudSelfShadow !== false);
      case 'performance.cloudLightMode': return yesNo(!!perf?.cloudLightMode);
      case 'performance.cloudLightSteps': return `${perf?.cloudLightSteps ?? '—'} steps`;
      case 'performance.cloudStepLOD': return yesNo(!!perf?.cloudStepLOD);
      case 'performance.cloudOctaves': return String(perf?.cloudOctaves ?? '—');
      case 'performance.cloudDetailOctaves': return String(perf?.cloudDetailOctaves ?? '—');
      case 'performance.cloudUseErosion': return yesNo(perf?.cloudUseErosion !== false);
      case 'performance.cloudMaxDistance': return num(perf?.cloudMaxDistance, 1, 'x');

      case 'skybox.timeOfDay': return formatTimeOfDay(timeOfDay);
      case 'skybox.skyboxEnabled': return yesNo(params.skyboxEnabled !== false);
      case 'skybox.skyboxBrightness': return num(params.skyboxBrightness ?? 1, 2);
      case 'skybox.skyboxHaze': return num(params.skyboxHaze ?? 0.55, 2);
      case 'skybox.skyboxStars': return yesNo(params.skyboxStars !== false);

      case 'lighting.sunAzimuth': return `${Math.round(params.sunAzimuth ?? 0)}°`;
      case 'lighting.sunElevation': return `${Math.round(params.sunElevation ?? 0)}°`;
      case 'lighting.sunColor': return hex(paramsStyle.sunColor);
      case 'lighting.sunIntensity': return num(paramsStyle.sunIntensity ?? 1.25, 2);
      case 'lighting.fogDensity': return num(params.fogDensity, 2);
      case 'lighting.skyAmbient': return hex(paramsStyle.skyAmbient);
      case 'lighting.groundBounce': return hex(paramsStyle.groundBounce);

      case 'clouds.cloudsEnabled': return yesNo(params.cloudsEnabled);
      case 'clouds.cloudCoverage': return num(params.cloudCoverage ?? 0, 2);
      case 'clouds.cloudDensity': return num(params.cloudDensity ?? 0, 2);
      case 'clouds.cloudSoftness': return num(params.cloudSoftness ?? 0, 2);
      case 'clouds.cloudAltitude': return num(params.cloudAltitude ?? 0, 0, 'm');
      case 'clouds.cloudThickness': return num(params.cloudThickness ?? 0, 0, 'm');
      case 'clouds.cloudScale': return num(params.cloudScale ?? 0, 1);
      case 'clouds.cloudDetailScale': return num(params.cloudDetailScale ?? 0, 1);
      case 'clouds.cloudDetailStrength': return num(params.cloudDetailStrength ?? 0, 2);
      case 'clouds.cloudErosionScale': return num(params.cloudErosionScale ?? 0, 1);
      case 'clouds.cloudErosionStrength': return num(params.cloudErosionStrength ?? 0, 2);
      case 'clouds.cloudWindDir': return `${Math.round(params.cloudWindDir ?? 0)}°`;
      case 'clouds.cloudWindSpeed': return num(params.cloudWindSpeed ?? 0, 2);
      case 'clouds.cloudRotationSpeed': return num(params.cloudRotationSpeed ?? 0, 2);
      case 'clouds.cloudLightAbsorption': return num(params.cloudLightAbsorption ?? 0, 2);
      case 'clouds.cloudShadowStrength': return num(params.cloudShadowStrength ?? 0, 2);
      case 'clouds.cloudScatteringStrength': return num(params.cloudScatteringStrength ?? 0, 2);
      case 'clouds.cloudNoiseVariant': return String(params.cloudNoiseVariant ?? 'default');
      case 'clouds.cloudColor': return hex(params.cloudColor);
      case 'clouds.cloudShadowColor': return hex(params.cloudShadowColor);

      case 'debug.autoUpdate': return yesNo(params.autoUpdate);
      case 'debug.freezeCulling': return yesNo(!!debugFlags.freezeCulling);
      case 'debug.freezeLod': return yesNo(!!debugFlags.freezeLod);
      case 'debug.forceRender': return yesNo(!!debugFlags.forceRender);
      case 'debug.disableHeightBake': return yesNo(!!debugFlags.disableHeightBake);
      case 'debug.mergeDebug': return yesNo(!!debugFlags.mergeDebug);
      case 'debug.terrainDetailDebug': return String(debugFlags.terrainDetailDebug ?? 'off');

      case 'export.format': return 'GLB / GLTF';
      default:
        if (item?.isSection) return 'Section';
        return 'Set';
    }
  }, [params, perf, timeOfDay, debugFlags]);

  const settingsSearchResults = useMemo(() => {
    if (!settingsSearchOpen || !searchEnabled) return [];
    return searchSettings(settingsSearchQuery, (panelId) => panelAvailable(panelId, worldMode))
      .map((item) => ({ ...item, valueText: formatSearchValue(item) }));
  }, [settingsSearchOpen, settingsSearchQuery, searchEnabled, worldMode, formatSearchValue]);

  const groupedSettingsSearchResults = useMemo(() => {
    const map = new Map();
    settingsSearchResults.forEach((item, flatIndex) => {
      const entry = map.get(item.panelId) ?? {
        panelId: item.panelId,
        panelLabel: getPanelDisplay(item.panelId, worldMode).label,
        items: [],
      };
      entry.items.push({ ...item, flatIndex });
      map.set(item.panelId, entry);
    });
    const order = new Map(PANEL_ORDER.map((id, index) => [id, index]));
    return [...map.values()]
      .sort((a, b) => (order.get(a.panelId) ?? 999) - (order.get(b.panelId) ?? 999))
      .map((group) => ({ ...group, items: group.items.sort((a, b) => a.flatIndex - b.flatIndex) }));
  }, [settingsSearchResults, worldMode]);

  const openSettingsSearch = () => {
    if (!searchEnabled) return;
    setSettingsSearchOpen(true);
  };

  const closeSettingsSearch = () => {
    setSettingsSearchOpen(false);
    setSettingsSearchIndex(0);
  };

  const confirmSettingsSearch = (index = settingsSearchIndex) => {
    const item = settingsSearchResults[index];
    if (!item) return;
    setActivePanel(item.panelId);
    setSettingsTarget({
      panelId: item.panelId,
      tabId: item.tabId ?? null,
      subTabId: item.subTabId ?? null,
      perfTabId: item.perfTabId ?? null,
      sectionLabel: item.sectionLabel ?? null,
      settingId: item.settingId,
      label: item.label,
      isSection: !!item.isSection,
    });
    closeSettingsSearch();
  };

  const confirmSettingsSearchPanel = (panelId) => {
    if (!panelAvailable(panelId, worldMode)) return;
    setActivePanel(panelId);
    setSettingsTarget(null);
    closeSettingsSearch();
  };

  useEffect(() => {
    if (!searchEnabled && settingsSearchOpen) closeSettingsSearch();
  }, [searchEnabled, settingsSearchOpen]);

  useEffect(() => {
    setSettingsSearchIndex((cur) => (settingsSearchResults.length ? Math.min(cur, settingsSearchResults.length - 1) : 0));
  }, [settingsSearchResults.length]);

  useEffect(() => {
    if (!searchEnabled) return;
    const onKeyDown = (e) => {
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === 'k') {
        e.preventDefault();
        openSettingsSearch();
        return;
      }
      if (e.key === 'Escape' && settingsSearchOpen) {
        e.preventDefault();
        closeSettingsSearch();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [settingsSearchOpen, searchEnabled]);

  useEffect(() => {
    if (!uiSettingsOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setUiSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [uiSettingsOpen]);

  const projectPanelAvailable = (id) => projectMode !== 'nodes' || NODE_PANEL_IDS.includes(id);
  const togglePanel = (id) => {
    if (!projectPanelAvailable(id)) return;
    setActivePanel((cur) => (cur === id ? null : id));
  };
  const effectivePanel = showToolPanels && panelAvailable(activePanel, worldMode) && projectPanelAvailable(activePanel) ? activePanel : null;
  const drawerOpen = !!effectivePanel;
  const toolsRailAttr = toolsRailLayout.edge ?? 'left';
  const drawerSideAttr = drawerLayout.side ?? 'right';

  const handleToolsRailLayout = useCallback((next) => {
    setToolsRailLayout(next);
    saveToolsRailLayout(next);
  }, []);

  const handleDrawerLayout = useCallback((next) => {
    setDrawerLayout(next);
    saveDrawerLayout(next);
  }, []);

  const handleUiPrefs = useCallback((next) => {
    setUiPrefs(next);
    saveUiPrefs(next);
  }, []);

  const block = blockingTask(loading.tasks);
  const nonBlock = nonBlockingTask(loading.tasks);
  const showBlockingOverlay = block && !landing?.visible;

  useLayoutEffect(() => {
    if (!showStudioUI || !isStudio || !engineRef.current) return;
    if (nodesWorkspaceActive && !nodesPreviewVisible) {
      engineRef.current.setMinimapCanvases(null, null);
      return;
    }
    engineRef.current.setMinimapCanvases(minimapBaseRef.current, minimapOverlayRef.current);
  }, [showStudioUI, isStudio, effectivePanel, nodesWorkspaceActive, nodesPreviewVisible]);

  const landingMode = landing?.visible;
  const landingActive = landing?.visible && !landing?.exiting;

  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.setLandingShowcase(landingActive);
  }, [landingActive]);

  // Once the landing showcase finishes, re-baseline the undo history to the
  // state the user actually starts editing from (so the first Ctrl+Z doesn't
  // jump back into a showcase preset). Only while no edits have been made yet.
  useEffect(() => {
    if (landingActive || !bootedRef.current) return;
    const h = historyRef.current;
    if (h.past.length === 0 && h.future.length === 0) {
      const snap = captureSnapshot();
      if (snap) h.present = snap;
    }
  }, [landingActive, captureSnapshot]);

  useEffect(() => {
    if (!settingsTarget || !showToolPanels) return undefined;
    let cancelled = false;
    let attempts = 0;
    const run = () => {
      if (cancelled) return;
      const target = document.querySelector(`[data-setting-id="${settingsTarget.settingId}"]`);
      if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        target.classList.add('setting-target-flash');
        window.setTimeout(() => target.classList.remove('setting-target-flash'), 1200);
        setSettingsTarget(null);
        return;
      }
      attempts += 1;
      if (attempts < 12) {
        window.setTimeout(run, 80);
      } else {
        setSettingsTarget(null);
      }
    };
    const timer = window.setTimeout(run, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [settingsTarget, showToolPanels, effectivePanel]);

  const applySurfaceTextures = useCallback(async ({ source, force = false } = {}) => {
    const eng = engineRef.current;
    if (!eng) return { anyPresent: false };
    const surfaceTextureSource = normalizeSurfaceTextureSource({ surfaceTextureSource: source ?? eng.params?.surfaceTextureSource, surfaceTextureMode: eng.params?.surfaceTextureMode });
    if (!sourceUsesTextureAtlas(surfaceTextureSource)) return { anyPresent: false, source: surfaceTextureSource };
    if (!force && eng.installCachedSurfaceAtlas?.(surfaceTextureSource)) {
      const cached = eng.getCachedSurfaceAtlas?.(surfaceTextureSource);
      return {
        anyPresent: !!cached?.anyPresent,
        bakedAt: cached?.bakedAt,
        coverage: cached?.coverage,
        layers: cached?.layers,
        source: surfaceTextureSource,
        cached: true,
      };
    }
    const atlas = await buildActiveSurfaceAtlas({ source: surfaceTextureSource });
    eng.setSurfaceAtlas(atlas, surfaceTextureSource);
    return {
      anyPresent: atlas.anyPresent,
      bakedAt: atlas.bakedAt,
      coverage: atlas.coverage,
      layers: atlas.layers,
      source: surfaceTextureSource,
      cached: false,
    };
  }, []);

  useEffect(() => {
    const source = normalizeSurfaceTextureSource(params);
    if (!sourceUsesTextureAtlas(source) || !engineRef.current) return;
    applySurfaceTextures({ source }).catch((err) => {
      console.warn('Could not bake terrain surface textures', err);
    });
  }, [params.surfaceTextureSource, params.surfaceTextureMode, applySurfaceTextures]);

  const handleResetPanel = useCallback((id) => {
    if (id === 'terrain') resetSurfaceLibraryState();
    engineRef.current?.resetPanelSettings(id);
  }, []);

  const ctx = {
    params, worldMode, onParam,
    settingsTarget,
    settingsSearchOpen,
    onSettingsTargetHandled: () => setSettingsTarget(null),
    onPreset: (key) => engine().applyPresetByKey(key),
    onRandomizeSeed: () => engine().randomizeSeed(),
    onRandomizeTerrain,
    onRegenerate,
    planetStyleProps,
    onStyleTuning: (key, v) => engine().setPlanetStyleTuning(key, v),
    camInfo, camMode,
    onMode: (mode) => { engine().setCameraMode(mode); setCamMode(mode); },
    onFov: (fov) => engine().setFov(fov),
    onFocusCenter: () => engine().focusCenter(),
    lodCounts, chunkCount, boardSize, visibleChunks, culledChunks,
    cullingEnabled, behindCameraCulling,
    onCullingEnabled: handleCullingEnabled, onBehindCameraCulling: handleBehindCameraCulling,
    debugFlags, onDebugFlag: handleDebugFlag,
    onResetPanel: handleResetPanel,
    onApplySurfaceTextures: applySurfaceTextures,
    stats, gpu, perf,
    rendererInfo: engineRef.current ? {
      ...(engineRef.current.rendererConfig || {}),
      capabilities: engineRef.current.rendererCapabilities,
    } : null,
    onPerfPreset: (key) => engine().setPerfPreset(key),
    onPerfSetting: (key, value) => engine().setPerfSetting(key, value),
    onCloudQuality: (key) => engine().setCloudQuality(key),
    onExportWaterMasks: (opts) => engine().exportWaterMasks(opts),
    // bake / clear change the baked delta (a heavy, non-param edit) — record a
    // history entry afterwards so the whole bake is a single Ctrl+Z away.
    onErosionBake: async (onProgress) => {
      const ok = await engine().bakeErosion({ onProgress });
      if (ok) flushRecord();
      return ok;
    },
    onErosionReset: () => { engine().clearErosion(); flushRecord(); },
    onErosionPreset: (key) => engine().applyErosionPreset(key),
    erosionHasResult: engineRef.current?.erosionField?.hasResult?.() ?? false,
    onPerfReset: () => engine().resetPerfSettings(),
    timeOfDay, onTimeOfDay: handleTimeOfDay,
    onExport, onExportScreenshot, onExportHeightmap,
    onNoiseStack: (stack) => engine().setNoiseStack(stack),
    tileDebug, importedMaps,
    tiles, tileGridSize: 5, tileGridExtent: 2, tileAssemblyShape, diskRadiusCells,
    onTileAssemblyShape: (shape) => engine().setTileAssemblyShape(shape),
    onRemoveTile: (cx, cz) => engine().removeTile(cx, cz),
    onTileDebug: (next) => engine().setTileDebug(next),
    onImportTileMap: (type, file) => engine().importTileMap(type, file),
    onTileMapSetting: (type, key, value) => engine().setTileMapSetting(type, key, value),
    onLoadRealWorldLocation: (id, opts) => engine().loadRealWorldLocation(id, opts),
    onLoadRealWorldCustom: (spec, opts) => engine().loadRealWorldCustom(spec, opts),
    realWorldImageryStyle,
    onRealWorldImageryStyle: (style) => engine().setRealWorldImageryStyle(style),
    onSoloLayer: (id) => engine().setSoloLayer(id),
    _soloLayerId: engineRef.current?._soloLayerId ?? null,
    splineState, analysisState, creatorHistory,
    onCreateSpline: (type) => engine().createSpline(type),
    onConfirmSplineCreation: () => engine().confirmSplineCreation(),
    onCancelSplineCreation: () => engine().cancelSplineCreation(),
    onUpdateSpline: (id, patch) => engine().updateSpline(id, patch),
    onDeleteSpline: (id) => engine().deleteSpline(id),
    onDuplicateSpline: (id) => engine().duplicateSpline(id),
    onSelectSpline: (id) => engine().selectSpline(id),
    onAnalysisMode: (mode) => engine().setAnalysisMode(mode),
    onAnalysisSettings: (patch) => engine().setAnalysisSettings(patch),
    onCreateSnapshot: (name) => engine().createSnapshot(name),
    onRestoreSnapshot: (id) => engine().restoreSnapshot(id),
    onRestoreHistoryAction: (id) => engine().restoreHistoryAction(id),
    onDeleteSnapshot: (id) => engine().deleteSnapshot(id),
    onRenameSnapshot: (id, name) => engine().renameSnapshot(id, name),
  };

  return (
    <div
      id="app"
      className={`${previewMode ? 'preview-mode' : ''}${landingMode ? ' landing-mode' : ''}${fpsView ? ' infinite-mode' : ''}${touchExplore ? ' fps-explore-mode' : ''}${exploreMode === 'plane' ? ' plane-mode' : ''}${drawerOpen ? ' side-drawer-open' : ''}${perfOverlay.settings.open ? ' perf-overlay-open' : ''}${nodesWorkspaceActive ? ' nodes-workspace-open' : ''}`}
      onDragEnter={landingMode ? undefined : onFileDragEnter}
      onDragOver={landingMode ? undefined : onFileDragOver}
      onDragLeave={landingMode ? undefined : onFileDragLeave}
      onDrop={landingMode ? undefined : onFileDrop}
    >
      {!landingMode && fileDragActive && (
        <div className="file-drop-overlay" role="presentation">
          <div className="file-drop-card">
            <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
              <path d="M12 3v11M12 3 8.2 6.8M12 3l3.8 3.8" stroke="currentColor" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" stroke="currentColor" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Drop terrain file to load</span>
          </div>
        </div>
      )}
      <TopBar
        projectMode={projectMode}
        previewMode={previewMode}
        onNew={() => createProjectFromTemplate('blank', { editorMode: projectMode })}
        onRandomize={() => engine().randomizeSeed()}
        onSave={() => saveCurrentProject()}
        onDownload={downloadCurrentProject}
        onLoadJSON={loadProjectJSON}
        onOpenProjects={() => window.dispatchEvent(new Event('terrain-project:home'))}
        onTogglePreview={() => setPreviewMode(!previewMode)}
        nodeToolsVisible={uiPrefs.nodeToolsVisible !== false}
        onToggleNodeTools={() => {
          const visible = uiPrefs.nodeToolsVisible === false;
          handleUiPrefs({ ...uiPrefs, nodeToolsVisible: visible });
          if (!visible) setActivePanel(null);
        }}
        onToggleHelp={() => setHelpVisible((v) => !v)}
        onResetView={() => engine().resetView()}
        paintMode={paintMode}
        onTogglePaintMode={() => engine().setPaintMode(!paintMode)}
        onOpenPanel={togglePanel}
        activePanel={effectivePanel}
        loading={nonBlock}
        onUndo={undo}
        onRedo={redo}
        canUndo={histState.canUndo}
        canRedo={histState.canRedo}
        onOpenHistory={() => togglePanel('history')}
        onOpenSettingsSearch={openSettingsSearch}
        settingsSearchOpen={settingsSearchOpen}
        onOpenUiSettings={() => setUiSettingsOpen(true)}
        recentNotifications={recentNotifications}
        notificationsIgnored={notificationsIgnored}
        onClearNotifications={clearNotifications}
        onToggleNotificationLogging={toggleNotificationLogging}
      />

      <div
        id="main"
        className="app-shell"
        ref={appShellRef}
        data-tools-rail={toolsRailAttr}
        data-drawer-side={drawerSideAttr}
        data-node-palette-side={nodesWorkspaceActive && nodePaletteDock.detached ? nodePaletteDock.side : 'attached'}
        style={{ '--node-palette-shell-width': `${nodePaletteDock.width || 208}px` }}
      >
        {showToolPanels && (
          <LeftToolbar
            activePanel={effectivePanel}
            worldMode={worldMode}
            onSelect={togglePanel}
            layout={toolsRailLayout}
            onLayoutChange={handleToolsRailLayout}
            shellRef={appShellRef}
            showLabels={uiPrefs.toolbarLabels}
            panelIds={projectMode === 'nodes' ? NODE_PANEL_IDS : undefined}
          />
        )}

        <div className="viewport-area">
          <canvas id="viewport" ref={canvasRef} className={webglError ? 'viewport-disabled' : ''} />
          {webglError && (
            <div className="webgl-error-overlay" role="alert">
              <h2>WebGL unavailable</h2>
              <p>{webglError}</p>
              <p className="webgl-error-hint">
                Close other 3D tabs, reload the page, or enable hardware acceleration in your browser settings
                (Chrome: Settings → System → &quot;Use graphics acceleration when available&quot;).
              </p>
              <button type="button" onClick={() => window.location.reload()}>
                Reload
              </button>
            </div>
          )}
          {showToolPanels && settingsSearchOpen && (
            <SettingsSearchOverlay
              open={settingsSearchOpen}
              query={settingsSearchQuery}
              groupedResults={groupedSettingsSearchResults}
              flatResults={settingsSearchResults}
              selectedIndex={settingsSearchIndex}
              onChangeQuery={(value) => {
                setSettingsSearchQuery(value);
                setSettingsSearchIndex(0);
              }}
              onSelectIndex={setSettingsSearchIndex}
              onConfirm={confirmSettingsSearch}
              onConfirmPanel={confirmSettingsSearchPanel}
              onClose={closeSettingsSearch}
            />
          )}

          <div id="help-card" className={helpVisible && studioLike && !nodesWorkspaceActive ? '' : 'hidden'}>
            <div className="help-row"><span className="help-ic">↻</span> Drag to orbit camera</div>
            <div className="help-row"><span className="help-ic">🤏</span> Pinch to zoom • move two fingers to pan</div>
            <div className="help-row"><span className="help-ic">🖱</span> Mouse: left pan • right orbit</div>
          </div>

          {showStudioUI && isStudio && !nodesWorkspaceActive && (
            <MinimapOverlay
              boardSize={boardSize}
              baseRef={minimapBaseRef}
              overlayRef={minimapOverlayRef}
              drawerOpen={!!effectivePanel}
              onConfigChange={(next) => engine()?.setMinimapConfig(next)}
              onHoverChange={(hover) => engine()?.setMinimapHover(hover)}
              onHoverInfoRequest={(x, y) => engine()?.getMinimapInfoAt(x, y) ?? null}
            />
          )}

          {showStudioUI && isStudio && !landingMode && !nodesWorkspaceActive && (
            <CreatorToolbar
              active={splineState.enabled}
              onToggle={() => engine().setSplineEditingEnabled(!splineState.enabled)}
            />
          )}

          {paintMode && (
            <PaintPanel
              paintState={paintState}
              onSetting={(key, value) => engine().setPaintSetting(key, value)}
              onClear={() => engine().clearPaintLayers()}
              onSetBaseMode={(mode) => engine().setPaintBaseMode(mode)}
              onStartEmpty={() => engine().startEmptyTerrain()}
              onExit={() => engine().setPaintMode(false)}
            />
          )}

          {showStudioUI && uiPrefs.cameraControls !== false && !nodesWorkspaceActive && (
            <BottomToolbar
              camMode={camMode}
              onTopDown={() => { engine().setCameraView('top'); setCamMode('topdown'); }}
              onAngled={() => { engine().setCameraView('angled'); setCamMode('orbit'); }}
              onResetCamera={() => engine().resetView()}
              exploreMode={exploreMode}
              onExploreMode={selectExploreMode}
            />
          )}

          {fpsView && (
            <>
              <InfiniteHUD
                stats={infiniteStats}
                isPlanet={isPlanet}
                onReturn={() => selectWorldMode('studio')}
                exploreMode={exploreMode}
                onExploreMode={selectExploreMode}
                quality={qualityPreset}
                onQualityChange={handleQualityChange}
                timeOfDay={timeOfDay}
                onTimeOfDay={handleTimeOfDay}
                behindCameraCulling={behindCameraCulling}
                onBehindCameraCulling={handleBehindCameraCulling}
                planetPreset={params.planetPreset}
                onPlanetPreset={(key) => engine().applyPlanetPresetByKey(key)}
                onGeneratePalette={() => engine().generatePalette()}
                onRandomPlanet={() => engine().randomizePlanetPreset()}
                perf={perf}
                rendererInfo={engineRef.current ? {
                  ...(engineRef.current.rendererConfig || {}),
                  capabilities: engineRef.current.rendererCapabilities,
                } : null}
                gpu={gpu}
                perfStats={stats}
                onPerfPreset={(key) => engine().setPerfPreset(key)}
                onPerfSetting={(key, value) => engine().setPerfSetting(key, value)}
                onPerfReset={() => engine().resetPerfSettings()}
              />
            </>
          )}

          {touchExplore && <TouchControls mode={exploreMode} onInput={handleTouchInput} />}

          {exploreMode === 'plane' && <PlaneHUD stats={infiniteStats} />}

          {nodesWorkspaceActive && terrainGraph ? (
            <Suspense fallback={<div className="nodes-workspace-loading">Loading node editor…</div>}>
              <NodeWorkspace
                graph={terrainGraph}
                graphView={graphView}
                graphState={{ ...graphState, onDiagnostic: (message) => showToast(message, 'error') }}
                onGraphChange={handleTerrainGraphChange}
                onGraphViewChange={handleGraphView}
                onStartBlank={handleStartBlankGraph}
                inspectorReplaced={!!effectivePanel}
                onRequestInspector={() => setActivePanel(null)}
                onPreviewVisibilityChange={setNodesPreviewVisible}
                toolsRailVisible={showToolPanels}
                toolsRailEdge={toolsRailAttr}
                onPaletteDockChange={setNodePaletteDock}
                preview={(
                  <MinimapOverlay
                    docked
                    boardSize={boardSize}
                    baseRef={minimapBaseRef}
                    overlayRef={minimapOverlayRef}
                    onConfigChange={(next) => engine()?.setMinimapConfig(next)}
                    onHoverChange={(hover) => engine()?.setMinimapHover(hover)}
                    onHoverInfoRequest={(x, y) => engine()?.getMinimapInfoAt(x, y) ?? null}
                  />
                )}
              />
            </Suspense>
          ) : null}

          <CompileProgressChip progress={compileProgress} />
          {showBlockingOverlay && <LoadingOverlay task={block} />}
        </div>

        {showToolPanels && drawerOpen && (
          <Suspense fallback={null}>
            <SideDrawer
              activePanel={effectivePanel}
              ctx={ctx}
              onClose={() => setActivePanel(null)}
              layout={drawerLayout}
              onLayoutChange={handleDrawerLayout}
              shellRef={appShellRef}
              toolsRailEdge={toolsRailAttr}
            />
          </Suspense>
        )}
      </div>

      {!previewMode && !landingMode && projectMode === 'procedural' && (
        <WorldModeBar
          worldMode={worldMode}
          onSetWorldMode={selectWorldMode}
          modeLocked={modeLocked}
          modeDisplay={uiPrefs.modeDisplay}
          visible={!paintMode}
        />
      )}

      {uiSettingsOpen && (
        <UiSettingsPanel
          open={uiSettingsOpen}
          prefs={uiPrefs}
          onChange={handleUiPrefs}
          onClose={() => setUiSettingsOpen(false)}
        />
      )}

      <StatusBar
        status={status}
        bgWork={bgWork}
        gpu={gpu}
        stats={stats}
        worldMode={worldMode}
        infiniteStats={infiniteStats}
        qualityPreset={fpsView ? qualityPreset : null}
        exploreMode={exploreMode}
        playerMode={playerMode}
        playerState={fpsView ? infiniteStats?.playerState : playerState}
        perfOpen={perfOverlay.settings.open}
        onPerfToggle={perfOverlay.toggleOpen}
      />

      {perfOverlay.settings.open && (
        <Suspense fallback={null}>
          <PerformanceOverlay
            snapshot={perfOverlay.snapshot}
            history={perfOverlay.history}
            settings={perfOverlay.settings}
            onClose={perfOverlay.toggleOpen}
            onToggleSection={perfOverlay.toggleSection}
            onSetShowWarnings={perfOverlay.setShowWarnings}
          />
        </Suspense>
      )}
    </div>
  );
}
