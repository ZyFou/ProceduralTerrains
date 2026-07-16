import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DrawerChromeContext, FlatPanelContext } from '../panels/PanelContext.js';
import { renderPanel } from '../panels/index.jsx';
import {
  DRAWER_EDGES,
  isToolsRailDesktopLayout,
  resolveNearestEdge,
} from './toolsRailLayout.js';

const SIDE_LABELS = { left: 'Snap left', right: 'Snap right' };

// Overlay drawer (does not resize the canvas). Desktop: drag header to snap L/R.
export default function SideDrawer({
  activePanel,
  ctx,
  onClose,
  layout,
  onLayoutChange,
  shellRef,
  toolsRailEdge = 'left',
}) {
  const [tooltip, setTooltip] = useState(null);
  const [desktop, setDesktop] = useState(isToolsRailDesktopLayout);
  const [dragging, setDragging] = useState(false);
  const [snapHint, setSnapHint] = useState(null);
  const [menu, setMenu] = useState(null);
  const dragRef = useRef(null);
  const menuRef = useRef(null);
  const searchOpen = !!ctx.settingsSearchOpen;

  const side = desktop ? (layout?.side ?? 'right') : 'right';

  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 821px)');
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!activePanel) return;
    const onKey = (e) => { if (e.key === 'Escape' && !searchOpen) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activePanel, onClose, searchOpen]);

  useEffect(() => {
    const over = (e) => {
      const t = e.target.closest('[data-tooltip]');
      if (t) {
        const text = t.getAttribute('data-tooltip');
        if (text) setTooltip({ text, rect: t.getBoundingClientRect() });
      }
    };
    const out = (e) => { if (e.target.closest('[data-tooltip]')) setTooltip(null); };
    const scroll = () => setTooltip(null);
    document.addEventListener('mouseover', over);
    document.addEventListener('mouseout', out);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mouseout', out);
      window.removeEventListener('scroll', scroll, true);
    };
  }, []);

  useEffect(() => { setTooltip(null); }, [activePanel]);

  const commitSide = useCallback((next) => {
    onLayoutChange?.({ side: next });
    setMenu(null);
  }, [onLayoutChange]);

  const onHeaderPointerDown = useCallback((e) => {
    if (!desktop || e.button !== 0) return;
    e.preventDefault();
    const shell = shellRef?.current;
    if (!shell) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, armed: false };
  }, [desktop, shellRef]);

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
      setSnapHint(resolveNearestEdge(e.clientX, e.clientY, shell.getBoundingClientRect(), DRAWER_EDGES));
    };

    const finish = (e) => {
      const drag = dragRef.current;
      const shell = shellRef?.current;
      dragRef.current = null;
      if (!drag?.armed) {
        setDragging(false);
        setSnapHint(null);
        return;
      }
      setDragging(false);
      setSnapHint(null);
      if (!shell) return;
      commitSide(resolveNearestEdge(
        e.clientX ?? drag.startX,
        e.clientY ?? drag.startY,
        shell.getBoundingClientRect(),
        DRAWER_EDGES,
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
  }, [desktop, commitSide, shellRef]);

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

  const chromeValue = useMemo(() => ({
    onHeaderPointerDown: desktop ? onHeaderPointerDown : null,
  }), [desktop, onHeaderPointerDown]);

  const open = !!activePanel;
  const popLeft = tooltip && tooltip.rect.left > window.innerWidth / 2;
  const tooltipStyle = tooltip ? {
    position: 'fixed',
    top: tooltip.rect.top + tooltip.rect.height / 2,
    left: popLeft ? tooltip.rect.left - 8 : tooltip.rect.left + tooltip.rect.width + 8,
    transform: popLeft ? 'translate(-100%, -50%)' : 'translate(0, -50%)',
  } : null;

  const besideTools = (toolsRailEdge === 'left' && side === 'left')
    || (toolsRailEdge === 'right' && side === 'right');
  const belowTools = toolsRailEdge === 'top';
  const aboveTools = toolsRailEdge === 'bottom';

  const onDrawerContextMenu = (e) => {
    if (!desktop || !open) return;
    if (e.target.closest('input, textarea, select, button, a')) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <>
      {dragging && (
        <div className="panel-snap-layer panel-snap-layer--drawer" aria-hidden>
          {DRAWER_EDGES.map((id) => (
            <div
              key={id}
              className={`panel-snap-zone panel-snap-zone--${id}${snapHint === id ? ' active' : ''}`}
            />
          ))}
        </div>
      )}
      <aside
        className={[
          'side-drawer',
          open ? 'open' : '',
          `side-drawer--${side}`,
          besideTools ? 'side-drawer--beside-rail' : '',
          belowTools ? 'side-drawer--below-tools' : '',
          aboveTools ? 'side-drawer--above-tools' : '',
          dragging ? 'is-dragging' : '',
        ].filter(Boolean).join(' ')}
        aria-hidden={!open}
        data-drawer-side={side}
        onContextMenu={onDrawerContextMenu}
      >
        <FlatPanelContext.Provider value={true}>
          <DrawerChromeContext.Provider value={chromeValue}>
            {open && renderPanel(activePanel, { ...ctx, onClose })}
          </DrawerChromeContext.Provider>
        </FlatPanelContext.Provider>
      </aside>

      {menu && (
        <div
          ref={menuRef}
          className="panel-snap-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
          aria-label="Properties panel position"
        >
          {DRAWER_EDGES.map((id) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              className={side === id ? 'active' : ''}
              onClick={() => commitSide(id)}
            >
              {SIDE_LABELS[id]}
            </button>
          ))}
        </div>
      )}

      {tooltip && open && (
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
    </>
  );
}
