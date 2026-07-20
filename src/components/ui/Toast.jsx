import { useEffect, useRef, useState } from 'react';
import { Info, X } from 'lucide-react';

// Small notification center for the editor top bar.
const ICONS = {
  info: (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
      <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 11V7.4M8 5.2v.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  success: (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
      <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 8.3l2 2 4-4.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
      <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 4.8v3.6M8 10.8v.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
};

function formatAge(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export default function NotificationCenter({ recent = [], notificationsIgnored = false, onClear, onToggleIgnore }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const count = recent.length;
  const badge = count > 9 ? '9+' : count;

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="tb-notifications" ref={rootRef}>
      <button
        type="button"
        className={`tb-btn tb-icon-btn tb-notification-btn${open ? ' active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        title="Recent activity"
        aria-label={`Recent activity${count ? ` (${count})` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Info size={15} strokeWidth={1.8} aria-hidden />
        {count > 0 && <span className="tb-notification-badge">{badge}</span>}
      </button>

      {open && (
        <div className="tb-notification-popover" role="dialog" aria-label="Recent activity">
          <div className="tb-notification-heading">
            <span>Recent activity</span>
            <button type="button" className="tb-notification-close" onClick={() => setOpen(false)} aria-label="Close recent activity">
              <X size={13} strokeWidth={1.8} aria-hidden />
            </button>
          </div>
          {recent.length > 0 ? (
            <div className="tb-notification-list">
              {recent.map((item) => {
                const type = item.type ?? 'info';
                return (
                  <div key={item.id} className={`tb-notification-item tb-notification-${type}`}>
                    <span className="tb-notification-icon">{ICONS[type]}</span>
                    <span className="tb-notification-copy">
                      <span className="tb-notification-message">{item.msg}</span>
                      <span className="tb-notification-time">{formatAge(item.timestamp)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="tb-notification-empty">No recent activity</div>
          )}
          <div className="tb-notification-footer">
            <button type="button" className="tb-notification-action" onClick={onClear} disabled={recent.length === 0}>
              Clear
            </button>
            <button
              type="button"
              className={`tb-notification-action${notificationsIgnored ? ' active' : ''}`}
              onClick={onToggleIgnore}
              aria-pressed={notificationsIgnored}
            >
              {notificationsIgnored ? 'Enable logging' : 'Ignore'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Classify an engine toast string into a type by keyword.
export function classifyToast(msg) {
  const m = String(msg).toLowerCase();
  if (/(fail|error|could not|invalid|cannot)/.test(m)) return 'error';
  if (/(complete|exported|regenerated|saved|reset|switched|ready|done)/.test(m)) return 'success';
  return 'info';
}
