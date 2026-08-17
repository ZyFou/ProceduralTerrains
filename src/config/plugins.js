export const PLUGINS = Object.freeze({
  unity: Object.freeze({
    id: 'unity',
    name: 'Unity',
    currentVersion: '0.2.0-alpha.1',
    downloadUrl: '/downloads/plugins/procedural-terrains-unity-0.2.0-alpha.1.zip',
    license: 'MIT licensed',
    releaseLabel: 'Alpha release',
    supportMessage: 'Maintaining the Unity integration across engine versions takes significant development and testing time.',
  }),
  blender: Object.freeze({
    id: 'blender',
    name: 'Blender',
    currentVersion: '0.2.0',
    downloadUrl: '/downloads/plugins/procedural-terrains-blender-0.2.0.zip',
    license: 'GPL-3.0-or-later',
    releaseLabel: 'Alpha release',
    supportMessage: 'Maintaining the Blender integration and compatibility with new Blender releases takes ongoing development work.',
  }),
});

export function getPluginDefinition(plugin) {
  const id = typeof plugin === 'string' ? plugin : plugin?.id;
  return id && PLUGINS[id] ? PLUGINS[id] : null;
}

export function normalizePluginDownload(download) {
  const definition = getPluginDefinition(download?.plugin ?? download);
  const version = download?.version ?? download?.currentVersion;
  const downloadUrl = download?.downloadUrl ?? definition?.downloadUrl;
  if (!definition || !downloadUrl || !version) return null;
  return Object.freeze({
    plugin: definition.id,
    pluginName: definition.name,
    version: String(version),
    downloadUrl: String(downloadUrl),
  });
}
