import { useCallback, useEffect, useRef, useState } from 'react';
import { Engine } from './engine/Engine.js';
import { DEFAULT_PARAMS } from './engine/presets.js';
import { clonePlanetStyle } from './engine/style/PlanetStyleConfig.js';
import TopBar from './components/TopBar.jsx';
import IconRail from './components/ui/IconRail.jsx';
import LeftControlPanel from './components/ui/LeftControlPanel.jsx';
import RightInspectorPanel from './components/ui/RightInspectorPanel.jsx';
import BottomToolbar from './components/BottomToolbar.jsx';
import StatusBar from './components/StatusBar.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import InfiniteHUD from './components/InfiniteHUD.jsx';
import ExportModal from './components/ExportModal.jsx';
import MinimapOverlay from './components/MinimapOverlay.jsx';

export default function App() {
  const canvasRef = useRef(null);
  const minimapBaseRef = useRef(null);
  const minimapOverlayRef = useRef(null);
  const leftScrollRef = useRef(null);
  const engineRef = useRef(null);
  const toastTimer = useRef(null);

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [toast, setToast] = useState(null);
  const [activeSection, setActiveSection] = useState('section-generate');

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

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(() => {
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
        onStatus: (text, busy) => setStatus({ text, busy }),
        onStats: setStats,
        onLod: (counts, count, visible, culled) => {
          setLodCounts(counts);
          setChunkCount(count);
          setVisibleChunks(visible !== undefined ? visible : count * count);
          setCulledChunks(culled !== undefined ? culled : 0);
        },
        onCamera: setCamInfo,
        onBoard: setBoardSize,
        onToast: showToast,
        onFirstInteract: () => setHelpVisible(false),
        onInfiniteStats: setInfiniteStats,
        onPlayerMode: setPlayerMode,
        onPlayerState: setPlayerState,
        onQualityChange: setQualityPreset,
        onTimeOfDayChange: setTimeOfDay,
        onPerfChange: setPerf,
      },
    });
    engine.setCullingEnabled(cullingEnabled);
    engine.setBehindCameraCulling(behindCameraCulling);
    engineRef.current = engine;
    setGpu(engine.gpuName);
    if (import.meta.env.DEV) window.terrainStudio = engine;
    return () => engine.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showToast]);

  const engine = () => engineRef.current;
  const onParam = (key, value) => engine().setParam(key, value);

  const scrollToSection = (sectionId) => {
    const el = leftScrollRef.current?.querySelector(`[data-section="${sectionId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveSection(sectionId);
    }
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

  const toggleWorldMode = () => {
    const next = worldMode === 'studio' ? 'infinite' : 'studio';
    engine().setWorldMode(next);
    setWorldMode(next);
    if (next === 'infinite') {
      setHelpVisible(false);
      showToast('Entered Infinite World — click to lock mouse');
    } else {
      showToast('Returned to Terrain Studio');
    }
  };

  const togglePlayerMode = () => {
    engine().setPlayerMode(!playerMode);
  };

  const handleQualityChange = (key) => {
    engine().setQuality(key);
    setQualityPreset(key);
  };

  const handleTimeOfDay = (value) => {
    engine().setTimeOfDay(value);
    setTimeOfDay(value);
  };

  const handleBehindCameraCulling = (enabled) => {
    engine().setBehindCameraCulling(enabled);
    setBehindCameraCulling(enabled);
  };

  const handleCullingEnabled = (enabled) => {
    engine().setCullingEnabled(enabled);
    setCullingEnabled(enabled);
  };

  const handlePerfPreset = (key) => engine().setPerfPreset(key);
  const handlePerfSetting = (key, value) => engine().setPerfSetting(key, value);

  const isInfinite = worldMode === 'infinite';
  const showStudioUI = !previewMode && !isInfinite;

  return (
    <div id="app" className={`${previewMode ? 'preview-mode' : ''} ${isInfinite ? 'infinite-mode' : ''}`}>
      <TopBar
        previewMode={previewMode}
        worldMode={worldMode}
        onNew={() => engine().newProject()}
        onRandomize={() => engine().randomizeSeed()}
        onSave={() => engine().saveSeed()}
        onLoadJSON={(json) => (json ? engine().loadSeedJSON(json) : showToast('Could not parse seed file'))}
        onExportScreenshot={() => engine().exportScreenshot()}
        onExportHeightmap={() => engine().exportHeightmap()}
        onTogglePreview={() => setPreviewMode(!previewMode)}
        onResetView={() => engine().resetView()}
        onToggleHelp={() => setHelpVisible((v) => !v)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenExport={() => setExportModalOpen(true)}
        onToggleWorldMode={toggleWorldMode}
      />

      <div id="main" className="app-shell">
        {showStudioUI && (
          <IconRail activeId={activeSection} onSelect={scrollToSection} />
        )}

        {showStudioUI && (
          <LeftControlPanel
            params={params}
            onParam={onParam}
            onPreset={(key) => engine().applyPresetByKey(key)}
            onRandomizeSeed={() => engine().randomizeSeed()}
            onRegenerate={() => engine().regenerate()}
            planetStyleProps={planetStyleProps}
            scrollContainerRef={leftScrollRef}
            onSectionVisible={setActiveSection}
          />
        )}

        <div className="viewport-area">
          <canvas id="viewport" ref={canvasRef} />

          <div id="help-card" className={helpVisible && !isInfinite ? '' : 'hidden'}>
            <div className="help-row"><span className="help-ic">🖐</span> Drag to pan</div>
            <div className="help-row"><span className="help-ic">🖱</span> Scroll to zoom</div>
            <div className="help-row"><span className="help-ic">↻</span> Right-click + drag to orbit</div>
          </div>

          {showStudioUI && (
            <MinimapOverlay
              boardSize={boardSize}
              baseRef={minimapBaseRef}
              overlayRef={minimapOverlayRef}
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

          {isInfinite && (
            <InfiniteHUD
              stats={infiniteStats}
              onReturn={toggleWorldMode}
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
        </div>

        {showStudioUI && (
          <RightInspectorPanel
            params={params}
            camInfo={camInfo}
            camMode={camMode}
            onMode={(mode) => { engine().setCameraMode(mode); setCamMode(mode); }}
            onFov={(fov) => engine().setFov(fov)}
            onFocusCenter={() => engine().focusCenter()}
            onParam={onParam}
            onStyleTuning={(key, v) => engine().setPlanetStyleTuning(key, v)}
            lodCounts={lodCounts}
            chunkCount={chunkCount}
            boardSize={boardSize}
            baseRef={minimapBaseRef}
            overlayRef={minimapOverlayRef}
            stats={stats}
            gpu={gpu}
            visibleChunks={visibleChunks}
            culledChunks={culledChunks}
            cullingEnabled={cullingEnabled}
            behindCameraCulling={behindCameraCulling}
            onCullingEnabled={handleCullingEnabled}
            onBehindCameraCulling={handleBehindCameraCulling}
          />
        )}
      </div>

      <StatusBar
        status={status}
        gpu={gpu}
        stats={stats}
        worldMode={worldMode}
        infiniteStats={infiniteStats}
        qualityPreset={isInfinite ? qualityPreset : null}
        playerMode={playerMode}
        playerState={isInfinite ? infiniteStats?.playerState : playerState}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        perf={perf}
        onPerfPreset={handlePerfPreset}
        onPerfSetting={handlePerfSetting}
        onPerfReset={() => engine().resetPerfSettings()}
      />

      <ExportModal
        open={exportModalOpen}
        params={params}
        onClose={() => setExportModalOpen(false)}
        onExport={(options) => engine().export3DTerrain(options)}
      />

      <div id="toast" className={toast ? 'show' : ''}>{toast}</div>
    </div>
  );
}
