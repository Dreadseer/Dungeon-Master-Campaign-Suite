const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke('app:version'),

  db: {
    campaigns: {
      getAll:   ()         => ipcRenderer.invoke('db:campaigns:getAll'),
      getById:  (id)       => ipcRenderer.invoke('db:campaigns:getById', id),
      create:   (data)     => ipcRenderer.invoke('db:campaigns:create', data),
      update:   (id, data) => ipcRenderer.invoke('db:campaigns:update', id, data),
      delete:   (id)       => ipcRenderer.invoke('db:campaigns:delete', id),
    },
    npcs: {
      getAll:   (campaignId) => ipcRenderer.invoke('db:npcs:getAll', campaignId),
      create:   (data)       => ipcRenderer.invoke('db:npcs:create', data),
      update:   (id, data)   => ipcRenderer.invoke('db:npcs:update', id, data),
      delete:   (id)         => ipcRenderer.invoke('db:npcs:delete', id),
    },
    locations: {
      getAll:   (campaignId) => ipcRenderer.invoke('db:locations:getAll', campaignId),
      create:   (data)       => ipcRenderer.invoke('db:locations:create', data),
      update:   (id, data)   => ipcRenderer.invoke('db:locations:update', id, data),
      delete:   (id)         => ipcRenderer.invoke('db:locations:delete', id),
    },
    connections: {
      getAll:   (campaignId) => ipcRenderer.invoke('db:connections:getAll', campaignId),
      create:   (data)       => ipcRenderer.invoke('db:connections:create', data),
      delete:   (id)         => ipcRenderer.invoke('db:connections:delete', id),
    },
  },

  // srd and ai methods added in Prompts 03–04
})
