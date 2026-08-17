import { trackPluginEvent } from './pluginAnalytics.js';

export function startPluginDownload(download) {
  if (!download?.downloadUrl || typeof document === 'undefined') return false;

  const link = document.createElement('a');
  link.href = download.downloadUrl;
  link.download = '';
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();

  trackPluginEvent('plugin_download_started', download);
  return true;
}
