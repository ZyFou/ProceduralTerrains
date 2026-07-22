export const EDITOR_SHORTCUTS = Object.freeze({
  newTerrain: Object.freeze({ key: 'n', displayKey: 'N' }),
  projects: Object.freeze({ key: 'o', displayKey: 'O', shiftKey: true }),
  save: Object.freeze({ key: 's', displayKey: 'S' }),
  load: Object.freeze({ key: 'o', displayKey: 'O' }),
  download: Object.freeze({ key: 'd', displayKey: 'D' }),
  settings: Object.freeze({ key: ',', displayKey: ',' }),
  randomSeed: Object.freeze({ key: 'r', displayKey: 'R' }),
  paintMode: Object.freeze({ key: 'p', displayKey: 'P' }),
});

export const SEARCH_SETTINGS_SHORTCUT = Object.freeze({ key: 'k', displayKey: 'K' });

export const getPlatformName = () => {
  if (typeof navigator === 'undefined') return '';
  return navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '';
};

export const isMacPlatform = (platform = getPlatformName()) => /mac|iphone|ipad|ipod/i.test(platform);

export const shortcutText = (shortcut, platform = getPlatformName()) => {
  const parts = [isMacPlatform(platform) ? 'Command' : 'Ctrl'];
  if (shortcut.shiftKey) parts.push('Shift');
  if (shortcut.altKey) parts.push(isMacPlatform(platform) ? 'Option' : 'Alt');
  parts.push(shortcut.displayKey ?? String(shortcut.key).toUpperCase());
  return parts.join(' + ');
};

export const matchesShortcut = (event, shortcut, platform = getPlatformName()) => {
  const mac = isMacPlatform(platform);
  const primaryPressed = mac ? event.metaKey : event.ctrlKey;
  const otherPrimaryPressed = mac ? event.ctrlKey : event.metaKey;

  return primaryPressed
    && !otherPrimaryPressed
    && !!event.shiftKey === !!shortcut.shiftKey
    && !!event.altKey === !!shortcut.altKey
    && String(event.key ?? '').toLowerCase() === String(shortcut.key).toLowerCase();
};
