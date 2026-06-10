import { CameraPanel, LodPanel, MinimapPanel } from '../RightPanels.jsx';
import PerformancePanel from './PerformancePanel.jsx';
import PlanetSummaryCard from './PlanetSummaryCard.jsx';
import EnvironmentPanel from './EnvironmentPanel.jsx';
import WorldPanel from './WorldPanel.jsx';

export default function RightInspectorPanel({
  params,
  camInfo,
  camMode,
  onMode,
  onFov,
  onFocusCenter,
  onParam,
  onStyleTuning,
  lodCounts,
  chunkCount,
  boardSize,
  baseRef,
  overlayRef,
  stats,
  gpu,
}) {
  return (
    <aside className="right-inspector-panel">
      <div className="right-inspector-scroll">
        <EnvironmentPanel
          params={params}
          planetStyle={params.planetStyle}
          onParam={onParam}
          onTuning={onStyleTuning}
        />
        <CameraPanel
          camInfo={camInfo}
          camMode={camMode}
          onMode={onMode}
          onFov={onFov}
          onFocusCenter={onFocusCenter}
          embedded
        />
        <LodPanel lodCounts={lodCounts} chunkCount={chunkCount} embedded />
        <MinimapPanel boardSize={boardSize} baseRef={baseRef} overlayRef={overlayRef} embedded />
        <PerformancePanel stats={stats} gpu={gpu} />
        <WorldPanel params={params} onParam={onParam} />
        <PlanetSummaryCard params={params} />
      </div>
    </aside>
  );
}
