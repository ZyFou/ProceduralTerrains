import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PANEL_META, PANEL_ORDER, panelAvailable, getPanelDisplay } from '../panels/panelMeta.js';
import {
  isToolsRailDesktopLayout,
  resolveNearestEdge,
  TOOLS_RAIL_EDGES,
} from './toolsRailLayout.js';

const EDGE_LABELS = {
  left: 'Snap left',
  right: 'Snap right',
  top: 'Snap top',
  bottom: 'Snap bottom',
};

/**
 * Tools icon rail — desktop overlay snapped to left/right/top/bottom.
 * Reposition via right-click menu (no grab icon). Mobile: bottom strip.
 */
export default function LeftToolbar({
  activePanel,
  worldMode,
  onSelect,
  layout,
  onLayoutChange,
  shellRef,
  showLabels = true,
  panelIds = PANEL_ORDER,
}) {
  const railRef = useRef(null);
  const menuRef = useRef(null);
  const dragRef = useRef(null);
  const [desktop, setDesktop] = useState(isToolsRailDesktopLayout);
  const [dragging, setDragging] = useState(false);
  const [snapHint, setSnapHint] = useState(null);
  const [ghost, setGhost] = useState(null);
  const [menu, setMenu] = useState(null); // { x, y } shell-local or viewport

  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 821px)');
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const edge = desktop ? (layout?.edge ?? 'left') : 'left';

  const commitEdge = useCallback((nextEdge) => {
    onLayoutChange?.({ edge: nextEdge });
    setMenu(null);
  }, [onLayoutChange]);

  const startDrag = (e) => {
    if (!desktop || e.button !== 0) return;
    // Only start drag when not clicking a tool button (empty chrome / after small move from menu-less drag).
    if (e.target.closest('.toolbar-btn')) return;

    const shell = shellRef?.current;
    const rail = railRef.current;
    if (!shell || !rail) return;

    const shellRect = shell.getBoundingClientRect();
    const railRect = rail.getBoundingClientRect();

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - railRect.left,
      offsetY: e.clientY - railRect.top,
      armed: false,
    };
  };

  useEffect(() => {
    if (!desktop) return undefined;

    const onMove = (e) => {
      const drag = dragRef.current;
      const shell = shellRef?.current;
      if (!drag || !shell) return;

      const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
      if (!drag.armed) {
        if (dist < 6) return;
        drag.armed = true;
        setDragging(true);
        setMenu(null);
      }

      const shellRect = shell.getBoundingClientRect();
      setGhost({
        x: e.clientX - shellRect.left - drag.offsetX,
        y: e.clientY - shellRect.top - drag.offsetY,
      });
      setSnapHint(resolveNearestEdge(e.clientX, e.clientY, shellRect, TOOLS_RAIL_EDGES));
    };

    const finish = (e) => {
      const drag = dragRef.current;
      const shell = shellRef?.current;
      dragRef.current = null;
      if (!drag?.armed) {
        setDragging(false);
        setGhost(null);
        setSnapHint(null);
        return;
      }
      setDragging(false);
      setGhost(null);
      setSnapHint(null);
      if (!shell) return;
      commitEdge(resolveNearestEdge(
        e.clientX ?? drag.startX,
        e.clientY ?? drag.startY,
        shell.getBoundingClientRect(),
        TOOLS_RAIL_EDGES,
      ));
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [desktop, commitEdge, shellRef]);

  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => {
      if (menuRef.current?.contains(e.target)) return;
      setMenu(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const onContextMenu = (e) => {
    if (!desktop) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const classNames = [
    'left-toolbar',
    desktop && `left-toolbar--${edge}`,
    desktop && 'left-toolbar--overlay',
    dragging && 'is-dragging',
    !showLabels && 'left-toolbar--icons-only',
  ].filter(Boolean).join(' ');

  return (
    <>
      {dragging && (
        <div className="panel-snap-layer" aria-hidden>
          {TOOLS_RAIL_EDGES.map((id) => (
            <div
              key={id}
              className={`panel-snap-zone panel-snap-zone--${id}${snapHint === id ? ' active' : ''}`}
            />
          ))}
        </div>
      )}
      <nav
        ref={railRef}
        className={classNames}
        style={dragging && ghost ? { left: ghost.x, top: ghost.y, right: 'auto', bottom: 'auto' } : undefined}
        aria-label="Tools"
        data-tools-edge={edge}
        onPointerDown={startDrag}
        onContextMenu={onContextMenu}
      >
        {panelIds.filter((id) => panelAvailable(id, worldMode)).map((id) => {
          const meta = PANEL_META[id];
          const display = getPanelDisplay(id, worldMode);
          return (
            <button
              key={id}
              type="button"
              className={`toolbar-btn${activePanel === id ? ' active' : ''}`}
              title={display.label}
              aria-label={display.label}
              aria-pressed={activePanel === id}
              onClick={() => onSelect(id)}
            >
              {meta.icon}
              {showLabels && <span className="toolbar-btn-label">{display.label}</span>}
            </button>
          );
        })}
      </nav>
      {menu && (
        <div
          ref={menuRef}
          className="panel-snap-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
          aria-label="Tools panel position"
        >
          {TOOLS_RAIL_EDGES.map((id) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              className={edge === id ? 'active' : ''}
              onClick={() => commitEdge(id)}
            >
              {EDGE_LABELS[id]}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
