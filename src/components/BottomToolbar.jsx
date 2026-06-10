export default function BottomToolbar({ camMode, onTopDown, onAngled, onResetCamera }) {
  return (
    <div id="bottom-toolbar">
      <button className={`bt-btn${camMode === 'topdown' ? ' active' : ''}`} onClick={onTopDown}>
        <svg viewBox="0 0 16 16">
          <rect x="3" y="3" width="10" height="10" rx="1.5" stroke="currentColor" fill="none" strokeWidth="1.2" />
          <path d="M3 7h10M7 3v10" stroke="currentColor" strokeWidth="0.8" opacity=".6" />
        </svg>
        Top-down
      </button>
      <button className={`bt-btn${camMode !== 'topdown' ? ' active' : ''}`} onClick={onAngled}>
        <svg viewBox="0 0 16 16">
          <path d="M2 11 8 4l6 7z" stroke="currentColor" fill="none" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M2 11h12" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        Angled
      </button>
      <button className="bt-btn" onClick={onResetCamera}>
        <svg viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" fill="none" strokeWidth="1.2" />
          <circle cx="8" cy="8" r="1.6" fill="currentColor" />
        </svg>
        Reset Camera
      </button>
    </div>
  );
}
