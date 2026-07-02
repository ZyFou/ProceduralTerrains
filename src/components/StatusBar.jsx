import { GITHUB_REPO_URL } from '../constants/app.js';

function fmtTris(n) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${(n / 1e3).toFixed(0)}K`;
}

const PLAYER_STATE_LABELS = {
  grounded: 'Grounded',
  falling: 'Falling',
  swimming: 'Swimming',
  underwater: 'Underwater',
  flying: 'Flying',
  stalling: 'Stalling',
};

export default function StatusBar({
  status, bgWork, gpu, stats, worldMode, infiniteStats, qualityPreset, exploreMode, playerMode, playerState,
  perfOpen, onPerfToggle,
}) {
  const exploring = playerMode || exploreMode === 'plane';
  return (
    <footer id="statusbar">
      <div className="sb-group sb-group-primary">
        <span className={`status-dot${status.busy ? ' busy' : ''}`} />
        <span className="sb-status">{status.text}</span>
        <span className="sb-sep sb-desktop-only" aria-hidden="true" />
        <span className="sb-desktop-only">GPU: {gpu}</span>
        {exploring && playerState && (
          <>
            <span className="sb-sep sb-desktop-only" aria-hidden="true" />
            <span className={`player-state player-state-${playerState} sb-desktop-only`}>
              {PLAYER_STATE_LABELS[playerState] ?? playerState}
            </span>
          </>
        )}
        {worldMode === 'infinite' && infiniteStats && (
          <>
            <span className="sb-sep sb-desktop-only" aria-hidden="true" />
            <span className="sb-desktop-only">
              Visible: {infiniteStats.visibleChunks ?? infiniteStats.chunks} / {infiniteStats.chunks}
            </span>
            <span className="sb-sep sb-desktop-only" aria-hidden="true" />
            <span className="sb-desktop-only">Speed: {infiniteStats.speed} u/s</span>
            {qualityPreset && (
              <>
                <span className="sb-sep sb-desktop-only" aria-hidden="true" />
                <span className="sb-quality sb-desktop-only">{qualityPreset}</span>
              </>
            )}
          </>
        )}
        {worldMode === 'planet' && (
          <>
            <span className="sb-sep sb-desktop-only" aria-hidden="true" />
            <span className="sb-desktop-only">Planet</span>
            {infiniteStats && (
              <>
                <span className="sb-sep sb-desktop-only" aria-hidden="true" />
                <span className="sb-desktop-only">
                  Visible: {infiniteStats.visibleChunks} / {infiniteStats.chunks}
                </span>
              </>
            )}
          </>
        )}
      </div>
      <div className="sb-group sb-group-stats">
        {bgWork && (
          <>
            <span className="sb-bgwork" title="Full-detail shaders are compiling in the background — brief hiccups are normal until this finishes">
              <span className="status-dot busy" />
              {bgWork}
            </span>
            <span className="sb-sep" aria-hidden="true" />
          </>
        )}
        <span className="sb-tris">Triangles: {fmtTris(stats.triangles)}</span>
        <span className="sb-sep sb-desktop-only" aria-hidden="true" />
        <span className="sb-desktop-only">Draw Calls: {stats.drawCalls}</span>
        <span className="sb-sep" />
        <button
          type="button"
          className={`fps-badge fps-badge-btn${stats.fps > 0 && stats.fps < 30 ? ' low' : ''}${perfOpen ? ' is-open' : ''}`}
          onClick={onPerfToggle}
          title="Performance details (Ctrl/Cmd+Shift+P)"
          aria-expanded={!!perfOpen}
          aria-label={`${stats.fps} FPS — open performance details`}
        >
          {stats.fps} FPS
        </button>
        <span className="sb-sep sb-desktop-only" aria-hidden="true" />
        <a
          className="sb-github-link"
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          title="View source on GitHub"
          aria-label="View source on GitHub"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
            />
          </svg>
        </a>
      </div>
    </footer>
  );
}
