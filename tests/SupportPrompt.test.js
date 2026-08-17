import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PLUGINS, normalizePluginDownload } from '../src/config/plugins.js';
import {
  markSupportPromptShown,
  shouldShowSupportPrompt,
  SUPPORT_PROMPT_INTERVAL_MS,
  SUPPORT_PROMPT_STORAGE_KEY,
} from '../src/hooks/useSupportPrompt.js';

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

describe('support download prompt', () => {
  beforeEach(() => {
    globalThis.window = { localStorage: createStorage() };
  });

  afterEach(() => {
    delete globalThis.window;
  });

  it('prompts on the first download and suppresses the next one for 30 days', () => {
    const download = { plugin: 'unity', version: PLUGINS.unity.currentVersion };
    const now = 1_800_000_000_000;

    expect(shouldShowSupportPrompt(download, now)).toBe(true);
    markSupportPromptShown(download, now);
    expect(window.localStorage.getItem(SUPPORT_PROMPT_STORAGE_KEY)).toBe(String(now));
    expect(shouldShowSupportPrompt(download, now + 24 * 60 * 60 * 1000)).toBe(false);
    expect(shouldShowSupportPrompt(download, now + SUPPORT_PROMPT_INTERVAL_MS + 1)).toBe(true);
  });

  it('allows a new major version to reopen the prompt early', () => {
    const now = 1_800_000_000_000;
    const firstRelease = { plugin: 'unity', version: '1.6.0' };
    const majorRelease = { plugin: 'unity', version: '2.0.0' };

    markSupportPromptShown(firstRelease, now);
    expect(shouldShowSupportPrompt(majorRelease, now + 1_000)).toBe(true);
  });

  it('normalizes a plugin definition passed directly by the download buttons', () => {
    expect(normalizePluginDownload(PLUGINS.unity)).toMatchObject({
      plugin: 'unity',
      pluginName: 'Unity',
      version: PLUGINS.unity.currentVersion,
      downloadUrl: PLUGINS.unity.downloadUrl,
    });
  });
});
