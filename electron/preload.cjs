const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('proceduralTerrainsDesktop', {
  openDocument: () => ipcRenderer.invoke('desktop:document:open'),
  takeStartupDocument: () => ipcRenderer.invoke('desktop:document:take-startup'),
  openRecentDocument: (documentPath) => ipcRenderer.invoke('desktop:document:open-recent', documentPath),
  saveDocument: (payload) => ipcRenderer.invoke('desktop:document:save', payload),
  listRecentDocuments: () => ipcRenderer.invoke('desktop:recent:list'),
  saveArtifact: (payload) => ipcRenderer.invoke('desktop:artifact:save', payload),
  getBackendSettings: () => ipcRenderer.invoke('desktop:backend:get'),
  setBackendSettings: (settings) => ipcRenderer.invoke('desktop:backend:set', settings),
  onOpenDocument: (listener) => {
    const callback = (_event, payload) => listener(payload);
    ipcRenderer.on('desktop:document:open-from-os', callback);
    return () => ipcRenderer.removeListener('desktop:document:open-from-os', callback);
  },
  onCloseRequested: (listener) => {
    const callback = () => listener();
    ipcRenderer.on('desktop:window:close-requested', callback);
    return () => ipcRenderer.removeListener('desktop:window:close-requested', callback);
  },
  resolveClose: (action) => ipcRenderer.send('desktop:window:close-response', action),
});
