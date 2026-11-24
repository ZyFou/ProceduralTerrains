import React, { useLayoutEffect, useRef } from 'react';

const DEFAULT_SELECTOR = '.active, [aria-selected="true"], [data-state="active"]';

/**
 * A pill that glides behind the active item of a tab strip / segmented
 * control / tool rail. Drop it as the FIRST child of the group container and
 * give the container the `has-slider` class:
 *
 *   <div className="panel-tabs has-slider" role="tablist">
 *     <SlidingIndicator />
 *     {tabs…}
 *   </div>
 *
 * It finds the active item with `selector` (class `active`, aria-selected or
 * Radix data-state) and follows it — on clicks, on re-renders, on resize, and
 * inside scrolling containers. The first placement is instant; every later
 * change animates (transition lives in CSS: `.sliding-indicator`).
 */
export default function SlidingIndicator({ selector = DEFAULT_SELECTOR, className = '' }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const indicator = ref.current;
    const group = indicator?.parentElement;
    if (!group) return undefined;
    let placed = false;
    let frame = 0;
    let lastActive = null;

    const place = () => {
      frame = 0;
      const active = [...group.querySelectorAll(selector)].find((node) => node !== indicator);
      if (!active || !active.getClientRects().length) {
        indicator.style.opacity = '0';
        placed = false;
        lastActive = null;
        return;
      }
      if (active !== lastActive) {
        // Restart the per-selection "draw" animation (used by the rail glow).
        lastActive = active;
        indicator.classList.remove('is-drawing');
        void indicator.offsetWidth;
        indicator.classList.add('is-drawing');
      }
      const groupRect = group.getBoundingClientRect();
      const rect = active.getBoundingClientRect();
      const x = rect.left - groupRect.left - group.clientLeft + group.scrollLeft;
      const y = rect.top - groupRect.top - group.clientTop + group.scrollTop;
      if (!placed) indicator.style.transition = 'none';
      indicator.style.width = `${rect.width}px`;
      indicator.style.height = `${rect.height}px`;
      indicator.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      indicator.style.opacity = '1';
      if (!placed) {
        void indicator.offsetWidth; // commit the jump before re-enabling transitions
        indicator.style.transition = '';
        placed = true;
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };

    place();
    const mutations = new MutationObserver(schedule);
    mutations.observe(group, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-selected', 'aria-pressed', 'data-state'] });
    const resize = new ResizeObserver(schedule);
    resize.observe(group);
    for (const child of group.children) if (child !== indicator) resize.observe(child);
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      mutations.disconnect();
      resize.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [selector]);

  return <span ref={ref} className={`sliding-indicator ${className}`.trim()} aria-hidden="true" />;
}
