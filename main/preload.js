const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('cyber', {
  getSources: () => ipcRenderer.invoke('get-sources'),
  onSpotifyCallback: cb => ipcRenderer.on('spotify-callback', (e, d) => cb(d)),
  openExternal: url => ipcRenderer.invoke('open-external', url),
  configGet: () => ipcRenderer.invoke('config-get'),
  configSet: cfg => ipcRenderer.invoke('config-set', cfg),
  setAlwaysOnTop: v => ipcRenderer.invoke('set-always-on-top', v),
  setOpacity: v => ipcRenderer.invoke('set-opacity', v),
  minimize: () => ipcRenderer.invoke('win-minimize'),
  hide: () => ipcRenderer.invoke('win-hide'),
  httpJson: req => ipcRenderer.invoke('http-json', req)
});
