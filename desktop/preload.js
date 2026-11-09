// Puente mínimo y seguro entre las pantallas locales (configuración / error) y la aplicación.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('legaltaxDesktop', {
  testServer: url => ipcRenderer.invoke('lt:test-server', url),
  saveServer: url => ipcRenderer.invoke('lt:save-server', url),
  getServer: () => ipcRenderer.invoke('lt:get-server'),
  retry: () => ipcRenderer.invoke('lt:retry'),
});
