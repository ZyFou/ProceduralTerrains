import { useCallback, useEffect, useRef, useState } from 'react';
import { Engine } from './engine/Engine.js';
import { DEFAULT_PARAMS } from './engine/presets.js';
import TopBar from './components/TopBar.jsx';
import IconRail from './components/ui/IconRail.jsx';
import LeftControlPanel from './components/ui/LeftControlPanel.jsx';
import RightInspectorPanel from './components/ui/RightInspectorPanel.jsx';
import BottomToolbar from './components/BottomToolbar.jsx';
import StatusBar from './components/StatusBar.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import InfiniteHUD from './components/InfiniteHUD.jsx';
import ExportModal from './components/ExportModal.jsx';

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

  const [qualityPreset, setQualityPreset] = useState('high');
  const [timeOfDay, setTimeOfDay] = useState(0.38);
  const [behindCameraCulling, setBehindCameraCulling] = useState(true);
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
        onParams: setParams,
        onStatus: (text, busy) => setStatus({ text, busy }),
        onStats: setStats,
        onLod: (counts, count) => { setLodCounts(counts); setChunkCount(count); },
        onCamera: setCamInfo,
        onBoard: setBoardSize,
        onToast: showToast,
        onFirstInteract: () => setHelpVisible(false),
        onInfiniteStats: setInfiniteStats,
        onQualityChange: setQualityPreset,
        onTimeOfDayChange: setTimeOfDay,
        onPerfChange: setPerf,
      },
    });
    engineRef.current = engine;
    setGpu(engine.gpuName);
    if (import.meta.env.DEV) window.terrainStudio = engine;
    return () => engine.dispose();
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
    onPlanetPreset: (key) => engine().applyPlanetPresetByKey(key),
    onRandomPlanet: () => engine().randomizePlanetPreset(),
    onPalettePreset: (key) => engine().applyPalettePresetByKey(key),
    onGeneratePalette: () => engine().generatePalette(),
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
            <BottomToolbar
              camMode={camMode}
              onTopDown={() => { engine().setCameraView('top'); setCamMode('topdown'); }}
              onAngled={() => { engine().setCameraView('angled'); setCamMode('orbit'); }}
              onResetCamera={() => engine().resetView()}
            />
          )}

          {isInfinite && (
            <InfiniteHUD
              stats={infiniteStats}
              onReturn={toggleWorldMode}
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
