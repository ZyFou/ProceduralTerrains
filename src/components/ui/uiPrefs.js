const STORAGE_KEY = 'pt-ui-prefs';

/** @typedef {'both' | 'icons' | 'labels'} ModeDisplay */

/**
 * @typedef {object} UiPrefs
 * @property {boolean} toolbarLabels  Show labels under left-toolbar icons
 * @property {ModeDisplay} modeDisplay
 * @property {boolean} cameraControls Show bottom camera toolbar
 */

/** @type {UiPrefs} */
export const DEFAULT_UI_PREFS = {
  toolbarLabels: true,
  modeDisplay: 'both',
  cameraControls: true,
};

export function loadUiPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_UI_PREFS };
    return normalizeUiPrefs(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_UI_PREFS };
  }
}

export function saveUiPrefs(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeUiPrefs(prefs)));
  } catch { /* non-fatal */ }
}

export function normalizeUiPrefs(input) {
  const modeDisplay = input?.modeDisplay === 'icons' || input?.modeDisplay === 'labels'
    ? input.modeDisplay
    : 'both';
  return {
    toolbarLabels: input?.toolbarLabels !== false,
    modeDisplay,
    cameraControls: input?.cameraControls !== false,
  };
}
