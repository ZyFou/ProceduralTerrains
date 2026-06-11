function fmtTris(n) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${(n / 1e3).toFixed(0)}K`;
}

const PLAYER_STATE_LABELS = {
  grounded: 'Grounded',
  falling: 'Falling',
  swimming: 'Swimming',
  underwater: 'Underwater',
};

export default function StatusBar({ status, gpu, stats, worldMode, infiniteStats, qualityPreset, playerMode, playerState }) {
  return (
    <footer id="statusbar">
      <div className="sb-group">
        <span className={`status-dot${status.busy ? ' busy' : ''}`} />
        <span>{status.text}</span>
        <span className="sb-sep" />
        <span>GPU: {gpu}</span>
        {playerMode && playerState && (
          <>
            <span className="sb-sep" />
            <span className={`player-state player-state-${playerState}`}>
              {PLAYER_STATE_LABELS[playerState] ?? playerState}
            </span>
          </>
        )}
        {worldMode === 'infinite' && infiniteStats && (
          <>
            <span className="sb-sep" />
            <span>Visible: {infiniteStats.visibleChunks ?? infiniteStats.chunks} / {infiniteStats.chunks}</span>
            <span className="sb-sep" />
            <span>Speed: {infiniteStats.speed} u/s</span>
            {qualityPreset && (
              <>
                <span className="sb-sep" />
                <span className="sb-quality">{qualityPreset}</span>
              </>
            )}
          </>
        )}
      </div>
      <div className="sb-group">
        <span>Triangles: {fmtTris(stats.triangles)}</span>
        <span className="sb-sep" />
        <span>Draw Calls: {stats.drawCalls}</span>
        <span className="sb-sep" />
        <span className={`fps-badge${stats.fps > 0 && stats.fps < 30 ? ' low' : ''}`}>{stats.fps} FPS</span>
      </div>
    </footer>
  );
}
