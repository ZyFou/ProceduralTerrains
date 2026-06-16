import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Engine } from './engine/Engine.js';
import { DEFAULT_PARAMS } from './engine/presets.js';
import { clonePlanetStyle } from './engine/style/PlanetStyleConfig.js';
import { useLoading, blockingTask, nonBlockingTask } from './state/loading.jsx';
import { panelAvailable } from './components/panels/index.jsx';
import TopBar from './components/TopBar.jsx';
import LeftToolbar from './components/ui/LeftToolbar.jsx';
import SideDrawer from './components/ui/SideDrawer.jsx';
import BottomToolbar from './components/BottomToolbar.jsx';
import StatusBar from './components/StatusBar.jsx';
import InfiniteHUD from './components/InfiniteHUD.jsx';
import MinimapOverlay from './components/MinimapOverlay.jsx';
import PaintPanel from './components/paint/PaintPanel.jsx';
import LoadingOverlay from './components/ui/LoadingOverlay.jsx';
import ToastContainer, { classifyToast } from './components/ui/Toast.jsx';

const MODE_LABEL = { studio: 'Tile', infinite: 'Infinite World', planet: 'Planet' };

export default function App() {
  const canvasRef = useRef(null);
  const minimapBaseRef = useRef(null);
  const minimapOverlayRef = useRef(null);
  const engineRef = useRef(null);

  const loading = useLoading();
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  const [params, setParams] = useState({ ...DEFAULT_PARAMS });
  const [status, setStatus] = useState({ text: 'Booting…', busy: true });
  const [stats, setStats] = useState({ fps: 0, triangles: 0, drawCalls: 0 });
  const [lodCounts, setLodCounts] = useState([0, 0, 0, 0]);
  const [chunkCount, setChunkCount] = useState(DEFAULT_PARAMS.chunkCount);
  const [boardSize, setBoardSize] = useState(DEFAULT_PARAMS.chunkCount * DEFAULT_PARAMS.chunkSize);
  const [camInfo, setCamInfo] = useState({ angle: '–', distance: '–' });
  const [gpu, setGpu] = useState('–');

  const [camMode, setCamMode] = useState('orbit');
  const [helpVisible, setHelpVisible] = useState(true);
  const [previewMode, setPreviewMode] = useState(false);
  const [activePanel, setActivePanel] = useState(null);
  const [paintState, setPaintState] = useState({ enabled: false });

  const [worldMode, setWorldMode] = useState('studio');
  const [infiniteStats, setInfiniteStats] = useState(null);
  const [playerMode, setPlayerMode] = useState(false);
  const [playerState, setPlayerState] = useState(null);

  const [qualityPreset, setQualityPreset] = useState('high');
  const [timeOfDay, setTimeOfDay] = useState(0.38);
  const [cullingEnabled, setCullingEnabled] = useState(true);
  const [behindCameraCulling, setBehindCameraCulling] = useState(true);
  const [visibleChunks, setVisibleChunks] = useState(DEFAULT_PARAMS.chunkCount * DEFAULT_PARAMS.chunkCount);
  const [culledChunks, setCulledChunks] = useState(0);
  const [perf, setPerf] = useState(null);

  // ---- toasts ----
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);
  const pushToast = useCallback((msg, type = 'info') => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2800);
  }, []);
  const showToast = useCallback((msg, type) => pushToast(msg, type ?? classifyToast(msg)), [pushToast]);

  // refs read by stable engine callbacks
  const blockingActiveRef = useRef(false);
  const blockingUpdateRef = useRef(null); // current blocking task's update fn
  const bootedRef = useRef(false);
  const exportFailedRef = useRef(false);

  blockingActiveRef.current = !!blockingTask(loading.tasks);

  useEffect(() => {
    loadingRef.current.start('boot', { blocking: true, label: 'Loading Terrain Studio…', detail: 'Initializing engine' });

    const engine = new Engine({
      canvas: canvasRef.current,
      minimapBase: minimapBaseRef.current,
      minimapOverlay: minimapOverlayRef.current,
      callbacks: {
        onParams: (next) => {
          setParams({
            ...next,
            planetStyle: next.planetStyle ? clonePlanetStyle(next.planetStyle) : next.planetStyle,
          });
        },
        onStatus: (text, busy) => {
          setStatus({ text, busy });
          // feed the active blocking task's detail line
          if (busy && blockingUpdateRef.current) blockingUpdateRef.current({ detail: text });
          // clear the initial boot overlay once the engine is first ready
          if (!busy && !bootedRef.current) {
            bootedRef.current = true;
            loadingRef.current.done('boot');
          }
        },
        onStats: setStats,
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
          pushToast(msg, type);
        },
        onFirstInteract: () => setHelpVisible(false),
        onInfiniteStats: setInfiniteStats,
        onPlayerMode: setPlayerMode,
        onPlayerState: setPlayerState,
        onQualityChange: setQualityPreset,
        onTimeOfDayChange: setTimeOfDay,
        onPerfChange: setPerf,
        onPaintState: setPaintState,
      },
    });
    engine.setCullingEnabled(cullingEnabled);
    engine.setBehindCameraCulling(behindCameraCulling);
    engineRef.current = engine;
    setGpu(engine.gpuName);
    if (import.meta.env.DEV) window.terrainStudio = engine;
    // safety: never leave the boot overlay stuck
    const bootTimer = setTimeout(() => {
      if (!bootedRef.current) { bootedRef.current = true; loadingRef.current.done('boot'); }
    }, 8000);
    return () => { clearTimeout(bootTimer); engine.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushToast]);

  const engine = () => engineRef.current;
  const onParam = (key, value) => engine().setParam(key, value);

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
  const selectWorldMode = (next) => {
    if (next === worldMode || modeLockRef.current) return;
    modeLockRef.current = true;
    setModeLocked(true);
    const label = MODE_LABEL[next] ?? next;
    if (!panelAvailable(activePanel, next)) setActivePanel(null);

    loading.run('mode', { blocking: true, label: `Switching to ${label} mode…`, detail: 'Preparing scene…' }, async (update) => {
      blockingUpdateRef.current = update;
      update({ detail: BUILD_STEP[next] ?? 'Building scene…' });
      // yield so the overlay paints the build message before the sync build
      await new Promise((r) => setTimeout(r, 30));
      engine().setWorldMode(next);      // sync build; kicks off async shader compile
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
      showToast(`Switched to ${label} mode`, 'success');
      if (next === 'infinite') { setHelpVisible(false); showToast('Click to lock mouse', 'info'); }
      else if (next === 'planet') { setHelpVisible(false); }
    }).catch((e) => {
      console.error(e);
      showToast('Mode switch failed', 'error');
    }).finally(() => {
      blockingUpdateRef.current = null;
      modeLockRef.current = false;
      setModeLocked(false);
    });
  };

  const togglePlayerMode = () => engine().setPlayerMode(!playerMode);
  const handleQualityChange = (key) => { engine().setQuality(key); setQualityPreset(key); };
  const handleTimeOfDay = (value) => { engine().setTimeOfDay(value); setTimeOfDay(value); };
  const handleBehindCameraCulling = (enabled) => { engine().setBehindCameraCulling(enabled); setBehindCameraCulling(enabled); };
  const handleCullingEnabled = (enabled) => { engine().setCullingEnabled(enabled); setCullingEnabled(enabled); };

  // ---- export: blocking overlay, button disabled via panel busy state ----
  const onExport = (options) => {
    exportFailedRef.current = false;
    return loading.run('export', { blocking: true, label: 'Exporting…', detail: 'Preparing scene…' }, async (update) => {
      blockingUpdateRef.current = update;
      try {
        await engine().export3DTerrain(options);
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

  const isStudio = worldMode === 'studio';
  const isInfinite = worldMode === 'infinite';
  const isPlanet = worldMode === 'planet';
  const paintMode = !!paintState?.enabled;
  const planetWalking = isPlanet && playerMode;
  const fpsView = isInfinite || planetWalking;
  const studioLike = isStudio || (isPlanet && !playerMode);
  const showStudioUI = !previewMode && !paintMode && studioLike;

  const togglePanel = (id) => setActivePanel((cur) => (cur === id ? null : id));
  const effectivePanel = showStudioUI && panelAvailable(activePanel, worldMode) ? activePanel : null;

  const block = blockingTask(loading.tasks);
  const nonBlock = nonBlockingTask(loading.tasks);

  useLayoutEffect(() => {
    if (!showStudioUI || !isStudio || !engineRef.current) return;
    engineRef.current.setMinimapCanvases(minimapBaseRef.current, minimapOverlayRef.current);
  }, [showStudioUI, isStudio, effectivePanel]);

  const ctx = {
    params, worldMode, onParam,
    onPreset: (key) => engine().applyPresetByKey(key),
    onRandomizeSeed: () => engine().randomizeSeed(),
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
    stats, gpu, perf,
    onPerfPreset: (key) => engine().setPerfPreset(key),
    onPerfSetting: (key, value) => engine().setPerfSetting(key, value),
    onPerfReset: () => engine().resetPerfSettings(),
    timeOfDay, onTimeOfDay: handleTimeOfDay,
    onExport, onExportScreenshot, onExportHeightmap,
  };

  return (
    <div id="app" className={`${previewMode ? 'preview-mode' : ''} ${fpsView ? 'infinite-mode' : ''}`}>
      <TopBar
        previewMode={previewMode}
        worldMode={worldMode}
        modeLocked={modeLocked}
        onNew={() => engine().newProject()}
        onRandomize={() => engine().randomizeSeed()}
        onSave={() => engine().saveSeed()}
        onLoadJSON={(json) => (json ? engine().loadSeedJSON(json) : showToast('Could not parse seed file', 'error'))}
        onTogglePreview={() => setPreviewMode(!previewMode)}
        onResetView={() => engine().resetView()}
        onToggleHelp={() => setHelpVisible((v) => !v)}
        onSetWorldMode={selectWorldMode}
        paintMode={paintMode}
        onTogglePaintMode={() => engine().setPaintMode(!paintMode)}
        onOpenPanel={togglePanel}
        activePanel={effectivePanel}
        loading={nonBlock}
      />

      <div id="main" className="app-shell">
        {showStudioUI && (
          <LeftToolbar activePanel={effectivePanel} worldMode={worldMode} onSelect={togglePanel} />
        )}

        <div className="viewport-area">
          <canvas id="viewport" ref={canvasRef} />

          <div id="help-card" className={helpVisible && studioLike ? '' : 'hidden'}>
            <div className="help-row"><span className="help-ic">🖐</span> Drag to pan</div>
            <div className="help-row"><span className="help-ic">🖱</span> Scroll to zoom</div>
            <div className="help-row"><span className="help-ic">↻</span> Right-click + drag to orbit</div>
          </div>

          {showStudioUI && isStudio && (
            <MinimapOverlay
              boardSize={boardSize}
              baseRef={minimapBaseRef}
              overlayRef={minimapOverlayRef}
              drawerOpen={!!effectivePanel}
            />
          )}

          {paintMode && (
            <PaintPanel
              paintState={paintState}
              onSetting={(key, value) => engine().setPaintSetting(key, value)}
              onClear={() => engine().clearPaintLayers()}
              onExit={() => engine().setPaintMode(false)}
            />
          )}

          {showStudioUI && (
            <BottomToolbar
              camMode={camMode}
              onTopDown={() => { engine().setCameraView('top'); setCamMode('topdown'); }}
              onAngled={() => { engine().setCameraView('angled'); setCamMode('orbit'); }}
              onResetCamera={() => engine().resetView()}
              playerMode={playerMode}
              onTogglePlayer={togglePlayerMode}
            />
          )}

          {fpsView && (
            <InfiniteHUD
              stats={infiniteStats}
              isPlanet={isPlanet}
              onReturn={() => selectWorldMode('studio')}
              playerMode={playerMode}
              onPlayerMode={togglePlayerMode}
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
            />
          )}

          {block && <LoadingOverlay task={block} />}
        </div>

        {showStudioUI && (
          <SideDrawer activePanel={effectivePanel} ctx={ctx} onClose={() => setActivePanel(null)} />
        )}
      </div>

      <StatusBar
        status={status}
        gpu={gpu}
        stats={stats}
        worldMode={worldMode}
        infiniteStats={infiniteStats}
        qualityPreset={fpsView ? qualityPreset : null}
        playerMode={playerMode}
        playerState={fpsView ? infiniteStats?.playerState : playerState}
      />

      <ToastContainer toasts={toasts} />
    </div>
  );
}
