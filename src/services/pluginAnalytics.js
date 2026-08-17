import { adminApi } from '../admin/adminApi.js';

export const PLUGIN_ANALYTICS_EVENTS = Object.freeze([
  'plugin_download_clicked',
  'support_modal_opened',
  'support_modal_skipped',
  'support_kofi_clicked',
  'plugin_download_started',
]);

const EVENT_SET = new Set(PLUGIN_ANALYTICS_EVENTS);

function clean(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
}

export function trackPluginEvent(eventName, download = {}) {
  if (!EVENT_SET.has(eventName)) return;

  const payload = {
    eventName,
    plugin: clean(download.plugin, 32),
    version: clean(download.version, 64),
  };

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('procedural-terrains:analytics', { detail: payload }));
  }

  // Analytics must never affect the download flow. The API endpoint stores only
  // the event, plugin, version, and a rotating one-way IP hash.
  adminApi.trackPluginEvent(eventName, payload).catch(() => {});
}
