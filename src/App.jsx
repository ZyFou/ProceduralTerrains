import { useCallback, useEffect, useRef, useState } from 'react';
import { Engine } from './engine/Engine.js';
import { DEFAULT_PARAMS } from './engine/presets.js';
import TopBar from './components/TopBar.jsx';
import LeftPanel from './components/LeftPanel.jsx';
import { CameraPanel, LodPanel, MinimapPanel } from './components/RightPanels.jsx';
import BottomToolbar from './components/BottomToolbar.jsx';
import StatusBar from './components/StatusBar.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import InfiniteHUD from './components/InfiniteHUD.jsx';

export default function App() {
  const canvasRef = useRef(null);
  const minimapBaseRef = useRef(null);
  const minimapOverlayRef = useRef(null);
  const engineRef = useRef(null);
  const toastTimer = useRef(null);

  // mirrored engine state
  const [params, setParams] = useState({ ...DEFAULT_PARAMS });
  const [status, setStatus] = useState({ text: 'Booting…', busy: true });
  const [stats, setStats] = useState({ fps: 0, triangles: 0, drawCalls: 0 });
  const [lodCounts, setLodCounts] = useState([0, 0, 0, 0]);
  const [chunkCount, setChunkCount] = useState(DEFAULT_PARAMS.chunkCount);
  const [boardSize, setBoardSize] = useState(DEFAULT_PARAMS.chunkCount * DEFAULT_PARAMS.chunkSize);
  const [camInfo, setCamInfo] = useState({ angle: '–', distance: '–' });
  const [gpu, setGpu] = useState('–');

  // pure UI state
  const [camMode, setCamMode] = useState('orbit');
  const [helpVisible, setHelpVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [toast, setToast] = useState(null);

  // Infinite world mode
  const [worldMode, setWorldMode] = useState('studio');
  const [infiniteStats, setInfiniteStats] = useState(null);

  // Infinite mode controls
  const [qualityPreset, setQualityPreset] = useState('high');
  const [timeOfDay, setTimeOfDay] = useState(0.38);
  const [behindCameraCulling, setBehindCameraCulling] = useState(true);

  // Performance settings (mirrored from engine)
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
    if (import.meta.env.DEV) window.terrainStudio = engine;  // dev/debug handle
    return () => engine.dispose();
  }, [showToast]);

  const engine = () => engineRef.current;
  const onParam = (key, value) => engine().setParam(key, value);

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
        onToggleWorldMode={toggleWorldMode}
      />

      <div id="main">
        <canvas id="viewport" ref={canvasRef} />
        <div id="vignette" />

        <div id="help-card" className={helpVisible && !isInfinite ? '' : 'hidden'}>
          <div className="help-row"><span className="help-ic">🖐</span> Drag to pan</div>
          <div className="help-row"><span className="help-ic">🖱</span> Scroll to zoom</div>
          <div className="help-row"><span className="help-ic">↻</span> Right-click + drag to orbit</div>
        </div>

        {!previewMode && !isInfinite && (
          <LeftPanel
            params={params}
            onParam={onParam}
            onPreset={(key) => engine().applyPresetByKey(key)}
            onRandomizeSeed={() => engine().randomizeSeed()}
            onRegenerate={() => engine().regenerate()}
          />
        )}

        <div id="right-stack" style={previewMode || isInfinite ? { display: 'none' } : undefined}>
          <CameraPanel
            camInfo={camInfo}
            camMode={camMode}
            onMode={(mode) => { engine().setCameraMode(mode); setCamMode(mode); }}
            onFov={(fov) => engine().setFov(fov)}
            onFocusCenter={() => engine().focusCenter()}
          />
          <LodPanel lodCounts={lodCounts} chunkCount={chunkCount} />
          <MinimapPanel boardSize={boardSize} baseRef={minimapBaseRef} overlayRef={minimapOverlayRef} />
        </div>

        {!previewMode && !isInfinite && (
          <BottomToolbar
            camMode={camMode}
            onTopDown={() => { engine().setCameraView('top'); setCamMode('topdown'); }}
            onAngled={() => { engine().setCameraView('angled'); setCamMode('orbit'); }}
            onResetCamera={() => engine().resetView()}
          />
        )}

        {/* Infinite World HUD */}
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
        params={params}
        onParam={onParam}
        onClose={() => setSettingsOpen(false)}
        perf={perf}
        onPerfPreset={handlePerfPreset}
        onPerfSetting={handlePerfSetting}
      />

      <div id="toast" className={toast ? 'show' : ''}>{toast}</div>
    </div>
  );
}
