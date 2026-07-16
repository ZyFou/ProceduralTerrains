const TOOLS_STORAGE_KEY = 'pt-tools-rail-layout';
const DRAWER_STORAGE_KEY = 'pt-side-drawer-layout';

/** @typedef {'left' | 'right' | 'top' | 'bottom'} ToolsRailEdge */
/** @typedef {'left' | 'right'} DrawerSide */

/** @type {{ edge: ToolsRailEdge }} */
export const DEFAULT_TOOLS_RAIL_LAYOUT = { edge: 'left' };

/** @type {{ side: DrawerSide }} */
export const DEFAULT_DRAWER_LAYOUT = { side: 'right' };

const DESKTOP_MQ = '(hover: hover) and (pointer: fine) and (min-width: 821px)';

export function isToolsRailDesktopLayout() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(DESKTOP_MQ).matches;
}

export function loadToolsRailLayout() {
  try {
    const raw = localStorage.getItem(TOOLS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_TOOLS_RAIL_LAYOUT };
    return normalizeToolsRailLayout(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_TOOLS_RAIL_LAYOUT };
  }
}

export function saveToolsRailLayout(layout) {
  try {
    localStorage.setItem(TOOLS_STORAGE_KEY, JSON.stringify(normalizeToolsRailLayout(layout)));
  } catch { /* non-fatal */ }
}

export function normalizeToolsRailLayout(input) {
  // Migrate older { mode, side } / float payloads.
  if (input?.edge === 'left' || input?.edge === 'right' || input?.edge === 'top' || input?.edge === 'bottom') {
    return { edge: input.edge };
  }
  if (input?.side === 'right') return { edge: 'right' };
  if (input?.side === 'left') return { edge: 'left' };
  return { ...DEFAULT_TOOLS_RAIL_LAYOUT };
}

export function loadDrawerLayout() {
  try {
    const raw = localStorage.getItem(DRAWER_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DRAWER_LAYOUT };
    return normalizeDrawerLayout(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_DRAWER_LAYOUT };
  }
}

export function saveDrawerLayout(layout) {
  try {
    localStorage.setItem(DRAWER_STORAGE_KEY, JSON.stringify(normalizeDrawerLayout(layout)));
  } catch { /* non-fatal */ }
}

export function normalizeDrawerLayout(input) {
  return { side: input?.side === 'left' ? 'left' : 'right' };
}

/**
 * Nearest-edge snap. Always returns one of `edges` (snappy, never free-float).
 * @param {number} clientX
 * @param {number} clientY
 * @param {{ left: number, top: number, width: number, height: number }} shellRect
 * @param {readonly string[]} edges
 */
export function resolveNearestEdge(clientX, clientY, shellRect, edges) {
  const x = clientX - shellRect.left;
  const y = clientY - shellRect.top;
  const dist = {
    left: x,
    right: shellRect.width - x,
    top: y,
    bottom: shellRect.height - y,
  };
  let best = edges[0];
  let bestD = Number.POSITIVE_INFINITY;
  for (const edge of edges) {
    const d = dist[edge];
    if (Number.isFinite(d) && d < bestD) {
      bestD = d;
      best = edge;
    }
  }
  return best;
}

export const TOOLS_RAIL_EDGES = /** @type {const} */ (['left', 'right', 'top', 'bottom']);
export const DRAWER_EDGES = /** @type {const} */ (['left', 'right']);

/** @deprecated use resolveNearestEdge — kept name for older imports during rewrite */
export function resolveToolsRailDrop(clientX, clientY, shellRect) {
  return resolveNearestEdge(clientX, clientY, shellRect, TOOLS_RAIL_EDGES);
}
