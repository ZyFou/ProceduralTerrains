import { useState, useEffect } from 'react';
import { CameraPanel, LodPanel } from '../RightPanels.jsx';
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
  const [tooltip, setTooltip] = useState(null);

  useEffect(() => {
    const handleMouseOver = (e) => {
      const target = e.target.closest('[data-tooltip]');
      if (target) {
        const text = target.getAttribute('data-tooltip');
        if (text) {
          const rect = target.getBoundingClientRect();
          setTooltip({ text, rect });
        }
      }
    };

    const handleMouseOut = (e) => {
      const target = e.target.closest('[data-tooltip]');
      if (target) {
        setTooltip(null);
      }
    };

    const handleScroll = () => {
      setTooltip(null);
    };

    document.addEventListener('mouseover', handleMouseOver);
    document.addEventListener('mouseout', handleMouseOut);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('mouseover', handleMouseOver);
      document.removeEventListener('mouseout', handleMouseOut);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, []);

  const popLeft = tooltip && (tooltip.rect.left > window.innerWidth / 2);
  const tooltipStyle = tooltip ? {
    position: 'fixed',
    top: tooltip.rect.top + tooltip.rect.height / 2,
    left: popLeft ? tooltip.rect.left - 8 : tooltip.rect.left + tooltip.rect.width + 8,
    transform: popLeft ? 'translate(-100%, -50%)' : 'translate(0, -50%)',
  } : null;

  return (
    <aside className="right-inspector-panel">
      <div className="right-inspector-scroll">
        <EnvironmentPanel
          params={params}
          planetStyle={params.planetStyle}
          onParam={onParam}
          onTuning={onStyleTuning}
        />
        <WorldPanel params={params} onParam={onParam} />
        <CameraPanel
          camInfo={camInfo}
          camMode={camMode}
          onMode={onMode}
          onFov={onFov}
          onFocusCenter={onFocusCenter}
          embedded
        />
        <LodPanel lodCounts={lodCounts} chunkCount={chunkCount} embedded />
        <PerformancePanel stats={stats} gpu={gpu} />
        <PlanetSummaryCard params={params} />
      </div>

      {tooltip && (
        <div className="global-tooltip" style={tooltipStyle}>
          {popLeft ? (
            <>
              <div className="global-tooltip-content">{tooltip.text}</div>
              <div className="global-tooltip-arrow right" />
            </>
          ) : (
            <>
              <div className="global-tooltip-arrow left" />
              <div className="global-tooltip-content">{tooltip.text}</div>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
