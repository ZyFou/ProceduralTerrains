import { useCallback, useState } from 'react';
import { normalizePluginDownload } from '../config/plugins.js';
import { startPluginDownload } from '../services/downloadManager.js';
import { trackPluginEvent } from '../services/pluginAnalytics.js';

export const SUPPORT_PROMPT_STORAGE_KEY = 'proceduralTerrainsSupportPrompt';
export const SUPPORT_PROMPT_MAJOR_STORAGE_KEY = 'proceduralTerrainsSupportPromptMajor';
export const SUPPORT_PROMPT_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

function readStorage(key) {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
  } catch {
    // Private browsing and storage-disabled contexts should still download.
  }
}

function majorVersion(version) {
  const match = String(version ?? '').match(/^(\d+)/);
  return match ? Number(match[1]) : null;
}

function readMajorVersions() {
  try {
    return JSON.parse(readStorage(SUPPORT_PROMPT_MAJOR_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function shouldShowSupportPrompt(download, now = Date.now()) {
  const lastShown = Number(readStorage(SUPPORT_PROMPT_STORAGE_KEY));
  const recentlyShown = Number.isFinite(lastShown) && now - lastShown < SUPPORT_PROMPT_INTERVAL_MS;
  if (!recentlyShown) return true;

  const currentMajor = majorVersion(download?.version);
  const previousMajor = readMajorVersions()[download?.plugin];
  return currentMajor != null && previousMajor != null && currentMajor > Number(previousMajor);
}

export function markSupportPromptShown(download, now = Date.now()) {
  writeStorage(SUPPORT_PROMPT_STORAGE_KEY, String(now));
  const versions = readMajorVersions();
  const currentMajor = majorVersion(download?.version);
  if (download?.plugin && currentMajor != null) {
    versions[download.plugin] = currentMajor;
    writeStorage(SUPPORT_PROMPT_MAJOR_STORAGE_KEY, JSON.stringify(versions));
  }
}

export default function useSupportPrompt() {
  const [pendingDownload, setPendingDownload] = useState(null);

  const clearPendingDownload = useCallback(() => setPendingDownload(null), []);

  const beginDownload = useCallback((download) => {
    if (!startPluginDownload(download)) return false;
    setPendingDownload(null);
    return true;
  }, []);

  const openSupportDownload = useCallback((input) => {
    const download = normalizePluginDownload(input);
    if (!download) return false;

    trackPluginEvent('plugin_download_clicked', download);
    if (!shouldShowSupportPrompt(download)) {
      return beginDownload(download);
    }

    markSupportPromptShown(download);
    trackPluginEvent('support_modal_opened', download);
    setPendingDownload(download);
    return true;
  }, [beginDownload]);

  const continueWithoutDonating = useCallback(() => {
    if (!pendingDownload) return false;
    trackPluginEvent('support_modal_skipped', pendingDownload);
    return beginDownload(pendingDownload);
  }, [beginDownload, pendingDownload]);

  const downloadAfterSupport = useCallback(() => {
    if (!pendingDownload) return false;
    return beginDownload(pendingDownload);
  }, [beginDownload, pendingDownload]);

  return {
    pendingDownload,
    openSupportDownload,
    continueWithoutDonating,
    downloadAfterSupport,
    closeSupportPrompt: clearPendingDownload,
  };
}
