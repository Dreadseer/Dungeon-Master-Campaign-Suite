const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke('app:version'),

  // IPC methods for db, ai, and pdf will be added in Prompt 02-04
})
