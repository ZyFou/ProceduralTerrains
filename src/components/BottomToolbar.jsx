import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronUp, Compass } from 'lucide-react';

export default function BottomToolbar({ camMode, onTopDown, onAngled, onResetCamera, exploreMode, onExploreMode }) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const exploring = exploreMode === 'walk' || exploreMode === 'plane';

  useEffect(() => {
    if (!open) return undefined;
    const placeMenu = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuStyle({
        left: rect.left + rect.width / 2,
        bottom: window.innerHeight - rect.top + 8,
      });
    };
    const onPointerDown = (e) => {
      const target = e.target;
      if (!wrapRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    placeMenu();
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', placeMenu);
    window.addEventListener('scroll', placeMenu, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', placeMenu);
      window.removeEventListener('scroll', placeMenu, true);
    };
  }, [open]);

  const select = (mode) => {
    onExploreMode(mode);
    setOpen(false);
  };

  return (
    <div className="viewport-camera-bar" role="toolbar" aria-label="Camera views">
      <button
        type="button"
        className={`camera-bar-btn${camMode === 'topdown' ? ' active' : ''}`}
        onClick={onTopDown}
        aria-label="Top-down view"
        title="Top-down view"
      >
        <svg viewBox="0 0 16 16" fill="none">
          <rect x="3" y="3" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M3 7h10M7 3v10" stroke="currentColor" strokeWidth="0.8" opacity=".6" />
        </svg>
        <span className="camera-bar-label">Top-down</span>
      </button>
      <button
        type="button"
        className={`camera-bar-btn${camMode !== 'topdown' ? ' active' : ''}`}
        onClick={onAngled}
        aria-label="Angled view"
        title="Angled view"
      >
        <svg viewBox="0 0 16 16" fill="none">
          <path d="M2 11 8 4l6 7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M2 11h12" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        <span className="camera-bar-label">Angled</span>
      </button>
      <button
        type="button"
        className="camera-bar-btn"
        onClick={onResetCamera}
        aria-label="Reset camera"
        title="Reset camera"
      >
        <svg viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="8" cy="8" r="1.6" fill="currentColor" />
        </svg>
        <span className="camera-bar-label">Reset Camera</span>
      </button>

      <div className="explore-menu-wrap" ref={wrapRef}>
        <button
          ref={triggerRef}
          type="button"
          className={`camera-bar-btn explore-menu-trigger${exploring ? ' active' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-label="Explore mode"
          aria-haspopup="menu"
          aria-expanded={open}
          title="Explore terrain by walking or flying a plane"
        >
          <Compass aria-hidden size={14} strokeWidth={1.9} />
          <span className="camera-bar-label">Explore</span>
          <ChevronUp className={`explore-chevron${open ? ' open' : ''}`} aria-hidden size={12} strokeWidth={2} />
        </button>
        {open && menuStyle && createPortal(
          <div
            ref={menuRef}
            className="explore-menu"
            style={{ left: menuStyle.left, bottom: menuStyle.bottom }}
            role="menu"
            aria-label="Explore modes"
          >
            <button
              type="button"
              className={`explore-menu-item${exploreMode === 'walk' ? ' active' : ''}`}
              onClick={() => select('walk')}
              role="menuitem"
            >
              Walk
            </button>
            <button
              type="button"
              className={`explore-menu-item${exploreMode === 'plane' ? ' active' : ''}`}
              onClick={() => select('plane')}
              role="menuitem"
            >
              Plane
            </button>
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}
